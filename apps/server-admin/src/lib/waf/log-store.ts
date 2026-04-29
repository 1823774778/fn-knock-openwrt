import { redis } from "../redis";
import type { WAFEvent } from "../go-backend";

const dateKey = (date: string) => `fn_knock:waf:logs:${date}`;
const eventKey = (traceId: string) => `fn_knock:waf:log:${traceId}`;
const statsKey = (date: string) => `fn_knock:waf:stats:${date}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INITIALIZATION_RULE_FILENAME = "REQUEST-901-INITIALIZATION.conf";

export interface WAFLogQuery {
  date?: string;
  trace_id?: string;
  search?: string;
  host?: string;
  client_ip?: string;
  rule_id?: string | number;
  route_type?: string;
  mode?: string;
  cursor?: string;
  limit?: string | number;
}

export interface WAFLogQueryResult {
  date: string;
  available_dates: string[];
  cursor: string;
  next_cursor: string;
  has_more: boolean;
  limit: number;
  total: number;
  items: WAFEvent[];
}

export interface WAFLogDeleteResult {
  date: string;
  deleted: boolean;
  available_dates: string[];
}

export interface WAFLogRangeQuery {
  fromMs: number;
  toMs: number;
  actions?: string[];
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

const localDateFromMs = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
};

const today = () => localDateFromMs(Date.now());

const normalizeDate = (value?: string | null): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return today();
  if (!DATE_RE.test(raw)) {
    throw new Error("invalid date, expected YYYY-MM-DD");
  }
  return raw;
};

const normalizeLimit = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(200, parsed);
};

const normalizeCursor = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const scoreForEvent = (event: WAFEvent): number => {
  const parsed = Date.parse(event.time);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const dateForEvent = (event: WAFEvent): string =>
  localDateFromMs(scoreForEvent(event));

const datesForRange = (fromMs: number, toMs: number): string[] => {
  const dates: string[] = [];
  const start = new Date(fromMs);
  start.setHours(0, 0, 0, 0);
  const end = new Date(toMs);
  end.setHours(0, 0, 0, 0);
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    dates.push(localDateFromMs(cursor.getTime()));
  }
  return dates;
};

const parseEvent = (raw: string | null): WAFEvent | null => {
  if (!raw) return null;
  try {
    const event = JSON.parse(raw) as WAFEvent;
    return sanitizeEvent(event);
  } catch {
    return null;
  }
};

const ruleBasename = (value: unknown): string => {
  const normalized = String(value ?? "").replace(/\\/g, "/");
  return normalized.split("/").pop() || "";
};

const isInitializationRule = (rule: { file?: string }): boolean =>
  ruleBasename(rule.file).toLowerCase() ===
  INITIALIZATION_RULE_FILENAME.toLowerCase();

const isBlockingAction = (action: unknown): boolean => {
  const normalized = String(action || "").toLowerCase();
  return normalized === "block" || normalized === "deny";
};

const sanitizeEvent = (event: WAFEvent): WAFEvent | null => {
  if (!event?.trace_id) return null;

  const rules = Array.isArray(event.rules)
    ? event.rules.filter((rule) => !isInitializationRule(rule))
    : undefined;
  const initializationRuleIds = new Set(
    (event.rules || [])
      .filter(isInitializationRule)
      .map((rule) => rule.id)
      .filter((id) => Number.isFinite(id)),
  );
  const ruleIds = Array.isArray(event.rule_ids)
    ? event.rule_ids.filter((id) => !initializationRuleIds.has(id))
    : undefined;
  const interruption =
    event.interruption?.rule_id &&
    initializationRuleIds.has(event.interruption.rule_id)
      ? undefined
      : event.interruption;
  const hasRuleSignal = Boolean(rules?.length || ruleIds?.length);
  const hasBlockingSignal =
    isBlockingAction(event.action) || Boolean(interruption);

  if (!hasRuleSignal && !hasBlockingSignal) return null;

  return {
    ...event,
    ...(rules ? { rules } : {}),
    ...(ruleIds ? { rule_ids: ruleIds } : {}),
    interruption,
  };
};

const includesToken = (value: unknown, token: string): boolean =>
  String(value ?? "")
    .toLowerCase()
    .includes(token);

const eventMatches = (event: WAFEvent, query: WAFLogQuery): boolean => {
  const host = String(query.host ?? "")
    .trim()
    .toLowerCase();
  if (host && String(event.host ?? "").toLowerCase() !== host) return false;

  const clientIP = String(query.client_ip ?? "").trim();
  if (clientIP && event.client_ip !== clientIP) return false;

  const routeType = String(query.route_type ?? "").trim();
  if (routeType && event.route_type !== routeType) return false;

  const mode = String(query.mode ?? "").trim();
  if (mode && event.mode !== mode) return false;

  const rawRuleID = String(query.rule_id ?? "").trim();
  if (rawRuleID) {
    const ruleID = Number.parseInt(rawRuleID, 10);
    if (!Number.isFinite(ruleID) || !event.rule_ids?.includes(ruleID)) {
      return false;
    }
  }

  const search = String(query.search ?? "")
    .trim()
    .toLowerCase();
  if (search) {
    const haystack = [
      event.trace_id,
      event.host,
      event.path,
      event.request_uri,
      event.client_ip,
      event.route_key,
      event.upstream,
      event.bundle_id,
      ...(event.rule_ids ?? []),
    ];
    if (!haystack.some((value) => includesToken(value, search))) {
      return false;
    }
  }

  return true;
};

export class WAFLogStore {
  async persistEvents(
    events: WAFEvent[],
    retentionDays: number,
  ): Promise<void> {
    const normalizedRetentionDays = Math.max(1, Math.min(365, retentionDays));
    const ttlSeconds = normalizedRetentionDays * 24 * 60 * 60;
    const pipeline = redis.pipeline();
    let operations = 0;

    for (const rawEvent of events) {
      const event = sanitizeEvent(rawEvent);
      if (!event) continue;
      const eventDate = dateForEvent(event);
      const score = scoreForEvent(event);
      pipeline.set(
        eventKey(event.trace_id),
        JSON.stringify(event),
        "EX",
        ttlSeconds,
      );
      pipeline.zadd(dateKey(eventDate), score, event.trace_id);
      pipeline.expire(dateKey(eventDate), ttlSeconds);
      pipeline.hincrby(statsKey(eventDate), "events", 1);
      pipeline.hincrby(
        statsKey(eventDate),
        `action:${event.action || "log"}`,
        1,
      );
      pipeline.expire(statsKey(eventDate), ttlSeconds);
      operations += 7;
    }

    if (operations > 0) {
      await pipeline.exec();
    }
  }

  async listDates(): Promise<string[]> {
    const keys = new Set<string>([today()]);
    let cursor = "0";
    do {
      const [nextCursor, batch] = await redis.scan(
        cursor,
        "MATCH",
        "fn_knock:waf:logs:*",
        "COUNT",
        100,
      );
      cursor = nextCursor;
      for (const key of batch) {
        const date = key.slice("fn_knock:waf:logs:".length);
        if (DATE_RE.test(date)) keys.add(date);
      }
    } while (cursor !== "0");
    return [...keys].sort((a, b) => b.localeCompare(a));
  }

  async getEvent(traceId: string): Promise<WAFEvent | null> {
    const normalized = traceId.trim();
    if (!normalized) return null;
    return parseEvent(await redis.get(eventKey(normalized)));
  }

  async listTimestampsByRange(query: WAFLogRangeQuery): Promise<number[]> {
    const fromMs = Math.max(0, query.fromMs);
    const toMs = Math.max(fromMs, query.toMs);
    const actions = new Set(
      (query.actions || [])
        .map((action) => action.trim().toLowerCase())
        .filter(Boolean),
    );
    const idBatches = await Promise.all(
      datesForRange(fromMs, toMs).map((date) =>
        redis.zrangebyscore(dateKey(date), fromMs, toMs),
      ),
    );
    const ids = [...new Set(idBatches.flat())];
    if (ids.length === 0) return [];

    const raws = await redis.mget(ids.map(eventKey));
    return raws
      .map(parseEvent)
      .filter((event): event is WAFEvent => !!event)
      .filter(
        (event) =>
          actions.size === 0 ||
          actions.has(String(event.action || "").toLowerCase()),
      )
      .map(scoreForEvent)
      .filter((timestamp) => timestamp >= fromMs && timestamp <= toMs);
  }

  async query(query: WAFLogQuery): Promise<WAFLogQueryResult> {
    const date = normalizeDate(query.date);
    const availableDates = await this.listDates();
    const limit = normalizeLimit(query.limit);
    const cursor = normalizeCursor(query.cursor);

    if (query.trace_id) {
      const event = await this.getEvent(String(query.trace_id));
      const items = event && eventMatches(event, query) ? [event] : [];
      return {
        date,
        available_dates: availableDates,
        cursor: String(cursor),
        next_cursor: "",
        has_more: false,
        limit,
        total: items.length,
        items,
      };
    }

    const ids = await redis.zrevrange(dateKey(date), 0, -1);
    if (ids.length === 0) {
      return {
        date,
        available_dates: availableDates,
        cursor: String(cursor),
        next_cursor: "",
        has_more: false,
        limit,
        total: 0,
        items: [],
      };
    }

    const raws = await redis.mget(ids.map(eventKey));
    const filtered = raws
      .map(parseEvent)
      .filter((event): event is WAFEvent => !!event)
      .filter((event) => eventMatches(event, query));
    const items = filtered.slice(cursor, cursor + limit);
    const nextCursor = cursor + items.length;

    return {
      date,
      available_dates: availableDates,
      cursor: String(cursor),
      next_cursor: nextCursor < filtered.length ? String(nextCursor) : "",
      has_more: nextCursor < filtered.length,
      limit,
      total: filtered.length,
      items,
    };
  }

  async deleteDate(rawDate: string): Promise<WAFLogDeleteResult> {
    const date = normalizeDate(rawDate);
    const ids = await redis.zrange(dateKey(date), 0, -1);
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.del(eventKey(id));
    }
    pipeline.del(dateKey(date));
    pipeline.del(statsKey(date));
    await pipeline.exec();

    return {
      date,
      deleted: ids.length > 0,
      available_dates: await this.listDates(),
    };
  }
}

export const wafLogStore = new WAFLogStore();
