import { redis } from "../../redis";
import type {
  OIDCAuthState,
  OIDCBindInvite,
  OIDCBinding,
  OIDCLoginErrorNotice,
  OIDCProvider,
} from "./types";

const ROOT_KEY = "fn_knock:oidc";
const PROVIDERS_INDEX_KEY = `${ROOT_KEY}:providers:index`;
const PROVIDERS_DATA_KEY_PREFIX = `${ROOT_KEY}:providers:data:`;
const BINDINGS_INDEX_KEY = `${ROOT_KEY}:bindings:index`;
const BINDINGS_DATA_KEY_PREFIX = `${ROOT_KEY}:bindings:data:`;
const BINDINGS_SUBJECT_KEY_PREFIX = `${ROOT_KEY}:bindings:subject:`;
const INVITE_KEY_PREFIX = `${ROOT_KEY}:invite:`;
const STATE_KEY_PREFIX = `${ROOT_KEY}:state:`;
const LOGIN_ERROR_KEY_PREFIX = `${ROOT_KEY}:login_error:`;

const consumeValueScript = `
local value = redis.call("GET", KEYS[1])
if not value then
  return nil
end
redis.call("DEL", KEYS[1])
return value
`;

const saveBindingIfSubjectAvailableScript = `
local bindingKey = KEYS[1]
local subjectKey = KEYS[2]
local indexKey = KEYS[3]
local bindingId = ARGV[1]
local bindingJson = ARGV[2]
local score = ARGV[3]

local existingBindingId = redis.call("GET", subjectKey)
if existingBindingId and existingBindingId ~= bindingId then
  return 0
end

redis.call("SET", bindingKey, bindingJson)
redis.call("SET", subjectKey, bindingId)
redis.call("ZADD", indexKey, score, bindingId)
return 1
`;

const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const toTimestamp = (
  value: string | null | undefined,
  fallback = Date.now(),
) => {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : fallback;
};

const getProviderKey = (id: string) => `${PROVIDERS_DATA_KEY_PREFIX}${id}`;
const getBindingKey = (id: string) => `${BINDINGS_DATA_KEY_PREFIX}${id}`;
const getSubjectKey = (subjectKey: string) =>
  `${BINDINGS_SUBJECT_KEY_PREFIX}${subjectKey}`;
const getInviteKey = (tokenHash: string) => `${INVITE_KEY_PREFIX}${tokenHash}`;
const getStateKey = (stateHash: string) => `${STATE_KEY_PREFIX}${stateHash}`;
const getLoginErrorKey = (tokenHash: string) =>
  `${LOGIN_ERROR_KEY_PREFIX}${tokenHash}`;

const getJsonList = async <T>(
  ids: string[],
  keyFactory: (id: string) => string,
) => {
  if (!ids.length) return { items: [] as T[], staleIds: [] as string[] };
  const values = await redis.mget(ids.map((id) => keyFactory(id)));
  const items: T[] = [];
  const staleIds: string[] = [];
  values.forEach((raw, index) => {
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

export class OIDCRedisStore {
  async listProviders(): Promise<OIDCProvider[]> {
    const ids = await redis.zrevrange(PROVIDERS_INDEX_KEY, 0, -1);
    const batch = await getJsonList<OIDCProvider>(ids, getProviderKey);
    if (batch.staleIds.length) {
      await redis.zrem(PROVIDERS_INDEX_KEY, ...batch.staleIds);
    }
    return batch.items;
  }

  async getProvider(id: string): Promise<OIDCProvider | null> {
    return safeParse<OIDCProvider>(await redis.get(getProviderKey(id)));
  }

  async saveProvider(provider: OIDCProvider): Promise<void> {
    await redis
      .pipeline()
      .set(getProviderKey(provider.id), JSON.stringify(provider))
      .zadd(PROVIDERS_INDEX_KEY, toTimestamp(provider.updated_at), provider.id)
      .exec();
  }

  async deleteProvider(id: string): Promise<void> {
    const bindings = await this.listBindingsByProvider(id);
    const pipeline = redis.pipeline();
    pipeline.del(getProviderKey(id)).zrem(PROVIDERS_INDEX_KEY, id);
    for (const binding of bindings) {
      pipeline
        .del(getBindingKey(binding.id))
        .del(getSubjectKey(binding.subject_key))
        .zrem(BINDINGS_INDEX_KEY, binding.id);
    }
    await pipeline.exec();
  }

  async listBindings(): Promise<OIDCBinding[]> {
    const ids = await redis.zrevrange(BINDINGS_INDEX_KEY, 0, -1);
    const batch = await getJsonList<OIDCBinding>(ids, getBindingKey);
    if (batch.staleIds.length) {
      await redis.zrem(BINDINGS_INDEX_KEY, ...batch.staleIds);
    }
    return batch.items;
  }

  async listBindingsByTotp(totpId: string): Promise<OIDCBinding[]> {
    return (await this.listBindings()).filter(
      (binding) => binding.totp_id === totpId,
    );
  }

  async listBindingsByProvider(providerId: string): Promise<OIDCBinding[]> {
    return (await this.listBindings()).filter(
      (binding) => binding.provider_id === providerId,
    );
  }

  async getBinding(id: string): Promise<OIDCBinding | null> {
    return safeParse<OIDCBinding>(await redis.get(getBindingKey(id)));
  }

  async getBindingBySubject(subjectKey: string): Promise<OIDCBinding | null> {
    const bindingId = await redis.get(getSubjectKey(subjectKey));
    if (!bindingId) return null;
    return this.getBinding(bindingId);
  }

  async saveBinding(binding: OIDCBinding): Promise<void> {
    await redis
      .pipeline()
      .set(getBindingKey(binding.id), JSON.stringify(binding))
      .set(getSubjectKey(binding.subject_key), binding.id)
      .zadd(BINDINGS_INDEX_KEY, toTimestamp(binding.updated_at), binding.id)
      .exec();
  }

  async saveBindingIfSubjectAvailable(binding: OIDCBinding): Promise<boolean> {
    const result = await redis.eval(
      saveBindingIfSubjectAvailableScript,
      3,
      getBindingKey(binding.id),
      getSubjectKey(binding.subject_key),
      BINDINGS_INDEX_KEY,
      binding.id,
      JSON.stringify(binding),
      String(toTimestamp(binding.updated_at)),
    );
    return Number(result) === 1;
  }

  async deleteBinding(id: string): Promise<boolean> {
    const binding = await this.getBinding(id);
    if (!binding) return false;
    await redis
      .pipeline()
      .del(getBindingKey(binding.id))
      .del(getSubjectKey(binding.subject_key))
      .zrem(BINDINGS_INDEX_KEY, binding.id)
      .exec();
    return true;
  }

  async deleteBindingsByTotp(totpId: string): Promise<number> {
    const bindings = await this.listBindingsByTotp(totpId);
    if (!bindings.length) return 0;
    const pipeline = redis.pipeline();
    for (const binding of bindings) {
      pipeline
        .del(getBindingKey(binding.id))
        .del(getSubjectKey(binding.subject_key))
        .zrem(BINDINGS_INDEX_KEY, binding.id);
    }
    await pipeline.exec();
    return bindings.length;
  }

  async saveInvite(invite: OIDCBindInvite, ttlSeconds: number): Promise<void> {
    await redis.set(
      getInviteKey(invite.token_hash),
      JSON.stringify(invite),
      "EX",
      ttlSeconds,
    );
  }

  async getInvite(tokenHash: string): Promise<OIDCBindInvite | null> {
    return safeParse<OIDCBindInvite>(await redis.get(getInviteKey(tokenHash)));
  }

  async consumeInvite(tokenHash: string): Promise<OIDCBindInvite | null> {
    const raw = await redis.eval(
      consumeValueScript,
      1,
      getInviteKey(tokenHash),
    );
    return typeof raw === "string" ? safeParse<OIDCBindInvite>(raw) : null;
  }

  async saveState(state: OIDCAuthState, ttlSeconds: number): Promise<void> {
    await redis.set(
      getStateKey(state.state_hash),
      JSON.stringify(state),
      "EX",
      ttlSeconds,
    );
  }

  async consumeState(stateHash: string): Promise<OIDCAuthState | null> {
    const raw = await redis.eval(consumeValueScript, 1, getStateKey(stateHash));
    return typeof raw === "string" ? safeParse<OIDCAuthState>(raw) : null;
  }

  async saveLoginErrorNotice(
    notice: OIDCLoginErrorNotice,
    ttlSeconds: number,
  ): Promise<void> {
    await redis.set(
      getLoginErrorKey(notice.token_hash),
      JSON.stringify(notice),
      "EX",
      ttlSeconds,
    );
  }

  async consumeLoginErrorNotice(
    tokenHash: string,
  ): Promise<OIDCLoginErrorNotice | null> {
    const raw = await redis.eval(
      consumeValueScript,
      1,
      getLoginErrorKey(tokenHash),
    );
    return typeof raw === "string"
      ? safeParse<OIDCLoginErrorNotice>(raw)
      : null;
  }
}

export const oidcRedisStore = new OIDCRedisStore();
