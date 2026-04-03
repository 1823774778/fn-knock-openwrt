import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationProviderType,
  NotificationProviderView,
  NotificationSchemaField,
  NotificationSendResult,
} from "./types";

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
    description: "可选，例如 {\"X-Env\":\"prod\"}。",
    placeholder: "{\"X-Env\":\"prod\"}",
    type: "json",
  },
  {
    key: "extra_body_json",
    label: "额外请求体 JSON",
    description: "可选，会挂到 payload.extra_body。",
    placeholder: "{\"service\":\"gateway\"}",
    type: "json",
  },
];

const WEBHOOK_DEFINITION: NotificationProviderDefinition = {
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

const PUSHDEER_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "server_url",
    label: "服务地址",
    description:
      "官方在线版保持默认值即可；如果你使用自建 PushDeer，则填写自建服务根地址。",
    placeholder: "https://api2.pushdeer.com",
    type: "string",
    required: true,
    default_value: "https://api2.pushdeer.com",
  },
  {
    key: "pushkey",
    label: "PushKey",
    description:
      "PushDeer 客户端中生成的 PushKey。可填写多个 key，并用英文逗号分隔。",
    placeholder: "PDUxxxx,PDUyyyy",
    type: "string",
    required: true,
    sensitive: true,
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
];

const PUSHDEER_TARGET_SCHEMA: NotificationSchemaField[] = [];

const PUSHDEER_DEFINITION: NotificationProviderDefinition = {
  type: "pushdeer",
  label: "PushDeer",
  description:
    "通过 PushDeer 官方在线版或自建服务向已绑定设备发送 Markdown 通知。",
  connection_schema: PUSHDEER_CONNECTION_SCHEMA,
  target_schema: PUSHDEER_TARGET_SCHEMA,
  sensitive_fields: ["pushkey"],
  capabilities: {
    supports_text: true,
    supports_markdown: true,
    supports_rich_blocks: false,
    supports_actions: true,
    supports_mentions: false,
    supports_attachments: false,
    supports_provider_dedupe_key: false,
    max_body_length: null,
  },
};

const PROVIDER_DEFINITIONS: Record<
  NotificationProviderType,
  NotificationProviderDefinition
> = {
  webhook: WEBHOOK_DEFINITION,
  pushdeer: PUSHDEER_DEFINITION,
};

const truncateText = (value: string, limit = 500) =>
  value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;

const maskSensitiveValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    return value.length <= 8 ? "********" : `${value.slice(0, 2)}******`;
  }
  return "[configured]";
};

const toPlainRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
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

const sendWebhookMessage = async (args: {
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

const buildPushDeerMarkdownBody = (message: NotificationMessage) => {
  const sections: string[] = [];

  if (message.summary?.trim()) {
    sections.push(message.summary.trim());
  }

  if (message.body_markdown?.trim()) {
    sections.push(message.body_markdown.trim());
  } else if (message.body_text?.trim()) {
    sections.push(
      message.body_text
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (message.facts.length > 0) {
    sections.push(
      message.facts
        .map((fact) => `- **${fact.label}**：${fact.value}`)
        .join("\n"),
    );
  }

  if (message.actions.length > 0) {
    sections.push(
      message.actions
        .map((action) => `- [${action.label}](${action.url})`)
        .join("\n"),
    );
  }

  return sections.filter(Boolean).join("\n\n");
};

const resolvePushDeerUrl = (provider: NotificationProvider) => {
  const baseUrl = String(
    provider.connection_config.server_url || "https://api2.pushdeer.com",
  ).trim();
  const normalizedBaseUrl = baseUrl || "https://api2.pushdeer.com";
  return `${normalizedBaseUrl.replace(/\/+$/, "")}/message/push`;
};

const sendPushDeerMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const url = resolvePushDeerUrl(args.provider);
  const pushkey = String(args.provider.connection_config.pushkey || "").trim();
  if (!pushkey) {
    return {
      success: false,
      retryable: false,
      reason: "Missing PushDeer pushkey",
    };
  }

  const body = new URLSearchParams({
    pushkey,
    text: args.message.title || args.message.summary || "fn-knock 通知",
    desp: buildPushDeerMarkdownBody(args.message),
    type: "markdown",
  });

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, args.timeoutSeconds) * 1000,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let parsedResponse:
      | {
          code?: number;
          content?: unknown;
          error?: string;
        }
      | null = null;
    try {
      parsedResponse = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedResponse = null;
    }

    const requestSummary = {
      method: "POST",
      url,
      pushkey_count: pushkey
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean).length,
      type: "markdown",
      title_preview: args.message.title,
    };
    const responseSummary = {
      status: response.status,
      ok: response.ok,
      code: parsedResponse?.code,
      error: parsedResponse?.error,
      body_preview: truncateText(responseText),
    };

    if (!response.ok) {
      return {
        success: false,
        retryable: response.status >= 500 || response.status === 429,
        reason: `PushDeer returned ${response.status}`,
        request_summary: requestSummary,
        response_summary: responseSummary,
      };
    }

    if ((parsedResponse?.code ?? 0) !== 0) {
      return {
        success: false,
        retryable: false,
        reason:
          parsedResponse?.error ||
          `PushDeer API returned code ${String(parsedResponse?.code ?? "unknown")}`,
        request_summary: requestSummary,
        response_summary: responseSummary,
      };
    }

    return {
      success: true,
      retryable: false,
      request_summary: requestSummary,
      response_summary: responseSummary,
    };
  } catch (error) {
    return {
      success: false,
      retryable: true,
      reason:
        error instanceof Error ? error.message : "PushDeer request failed",
      request_summary: {
        method: "POST",
        url,
        type: "markdown",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const listNotificationProviderDefinitions = () =>
  Object.values(PROVIDER_DEFINITIONS);

export const getNotificationProviderDefinition = (
  type: string,
): NotificationProviderDefinition | null =>
  PROVIDER_DEFINITIONS[type as NotificationProviderType] || null;

export const maskNotificationProvider = (
  provider: NotificationProvider,
): NotificationProviderView => {
  const definition = getNotificationProviderDefinition(provider.type);
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(provider.connection_config)) {
    masked[key] = definition?.sensitive_fields.includes(key)
      ? maskSensitiveValue(value)
      : value;
  }

  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    enabled: provider.enabled,
    created_at: provider.created_at,
    updated_at: provider.updated_at,
    last_test_at: provider.last_test_at,
    last_test_status: provider.last_test_status,
    last_error: provider.last_error,
    connection_config_masked: masked,
  };
};

export const sendNotificationWithProvider = async (
  provider: NotificationProvider,
  message: NotificationMessage,
  context?: Partial<NotificationDispatchContext>,
  timeoutSeconds = 5,
): Promise<NotificationSendResult> => {
  switch (provider.type) {
    case "webhook":
      return sendWebhookMessage({
        provider,
        message,
        context,
        timeoutSeconds,
      });
    case "pushdeer":
      return sendPushDeerMessage({
        provider,
        message,
        timeoutSeconds,
      });
    default:
      return {
        success: false,
        retryable: false,
        reason: `Unsupported notification provider type: ${provider.type}`,
      };
  }
};
