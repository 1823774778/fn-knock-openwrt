import {
  getRegisteredNotificationProvider,
  listRegisteredNotificationProviders,
} from "./providers";
import { normalizeNotificationMessage } from "./brand";
import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDetailView,
  NotificationProviderDefinition,
  NotificationProviderView,
  NotificationSendResult,
} from "./types";

const maskSensitiveValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    return value.length <= 8 ? "********" : `${value.slice(0, 2)}******`;
  }
  return "[configured]";
};

export const listNotificationProviderDefinitions = () =>
  listRegisteredNotificationProviders().map(
    (registration) => registration.definition,
  );

export const getNotificationProviderDefinition = (
  type: string,
): NotificationProviderDefinition | null =>
  getRegisteredNotificationProvider(type)?.definition || null;

export const maskNotificationProvider = (
  provider: NotificationProvider,
): NotificationProviderView => {
  const definition = getNotificationProviderDefinition(provider.type);
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(provider.connection_config)) {
    masked[key] = definition?.sensitive_fields.includes(key)
      ? maskSensitiveValue(value)
      : value;
  }

  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    enabled: provider.enabled,
    created_at: provider.created_at,
    updated_at: provider.updated_at,
    last_test_at: provider.last_test_at,
    last_test_status: provider.last_test_status,
    last_error: provider.last_error,
    connection_config_masked: masked,
  };
};

export const revealNotificationProvider = (
  provider: NotificationProvider,
): NotificationProviderDetailView => ({
  ...maskNotificationProvider(provider),
  connection_config: {
    ...provider.connection_config,
  },
});

export const sendNotificationWithProvider = async (
  provider: NotificationProvider,
  message: NotificationMessage,
  context?: Partial<NotificationDispatchContext>,
  timeoutSeconds = 5,
): Promise<NotificationSendResult> => {
  const registration = getRegisteredNotificationProvider(provider.type);
  if (!registration) {
    return {
      success: false,
      retryable: false,
      reason: `Unsupported notification provider type: ${provider.type}`,
    };
  }

  const normalizedMessage = normalizeNotificationMessage(message);

  return registration.send({
    provider,
    message: normalizedMessage,
    context,
    timeoutSeconds,
  });
};
