import type { EventSystemConfig } from "../redis";
import {
  FN_EVENT_AUTH_LOGIN_FAILURE,
  FN_EVENT_AUTH_LOGIN_SUCCESS,
  FN_EVENT_AUTH_LOGOUT,
  FN_EVENT_AUTH_SESSION_IP_DRIFT,
  FN_EVENT_DDNS_UPDATE_COMPLETED,
  FN_EVENT_GATEWAY_THROTTLE_BLOCKED,
  FN_EVENT_WAF_BLOCKED,
  FN_EVENT_SSH_IP_BLOCKED,
  FN_EVENT_SSH_LOGIN_FAILURE,
  FN_EVENT_SSH_LOGIN_SUCCESS,
  FN_EVENT_LEVEL_ERROR,
  FN_EVENT_LEVEL_INFO,
  FN_EVENT_LEVEL_WARN,
  FN_EVENT_SECURITY_SCANNER_BLOCKED,
  FN_EVENT_SYSTEM_APP_UPDATE_AVAILABLE,
  FN_EVENT_SYSTEM_CPU_ALERT,
  FN_EVENT_SYSTEM_CPU_RECOVERED,
  FN_EVENT_SYSTEM_MEMORY_ALERT,
  FN_EVENT_SYSTEM_MEMORY_RECOVERED,
  FN_EVENT_TUNNEL_CLOUDFLARED_CONNECTED,
  FN_EVENT_TUNNEL_CLOUDFLARED_DISCONNECTED,
  FN_EVENT_TUNNEL_FRP_CONNECTED,
  FN_EVENT_TUNNEL_FRP_DISCONNECTED,
  type SystemEventLevel,
  type SystemEventType,
} from "./constants";

export const isSystemEventTypeEnabled = (
  config: EventSystemConfig,
  type: SystemEventType,
): boolean => {
  if (!config.enabled) return false;

  switch (type) {
    case FN_EVENT_AUTH_LOGIN_SUCCESS:
    case FN_EVENT_AUTH_LOGOUT:
      return true;
    case FN_EVENT_AUTH_LOGIN_FAILURE:
      return config.rules.login_failure.enabled;
    case FN_EVENT_AUTH_SESSION_IP_DRIFT:
      return config.rules.ip_drift.enabled;
    case FN_EVENT_SECURITY_SCANNER_BLOCKED:
      return config.rules.scanner_blocked.enabled;
    case FN_EVENT_DDNS_UPDATE_COMPLETED:
      return config.rules.ddns_update.enabled;
    case FN_EVENT_GATEWAY_THROTTLE_BLOCKED:
      return config.rules.gateway_throttle_block.enabled;
    case FN_EVENT_WAF_BLOCKED:
      return config.rules.waf_blocked.enabled;
    case FN_EVENT_SSH_LOGIN_SUCCESS:
      return config.rules.ssh_login_success.enabled;
    case FN_EVENT_SSH_LOGIN_FAILURE:
      return config.rules.ssh_login_failure.enabled;
    case FN_EVENT_SSH_IP_BLOCKED:
      return config.rules.ssh_ip_blocked.enabled;
    case FN_EVENT_SYSTEM_APP_UPDATE_AVAILABLE:
      return config.rules.app_update_available.enabled;
    case FN_EVENT_SYSTEM_CPU_ALERT:
    case FN_EVENT_SYSTEM_CPU_RECOVERED:
      return config.rules.cpu_alert.enabled;
    case FN_EVENT_SYSTEM_MEMORY_ALERT:
    case FN_EVENT_SYSTEM_MEMORY_RECOVERED:
      return config.rules.memory_alert.enabled;
    case FN_EVENT_TUNNEL_FRP_CONNECTED:
    case FN_EVENT_TUNNEL_FRP_DISCONNECTED:
      return config.rules.frp_tunnel.enabled;
    case FN_EVENT_TUNNEL_CLOUDFLARED_CONNECTED:
    case FN_EVENT_TUNNEL_CLOUDFLARED_DISCONNECTED:
      return config.rules.cloudflared_tunnel.enabled;
    default:
      return false;
  }
};

export const getDefaultSystemEventLevel = (
  type: SystemEventType,
): SystemEventLevel => {
  switch (type) {
    case FN_EVENT_AUTH_LOGIN_SUCCESS:
    case FN_EVENT_AUTH_LOGOUT:
    case FN_EVENT_DDNS_UPDATE_COMPLETED:
    case FN_EVENT_SYSTEM_APP_UPDATE_AVAILABLE:
    case FN_EVENT_SYSTEM_CPU_RECOVERED:
    case FN_EVENT_SYSTEM_MEMORY_RECOVERED:
    case FN_EVENT_TUNNEL_FRP_CONNECTED:
    case FN_EVENT_TUNNEL_CLOUDFLARED_CONNECTED:
    case FN_EVENT_SSH_LOGIN_SUCCESS:
      return FN_EVENT_LEVEL_INFO;
    case FN_EVENT_SYSTEM_CPU_ALERT:
    case FN_EVENT_SYSTEM_MEMORY_ALERT:
      return FN_EVENT_LEVEL_WARN;
    case FN_EVENT_AUTH_LOGIN_FAILURE:
    case FN_EVENT_AUTH_SESSION_IP_DRIFT:
    case FN_EVENT_SECURITY_SCANNER_BLOCKED:
    case FN_EVENT_GATEWAY_THROTTLE_BLOCKED:
    case FN_EVENT_WAF_BLOCKED:
    case FN_EVENT_SSH_LOGIN_FAILURE:
    case FN_EVENT_SSH_IP_BLOCKED:
    case FN_EVENT_TUNNEL_FRP_DISCONNECTED:
    case FN_EVENT_TUNNEL_CLOUDFLARED_DISCONNECTED:
      return FN_EVENT_LEVEL_WARN;
    default:
      return FN_EVENT_LEVEL_ERROR;
  }
};
