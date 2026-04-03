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
  resolveOptionalStrictPositiveInteger,
  toPlainRecord,
  toTrimmedString,
  truncateText,
} from "./shared";

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

export const telegramProviderDefinition: NotificationProviderDefinition = {
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

export const sendTelegramMessage = async (args: {
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
