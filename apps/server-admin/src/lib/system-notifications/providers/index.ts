import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationProviderType,
  NotificationSendResult,
} from "../types";
import { barkProviderDefinition, sendBarkMessage } from "./bark";
import { pushdeerProviderDefinition, sendPushDeerMessage } from "./pushdeer";
import { telegramProviderDefinition, sendTelegramMessage } from "./telegram";
import { webhookProviderDefinition, sendWebhookMessage } from "./webhook";

type NotificationProviderRegistration = {
  definition: NotificationProviderDefinition;
  send: (args: {
    provider: NotificationProvider;
    message: NotificationMessage;
    context?: Partial<NotificationDispatchContext>;
    timeoutSeconds: number;
  }) => Promise<NotificationSendResult>;
};

const PROVIDER_REGISTRY = {
  webhook: {
    definition: webhookProviderDefinition,
    send: sendWebhookMessage,
  },
  pushdeer: {
    definition: pushdeerProviderDefinition,
    send: sendPushDeerMessage,
  },
  bark: {
    definition: barkProviderDefinition,
    send: sendBarkMessage,
  },
  telegram: {
    definition: telegramProviderDefinition,
    send: sendTelegramMessage,
  },
} satisfies Record<NotificationProviderType, NotificationProviderRegistration>;

export const listRegisteredNotificationProviders = () =>
  Object.values(PROVIDER_REGISTRY);

export const getRegisteredNotificationProvider = (type: string) =>
  PROVIDER_REGISTRY[type as NotificationProviderType] || null;
