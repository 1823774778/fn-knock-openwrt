import type {
  NotificationDeliveryStatus,
  NotificationGroupBy,
  SystemEventLevel,
  SystemEventSource,
  SystemEventType,
} from "../../types";

export const SYSTEM_EVENT_TYPE_OPTIONS: Array<{
  value: SystemEventType;
  label: string;
}> = [
  { value: "FN_EVENT_AUTH_LOGIN_SUCCESS", label: "登录成功" },
  { value: "FN_EVENT_AUTH_LOGOUT", label: "退出登录" },
  { value: "FN_EVENT_AUTH_LOGIN_FAILURE", label: "登录失败" },
  { value: "FN_EVENT_AUTH_SESSION_IP_DRIFT", label: "会话 IP 漂移" },
  { value: "FN_EVENT_SECURITY_SCANNER_BLOCKED", label: "扫描器拦截" },
  { value: "FN_EVENT_DDNS_UPDATE_COMPLETED", label: "DDNS 更新" },
  { value: "FN_EVENT_GATEWAY_THROTTLE_BLOCKED", label: "网关节流封锁" },
  { value: "FN_EVENT_WAF_BLOCKED", label: "WAF 阻断" },
  { value: "FN_EVENT_SSH_LOGIN_SUCCESS", label: "SSH 登录成功" },
  { value: "FN_EVENT_SSH_LOGIN_FAILURE", label: "SSH 登录失败" },
  { value: "FN_EVENT_SSH_IP_BLOCKED", label: "SSH IP 封锁" },
  { value: "FN_EVENT_SYSTEM_APP_UPDATE_AVAILABLE", label: "应用更新提示" },
  { value: "FN_EVENT_SYSTEM_CPU_ALERT", label: "CPU 告警" },
  { value: "FN_EVENT_SYSTEM_CPU_RECOVERED", label: "CPU 恢复" },
  { value: "FN_EVENT_SYSTEM_MEMORY_ALERT", label: "内存告警" },
  { value: "FN_EVENT_SYSTEM_MEMORY_RECOVERED", label: "内存恢复" },
  { value: "FN_EVENT_TUNNEL_FRP_CONNECTED", label: "FRP 已连上" },
  { value: "FN_EVENT_TUNNEL_FRP_DISCONNECTED", label: "FRP 已断开" },
  {
    value: "FN_EVENT_TUNNEL_CLOUDFLARED_CONNECTED",
    label: "Cloudflared 已连上",
  },
  {
    value: "FN_EVENT_TUNNEL_CLOUDFLARED_DISCONNECTED",
    label: "Cloudflared 已断开",
  },
];

export const SYSTEM_EVENT_TYPE_FILTER_OPTIONS: Array<{
  value: SystemEventType | "all";
  label: string;
}> = [{ value: "all", label: "全部事件" }, ...SYSTEM_EVENT_TYPE_OPTIONS];

export const SYSTEM_EVENT_LEVEL_OPTIONS: Array<{
  value: SystemEventLevel;
  label: string;
}> = [
  { value: "INFO", label: "信息" },
  { value: "WARN", label: "注意" },
  { value: "ERROR", label: "错误" },
  { value: "CRITICAL", label: "严重" },
];

export const SYSTEM_EVENT_LEVEL_FILTER_OPTIONS: Array<{
  value: SystemEventLevel | "all";
  label: string;
}> = [{ value: "all", label: "全部级别" }, ...SYSTEM_EVENT_LEVEL_OPTIONS];

export const SYSTEM_EVENT_SOURCE_OPTIONS: Array<{
  value: SystemEventSource;
  label: string;
}> = [
  { value: "SERVER_ADMIN", label: "管理后台" },
  { value: "GO_REAUTH_PROXY", label: "认证代理" },
  { value: "SYSTEM_MONITOR", label: "系统监控" },
];

export const SYSTEM_EVENT_SOURCE_FILTER_OPTIONS: Array<{
  value: SystemEventSource | "all";
  label: string;
}> = [{ value: "all", label: "全部系统" }, ...SYSTEM_EVENT_SOURCE_OPTIONS];

export const NOTIFICATION_GROUP_BY_OPTIONS: Array<{
  value: NotificationGroupBy;
  label: string;
}> = [
  { value: "GLOBAL", label: "全局" },
  { value: "IP", label: "IP" },
  { value: "SESSION", label: "会话" },
  { value: "SUBJECT", label: "主题对象" },
  { value: "HOSTNAME", label: "主机名" },
  { value: "PROVIDER", label: "提供商" },
];

export const DEFAULT_GROUP_BY_BY_EVENT_TYPE: Record<
  SystemEventType,
  NotificationGroupBy
> = {
  FN_EVENT_AUTH_LOGIN_SUCCESS: "GLOBAL",
  FN_EVENT_AUTH_LOGOUT: "GLOBAL",
  FN_EVENT_AUTH_LOGIN_FAILURE: "IP",
  FN_EVENT_AUTH_SESSION_IP_DRIFT: "SESSION",
  FN_EVENT_SECURITY_SCANNER_BLOCKED: "IP",
  FN_EVENT_DDNS_UPDATE_COMPLETED: "PROVIDER",
  FN_EVENT_GATEWAY_THROTTLE_BLOCKED: "IP",
  FN_EVENT_WAF_BLOCKED: "IP",
  FN_EVENT_SSH_LOGIN_SUCCESS: "IP",
  FN_EVENT_SSH_LOGIN_FAILURE: "IP",
  FN_EVENT_SSH_IP_BLOCKED: "IP",
  FN_EVENT_SYSTEM_APP_UPDATE_AVAILABLE: "SUBJECT",
  FN_EVENT_SYSTEM_CPU_ALERT: "HOSTNAME",
  FN_EVENT_SYSTEM_CPU_RECOVERED: "HOSTNAME",
  FN_EVENT_SYSTEM_MEMORY_ALERT: "HOSTNAME",
  FN_EVENT_SYSTEM_MEMORY_RECOVERED: "HOSTNAME",
  FN_EVENT_TUNNEL_FRP_CONNECTED: "SUBJECT",
  FN_EVENT_TUNNEL_FRP_DISCONNECTED: "SUBJECT",
  FN_EVENT_TUNNEL_CLOUDFLARED_CONNECTED: "SUBJECT",
  FN_EVENT_TUNNEL_CLOUDFLARED_DISCONNECTED: "SUBJECT",
};

export const NOTIFICATION_DELIVERY_STATUS_OPTIONS: Array<{
  value: NotificationDeliveryStatus | "all";
  label: string;
}> = [
  { value: "all", label: "全部状态" },
  { value: "queued", label: "排队中" },
  { value: "sending", label: "发送中" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败待重试" },
  { value: "gave_up", label: "失败放弃" },
  { value: "skipped", label: "已跳过" },
];

export const formatSystemEventTypeLabel = (type: SystemEventType) =>
  SYSTEM_EVENT_TYPE_OPTIONS.find((item) => item.value === type)?.label || type;

export const formatSystemEventLevelLabel = (level: SystemEventLevel) =>
  SYSTEM_EVENT_LEVEL_OPTIONS.find((item) => item.value === level)?.label ||
  level;

export const formatSystemEventSourceLabel = (source: SystemEventSource) =>
  SYSTEM_EVENT_SOURCE_OPTIONS.find((item) => item.value === source)?.label ||
  source;

export const formatNotificationGroupByLabel = (value: NotificationGroupBy) =>
  NOTIFICATION_GROUP_BY_OPTIONS.find((item) => item.value === value)?.label ||
  value;

export const formatDeliveryStatusLabel = (value: NotificationDeliveryStatus) =>
  NOTIFICATION_DELIVERY_STATUS_OPTIONS.find((item) => item.value === value)
    ?.label || value;
