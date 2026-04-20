import { randomUUID } from "node:crypto";
import { redis } from "../redis";
import { ddnsManager } from ".";
import {
  DDNS_INTERFACE_IPV4_INDEX_FIELD,
  DDNS_INTERFACE_IPV6_INDEX_FIELD,
  DDNS_IP_SOURCE_FIELD,
  getDDNSTargetIPUnavailableMessage,
  resolveDDNSTargetIPs,
} from "./ip-source";
import {
  applyUpdateScope,
  DDNS_UPDATE_SCOPE_FIELD,
  normalizeUpdateScope,
} from "./providers/helpers";
import { DDNS_NETWORK_INTERFACE_FIELD } from "./network";
import { emitDDNSUpdateCompletedEvent } from "../system-events/helpers";

const DDNS_UPDATE_LOCK_NAME = "ddns-update";
const DDNS_UPDATE_LOCK_TTL_SECONDS = 600;
const DDNS_UPDATE_LOCK_KEY = `fn_knock:lock:${DDNS_UPDATE_LOCK_NAME}`;
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;
const REFRESH_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

type DDNSAutoCheckTrigger = "cron" | "enable";

type RunAutomaticDDNSCheckOptions = {
  trigger?: DDNSAutoCheckTrigger;
  emitSkipLog?: boolean;
  emitNoopLog?: boolean;
};

const TRIGGER_LABELS: Record<DDNSAutoCheckTrigger, string> = {
  cron: "定时检查",
  enable: "启用自动更新后立即检查",
};

const recordSkippedCheck = async (
  targetId: string,
  message: string,
  emitLog: boolean,
) => {
  await ddnsManager.setTargetLastCheck(targetId, "skipped", message);
  if (!emitLog) {
    return;
  }

  const summary = await ddnsManager.buildTargetSummary(targetId);
  if (summary) {
    await ddnsManager.appendTargetLog("warn", summary, message);
  } else {
    await ddnsManager.appendLog("warn", message);
  }
};

const acquireDDNSLock = async (token: string): Promise<boolean> => {
  const result = await redis.set(
    DDNS_UPDATE_LOCK_KEY,
    token,
    "EX",
    DDNS_UPDATE_LOCK_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
};

const refreshDDNSLock = async (token: string): Promise<void> => {
  await (redis as any).eval(
    REFRESH_LOCK_SCRIPT,
    1,
    DDNS_UPDATE_LOCK_KEY,
    token,
    String(DDNS_UPDATE_LOCK_TTL_SECONDS),
  );
};

const releaseDDNSLock = async (token: string): Promise<void> => {
  await (redis as any).eval(
    RELEASE_LOCK_SCRIPT,
    1,
    DDNS_UPDATE_LOCK_KEY,
    token,
  );
};

export const runAutomaticDDNSCheck = async (
  options: RunAutomaticDDNSCheckOptions = {},
) => {
  const trigger = options.trigger ?? "cron";
  const triggerLabel = TRIGGER_LABELS[trigger];
  const lockToken = randomUUID();

  const enabled = await ddnsManager.isEnabled();
  if (!enabled) {
    return;
  }

  const acquired = await acquireDDNSLock(lockToken);
  if (!acquired) {
    return;
  }

  try {
    const targets = await ddnsManager.listRunnableTargets();

    for (const target of targets) {
      const summary = (await ddnsManager.buildTargetSummary(target.id)) || {
        id: target.id,
        name: target.name,
        isPrimary: target.isPrimary,
        enabled: target.enabled,
        provider: target.provider,
        updateScope: normalizeUpdateScope(
          target.config[DDNS_UPDATE_SCOPE_FIELD],
        ),
        providerLabel: target.provider || "未配置",
        domainSummary: "",
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
        sortOrder: target.sortOrder,
        lastIP: target.lastIP,
        lastCheck: target.lastCheck,
      };

      try {
        if (!target.provider) {
          await recordSkippedCheck(
            target.id,
            `${triggerLabel}: 未选择 DDNS 提供商，已跳过`,
            options.emitSkipLog === true,
          );
          continue;
        }

        const complete = await ddnsManager.isTargetConfigComplete(target);
        if (!complete) {
          await recordSkippedCheck(
            target.id,
            `${triggerLabel}: 当前配置不完整，已跳过`,
            options.emitSkipLog === true,
          );
          continue;
        }

        await ddnsManager.ensureTargetAuxiliaryState(target, {
          emitLog: true,
          logPrefix: triggerLabel,
        });

        const updateScope = normalizeUpdateScope(
          target.config[DDNS_UPDATE_SCOPE_FIELD],
        );
        const ips = await resolveDDNSTargetIPs({
          updateScope,
          ipSource: target.config[DDNS_IP_SOURCE_FIELD],
          networkInterface: target.config[DDNS_NETWORK_INTERFACE_FIELD],
          interfaceIpv4Index: target.config[DDNS_INTERFACE_IPV4_INDEX_FIELD],
          interfaceIpv6Index: target.config[DDNS_INTERFACE_IPV6_INDEX_FIELD],
        });

        for (const warning of ips.warnings) {
          await ddnsManager.appendTargetLog(
            "warn",
            summary,
            `${triggerLabel}: ${warning}`,
          );
        }

        if (ips.source === "public" && !ips.ipv4 && !ips.ipv6) {
          const message = `${triggerLabel}: 无法获取公网 IP，已跳过`;
          await ddnsManager.setTargetLastCheck(target.id, "error", message);
          await ddnsManager.appendTargetLog("error", summary, message);
          continue;
        }

        const scopedIPs = applyUpdateScope(updateScope, ips.ipv4, ips.ipv6);
        if (!scopedIPs.ipv4 && !scopedIPs.ipv6) {
          const message = `${triggerLabel}: ${getDDNSTargetIPUnavailableMessage(ips.source, updateScope)}，已跳过`;
          await ddnsManager.setTargetLastCheck(target.id, "skipped", message);
          await ddnsManager.appendTargetLog("warn", summary, message);
          continue;
        }

        const lastIP = await ddnsManager.getTargetLastIP(target.id);
        const ipv4Changed = !!scopedIPs.ipv4 && scopedIPs.ipv4 !== lastIP.ipv4;
        const ipv6Changed = !!scopedIPs.ipv6 && scopedIPs.ipv6 !== lastIP.ipv6;

        if (!ipv4Changed && !ipv6Changed) {
          const message = `${triggerLabel}: 目标 IP 未变化，无需更新`;
          await ddnsManager.setTargetLastCheck(target.id, "noop", message);
          if (options.emitNoopLog === true) {
            await ddnsManager.appendTargetLog("info", summary, message);
          }
          continue;
        }

        const changes: string[] = [];
        if (ipv4Changed) {
          changes.push(
            `IPv4: ${lastIP.ipv4 || "无"} -> ${scopedIPs.ipv4 || "无"}`,
          );
        }
        if (ipv6Changed) {
          changes.push(
            `IPv6: ${lastIP.ipv6 || "无"} -> ${scopedIPs.ipv6 || "无"}`,
          );
        }
        await ddnsManager.appendTargetLog(
          "info",
          summary,
          `${triggerLabel}: 检测到目标 IP 变化: ${changes.join(", ")}`,
        );

        const result = await ddnsManager.executeTargetUpdate(
          target,
          ips.ipv4,
          ips.ipv6,
        );
        await emitDDNSUpdateCompletedEvent({
          trigger,
          targetId: target.id,
          targetName: summary.name,
          domainSummary: summary.domainSummary,
          isPrimary: target.isPrimary,
          provider: target.provider,
          success: result.success,
          message: result.message,
          updateScope,
          ipSource: ips.source,
          previousIpv4: lastIP.ipv4,
          previousIpv6: lastIP.ipv6,
          nextIpv4: scopedIPs.ipv4,
          nextIpv6: scopedIPs.ipv6,
        });

        if (result.success) {
          const message = `${triggerLabel}: DNS 更新成功 [${target.provider}]: ${result.message}`;
          await ddnsManager.setTargetLastIP(
            target.id,
            scopedIPs.ipv4,
            scopedIPs.ipv6,
            {
              merge: true,
            },
          );
          await ddnsManager.setTargetLastCheck(target.id, "updated", message);
          await ddnsManager.appendTargetLog("info", summary, message);
          continue;
        }

        const message = `${triggerLabel}: DNS 更新失败 [${target.provider}]: ${result.message}`;
        await ddnsManager.setTargetLastCheck(target.id, "error", message);
        await ddnsManager.appendTargetLog("error", summary, message);
      } catch (error: any) {
        const message = `${triggerLabel}: 任务异常: ${error?.message || String(error)}`;
        console.error("[ddns][auto-check] error:", error);
        await ddnsManager.setTargetLastCheck(target.id, "error", message);
        await ddnsManager.appendTargetLog("error", summary, message);
      } finally {
        await refreshDDNSLock(lockToken).catch(() => undefined);
      }
    }
  } finally {
    await releaseDDNSLock(lockToken).catch(() => undefined);
  }
};
