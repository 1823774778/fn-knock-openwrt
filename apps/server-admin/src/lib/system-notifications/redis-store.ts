import { redis } from "../redis";
import type {
  NotificationDelivery,
  NotificationDeliveryClearQuery,
  NotificationDeliveryListQuery,
  NotificationDeliveryListResult,
  NotificationProvider,
  NotificationRule,
  NotificationTrigger,
  NotificationTriggerListQuery,
  NotificationTriggerListResult,
} from "./types";

const ROOT_KEY = "fn_knock:notifications";

const PROVIDERS_INDEX_KEY = `${ROOT_KEY}:providers:index`;
const PROVIDERS_DATA_KEY_PREFIX = `${ROOT_KEY}:providers:data:`;
const RULES_INDEX_KEY = `${ROOT_KEY}:rules:index`;
const RULES_DATA_KEY_PREFIX = `${ROOT_KEY}:rules:data:`;
const TRIGGERS_INDEX_KEY = `${ROOT_KEY}:triggers:index`;
const TRIGGERS_DATA_KEY_PREFIX = `${ROOT_KEY}:triggers:data:`;
const DELIVERIES_INDEX_KEY = `${ROOT_KEY}:deliveries:index`;
const DELIVERIES_DATA_KEY_PREFIX = `${ROOT_KEY}:deliveries:data:`;
const DELIVERIES_READY_KEY = `${ROOT_KEY}:deliveries:ready`;
const RUNTIME_LAST_STREAM_KEY = `${ROOT_KEY}:runtime:last-stream-id`;
const RUNTIME_LOCK_PREFIX = `${ROOT_KEY}:runtime:lock:`;
const RUNTIME_COOLDOWN_PREFIX = `${ROOT_KEY}:runtime:cooldown:`;
const RUNTIME_WINDOW_PREFIX = `${ROOT_KEY}:runtime:window:`;
const LIST_SCAN_CHUNK_SIZE = 200;
const HISTORY_RETENTION_DAYS = 30;
const HISTORY_RETENTION_TTL_SECONDS = HISTORY_RETENTION_DAYS * 24 * 60 * 60;

const encodeKeyPart = (value: string) =>
  Buffer.from(value || "empty").toString("base64url");

const toTimestamp = (
  value: string | null | undefined,
  fallback = Date.now(),
) => {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : fallback;
};

const toPositiveInt = (value: number, fallback: number, max = 100) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const getProviderKey = (id: string) => `${PROVIDERS_DATA_KEY_PREFIX}${id}`;
const getRuleKey = (id: string) => `${RULES_DATA_KEY_PREFIX}${id}`;
const getTriggerKey = (id: string) => `${TRIGGERS_DATA_KEY_PREFIX}${id}`;
const getDeliveryKey = (id: string) => `${DELIVERIES_DATA_KEY_PREFIX}${id}`;
const getRuntimeLockKey = (name: string) => `${RUNTIME_LOCK_PREFIX}${name}`;
const getCooldownKey = (ruleId: string, groupKey: string) =>
  `${RUNTIME_COOLDOWN_PREFIX}${ruleId}:${encodeKeyPart(groupKey)}`;
const getWindowKey = (ruleId: string, groupKey: string) =>
  `${RUNTIME_WINDOW_PREFIX}${ruleId}:${encodeKeyPart(groupKey)}`;

const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const getJsonList = async <T>(
  ids: string[],
  dataKeyFactory: (id: string) => string,
) => {
  if (!ids.length) return { items: [] as T[], staleIds: [] as string[] };
  const rawRecords = await redis.mget(ids.map((id) => dataKeyFactory(id)));
  const items: T[] = [];
  const staleIds: string[] = [];

  rawRecords.forEach((raw, index) => {
    const id = ids[index];
    if (!id) return;
    const parsed = safeParse<T>(raw);
    if (!parsed) {
      staleIds.push(id);
      return;
    }
    items.push(parsed);
  });

  return { items, staleIds };
};

const chunkArray = <T>(items: T[], chunkSize = LIST_SCAN_CHUNK_SIZE) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const getHistoryCutoffMs = (retentionTtlSeconds: number) =>
  Date.now() - retentionTtlSeconds * 1000;

const getHistoryTtlSeconds = (
  happenedAt: string | null | undefined,
  retentionTtlSeconds: number,
) => {
  const expiresAtMs = toTimestamp(happenedAt) + retentionTtlSeconds * 1000;
  return Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
};

export class RedisNotificationStore {
  private async touchTriggerIndex(trigger: NotificationTrigger) {
    await redis
      .pipeline()
      .zadd(TRIGGERS_INDEX_KEY, toTimestamp(trigger.created_at), trigger.id)
      .zremrangebyscore(
        TRIGGERS_INDEX_KEY,
        0,
        getHistoryCutoffMs(HISTORY_RETENTION_TTL_SECONDS),
      )
      .exec();
  }

  private async touchDeliveryIndex(delivery: NotificationDelivery) {
    await redis
      .pipeline()
      .zadd(
        DELIVERIES_INDEX_KEY,
        toTimestamp(delivery.triggered_at),
        delivery.id,
      )
      .zremrangebyscore(
        DELIVERIES_INDEX_KEY,
        0,
        getHistoryCutoffMs(HISTORY_RETENTION_TTL_SECONDS),
      )
      .exec();
  }

  private async pruneTriggerIndex() {
    await redis.zremrangebyscore(
      TRIGGERS_INDEX_KEY,
      0,
      getHistoryCutoffMs(HISTORY_RETENTION_TTL_SECONDS),
    );
  }

  private async pruneDeliveryIndex() {
    await redis.zremrangebyscore(
      DELIVERIES_INDEX_KEY,
      0,
      getHistoryCutoffMs(HISTORY_RETENTION_TTL_SECONDS),
    );
  }

  async listProviders(): Promise<NotificationProvider[]> {
    const ids = await redis.zrevrange(PROVIDERS_INDEX_KEY, 0, -1);
    const batch = await getJsonList<NotificationProvider>(ids, getProviderKey);
    if (batch.staleIds.length) {
      await redis.zrem(PROVIDERS_INDEX_KEY, ...batch.staleIds);
    }
    return batch.items;
  }

  async getProvider(id: string): Promise<NotificationProvider | null> {
    return safeParse<NotificationProvider>(await redis.get(getProviderKey(id)));
  }

  async saveProvider(provider: NotificationProvider): Promise<void> {
    await redis
      .pipeline()
      .set(getProviderKey(provider.id), JSON.stringify(provider))
      .zadd(PROVIDERS_INDEX_KEY, toTimestamp(provider.updated_at), provider.id)
      .exec();
  }

  async deleteProvider(id: string): Promise<void> {
    await redis
      .pipeline()
      .del(getProviderKey(id))
      .zrem(PROVIDERS_INDEX_KEY, id)
      .exec();
  }

  async listRules(): Promise<NotificationRule[]> {
    const ids = await redis.zrevrange(RULES_INDEX_KEY, 0, -1);
    const batch = await getJsonList<NotificationRule>(ids, getRuleKey);
    if (batch.staleIds.length) {
      await redis.zrem(RULES_INDEX_KEY, ...batch.staleIds);
    }
    return batch.items;
  }

  async getRule(id: string): Promise<NotificationRule | null> {
    return safeParse<NotificationRule>(await redis.get(getRuleKey(id)));
  }

  async saveRule(rule: NotificationRule): Promise<void> {
    await redis
      .pipeline()
      .set(getRuleKey(rule.id), JSON.stringify(rule))
      .zadd(RULES_INDEX_KEY, toTimestamp(rule.updated_at), rule.id)
      .exec();
  }

  async deleteRule(id: string): Promise<void> {
    await redis.pipeline().del(getRuleKey(id)).zrem(RULES_INDEX_KEY, id).exec();
  }

  async saveTrigger(trigger: NotificationTrigger): Promise<void> {
    await redis
      .pipeline()
      .set(
        getTriggerKey(trigger.id),
        JSON.stringify(trigger),
        "EX",
        getHistoryTtlSeconds(trigger.created_at, HISTORY_RETENTION_TTL_SECONDS),
      )
      .zadd(TRIGGERS_INDEX_KEY, toTimestamp(trigger.created_at), trigger.id)
      .zremrangebyscore(
        TRIGGERS_INDEX_KEY,
        0,
        getHistoryCutoffMs(HISTORY_RETENTION_TTL_SECONDS),
      )
      .exec();
  }

  async saveTriggerIfAbsent(trigger: NotificationTrigger): Promise<boolean> {
    const result = await (redis as any).set(
      getTriggerKey(trigger.id),
      JSON.stringify(trigger),
      "EX",
      getHistoryTtlSeconds(trigger.created_at, HISTORY_RETENTION_TTL_SECONDS),
      "NX",
    );
    if (result === "OK") {
      await this.touchTriggerIndex(trigger);
      return true;
    }

    const existing = await this.getTrigger(trigger.id);
    if (existing) {
      await this.touchTriggerIndex(existing);
    }
    return false;
  }

  async getTrigger(id: string): Promise<NotificationTrigger | null> {
    return safeParse<NotificationTrigger>(await redis.get(getTriggerKey(id)));
  }

  async listTriggers(
    query: NotificationTriggerListQuery,
  ): Promise<NotificationTriggerListResult> {
    await this.pruneTriggerIndex();

    const safePage = toPositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
    const safeLimit = toPositiveInt(query.limit, 20);
    const pageStart = (safePage - 1) * safeLimit;
    let offset = 0;
    let matchedTotal = 0;
    const triggers: NotificationTrigger[] = [];
    const staleIds: string[] = [];

    while (true) {
      const ids = await redis.zrevrange(
        TRIGGERS_INDEX_KEY,
        offset,
        offset + LIST_SCAN_CHUNK_SIZE - 1,
      );
      if (!ids.length) break;
      offset += ids.length;

      const batch = await getJsonList<NotificationTrigger>(ids, getTriggerKey);
      staleIds.push(...batch.staleIds);

      for (const trigger of batch.items) {
        if (query.rule_id && trigger.rule_id !== query.rule_id) continue;
        if (query.status && trigger.status !== query.status) continue;
        if (matchedTotal >= pageStart && triggers.length < safeLimit) {
          triggers.push(trigger);
        }
        matchedTotal += 1;
      }
    }

    if (staleIds.length) {
      await redis.zrem(TRIGGERS_INDEX_KEY, ...staleIds);
    }

    return { triggers, total: matchedTotal };
  }

  async saveDelivery(delivery: NotificationDelivery): Promise<void> {
    await redis
      .pipeline()
      .set(
        getDeliveryKey(delivery.id),
        JSON.stringify(delivery),
        "EX",
        getHistoryTtlSeconds(
          delivery.triggered_at,
          HISTORY_RETENTION_TTL_SECONDS,
        ),
      )
      .zadd(
        DELIVERIES_INDEX_KEY,
        toTimestamp(delivery.triggered_at),
        delivery.id,
      )
      .zremrangebyscore(
        DELIVERIES_INDEX_KEY,
        0,
        getHistoryCutoffMs(HISTORY_RETENTION_TTL_SECONDS),
      )
      .exec();
  }

  async saveDeliveryIfAbsent(delivery: NotificationDelivery): Promise<boolean> {
    const result = await (redis as any).set(
      getDeliveryKey(delivery.id),
      JSON.stringify(delivery),
      "EX",
      getHistoryTtlSeconds(
        delivery.triggered_at,
        HISTORY_RETENTION_TTL_SECONDS,
      ),
      "NX",
    );
    if (result === "OK") {
      await this.touchDeliveryIndex(delivery);
      return true;
    }

    const existing = await this.getDelivery(delivery.id);
    if (existing) {
      await this.touchDeliveryIndex(existing);
    }
    return false;
  }

  async getDelivery(id: string): Promise<NotificationDelivery | null> {
    return safeParse<NotificationDelivery>(await redis.get(getDeliveryKey(id)));
  }

  async listDeliveries(
    query: NotificationDeliveryListQuery,
  ): Promise<NotificationDeliveryListResult> {
    await this.pruneDeliveryIndex();

    const safePage = toPositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
    const safeLimit = toPositiveInt(query.limit, 20);
    const pageStart = (safePage - 1) * safeLimit;
    let offset = 0;
    let matchedTotal = 0;
    const deliveries: NotificationDelivery[] = [];
    const staleIds: string[] = [];

    while (true) {
      const ids = await redis.zrevrange(
        DELIVERIES_INDEX_KEY,
        offset,
        offset + LIST_SCAN_CHUNK_SIZE - 1,
      );
      if (!ids.length) break;
      offset += ids.length;

      const batch = await getJsonList<NotificationDelivery>(
        ids,
        getDeliveryKey,
      );
      staleIds.push(...batch.staleIds);

      for (const delivery of batch.items) {
        if (query.rule_id && delivery.rule_id !== query.rule_id) continue;
        if (query.provider_id && delivery.provider_id !== query.provider_id) {
          continue;
        }
        if (query.status && delivery.status !== query.status) continue;
        if (query.trigger_id && delivery.trigger_id !== query.trigger_id) {
          continue;
        }
        if (matchedTotal >= pageStart && deliveries.length < safeLimit) {
          deliveries.push(delivery);
        }
        matchedTotal += 1;
      }
    }

    if (staleIds.length) {
      await redis.zrem(DELIVERIES_INDEX_KEY, ...staleIds);
    }

    return { deliveries, total: matchedTotal };
  }

  async clearDeliveries(
    query: NotificationDeliveryClearQuery,
  ): Promise<number> {
    await this.pruneDeliveryIndex();

    let offset = 0;
    const matchedIds: string[] = [];
    const staleIds: string[] = [];

    while (true) {
      const ids = await redis.zrevrange(
        DELIVERIES_INDEX_KEY,
        offset,
        offset + LIST_SCAN_CHUNK_SIZE - 1,
      );
      if (!ids.length) break;
      offset += ids.length;

      const batch = await getJsonList<NotificationDelivery>(
        ids,
        getDeliveryKey,
      );
      staleIds.push(...batch.staleIds);

      for (const delivery of batch.items) {
        if (query.rule_id && delivery.rule_id !== query.rule_id) continue;
        if (query.provider_id && delivery.provider_id !== query.provider_id) {
          continue;
        }
        if (query.status && delivery.status !== query.status) continue;
        if (query.trigger_id && delivery.trigger_id !== query.trigger_id) {
          continue;
        }
        matchedIds.push(delivery.id);
      }
    }

    if (!matchedIds.length && !staleIds.length) {
      return 0;
    }

    const pipeline = redis.pipeline();

    for (const ids of chunkArray(staleIds)) {
      if (ids.length) {
        pipeline.zrem(DELIVERIES_INDEX_KEY, ...ids);
      }
    }

    for (const ids of chunkArray(matchedIds)) {
      if (!ids.length) continue;
      pipeline.del(...ids.map((id) => getDeliveryKey(id)));
      pipeline.zrem(DELIVERIES_INDEX_KEY, ...ids);
      pipeline.zrem(DELIVERIES_READY_KEY, ...ids);
    }

    await pipeline.exec();
    return matchedIds.length;
  }

  async listDeliveriesByTrigger(
    triggerId: string,
  ): Promise<NotificationDelivery[]> {
    await this.pruneDeliveryIndex();

    let offset = 0;
    const deliveries: NotificationDelivery[] = [];
    const staleIds: string[] = [];

    while (true) {
      const ids = await redis.zrevrange(
        DELIVERIES_INDEX_KEY,
        offset,
        offset + LIST_SCAN_CHUNK_SIZE - 1,
      );
      if (!ids.length) break;
      offset += ids.length;

      const batch = await getJsonList<NotificationDelivery>(
        ids,
        getDeliveryKey,
      );
      staleIds.push(...batch.staleIds);

      for (const delivery of batch.items) {
        if (delivery.trigger_id === triggerId) {
          deliveries.push(delivery);
        }
      }
    }

    if (staleIds.length) {
      await redis.zrem(DELIVERIES_INDEX_KEY, ...staleIds);
    }

    return deliveries;
  }

  async enqueueDelivery(id: string, readyAtMs: number): Promise<void> {
    await redis.zadd(DELIVERIES_READY_KEY, readyAtMs, id);
  }

  async pullReadyDeliveryIds(limit: number, nowMs = Date.now()) {
    const safeLimit = toPositiveInt(limit, 10);
    const ids = (await (redis as any).eval(
      `
        local ids = redis.call(
          'ZRANGEBYSCORE',
          KEYS[1],
          '-inf',
          ARGV[1],
          'LIMIT',
          0,
          tonumber(ARGV[2])
        )
        if #ids == 0 then
          return ids
        end
        redis.call('ZREM', KEYS[1], unpack(ids))
        return ids
      `,
      1,
      DELIVERIES_READY_KEY,
      nowMs,
      safeLimit,
    )) as string[] | null;
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  }

  async getLastStreamId(): Promise<string | null> {
    return (await redis.get(RUNTIME_LAST_STREAM_KEY)) || null;
  }

  async setLastStreamId(id: string): Promise<void> {
    await redis.set(RUNTIME_LAST_STREAM_KEY, id);
  }

  async acquireRuntimeLease(
    name: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await (redis as any).set(
      getRuntimeLockKey(name),
      token,
      "EX",
      Math.max(1, Math.ceil(ttlSeconds)),
      "NX",
    );
    return result === "OK";
  }

  async releaseRuntimeLease(name: string, token: string): Promise<void> {
    await (redis as any).eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
      1,
      getRuntimeLockKey(name),
      token,
    );
  }

  async appendWindowHit(args: {
    ruleId: string;
    groupKey: string;
    eventId: string;
    happenedAtMs: number;
    windowSeconds: number;
  }): Promise<number> {
    const key = getWindowKey(args.ruleId, args.groupKey);
    const windowMs = Math.max(1, args.windowSeconds) * 1000;
    const startScore = Math.max(0, args.happenedAtMs - windowMs);

    const pipeline = redis.pipeline();
    pipeline.zadd(key, args.happenedAtMs, args.eventId);
    pipeline.zremrangebyscore(key, 0, startScore - 1);
    pipeline.expire(key, Math.max(60, args.windowSeconds * 2));
    pipeline.zcount(key, startScore, args.happenedAtMs);
    const result = await pipeline.exec();
    const countResult = result?.[3]?.[1];
    const count = Number(countResult);
    return Number.isFinite(count) ? count : 0;
  }

  async getCooldownUntil(
    ruleId: string,
    groupKey: string,
  ): Promise<string | null> {
    return (await redis.get(getCooldownKey(ruleId, groupKey))) || null;
  }

  async setCooldown(args: {
    ruleId: string;
    groupKey: string;
    until: string;
    cooldownSeconds: number;
  }): Promise<void> {
    if (args.cooldownSeconds <= 0) return;
    await redis.set(
      getCooldownKey(args.ruleId, args.groupKey),
      args.until,
      "EX",
      Math.max(1, args.cooldownSeconds),
    );
  }
}

export const redisNotificationStore = new RedisNotificationStore();
