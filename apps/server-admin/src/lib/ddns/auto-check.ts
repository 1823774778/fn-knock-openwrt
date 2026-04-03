import { configManager } from "../redis";
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
const DDNS_UPDATE_LOCK_TTL_SECONDS = 120;

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

const recordSkippedCheck = async (message: string, emitLog: boolean) => {
  await ddnsManager.setLastCheck("skipped", message);
  if (emitLog) {
    await ddnsManager.appendLog("warn", message);
  }
};

export const runAutomaticDDNSCheck = async (
  options: RunAutomaticDDNSCheckOptions = {},
) => {
  const trigger = options.trigger ?? "cron";
  const triggerLabel = TRIGGER_LABELS[trigger];

  const enabled = await ddnsManager.isEnabled();
  if (!enabled) {
    return;
  }

  const acquired = await configManager.setLockIfNotExists(
    DDNS_UPDATE_LOCK_NAME,
    DDNS_UPDATE_LOCK_TTL_SECONDS,
  );
  if (!acquired) {
    return;
  }

  try {
    const provider = await ddnsManager.getProvider();
    if (!provider) {
      await recordSkippedCheck(
        `${triggerLabel}: 未选择 DDNS 提供商，已跳过`,
        options.emitSkipLog === true,
      );
      return;
    }

    const complete = await ddnsManager.isConfigComplete();
    if (!complete) {
      await recordSkippedCheck(
        `${triggerLabel}: 当前提供商配置不完整，已跳过`,
        options.emitSkipLog === true,
      );
      return;
    }

    const config = await ddnsManager.getConfig(provider);
    const updateScope = normalizeUpdateScope(config[DDNS_UPDATE_SCOPE_FIELD]);
    const ips = await resolveDDNSTargetIPs({
      updateScope,
      ipSource: config[DDNS_IP_SOURCE_FIELD],
      networkInterface: config[DDNS_NETWORK_INTERFACE_FIELD],
      interfaceIpv4Index: config[DDNS_INTERFACE_IPV4_INDEX_FIELD],
      interfaceIpv6Index: config[DDNS_INTERFACE_IPV6_INDEX_FIELD],
    });
    for (const warning of ips.warnings) {
      await ddnsManager.appendLog("warn", `${triggerLabel}: ${warning}`);
    }
    if (ips.source === "public" && !ips.ipv4 && !ips.ipv6) {
      const message = `${triggerLabel}: 无法获取公网 IP，已跳过`;
      await ddnsManager.setLastCheck("error", message);
      await ddnsManager.appendLog("error", message);
      return;
    }

    const scopedIPs = applyUpdateScope(updateScope, ips.ipv4, ips.ipv6);
    if (!scopedIPs.ipv4 && !scopedIPs.ipv6) {
      const message = `${triggerLabel}: ${getDDNSTargetIPUnavailableMessage(ips.source, updateScope)}，已跳过`;
      await ddnsManager.setLastCheck("skipped", message);
      await ddnsManager.appendLog("warn", message);
      return;
    }

    const lastIP = await ddnsManager.getLastIP();
    const ipv4Changed = !!scopedIPs.ipv4 && scopedIPs.ipv4 !== lastIP.ipv4;
    const ipv6Changed = !!scopedIPs.ipv6 && scopedIPs.ipv6 !== lastIP.ipv6;

    if (!ipv4Changed && !ipv6Changed) {
      const message = `${triggerLabel}: 目标 IP 未变化，无需更新`;
      await ddnsManager.setLastCheck("noop", message);
      if (options.emitNoopLog === true) {
        await ddnsManager.appendLog("info", message);
      }
      return;
    }

    const changes: string[] = [];
    if (ipv4Changed)
      changes.push(`IPv4: ${lastIP.ipv4 || "无"} -> ${scopedIPs.ipv4 || "无"}`);
    if (ipv6Changed)
      changes.push(`IPv6: ${lastIP.ipv6 || "无"} -> ${scopedIPs.ipv6 || "无"}`);
    await ddnsManager.appendLog(
      "info",
      `${triggerLabel}: 检测到目标 IP 变化: ${changes.join(", ")}`,
    );

    const result = await ddnsManager.executeUpdate(ips.ipv4, ips.ipv6);
    await emitDDNSUpdateCompletedEvent({
      trigger,
      provider,
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
      const message = `${triggerLabel}: DNS 更新成功 [${provider}]: ${result.message}`;
      await ddnsManager.setLastIP(scopedIPs.ipv4, scopedIPs.ipv6, {
        merge: true,
      });
      await ddnsManager.setLastCheck("updated", message);
      await ddnsManager.appendLog("info", message);
      return;
    }

    const message = `${triggerLabel}: DNS 更新失败 [${provider}]: ${result.message}`;
    await ddnsManager.setLastCheck("error", message);
    await ddnsManager.appendLog("error", message);
  } catch (e: any) {
    const message = `${triggerLabel}: 任务异常: ${e?.message || String(e)}`;
    console.error("[ddns][auto-check] error:", e?.message || String(e));
    await ddnsManager.setLastCheck("error", message);
    await ddnsManager.appendLog("error", message);
  }
};
