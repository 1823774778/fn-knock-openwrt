import * as os from "node:os";
import { readFileSync } from "node:fs";
import { configManager } from "./redis";
import { emitResourceAlertEvent } from "./system-events/helpers";
import { systemEventManager } from "./system-events/manager";

type ResourceMetric = "cpu" | "memory";
type ResourceStatus = "normal" | "alert";

type CpuSnapshot = {
  idle: number;
  total: number;
};

type ResourceMonitorState = {
  status: ResourceStatus;
  lastSampleAt?: number;
  lastUsagePercent?: number;
  aboveThresholdSince?: number | null;
  belowRecoverSince?: number | null;
  cpuSnapshot?: CpuSnapshot;
};

const STATE_KEY_PREFIX = "system-resource-monitor";
const STATE_KEYS: Record<ResourceMetric, string> = {
  cpu: `${STATE_KEY_PREFIX}:cpu`,
  memory: `${STATE_KEY_PREFIX}:memory`,
};
const RESOURCE_ALERT_DEDUPE_TTL_SECONDS = 60;

const hostname = os.hostname() || "unknown-host";

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Number(value.toFixed(1))));

const nowMs = () => Date.now();

const getResourceAlertDedupeKey = (payload: {
  metric: ResourceMetric;
  hostname: string;
  recovered?: boolean;
  transitionSince: number;
}) =>
  [
    "resource-alert",
    payload.hostname,
    payload.metric,
    payload.recovered ? "recovered" : "alert",
    payload.transitionSince,
  ].join(":");

const readCpuSnapshot = (): CpuSnapshot => {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }

  return { idle, total };
};

const readCpuUsagePercent = (previous: CpuSnapshot | undefined): {
  usagePercent: number | null;
  snapshot: CpuSnapshot;
} => {
  const snapshot = readCpuSnapshot();
  if (!previous) {
    return { usagePercent: null, snapshot };
  }

  const totalDelta = snapshot.total - previous.total;
  const idleDelta = snapshot.idle - previous.idle;
  if (totalDelta <= 0) {
    return { usagePercent: null, snapshot };
  }

  const usagePercent = clampPercent((1 - idleDelta / totalDelta) * 100);
  return { usagePercent, snapshot };
};

const parseMemInfoKilobytes = (line: string): number | null => {
  const match = line.match(/:\s*(\d+)\s*kB/i);
  if (!match) return null;

  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : null;
};

const readLinuxMemoryAvailability = () => {
  if (process.platform !== "linux") return null;

  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    let totalKilobytes: number | null = null;
    let availableKilobytes: number | null = null;

    for (const line of meminfo.split("\n")) {
      if (line.startsWith("MemTotal:")) {
        totalKilobytes = parseMemInfoKilobytes(line);
      } else if (line.startsWith("MemAvailable:")) {
        availableKilobytes = parseMemInfoKilobytes(line);
      }

      if (totalKilobytes !== null && availableKilobytes !== null) {
        break;
      }
    }

    if (totalKilobytes === null || availableKilobytes === null) {
      return null;
    }

    return {
      total: totalKilobytes * 1024,
      available: Math.min(availableKilobytes * 1024, totalKilobytes * 1024),
    };
  } catch {
    return null;
  }
};

const readMemoryUsagePercent = () => {
  // On Linux, MemAvailable treats reclaimable cache as usable memory.
  const memory = readLinuxMemoryAvailability();
  const total = memory?.total ?? os.totalmem();
  const free = memory?.available ?? os.freemem();
  if (total <= 0) return 0;
  return clampPercent(((total - free) / total) * 100);
};

class SystemResourceMonitor {
  private async getState(metric: ResourceMetric): Promise<ResourceMonitorState> {
    const current =
      (await systemEventManager.getState<ResourceMonitorState>(
        STATE_KEYS[metric],
      )) ?? null;
    return current?.status ? current : { status: "normal" };
  }

  private async setState(metric: ResourceMetric, state: ResourceMonitorState) {
    await systemEventManager.setState(STATE_KEYS[metric], state);
  }

  private async deleteState(metric: ResourceMetric) {
    await systemEventManager.deleteState(STATE_KEYS[metric]);
  }

  async resetStates() {
    await Promise.all(
      (Object.keys(STATE_KEYS) as ResourceMetric[]).map((metric) =>
        this.deleteState(metric),
      ),
    );
  }

  async tick() {
    const config = await configManager.getConfig();
    const eventSystem = config.event_system;
    if (!eventSystem?.enabled) {
      await this.resetStates();
      return;
    }

    await this.processMetric("cpu", eventSystem.rules.cpu_alert);
    await this.processMetric("memory", eventSystem.rules.memory_alert);
  }

  private async processMetric(
    metric: ResourceMetric,
    rule: {
      enabled: boolean;
      threshold_percent: number;
      recover_percent: number;
      sample_interval_seconds: number;
      sustain_seconds: number;
    },
  ) {
    if (!rule.enabled) {
      await this.deleteState(metric);
      return;
    }

    const state = await this.getState(metric);
    const now = nowMs();
    const sampleIntervalMs = Math.max(1, rule.sample_interval_seconds) * 1000;
    if (state.lastSampleAt && now - state.lastSampleAt < sampleIntervalMs) {
      return;
    }

    const measurement =
      metric === "cpu"
        ? readCpuUsagePercent(state.cpuSnapshot)
        : {
            usagePercent: readMemoryUsagePercent(),
            snapshot: undefined,
          };

    const nextState: ResourceMonitorState = {
      ...state,
      lastSampleAt: now,
      ...(measurement.snapshot ? { cpuSnapshot: measurement.snapshot } : {}),
    };

    if (measurement.usagePercent === null) {
      await this.setState(metric, nextState);
      return;
    }

    nextState.lastUsagePercent = measurement.usagePercent;
    const sustainMs = Math.max(1, rule.sustain_seconds) * 1000;

    if (measurement.usagePercent >= rule.threshold_percent) {
      nextState.aboveThresholdSince = nextState.aboveThresholdSince ?? now;
      nextState.belowRecoverSince = null;

      if (
        nextState.status !== "alert" &&
        now - nextState.aboveThresholdSince >= sustainMs
      ) {
        const publishedEvent = await emitResourceAlertEvent({
          metric,
          hostname,
          usagePercent: measurement.usagePercent,
          thresholdPercent: rule.threshold_percent,
          recoverPercent: rule.recover_percent,
          sampleIntervalSeconds: rule.sample_interval_seconds,
          sustainSeconds: rule.sustain_seconds,
          dedupeKey: getResourceAlertDedupeKey({
            metric,
            hostname,
            transitionSince: nextState.aboveThresholdSince,
          }),
          dedupeTtlSeconds: RESOURCE_ALERT_DEDUPE_TTL_SECONDS,
        });
        if (publishedEvent) {
          nextState.status = "alert";
        } else {
          return;
        }
      }

      await this.setState(metric, nextState);
      return;
    }

    if (measurement.usagePercent <= rule.recover_percent) {
      if (nextState.status === "alert") {
        nextState.belowRecoverSince = nextState.belowRecoverSince ?? now;
        nextState.aboveThresholdSince = null;

        if (now - nextState.belowRecoverSince >= sustainMs) {
          const publishedEvent = await emitResourceAlertEvent({
            metric,
            hostname,
            usagePercent: measurement.usagePercent,
            thresholdPercent: rule.threshold_percent,
            recoverPercent: rule.recover_percent,
            sampleIntervalSeconds: rule.sample_interval_seconds,
            sustainSeconds: rule.sustain_seconds,
            recovered: true,
            dedupeKey: getResourceAlertDedupeKey({
              metric,
              hostname,
              recovered: true,
              transitionSince: nextState.belowRecoverSince,
            }),
            dedupeTtlSeconds: RESOURCE_ALERT_DEDUPE_TTL_SECONDS,
          });
          if (publishedEvent) {
            nextState.status = "normal";
            nextState.belowRecoverSince = null;
          } else {
            return;
          }
        }
      } else {
        nextState.aboveThresholdSince = null;
        nextState.belowRecoverSince = null;
      }

      await this.setState(metric, nextState);
      return;
    }

    if (nextState.status === "alert") {
      nextState.belowRecoverSince = null;
    } else {
      nextState.aboveThresholdSince = null;
    }

    await this.setState(metric, nextState);
  }
}

export const systemResourceMonitor = new SystemResourceMonitor();
