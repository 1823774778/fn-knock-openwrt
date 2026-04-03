import { redis } from "./redis";

const LEGACY_AUTH_LOG_CLEANUP_STATE_KEY =
  "fn_knock:cleanup:legacy-auth-logs:v1";
const LEGACY_AUTH_LOG_CLEANUP_LOCK_KEY =
  "fn_knock:cleanup:legacy-auth-logs:v1:lock";
const LEGACY_AUTH_LOG_INDEX_KEY = "fn_knock:auth_logs:index";
const LEGACY_AUTH_LOG_DATA_PATTERN = "fn_knock:auth_log_data:*";
const IP_LOCATION_REFS_PATTERN = "fn_knock:ip_location:refs:*";
const LEGACY_AUTH_LOG_REF_PREFIX = "auth-log|";
const SCAN_COUNT = 200;

const scanKeys = async (
  pattern: string,
  maxMatches = Number.POSITIVE_INFINITY,
): Promise<string[]> => {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      SCAN_COUNT,
    );
    cursor = nextCursor;
    keys.push(...batch);
    if (keys.length >= maxMatches) {
      return keys.slice(0, maxMatches);
    }
  } while (cursor !== "0");

  return keys;
};

const deleteKeysInBatches = async (keys: string[]) => {
  for (let index = 0; index < keys.length; index += SCAN_COUNT) {
    const batch = keys.slice(index, index + SCAN_COUNT);
    if (batch.length > 0) {
      await redis.del(...batch);
    }
  }
};

const scanSetMembers = async (
  key: string,
  pattern: string,
  maxMatches = Number.POSITIVE_INFINITY,
): Promise<string[]> => {
  const members: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = await redis.sscan(
      key,
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      SCAN_COUNT,
    );
    cursor = nextCursor;
    members.push(...batch);
    if (members.length >= maxMatches) {
      return members.slice(0, maxMatches);
    }
  } while (cursor !== "0");

  return members;
};

const hasLegacyAuthLogReferences = async (): Promise<boolean> => {
  let cursor = "0";

  do {
    const [nextCursor, refKeys] = await redis.scan(
      cursor,
      "MATCH",
      IP_LOCATION_REFS_PATTERN,
      "COUNT",
      SCAN_COUNT,
    );
    cursor = nextCursor;

    for (const key of refKeys) {
      const members = await scanSetMembers(
        key,
        `${LEGACY_AUTH_LOG_REF_PREFIX}*`,
        1,
      );
      if (members.length > 0) {
        return true;
      }
    }
  } while (cursor !== "0");

  return false;
};

const hasLegacyAuthLogArtifacts = async (): Promise<boolean> => {
  const [indexExists, authLogKeys, refsExist] = await Promise.all([
    redis.exists(LEGACY_AUTH_LOG_INDEX_KEY),
    scanKeys(LEGACY_AUTH_LOG_DATA_PATTERN, 1),
    hasLegacyAuthLogReferences(),
  ]);

  return indexExists > 0 || authLogKeys.length > 0 || refsExist;
};

export const cleanupLegacyAuthLogStorage = async (): Promise<void> => {
  const [currentState, hasArtifacts] = await Promise.all([
    redis.get(LEGACY_AUTH_LOG_CLEANUP_STATE_KEY),
    hasLegacyAuthLogArtifacts(),
  ]);

  if (!hasArtifacts) {
    if (currentState !== "done") {
      await redis.set(LEGACY_AUTH_LOG_CLEANUP_STATE_KEY, "done");
    }
    return;
  }

  const locked = await redis.set(
    LEGACY_AUTH_LOG_CLEANUP_LOCK_KEY,
    String(Date.now()),
    "EX",
    3600,
    "NX",
  );
  if (locked !== "OK") {
    return;
  }

  try {
    await redis.set(LEGACY_AUTH_LOG_CLEANUP_STATE_KEY, "running", "EX", 3600);

    const authLogKeys = await scanKeys(LEGACY_AUTH_LOG_DATA_PATTERN);
    await deleteKeysInBatches(authLogKeys);
    await redis.del(LEGACY_AUTH_LOG_INDEX_KEY);

    const refKeys = await scanKeys(IP_LOCATION_REFS_PATTERN);
    for (const key of refKeys) {
      const legacyMembers = await scanSetMembers(
        key,
        `${LEGACY_AUTH_LOG_REF_PREFIX}*`,
      );
      if (legacyMembers.length > 0) {
        await redis.srem(key, ...legacyMembers);
      }
    }

    await redis.set(LEGACY_AUTH_LOG_CLEANUP_STATE_KEY, "done");

    if (authLogKeys.length > 0) {
      console.log(
        `[auth-log] removed legacy auth log storage (${authLogKeys.length} keys)`,
      );
    }
  } catch (error) {
    await redis.del(LEGACY_AUTH_LOG_CLEANUP_STATE_KEY);
    throw error;
  } finally {
    await redis.del(LEGACY_AUTH_LOG_CLEANUP_LOCK_KEY);
  }
};
