import { createHash } from "node:crypto";
import { normalizeIp } from "../ip-normalize";
import type { SSHLoginLogEntry } from "./types";

const ACCEPTED_RE =
  /\bAccepted\s+(\S+)\s+for\s+(.+?)\s+from\s+(\S+)\s+port\s+(\d+)\b/i;
const FAILED_INVALID_RE =
  /\bFailed\s+(\S+)\s+for\s+invalid user\s+(.+?)\s+from\s+(\S+)\s+port\s+(\d+)\b/i;
const FAILED_RE =
  /\bFailed\s+(\S+)\s+for\s+(.+?)\s+from\s+(\S+)\s+port\s+(\d+)\b/i;

const fingerprint = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

const normalizeUsername = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const buildEntry = (input: {
  happenedAt: string;
  outcome: SSHLoginLogEntry["outcome"];
  authMethod?: string;
  username: string;
  invalidUser: boolean;
  ip: string;
  port?: number;
  source: SSHLoginLogEntry["source"];
  raw: string;
}): SSHLoginLogEntry | null => {
  const normalizedIp = normalizeIp(input.ip);
  if (!normalizedIp) return null;

  const happenedAtMs = Date.parse(input.happenedAt);
  const happenedAt = Number.isFinite(happenedAtMs)
    ? new Date(happenedAtMs).toISOString()
    : new Date().toISOString();
  const username = normalizeUsername(input.username) || "-";
  const raw = input.raw.trim();
  const port =
    typeof input.port === "number" && Number.isFinite(input.port)
      ? input.port
      : undefined;
  const id = fingerprint(
    [
      input.source,
      happenedAt,
      input.outcome,
      username,
      normalizedIp,
      port ?? "",
      raw,
    ].join("|"),
  );

  return {
    id,
    happened_at: happenedAt,
    outcome: input.outcome,
    username,
    invalid_user: input.invalidUser,
    ip: normalizedIp,
    ...(port ? { port } : {}),
    ...(input.authMethod ? { auth_method: input.authMethod } : {}),
    service: "sshd",
    source: input.source,
    raw,
  };
};

export const parseSSHLogMessage = (input: {
  message: string;
  happenedAt: string;
  source: SSHLoginLogEntry["source"];
}): SSHLoginLogEntry | null => {
  const message = input.message.trim();
  if (!message) return null;

  const accepted = ACCEPTED_RE.exec(message);
  if (accepted) {
    return buildEntry({
      happenedAt: input.happenedAt,
      outcome: "success",
      authMethod: accepted[1],
      username: accepted[2] ?? "",
      invalidUser: false,
      ip: accepted[3] ?? "",
      port: Number.parseInt(accepted[4] ?? "", 10),
      source: input.source,
      raw: message,
    });
  }

  const failedInvalid = FAILED_INVALID_RE.exec(message);
  if (failedInvalid) {
    return buildEntry({
      happenedAt: input.happenedAt,
      outcome: "failure",
      authMethod: failedInvalid[1],
      username: failedInvalid[2] ?? "",
      invalidUser: true,
      ip: failedInvalid[3] ?? "",
      port: Number.parseInt(failedInvalid[4] ?? "", 10),
      source: input.source,
      raw: message,
    });
  }

  const failed = FAILED_RE.exec(message);
  if (failed) {
    return buildEntry({
      happenedAt: input.happenedAt,
      outcome: "failure",
      authMethod: failed[1],
      username: failed[2] ?? "",
      invalidUser: false,
      ip: failed[3] ?? "",
      port: Number.parseInt(failed[4] ?? "", 10),
      source: input.source,
      raw: message,
    });
  }

  return null;
};
