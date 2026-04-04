import { randomBytes } from "node:crypto";
import { hostname as getHostname } from "node:os";
import net, { type Socket } from "node:net";
import tls, { type TLSSocket } from "node:tls";
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

type EmailTransportSecurity = "ssl_tls" | "starttls" | "none";
type EmailAuthMode = "auto" | "plain" | "login" | "none";

type SmtpResponse = {
  code: number;
  lines: string[];
  message: string;
};

class SmtpCommandError extends Error {
  readonly retryable: boolean;
  readonly response?: SmtpResponse;

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      response?: SmtpResponse;
    },
  ) {
    super(message);
    this.name = "SmtpCommandError";
    this.retryable = options?.retryable ?? true;
    this.response = options?.response;
  }
}

const EMAIL_CONNECTION_SCHEMA: NotificationSchemaField[] = [
  {
    key: "smtp_host",
    label: "SMTP 主机",
    description: "邮件发送服务器地址，例如 smtp.example.com。",
    placeholder: "smtp.example.com",
    type: "string",
    required: true,
  },
  {
    key: "smtp_port",
    label: "SMTP 端口",
    description: "常见端口为 465（SSL/TLS）或 587（STARTTLS）。",
    type: "number",
    required: true,
    default_value: 465,
    min: 1,
    max: 65535,
  },
  {
    key: "smtp_security",
    label: "SMTP 加密方式",
    type: "select",
    required: true,
    default_value: "ssl_tls",
    options: [
      { label: "SSL/TLS", value: "ssl_tls" },
      { label: "STARTTLS", value: "starttls" },
      { label: "不加密", value: "none" },
    ],
  },
  {
    key: "smtp_auth_mode",
    label: "SMTP 认证方式",
    description: "自动优先使用 AUTH PLAIN，不支持时会回退到 AUTH LOGIN。",
    type: "select",
    required: true,
    default_value: "auto",
    options: [
      { label: "自动协商", value: "auto" },
      { label: "AUTH PLAIN", value: "plain" },
      { label: "AUTH LOGIN", value: "login" },
      { label: "无认证", value: "none" },
    ],
  },
  {
    key: "smtp_username",
    label: "SMTP 用户名",
    placeholder: "no-reply@example.com",
    type: "string",
  },
  {
    key: "smtp_password",
    label: "SMTP 密码",
    placeholder: "password",
    type: "string",
    sensitive: true,
  },
  {
    key: "from_address",
    label: "发件邮箱",
    description: "会作为 MAIL FROM 和邮件头中的 From 地址。",
    placeholder: "no-reply@example.com",
    type: "string",
    required: true,
  },
  {
    key: "from_name",
    label: "发件人名称",
    placeholder: "fn-knock",
    type: "string",
  },
  {
    key: "to_addresses",
    label: "默认收件人",
    description:
      "支持逗号或换行分隔多个邮箱。测试发送会使用这里的收件人，规则也可在 target 中覆盖。",
    placeholder: "ops@example.com, admin@example.com",
    type: "string",
    required: true,
  },
  {
    key: "cc_addresses",
    label: "默认抄送",
    placeholder: "audit@example.com",
    type: "string",
  },
  {
    key: "bcc_addresses",
    label: "默认密送",
    placeholder: "archive@example.com",
    type: "string",
  },
  {
    key: "reply_to",
    label: "默认回复地址",
    placeholder: "support@example.com",
    type: "string",
  },
  {
    key: "allow_invalid_tls",
    label: "允许不校验证书",
    description:
      "仅建议在自建邮件服务器或自签名证书调试时开启，生产环境应保持关闭。",
    type: "boolean",
    default_value: false,
  },
  {
    key: "timeout_seconds",
    label: "超时秒数",
    type: "number",
    required: true,
    default_value: 10,
    min: 1,
    max: 30,
  },
  {
    key: "imap_host",
    label: "IMAP 主机",
    description:
      "可选，用于保存收信配置。当前通知发送流程只使用 SMTP，不会主动读取 IMAP。",
    placeholder: "imap.example.com",
    type: "string",
  },
  {
    key: "imap_port",
    label: "IMAP 端口",
    type: "number",
    default_value: 993,
    min: 1,
    max: 65535,
  },
  {
    key: "imap_security",
    label: "IMAP 加密方式",
    type: "select",
    default_value: "ssl_tls",
    options: [
      { label: "SSL/TLS", value: "ssl_tls" },
      { label: "STARTTLS", value: "starttls" },
      { label: "不加密", value: "none" },
    ],
  },
  {
    key: "imap_username",
    label: "IMAP 用户名",
    placeholder: "no-reply@example.com",
    type: "string",
  },
  {
    key: "imap_password",
    label: "IMAP 密码",
    placeholder: "password",
    type: "string",
    sensitive: true,
  },
  {
    key: "imap_mailbox",
    label: "IMAP 邮箱目录",
    placeholder: "INBOX",
    type: "string",
    default_value: "INBOX",
  },
];

const EMAIL_TARGET_SCHEMA: NotificationSchemaField[] = [
  {
    key: "to_addresses",
    label: "收件人覆盖",
    description: "可选。留空则使用提供商默认收件人。",
    placeholder: "team@example.com",
    type: "string",
  },
  {
    key: "cc_addresses",
    label: "抄送覆盖",
    placeholder: "audit@example.com",
    type: "string",
  },
  {
    key: "bcc_addresses",
    label: "密送覆盖",
    placeholder: "archive@example.com",
    type: "string",
  },
  {
    key: "reply_to",
    label: "回复地址覆盖",
    placeholder: "support@example.com",
    type: "string",
  },
  {
    key: "subject_prefix",
    label: "主题前缀",
    description: "可选，例如 [生产环境]。",
    placeholder: "[生产环境]",
    type: "string",
  },
];

export const emailProviderDefinition: NotificationProviderDefinition = {
  type: "email",
  label: "邮件",
  description:
    "通过 SMTP 发送邮件通知，同时支持保存 IMAP 配置项以便统一管理邮箱连接信息。",
  connection_schema: EMAIL_CONNECTION_SCHEMA,
  target_schema: EMAIL_TARGET_SCHEMA,
  sensitive_fields: ["smtp_password", "imap_password"],
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

const ASCII_HEADER_PATTERN = /^[\t\x20-\x7e]*$/;
const EMAIL_ADDRESS_PATTERN =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i;

const sanitizeHeaderValue = (value: string) =>
  value.replace(/[\r\n]+/g, " ").trim();

const encodeHeaderValue = (value: string) => {
  const sanitized = sanitizeHeaderValue(value);
  if (!sanitized) return "";
  if (ASCII_HEADER_PATTERN.test(sanitized)) {
    return sanitized;
  }
  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
};

const chunkBase64 = (value: string, lineLength = 76) => {
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += lineLength) {
    lines.push(value.slice(index, index + lineLength));
  }
  return lines.join("\r\n");
};

const normalizeSecurityMode = (value: unknown): EmailTransportSecurity => {
  const candidate = toTrimmedString(value).toLowerCase();
  if (
    candidate === "ssl_tls" ||
    candidate === "starttls" ||
    candidate === "none"
  ) {
    return candidate;
  }
  return "ssl_tls";
};

const normalizeAuthMode = (value: unknown): EmailAuthMode => {
  const candidate = toTrimmedString(value).toLowerCase();
  if (
    candidate === "auto" ||
    candidate === "plain" ||
    candidate === "login" ||
    candidate === "none"
  ) {
    return candidate;
  }
  return "auto";
};

const parsePort = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const port = Math.floor(parsed);
  if (port < 1 || port > 65535) return fallback;
  return port;
};

const extractEmailAddress = (value: string) => {
  const trimmed = value.trim();
  const angleMatch = trimmed.match(/<([^<>]+)>/);
  return (angleMatch?.[1] || trimmed).trim();
};

const parseEmailList = (value: unknown, fieldLabel: string) => {
  const items = splitCommaSeparatedValues(value);
  const result: string[] = [];

  for (const item of items) {
    const address = extractEmailAddress(item);
    if (!EMAIL_ADDRESS_PATTERN.test(address)) {
      throw new Error(`${fieldLabel} 中包含无效邮箱地址: ${item}`);
    }
    result.push(address);
  }

  return Array.from(new Set(result));
};

const formatMailbox = (address: string, displayName?: string) => {
  const encodedName = encodeHeaderValue(displayName || "");
  return encodedName ? `${encodedName} <${address}>` : address;
};

const resolveClientHostname = () => {
  const candidate = getHostname().trim().toLowerCase();
  if (!candidate) return "localhost";
  const normalized = candidate.replace(/[^a-z0-9.-]/g, "-");
  return normalized || "localhost";
};

const buildEmailSubject = (
  message: NotificationMessage,
  subjectPrefix = "",
) => {
  const title = toTrimmedString(message.title || "fn-knock 通知");
  const prefix = toTrimmedString(subjectPrefix);
  return [prefix, title].filter(Boolean).join(" ").trim() || "fn-knock 通知";
};

const buildPlainTextBody = (message: NotificationMessage) => {
  const sections: string[] = [];
  const summary = toTrimmedString(message.summary);
  const bodyText = toTrimmedString(message.body_text);

  if (summary) {
    sections.push(summary);
  }

  if (bodyText) {
    sections.push(bodyText);
  }

  if (message.facts.length > 0) {
    sections.push(
      [
        "详情:",
        ...message.facts.map((fact) => `${fact.label}: ${fact.value}`),
      ].join("\n"),
    );
  }

  if (message.actions.length > 0) {
    sections.push(
      [
        "操作链接:",
        ...message.actions.map((action) => `${action.label}: ${action.url}`),
      ].join("\n"),
    );
  }

  const footer: string[] = [`级别: ${message.severity}`];
  if (message.event_id) {
    footer.push(`事件 ID: ${message.event_id}`);
  }
  footer.push(`发生时间: ${message.occurred_at}`);
  sections.push(footer.join("\n"));

  return sections.filter(Boolean).join("\n\n").trim() || "fn-knock 通知";
};

const normalizeMessageForData = (message: string) =>
  message
    .replace(/\r?\n/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");

const buildMimeMessage = (args: {
  fromAddress: string;
  fromName?: string;
  to: string[];
  cc: string[];
  replyTo: string[];
  subject: string;
  bodyText: string;
}) => {
  const messageIdDomain =
    args.fromAddress.split("@")[1]?.trim() || resolveClientHostname();
  const headers = [
    `From: ${formatMailbox(args.fromAddress, args.fromName)}`,
    `To: ${args.to.length > 0 ? args.to.join(", ") : "undisclosed-recipients:;"}`,
    ...(args.cc.length > 0 ? [`Cc: ${args.cc.join(", ")}`] : []),
    ...(args.replyTo.length > 0
      ? [`Reply-To: ${args.replyTo.join(", ")}`]
      : []),
    `Subject: ${encodeHeaderValue(args.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${messageIdDomain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Mailer: fn-knock",
  ];

  const bodyBase64 = chunkBase64(
    Buffer.from(args.bodyText, "utf8").toString("base64"),
  );

  return `${headers.join("\r\n")}\r\n\r\n${bodyBase64}\r\n`;
};

type LineReader = {
  readLine: () => Promise<string>;
  dispose: () => void;
};

const createLineReader = (socket: Socket | TLSSocket): LineReader => {
  socket.setEncoding("utf8");

  let buffer = "";
  const pendingLines: string[] = [];
  const waiters: Array<{
    resolve: (value: string) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  const rejectAll = (reason: unknown) => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(reason);
    }
  };

  const flushBufferedLines = () => {
    while (pendingLines.length > 0 && waiters.length > 0) {
      waiters.shift()!.resolve(pendingLines.shift()!);
    }
  };

  const handleData = (chunk: string | Buffer) => {
    buffer += chunk.toString();
    while (true) {
      const lineBreakIndex = buffer.indexOf("\n");
      if (lineBreakIndex < 0) break;
      const rawLine = buffer.slice(0, lineBreakIndex);
      buffer = buffer.slice(lineBreakIndex + 1);
      pendingLines.push(rawLine.replace(/\r$/, ""));
    }
    flushBufferedLines();
  };

  const handleClose = () => {
    rejectAll(new Error("SMTP 连接已关闭"));
  };

  const handleError = (error: Error) => {
    rejectAll(error);
  };

  socket.on("data", handleData);
  socket.on("close", handleClose);
  socket.on("error", handleError);

  return {
    readLine: () =>
      new Promise<string>((resolve, reject) => {
        if (pendingLines.length > 0) {
          resolve(pendingLines.shift()!);
          return;
        }
        waiters.push({ resolve, reject });
      }),
    dispose: () => {
      socket.off("data", handleData);
      socket.off("close", handleClose);
      socket.off("error", handleError);
      rejectAll(new Error("SMTP 读取器已释放"));
    },
  };
};

const writeToSocket = (socket: Socket | TLSSocket, payload: string) =>
  new Promise<void>((resolve, reject) => {
    socket.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const readSmtpResponse = async (reader: LineReader): Promise<SmtpResponse> => {
  const firstLine = await reader.readLine();
  const code = Number.parseInt(firstLine.slice(0, 3), 10);
  if (!Number.isFinite(code)) {
    throw new Error(`无法解析 SMTP 响应: ${firstLine}`);
  }

  const lines = [firstLine];
  while (lines[lines.length - 1]?.startsWith(`${code}-`)) {
    lines.push(await reader.readLine());
  }

  return {
    code,
    lines,
    message: lines
      .map((line) => line.slice(4).trim())
      .filter(Boolean)
      .join("\n"),
  };
};

const connectSocket = async (args: {
  host: string;
  port: number;
  security: EmailTransportSecurity;
  rejectUnauthorized: boolean;
  timeoutMs: number;
}) => {
  const { host, port, security, rejectUnauthorized, timeoutMs } = args;

  if (security === "ssl_tls") {
    return new Promise<TLSSocket>((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized,
      });
      const onError = (error: Error) => {
        reject(error);
      };

      socket.setTimeout(timeoutMs, () => {
        socket.destroy(new Error("SMTP 连接超时"));
      });
      socket.once("secureConnect", () => {
        socket.off("error", onError);
        resolve(socket);
      });
      socket.once("error", onError);
    });
  }

  return new Promise<Socket>((resolve, reject) => {
    const socket = net.connect({ host, port });
    const onError = (error: Error) => {
      reject(error);
    };

    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error("SMTP 连接超时"));
    });
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
  });
};

const upgradeSocketToTls = async (args: {
  socket: Socket;
  host: string;
  rejectUnauthorized: boolean;
  timeoutMs: number;
}) => {
  const { socket, host, rejectUnauthorized, timeoutMs } = args;

  return new Promise<TLSSocket>((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: host,
      rejectUnauthorized,
    });

    const onError = (error: Error) => {
      reject(error);
    };

    secureSocket.setTimeout(timeoutMs, () => {
      secureSocket.destroy(new Error("SMTP TLS 握手超时"));
    });
    secureSocket.once("secureConnect", () => {
      secureSocket.off("error", onError);
      resolve(secureSocket);
    });
    secureSocket.once("error", onError);
  });
};

const expectResponseCode = (
  response: SmtpResponse,
  expectedCodes: number[],
  fallbackMessage: string,
) => {
  if (expectedCodes.includes(response.code)) {
    return response;
  }

  throw new SmtpCommandError(
    `${fallbackMessage}: ${response.code} ${response.message || "未知响应"}`,
    {
      retryable: response.code >= 400 && response.code < 500,
      response,
    },
  );
};

const sendCommand = async (args: {
  socket: Socket | TLSSocket;
  reader: LineReader;
  command: string;
  expectedCodes: number[];
  fallbackMessage: string;
}) => {
  await writeToSocket(args.socket, `${args.command}\r\n`);
  const response = await readSmtpResponse(args.reader);
  return expectResponseCode(response, args.expectedCodes, args.fallbackMessage);
};

const parseEhloCapabilities = (response: SmtpResponse) =>
  response.lines.map((line) => line.slice(4).trim()).filter(Boolean);

const extractAuthMechanisms = (capabilities: string[]) => {
  const authLine = capabilities.find((line) => /^AUTH(?:\s|=)/i.test(line));
  if (!authLine) return [];

  const value = authLine.replace(/^AUTH(?:\s|=)+/i, "").trim();
  return value
    .split(/\s+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
};

const chooseAuthMechanism = (
  authMode: EmailAuthMode,
  capabilities: string[],
) => {
  if (authMode === "none") return null;

  const mechanisms = extractAuthMechanisms(capabilities);
  if (authMode === "plain") {
    if (!mechanisms.includes("PLAIN")) {
      throw new Error("SMTP 服务器不支持 AUTH PLAIN");
    }
    return "PLAIN";
  }
  if (authMode === "login") {
    if (!mechanisms.includes("LOGIN")) {
      throw new Error("SMTP 服务器不支持 AUTH LOGIN");
    }
    return "LOGIN";
  }

  if (mechanisms.includes("PLAIN")) return "PLAIN";
  if (mechanisms.includes("LOGIN")) return "LOGIN";
  if (mechanisms.length === 0) return null;

  throw new Error(`SMTP 认证方式不受支持: ${mechanisms.join(", ")}`);
};

const performSmtpAuth = async (args: {
  socket: Socket | TLSSocket;
  reader: LineReader;
  mechanism: "PLAIN" | "LOGIN";
  username: string;
  password: string;
}) => {
  if (args.mechanism === "PLAIN") {
    const token = Buffer.from(
      `\u0000${args.username}\u0000${args.password}`,
      "utf8",
    ).toString("base64");
    await sendCommand({
      socket: args.socket,
      reader: args.reader,
      command: `AUTH PLAIN ${token}`,
      expectedCodes: [235],
      fallbackMessage: "SMTP 认证失败",
    });
    return;
  }

  await sendCommand({
    socket: args.socket,
    reader: args.reader,
    command: "AUTH LOGIN",
    expectedCodes: [334],
    fallbackMessage: "SMTP 认证失败",
  });
  await sendCommand({
    socket: args.socket,
    reader: args.reader,
    command: Buffer.from(args.username, "utf8").toString("base64"),
    expectedCodes: [334],
    fallbackMessage: "SMTP 用户名认证失败",
  });
  await sendCommand({
    socket: args.socket,
    reader: args.reader,
    command: Buffer.from(args.password, "utf8").toString("base64"),
    expectedCodes: [235],
    fallbackMessage: "SMTP 密码认证失败",
  });
};

const sendDataBlock = async (args: {
  socket: Socket | TLSSocket;
  reader: LineReader;
  data: string;
}) => {
  await sendCommand({
    socket: args.socket,
    reader: args.reader,
    command: "DATA",
    expectedCodes: [354],
    fallbackMessage: "SMTP DATA 阶段启动失败",
  });
  await writeToSocket(
    args.socket,
    `${normalizeMessageForData(args.data)}\r\n.\r\n`,
  );
  const response = await readSmtpResponse(args.reader);
  return expectResponseCode(response, [250], "SMTP 邮件提交失败");
};

const resolveEmailTargetConfig = (
  provider: NotificationProvider,
  context?: Partial<NotificationDispatchContext>,
) => {
  const providerConfig = provider.connection_config;
  const targetConfig = toPlainRecord(context?.target?.target_config);

  const to = parseEmailList(
    targetConfig.to_addresses ?? providerConfig.to_addresses,
    "收件人",
  );
  const cc = parseEmailList(
    targetConfig.cc_addresses ?? providerConfig.cc_addresses,
    "抄送",
  );
  const bcc = parseEmailList(
    targetConfig.bcc_addresses ?? providerConfig.bcc_addresses,
    "密送",
  );
  const replyTo = parseEmailList(
    targetConfig.reply_to ?? providerConfig.reply_to,
    "回复地址",
  );
  const fromAddress = extractEmailAddress(
    toTrimmedString(providerConfig.from_address),
  );

  if (!EMAIL_ADDRESS_PATTERN.test(fromAddress)) {
    throw new Error("发件邮箱格式不正确");
  }
  if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
    throw new Error("至少需要配置一个收件邮箱");
  }

  return {
    fromAddress,
    fromName: toTrimmedString(providerConfig.from_name),
    to,
    cc,
    bcc,
    replyTo,
    subjectPrefix: toTrimmedString(targetConfig.subject_prefix),
  };
};

export const sendEmailMessage = async (args: {
  provider: NotificationProvider;
  message: NotificationMessage;
  context?: Partial<NotificationDispatchContext>;
  timeoutSeconds: number;
}): Promise<NotificationSendResult> => {
  const providerConfig = args.provider.connection_config;
  const smtpHost = toTrimmedString(providerConfig.smtp_host);
  const smtpPort = parsePort(providerConfig.smtp_port, 465);
  const smtpSecurity = normalizeSecurityMode(providerConfig.smtp_security);
  const smtpAuthMode = normalizeAuthMode(providerConfig.smtp_auth_mode);
  const smtpUsername = toTrimmedString(providerConfig.smtp_username);
  const smtpPassword = toTrimmedString(providerConfig.smtp_password);
  const allowInvalidTls = Boolean(providerConfig.allow_invalid_tls);

  if (!smtpHost) {
    return {
      success: false,
      retryable: false,
      reason: "Missing SMTP host",
    };
  }

  const requestSummary: Record<string, unknown> = {
    host: smtpHost,
    port: smtpPort,
    security: smtpSecurity,
    auth_mode: smtpAuthMode,
    timeout_seconds: Math.max(1, args.timeoutSeconds),
    imap_configured: Boolean(toTrimmedString(providerConfig.imap_host)),
  };

  let lastResponse: SmtpResponse | undefined;
  let socket: Socket | TLSSocket | null = null;
  let reader: LineReader | null = null;

  try {
    const target = resolveEmailTargetConfig(args.provider, args.context);
    const allRecipients = Array.from(
      new Set([...target.to, ...target.cc, ...target.bcc]),
    );
    const timeoutMs = Math.max(1, args.timeoutSeconds) * 1000;
    const subject = buildEmailSubject(args.message, target.subjectPrefix);
    const bodyText = buildPlainTextBody(args.message);
    const data = buildMimeMessage({
      fromAddress: target.fromAddress,
      fromName: target.fromName,
      to: target.to,
      cc: target.cc,
      replyTo: target.replyTo,
      subject,
      bodyText,
    });

    requestSummary.from_address = target.fromAddress;
    requestSummary.recipient_count = allRecipients.length;
    requestSummary.to_count = target.to.length;
    requestSummary.cc_count = target.cc.length;
    requestSummary.bcc_count = target.bcc.length;
    requestSummary.subject_preview = truncateText(subject, 120);

    socket = await connectSocket({
      host: smtpHost,
      port: smtpPort,
      security: smtpSecurity,
      rejectUnauthorized: !allowInvalidTls,
      timeoutMs,
    });
    reader = createLineReader(socket);

    lastResponse = await readSmtpResponse(reader);
    expectResponseCode(lastResponse, [220], "SMTP 服务端握手失败");

    const ehloCommand = `EHLO ${resolveClientHostname()}`;
    lastResponse = await sendCommand({
      socket,
      reader,
      command: ehloCommand,
      expectedCodes: [250],
      fallbackMessage: "SMTP EHLO 失败",
    });

    let capabilities = parseEhloCapabilities(lastResponse);

    if (smtpSecurity === "starttls") {
      const supportsStartTls = capabilities.some((line) =>
        /^STARTTLS$/i.test(line),
      );
      if (!supportsStartTls) {
        throw new Error("SMTP 服务器未声明 STARTTLS 能力");
      }

      lastResponse = await sendCommand({
        socket,
        reader,
        command: "STARTTLS",
        expectedCodes: [220],
        fallbackMessage: "SMTP STARTTLS 失败",
      });

      reader.dispose();
      reader = null;
      socket = await upgradeSocketToTls({
        socket: socket as Socket,
        host: smtpHost,
        rejectUnauthorized: !allowInvalidTls,
        timeoutMs,
      });
      reader = createLineReader(socket);

      lastResponse = await sendCommand({
        socket,
        reader,
        command: ehloCommand,
        expectedCodes: [250],
        fallbackMessage: "SMTP TLS 升级后 EHLO 失败",
      });
      capabilities = parseEhloCapabilities(lastResponse);
    }

    const authMechanism = chooseAuthMechanism(smtpAuthMode, capabilities);
    if (authMechanism) {
      if (!smtpUsername || !smtpPassword) {
        throw new Error("SMTP 用户名和密码不能为空");
      }
      requestSummary.auth_mechanism = authMechanism;
      await performSmtpAuth({
        socket,
        reader,
        mechanism: authMechanism,
        username: smtpUsername,
        password: smtpPassword,
      });
    } else if (smtpAuthMode !== "none" && (smtpUsername || smtpPassword)) {
      throw new Error("SMTP 服务器未提供可用的认证方式");
    }

    lastResponse = await sendCommand({
      socket,
      reader,
      command: `MAIL FROM:<${target.fromAddress}>`,
      expectedCodes: [250],
      fallbackMessage: "SMTP 发件人设置失败",
    });

    for (const recipient of allRecipients) {
      lastResponse = await sendCommand({
        socket,
        reader,
        command: `RCPT TO:<${recipient}>`,
        expectedCodes: [250, 251],
        fallbackMessage: `SMTP 收件人 ${recipient} 设置失败`,
      });
    }

    lastResponse = await sendDataBlock({
      socket,
      reader,
      data,
    });

    await sendCommand({
      socket,
      reader,
      command: "QUIT",
      expectedCodes: [221],
      fallbackMessage: "SMTP 退出失败",
    }).catch(() => {});

    reader.dispose();
    reader = null;
    socket.destroy();
    socket = null;

    return {
      success: true,
      retryable: false,
      request_summary: requestSummary,
      response_summary: {
        code: lastResponse.code,
        message_preview: truncateText(lastResponse.message, 240),
      },
    };
  } catch (error) {
    const smtpError = error instanceof SmtpCommandError ? error : null;
    const response = smtpError?.response || lastResponse;
    const reason =
      error instanceof Error ? error.message : "Email delivery failed";

    if (reader) {
      reader.dispose();
    }
    if (socket && !socket.destroyed) {
      socket.destroy();
    }

    return {
      success: false,
      retryable:
        smtpError?.retryable ??
        (response ? response.code >= 400 && response.code < 500 : true),
      reason,
      request_summary: requestSummary,
      response_summary: response
        ? {
            code: response.code,
            lines: response.lines.map((line) => truncateText(line, 240)),
          }
        : undefined,
    };
  }
};
