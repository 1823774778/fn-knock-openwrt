import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationSchemaField,
  NotificationSendResult,
} from "../types";
import {
  escapeHtml,
  toPlainRecord,
  toTrimmedString,
  truncateText,
} from "./shared";

const PUSHPLUS_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "server_url",
    label: "服务地址",
    description: "官方接口保持默认值即可。",
    placeholder: "https://www.pushplus.plus",
    type: "string",
    required: true,
    default_value: "https://www.pushplus.plus",
  },
  {
    key: "token",
    label: "Token",
    description: "PushPlus 的用户 token 或消息 token，请妥善保管。",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
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

const PUSHPLUS_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "topic",
    label: "群组编码",
    description: "可选。填写后将消息发送到指定群组；不填则发送给 token 自己。",
    placeholder: "alarm-topic",
    type: "string",
  },
  {
    key: "template",
    label: "消息模板",
    description:
      "默认使用 Markdown；如果目标渠道更适合纯文本或 HTML，也可以单独切换。",
    type: "select",
    default_value: "markdown",
    options: [
      { label: "Markdown", value: "markdown" },
      { label: "HTML", value: "html" },
      { label: "纯文本", value: "txt" },
      { label: "JSON", value: "json" },
    ],
  },
  {
    key: "channel",
    label: "发送渠道",
    description:
      "默认发送到微信公众号；如已在 PushPlus 中配置其他渠道，可在这里切换。",
    type: "select",
    default_value: "wechat",
    options: [
      { label: "微信公众号", value: "wechat" },
      { label: "第三方 Webhook", value: "webhook" },
      { label: "企业微信应用", value: "cp" },
      { label: "邮件", value: "mail" },
      { label: "短信", value: "sms" },
      { label: "语音", value: "voice" },
      { label: "插件 / 桌面程序", value: "extension" },
      { label: "App", value: "app" },
      { label: "微信 ClawBot", value: "clawbot" },
    ],
  },
  {
    key: "option",
    label: "渠道配置参数",
    description:
      "可选。cp、webhook、mail 等渠道通常需要填写在 PushPlus 个人中心里预先配置好的渠道编码。",
    placeholder: "my-channel-code",
    type: "string",
  },
  {
    key: "to",
    label: "好友令牌 / 用户 ID",
    description:
      "可选。微信公众号渠道填写好友令牌，企业微信应用渠道填写用户 ID；多人可按 PushPlus 文档格式传入。",
    placeholder: "friend_token 或 user1,user2",
    type: "string",
  },
  {
    key: "callback_url",
    label: "回调 URL",
    description: "可选。PushPlus 异步投递完成后会把结果回调到这个地址。",
    placeholder: "https://example.com/hooks/pushplus",
    type: "string",
  },
  {
    key: "pre",
    label: "预处理编码",
    description:
      "可选。仅当 PushPlus 账号已配置对应预处理逻辑时填写，用于在服务端发送前加工消息内容。",
    placeholder: "appendMsg",
    type: "string",
  },
];

export const pushplusProviderDefinition: NotificationProviderDefinition = {
  type: "pushplus",
  label: "PushPlus",
  description:
    "通过 PushPlus 标准发送接口推送通知，可按规则选择公众号、App、邮件等渠道。",
  connection_schema: PUSHPLUS_CONNECTION_SCHEMA,
  target_schema: PUSHPLUS_TARGET_SCHEMA,
  sensitive_fields: ["token"],
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

const PUSHPLUS_TEMPLATE_VALUES = ["html", "txt", "json", "markdown"] as const;
type PushPlusTemplate = (typeof PUSHPLUS_TEMPLATE_VALUES)[number];

const resolvePushPlusUrl = (provider: NotificationProvider) => {
  const baseUrl = toTrimmedString(provider.connection_config.server_url);
  const normalizedBaseUrl = baseUrl || "https://www.pushplus.plus";
  if (/\/(?:send|batchSend)\/?$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl;
  }
  return `${normalizedBaseUrl.replace(/\/+$/, "")}/send`;
};

const buildPushPlusTextContent = (message: NotificationMessage) => {
  const sections: string[] = [];

  if (message.summary?.trim()) {
    sections.push(message.summary.trim());
  }

  if (message.body_text?.trim()) {
    sections.push(
      message.body_text
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
    );
  } else if (message.body_markdown?.trim()) {
    sections.push(message.body_markdown.trim());
  }

  if (message.facts.length > 0) {
    sections.push(
      message.facts.map((fact) => `${fact.label}：${fact.value}`).join("\n"),
    );
  }

  if (message.actions.length > 0) {
    sections.push(
      message.actions
        .filter(
          (action) =>
            toTrimmedString(action.label) && toTrimmedString(action.url),
        )
        .map((action) => `${action.label.trim()}：${action.url.trim()}`)
        .join("\n"),
    );
  }

  return (
    sections.filter(Boolean).join("\n\n") ||
    toTrimmedString(message.title || message.summary || "fn-knock 通知")
  );
};

const buildPushPlusMarkdownContent = (message: NotificationMessage) => {
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
        .filter(
          (action) =>
            toTrimmedString(action.label) && toTrimmedString(action.url),
        )
        .map((action) => `- [${action.label.trim()}](${action.url.trim()})`)
        .join("\n"),
    );
  }

  return (
    sections.filter(Boolean).join("\n\n") || buildPushPlusTextContent(message)
  );
};

const buildPushPlusHtmlContent = (message: NotificationMessage) => {
  const sections: string[] = [];

  if (message.summary?.trim()) {
    sections.push(`<p>${escapeHtml(message.summary.trim())}</p>`);
  }

  if (message.body_text?.trim()) {
    sections.push(
      `<p>${message.body_text
        .trim()
        .split("\n")
        .map((line) => escapeHtml(line.trim()))
        .filter(Boolean)
        .join("<br />")}</p>`,
    );
  } else if (message.body_markdown?.trim()) {
    sections.push(`<pre>${escapeHtml(message.body_markdown.trim())}</pre>`);
  }

  if (message.facts.length > 0) {
    sections.push(
      `<ul>${message.facts
        .map(
          (fact) =>
            `<li><strong>${escapeHtml(fact.label)}</strong>：${escapeHtml(fact.value)}</li>`,
        )
        .join("")}</ul>`,
    );
  }

  if (message.actions.length > 0) {
    sections.push(
      `<ul>${message.actions
        .filter(
          (action) =>
            toTrimmedString(action.label) && toTrimmedString(action.url),
        )
        .map(
          (action) =>
            `<li><a href="${escapeHtml(action.url.trim())}">${escapeHtml(action.label.trim())}</a></li>`,
        )
        .join("")}</ul>`,
    );
  }

  return (
    sections.filter(Boolean).join("") ||
    `<p>${escapeHtml(toTrimmedString(message.title || message.summary || "fn-knock 通知"))}</p>`
  );
};

const buildPushPlusJsonContent = (message: NotificationMessage) =>
  JSON.stringify(
    {
      summary: message.summary,
      body_text: message.body_text,
      body_markdown: message.body_markdown,
      severity: message.severity,
      facts: message.facts,
      actions: message.actions,
      occurred_at: message.occurred_at,
      event_id: message.event_id,
      metadata: message.metadata,
    },
    null,
    2,
  );

const parsePushPlusApiCode = (response: Record<string, unknown> | null) => {
  const rawCode = response?.code;
  if (typeof rawCode === "number") {
    return rawCode;
  }

  const parsed = Number.parseInt(String(rawCode ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const resolvePushPlusTemplate = (value: unknown): PushPlusTemplate => {
  const template = toTrimmedString(value).toLowerCase();
  return PUSHPLUS_TEMPLATE_VALUES.includes(template as PushPlusTemplate)
    ? (template as PushPlusTemplate)
    : "markdown";
};

const isPushPlusRetryable = (status: number, apiCode?: number) =>
  status === 429 || status >= 500 || apiCode === 500 || apiCode === 999;

export const sendPushPlusMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const providerConfig = toPlainRecord(args.provider.connection_config);
  const targetConfig = toPlainRecord(args.context?.target?.target_config);
  const token = toTrimmedString(providerConfig.token);

  if (!token) {
    return {
      success: false,
      retryable: false,
      reason: "Missing PushPlus token",
    };
  }

  const url = resolvePushPlusUrl(args.provider);
  const template = resolvePushPlusTemplate(targetConfig.template);
  const channel = toTrimmedString(targetConfig.channel) || "wechat";
  const topic = toTrimmedString(targetConfig.topic);
  const option = toTrimmedString(targetConfig.option);
  const to = toTrimmedString(targetConfig.to);
  const callbackUrl = toTrimmedString(targetConfig.callback_url);
  const pre = toTrimmedString(targetConfig.pre);
  const title = truncateText(
    toTrimmedString(
      args.message.title || args.message.summary || "fn-knock 通知",
    ),
    128,
  );

  const content =
    template === "html"
      ? buildPushPlusHtmlContent(args.message)
      : template === "txt"
        ? buildPushPlusTextContent(args.message)
        : template === "json"
          ? buildPushPlusJsonContent(args.message)
          : buildPushPlusMarkdownContent(args.message);

  const requestBody = {
    token,
    ...(title ? { title } : {}),
    content: content || "fn-knock 通知",
    template,
    channel,
    ...(topic ? { topic } : {}),
    ...(option ? { option } : {}),
    ...(callbackUrl ? { callbackUrl } : {}),
    ...(to ? { to } : {}),
    ...(pre ? { pre } : {}),
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
    let parsedResponse: Record<string, unknown> | null = null;
    try {
      parsedResponse = responseText
        ? (JSON.parse(responseText) as Record<string, unknown>)
        : null;
    } catch {
      parsedResponse = null;
    }

    const apiCode = parsePushPlusApiCode(parsedResponse);
    const apiMessage = toTrimmedString(
      parsedResponse?.msg ?? parsedResponse?.message ?? parsedResponse?.error,
    );
    const succeeded = response.ok && apiCode === 200;

    return {
      success: succeeded,
      retryable: !succeeded && isPushPlusRetryable(response.status, apiCode),
      reason: succeeded
        ? undefined
        : apiMessage || `PushPlus returned ${response.status}`,
      request_summary: {
        method: "POST",
        endpoint: url,
        channel,
        template,
        has_topic: Boolean(topic),
        has_option: Boolean(option),
        has_to: Boolean(to),
        has_callback_url: Boolean(callbackUrl),
        has_pre: Boolean(pre),
        title_preview: title,
      },
      response_summary: {
        status: response.status,
        ok: response.ok,
        code: apiCode,
        message: apiMessage || undefined,
        short_code:
          typeof parsedResponse?.data === "string"
            ? parsedResponse.data
            : undefined,
        body_preview: truncateText(responseText),
      },
    };
  } catch (error) {
    return {
      success: false,
      retryable: true,
      reason:
        error instanceof Error ? error.message : "PushPlus request failed",
      request_summary: {
        method: "POST",
        endpoint: url,
        channel,
        template,
        has_topic: Boolean(topic),
        has_option: Boolean(option),
        has_to: Boolean(to),
        has_callback_url: Boolean(callbackUrl),
        has_pre: Boolean(pre),
        title_preview: title,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};
