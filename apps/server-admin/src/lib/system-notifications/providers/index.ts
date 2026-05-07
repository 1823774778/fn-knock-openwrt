import type {
  NotificationDispatchContext,
  NotificationMessage,
  NotificationProvider,
  NotificationProviderDefinition,
  NotificationProviderType,
  NotificationSendResult,
} from "../types";
import { barkProviderDefinition, sendBarkMessage } from "./bark";
import { dingtalkProviderDefinition, sendDingTalkMessage } from "./dingtalk";
import { emailProviderDefinition, sendEmailMessage } from "./email";
import { feishuProviderDefinition, sendFeishuMessage } from "./feishu";
import { magicpushProviderDefinition, sendMagicPushMessage } from "./magicpush";
import { pushdeerProviderDefinition, sendPushDeerMessage } from "./pushdeer";
import { pushplusProviderDefinition, sendPushPlusMessage } from "./pushplus";
import {
  sendServerChanMessage,
  serverchanProviderDefinition,
} from "./serverchan";
import { telegramProviderDefinition, sendTelegramMessage } from "./telegram";
import { wecomProviderDefinition, sendWecomMessage } from "./wecom";
import { webhookProviderDefinition, sendWebhookMessage } from "./webhook";
import { wxpusherProviderDefinition, sendWxPusherMessage } from "./wxpusher";

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
  wxpusher: {
    definition: wxpusherProviderDefinition,
    send: sendWxPusherMessage,
  },
  serverchan: {
    definition: serverchanProviderDefinition,
    send: sendServerChanMessage,
  },
  pushplus: {
    definition: pushplusProviderDefinition,
    send: sendPushPlusMessage,
  },
  wecom: {
    definition: wecomProviderDefinition,
    send: sendWecomMessage,
  },
  dingtalk: {
    definition: dingtalkProviderDefinition,
    send: sendDingTalkMessage,
  },
  feishu: {
    definition: feishuProviderDefinition,
    send: sendFeishuMessage,
  },
  email: {
    definition: emailProviderDefinition,
    send: sendEmailMessage,
  },
  webhook: {
    definition: webhookProviderDefinition,
    send: sendWebhookMessage,
  },
  pushdeer: {
    definition: pushdeerProviderDefinition,
    send: sendPushDeerMessage,
  },
  magicpush: {
    definition: magicpushProviderDefinition,
    send: sendMagicPushMessage,
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
