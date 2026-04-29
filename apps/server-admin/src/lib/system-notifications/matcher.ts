import type { SystemEventEnvelope } from "../system-events/types";
import {
  FN_EVENT_AUTH_LOGIN_FAILURE,
  FN_EVENT_AUTH_LOGIN_SUCCESS,
  FN_EVENT_AUTH_LOGOUT,
  FN_EVENT_AUTH_SESSION_IP_DRIFT,
  FN_EVENT_DDNS_UPDATE_COMPLETED,
  FN_EVENT_GATEWAY_THROTTLE_BLOCKED,
  FN_EVENT_WAF_BLOCKED,
  FN_EVENT_SECURITY_SCANNER_BLOCKED,
  FN_EVENT_SSH_IP_BLOCKED,
  FN_EVENT_SSH_LOGIN_FAILURE,
  FN_EVENT_SSH_LOGIN_SUCCESS,
  FN_EVENT_SYSTEM_APP_UPDATE_AVAILABLE,
  FN_EVENT_SYSTEM_CPU_ALERT,
  FN_EVENT_SYSTEM_CPU_RECOVERED,
  FN_EVENT_SYSTEM_MEMORY_ALERT,
  FN_EVENT_SYSTEM_MEMORY_RECOVERED,
  FN_EVENT_TUNNEL_CLOUDFLARED_CONNECTED,
  FN_EVENT_TUNNEL_CLOUDFLARED_DISCONNECTED,
  FN_EVENT_TUNNEL_FRP_CONNECTED,
  FN_EVENT_TUNNEL_FRP_DISCONNECTED,
} from "../system-events/constants";
import type { NotificationGroupBy, NotificationRule } from "./types";

export const DEFAULT_NOTIFICATION_GROUP_BY: Record<
  SystemEventEnvelope["type"],
  NotificationGroupBy
> = {
  [FN_EVENT_AUTH_LOGIN_SUCCESS]: "GLOBAL",
  [FN_EVENT_AUTH_LOGOUT]: "GLOBAL",
  [FN_EVENT_AUTH_LOGIN_FAILURE]: "IP",
  [FN_EVENT_AUTH_SESSION_IP_DRIFT]: "SESSION",
  [FN_EVENT_SECURITY_SCANNER_BLOCKED]: "IP",
  [FN_EVENT_DDNS_UPDATE_COMPLETED]: "SUBJECT",
  [FN_EVENT_GATEWAY_THROTTLE_BLOCKED]: "IP",
  [FN_EVENT_WAF_BLOCKED]: "IP",
  [FN_EVENT_SSH_LOGIN_SUCCESS]: "IP",
  [FN_EVENT_SSH_LOGIN_FAILURE]: "IP",
  [FN_EVENT_SSH_IP_BLOCKED]: "IP",
  [FN_EVENT_SYSTEM_APP_UPDATE_AVAILABLE]: "SUBJECT",
  [FN_EVENT_SYSTEM_CPU_ALERT]: "HOSTNAME",
  [FN_EVENT_SYSTEM_CPU_RECOVERED]: "HOSTNAME",
  [FN_EVENT_SYSTEM_MEMORY_ALERT]: "HOSTNAME",
  [FN_EVENT_SYSTEM_MEMORY_RECOVERED]: "HOSTNAME",
  [FN_EVENT_TUNNEL_FRP_CONNECTED]: "SUBJECT",
  [FN_EVENT_TUNNEL_FRP_DISCONNECTED]: "SUBJECT",
  [FN_EVENT_TUNNEL_CLOUDFLARED_CONNECTED]: "SUBJECT",
  [FN_EVENT_TUNNEL_CLOUDFLARED_DISCONNECTED]: "SUBJECT",
};

const readPayloadText = (event: SystemEventEnvelope, ...keys: string[]) => {
  const payload = event.payload as Record<string, unknown>;
  for (const key of keys) {
    const raw = payload[key];
    if (raw === undefined || raw === null || raw === "") continue;
    return String(raw).trim();
  }
  return "";
};

export const eventMatchesNotificationRule = (
  event: SystemEventEnvelope,
  rule: NotificationRule,
) => {
  if (!rule.enabled) return false;
  if (event.type !== rule.event_type) return false;
  if (
    rule.event_level_filter?.length &&
    !rule.event_level_filter.includes(event.level)
  ) {
    return false;
  }
  if (
    rule.event_source_filter?.length &&
    !rule.event_source_filter.includes(event.source)
  ) {
    return false;
  }
  return true;
};

export const buildNotificationGroupKey = (
  event: SystemEventEnvelope,
  groupBy: NotificationGroupBy,
) => {
  switch (groupBy) {
    case "GLOBAL":
      return "global";
    case "IP":
      return (
        readPayloadText(event, "ip", "to_ip", "from_ip") ||
        (event.subject?.kind === "IP" ? event.subject.id : "") ||
        "missing:ip"
      );
    case "SESSION":
      return (
        readPayloadText(event, "session_id") ||
        (event.subject?.kind === "SESSION" ? event.subject.id : "") ||
        "missing:session"
      );
    case "SUBJECT":
      return event.subject?.id || "missing:subject";
    case "HOSTNAME":
      return (
        readPayloadText(event, "hostname") ||
        (event.subject?.kind === "RESOURCE" ? event.subject.id : "") ||
        "missing:hostname"
      );
    case "PROVIDER":
      return (
        readPayloadText(event, "provider") ||
        (event.subject?.kind === "DDNS" ? event.subject.id : "") ||
        "missing:provider"
      );
    default:
      return "global";
  }
};

export const getRecommendedGroupByForEventType = (
  type: SystemEventEnvelope["type"],
) => DEFAULT_NOTIFICATION_GROUP_BY[type] || "GLOBAL";
