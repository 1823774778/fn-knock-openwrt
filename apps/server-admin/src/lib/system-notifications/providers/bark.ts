import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationSchemaField,
  NotificationSendResult,
} from "../types";
import {
  resolveOptionalNonNegativeInteger,
  resolvePrimaryActionUrl,
  splitCommaSeparatedValues,
  toPlainRecord,
  toTrimmedString,
  truncateText,
} from "./shared";

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

export const barkProviderDefinition: NotificationProviderDefinition = {
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
  const summary = toTrimmedString(message.summary);
  const bodyText = toTrimmedString(message.body_text);
  const hasStandaloneBody = Boolean(bodyText) && bodyText !== summary;
  const title = toTrimmedString(message.title || "fn-knock 通知");
  const subtitle = hasStandaloneBody ? summary : "";
  const body = hasStandaloneBody ? bodyText : summary || bodyText || title;
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

export const sendBarkMessage = async (args: {
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
        ? failedResults[0]!.reason || "Bark push failed"
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
