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

const LEVEL_LABELS: Record<SystemEventEnvelope["level"], string> = {
  INFO: "信息",
  WARN: "注意",
  ERROR: "错误",
  CRITICAL: "严重",
};

const readPayloadValue = (event: SystemEventEnvelope, key: string) => {
  const payload = event.payload as Record<string, unknown>;
  const value = payload[key];
  if (value === undefined || value === null || value === "") return "";
  return String(value);
};

const formatEventSummary = (event: SystemEventEnvelope) => {
  switch (event.type) {
    case "FN_EVENT_AUTH_LOGIN_SUCCESS":
      return `${readPayloadValue(event, "credential_name") || "未知凭证"} 通过 ${readPayloadValue(event, "auth_method") || "-"} 登录，来源 ${readPayloadValue(event, "ip") || "-"}`;
    case "FN_EVENT_AUTH_LOGOUT":
      return `${readPayloadValue(event, "credential_name") || "未知凭证"} 已退出登录，会话 ${readPayloadValue(event, "session_id") || "-"}`;
    case "FN_EVENT_AUTH_LOGIN_FAILURE":
      return `IP ${readPayloadValue(event, "ip") || "-"} 在 1 小时内第 ${readPayloadValue(event, "attempts") || "-"} 次登录失败`;
    case "FN_EVENT_AUTH_SESSION_IP_DRIFT":
      return `会话 ${readPayloadValue(event, "session_id") || "-"} 从 ${readPayloadValue(event, "from_ip") || "-"} 漂移到 ${readPayloadValue(event, "to_ip") || "-"}`;
    case "FN_EVENT_SECURITY_SCANNER_BLOCKED":
      return `${readPayloadValue(event, "ip") || "-"} 因扫描命中 ${readPayloadValue(event, "hit_count") || "-"} 次被拦截`;
    case "FN_EVENT_DDNS_UPDATE_COMPLETED":
      return `${readPayloadValue(event, "provider") || "-"} ${readPayloadValue(event, "success") === "true" ? "更新成功" : "更新完成"}：${readPayloadValue(event, "message") || "-"}`;
    case "FN_EVENT_GATEWAY_THROTTLE_BLOCKED":
      return `${readPayloadValue(event, "ip") || "-"} 触发节流封锁 ${readPayloadValue(event, "block_seconds") || "-"} 秒`;
    case "FN_EVENT_SYSTEM_CPU_ALERT":
    case "FN_EVENT_SYSTEM_CPU_RECOVERED":
    case "FN_EVENT_SYSTEM_MEMORY_ALERT":
    case "FN_EVENT_SYSTEM_MEMORY_RECOVERED":
      return `${readPayloadValue(event, "hostname") || "-"} 使用率 ${readPayloadValue(event, "usage_percent") || "-"}%`;
    default:
      return JSON.stringify(event.payload);
  }
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
  const eventLabel = formatNotificationEventLabel(args.event.type);
  const levelLabel = LEVEL_LABELS[args.event.level] || args.event.level;
  const summary = formatEventSummary(args.event);
  const facts = [
    { label: "事件", value: eventLabel },
    { label: "级别", value: levelLabel },
    { label: "来源系统", value: args.event.source },
    { label: "发生时间", value: args.event.happened_at },
    { label: "规则", value: args.rule.name },
    { label: "聚合键", value: args.groupKey },
    { label: "窗口命中次数", value: String(args.matchedCount) },
    { label: "事件 ID", value: args.event.id },
  ];

  const bodyLines = [
    `${levelLabel}事件已命中通知规则。`,
    `事件摘要：${summary}`,
    `规则：${args.rule.name}`,
    `聚合键：${args.groupKey}`,
    `窗口：${args.rule.window_seconds} 秒内达到 ${args.matchedCount} 次`,
    `事件 ID：${args.event.id}`,
  ];

  return {
    title:
      args.rule.threshold_count > 1
        ? `[${levelLabel}] ${eventLabel} 达到通知阈值`
        : `[${levelLabel}] ${eventLabel}`,
    summary,
    body_text: bodyLines.join("\n"),
    body_markdown: bodyLines.map((line) => `- ${line}`).join("\n"),
    severity: toSeverity(args.event),
    facts,
    actions: [],
    mentions: [],
    dedupe_key: `${args.rule.id}:${args.groupKey}`,
    occurred_at: args.event.happened_at,
    event_id: args.event.id,
    metadata: {
      event_type: args.event.type,
      event_level: args.event.level,
      event_source: args.event.source,
    },
  };
};
