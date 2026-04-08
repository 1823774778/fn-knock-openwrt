import fs from "node:fs";
import { spawn } from "node:child_process";
import { collectStreamOutput, sleep } from "./runtime";

const EXPECTED_TIME_ZONE = "Asia/Shanghai";
const TIME_DRIFT_THRESHOLD_MS = 90_000;
const CLOCK_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const NETWORK_REQUEST_TIMEOUT_MS = 4_000;

const NETWORK_TIME_SOURCES = [
  { label: "Baidu HTTPS", url: "https://www.baidu.com/" },
  { label: "QQ HTTPS", url: "https://www.qq.com/" },
  { label: "Aliyun HTTPS", url: "https://www.aliyun.com/" },
  { label: "Baidu HTTP", url: "http://www.baidu.com/" },
  { label: "QQ HTTP", url: "http://www.qq.com/" },
  { label: "Aliyun HTTP", url: "http://www.aliyun.com/" },
] as const;

export type SystemClockIssueCode = "timezone_mismatch" | "time_mismatch";

export type SystemClockIssue = {
  code: SystemClockIssueCode;
  title: string;
  message: string;
};

export type SystemClockStatus = {
  expectedTimeZone: string;
  systemTimeZone: string | null;
  checkedAt: string | null;
  networkSource: string | null;
  hasRemoteTime: boolean;
  lastCheckError: string | null;
  systemTimeMs: number | null;
  remoteTimeMs: number | null;
  systemBeijingTime: string | null;
  remoteBeijingTime: string | null;
  driftMs: number | null;
  driftThresholdMs: number;
  timeMismatch: boolean;
  timezoneMismatch: boolean;
  needsAttention: boolean;
  issues: SystemClockIssue[];
  checking: boolean;
  syncInProgress: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncSummary: string | null;
};

type NetworkTimeResult = {
  epochMs: number;
  source: string;
};

const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: EXPECTED_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const formatBeijingTime = (epochMs: number | null) => {
  if (!Number.isFinite(epochMs)) return null;
  return BEIJING_TIME_FORMATTER.format(new Date(epochMs as number));
};

const formatDrift = (driftMs: number) => {
  const totalSeconds = Math.max(1, Math.round(Math.abs(driftMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds} 秒`;
  if (seconds === 0) return `${minutes} 分钟`;
  return `${minutes} 分 ${seconds} 秒`;
};

const createInitialStatus = (): SystemClockStatus => ({
  expectedTimeZone: EXPECTED_TIME_ZONE,
  systemTimeZone: null,
  checkedAt: null,
  networkSource: null,
  hasRemoteTime: false,
  lastCheckError: null,
  systemTimeMs: null,
  remoteTimeMs: null,
  systemBeijingTime: null,
  remoteBeijingTime: null,
  driftMs: null,
  driftThresholdMs: TIME_DRIFT_THRESHOLD_MS,
  timeMismatch: false,
  timezoneMismatch: false,
  needsAttention: false,
  issues: [],
  checking: false,
  syncInProgress: false,
  lastSyncAt: null,
  lastSyncError: null,
  syncSummary: null,
});

export class SystemClockManager {
  private status: SystemClockStatus = createInitialStatus();
  private checkPromise: Promise<SystemClockStatus> | null = null;
  private syncPromise: Promise<{
    message: string;
    data: SystemClockStatus;
  }> | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  prepareOnBoot() {
    this.ensurePolling();
    void this.checkNow();
  }

  getStatus(): SystemClockStatus {
    return {
      ...this.status,
      issues: [...this.status.issues],
    };
  }

  async checkNow(): Promise<SystemClockStatus> {
    if (this.checkPromise) return this.checkPromise;

    this.status = {
      ...this.status,
      checking: true,
      lastCheckError: null,
    };

    this.checkPromise = (async () => {
      const systemTimeZone = this.detectSystemTimeZone();
      const systemTimeMs = Date.now();
      let remote: NetworkTimeResult | null = null;
      let lastCheckError: string | null = null;

      try {
        remote = await this.fetchNetworkTime();
      } catch (error) {
        lastCheckError = toErrorMessage(error, "联网检查系统时间失败");
      }

      const remoteTimeMs = remote?.epochMs ?? null;
      const driftMs =
        remoteTimeMs === null ? null : systemTimeMs - remoteTimeMs;
      const timeMismatch =
        driftMs !== null && Math.abs(driftMs) > TIME_DRIFT_THRESHOLD_MS;
      const timezoneMismatch = systemTimeZone !== EXPECTED_TIME_ZONE;
      const issues: SystemClockIssue[] = [];

      if (timezoneMismatch) {
        issues.push({
          code: "timezone_mismatch",
          title: "系统时区不是北京时间",
          message: `当前系统时区为 ${systemTimeZone || "未知"}，应设置为 ${EXPECTED_TIME_ZONE}。`,
        });
      }

      if (timeMismatch && driftMs !== null) {
        issues.push({
          code: "time_mismatch",
          title: "系统时间与联网校验结果不一致",
          message: `当前系统时间与联网校验结果相差约 ${formatDrift(driftMs)}。`,
        });
      }

      this.status = {
        ...this.status,
        systemTimeZone,
        checkedAt: new Date().toISOString(),
        networkSource: remote?.source ?? null,
        hasRemoteTime: remoteTimeMs !== null,
        lastCheckError,
        systemTimeMs,
        remoteTimeMs,
        systemBeijingTime: formatBeijingTime(systemTimeMs),
        remoteBeijingTime: formatBeijingTime(remoteTimeMs),
        driftMs,
        driftThresholdMs: TIME_DRIFT_THRESHOLD_MS,
        timeMismatch,
        timezoneMismatch,
        needsAttention: timezoneMismatch || timeMismatch,
        issues,
        checking: false,
      };

      return this.getStatus();
    })().finally(() => {
      this.checkPromise = null;
    });

    return this.checkPromise;
  }

  async syncNow(): Promise<{ message: string; data: SystemClockStatus }> {
    if (this.syncPromise) return this.syncPromise;

    this.status = {
      ...this.status,
      syncInProgress: true,
      lastSyncError: null,
    };

    this.syncPromise = (async () => {
      const actions: string[] = [];

      try {
        const statusBeforeSync = await this.checkNow();

        if (statusBeforeSync.systemTimeZone !== EXPECTED_TIME_ZONE) {
          actions.push(await this.setSystemTimeZone());
        }

        if (
          statusBeforeSync.hasRemoteTime &&
          statusBeforeSync.remoteTimeMs !== null
        ) {
          const checkedAtMs = statusBeforeSync.checkedAt
            ? Date.parse(statusBeforeSync.checkedAt)
            : Date.now();
          const elapsedMs = Math.max(0, Date.now() - checkedAtMs);
          const targetEpochMs = statusBeforeSync.remoteTimeMs + elapsedMs;
          actions.push(await this.setSystemClock(targetEpochMs));
        }

        const ntpMessage = await this.enableNetworkTimeSync();
        if (ntpMessage) {
          actions.push(ntpMessage);
        }

        await sleep(1_500);
        const nextStatus = await this.checkNow();
        const message =
          actions.length > 0 ? actions.join("；") : "系统时间状态已刷新";

        this.status = {
          ...nextStatus,
          syncInProgress: false,
          lastSyncAt: new Date().toISOString(),
          lastSyncError: null,
          syncSummary: message,
        };

        return {
          message,
          data: this.getStatus(),
        };
      } catch (error) {
        const message = toErrorMessage(error, "系统时间同步失败");
        this.status = {
          ...this.status,
          syncInProgress: false,
          lastSyncAt: new Date().toISOString(),
          lastSyncError: message,
          syncSummary: null,
        };
        throw new Error(message);
      }
    })().finally(() => {
      this.syncPromise = null;
    });

    return this.syncPromise;
  }

  private ensurePolling() {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      void this.checkNow();
    }, CLOCK_CHECK_INTERVAL_MS);

    this.pollTimer.unref?.();
  }

  private detectSystemTimeZone() {
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
      return timeZone || null;
    } catch {
      return null;
    }
  }

  private async fetchNetworkTime(): Promise<NetworkTimeResult> {
    let lastError = "未能从网络获取标准时间";

    for (const source of NETWORK_TIME_SOURCES) {
      try {
        return await this.fetchNetworkTimeFromSource(source.url, source.label);
      } catch (error) {
        lastError = toErrorMessage(error, `从 ${source.label} 获取时间失败`);
      }
    }

    throw new Error(lastError);
  }

  private async fetchNetworkTimeFromSource(
    url: string,
    label: string,
  ): Promise<NetworkTimeResult> {
    const requestStartedAt = Date.now();
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(NETWORK_REQUEST_TIMEOUT_MS),
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    }).catch(() => null);

    let dateHeader = response?.headers.get("date") ?? null;

    if (!dateHeader) {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(NETWORK_REQUEST_TIMEOUT_MS),
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      dateHeader = response.headers.get("date");
    }

    if (!dateHeader) {
      throw new Error(`${label} 未返回可用的 Date 响应头`);
    }

    const remoteTimeMs = Date.parse(dateHeader);
    if (!Number.isFinite(remoteTimeMs)) {
      throw new Error(`${label} 返回了无法解析的时间`);
    }

    const latencyMs = Math.max(0, Date.now() - requestStartedAt);

    return {
      epochMs: remoteTimeMs + Math.round(latencyMs / 2),
      source: label,
    };
  }

  private async runCommand(command: string, args: string[]) {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const exitCodePromise = new Promise<number>((resolve, reject) => {
      proc.once("error", reject);
      proc.once("close", (code) => resolve(code ?? -1));
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      collectStreamOutput(proc.stdout),
      collectStreamOutput(proc.stderr),
      exitCodePromise,
    ]);

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `执行 ${command} 失败`);
    }

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }

  private async tryRunCommand(command: string, args: string[]) {
    try {
      await this.runCommand(command, args);
      return true;
    } catch {
      return false;
    }
  }

  private async setSystemTimeZone() {
    try {
      await this.runCommand("timedatectl", [
        "set-timezone",
        EXPECTED_TIME_ZONE,
      ]);
      return `已设置系统时区为 ${EXPECTED_TIME_ZONE}`;
    } catch {
      const zoneinfoPath = `/usr/share/zoneinfo/${EXPECTED_TIME_ZONE}`;
      if (!fs.existsSync(zoneinfoPath)) {
        throw new Error(`系统缺少时区文件 ${zoneinfoPath}`);
      }

      try {
        fs.rmSync("/etc/localtime", { force: true });
      } catch {
        // ignore and continue with overwrite attempt below
      }

      try {
        fs.symlinkSync(zoneinfoPath, "/etc/localtime");
      } catch {
        fs.copyFileSync(zoneinfoPath, "/etc/localtime");
      }

      fs.writeFileSync("/etc/timezone", `${EXPECTED_TIME_ZONE}\n`, "utf-8");
      return `已写入系统时区 ${EXPECTED_TIME_ZONE}`;
    }
  }

  private async setSystemClock(targetEpochMs: number) {
    const targetSeconds = Math.floor(targetEpochMs / 1000);
    await this.runCommand("date", ["-u", "-s", `@${targetSeconds}`]);
    await this.tryRunCommand("hwclock", ["--systohc"]);
    return "已校准系统时间";
  }

  private async enableNetworkTimeSync() {
    const actions: string[] = [];

    if (await this.tryRunCommand("timedatectl", ["set-ntp", "true"])) {
      actions.push("已启用 NTP 自动校时");
    }

    for (const service of ["systemd-timesyncd", "chrony", "chronyd", "ntp"]) {
      if (await this.tryRunCommand("systemctl", ["restart", service])) {
        actions.push(`已重启 ${service} 服务`);
        break;
      }
    }

    return actions.length > 0 ? actions.join("，") : null;
  }
}

export const systemClockManager = new SystemClockManager();
