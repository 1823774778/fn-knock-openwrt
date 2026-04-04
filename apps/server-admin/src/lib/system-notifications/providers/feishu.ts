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

const FEISHU_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "webhook_url",
    label: "Webhook URL",
    description: "飞书机器人生成的完整 Webhook 地址。",
    placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxx",
    type: "string",
    required: true,
    sensitive: true,
  },
  {
    key: "secret",
    label: "签名密钥",
    description:
      "可选。若机器人启用了“签名校验”，请填写安全设置中复制出的密钥。",
    placeholder: "xxxxxxxxxxxxxxxx",
    type: "string",
    sensitive: true,
  },
  {
    key: "keyword_prefix",
    label: "关键词前缀",
    description:
      "可选。若机器人启用了自定义关键词校验，建议填写一个固定关键词；发送时会自动追加到标题前。",
    placeholder: "应用报警",
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

const FEISHU_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "mention_user_ids",
    label: "@ 用户 ID",
    description:
      "可选。多个值使用英文逗号或换行分隔；支持填写 all。外部群中 @ 单个用户仅支持 Open ID。",
    placeholder: "ou_xxx,all",
    type: "string",
  },
];

export const feishuProviderDefinition: NotificationProviderDefinition = {
  type: "feishu",
  label: "飞书机器人",
  description:
    "通过飞书机器人 Webhook 向群聊发送 post 富文本通知，并支持签名校验。",
  connection_schema: FEISHU_CONNECTION_SCHEMA,
  target_schema: FEISHU_TARGET_SCHEMA,
  sensitive_fields: ["webhook_url", "secret"],
  capabilities: {
    supports_text: true,
    supports_markdown: false,
    supports_rich_blocks: false,
    supports_actions: true,
    supports_mentions: true,
    supports_attachments: false,
    supports_provider_dedupe_key: false,
    max_body_length: 20480,
  },
};

type FeishuPostNode =
  | {
      tag: "text";
      text: string;
      un_escape?: boolean;
    }
  | {
      tag: "a";
      text: string;
      href: string;
    }
  | {
      tag: "at";
      user_id: string;
      user_name?: string;
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

const redactFeishuWebhookUrl = (value: string) => {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/");
    if (parts.length > 0) {
      parts[parts.length - 1] = "<redacted>";
      url.pathname = parts.join("/");
    }
    return url.toString();
  } catch {
    return value.replace(/\/[^/?#]+([?#].*)?$/, "/<redacted>$1");
  }
};

const pushTextParagraphs = (paragraphs: FeishuPostNode[][], value: string) => {
  const normalizedValue = toTrimmedString(value);
  if (!normalizedValue) return;

  for (const line of normalizedValue
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)) {
    paragraphs.push([{ tag: "text", text: line }]);
  }
};

const buildFeishuPostContent = (
  message: NotificationMessage,
  mentionUserIds: string[],
) => {
  const paragraphs: FeishuPostNode[][] = [];

  pushTextParagraphs(paragraphs, message.summary);
  pushTextParagraphs(
    paragraphs,
    toTrimmedString(message.body_text) ||
      toTrimmedString(message.body_markdown),
  );

  for (const fact of message.facts) {
    const label = toTrimmedString(fact.label);
    const value = toTrimmedString(fact.value);
    if (!label && !value) continue;
    paragraphs.push([
      {
        tag: "text",
        text: label && value ? `${label}：${value}` : label || value,
      },
    ]);
  }

  for (const action of message.actions) {
    const label = toTrimmedString(action.label);
    const url = toTrimmedString(action.url);
    if (!label || !url) continue;
    paragraphs.push([
      {
        tag: "a",
        text: label,
        href: url,
      },
    ]);
  }

  if (mentionUserIds.length > 0) {
    paragraphs.push(
      mentionUserIds.map((userId) =>
        userId === "all"
          ? { tag: "at", user_id: "all", user_name: "所有人" }
          : { tag: "at", user_id: userId },
      ),
    );
  }

  if (paragraphs.length === 0) {
    paragraphs.push([
      {
        tag: "text",
        text:
          toTrimmedString(message.title) ||
          toTrimmedString(message.summary) ||
          "fn-knock 通知",
      },
    ]);
  }

  return paragraphs;
};

export const sendFeishuMessage = async (args: {
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
      reason: "Missing Feishu webhook url",
    };
  }

  const secret = toTrimmedString(args.provider.connection_config.secret);
  const keywordPrefix = toTrimmedString(
    args.provider.connection_config.keyword_prefix,
  );
  const targetConfig = toPlainRecord(args.context?.target?.target_config);
  const mentionUserIds = splitCommaSeparatedValues(
    targetConfig.mention_user_ids,
  );
  const title = applyKeywordPrefix(
    toTrimmedString(args.message.title || "fn-knock 通知"),
    keywordPrefix,
  );
  const signatureFields = secret
    ? (() => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        return {
          timestamp,
          sign: createHmac("sha256", `${timestamp}\n${secret}`).digest(
            "base64",
          ),
        };
      })()
    : null;
  const requestBody = {
    ...(signatureFields || {}),
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title,
          content: buildFeishuPostContent(args.message, mentionUserIds),
        },
      },
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, args.timeoutSeconds) * 1000,
  );

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    let parsedResponse: {
      code?: number;
      msg?: string;
      data?: unknown;
    } | null = null;
    try {
      parsedResponse = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedResponse = null;
    }

    const apiSucceeded = response.ok && (parsedResponse?.code ?? 0) === 0;
    const apiCode = parsedResponse?.code;

    return {
      success: apiSucceeded,
      retryable:
        !apiSucceeded &&
        (response.status >= 500 ||
          response.status === 429 ||
          apiCode === 11232),
      reason: apiSucceeded
        ? undefined
        : parsedResponse?.msg || `Feishu returned ${response.status}`,
      request_summary: {
        method: "POST",
        url: redactFeishuWebhookUrl(webhookUrl),
        msg_type: requestBody.msg_type,
        signed: Boolean(secret),
        mentioned_user_count: mentionUserIds.length,
        title_preview: truncateText(title, 120),
      },
      response_summary: {
        status: response.status,
        ok: response.ok,
        code: apiCode,
        msg: parsedResponse?.msg,
        body_preview: truncateText(responseText),
      },
    };
  } catch (error) {
    return {
      success: false,
      retryable: true,
      reason: error instanceof Error ? error.message : "Feishu request failed",
      request_summary: {
        method: "POST",
        url: redactFeishuWebhookUrl(webhookUrl),
        msg_type: requestBody.msg_type,
        signed: Boolean(secret),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};
