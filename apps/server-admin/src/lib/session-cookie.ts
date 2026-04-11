import { getBooleanEnv } from "./env";

type SameSitePolicy = "Strict" | "Lax" | "None";

export const FNOS_SHARE_SESSION_COOKIE_NAME = "fn-knock-fnos-share-session";
export const ADMIN_PANEL_SESSION_COOKIE_NAME = "fn-knock-admin-panel-session";

const resolveSameSite = (): SameSitePolicy => {
  const raw = process.env.SESSION_COOKIE_SAMESITE?.trim().toLowerCase();
  if (raw === "strict") return "Strict";
  if (raw === "none") return "None";
  return "Lax";
};

const appendSecure = (parts: string[], secureOverride?: boolean) => {
  const secureDefault = true;
  const secure =
    typeof secureOverride === "boolean"
      ? secureOverride
      : getBooleanEnv("SESSION_COOKIE_SECURE", secureDefault);
  if (secure) parts.push("Secure");
};

const buildCookie = ({
  name,
  value,
  maxAge,
  path,
  domain,
  httpOnly = true,
  secure,
}: {
  name: string;
  value: string;
  maxAge: number;
  path: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean;
}): string => {
  const sameSite = resolveSameSite();
  const parts = [
    `${name}=${value}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`,
  ];
  if (domain) parts.splice(2, 0, `Domain=${domain}`);
  if (httpOnly) parts.splice(2, 0, "HttpOnly");
  appendSecure(parts, secure);
  return parts.join("; ");
};

export const buildSessionCookie = (
  sessionId: string,
  maxAge: number,
  opts?: { domain?: string },
): string =>
  buildCookie({
    name: "x-go-reauth-proxy-session-id",
    value: sessionId,
    maxAge,
    path: "/",
    domain: opts?.domain,
  });

export const buildSessionClearCookie = (opts?: { domain?: string }): string => {
  return buildCookie({
    name: "x-go-reauth-proxy-session-id",
    value: "",
    maxAge: 0,
    path: "/",
    domain: opts?.domain,
  });
};

export const buildFnosShareSessionCookie = (
  sessionId: string,
  maxAge: number,
  opts?: { domain?: string },
): string =>
  buildCookie({
    name: FNOS_SHARE_SESSION_COOKIE_NAME,
    value: sessionId,
    maxAge,
    path: "/s",
    domain: opts?.domain,
  });

export const buildFnosShareSessionClearCookie = (opts?: {
  domain?: string;
}): string =>
  buildCookie({
    name: FNOS_SHARE_SESSION_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/s",
    domain: opts?.domain,
  });

export const buildAdminPanelSessionCookie = (
  sessionId: string,
  maxAge: number,
  opts?: { secure?: boolean },
): string =>
  buildCookie({
    name: ADMIN_PANEL_SESSION_COOKIE_NAME,
    value: sessionId,
    maxAge,
    path: "/",
    secure: opts?.secure,
  });

export const buildAdminPanelSessionClearCookie = (opts?: {
  secure?: boolean;
}): string =>
  buildCookie({
    name: ADMIN_PANEL_SESSION_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/",
    secure: opts?.secure,
  });
