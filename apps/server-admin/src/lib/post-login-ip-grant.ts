import type { AppConfig, LoginSession } from "./redis";
import { whitelistManager } from "./whitelist-manager";

export const AUTO_IP_GRANT_COMMENT = "登录后自动授权";

export const shouldRevokeCustomPostLoginIpGrant = (
  session:
    | Pick<LoginSession, "grantType" | "postLoginIpGrantMode" | "comment">
    | null
    | undefined,
  config: Pick<AppConfig, "auth_credential_settings">,
): boolean => {
  if (!session) return false;

  if (
    session.grantType === "login_ip_grant" &&
    session.postLoginIpGrantMode === "custom"
  ) {
    return true;
  }

  return (
    session.comment === AUTO_IP_GRANT_COMMENT &&
    config.auth_credential_settings?.post_login_ip_grant_mode === "custom"
  );
};

export const revokeCustomPostLoginIpGrant = async (
  session:
    | Pick<
        LoginSession,
        | "grantType"
        | "postLoginIpGrantMode"
        | "comment"
        | "postLoginIpGrantRecordId"
        | "ip"
      >
    | null
    | undefined,
  config: Pick<AppConfig, "auth_credential_settings">,
  fallbackIp?: string | null,
): Promise<boolean> => {
  if (!shouldRevokeCustomPostLoginIpGrant(session, config)) {
    return false;
  }

  if (session?.postLoginIpGrantRecordId) {
    return whitelistManager.removeWhiteList(session.postLoginIpGrantRecordId);
  }

  const ip = session?.ip || fallbackIp;
  if (!ip) {
    return false;
  }

  return whitelistManager.removeRecordsByIP(ip, "auto");
};
