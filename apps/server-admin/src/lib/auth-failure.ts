import { normalizeIp } from "./ip-normalize";
import { loginBackoffService } from "./login-backoff";
import { configManager } from "./redis";
import { emitLoginFailureEvent } from "./system-events/helpers";

export const normalizeAuthFailureTrackingIp = (
  ip: string | null | undefined,
): string => {
  const normalized = normalizeIp(ip);
  if (normalized) return normalized;

  const raw = String(ip ?? "").trim();
  return raw || "unknown";
};

export const resetAuthFailureTracking = async (
  ip: string | null | undefined,
) => {
  const normalizedIp = normalizeAuthFailureTrackingIp(ip);
  await loginBackoffService.reset(normalizedIp);
};

export const registerAuthFailure = async (args: {
  clientIp: string | null | undefined;
  userAgent: string;
  method: "TOTP" | "PASSKEY" | "OIDC";
  credentialName?: string;
  linkedTotpName?: string;
}) => {
  const normalizedIp = normalizeAuthFailureTrackingIp(args.clientIp);
  const credentialName =
    args.credentialName?.trim() ||
    (args.method === "PASSKEY"
      ? "Unknown Passkey"
      : args.method === "OIDC"
        ? "Unknown OIDC"
        : "! Unknown TOTP");

  const failure = await loginBackoffService.registerFailure(normalizedIp);
  const config = await configManager.getConfig();
  const eventConfig = config.event_system;

  if (eventConfig?.enabled && eventConfig.rules.login_failure.enabled) {
    await emitLoginFailureEvent({
      ip: normalizedIp,
      attempts: failure.attempts,
      retryAfterSeconds: failure.retryAfter,
      ...(failure.blockedUntil
        ? {
            blockedUntil: new Date(failure.blockedUntil).toISOString(),
          }
        : {}),
      method: args.method,
      credentialName,
      linkedTotpName: args.linkedTotpName,
      userAgent: args.userAgent,
    });
  }

  return failure;
};
