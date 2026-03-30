import type { AppConfig } from "./redis";

export const DEFAULT_AUTO_MANAGE_FIREWALL = true;

export const normalizeAutoManageFirewall = (value: unknown): boolean =>
  value !== false;

export const resolveAutoManageFirewall = (
  config?: Pick<AppConfig, "auto_manage_firewall"> | null,
): boolean => normalizeAutoManageFirewall(config?.auto_manage_firewall);

export const shouldAutoManageFirewallForRunType = (
  runType: 0 | 1 | 3,
  config?: Pick<AppConfig, "auto_manage_firewall"> | null,
): boolean => {
  if (runType === 0) return true;
  return resolveAutoManageFirewall(config);
};
