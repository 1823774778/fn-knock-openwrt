import type {
  NotificationMessage,
  NotificationMessageAction,
  NotificationMessageFact,
} from "./types";

export const NOTIFICATION_BRAND_PREFIX = "敲门 Knock ";
export const DEFAULT_NOTIFICATION_TITLE = `${NOTIFICATION_BRAND_PREFIX}通知`;

const trimValue = (value: unknown) => String(value ?? "").trim();

const normalizeFact = (
  fact: NotificationMessageFact,
): NotificationMessageFact | null => {
  const label = trimValue(fact.label);
  const value = trimValue(fact.value);
  if (!label && !value) return null;
  return {
    label,
    value,
  };
};

const normalizeAction = (
  action: NotificationMessageAction,
): NotificationMessageAction | null => {
  const label = trimValue(action.label);
  const url = trimValue(action.url);
  if (!label || !url) return null;
  return {
    label,
    url,
  };
};

export const brandNotificationTitle = (title?: string) => {
  const normalized = trimValue(title);
  if (!normalized) return DEFAULT_NOTIFICATION_TITLE;
  if (normalized.startsWith(NOTIFICATION_BRAND_PREFIX)) {
    return normalized;
  }
  return `${NOTIFICATION_BRAND_PREFIX}${normalized}`;
};

export const normalizeNotificationMessage = (
  message: NotificationMessage,
): NotificationMessage => ({
  ...message,
  title: brandNotificationTitle(message.title),
  summary: trimValue(message.summary),
  body_text: trimValue(message.body_text),
  body_markdown: trimValue(message.body_markdown),
  facts: (message.facts || [])
    .map((fact) => normalizeFact(fact))
    .filter((fact): fact is NotificationMessageFact => Boolean(fact)),
  actions: (message.actions || [])
    .map((action) => normalizeAction(action))
    .filter((action): action is NotificationMessageAction => Boolean(action)),
  mentions: Array.from(
    new Set((message.mentions || []).map((mention) => trimValue(mention))),
  ).filter(Boolean),
});
