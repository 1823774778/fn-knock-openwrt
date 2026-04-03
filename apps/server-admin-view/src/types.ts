export interface ProxyMapping {
  path: string;
  target: string;
  rewrite_html: boolean;
  use_auth: boolean;
  use_root_mode: boolean;
  strip_path: boolean;
}

export type RunType = 0 | 1 | 3;
export type ReverseProxySubmode = "path" | "subdomain";

export type HostAccessMode = "login_first" | "strict_whitelist";
export type HostServiceRole = "app" | "auth";
export type StreamMappingProtocol = "tcp" | "udp";

export interface HostMapping {
  host: string;
  target: string;
  use_auth: boolean;
  access_mode: HostAccessMode;
  suppress_toolbar: boolean;
  preserve_host: boolean;
  service_role: HostServiceRole;
  title: string;
  title_override: string;
  favicon: string;
}

export interface HostMappingRefreshSummary {
  updated: number;
  failed: number;
  skipped: number;
}

export interface UrlMetadataPreview {
  title: string;
  favicon: string;
  finalUrl: string;
}

export interface StreamMapping {
  protocol: StreamMappingProtocol;
  listen_port: number;
  target: string;
  use_auth: boolean;
}

export type PasskeyRpMode = "auth_host" | "parent_domain";
export type PostLoginIpGrantMode = "follow_session" | "disabled" | "custom";

export interface SubdomainModeConfig {
  root_domain: string;
  auth_host: string;
  auth_target: string;
  cookie_domain: string;
  public_auth_base_url: string;
  auth_cache_ttl_seconds: number;
  auth_cache_unauthorized_ttl_seconds: number;
  default_access_mode: HostAccessMode;
  auto_add_whitelist_on_login: boolean;
  passkey_rp_mode: PasskeyRpMode;
  passkey_rp_id?: string;
}

export interface SSLConfig {
  id?: string;
  label?: string;
  source?: SSLCertificateSource;
  primary_domain?: string;
  cert: string;
  key: string;
  activate?: boolean;
}

export interface SSLCertInfo {
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  dnsNames: string[];
  serialNumber: string;
}

export type SSLDeploymentMode = "single_active" | "multi_sni";
export type SSLCertificateSource = "manual" | "acme" | "ca";

export interface SubdomainCertificateCoverage {
  status: "ready" | "partial" | "missing";
  auth_host?: string;
  certificate_domains: string[];
  recommended_domains: string[];
  covered_recommended_domains: string[];
  uncovered_recommended_domains: string[];
  covered_hosts: string[];
  uncovered_hosts: string[];
  covers_auth_host: boolean;
  warnings: string[];
  summary: string;
}

export interface SubdomainCertificateLibraryCoverage {
  status: "ready" | "partial" | "missing";
  deployment_mode: SSLDeploymentMode;
  active_certificate_id?: string;
  fully_covering_certificate_ids: string[];
  partially_covering_certificate_ids: string[];
  combined_covering_certificate_ids: string[];
  suggested_certificate_id?: string;
  can_auto_activate: boolean;
  warnings: string[];
  summary: string;
}

export interface SSLCertificateSummary {
  id: string;
  label: string;
  source: SSLCertificateSource;
  primary_domain?: string;
  created_at: string;
  updated_at: string;
  certInfo?: SSLCertInfo;
  is_active: boolean;
  coverage?: SubdomainCertificateCoverage;
}

export interface SSLStatus {
  enabled: boolean;
  activeCertId?: string;
  deploymentMode: SSLDeploymentMode;
  configuredDeploymentMode?: SSLDeploymentMode;
  certInfo?: SSLCertInfo;
  certificates: SSLCertificateSummary[];
  subdomain_coverage?: SubdomainCertificateCoverage;
  library_coverage?: SubdomainCertificateLibraryCoverage;
  gateway_status?: {
    enabled: boolean;
    deployment_mode: SSLDeploymentMode;
    certificates: Array<{
      id?: string;
      label?: string;
      domains?: string[];
      is_default?: boolean;
    }>;
    sync_error?: string;
  };
}

export interface SharedDataFileEntry {
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

export interface SSLSharedFilesPayload {
  shareName: string;
  available: boolean;
  files: SharedDataFileEntry[];
}

export interface FnosShareBypassConfig {
  enabled: boolean;
  upstream_timeout_ms: number;
  validation_cache_ttl_seconds: number;
  validation_lock_ttl_seconds: number;
  session_ttl_seconds: number;
}

export interface GatewayLoggingConfig {
  enabled: boolean;
  max_days: number;
  logs_dir: string;
}

export type IpLocationLookupStatus =
  | "idle"
  | "queued"
  | "processing"
  | "success"
  | "failed"
  | "skipped";

export interface IpLocationSnapshot {
  ip: string;
  normalizedIp: string;
  status: IpLocationLookupStatus;
  attempts: number;
  maxAttempts: number;
  location: string;
  error?: string;
  updatedAt: number;
}

export interface IpLocationBatchPayload {
  items: IpLocationSnapshot[];
}

export interface ProtocolMappingFeatureConfig {
  enabled: boolean;
}

export interface SmartConnectConfig {
  enabled: boolean;
  selected_ipv4: string;
}

export interface SmartConnectRuntimeState {
  selected_ipv4: string;
  synced_domains: string[];
  managed_rule_count: number;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export type DnsmasqInstallStatus =
  | "uninstalled"
  | "installing"
  | "installed"
  | "error";

export interface DnsmasqInstallState {
  status: DnsmasqInstallStatus;
  progress: number;
  message: string;
}

export interface DnsmasqStatus {
  installed: boolean;
  service_active: boolean;
  initialized: boolean;
  version: string;
  install_state: DnsmasqInstallState;
}

export interface SmartConnectAvailability {
  available: boolean;
  reason: string;
}

export interface SmartConnectLocalIpOption {
  label: string;
  value: string;
  interface: string;
}

export interface SmartConnectDetails {
  config: SmartConnectConfig;
  availability: SmartConnectAvailability;
  dnsmasq: DnsmasqStatus & {
    runtime: SmartConnectRuntimeState;
  };
  domains: string[];
  local_ip_options: SmartConnectLocalIpOption[];
}

export interface AuthCredentialSettings {
  session_ttl_seconds: number;
  remember_me_ttl_seconds: number;
  post_login_ip_grant_mode: PostLoginIpGrantMode;
  post_login_ip_grant_ttl_seconds: number | null;
}

export interface GatewayLogEntry {
  time?: string;
  level?: string;
  method?: string;
  scheme?: string;
  host?: string;
  path?: string;
  query?: string;
  request_uri?: string;
  protocol?: string;
  status: number;
  duration_ms: number;
  remote_ip?: string;
  remote_addr?: string;
  user_agent?: string;
  referer?: string;
  logged_in: boolean;
  auth_required: boolean;
  auth_decision?: string;
  access_mode?: string;
  route_type?: string;
  route_key?: string;
  upstream?: string;
  matched: boolean;
  bytes_in: number;
  bytes_out: number;
  tls: boolean;
  websocket: boolean;
  x_forwarded_for?: string;
  x_real_ip?: string;
  ipLocation?: string;
}

export interface GatewayLogDatesPayload {
  today: string;
  logs_dir: string;
  dates: string[];
}

export interface GatewayLogEntriesPayload {
  date: string;
  logs_dir: string;
  available_dates: string[];
  pagination: "page" | "cursor";
  page: number;
  limit: number;
  total: number;
  cursor?: string;
  next_cursor?: string;
  has_more: boolean;
  items: GatewayLogEntry[];
}

export interface GatewayLogDeletePayload {
  date: string;
  logs_dir: string;
  deleted: boolean;
  available_dates: string[];
}

export interface FnKnockBackupImportArchiveRequest {
  filename?: string;
  archive_base64: string;
}

export interface FnKnockBackupImportResult {
  cleared_keys: number;
  imported_keys: number;
  warnings: string[];
  synced_steps: string[];
}

export interface BackupDirectoryFilesPayload {
  shareName: string;
  available: boolean;
  files: SharedDataFileEntry[];
}

export interface FnKnockBackupExportToDirectoryResult {
  filename: string;
  relativePath: string;
  filePath: string;
  size: number;
  exportedAt: string;
}

export interface TerminalFeatureConfig {
  enabled: boolean;
  default_cwd: string;
  max_sessions: number;
  idle_timeout_seconds: number;
  resume_backend: "tmux";
  allow_mobile_toolbar: boolean;
  dangerously_run_as_current_user: boolean;
}

export type TerminalTmuxDetectionSource = "env-path" | "absolute-path";
export type TerminalTmuxInstallStatus =
  | "uninstalled"
  | "installing"
  | "installed"
  | "error";

export interface TerminalTmuxInstallState {
  status: TerminalTmuxInstallStatus;
  progress: number;
  message: string;
  executablePath: string;
  detectionSource: TerminalTmuxDetectionSource | null;
  version: string;
}

export type TerminalTransport = "http-polling";
export type TerminalSessionStatus =
  | "created"
  | "attached"
  | "detached"
  | "stopped"
  | "error";

export interface TerminalSessionRecord {
  id: string;
  title: string;
  status: TerminalSessionStatus;
  created_at: string;
  updated_at: string;
  last_attached_at: string;
  last_detached_at: string;
  last_client_ip: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  resume_backend: "tmux";
  backend_session_name: string;
  pane_tty_path: string;
  input_pipe_path: string;
  output_log_path: string;
  expires_at: string;
  last_frame_revision?: string;
}

export interface TerminalAttachmentRecord {
  id: string;
  session_id: string;
  transport: TerminalTransport;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface TerminalOutputChunk {
  cursor: number;
  data_base64: string;
  reset: boolean;
  updatedAt: string;
}

export interface TerminalRuntimeStatus {
  enabled: boolean;
  tmuxAvailable: boolean;
  tmuxExecutablePath: string;
  tmuxDetectionSource: TerminalTmuxDetectionSource | null;
  tmuxVersion: string;
  tmuxInstallState: TerminalTmuxInstallState;
  httpPollingAvailable: boolean;
  runningAsRoot: boolean;
  blockedReason: string;
}

export interface AppConfig {
  run_type: RunType;
  reverse_proxy_submode: ReverseProxySubmode;
  auto_manage_firewall: boolean;
  whitelist_ips: string[];
  default_route: string;
  proxy_mappings: ProxyMapping[];
  host_mappings: HostMapping[];
  stream_mappings: StreamMapping[];
  subdomain_mode: SubdomainModeConfig;
  default_tunnel?: "frp" | "cloudflared";
  fnos_share_bypass?: FnosShareBypassConfig;
  gateway_logging?: GatewayLoggingConfig;
  reverse_proxy_throttle?: ReverseProxyThrottleConfig;
  gateway_proxy_headers?: GatewayProxyHeadersConfig;
  protocol_mapping_feature?: ProtocolMappingFeatureConfig;
  smart_connect?: SmartConnectConfig;
  auth_credential_settings?: AuthCredentialSettings;
  terminal_feature?: TerminalFeatureConfig;
  ssl: {
    enabled: boolean;
    active_cert_id?: string;
    deployment_mode?: SSLDeploymentMode;
    certificate_count?: number;
  };
  login: {
    nonce_list: string[];
    ip_backoff: Record<string, number>;
  };
}

export type TOTPCredential = {
  id: string;
  secret: string;
  comment: string;
  createdAt: string;
};

export type PasskeyCredential = {
  id: string;
  totpId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceName: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type LoginSession = {
  totpId: string;
  method: "TOTP" | "PASSKEY";
  credentialId: string;
  credentialName: string;
  comment?: string;
  ip: string;
  userAgent: string;
  loginTime: string;
  expiresAt?: string;
  ipLocation?: string;
};

export type SessionMobilitySummary = {
  hasHistory: boolean;
  driftCount: number;
  lastDriftAt: string | null;
  lastDriftSource:
    | "proxy-session"
    | "fnos-token"
    | "session-refresh"
    | "browser-session"
    | null;
};

export type SessionMobilityEvent =
  | {
      version: 1;
      kind: "login";
      happenedAt: string;
      source: "login";
      toIp: string;
      toIpLocation?: string;
    }
  | {
      version: 1;
      kind: "drift";
      happenedAt: string;
      source:
        | "proxy-session"
        | "fnos-token"
        | "session-refresh"
        | "browser-session";
      fromIp: string;
      fromIpLocation?: string;
      toIp: string;
      toIpLocation?: string;
    };

export type SessionMobilityDetails = {
  summary: SessionMobilitySummary;
  events: SessionMobilityEvent[];
};

export type SessionFnosAttachmentRecord = {
  subjectHash: string;
  currentIp: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string | null;
};

export type SessionRecord = LoginSession & {
  id: string;
  mobility?: SessionMobilitySummary;
  fnosAttachments?: SessionFnosAttachmentRecord[];
};

export type ProxyProtocolForce = {
  proxy_protocol_force: boolean;
};

export type ReverseProxyThrottleConfig = {
  enabled: boolean;
  requests_per_second: number;
  burst: number;
  block_seconds: number;
};

export type GatewayVisibilitySelection = {
  province: string;
  city: string | null;
  label: string;
  value: string;
  query_city: string | null;
  is_province_wide: boolean;
  is_municipality: boolean;
};

export type GatewayVisibilitySummary = {
  enabled: boolean;
  selection_count: number;
  custom_cidr_count: number;
  cidr_count: number;
  updated_at: string | null;
};

export type GatewayVisibilityConfig = {
  enabled: boolean;
  selections: GatewayVisibilitySelection[];
  custom_cidrs: string[];
};

export type GatewayVisibilityDetails = {
  config: GatewayVisibilityConfig;
  summary: GatewayVisibilitySummary;
};

export type GatewayProxyHeadersConfig = {
  disabled_hosts: string[];
};

export type GatewayProxyHeadersItem = {
  host: string;
  target: string;
  title: string;
  send_proxy_headers: boolean;
};

export type GatewayProxyHeadersAvailability = {
  available: boolean;
  reason: string;
};

export type GatewayProxyHeadersSummary = {
  total_count: number;
  disabled_count: number;
  updated_at: string | null;
};

export type GatewayProxyHeadersDetails = {
  config: GatewayProxyHeadersConfig;
  availability: GatewayProxyHeadersAvailability;
  items: GatewayProxyHeadersItem[];
  summary: GatewayProxyHeadersSummary;
};

export type GatewaySettings = {
  auth_cache_ttl_seconds: number;
  auth_cache_unauthorized_ttl_seconds: number;
  reverse_proxy_throttle: ReverseProxyThrottleConfig;
  visibility: GatewayVisibilitySummary;
  proxy_headers: GatewayProxyHeadersSummary;
};

export type TrafficStats = {
  total_in: number;
  total_out: number;
  active_conns: number;
  error_5xx: number;
  timestamp: number;
};

export type DashboardStats = {
  rangeSec: number;
  now: {
    online: number | null;
    error5xxTotal: number | null;
  };
  totals: {
    inBytes: number;
    outBytes: number;
    error5xx: number;
  };
  errors: {
    error5xx1d: number;
    error5xx1w: number;
  };
  traffic: {
    echarts: unknown;
  };
};

export type ThreatOverview = {
  rangeSec: number;
  totals: {
    failedLogins: number;
    blockedScanners: number;
  };
  series: {
    failedLogins: Array<[number, number]>;
    blockedScanners: Array<[number, number]>;
  };
};

export type SystemEventType =
  | "FN_EVENT_AUTH_LOGIN_SUCCESS"
  | "FN_EVENT_AUTH_LOGOUT"
  | "FN_EVENT_AUTH_LOGIN_FAILURE"
  | "FN_EVENT_AUTH_SESSION_IP_DRIFT"
  | "FN_EVENT_SECURITY_SCANNER_BLOCKED"
  | "FN_EVENT_DDNS_UPDATE_COMPLETED"
  | "FN_EVENT_GATEWAY_THROTTLE_BLOCKED"
  | "FN_EVENT_SYSTEM_CPU_ALERT"
  | "FN_EVENT_SYSTEM_CPU_RECOVERED"
  | "FN_EVENT_SYSTEM_MEMORY_ALERT"
  | "FN_EVENT_SYSTEM_MEMORY_RECOVERED";

export type SystemEventLevel = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export type SystemEventSource =
  | "SERVER_ADMIN"
  | "GO_REAUTH_PROXY"
  | "SYSTEM_MONITOR";

export type SystemEventSubjectKind = "IP" | "SESSION" | "DDNS" | "RESOURCE";

export interface SystemEventSubject {
  kind: SystemEventSubjectKind;
  id: string;
}

export interface SystemEventRecord {
  id: string;
  type: SystemEventType;
  source: SystemEventSource;
  level: SystemEventLevel;
  happened_at: string;
  dedupe_key?: string;
  subject?: SystemEventSubject;
  tags?: string[];
  payload: Record<string, unknown>;
}

export interface SystemEventListPayload {
  events: SystemEventRecord[];
  total: number;
}

export type NotificationProviderType = "webhook" | "pushdeer";

export type NotificationGroupBy =
  | "GLOBAL"
  | "IP"
  | "SESSION"
  | "SUBJECT"
  | "HOSTNAME"
  | "PROVIDER";

export type NotificationTriggerStatus =
  | "created"
  | "fanout_done"
  | "partially_failed"
  | "completed";

export type NotificationDeliveryStatus =
  | "queued"
  | "sending"
  | "success"
  | "failed"
  | "gave_up"
  | "skipped";

export type NotificationTestStatus = "idle" | "success" | "failed";

export type NotificationMessageTemplateMode = "default" | "custom";

export type NotificationTemplateOverrideMode = "inherit" | "custom";

export type NotificationSeverity = "info" | "warn" | "error" | "critical";

export type NotificationFieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "json";

export interface NotificationFieldOption {
  label: string;
  value: string;
}

export interface NotificationSchemaField {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  type: NotificationFieldType;
  required?: boolean;
  sensitive?: boolean;
  default_value?: string | number | boolean | null;
  options?: NotificationFieldOption[];
  min?: number;
  max?: number;
}

export interface NotificationProviderCapabilities {
  supports_text: boolean;
  supports_markdown: boolean;
  supports_rich_blocks: boolean;
  supports_actions: boolean;
  supports_mentions: boolean;
  supports_attachments: boolean;
  supports_provider_dedupe_key: boolean;
  max_body_length?: number | null;
}

export interface NotificationProviderDefinition {
  type: NotificationProviderType;
  label: string;
  description: string;
  connection_schema: NotificationSchemaField[];
  target_schema: NotificationSchemaField[];
  sensitive_fields: string[];
  capabilities: NotificationProviderCapabilities;
}

export interface NotificationMessageFact {
  label: string;
  value: string;
}

export interface NotificationMessageAction {
  label: string;
  url: string;
}

export interface NotificationMessage {
  title: string;
  summary: string;
  body_text: string;
  body_markdown?: string;
  severity: NotificationSeverity;
  facts: NotificationMessageFact[];
  actions: NotificationMessageAction[];
  mentions: string[];
  dedupe_key?: string;
  occurred_at: string;
  event_id?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationTemplate {
  title?: string;
  body_text?: string;
  body_markdown?: string;
}

export interface NotificationDeliveryPolicy {
  timeout_seconds?: number;
  max_attempts?: number;
  backoff_seconds?: number;
}

export interface NotificationProviderView {
  id: string;
  name: string;
  type: NotificationProviderType;
  enabled: boolean;
  connection_config_masked: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_test_at?: string;
  last_test_status?: NotificationTestStatus;
  last_error?: string | null;
}

export interface NotificationTargetBinding {
  id: string;
  provider_id: string;
  enabled: boolean;
  target_config: Record<string, unknown>;
  template_override_mode: NotificationTemplateOverrideMode;
  template_override?: NotificationTemplate | null;
  delivery_policy?: NotificationDeliveryPolicy | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  event_type: SystemEventType;
  event_level_filter?: SystemEventLevel[];
  event_source_filter?: SystemEventSource[];
  window_seconds: number;
  threshold_count: number;
  group_by: NotificationGroupBy;
  cooldown_seconds: number;
  targets: NotificationTargetBinding[];
  message_template_mode: NotificationMessageTemplateMode;
  message_template?: NotificationTemplate | null;
  created_at: string;
  updated_at: string;
  last_triggered_at?: string | null;
}

export interface NotificationTrigger {
  id: string;
  rule_id: string;
  event_id: string;
  group_key: string;
  matched_count: number;
  message_snapshot: NotificationMessage;
  rule_snapshot: NotificationRule;
  status: NotificationTriggerStatus;
  created_at: string;
}

export interface NotificationDelivery {
  id: string;
  trigger_id: string;
  rule_id: string;
  target_id: string;
  provider_id: string;
  event_id: string;
  status: NotificationDeliveryStatus;
  reason?: string | null;
  provider_type: NotificationProviderType;
  message_snapshot: NotificationMessage;
  target_snapshot: NotificationTargetBinding;
  provider_snapshot: NotificationProviderView;
  request_summary?: Record<string, unknown> | null;
  response_summary?: Record<string, unknown> | null;
  attempt_count: number;
  triggered_at: string;
  sent_at?: string | null;
  next_retry_at?: string | null;
}

export interface NotificationProviderCatalogPayload {
  providers: NotificationProviderDefinition[];
}

export interface NotificationProviderListPayload {
  providers: NotificationProviderView[];
}

export interface NotificationRuleListPayload {
  rules: NotificationRule[];
}

export interface NotificationTriggerListPayload {
  triggers: NotificationTrigger[];
  total: number;
}

export interface NotificationDeliveryListPayload {
  deliveries: NotificationDelivery[];
  total: number;
}

export const CIDR_PROVINCE_WIDE_VALUE = "__province_all__";

export interface CidrProvinceItem {
  name: string;
  cityCount: number;
  isMunicipality: boolean;
  hasChildren: boolean;
}

export interface CidrProvinceOption {
  label: string;
  value: string;
  cityCount: number;
  isMunicipality: boolean;
}

export interface CidrProvincesPayload {
  items: CidrProvinceItem[];
  options: CidrProvinceOption[];
  total: number;
}

export interface CidrCityItem {
  name: string;
  ipv4Count: number;
  ipv6Count: number;
}

export interface CidrCityOption {
  label: string;
  value: string;
  queryCity: string | null;
  isProvinceWide: boolean;
  isMunicipality: boolean;
  ipv4Count: number;
  ipv6Count: number;
}

export interface CidrCitiesPayload {
  province: string;
  items: CidrCityItem[];
  options: CidrCityOption[];
  total: number;
  isMunicipality: boolean;
  supportsProvinceWide: boolean;
  defaultValue: string;
}

export interface CidrSelectorPayload {
  provinces: CidrProvincesPayload;
  cities: CidrCitiesPayload | null;
}

export interface CidrSelectionPayload {
  province: string;
  city: string | null;
  label: string;
  value: string;
  queryCity: string | null;
  isProvinceWide: boolean;
  isMunicipality: boolean;
}

export interface CidrLookupPayload {
  province: string;
  city: string | null;
  selection: CidrSelectionPayload;
  cidrGroups: {
    ipv4: string[];
    ipv6: string[];
  };
  counts: {
    ipv4: number;
    ipv6: number;
  };
  totalCount: number;
}
