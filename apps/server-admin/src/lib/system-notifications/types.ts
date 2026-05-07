import type { SystemEventEnvelope } from "../system-events/types";
import type {
  SystemEventLevel,
  SystemEventSource,
  SystemEventType,
} from "../system-events/constants";

export const NOTIFICATION_PROVIDER_TYPES = [
  "wxpusher",
  "serverchan",
  "pushplus",
  "wecom",
  "dingtalk",
  "feishu",
  "email",
  "webhook",
  "pushdeer",
  "magicpush",
  "bark",
  "telegram",
] as const;
export type NotificationProviderType =
  (typeof NOTIFICATION_PROVIDER_TYPES)[number];

export const NOTIFICATION_GROUP_BY_VALUES = [
  "GLOBAL",
  "IP",
  "SESSION",
  "SUBJECT",
  "HOSTNAME",
  "PROVIDER",
] as const;
export type NotificationGroupBy = (typeof NOTIFICATION_GROUP_BY_VALUES)[number];

export const NOTIFICATION_TRIGGER_STATUSES = [
  "created",
  "fanout_done",
  "partially_failed",
  "completed",
] as const;
export type NotificationTriggerStatus =
  (typeof NOTIFICATION_TRIGGER_STATUSES)[number];

export const NOTIFICATION_DELIVERY_STATUSES = [
  "queued",
  "sending",
  "success",
  "failed",
  "gave_up",
  "skipped",
] as const;
export type NotificationDeliveryStatus =
  (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const NOTIFICATION_TEST_STATUSES = [
  "idle",
  "success",
  "failed",
] as const;
export type NotificationTestStatus =
  (typeof NOTIFICATION_TEST_STATUSES)[number];

export const NOTIFICATION_MESSAGE_TEMPLATE_MODES = [
  "default",
  "custom",
] as const;
export type NotificationMessageTemplateMode =
  (typeof NOTIFICATION_MESSAGE_TEMPLATE_MODES)[number];

export const NOTIFICATION_TEMPLATE_OVERRIDE_MODES = [
  "inherit",
  "custom",
] as const;
export type NotificationTemplateOverrideMode =
  (typeof NOTIFICATION_TEMPLATE_OVERRIDE_MODES)[number];

export const NOTIFICATION_SEVERITIES = [
  "info",
  "warn",
  "error",
  "critical",
] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "select",
  "json",
] as const;
export type NotificationFieldType = (typeof NOTIFICATION_FIELD_TYPES)[number];

export type NotificationFieldOption = {
  label: string;
  value: string;
};

export type NotificationSchemaField = {
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
};

export type NotificationProviderCapabilities = {
  supports_text: boolean;
  supports_markdown: boolean;
  supports_rich_blocks: boolean;
  supports_actions: boolean;
  supports_mentions: boolean;
  supports_attachments: boolean;
  supports_provider_dedupe_key: boolean;
  max_body_length?: number | null;
};

export type NotificationProviderDefinition = {
  type: NotificationProviderType;
  label: string;
  description: string;
  connection_schema: NotificationSchemaField[];
  target_schema: NotificationSchemaField[];
  sensitive_fields: string[];
  capabilities: NotificationProviderCapabilities;
};

export type NotificationMessageFact = {
  label: string;
  value: string;
};

export type NotificationMessageAction = {
  label: string;
  url: string;
};

export type NotificationMessage = {
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
};

export type NotificationTemplate = {
  title?: string;
  body_text?: string;
  body_markdown?: string;
};

export type NotificationDeliveryPolicy = {
  timeout_seconds?: number;
  max_attempts?: number;
  backoff_seconds?: number;
};

export type NotificationProvider = {
  id: string;
  name: string;
  type: NotificationProviderType;
  enabled: boolean;
  connection_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_test_at?: string;
  last_test_status?: NotificationTestStatus;
  last_error?: string | null;
};

export type NotificationProviderView = Omit<
  NotificationProvider,
  "connection_config"
> & {
  connection_config_masked: Record<string, unknown>;
};

export type NotificationProviderDetailView = NotificationProviderView & {
  connection_config: Record<string, unknown>;
};

export type NotificationTargetBinding = {
  id: string;
  provider_id: string;
  enabled: boolean;
  target_config: Record<string, unknown>;
  template_override_mode: NotificationTemplateOverrideMode;
  template_override?: NotificationTemplate | null;
  delivery_policy?: NotificationDeliveryPolicy | null;
  created_at: string;
  updated_at: string;
};

export type NotificationRule = {
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
};

export type NotificationTrigger = {
  id: string;
  rule_id: string;
  event_id: string;
  group_key: string;
  matched_count: number;
  message_snapshot: NotificationMessage;
  rule_snapshot: NotificationRule;
  status: NotificationTriggerStatus;
  created_at: string;
};

export type NotificationDelivery = {
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
};

export type NotificationDispatchContext = {
  trigger: NotificationTrigger;
  delivery: NotificationDelivery;
  rule: NotificationRule;
  target: NotificationTargetBinding;
  provider: NotificationProvider;
  event: SystemEventEnvelope;
  effective_delivery_policy: Required<NotificationDeliveryPolicy>;
};

export type NotificationSendResult = {
  success: boolean;
  retryable: boolean;
  reason?: string;
  request_summary?: Record<string, unknown>;
  response_summary?: Record<string, unknown>;
};

export type NotificationDeliveryListQuery = {
  page: number;
  limit: number;
  rule_id?: string;
  provider_id?: string;
  status?: NotificationDeliveryStatus;
  trigger_id?: string;
};

export type NotificationDeliveryClearQuery = {
  rule_id?: string;
  provider_id?: string;
  status?: NotificationDeliveryStatus;
  trigger_id?: string;
};

export type NotificationTriggerListQuery = {
  page: number;
  limit: number;
  rule_id?: string;
  status?: NotificationTriggerStatus;
};

export type NotificationDeliveryListResult = {
  deliveries: NotificationDelivery[];
  total: number;
};

export type NotificationTriggerListResult = {
  triggers: NotificationTrigger[];
  total: number;
};

export type NotificationProviderUpsertInput = {
  name?: string;
  type?: string;
  enabled?: boolean;
  connection_config?: Record<string, unknown>;
};

export type NotificationProviderDraftTestInput =
  NotificationProviderUpsertInput & {
    id?: string;
  };

export type NotificationRuleUpsertTargetInput = {
  id?: string;
  provider_id: string;
  enabled?: boolean;
  target_config?: Record<string, unknown>;
  template_override_mode?: string;
  template_override?: NotificationTemplate | null;
  delivery_policy?: NotificationDeliveryPolicy | null;
};

export type NotificationRuleUpsertInput = {
  name?: string;
  enabled?: boolean;
  event_type?: string;
  event_level_filter?: string[];
  event_source_filter?: string[];
  window_seconds?: number;
  threshold_count?: number;
  group_by?: string;
  cooldown_seconds?: number;
  targets?: NotificationRuleUpsertTargetInput[];
  message_template_mode?: string;
  message_template?: NotificationTemplate | null;
};
