import type Redis from "ioredis";
import { redis } from "./redis";

export type TrafficDirection = "in" | "out";

export type TrafficSnapshot = {
  total_in: number;
  total_out: number;
  active_conns: number;
  error_5xx: number;
  by_host?: HostTrafficSnapshot[];
};

export type HostTrafficSnapshot = {
  host: string;
  total_in: number;
  total_out: number;
  error_5xx?: number;
  active_ip_count?: number;
};

export type TrafficDeltaPoint = {
  ts: number;
  delta: number;
};

const parseNumberSafe = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const toUnixSeconds = (ms = Date.now()) => Math.floor(ms / 1000);

const computeDelta = (currentTotal: number, lastTotal: number | null) => {
  if (!Number.isFinite(currentTotal) || currentTotal < 0) return 0;
  if (lastTotal === null || !Number.isFinite(lastTotal) || lastTotal < 0)
    return currentTotal;
  if (currentTotal >= lastTotal) return currentTotal - lastTotal;
  return currentTotal;
};

const normalizeCounter = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
};

const normalizeSeconds = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export const normalizeTrafficHost = (value: unknown): string => {
  let host = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!host) return "";

  host = host
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "");

  if (!host) return "";

  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end > 0) return host.slice(0, end + 1);
    return host;
  }

  const lastColon = host.lastIndexOf(":");
  if (lastColon > -1 && host.indexOf(":") === lastColon) {
    const possiblePort = host.slice(lastColon + 1);
    if (/^\d+$/.test(possiblePort)) {
      host = host.slice(0, lastColon);
    }
  }

  return host.trim();
};

type TrafficSnapshotRecord = {
  host: string | null;
  total_in: number;
  total_out: number;
  error_5xx: number;
};

export class TrafficMetricsManager {
  private readonly r: Redis;
  private readonly keyIndexTraffic = "fn_knock:traffic:keys";
  private readonly keyIndexError5xx = "fn_knock:errors:5xx:keys";

  constructor() {
    this.r = redis;
  }

  private scopeSegment(userId: string, host?: string | null) {
    const normalizedHost = normalizeTrafficHost(host);
    if (!normalizedHost) return userId;
    return `${userId}:host:${encodeURIComponent(normalizedHost)}`;
  }

  private trafficKey(
    userId: string,
    direction: TrafficDirection,
    host?: string | null,
  ) {
    return `fn_knock:traffic:${this.scopeSegment(userId, host)}:${direction}`;
  }

  private trafficLastTotalKey(
    userId: string,
    direction: TrafficDirection,
    host?: string | null,
  ) {
    return `fn_knock:traffic:last:${this.scopeSegment(userId, host)}:${direction}`;
  }

  private error5xxKey(userId: string, host?: string | null) {
    return `fn_knock:errors:${this.scopeSegment(userId, host)}:5xx`;
  }

  private error5xxLastTotalKey(userId: string, host?: string | null) {
    return `fn_knock:errors:last:${this.scopeSegment(userId, host)}:5xx`;
  }

  private buildSnapshotRecords(
    snapshot: TrafficSnapshot,
  ): TrafficSnapshotRecord[] {
    const records: TrafficSnapshotRecord[] = [
      {
        host: null,
        total_in: normalizeCounter(snapshot.total_in),
        total_out: normalizeCounter(snapshot.total_out),
        error_5xx: normalizeCounter(snapshot.error_5xx),
      },
    ];

    const byHost = new Map<string, TrafficSnapshotRecord>();
    for (const item of snapshot.by_host ?? []) {
      const host = normalizeTrafficHost(item?.host);
      if (!host) continue;
      byHost.set(host, {
        host,
        total_in: normalizeCounter(item.total_in),
        total_out: normalizeCounter(item.total_out),
        error_5xx: normalizeCounter(item.error_5xx),
      });
    }

    records.push(...byHost.values());
    return records;
  }

  async recordSnapshot(
    userId: string,
    snapshot: TrafficSnapshot,
    opts?: { nowSec?: number; keepSeconds?: number },
  ): Promise<{
    nowSec: number;
    deltaIn: number;
    deltaOut: number;
    delta5xx: number;
  }> {
    const nowSec = opts?.nowSec ?? toUnixSeconds();
    const keepSeconds = normalizeSeconds(
      opts?.keepSeconds,
      7 * 24 * 3600,
      60,
      365 * 24 * 3600,
    );
    const expireBeforeSec = nowSec - keepSeconds;

    const directionIn: TrafficDirection = "in";
    const directionOut: TrafficDirection = "out";
    const records = this.buildSnapshotRecords(snapshot);
    const lastKeys = records.flatMap((record) => [
      this.trafficLastTotalKey(userId, directionIn, record.host),
      this.trafficLastTotalKey(userId, directionOut, record.host),
      this.error5xxLastTotalKey(userId, record.host),
    ]);

    const lastValues = await this.r.mget(...lastKeys);
    const pipeline = this.r.pipeline();
    let globalDeltaIn = 0;
    let globalDeltaOut = 0;
    let globalDelta5xx = 0;

    records.forEach((record, index) => {
      const offset = index * 3;
      const lastIn = parseNumberSafe(lastValues[offset]);
      const lastOut = parseNumberSafe(lastValues[offset + 1]);
      const last5xx = parseNumberSafe(lastValues[offset + 2]);
      const deltaIn = computeDelta(record.total_in, lastIn);
      const deltaOut = computeDelta(record.total_out, lastOut);
      const delta5xx = computeDelta(record.error_5xx, last5xx);

      if (record.host === null) {
        globalDeltaIn = deltaIn;
        globalDeltaOut = deltaOut;
        globalDelta5xx = delta5xx;
      }

      const keyIn = this.trafficKey(userId, directionIn, record.host);
      const keyOut = this.trafficKey(userId, directionOut, record.host);
      const key5xx = this.error5xxKey(userId, record.host);

      pipeline.set(
        this.trafficLastTotalKey(userId, directionIn, record.host),
        String(record.total_in),
      );
      pipeline.set(
        this.trafficLastTotalKey(userId, directionOut, record.host),
        String(record.total_out),
      );
      pipeline.set(
        this.error5xxLastTotalKey(userId, record.host),
        String(record.error_5xx),
      );

      pipeline.zadd(keyIn, nowSec, `${nowSec}:${deltaIn}`);
      pipeline.zadd(keyOut, nowSec, `${nowSec}:${deltaOut}`);
      pipeline.zadd(key5xx, nowSec, `${nowSec}:${delta5xx}`);

      pipeline.sadd(this.keyIndexTraffic, keyIn, keyOut);
      pipeline.sadd(this.keyIndexError5xx, key5xx);

      pipeline.zremrangebyscore(keyIn, 0, expireBeforeSec);
      pipeline.zremrangebyscore(keyOut, 0, expireBeforeSec);
      pipeline.zremrangebyscore(key5xx, 0, expireBeforeSec);
    });

    await pipeline.exec();

    return {
      nowSec,
      deltaIn: globalDeltaIn,
      deltaOut: globalDeltaOut,
      delta5xx: globalDelta5xx,
    };
  }

  async listTrafficPoints(
    userId: string,
    direction: TrafficDirection,
    fromSec: number,
    toSec: number,
    host?: string | null,
  ) {
    const key = this.trafficKey(userId, direction, normalizeTrafficHost(host));
    const members = await this.r.zrangebyscore(key, fromSec, toSec);
    return this.parsePoints(members);
  }

  async list5xxPoints(
    userId: string,
    fromSec: number,
    toSec: number,
    host?: string | null,
  ) {
    const key = this.error5xxKey(userId, normalizeTrafficHost(host));
    const members = await this.r.zrangebyscore(key, fromSec, toSec);
    return this.parsePoints(members);
  }

  async sumTrafficDelta(
    userId: string,
    direction: TrafficDirection,
    fromSec: number,
    toSec: number,
    host?: string | null,
  ) {
    const points = await this.listTrafficPoints(
      userId,
      direction,
      fromSec,
      toSec,
      host,
    );
    return points.reduce((acc, p) => acc + p.delta, 0);
  }

  async sum5xxDelta(
    userId: string,
    fromSec: number,
    toSec: number,
    host?: string | null,
  ) {
    const points = await this.list5xxPoints(userId, fromSec, toSec, host);
    return points.reduce((acc, p) => acc + p.delta, 0);
  }

  async cleanupExpired(
    keepSeconds = 7 * 24 * 3600,
  ): Promise<{ cleanedKeys: number }> {
    const nowSec = toUnixSeconds();
    const expireBeforeSec =
      nowSec -
      normalizeSeconds(keepSeconds, 7 * 24 * 3600, 60, 365 * 24 * 3600);

    const [trafficKeys, errorKeys] = await Promise.all([
      this.r.smembers(this.keyIndexTraffic),
      this.r.smembers(this.keyIndexError5xx),
    ]);

    const keys = [...new Set([...trafficKeys, ...errorKeys])].filter(Boolean);
    if (!keys.length) return { cleanedKeys: 0 };

    const pipeline = this.r.pipeline();
    for (const key of keys) pipeline.zremrangebyscore(key, 0, expireBeforeSec);
    await pipeline.exec();

    return { cleanedKeys: keys.length };
  }

  buildTrafficEchartsLine(
    points: TrafficDeltaPoint[],
    opts?: { name?: string; fallbackIntervalSec?: number },
  ) {
    const fallbackIntervalSec = normalizeSeconds(
      opts?.fallbackIntervalSec,
      60,
      1,
      24 * 3600,
    );
    let lastTs: number | null = null;

    const data = points
      .sort((a, b) => a.ts - b.ts)
      .map((p) => {
        const dt =
          lastTs !== null ? Math.max(1, p.ts - lastTs) : fallbackIntervalSec;
        lastTs = p.ts;
        const bps = Math.round((p.delta / dt) * 1000) / 1000;
        return [p.ts * 1000, bps] as const;
      });

    return {
      tooltip: { trigger: "axis" },
      xAxis: { type: "time" },
      yAxis: { type: "value" },
      series: [
        {
          name: opts?.name ?? "traffic",
          type: "line",
          showSymbol: false,
          data,
        },
      ],
    };
  }

  private parsePoints(members: string[]): TrafficDeltaPoint[] {
    const points: TrafficDeltaPoint[] = [];
    for (const m of members) {
      const idx = m.indexOf(":");
      if (idx <= 0) continue;
      const ts = Number(m.slice(0, idx));
      const delta = Number(m.slice(idx + 1));
      if (!Number.isFinite(ts) || !Number.isFinite(delta)) continue;
      points.push({ ts, delta });
    }
    return points;
  }
}

export const trafficMetricsManager = new TrafficMetricsManager();
