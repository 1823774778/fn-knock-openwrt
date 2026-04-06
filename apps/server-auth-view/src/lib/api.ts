import { createSignedApiClient } from "@frontend-core/api/createSignedApiClient";
import type { InternalAxiosRequestConfig } from "axios";
import type {
  AuthBootstrapData,
  AuthClientLocationData,
  AuthSessionData,
} from "@frontend-core/auth/types";
import type { CaptchaPublicSettings } from "@frontend-core/captcha/types";

type NoStoreParams = Record<string, string | number | boolean | undefined>;

const detectAppBasePrefix = () => {
  if (typeof window === "undefined") return "";
  const pathname = window.location.pathname || "/";

  if (pathname === "/__auth__" || pathname.startsWith("/__auth__/")) {
    return "/__auth__";
  }

  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    return "/auth";
  }

  return "";
};

const joinWithBasePrefix = (basePrefix: string, path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return basePrefix ? `${basePrefix}${normalizedPath}` : normalizedPath;
};

const appBasePrefix = detectAppBasePrefix();

export const authApiBasePath = joinWithBasePrefix(appBasePrefix, "/api/auth");
export const buildAuthApiPath = (path: string) =>
  joinWithBasePrefix(authApiBasePath, path);

const runtimeSecretPath = joinWithBasePrefix(
  appBasePrefix,
  "/__fn-knock/runtime-hmac-secret",
);

const runtimeSecret =
  typeof window !== "undefined"
    ? (window as Window & { __FN_KNOCK_HMAC_SECRET__?: string })
        .__FN_KNOCK_HMAC_SECRET__
    : undefined;
let hmacSecret = import.meta.env.VITE_HMAC_SECRET || runtimeSecret;

export const withNoStoreParams = (params?: NoStoreParams) => ({
  ...(params || {}),
  _ts: Date.now(),
});

const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const buildNoStoreRequestHeaders = (headers?: HeadersInit) => {
  const next = new Headers(headers);
  next.set("Cache-Control", "no-cache");
  next.set("Pragma", "no-cache");
  return next;
};

export const withNoStoreUrl = (input: string | URL) => {
  const original = input instanceof URL ? input.toString() : input;
  const baseOrigin =
    typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1";
  const url = new URL(original, baseOrigin);

  url.searchParams.set("_ts", Date.now().toString());

  if (input instanceof URL || ABSOLUTE_URL_RE.test(original)) {
    return url.toString();
  }

  return `${url.pathname}${url.search}${url.hash}`;
};

export const fetchNoStore = (input: string | URL, init?: RequestInit) =>
  fetch(withNoStoreUrl(input), {
    ...init,
    cache: "no-store",
    headers: buildNoStoreRequestHeaders(init?.headers),
  });

const applyNoStoreRequestDefaults = (config: InternalAxiosRequestConfig) => {
  const method = String(config.method || "get").toLowerCase();
  if (method !== "get" && method !== "head") {
    return config;
  }

  config.headers["Cache-Control"] = "no-cache";
  config.headers.Pragma = "no-cache";

  if (
    config.params &&
    typeof config.params === "object" &&
    !Array.isArray(config.params) &&
    "_ts" in (config.params as Record<string, unknown>)
  ) {
    return config;
  }

  config.params =
    config.params && typeof config.params === "object"
      ? {
          ...(config.params as Record<string, unknown>),
          _ts: Date.now(),
        }
      : { _ts: Date.now() };

  return config;
};

const fetchRuntimeHmacSecret = async () => {
  if (hmacSecret) return hmacSecret;
  try {
    const res = await fetchNoStore(runtimeSecretPath);
    if (res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        data?: { hmacSecret?: string };
      } | null;
      const next = payload?.data?.hmacSecret?.trim();
      if (next) {
        hmacSecret = next;
        return hmacSecret;
      }
    }
  } catch {
    // ignore and fallback below
  }
  throw new Error(
    "Missing HMAC secret: provide VITE_HMAC_SECRET or serve via backend runtime injection",
  );
};

export const apiClient = createSignedApiClient({
  baseURL: authApiBasePath,
  hmacSecret,
  getHmacSecret: fetchRuntimeHmacSecret,
});

apiClient.interceptors.request.use((config) =>
  applyNoStoreRequestDefaults(config),
);

export const CaptchaAPI = {
  async getConfig(): Promise<CaptchaPublicSettings> {
    const res = await apiClient.get("/captcha/config", {
      params: withNoStoreParams(),
    });
    return res.data.data;
  },
  async getPowChallenge() {
    const res = await apiClient.get("/challenge", {
      params: withNoStoreParams(),
    });
    return res.data;
  },
};

export const AuthAPI = {
  async getBootstrap(redirectUri?: string | null): Promise<AuthBootstrapData> {
    const res = await apiClient.get("/bootstrap", {
      params: withNoStoreParams(
        redirectUri ? { redirect_uri: redirectUri } : undefined,
      ),
    });
    return res.data.data;
  },
  async getSession(): Promise<AuthSessionData> {
    const res = await apiClient.get("/session", {
      params: withNoStoreParams(),
    });
    return res.data.data;
  },
  async getClientLocation(): Promise<AuthClientLocationData> {
    const res = await apiClient.get("/ip/location", {
      params: withNoStoreParams(),
    });
    return res.data.data;
  },
};
