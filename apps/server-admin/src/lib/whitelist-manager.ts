import type Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { goBackend } from "./go-backend";
import { configManager, redis } from "./redis";
import { ipLocationRefs, ipLocationService } from "./ip-location";
import { normalizeIp } from "./ip-normalize";
import { shouldAutoManageFirewallForRunType } from "./firewall-automation";
import {
  doesClientIpMatchWhiteListTarget,
  inferWhiteListTargetType,
  normalizeWhiteListTarget,
  type WhiteListTargetType,
} from "./whitelist-target";

export interface WhiteListRecord {
  id: string;
  ip: string;
  targetType: WhiteListTargetType;
  expireAt: number | null;
  source: "manual" | "auto";
  createdAt: number;
  comment?: string;
  status: "active" | "expired" | "deleted";
  ipLocation?: string;
}

const PREFIX = "fn_knock:whitelist";
const KEYS = {
  RECORDS: `${PREFIX}:records`,
  RECORD_ORDER: `${PREFIX}:record_order`,
  EXPIRY: `${PREFIX}:expiry`,
  IPS: `${PREFIX}:ips`,
  CIDR_RECORDS: `${PREFIX}:cidr_records`,
  DELETED: `${PREFIX}:deleted`,
};

const getRecordTargetType = (
  record: Partial<Pick<WhiteListRecord, "targetType">>,
): WhiteListTargetType => (record.targetType === "cidr" ? "cidr" : "ip");

const getRecordTarget = (
  record: Partial<Pick<WhiteListRecord, "ip">>,
): string => String(record.ip || "").trim();

const isIPRecord = (
  record: Partial<Pick<WhiteListRecord, "targetType">>,
): boolean => getRecordTargetType(record) === "ip";

const isCIDRRecord = (
  record: Partial<Pick<WhiteListRecord, "targetType">>,
): boolean => getRecordTargetType(record) === "cidr";

const sortRecordsByCreatedAtDesc = (
  records: WhiteListRecord[],
): WhiteListRecord[] =>
  records.sort((left, right) => right.createdAt - left.createdAt);

const deserializeRecord = (raw: string): WhiteListRecord | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<WhiteListRecord>;
    const id = String(parsed.id || "").trim();
    if (!id) return null;

    const rawTarget = getRecordTarget(parsed);
    const targetType =
      parsed.targetType === "cidr"
        ? "cidr"
        : (inferWhiteListTargetType(rawTarget) ?? "ip");
    const normalizedTarget = normalizeWhiteListTarget(rawTarget, targetType);
    if (!normalizedTarget) return null;

    const source = parsed.source === "auto" ? "auto" : "manual";
    const status =
      parsed.status === "expired" || parsed.status === "deleted"
        ? parsed.status
        : "active";
    const createdAt = Number.parseInt(String(parsed.createdAt ?? 0), 10);
    const expireAtRaw = parsed.expireAt;
    const expireAt =
      expireAtRaw === null || expireAtRaw === undefined
        ? null
        : Number.parseInt(String(expireAtRaw), 10);
    const comment =
      typeof parsed.comment === "string" ? parsed.comment : undefined;
    const ipLocation =
      targetType === "ip" && typeof parsed.ipLocation === "string"
        ? parsed.ipLocation
        : undefined;

    return {
      id,
      ip: normalizedTarget,
      targetType,
      expireAt:
        expireAt !== null && Number.isFinite(expireAt) ? expireAt : null,
      source,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      ...(comment !== undefined ? { comment } : {}),
      status,
      ...(ipLocation ? { ipLocation } : {}),
    };
  } catch {
    return null;
  }
};

export class IPTablesWhiteListManager {
  private redis: Redis;

  constructor() {
    this.redis = redis;
  }

  private getIPRecordsKey(ip: string) {
    const normalizedIp = normalizeIp(ip) || String(ip || "").trim();
    return `${PREFIX}:ip_records:${normalizedIp}`;
  }

  private async shouldSyncDirectModeFirewall(): Promise<boolean> {
    const config = await configManager.getConfig();
    return shouldAutoManageFirewallForRunType(config.run_type, config);
  }

  private async syncAllowedTarget(target: string) {
    if (!(await this.shouldSyncDirectModeFirewall())) return;
    await goBackend.allowIP(target);
  }

  private async removeAllowedTarget(target: string) {
    if (!(await this.shouldSyncDirectModeFirewall())) return;
    await goBackend.removeIP(target);
  }

  private normalizeTargetInput(
    value: string,
    source: WhiteListRecord["source"],
    targetType?: WhiteListTargetType,
  ): { target: string; targetType: WhiteListTargetType } {
    const inferredType = targetType ?? inferWhiteListTargetType(value);
    if (!inferredType) {
      throw new Error("IP 或 CIDR 格式不正确");
    }
    if (source === "auto" && inferredType !== "ip") {
      throw new Error("登录自动授权仅支持单个 IP");
    }

    const target = normalizeWhiteListTarget(value, inferredType);
    if (!target) {
      throw new Error(
        inferredType === "cidr" ? "CIDR 格式不正确" : "IP 格式不正确",
      );
    }

    return {
      target,
      targetType: inferredType,
    };
  }

  async getRecordById(id: string): Promise<WhiteListRecord | null> {
    const raw = await this.redis.hget(KEYS.RECORDS, id);
    if (!raw) return null;
    return deserializeRecord(raw);
  }

  private async findExactIPRecordsWithScan(
    ip: string,
    rebuildIndex: boolean,
  ): Promise<WhiteListRecord[]> {
    const normalizedIp = normalizeIp(ip) || String(ip || "").trim();
    const allRecords = await this.redis.hgetall(KEYS.RECORDS);
    const records: WhiteListRecord[] = [];
    const ids: string[] = [];

    for (const [id, raw] of Object.entries(allRecords)) {
      const record = deserializeRecord(raw);
      if (!record) continue;
      if (
        isIPRecord(record) &&
        normalizeIp(record.ip || "") === normalizedIp &&
        record.status === "active"
      ) {
        records.push(record);
        ids.push(id);
      }
    }

    sortRecordsByCreatedAtDesc(records);
    if (!rebuildIndex) return records;

    const ipKey = this.getIPRecordsKey(normalizedIp);
    const pipeline = this.redis.pipeline();
    pipeline.del(ipKey);
    if (ids.length > 0) {
      pipeline.sadd(ipKey, ...ids);
    }
    await pipeline.exec();
    return records;
  }

  private async findAllActiveCIDRRecordsWithScan(
    rebuildIndex: boolean,
  ): Promise<WhiteListRecord[]> {
    const allRecords = await this.redis.hgetall(KEYS.RECORDS);
    const records: WhiteListRecord[] = [];
    const ids: string[] = [];

    for (const [id, raw] of Object.entries(allRecords)) {
      const record = deserializeRecord(raw);
      if (!record) continue;
      if (isCIDRRecord(record) && record.status === "active") {
        records.push(record);
        ids.push(id);
      }
    }

    sortRecordsByCreatedAtDesc(records);
    if (!rebuildIndex) return records;

    const pipeline = this.redis.pipeline();
    pipeline.del(KEYS.CIDR_RECORDS);
    if (ids.length > 0) {
      pipeline.sadd(KEYS.CIDR_RECORDS, ...ids);
    }
    await pipeline.exec();
    return records;
  }

  private async getAllActiveCIDRRecords(): Promise<WhiteListRecord[]> {
    const ids = await this.redis.smembers(KEYS.CIDR_RECORDS);
    if (ids.length === 0) {
      return this.findAllActiveCIDRRecordsWithScan(true);
    }

    const raws = await this.redis.hmget(KEYS.RECORDS, ...ids);
    const records: WhiteListRecord[] = [];
    const removeFromSetOnly: string[] = [];
    const removeFromAllIndexes: string[] = [];

    raws.forEach((raw, index) => {
      const id = ids[index];
      if (!id) return;
      if (!raw) {
        removeFromAllIndexes.push(id);
        return;
      }

      const record = deserializeRecord(raw);
      if (!record) {
        removeFromAllIndexes.push(id);
        return;
      }
      if (!isCIDRRecord(record)) {
        if (record.status === "active") {
          removeFromSetOnly.push(id);
        } else {
          removeFromAllIndexes.push(id);
        }
        return;
      }
      if (record.status !== "active") {
        removeFromAllIndexes.push(id);
        return;
      }

      records.push(record);
    });

    if (removeFromSetOnly.length > 0 || removeFromAllIndexes.length > 0) {
      const pipeline = this.redis.pipeline();
      if (removeFromSetOnly.length > 0) {
        pipeline.srem(KEYS.CIDR_RECORDS, ...removeFromSetOnly);
      }
      if (removeFromAllIndexes.length > 0) {
        pipeline.srem(KEYS.CIDR_RECORDS, ...removeFromAllIndexes);
        pipeline.zrem(KEYS.RECORD_ORDER, ...removeFromAllIndexes);
        pipeline.zrem(KEYS.EXPIRY, ...removeFromAllIndexes);
      }
      await pipeline.exec();
    }

    if (records.length === 0) {
      return this.findAllActiveCIDRRecordsWithScan(true);
    }

    return sortRecordsByCreatedAtDesc(records);
  }

  private async rebuildRecordOrderIndex(): Promise<WhiteListRecord[]> {
    const allRecords = await this.redis.hgetall(KEYS.RECORDS);
    const activeRecords: WhiteListRecord[] = [];
    const ipRecordIds = new Map<string, string[]>();
    const cidrRecordIds: string[] = [];

    for (const raw of Object.values(allRecords)) {
      const record = deserializeRecord(raw);
      if (!record || record.status !== "active") {
        continue;
      }

      activeRecords.push(record);
      if (isIPRecord(record)) {
        const normalizedIp = normalizeIp(record.ip) || record.ip;
        const ids = ipRecordIds.get(normalizedIp) ?? [];
        ids.push(record.id);
        ipRecordIds.set(normalizedIp, ids);
        continue;
      }

      cidrRecordIds.push(record.id);
    }

    sortRecordsByCreatedAtDesc(activeRecords);
    const pipeline = this.redis.pipeline();
    pipeline.del(KEYS.RECORD_ORDER);
    pipeline.del(KEYS.EXPIRY);
    pipeline.del(KEYS.IPS);
    pipeline.del(KEYS.CIDR_RECORDS);

    for (const ip of ipRecordIds.keys()) {
      pipeline.del(this.getIPRecordsKey(ip));
    }

    for (const record of activeRecords) {
      pipeline.zadd(KEYS.RECORD_ORDER, record.createdAt, record.id);
      if (record.expireAt) {
        pipeline.zadd(KEYS.EXPIRY, record.expireAt, record.id);
      }
    }

    for (const [ip, ids] of ipRecordIds.entries()) {
      pipeline.sadd(KEYS.IPS, ip);
      pipeline.sadd(this.getIPRecordsKey(ip), ...ids);
    }
    if (cidrRecordIds.length > 0) {
      pipeline.sadd(KEYS.CIDR_RECORDS, ...cidrRecordIds);
    }

    await pipeline.exec();
    await ipLocationService.hydrateIpLocationRecords(activeRecords, (record) =>
      ipLocationRefs.whitelist(record.id),
    );
    return activeRecords;
  }

  async addWhiteList(
    record: Omit<
      WhiteListRecord,
      "id" | "createdAt" | "status" | "targetType"
    > & {
      targetType?: WhiteListTargetType;
    },
    options?: { replaceSource?: "manual" | "auto" | "all" },
  ): Promise<string> {
    const { target, targetType } = this.normalizeTargetInput(
      record.ip,
      record.source,
      record.targetType,
    );
    const replaceSource = options?.replaceSource ?? record.source;
    if (replaceSource === "all") {
      await this.removeRecordsByTarget(target, targetType);
    } else {
      await this.removeRecordsByTarget(target, targetType, replaceSource);
    }

    const id = `whitelist:${uuidv4()}`;
    const now = Math.floor(Date.now() / 1000);
    const ipLocationStr =
      targetType === "ip"
        ? await ipLocationService.getCachedLocation(target)
        : "";
    const fullRecord: WhiteListRecord = {
      ...record,
      ip: target,
      targetType,
      id,
      createdAt: now,
      status: "active",
      ...(ipLocationStr ? { ipLocation: ipLocationStr } : {}),
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(KEYS.RECORDS, id, JSON.stringify(fullRecord));
    pipeline.zadd(KEYS.RECORD_ORDER, now, id);

    if (targetType === "ip") {
      const ipKey = this.getIPRecordsKey(target);
      pipeline.sadd(KEYS.IPS, target);
      pipeline.sadd(ipKey, id);
    } else {
      pipeline.sadd(KEYS.CIDR_RECORDS, id);
    }

    if (record.expireAt) {
      pipeline.zadd(KEYS.EXPIRY, record.expireAt, id);
    }

    await pipeline.exec();
    if (targetType === "ip") {
      await ipLocationService.registerUsage(target, [
        ipLocationRefs.whitelist(id),
      ]);
    }
    await this.syncAllowedTarget(target);
    return id;
  }

  async removeWhiteList(id: string): Promise<boolean> {
    const record = await this.getRecordById(id);
    if (!record) return false;

    const target = getRecordTarget(record);
    const targetType = getRecordTargetType(record);
    const pipeline = this.redis.pipeline();
    pipeline.hdel(KEYS.RECORDS, id);
    pipeline.hdel(KEYS.DELETED, id);
    pipeline.zrem(KEYS.RECORD_ORDER, id);
    pipeline.zrem(KEYS.EXPIRY, id);
    if (targetType === "ip") {
      pipeline.srem(this.getIPRecordsKey(target), id);
    } else {
      pipeline.srem(KEYS.CIDR_RECORDS, id);
    }
    await pipeline.exec();

    const remaining = await this.findRecordsByTarget(target, targetType);
    if (remaining.length === 0) {
      if (targetType === "ip") {
        await this.redis.srem(KEYS.IPS, target);
        await this.redis.del(this.getIPRecordsKey(target));
      }
      await this.removeAllowedTarget(target);
    }

    return true;
  }

  async updateComment(id: string, comment: string): Promise<boolean> {
    const record = await this.getRecordById(id);
    if (!record) return false;

    record.comment = comment;
    await this.redis.hset(KEYS.RECORDS, id, JSON.stringify(record));
    return true;
  }

  async getAllActiveRecords(
    source?: "manual" | "auto",
  ): Promise<WhiteListRecord[]> {
    const ids = await this.redis.zrevrange(KEYS.RECORD_ORDER, 0, -1);
    if (ids.length === 0) {
      const rebuilt = await this.rebuildRecordOrderIndex();
      return source
        ? rebuilt.filter((record) => record.source === source)
        : rebuilt;
    }

    const raws = await this.redis.hmget(KEYS.RECORDS, ...ids);
    const activeRecords: WhiteListRecord[] = [];
    const staleIds: string[] = [];
    const staleIPTargets = new Set<string>();

    raws.forEach((raw, index) => {
      const id = ids[index];
      if (!id) return;
      if (!raw) {
        staleIds.push(id);
        return;
      }

      const record = deserializeRecord(raw);
      if (!record) {
        staleIds.push(id);
        return;
      }
      if (record.status !== "active") {
        staleIds.push(id);
        if (isIPRecord(record)) {
          staleIPTargets.add(record.ip);
        }
        return;
      }

      activeRecords.push(record);
    });

    if (staleIds.length > 0) {
      const pipeline = this.redis.pipeline();
      pipeline.zrem(KEYS.RECORD_ORDER, ...staleIds);
      pipeline.zrem(KEYS.EXPIRY, ...staleIds);
      pipeline.srem(KEYS.CIDR_RECORDS, ...staleIds);
      for (const ip of staleIPTargets) {
        pipeline.srem(this.getIPRecordsKey(ip), ...staleIds);
      }
      await pipeline.exec();
    }

    await ipLocationService.hydrateIpLocationRecords(activeRecords, (record) =>
      ipLocationRefs.whitelist(record.id),
    );
    const sorted = sortRecordsByCreatedAtDesc(activeRecords);
    return source
      ? sorted.filter((record) => record.source === source)
      : sorted;
  }

  async isIPWhitelisted(ip: string): Promise<boolean> {
    return this.hasValidIP(ip);
  }

  async hasValidIP(ip: string): Promise<boolean> {
    const records = await this.getActiveRecordsByIP(ip);
    return records.length > 0;
  }

  private async findExactIPRecords(ip: string): Promise<WhiteListRecord[]> {
    const normalizedIp = normalizeIp(ip) || String(ip || "").trim();
    if (!normalizedIp) return [];

    const ipKey = this.getIPRecordsKey(normalizedIp);
    const ids = await this.redis.smembers(ipKey);
    if (ids.length === 0) {
      return this.findExactIPRecordsWithScan(normalizedIp, true);
    }

    const raws = await this.redis.hmget(KEYS.RECORDS, ...ids);
    const records: WhiteListRecord[] = [];
    const removeFromSetOnly: string[] = [];
    const removeFromAllIndexes: string[] = [];

    raws.forEach((raw, index) => {
      const id = ids[index];
      if (!id) return;
      if (!raw) {
        removeFromAllIndexes.push(id);
        return;
      }

      const record = deserializeRecord(raw);
      if (!record) {
        removeFromAllIndexes.push(id);
        return;
      }
      if (
        !isIPRecord(record) ||
        normalizeIp(record.ip || "") !== normalizedIp
      ) {
        if (record.status === "active") {
          removeFromSetOnly.push(id);
        } else {
          removeFromAllIndexes.push(id);
        }
        return;
      }
      if (record.status !== "active") {
        removeFromAllIndexes.push(id);
        return;
      }

      records.push(record);
    });

    if (removeFromSetOnly.length > 0 || removeFromAllIndexes.length > 0) {
      const pipeline = this.redis.pipeline();
      if (removeFromSetOnly.length > 0) {
        pipeline.srem(ipKey, ...removeFromSetOnly);
      }
      if (removeFromAllIndexes.length > 0) {
        pipeline.srem(ipKey, ...removeFromAllIndexes);
        pipeline.zrem(KEYS.RECORD_ORDER, ...removeFromAllIndexes);
        pipeline.zrem(KEYS.EXPIRY, ...removeFromAllIndexes);
      }
      await pipeline.exec();
    }

    if (records.length === 0) {
      return this.findExactIPRecordsWithScan(normalizedIp, true);
    }

    return sortRecordsByCreatedAtDesc(records);
  }

  private async findMatchingCIDRRecords(
    ip: string,
  ): Promise<WhiteListRecord[]> {
    const normalizedIp = normalizeIp(ip) || String(ip || "").trim();
    if (!normalizedIp) return [];

    const records = await this.getAllActiveCIDRRecords();
    const now = Math.floor(Date.now() / 1000);
    return sortRecordsByCreatedAtDesc(
      records.filter((record) => {
        if (record.expireAt && record.expireAt <= now) return false;
        return doesClientIpMatchWhiteListTarget(
          normalizedIp,
          record.ip,
          record.targetType,
        );
      }),
    );
  }

  private async findRecordsByTarget(
    target: string,
    targetType: WhiteListTargetType,
  ): Promise<WhiteListRecord[]> {
    if (targetType === "cidr") {
      const records = await this.getAllActiveCIDRRecords();
      return sortRecordsByCreatedAtDesc(
        records.filter((record) => record.ip === target),
      );
    }

    return this.findExactIPRecords(target);
  }

  async getActiveRecordsByIP(
    ip: string,
    source?: "manual" | "auto",
  ): Promise<WhiteListRecord[]> {
    const [exactRecords, cidrRecords] = await Promise.all([
      this.findExactIPRecords(ip),
      this.findMatchingCIDRRecords(ip),
    ]);
    const now = Math.floor(Date.now() / 1000);

    return sortRecordsByCreatedAtDesc(
      [...exactRecords, ...cidrRecords].filter((record) => {
        if (record.status !== "active") return false;
        if (record.expireAt && record.expireAt <= now) return false;
        if (source && record.source !== source) return false;
        return true;
      }),
    );
  }

  async getLatestActiveRecordByIP(
    ip: string,
    source?: "manual" | "auto",
  ): Promise<WhiteListRecord | null> {
    const records = await this.getActiveRecordsByIP(ip, source);
    return records[0] || null;
  }

  async moveRecordToIP(
    id: string,
    newIp: string,
  ): Promise<WhiteListRecord | null> {
    const record = await this.getRecordById(id);
    if (!record || record.status !== "active" || !isIPRecord(record)) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (record.expireAt && record.expireAt <= now) return null;

    const oldIp = normalizeIp(record.ip) || record.ip;
    const normalizedNewIp = normalizeIp(newIp) || String(newIp || "").trim();
    if (!normalizedNewIp) return null;
    if (oldIp === normalizedNewIp) {
      return record;
    }

    const ipLocationStr =
      await ipLocationService.getCachedLocation(normalizedNewIp);
    const nextRecord: WhiteListRecord = {
      ...record,
      ip: normalizedNewIp,
      targetType: "ip",
      ...(ipLocationStr ? { ipLocation: ipLocationStr } : {}),
    };

    const oldIpKey = this.getIPRecordsKey(oldIp);
    const newIpKey = this.getIPRecordsKey(normalizedNewIp);
    const pipeline = this.redis.pipeline();
    pipeline.hset(KEYS.RECORDS, id, JSON.stringify(nextRecord));
    pipeline.srem(oldIpKey, id);
    pipeline.sadd(newIpKey, id);
    pipeline.sadd(KEYS.IPS, normalizedNewIp);
    await pipeline.exec();
    await ipLocationService.registerUsage(normalizedNewIp, [
      ipLocationRefs.whitelist(id),
    ]);

    await this.syncAllowedTarget(normalizedNewIp);

    const remainingOldRecords = await this.findExactIPRecords(oldIp);
    if (remainingOldRecords.length === 0) {
      await this.redis.srem(KEYS.IPS, oldIp);
      await this.redis.del(oldIpKey);
      await this.removeAllowedTarget(oldIp);
    }

    return nextRecord;
  }

  private async removeRecordsByTarget(
    target: string,
    targetType: WhiteListTargetType,
    source?: "manual" | "auto",
  ): Promise<boolean> {
    const records = await this.findRecordsByTarget(target, targetType);
    let removed = false;
    for (const record of records) {
      if (!source || record.source === source) {
        const result = await this.removeWhiteList(record.id);
        if (result) removed = true;
      }
    }
    return removed;
  }

  async removeRecordsByIP(
    ip: string,
    source?: "manual" | "auto",
  ): Promise<boolean> {
    const normalizedIp = normalizeIp(ip) || String(ip || "").trim();
    if (!normalizedIp) return false;
    return this.removeRecordsByTarget(normalizedIp, "ip", source);
  }

  async removeRecordsBySource(source: "manual" | "auto"): Promise<number> {
    const records = await this.getAllActiveRecords(source);
    let removedCount = 0;

    for (const record of records) {
      if (await this.removeWhiteList(record.id)) {
        removedCount += 1;
      }
    }

    return removedCount;
  }

  async findExpiredRecords(): Promise<WhiteListRecord[]> {
    const now = Math.floor(Date.now() / 1000);
    const expiredIds = await this.redis.zrangebyscore(KEYS.EXPIRY, 0, now);
    if (expiredIds.length === 0) return [];

    const raws = await this.redis.hmget(KEYS.RECORDS, ...expiredIds);
    const records: WhiteListRecord[] = [];
    const staleIds: string[] = [];

    raws.forEach((raw, index) => {
      const id = expiredIds[index];
      if (!id) return;
      if (!raw) {
        staleIds.push(id);
        return;
      }

      const record = deserializeRecord(raw);
      if (!record) {
        staleIds.push(id);
        return;
      }
      if (record.status !== "active") {
        staleIds.push(id);
        return;
      }

      records.push(record);
    });

    if (staleIds.length > 0) {
      await this.redis.zrem(KEYS.EXPIRY, ...staleIds);
    }
    return records;
  }

  async processExpiredRecords(): Promise<boolean> {
    try {
      const expiredRecords = await this.findExpiredRecords();
      if (expiredRecords.length === 0) return false;

      const touchedIps = new Set<string>();
      const touchedCidrs = new Set<string>();
      const pipeline = this.redis.pipeline();

      for (const record of expiredRecords) {
        record.status = "expired";
        if (isIPRecord(record)) {
          touchedIps.add(record.ip);
          pipeline.srem(this.getIPRecordsKey(record.ip), record.id);
        } else {
          touchedCidrs.add(record.ip);
          pipeline.srem(KEYS.CIDR_RECORDS, record.id);
        }
        pipeline.hset(KEYS.RECORDS, record.id, JSON.stringify(record));
        pipeline.zrem(KEYS.EXPIRY, record.id);
        pipeline.zrem(KEYS.RECORD_ORDER, record.id);
      }

      await pipeline.exec();

      for (const ip of touchedIps) {
        const active = await this.findExactIPRecords(ip);
        if (active.length > 0) continue;
        await this.redis.srem(KEYS.IPS, ip);
        await this.redis.del(this.getIPRecordsKey(ip));
        await this.removeAllowedTarget(ip);
      }

      for (const cidr of touchedCidrs) {
        const active = await this.findRecordsByTarget(cidr, "cidr");
        if (active.length > 0) continue;
        await this.removeAllowedTarget(cidr);
      }

      return true;
    } catch (error) {
      console.error("Error processing expired records:", error);
      return false;
    }
  }

  async cleanup(): Promise<void> {
    return;
  }
}

export const whitelistManager = new IPTablesWhiteListManager();
