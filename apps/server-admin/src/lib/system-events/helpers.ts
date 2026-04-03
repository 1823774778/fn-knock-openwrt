import type { DDNSIpSource, DDNSUpdateScope } from "../ddns/types";
import {
  FN_EVENT_AUTH_LOGIN_FAILURE,
  FN_EVENT_AUTH_LOGIN_SUCCESS,
  FN_EVENT_AUTH_LOGOUT,
  FN_EVENT_AUTH_SESSION_IP_DRIFT,
  FN_EVENT_DDNS_UPDATE_COMPLETED,
  FN_EVENT_LEVEL_ERROR,
  FN_EVENT_LEVEL_INFO,
  FN_EVENT_LEVEL_WARN,
  FN_EVENT_SECURITY_SCANNER_BLOCKED,
  FN_EVENT_SYSTEM_CPU_ALERT,
  FN_EVENT_SYSTEM_CPU_RECOVERED,
  FN_EVENT_SYSTEM_MEMORY_ALERT,
  FN_EVENT_SYSTEM_MEMORY_RECOVERED,
  SYSTEM_EVENT_SOURCE_SERVER_ADMIN,
  SYSTEM_EVENT_SOURCE_SYSTEM_MONITOR,
  SYSTEM_EVENT_SUBJECT_KIND_DDNS,
  SYSTEM_EVENT_SUBJECT_KIND_IP,
  SYSTEM_EVENT_SUBJECT_KIND_RESOURCE,
  SYSTEM_EVENT_SUBJECT_KIND_SESSION,
} from "./constants";
import { systemEventManager } from "./manager";
import type { AuthMethod, SystemEventSessionDriftSource } from "./types";

export const emitLoginSuccessEvent = async (payload: {
  sessionId: string;
  authMethod: AuthMethod;
  credentialId: string;
  credentialName: string;
  grantType: "browser_session" | "login_ip_grant";
  postLoginIpGrantMode?: "follow_session" | "disabled" | "custom" | null;
  whitelistRecordId?: string | null;
  ip: string;
  ipLocation?: string;
  userAgent: string;
  rememberMe: boolean;
  expiresAt: string;
}) =>
  systemEventManager.publishSafely({
    type: FN_EVENT_AUTH_LOGIN_SUCCESS,
    source: SYSTEM_EVENT_SOURCE_SERVER_ADMIN,
    subject: {
      kind: SYSTEM_EVENT_SUBJECT_KIND_SESSION,
      id: payload.sessionId,
    },
    payload: {
      session_id: payload.sessionId,
      auth_method: payload.authMethod,
      credential_id: payload.credentialId,
      credential_name: payload.credentialName,
      grant_type: payload.grantType,
      post_login_ip_grant_mode: payload.postLoginIpGrantMode,
      whitelist_record_id: payload.whitelistRecordId,
      ip: payload.ip,
      ...(payload.ipLocation ? { ip_location: payload.ipLocation } : {}),
      user_agent: payload.userAgent,
      remember_me: payload.rememberMe,
      expires_at: payload.expiresAt,
    },
  });

export const emitLogoutEvent = async (payload: {
  sessionId: string;
  authMethod: AuthMethod;
  credentialId: string;
  credentialName: string;
  ip: string;
  ipLocation?: string;
  userAgent: string;
  loginTime?: string;
  logoutSource: "user_logout" | "admin_session_delete";
}) =>
  systemEventManager.publishSafely({
    type: FN_EVENT_AUTH_LOGOUT,
    source: SYSTEM_EVENT_SOURCE_SERVER_ADMIN,
    level: FN_EVENT_LEVEL_INFO,
    subject: {
      kind: SYSTEM_EVENT_SUBJECT_KIND_SESSION,
      id: payload.sessionId,
    },
    payload: {
      session_id: payload.sessionId,
      auth_method: payload.authMethod,
      credential_id: payload.credentialId,
      credential_name: payload.credentialName,
      ip: payload.ip,
      ...(payload.ipLocation ? { ip_location: payload.ipLocation } : {}),
      user_agent: payload.userAgent,
      ...(payload.loginTime ? { login_time: payload.loginTime } : {}),
      logout_source: payload.logoutSource,
    },
  });

export const emitLoginFailureEvent = async (payload: {
  ip: string;
  attempts: number;
  retryAfterSeconds: number;
  blockedUntil?: string;
  method?: AuthMethod;
  credentialName?: string;
  userAgent?: string;
}) =>
  systemEventManager.publishSafely({
    type: FN_EVENT_AUTH_LOGIN_FAILURE,
    source: SYSTEM_EVENT_SOURCE_SERVER_ADMIN,
    level: FN_EVENT_LEVEL_WARN,
    subject: {
      kind: SYSTEM_EVENT_SUBJECT_KIND_IP,
      id: payload.ip,
    },
    payload: {
      ip: payload.ip,
      attempts: payload.attempts,
      retry_after_seconds: payload.retryAfterSeconds,
      ...(payload.blockedUntil ? { blocked_until: payload.blockedUntil } : {}),
      ...(payload.method ? { method: payload.method } : {}),
      ...(payload.credentialName
        ? { credential_name: payload.credentialName }
        : {}),
      ...(payload.userAgent ? { user_agent: payload.userAgent } : {}),
    },
  });

export const emitSessionIpDriftEvent = async (payload: {
  sessionId: string;
  driftSource: SystemEventSessionDriftSource;
  fromIp: string;
  fromIpLocation?: string;
  toIp: string;
  toIpLocation?: string;
  loginTime?: string;
}) =>
  systemEventManager.publishSafely({
    type: FN_EVENT_AUTH_SESSION_IP_DRIFT,
    source: SYSTEM_EVENT_SOURCE_SERVER_ADMIN,
    level: FN_EVENT_LEVEL_WARN,
    subject: {
      kind: SYSTEM_EVENT_SUBJECT_KIND_SESSION,
      id: payload.sessionId,
    },
    payload: {
      session_id: payload.sessionId,
      drift_source: payload.driftSource,
      from_ip: payload.fromIp,
      ...(payload.fromIpLocation
        ? { from_ip_location: payload.fromIpLocation }
        : {}),
      to_ip: payload.toIp,
      ...(payload.toIpLocation ? { to_ip_location: payload.toIpLocation } : {}),
      ...(payload.loginTime ? { login_time: payload.loginTime } : {}),
    },
  });

export const emitScannerBlockedEvent = async (payload: {
  ip: string;
  blockedAt: number;
  windowMinutes: number;
  threshold: number;
  hitCount: number;
  hits: Array<{
    path: string;
    createdAt: number;
  }>;
  ipLocation?: string;
}) =>
  systemEventManager.publishSafely({
    type: FN_EVENT_SECURITY_SCANNER_BLOCKED,
    source: SYSTEM_EVENT_SOURCE_SERVER_ADMIN,
    level: FN_EVENT_LEVEL_WARN,
    subject: {
      kind: SYSTEM_EVENT_SUBJECT_KIND_IP,
      id: payload.ip,
    },
    payload: {
      ip: payload.ip,
      blocked_at: new Date(payload.blockedAt).toISOString(),
      window_minutes: payload.windowMinutes,
      threshold: payload.threshold,
      hit_count: payload.hitCount,
      hits: payload.hits.map((hit) => ({
        path: hit.path,
        created_at: new Date(hit.createdAt).toISOString(),
      })),
      ...(payload.ipLocation ? { ip_location: payload.ipLocation } : {}),
    },
  });

export const emitDDNSUpdateCompletedEvent = async (payload: {
  trigger: "cron" | "enable" | "manual_test";
  provider: string;
  success: boolean;
  message: string;
  updateScope: DDNSUpdateScope;
  ipSource: DDNSIpSource;
  previousIpv4?: string | null;
  previousIpv6?: string | null;
  nextIpv4?: string | null;
  nextIpv6?: string | null;
}) =>
  systemEventManager.publishSafely({
    type: FN_EVENT_DDNS_UPDATE_COMPLETED,
    source: SYSTEM_EVENT_SOURCE_SERVER_ADMIN,
    level: payload.success ? FN_EVENT_LEVEL_INFO : FN_EVENT_LEVEL_ERROR,
    subject: {
      kind: SYSTEM_EVENT_SUBJECT_KIND_DDNS,
      id: payload.provider,
    },
    payload: {
      trigger: payload.trigger,
      provider: payload.provider,
      success: payload.success,
      message: payload.message,
      update_scope: payload.updateScope,
      ip_source: payload.ipSource,
      previous_ipv4: payload.previousIpv4 ?? null,
      previous_ipv6: payload.previousIpv6 ?? null,
      next_ipv4: payload.nextIpv4 ?? null,
      next_ipv6: payload.nextIpv6 ?? null,
    },
  });

export const emitResourceAlertEvent = async (payload: {
  metric: "cpu" | "memory";
  hostname: string;
  usagePercent: number;
  thresholdPercent: number;
  recoverPercent: number;
  sampleIntervalSeconds: number;
  sustainSeconds: number;
  recovered?: boolean;
  dedupeKey?: string;
  dedupeTtlSeconds?: number;
}) =>
  systemEventManager.publishSafely({
    type:
      payload.metric === "cpu"
        ? payload.recovered
          ? FN_EVENT_SYSTEM_CPU_RECOVERED
          : FN_EVENT_SYSTEM_CPU_ALERT
        : payload.recovered
          ? FN_EVENT_SYSTEM_MEMORY_RECOVERED
          : FN_EVENT_SYSTEM_MEMORY_ALERT,
    source: SYSTEM_EVENT_SOURCE_SYSTEM_MONITOR,
    subject: {
      kind: SYSTEM_EVENT_SUBJECT_KIND_RESOURCE,
      id: `${payload.hostname}:${payload.metric}`,
    },
    ...(payload.dedupeKey ? { dedupe_key: payload.dedupeKey } : {}),
    ...(payload.dedupeTtlSeconds
      ? { dedupe_ttl_seconds: payload.dedupeTtlSeconds }
      : {}),
    payload: {
      hostname: payload.hostname,
      usage_percent: payload.usagePercent,
      threshold_percent: payload.thresholdPercent,
      recover_percent: payload.recoverPercent,
      sample_interval_seconds: payload.sampleIntervalSeconds,
      sustain_seconds: payload.sustainSeconds,
    },
  });
