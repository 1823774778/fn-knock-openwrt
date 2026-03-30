import { redis } from "../redis";
import {
  CIDR_PROVINCE_WIDE_VALUE,
  type CidrCitiesPayload,
  type CidrCityItem,
  type CidrCityOption,
  type CidrLookupPayload,
  type CidrProvincesPayload,
  type CidrProvinceItem,
  type CidrProvinceOption,
  type CidrSelectorPayload,
} from "./types";

const CIDR_API_BASE =
  process.env.CIDR_API_BASE?.trim() || "https://cidr.wxlnk.com/api/v1";
const CIDR_REQUEST_TIMEOUT_MS = Math.max(
  2000,
  Number.parseInt(process.env.CIDR_REQUEST_TIMEOUT_MS || "10000", 10) || 10000,
);
const CIDR_SUCCESS_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const CIDR_USER_AGENT = "fn-knock-server-admin/1.0";
const PREFIX = "fn_knock:cidr";

const KEYS = {
  provinces: `${PREFIX}:provinces`,
  cities: (province: string) =>
    `${PREFIX}:cities:${encodeURIComponent(province)}`,
  cidrs: (province: string, city?: string | null) =>
    city
      ? `${PREFIX}:cidrs:${encodeURIComponent(province)}:${encodeURIComponent(city)}`
      : `${PREFIX}:cidrs:${encodeURIComponent(province)}`,
} as const;

type UpstreamEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type UpstreamProvinceItem = {
  name?: string;
  city_count?: number;
};

type UpstreamProvincesData = {
  items?: UpstreamProvinceItem[];
  total?: number;
};

type UpstreamCityItem = {
  name?: string;
  ipv4_count?: number;
  ipv6_count?: number;
};

type UpstreamCitiesData = {
  province?: string;
  items?: UpstreamCityItem[];
  total?: number;
};

type UpstreamCidrsData = {
  province?: string;
  city?: string;
  cidr_groups?: {
    4?: string[];
    6?: string[];
  };
  counts?: {
    4?: number;
    6?: number;
  };
};

export class CidrServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "CidrServiceError";
    this.statusCode = statusCode;
  }
}

const ensureBaseUrl = (value: string) =>
  value.endsWith("/") ? value : `${value}/`;

const normalizeName = (value: unknown): string => String(value ?? "").trim();

const toSafeInt = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const normalizeProvince = (province: string): string => {
  const normalized = normalizeName(province);
  if (!normalized) {
    throw new CidrServiceError("省份不能为空", 400);
  }
  return normalized;
};

const normalizeCity = (city?: string | null): string | null => {
  const normalized = normalizeName(city);
  if (!normalized || normalized === CIDR_PROVINCE_WIDE_VALUE) {
    return null;
  }
  return normalized;
};

const fetchWithTimeout = async (url: URL): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIDR_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: {
        "User-Agent": CIDR_USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CidrServiceError("CIDR 上游请求超时", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const getCachedJson = async <T>(
  key: string,
  loader: () => Promise<T>,
): Promise<T> => {
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      await redis.del(key);
    }
  }

  const data = await loader();
  await redis.set(
    key,
    JSON.stringify(data),
    "EX",
    CIDR_SUCCESS_CACHE_TTL_SECONDS,
  );
  return data;
};

const buildProvinceItem = (
  item: UpstreamProvinceItem,
): CidrProvinceItem | null => {
  const name = normalizeName(item.name);
  if (!name) return null;

  const cityCount = toSafeInt(item.city_count);
  const isMunicipality = cityCount <= 1;

  return {
    name,
    cityCount,
    isMunicipality,
    hasChildren: !isMunicipality,
  };
};

const buildCityItem = (item: UpstreamCityItem): CidrCityItem | null => {
  const name = normalizeName(item.name);
  if (!name) return null;

  return {
    name,
    ipv4Count: toSafeInt(item.ipv4_count),
    ipv6Count: toSafeInt(item.ipv6_count),
  };
};

class CidrService {
  private async fetchUpstream<T>(
    path: string,
    query?: Record<string, string>,
  ): Promise<T> {
    const baseUrl = ensureBaseUrl(CIDR_API_BASE);
    const url = new URL(path.replace(/^\/+/, ""), baseUrl);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        const normalized = normalizeName(value);
        if (normalized) {
          url.searchParams.set(key, normalized);
        }
      }
    }

    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new CidrServiceError(`CIDR 上游请求失败 (${response.status})`, 502);
    }

    let payload: UpstreamEnvelope<T> | null = null;
    try {
      payload = (await response.json()) as UpstreamEnvelope<T>;
    } catch {
      throw new CidrServiceError("CIDR 上游返回了无效 JSON", 502);
    }

    if (payload?.code !== 0 || payload.data == null) {
      throw new CidrServiceError(
        payload?.message?.trim() || "CIDR 上游返回异常",
        502,
      );
    }

    return payload.data;
  }

  async getProvinces(): Promise<CidrProvincesPayload> {
    const data = await getCachedJson(KEYS.provinces, async () =>
      this.fetchUpstream<UpstreamProvincesData>("provinces"),
    );

    const items = (data.items ?? [])
      .map((item) => buildProvinceItem(item))
      .filter((item): item is CidrProvinceItem => item !== null);

    const options: CidrProvinceOption[] = items.map((item) => ({
      label: item.name,
      value: item.name,
      cityCount: item.cityCount,
      isMunicipality: item.isMunicipality,
    }));

    return {
      items,
      options,
      total: toSafeInt(data.total, items.length),
    };
  }

  async getCities(provinceInput: string): Promise<CidrCitiesPayload> {
    const province = normalizeProvince(provinceInput);
    const data = await getCachedJson(KEYS.cities(province), async () =>
      this.fetchUpstream<UpstreamCitiesData>(
        `provinces/${encodeURIComponent(province)}/cities`,
      ),
    );

    const items = (data.items ?? [])
      .map((item) => buildCityItem(item))
      .filter((item): item is CidrCityItem => item !== null);
    const resolvedProvince = normalizeName(data.province) || province;
    const isMunicipality =
      items.length === 1 && normalizeName(items[0]?.name) === resolvedProvince;
    const supportsProvinceWide = !isMunicipality;

    const options: CidrCityOption[] = [];
    if (supportsProvinceWide) {
      options.push({
        label: `${resolvedProvince}全省`,
        value: CIDR_PROVINCE_WIDE_VALUE,
        queryCity: null,
        isProvinceWide: true,
        isMunicipality: false,
        ipv4Count: 0,
        ipv6Count: 0,
      });
    }

    for (const item of items) {
      options.push({
        label: item.name,
        value: item.name,
        queryCity: isMunicipality ? resolvedProvince : item.name,
        isProvinceWide: false,
        isMunicipality,
        ipv4Count: item.ipv4Count,
        ipv6Count: item.ipv6Count,
      });
    }

    return {
      province: resolvedProvince,
      items,
      options,
      total: toSafeInt(data.total, items.length),
      isMunicipality,
      supportsProvinceWide,
      defaultValue: isMunicipality
        ? resolvedProvince
        : CIDR_PROVINCE_WIDE_VALUE,
    };
  }

  async getSelector(province?: string): Promise<CidrSelectorPayload> {
    const provinces = await this.getProvinces();
    const normalizedProvince = normalizeName(province);

    return {
      provinces,
      cities: normalizedProvince
        ? await this.getCities(normalizedProvince)
        : null,
    };
  }

  async getCidrs(input: {
    province: string;
    city?: string | null;
  }): Promise<CidrLookupPayload> {
    const province = normalizeProvince(input.province);
    const city = normalizeCity(input.city);
    const data = await getCachedJson(KEYS.cidrs(province, city), async () =>
      this.fetchUpstream<UpstreamCidrsData>("cidrs", {
        province,
        ...(city ? { city } : {}),
      }),
    );

    const resolvedProvince = normalizeName(data.province) || province;
    const resolvedCity = normalizeName(data.city) || city;
    const ipv4 = Array.isArray(data.cidr_groups?.[4])
      ? data.cidr_groups?.[4]
      : [];
    const ipv6 = Array.isArray(data.cidr_groups?.[6])
      ? data.cidr_groups?.[6]
      : [];
    const ipv4Count = toSafeInt(data.counts?.[4], ipv4.length);
    const ipv6Count = toSafeInt(data.counts?.[6], ipv6.length);
    const isMunicipality = Boolean(
      resolvedCity && normalizeName(resolvedCity) === resolvedProvince,
    );
    const isProvinceWide = !resolvedCity;

    return {
      province: resolvedProvince,
      city: resolvedCity,
      selection: {
        province: resolvedProvince,
        city: resolvedCity,
        label: resolvedCity || `${resolvedProvince}全省`,
        value: resolvedCity || CIDR_PROVINCE_WIDE_VALUE,
        queryCity: resolvedCity,
        isProvinceWide,
        isMunicipality,
      },
      cidrGroups: {
        ipv4,
        ipv6,
      },
      counts: {
        ipv4: ipv4Count,
        ipv6: ipv6Count,
      },
      totalCount: ipv4Count + ipv6Count,
    };
  }
}

export const cidrService = new CidrService();

export * from "./types";
