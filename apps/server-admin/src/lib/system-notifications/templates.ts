import type { SystemEventEnvelope } from "../system-events/types";
import type {
  NotificationMessage,
  NotificationRule,
  NotificationSeverity,
} from "./types";

const EVENT_LABELS: Record<SystemEventEnvelope["type"], string> = {
  FN_EVENT_AUTH_LOGIN_SUCCESS: "登录成功",
  FN_EVENT_AUTH_LOGOUT: "退出登录",
  FN_EVENT_AUTH_LOGIN_FAILURE: "登录失败",
  FN_EVENT_AUTH_SESSION_IP_DRIFT: "会话 IP 漂移",
  FN_EVENT_SECURITY_SCANNER_BLOCKED: "扫描器拦截",
  FN_EVENT_DDNS_UPDATE_COMPLETED: "DDNS 更新",
  FN_EVENT_GATEWAY_THROTTLE_BLOCKED: "网关节流封锁",
  FN_EVENT_SYSTEM_CPU_ALERT: "CPU 告警",
  FN_EVENT_SYSTEM_CPU_RECOVERED: "CPU 恢复",
  FN_EVENT_SYSTEM_MEMORY_ALERT: "内存告警",
  FN_EVENT_SYSTEM_MEMORY_RECOVERED: "内存恢复",
};

export const formatNotificationEventLabel = (
  type: SystemEventEnvelope["type"],
) => EVENT_LABELS[type] || type;

export const buildNotificationRuleName = (type: SystemEventEnvelope["type"]) =>
  `${formatNotificationEventLabel(type)} 通知`;

const readPayloadValue = (event: SystemEventEnvelope, key: string) => {
  const payload = event.payload as Record<string, unknown>;
  const value = payload[key];
  if (value === undefined || value === null || value === "") return "";
  return String(value);
};

const joinCompactParts = (...parts: Array<string | undefined>) =>
  parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" | ");

const formatEventSummary = (event: SystemEventEnvelope) => {
  switch (event.type) {
    case "FN_EVENT_AUTH_LOGIN_SUCCESS":
      return joinCompactParts(
        readPayloadValue(event, "credential_name") || "未知凭证",
        readPayloadValue(event, "ip"),
      );
    case "FN_EVENT_AUTH_LOGOUT":
      return joinCompactParts(
        readPayloadValue(event, "credential_name") || "未知凭证",
        readPayloadValue(event, "ip"),
      );
    case "FN_EVENT_AUTH_LOGIN_FAILURE":
      return joinCompactParts(
        readPayloadValue(event, "ip"),
        readPayloadValue(event, "attempts")
          ? `${readPayloadValue(event, "attempts")}次失败`
          : "",
      );
    case "FN_EVENT_AUTH_SESSION_IP_DRIFT":
      return [
        readPayloadValue(event, "from_ip"),
        readPayloadValue(event, "to_ip"),
      ]
        .filter(Boolean)
        .join(" -> ");
    case "FN_EVENT_SECURITY_SCANNER_BLOCKED":
      return joinCompactParts(
        readPayloadValue(event, "ip"),
        readPayloadValue(event, "hit_count")
          ? `${readPayloadValue(event, "hit_count")}次扫描`
          : "扫描拦截",
      );
    case "FN_EVENT_DDNS_UPDATE_COMPLETED":
      return joinCompactParts(
        readPayloadValue(event, "provider"),
        readPayloadValue(event, "success") === "true" ? "成功" : "失败",
      );
    case "FN_EVENT_GATEWAY_THROTTLE_BLOCKED":
      return joinCompactParts(
        readPayloadValue(event, "ip"),
        readPayloadValue(event, "block_seconds")
          ? `封锁${readPayloadValue(event, "block_seconds")}s`
          : "触发封锁",
      );
    case "FN_EVENT_SYSTEM_CPU_ALERT":
    case "FN_EVENT_SYSTEM_CPU_RECOVERED":
    case "FN_EVENT_SYSTEM_MEMORY_ALERT":
    case "FN_EVENT_SYSTEM_MEMORY_RECOVERED":
      return joinCompactParts(
        readPayloadValue(event, "hostname"),
        readPayloadValue(event, "usage_percent")
          ? `${readPayloadValue(event, "usage_percent")}%`
          : "",
      );
    default:
      return "";
  }
};

const buildNotificationTitle = (
  event: SystemEventEnvelope,
  matchedCount: number,
) => {
  const baseTitle =
    event.type === "FN_EVENT_DDNS_UPDATE_COMPLETED"
      ? readPayloadValue(event, "success") === "true"
        ? "DDNS 更新成功"
        : "DDNS 更新失败"
      : formatNotificationEventLabel(event.type);

  return matchedCount > 1 ? `${baseTitle} x${matchedCount}` : baseTitle;
};

const toSeverity = (event: SystemEventEnvelope): NotificationSeverity => {
  switch (event.level) {
    case "INFO":
      return "info";
    case "WARN":
      return "warn";
    case "ERROR":
      return "error";
    case "CRITICAL":
      return "critical";
    default:
      return "info";
  }
};

export const buildNotificationMessage = (args: {
  event: SystemEventEnvelope;
  rule: NotificationRule;
  matchedCount: number;
  groupKey: string;
}): NotificationMessage => {
  const summary =
    formatEventSummary(args.event) ||
    formatNotificationEventLabel(args.event.type);

  return {
    title: buildNotificationTitle(args.event, args.matchedCount),
    summary,
    body_text: "",
    body_markdown: "",
    severity: toSeverity(args.event),
    facts: [],
    actions: [],
    mentions: [],
    dedupe_key: `${args.rule.id}:${args.groupKey}`,
    occurred_at: args.event.happened_at,
    event_id: args.event.id,
    metadata: {
      event_type: args.event.type,
      event_level: args.event.level,
      event_source: args.event.source,
      rule_id: args.rule.id,
      rule_name: args.rule.name,
      group_key: args.groupKey,
      matched_count: args.matchedCount,
      window_seconds: args.rule.window_seconds,
      threshold_count: args.rule.threshold_count,
    },
  };
};
