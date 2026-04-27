export type SSHSecurityBlockDurationUnit = "minute" | "hour" | "day";

export interface SSHSecuritySelection {
  province: string;
  city: string | null;
  label: string;
  value: string;
  query_city: string | null;
  is_province_wide: boolean;
  is_municipality: boolean;
}

export interface SSHSecurityConfig {
  enabled: boolean;
  window_minutes: number;
  failed_login_threshold: number;
  block_duration_value: number;
  block_duration_unit: SSHSecurityBlockDurationUnit;
  allowed_regions: SSHSecuritySelection[];
  custom_cidrs: string[];
  configured_at: string | null;
  updated_at: string | null;
}

export interface SSHSecurityRuntimeState {
  enabled: boolean;
  allowed_cidrs: string[];
  updated_at: string | null;
}

export type SSHSecurityBlockReason =
  | "failed_login_threshold"
  | "cidr_not_allowed";

export type SSHSecurityBlockRemoveReason = "manual" | "expired" | "disabled";

export interface SSHSecurityBlockRecord {
  ip: string;
  ipLocation?: string;
  ports?: number[];
  blocked_at: string;
  expires_at: string;
  reason: SSHSecurityBlockReason;
  failed_count: number;
  window_minutes: number;
  threshold: number;
  sample_user?: string;
  sample_auth_method?: string;
  sample_log_time?: string;
  applied: boolean;
  removed_at?: string | null;
  remove_reason?: SSHSecurityBlockRemoveReason | null;
}

export type SSHLoginOutcome = "success" | "failure";

export interface SSHLoginLogEntry {
  id: string;
  happened_at: string;
  outcome: SSHLoginOutcome;
  username: string;
  invalid_user: boolean;
  ip: string;
  ipLocation?: string;
  port?: number;
  related_ports?: number[];
  repeat_count?: number;
  auth_method?: string;
  service: "sshd";
  source: "journal" | "auth.log";
  raw: string;
}

export type SSHLogSourceKind = "journal" | "auth.log" | "unavailable";

export interface SSHSecurityAvailability {
  available: boolean;
  reason: string;
  log_source: SSHLogSourceKind;
}

export interface SSHSecuritySummary {
  configured: boolean;
  enabled: boolean;
  allowed_cidr_count: number;
  active_block_count: number;
  ssh_ports: number[];
  log_source: SSHLogSourceKind;
  available: boolean;
  unavailable_reason: string;
  updated_at: string | null;
}

export interface SSHSecurityDetails {
  config: SSHSecurityConfig;
  summary: SSHSecuritySummary;
}

export interface SSHLoginLogListResult {
  items: SSHLoginLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface SSHSecurityBlockListResult {
  items: SSHSecurityBlockRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface SSHSecurityFirewallSyncResult {
  cleared: number;
  synced: number;
  active_blocks: number;
  allowed_cidrs: number;
  ports: number[];
}

export interface SSHSecurityFirewallClearResult {
  cleared_blocks: number;
}
