import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationSchemaField,
  NotificationSendResult,
} from "../types";
import { toPlainRecord, truncateText } from "./shared";

const WEBHOOK_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "url",
    label: "Webhook URL",
    description: "接收标准通知 JSON 的目标地址。",
    placeholder: "https://example.com/hooks/fn-knock",
    type: "string",
    required: true,
    sensitive: true,
  },
  {
    key: "method",
    label: "请求方法",
    type: "select",
    required: true,
    default_value: "POST",
    options: [
      { label: "POST", value: "POST" },
      { label: "PUT", value: "PUT" },
    ],
  },
  {
    key: "timeout_seconds",
    label: "超时秒数",
    type: "number",
    required: true,
    default_value: 5,
    min: 1,
    max: 30,
  },
  {
    key: "shared_secret",
    label: "共享密钥",
    description: "可选。若填写，会通过 X-Fn-Knock-Signature 请求头发送。",
    placeholder: "secret",
    type: "string",
    sensitive: true,
  },
];

const WEBHOOK_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "endpoint_path",
    label: "附加路径",
    description: "可选。将拼接到基础 Webhook URL 后发送。",
    placeholder: "/alerts",
    type: "string",
  },
  {
    key: "extra_headers_json",
    label: "额外请求头 JSON",
    description: '可选，例如 {"X-Env":"prod"}。',
    placeholder: '{"X-Env":"prod"}',
    type: "json",
  },
  {
    key: "extra_body_json",
    label: "额外请求体 JSON",
    description: "可选，会挂到 payload.extra_body。",
    placeholder: '{"service":"gateway"}',
    type: "json",
  },
];

export const webhookProviderDefinition: NotificationProviderDefinition = {
  type: "webhook",
  label: "Webhook",
  description: "向任意支持 HTTP JSON 的地址发送标准通知消息。",
  connection_schema: WEBHOOK_CONNECTION_SCHEMA,
  target_schema: WEBHOOK_TARGET_SCHEMA,
  sensitive_fields: ["url", "shared_secret"],
  capabilities: {
    supports_text: true,
    supports_markdown: true,
    supports_rich_blocks: false,
    supports_actions: true,
    supports_mentions: true,
    supports_attachments: false,
    supports_provider_dedupe_key: true,
    max_body_length: null,
  },
};

const resolveWebhookUrl = (
  provider: NotificationProvider,
  context?: Partial<NotificationDispatchContext>,
) => {
  const baseUrl = String(provider.connection_config.url || "").trim();
  if (!baseUrl) {
    throw new Error("Missing webhook url");
  }

  const endpointPath = String(
    context?.target?.target_config.endpoint_path || "",
  ).trim();
  if (!endpointPath) return baseUrl;

  try {
    return new URL(endpointPath, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${endpointPath.replace(/^\/+/, "")}`;
  }
};

export const sendWebhookMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const url = resolveWebhookUrl(args.provider, args.context);
  const method = String(args.provider.connection_config.method || "POST")
    .trim()
    .toUpperCase();
  const sharedSecret = String(
    args.provider.connection_config.shared_secret || "",
  ).trim();
  const targetHeaders = toPlainRecord(
    args.context?.target?.target_config.extra_headers_json,
  );
  const extraBody = toPlainRecord(
    args.context?.target?.target_config.extra_body_json,
  );
  const headers = Object.entries(targetHeaders).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (value === undefined || value === null || value === "") return acc;
      acc[key] = String(value);
      return acc;
    },
    {
      "content-type": "application/json",
      "x-fn-knock-provider": "webhook",
    },
  );
  if (sharedSecret) {
    headers["x-fn-knock-signature"] = sharedSecret;
  }

  const body = {
    source: "fn_knock",
    provider_type: "webhook",
    message: args.message,
    context: args.context
      ? {
          trigger_id: args.context.trigger?.id,
          delivery_id: args.context.delivery?.id,
          rule_id: args.context.rule?.id,
          target_id: args.context.target?.id,
          event_id: args.context.event?.id,
        }
      : {
          mode: "provider_test",
        },
    payload: {
      extra_body: extraBody,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, args.timeoutSeconds) * 1000,
  );

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    const responseSummary = {
      status: response.status,
      ok: response.ok,
      body_preview: truncateText(responseText),
    };
    const requestSummary = {
      method,
      url,
      header_names: Object.keys(headers),
      body_preview: {
        title: args.message.title,
        severity: args.message.severity,
        event_id: args.message.event_id,
      },
    };

    if (response.ok) {
      return {
        success: true,
        retryable: false,
        request_summary: requestSummary,
        response_summary: responseSummary,
      };
    }

    return {
      success: false,
      retryable: response.status >= 500 || response.status === 429,
      reason: `Webhook returned ${response.status}`,
      request_summary: requestSummary,
      response_summary: responseSummary,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Webhook request failed";
    return {
      success: false,
      retryable: true,
      reason,
      request_summary: {
        method,
        url,
        header_names: Object.keys(headers),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};
