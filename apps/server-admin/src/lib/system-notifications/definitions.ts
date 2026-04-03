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

const BARK_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "server_url",
    label: "服务地址",
    description:
      "官方在线版保持默认值即可；如果你使用自建 Bark Server，则填写服务根地址。",
    placeholder: "https://api.day.app",
    type: "string",
    required: true,
    default_value: "https://api.day.app",
  },
  {
    key: "device_key",
    label: "Device Key",
    description:
      "Bark App 中复制的设备 Key。可填写多个 key，并用英文逗号分隔。",
    placeholder: "ynJ5Ft4atkMkWeo2PAvFhF",
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

const BARK_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "level",
    label: "通知级别",
    description:
      "active 为默认即时提醒；timeSensitive 可穿透专注模式；critical 为关键提醒。",
    type: "select",
    default_value: "active",
    options: [
      { label: "active", value: "active" },
      { label: "timeSensitive", value: "timeSensitive" },
      { label: "passive", value: "passive" },
      { label: "critical", value: "critical" },
    ],
  },
  {
    key: "group",
    label: "消息分组",
    description: "可选。相同分组会在 Bark 客户端内聚合展示。",
    placeholder: "fn-knock",
    type: "string",
  },
  {
    key: "sound",
    label: "提示音",
    description: "可选。填写 Bark 支持的系统或自定义提示音名称。",
    placeholder: "alarm",
    type: "string",
  },
  {
    key: "url",
    label: "点击跳转 URL",
    description:
      "可选。点击通知后打开的链接；未填写时会优先使用消息动作中的首个链接。",
    placeholder: "https://example.com/events/123",
    type: "string",
  },
  {
    key: "icon",
    label: "图标 URL",
    description: "可选。iOS 15 及以上可显示自定义图标。",
    placeholder: "https://day.app/assets/images/avatar.jpg",
    type: "string",
  },
  {
    key: "badge",
    label: "角标数字",
    description: "可选。显示在 Bark App 图标上的角标数字。",
    type: "number",
    min: 0,
    max: 99999,
  },
  {
    key: "call",
    label: "重复响铃",
    description: "启用后 Bark 会持续响铃约 30 秒。",
    type: "boolean",
    default_value: false,
  },
];

const BARK_DEFINITION: NotificationProviderDefinition = {
  type: "bark",
  label: "Bark",
  description:
    "通过 Bark 官方在线版或自建 Bark Server 向 iPhone 发送 APNs 推送通知。",
  connection_schema: BARK_CONNECTION_SCHEMA,
  target_schema: BARK_TARGET_SCHEMA,
  sensitive_fields: ["device_key"],
  capabilities: {
    supports_text: true,
    supports_markdown: false,
    supports_rich_blocks: false,
    supports_actions: true,
    supports_mentions: false,
    supports_attachments: false,
    supports_provider_dedupe_key: false,
    max_body_length: null,
  },
};

const TELEGRAM_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "server_url",
    label: "Bot API 地址",
    description:
      "官方 Bot API 保持默认值即可；如果由于网络因素无法访问官方地址，可以填写 https://tgapi.fnknock.cn 代为转发；如果你使用自建 Local Bot API Server，也可以填写其根地址。",
    placeholder: "https://api.telegram.org",
    type: "string",
    required: true,
    default_value: "https://api.telegram.org",
  },
  {
    key: "bot_token",
    label: "Bot Token",
    description: "通过 @BotFather 创建机器人后获取的 Bot Token。",
    placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    type: "string",
    required: true,
    sensitive: true,
  },
  {
    key: "chat_id",
    label: "Chat ID",
    description:
      "目标聊天 ID，或频道用户名（如 @channelusername）。可以先向 @UserIdzhBot 发送消息来获取 Chat ID；测试发送也会使用这个目标。",
    placeholder: "-1001234567890",
    type: "string",
    required: true,
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

const TELEGRAM_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "message_thread_id",
    label: "Topic ID",
    description:
      "可选。发送到群组话题时填写对应的话题 ID（message_thread_id）。",
    type: "number",
    min: 1,
  },
  {
    key: "disable_notification",
    label: "静默发送",
    description: "启用后 Telegram 会静默投递，不播放提示音。",
    type: "boolean",
    default_value: false,
  },
];

const TELEGRAM_DEFINITION: NotificationProviderDefinition = {
  type: "telegram",
  label: "Telegram",
  description:
    "通过 Telegram Bot API 向指定聊天或频道发送文本通知，并附带内联操作按钮。",
  connection_schema: TELEGRAM_CONNECTION_SCHEMA,
  target_schema: TELEGRAM_TARGET_SCHEMA,
  sensitive_fields: ["bot_token"],
  capabilities: {
    supports_text: true,
    supports_markdown: false,
    supports_rich_blocks: false,
    supports_actions: true,
    supports_mentions: false,
    supports_attachments: false,
    supports_provider_dedupe_key: false,
    max_body_length: 4096,
  },
};

const PROVIDER_DEFINITIONS: Record<
  NotificationProviderType,
  NotificationProviderDefinition
> = {
  webhook: WEBHOOK_DEFINITION,
  pushdeer: PUSHDEER_DEFINITION,
  bark: BARK_DEFINITION,
  telegram: TELEGRAM_DEFINITION,
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

const toTrimmedString = (value: unknown) => String(value ?? "").trim();

const splitCommaSeparatedValues = (value: unknown) =>
  toTrimmedString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const resolvePrimaryActionUrl = (message: NotificationMessage) =>
  message.actions.find((action) => toTrimmedString(action.url))?.url?.trim() ||
  "";

const resolveOptionalNonNegativeInteger = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
};

const resolveOptionalStrictPositiveInteger = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
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
    let parsedResponse: {
      code?: number;
      content?: unknown;
      error?: string;
    } | null = null;
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

const resolveBarkUrl = (provider: NotificationProvider) => {
  const baseUrl = toTrimmedString(provider.connection_config.server_url);
  const normalizedBaseUrl = baseUrl || "https://api.day.app";
  return `${normalizedBaseUrl.replace(/\/+$/, "")}/push`;
};

const buildBarkPayload = (
  message: NotificationMessage,
  context?: Partial<NotificationDispatchContext>,
) => {
  const targetConfig = toPlainRecord(context?.target?.target_config);
  const body = toTrimmedString(
    message.body_text || message.summary || message.title,
  );
  const title = toTrimmedString(message.title || "fn-knock 通知");
  const subtitle = toTrimmedString(message.summary);
  const url =
    toTrimmedString(targetConfig.url) || resolvePrimaryActionUrl(message);
  const level = toTrimmedString(targetConfig.level || "active");
  const sound = toTrimmedString(targetConfig.sound);
  const group = toTrimmedString(targetConfig.group);
  const icon = toTrimmedString(targetConfig.icon);
  const badge = resolveOptionalNonNegativeInteger(targetConfig.badge);
  const call = Boolean(targetConfig.call);

  return {
    title,
    subtitle: subtitle || undefined,
    body: body || "fn-knock 通知",
    level: level || "active",
    ...(sound ? { sound } : {}),
    ...(group ? { group } : {}),
    ...(url ? { url } : {}),
    ...(icon ? { icon } : {}),
    ...(badge !== undefined ? { badge } : {}),
    ...(call ? { call: "1" } : {}),
  };
};

const sendSingleBarkPush = async (args: {
  url: string;
  deviceKey: string;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}) => {
  const payload = {
    ...buildBarkPayload(args.message, args.context),
    device_key: args.deviceKey,
  };
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, args.timeoutSeconds) * 1000,
  );

  try {
    const response = await fetch(args.url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let parsedResponse: {
      code?: number;
      message?: string;
      timestamp?: number;
    } | null = null;
    try {
      parsedResponse = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedResponse = null;
    }

    const barkCode = parsedResponse?.code;
    const succeeded =
      response.ok && (barkCode === undefined || barkCode === 200);
    const reason =
      parsedResponse?.message ||
      (response.ok ? "" : `Bark returned ${response.status}`);

    return {
      success: succeeded,
      retryable:
        !succeeded && (response.status >= 500 || response.status === 429),
      reason: succeeded ? undefined : reason,
      response_summary: {
        status: response.status,
        ok: response.ok,
        code: barkCode,
        message: parsedResponse?.message,
        body_preview: truncateText(responseText),
      },
    };
  } catch (error) {
    return {
      success: false,
      retryable: true,
      reason: error instanceof Error ? error.message : "Bark request failed",
      response_summary: null,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const sendBarkMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const url = resolveBarkUrl(args.provider);
  const deviceKeys = splitCommaSeparatedValues(
    args.provider.connection_config.device_key,
  );
  if (!deviceKeys.length) {
    return {
      success: false,
      retryable: false,
      reason: "Missing Bark device key",
    };
  }

  const payloadPreview = buildBarkPayload(args.message, args.context);
  const results = await Promise.all(
    deviceKeys.map((deviceKey) =>
      sendSingleBarkPush({
        url,
        deviceKey,
        message: args.message,
        context: args.context,
        timeoutSeconds: args.timeoutSeconds,
      }),
    ),
  );

  const failedResults = results.filter((result) => !result.success);
  if (!failedResults.length) {
    return {
      success: true,
      retryable: false,
      request_summary: {
        method: "POST",
        url,
        device_key_count: deviceKeys.length,
        level: payloadPreview.level,
        group: payloadPreview.group,
        title_preview: payloadPreview.title,
      },
      response_summary: {
        success_count: results.length,
        failed_count: 0,
        results: results.map((result) => result.response_summary),
      },
    };
  }

  return {
    success: false,
    retryable: failedResults.some((result) => result.retryable),
    reason:
      failedResults.length === 1
        ? failedResults[0].reason || "Bark push failed"
        : `${failedResults.length}/${results.length} 个 Bark 目标发送失败`,
    request_summary: {
      method: "POST",
      url,
      device_key_count: deviceKeys.length,
      level: payloadPreview.level,
      group: payloadPreview.group,
      title_preview: payloadPreview.title,
    },
    response_summary: {
      success_count: results.length - failedResults.length,
      failed_count: failedResults.length,
      results: results.map((result) => ({
        success: result.success,
        retryable: result.retryable,
        reason: result.reason,
        response_summary: result.response_summary,
      })),
    },
  };
};

const resolveTelegramBaseUrl = (provider: NotificationProvider) => {
  const baseUrl = toTrimmedString(provider.connection_config.server_url);
  return (baseUrl || "https://api.telegram.org").replace(/\/+$/, "");
};

const buildTelegramText = (message: NotificationMessage) => {
  const plainSections: string[] = [];
  const richSections: string[] = [];
  const title = toTrimmedString(message.title || "fn-knock 通知");
  const summary = toTrimmedString(message.summary);
  const bodyText = toTrimmedString(message.body_text);

  if (title) {
    plainSections.push(title);
    richSections.push(`<b>${escapeHtml(title)}</b>`);
  }
  if (summary) {
    plainSections.push(summary);
    richSections.push(escapeHtml(summary));
  }
  if (bodyText) {
    const normalizedBody = bodyText
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
    plainSections.push(normalizedBody);
    richSections.push(
      normalizedBody
        .split("\n")
        .map((line) => escapeHtml(line))
        .join("\n"),
    );
  }
  if (message.facts.length > 0) {
    plainSections.push(
      message.facts.map((fact) => `${fact.label}: ${fact.value}`).join("\n"),
    );
    richSections.push(
      message.facts
        .map(
          (fact) =>
            `<b>${escapeHtml(fact.label)}:</b> ${escapeHtml(fact.value)}`,
        )
        .join("\n"),
    );
  }

  const richText = richSections.filter(Boolean).join("\n\n");
  if (richText.length <= 4096) {
    return richText;
  }

  return escapeHtml(
    truncateText(plainSections.filter(Boolean).join("\n\n"), 4096),
  );
};

const buildTelegramReplyMarkup = (message: NotificationMessage) => {
  const buttons = message.actions
    .filter(
      (action) => toTrimmedString(action.label) && toTrimmedString(action.url),
    )
    .map((action) => [
      {
        text: action.label.trim(),
        url: action.url.trim(),
      },
    ]);

  return buttons.length > 0
    ? {
        inline_keyboard: buttons,
      }
    : undefined;
};

const sendTelegramMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const baseUrl = resolveTelegramBaseUrl(args.provider);
  const botToken = toTrimmedString(args.provider.connection_config.bot_token);
  const chatId = toTrimmedString(args.provider.connection_config.chat_id);
  if (!botToken) {
    return {
      success: false,
      retryable: false,
      reason: "Missing Telegram bot token",
    };
  }
  if (!chatId) {
    return {
      success: false,
      retryable: false,
      reason: "Missing Telegram chat id",
    };
  }

  const targetConfig = toPlainRecord(args.context?.target?.target_config);
  const messageThreadId = resolveOptionalStrictPositiveInteger(
    targetConfig.message_thread_id,
  );
  const disableNotification = Boolean(targetConfig.disable_notification);
  const replyMarkup = buildTelegramReplyMarkup(args.message);
  const text = buildTelegramText(args.message);
  const url = `${baseUrl}/bot${botToken}/sendMessage`;
  const requestBody = {
    chat_id: chatId,
    text: text || "fn-knock 通知",
    parse_mode: "HTML",
    ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    ...(disableNotification ? { disable_notification: true } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, args.timeoutSeconds) * 1000,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let parsedResponse: {
      ok?: boolean;
      description?: string;
      error_code?: number;
      result?: {
        message_id?: number;
        chat?: {
          id?: number | string;
          title?: string;
          username?: string;
          type?: string;
        };
      };
    } | null = null;
    try {
      parsedResponse = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedResponse = null;
    }

    const apiOk = parsedResponse?.ok ?? response.ok;
    const apiErrorCode = parsedResponse?.error_code;
    const success = response.ok && apiOk;
    const retryable =
      !success &&
      (response.status >= 500 ||
        response.status === 429 ||
        apiErrorCode === 429);

    return {
      success,
      retryable,
      reason: success
        ? undefined
        : parsedResponse?.description || `Telegram returned ${response.status}`,
      request_summary: {
        method: "POST",
        url: `${baseUrl}/bot<redacted>/sendMessage`,
        chat_id: chatId,
        message_thread_id: messageThreadId,
        disable_notification: disableNotification,
        has_inline_keyboard: Boolean(replyMarkup),
        text_preview: truncateText(toTrimmedString(args.message.title), 120),
      },
      response_summary: {
        status: response.status,
        ok: response.ok,
        api_ok: parsedResponse?.ok,
        error_code: apiErrorCode,
        description: parsedResponse?.description,
        message_id: parsedResponse?.result?.message_id,
        chat: parsedResponse?.result?.chat,
        body_preview: truncateText(responseText),
      },
    };
  } catch (error) {
    return {
      success: false,
      retryable: true,
      reason:
        error instanceof Error ? error.message : "Telegram request failed",
      request_summary: {
        method: "POST",
        url: `${baseUrl}/bot<redacted>/sendMessage`,
        chat_id: chatId,
        message_thread_id: messageThreadId,
        disable_notification: disableNotification,
        has_inline_keyboard: Boolean(replyMarkup),
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
    case "bark":
      return sendBarkMessage({
        provider,
        message,
        context,
        timeoutSeconds,
      });
    case "telegram":
      return sendTelegramMessage({
        provider,
        message,
        context,
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
