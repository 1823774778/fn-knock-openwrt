import { randomBytes } from "node:crypto";
import { redis } from "../redis";
import { systemNotificationService } from "./service";
import { redisNotificationStore } from "./redis-store";
import type { SystemEventEnvelope } from "../system-events/types";

const EVENT_STREAM_KEY = "fn_knock:events:stream";
const DISPATCH_INTERVAL_MS = 3000;
const DELIVERY_INTERVAL_MS = 1500;
const STREAM_BATCH_SIZE = 50;
const DELIVERY_BATCH_SIZE = 10;
const DISPATCH_LEASE_TTL_SECONDS = 15;

type RedisStreamBatch = Array<
  [string, Array<[string, Array<string>]>]
>;

const parseSystemEventStreamItems = (payload: RedisStreamBatch | null) => {
  if (!payload?.length) return [] as Array<{ streamId: string; event: SystemEventEnvelope }>;
  const [, items] = payload[0] || [];
  if (!items?.length) return [];

  return items.flatMap(([streamId, fields]) => {
    const eventIndex = fields.findIndex((value) => value === "event");
    const rawEvent =
      eventIndex >= 0 && fields.length > eventIndex + 1
        ? fields[eventIndex + 1]
        : undefined;
    if (!rawEvent) return [];
    try {
      return [
        {
          streamId,
          event: JSON.parse(rawEvent) as SystemEventEnvelope,
        },
      ];
    } catch {
      return [];
    }
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createLeaseToken = (prefix: string) =>
  `${prefix}_${process.pid}_${Date.now()}_${randomBytes(6).toString("hex")}`;

export class SystemNotificationRuntime {
  private started = false;
  private dispatching = false;
  private delivering = false;

  start() {
    if (this.started) return;
    this.started = true;

    const dispatchTimer = setInterval(() => {
      void this.dispatchTick();
    }, DISPATCH_INTERVAL_MS);
    dispatchTimer.unref?.();

    const deliveryTimer = setInterval(() => {
      void this.deliveryTick();
    }, DELIVERY_INTERVAL_MS);
    deliveryTimer.unref?.();

    void this.ensureStreamCursorInitialized();
  }

  private async ensureStreamCursorInitialized() {
    const currentCursor = await redisNotificationStore.getLastStreamId();
    if (currentCursor) return;

    try {
      const response = (await (redis as any).xrevrange(
        EVENT_STREAM_KEY,
        "+",
        "-",
        "COUNT",
        1,
      )) as Array<[string, Array<string>]> | null;
      const latestStreamId = response?.[0]?.[0] || "0-0";
      await redisNotificationStore.setLastStreamId(latestStreamId);
    } catch (error) {
      console.error(
        "[system-notifications] failed to initialize stream cursor:",
        error,
      );
    }
  }

  private async dispatchTick() {
    if (this.dispatching) return;
    this.dispatching = true;
    const leaseToken = createLeaseToken("dispatch");

    try {
      const acquired = await redisNotificationStore.acquireRuntimeLease(
        "dispatch",
        leaseToken,
        DISPATCH_LEASE_TTL_SECONDS,
      );
      if (!acquired) {
        return;
      }

      let lastStreamId = await redisNotificationStore.getLastStreamId();
      if (!lastStreamId) {
        await this.ensureStreamCursorInitialized();
        lastStreamId = await redisNotificationStore.getLastStreamId();
      }
      if (!lastStreamId) return;

      const response = (await (redis as any).xread(
        "COUNT",
        STREAM_BATCH_SIZE,
        "STREAMS",
        EVENT_STREAM_KEY,
        lastStreamId,
      )) as RedisStreamBatch | null;
      const items = parseSystemEventStreamItems(response);
      if (!items.length) return;

      for (const item of items) {
        await systemNotificationService.handleEvent(item.event);
        await redisNotificationStore.setLastStreamId(item.streamId);
      }
    } catch (error) {
      console.error("[system-notifications] dispatcher tick failed:", error);
      await sleep(500);
    } finally {
      await redisNotificationStore.releaseRuntimeLease(
        "dispatch",
        leaseToken,
      ).catch(() => {});
      this.dispatching = false;
    }
  }

  private async deliveryTick() {
    if (this.delivering) return;
    this.delivering = true;
    try {
      await systemNotificationService.processReadyDeliveries(DELIVERY_BATCH_SIZE);
    } catch (error) {
      console.error("[system-notifications] delivery tick failed:", error);
      await sleep(500);
    } finally {
      this.delivering = false;
    }
  }
}

export const systemNotificationRuntime = new SystemNotificationRuntime();
