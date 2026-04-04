import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationSchemaField,
  NotificationSendResult,
} from "../types";
import {
  toPlainRecord,
  toTrimmedString,
  truncateText,
  truncateUtf8ByBytes,
} from "./shared";

const SERVERCHAN_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "server_url",
    label: "服务地址",
    description: "官方接口保持默认值即可。",
    placeholder: "https://sctapi.ftqq.com",
    type: "string",
    required: true,
    default_value: "https://sctapi.ftqq.com",
  },
  {
    key: "sendkey",
    label: "SendKey",
    description: "Server酱·Turbo 提供的 SendKey，请妥善保管。",
    placeholder: "SCTxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
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

const SERVERCHAN_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "channel",
    label: "消息通道",
    description:
      "可选。动态指定本次推送的通道，最多两个值，使用 | 分隔，例如 9|66。",
    placeholder: "9|66",
    type: "string",
  },
  {
    key: "openid",
    label: "OpenID / UID",
    description:
      "可选。测试号使用 openid，企业微信应用消息使用接收人的 UID；多个值请按 Server酱 文档格式填写。",
    placeholder: "openid1,openid2 或 uid1|uid2",
    type: "string",
  },
  {
    key: "short",
    label: "卡片摘要",
    description:
      "可选。消息卡片的简短摘要，最长 64 个字符；留空时由 Server酱 自动截取正文。",
    placeholder: "登录异常，请尽快处理",
    type: "string",
  },
  {
    key: "noip",
    label: "隐藏调用 IP",
    description: "启用后本次推送不会展示调用来源 IP。",
    type: "boolean",
    default_value: false,
  },
];

export const serverchanProviderDefinition: NotificationProviderDefinition = {
  type: "serverchan",
  label: "Server酱",
  description:
    "通过 Server酱·Turbo 发送 Markdown 通知，可复用网站中配置好的默认接收通道。",
  connection_schema: SERVERCHAN_CONNECTION_SCHEMA,
  target_schema: SERVERCHAN_TARGET_SCHEMA,
  sensitive_fields: ["sendkey"],
  capabilities: {
    supports_text: true,
    supports_markdown: true,
    supports_rich_blocks: false,
    supports_actions: true,
    supports_mentions: false,
    supports_attachments: false,
    supports_provider_dedupe_key: false,
    max_body_length: 32768,
  },
};

const resolveServerChanBaseUrl = (provider: NotificationProvider) => {
  const baseUrl = toTrimmedString(provider.connection_config.server_url);
  return baseUrl || "https://sctapi.ftqq.com";
};

const buildServerChanMarkdownBody = (message: NotificationMessage) => {
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

  return sections.filter(Boolean).join("\n\n");
};

const parseServerChanApiCode = (response: Record<string, unknown> | null) => {
  const rawCode =
    response?.code ?? response?.errno ?? response?.error_code ?? undefined;
  if (typeof rawCode === "number") {
    return rawCode;
  }

  const parsed = Number.parseInt(String(rawCode ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const sendServerChanMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const providerConfig = toPlainRecord(args.provider.connection_config);
  const targetConfig = toPlainRecord(args.context?.target?.target_config);
  const sendkey = toTrimmedString(providerConfig.sendkey);

  if (!sendkey) {
    return {
      success: false,
      retryable: false,
      reason: "Missing Server酱 SendKey",
    };
  }

  const baseUrl = resolveServerChanBaseUrl(args.provider);
  const urlToSend = `${baseUrl.replace(/\/+$/, "")}/${sendkey}.send`;
  const title = truncateText(
    toTrimmedString(
      args.message.title || args.message.summary || "fn-knock 通知",
    ),
    32,
  );
  const desp = truncateUtf8ByBytes(
    buildServerChanMarkdownBody(args.message),
    32 * 1024,
  );
  const short = truncateText(toTrimmedString(targetConfig.short), 64);
  const channel = toTrimmedString(targetConfig.channel);
  const openid = toTrimmedString(targetConfig.openid);
  const noip = Boolean(targetConfig.noip);

  const body = new URLSearchParams({
    title: title || "fn-knock 通知",
    ...(desp ? { desp } : {}),
    ...(short ? { short } : {}),
    ...(channel ? { channel } : {}),
    ...(openid ? { openid } : {}),
    ...(noip ? { noip: "1" } : {}),
  });

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, args.timeoutSeconds) * 1000,
  );

  try {
    const response = await fetch(urlToSend, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body,
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

    const apiCode = parseServerChanApiCode(parsedResponse);
    const apiMessage = toTrimmedString(
      parsedResponse?.message ?? parsedResponse?.msg ?? parsedResponse?.error,
    );
    const data = toPlainRecord(parsedResponse?.data);
    const succeeded =
      response.ok &&
      (apiCode === undefined || Number.isNaN(apiCode) || apiCode === 0);

    return {
      success: succeeded,
      retryable:
        !succeeded && (response.status >= 500 || response.status === 429),
      reason: succeeded
        ? undefined
        : apiMessage || `Server酱 returned ${response.status}`,
      request_summary: {
        method: "POST",
        endpoint: baseUrl,
        has_desp: Boolean(desp),
        has_short: Boolean(short),
        channel: channel || undefined,
        has_openid: Boolean(openid),
        noip,
        title_preview: title,
      },
      response_summary: {
        status: response.status,
        ok: response.ok,
        code: apiCode,
        message: apiMessage || undefined,
        pushid: data.pushid,
        has_readkey: Boolean(data.readkey),
        body_preview: truncateText(responseText),
      },
    };
  } catch (error) {
    return {
      success: false,
      retryable: true,
      reason:
        error instanceof Error ? error.message : "Server酱 request failed",
      request_summary: {
        method: "POST",
        endpoint: baseUrl,
        has_desp: Boolean(desp),
        has_short: Boolean(short),
        channel: channel || undefined,
        has_openid: Boolean(openid),
        noip,
        title_preview: title,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};
