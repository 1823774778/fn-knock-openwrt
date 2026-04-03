import type { NotificationMessage } from "../types";

export const truncateText = (value: string, limit = 500) =>
  value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;

export const toPlainRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
};

export const toTrimmedString = (value: unknown) => String(value ?? "").trim();

export const splitCommaSeparatedValues = (value: unknown) =>
  toTrimmedString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const resolvePrimaryActionUrl = (message: NotificationMessage) =>
  message.actions.find((action) => toTrimmedString(action.url))?.url?.trim() ||
  "";

export const resolveOptionalNonNegativeInteger = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
};

export const resolveOptionalStrictPositiveInteger = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
};
