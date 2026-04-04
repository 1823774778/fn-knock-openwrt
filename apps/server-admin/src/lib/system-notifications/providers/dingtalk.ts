import { createHmac } from "node:crypto";
import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationSchemaField,
  NotificationSendResult,
} from "../types";
import {
  splitCommaSeparatedValues,
  toPlainRecord,
  toTrimmedString,
  truncateText,
} from "./shared";

const DINGTALK_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "webhook_url",
    label: "Webhook URL",
    description: "钉钉机器人生成的完整 Webhook 地址。",
    placeholder: "https://oapi.dingtalk.com/robot/send?access_token=xxxxxx",
    type: "string",
    required: true,
    sensitive: true,
  },
  {
    key: "secret",
    label: "加签密钥",
    description:
      "可选。若机器人启用了“加签”，请填写安全设置页里显示的 SEC 开头密钥。",
    placeholder: "SECxxxxxxxx",
    type: "string",
    sensitive: true,
  },
  {
    key: "keyword_prefix",
    label: "关键词前缀",
    description:
      "可选。若机器人启用了自定义关键词校验，建议填写一个固定关键词；发送时会自动追加到标题前。",
    placeholder: "监控报警",
    type: "string",
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

const DINGTALK_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "at_mobiles",
    label: "@ 手机号",
    description: "可选。多个值使用英文逗号或换行分隔，且必须是群内成员手机号。",
    placeholder: "13800001111,13900002222",
    type: "string",
  },
  {
    key: "at_user_ids",
    label: "@ 用户 ID",
    description:
      "可选。多个值使用英文逗号或换行分隔，会自动在正文追加 @userId。",
    placeholder: "manager7675,user123",
    type: "string",
  },
  {
    key: "is_at_all",
    label: "@ 所有人",
    description: "启用后会在请求里携带 isAtAll，并在正文补充 @所有人。",
    type: "boolean",
    default_value: false,
  },
];

export const dingtalkProviderDefinition: NotificationProviderDefinition = {
  type: "dingtalk",
  label: "钉钉机器人",
  description:
    "通过钉钉机器人 Webhook 向群聊发送 Markdown 通知，并支持加签校验。",
  connection_schema: DINGTALK_CONNECTION_SCHEMA,
  target_schema: DINGTALK_TARGET_SCHEMA,
  sensitive_fields: ["webhook_url", "secret"],
  capabilities: {
    supports_text: true,
    supports_markdown: true,
    supports_rich_blocks: false,
    supports_actions: true,
    supports_mentions: true,
    supports_attachments: false,
    supports_provider_dedupe_key: false,
    max_body_length: null,
  },
};

const applyKeywordPrefix = (value: string, keyword: string) => {
  const trimmedKeyword = keyword.trim();
  const trimmedValue = value.trim();
  if (!trimmedKeyword) return trimmedValue;
  if (trimmedValue.includes(trimmedKeyword)) return trimmedValue;
  return trimmedValue
    ? `【${trimmedKeyword}】 ${trimmedValue}`
    : trimmedKeyword;
};

const buildQueryUrl = (url: string, params: Record<string, string>) => {
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    const query = Object.entries(params)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&");
    return `${url}${url.includes("?") ? "&" : "?"}${query}`;
  }
};

const redactDingTalkWebhookUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.searchParams.has("access_token")) {
      url.searchParams.set("access_token", "<redacted>");
    }
    if (url.searchParams.has("sign")) {
      url.searchParams.set("sign", "<redacted>");
    }
    return url.toString();
  } catch {
    return value
      .replace(/access_token=[^&]+/gi, "access_token=<redacted>")
      .replace(/sign=[^&]+/gi, "sign=<redacted>");
  }
};

const buildDingTalkMentionText = (
  atMobiles: string[],
  atUserIds: string[],
  isAtAll: boolean,
) => {
  const tokens = [
    ...atMobiles.map((mobile) => `@${mobile}`),
    ...atUserIds.map((userId) => `@${userId}`),
  ];

  if (isAtAll) {
    tokens.unshift("@所有人");
  }

  return tokens.join(" ").trim();
};

const buildDingTalkMarkdownText = (
  message: NotificationMessage,
  mentionText: string,
) => {
  const sections: string[] = [];
  const summary = toTrimmedString(message.summary);
  const bodySource =
    toTrimmedString(message.body_markdown) ||
    toTrimmedString(message.body_text);

  if (summary) {
    sections.push(summary);
  }
  if (bodySource) {
    sections.push(
      bodySource
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
  if (mentionText) {
    sections.push(mentionText);
  }

  return sections.filter(Boolean).join("\n\n");
};

export const sendDingTalkMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const webhookUrl = toTrimmedString(
    args.provider.connection_config.webhook_url,
  );
  if (!webhookUrl) {
    return {
      success: false,
      retryable: false,
      reason: "Missing DingTalk webhook url",
    };
  }

  const secret = toTrimmedString(args.provider.connection_config.secret);
  const keywordPrefix = toTrimmedString(
    args.provider.connection_config.keyword_prefix,
  );
  const targetConfig = toPlainRecord(args.context?.target?.target_config);
  const atMobiles = splitCommaSeparatedValues(targetConfig.at_mobiles);
  const atUserIds = splitCommaSeparatedValues(targetConfig.at_user_ids);
  const isAtAll = Boolean(targetConfig.is_at_all);
  const mentionText = buildDingTalkMentionText(atMobiles, atUserIds, isAtAll);
  const title = applyKeywordPrefix(
    toTrimmedString(args.message.title || "fn-knock 通知"),
    keywordPrefix,
  );
  const markdownText =
    buildDingTalkMarkdownText(args.message, mentionText) ||
    toTrimmedString(args.message.summary) ||
    title;

  const timestamp = secret ? String(Date.now()) : "";
  const sign = secret
    ? createHmac("sha256", secret)
        .update(`${timestamp}\n${secret}`, "utf8")
        .digest("base64")
    : "";
  const requestUrl =
    secret && timestamp && sign
      ? buildQueryUrl(webhookUrl, { timestamp, sign })
      : webhookUrl;
  const requestBody = {
    msgtype: "markdown",
    markdown: {
      title,
      text: markdownText,
    },
    ...(atMobiles.length > 0 || atUserIds.length > 0 || isAtAll
      ? {
          at: {
            ...(atMobiles.length > 0 ? { atMobiles } : {}),
            ...(atUserIds.length > 0 ? { atUserIds } : {}),
            isAtAll,
          },
        }
      : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, args.timeoutSeconds) * 1000,
  );

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let parsedResponse: {
      errcode?: number;
      errmsg?: string;
    } | null = null;
    try {
      parsedResponse = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedResponse = null;
    }

    const apiSucceeded = response.ok && (parsedResponse?.errcode ?? 0) === 0;

    return {
      success: apiSucceeded,
      retryable:
        !apiSucceeded && (response.status >= 500 || response.status === 429),
      reason: apiSucceeded
        ? undefined
        : parsedResponse?.errmsg || `DingTalk returned ${response.status}`,
      request_summary: {
        method: "POST",
        url: redactDingTalkWebhookUrl(requestUrl),
        msgtype: requestBody.msgtype,
        signed: Boolean(secret),
        mentioned_mobile_count: atMobiles.length,
        mentioned_user_count: atUserIds.length,
        is_at_all: isAtAll,
        title_preview: truncateText(title, 120),
      },
      response_summary: {
        status: response.status,
        ok: response.ok,
        errcode: parsedResponse?.errcode,
        errmsg: parsedResponse?.errmsg,
        body_preview: truncateText(responseText),
      },
    };
  } catch (error) {
    return {
      success: false,
      retryable: true,
      reason:
        error instanceof Error ? error.message : "DingTalk request failed",
      request_summary: {
        method: "POST",
        url: redactDingTalkWebhookUrl(requestUrl),
        msgtype: requestBody.msgtype,
        signed: Boolean(secret),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};
