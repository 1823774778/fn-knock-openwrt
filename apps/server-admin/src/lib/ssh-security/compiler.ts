import { normalizeCidrLines } from "../../../../../packages/admin-shared/src/utils/cidr";
import { cidrService } from "../cidr";
import {
  DEFAULT_SSH_SECURITY_CONFIG,
  normalizeSSHSecurityDurationUnit,
  type SSHSecurityConfigInput,
  validateSSHSecurityCustomCidrs,
} from "./config";
import type {
  SSHSecurityConfig,
  SSHSecurityRuntimeState,
  SSHSecuritySelection,
} from "./types";

const normalizePositiveInt = (
  value: unknown,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number => {
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const buildSelectionKey = (province: string, queryCity?: string | null) =>
  `${province.trim()}::${String(queryCity ?? "").trim()}`;

const dedupeSelectionInputs = (
  value: SSHSecurityConfigInput["allowed_regions"],
): NonNullable<SSHSecurityConfigInput["allowed_regions"]> => {
  const result: NonNullable<SSHSecurityConfigInput["allowed_regions"]> = [];
  const seen = new Set<string>();

  for (const item of Array.isArray(value) ? value : []) {
    const province = String(item.province ?? "").trim();
    const queryCity = String(item.query_city ?? "").trim() || null;
    if (!province) continue;

    const key = buildSelectionKey(province, queryCity);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ province, query_city: queryCity });
  }

  return result;
};

const toStoredSelection = (
  value: Awaited<ReturnType<typeof cidrService.getCidrs>>["selection"],
): SSHSecuritySelection => ({
  province: value.province,
  city: value.city,
  label: value.label,
  value: value.value,
  query_city: value.queryCity,
  is_province_wide: value.isProvinceWide,
  is_municipality: value.isMunicipality,
});

export const compileSSHSecurityConfig = async (
  input: SSHSecurityConfigInput,
  previous?: SSHSecurityConfig,
): Promise<{
  config: SSHSecurityConfig;
  runtime: SSHSecurityRuntimeState;
}> => {
  const base = previous ?? DEFAULT_SSH_SECURITY_CONFIG;
  const previousRegionInputs = base.allowed_regions.map((selection) => ({
    province: selection.province,
    query_city: selection.query_city,
  }));
  const customCidrs = validateSSHSecurityCustomCidrs(
    input.custom_cidrs ?? base.custom_cidrs,
  );
  const dedupedRegions = dedupeSelectionInputs(
    input.allowed_regions ?? previousRegionInputs,
  );
  const storedSelections: SSHSecuritySelection[] = [];
  const resolvedCidrs: string[] = [];

  for (const selection of dedupedRegions) {
    const lookup = await cidrService.getCidrs({
      province: selection.province,
      city: selection.query_city,
    });
    storedSelections.push(toStoredSelection(lookup.selection));
    resolvedCidrs.push(...lookup.cidrGroups.ipv4, ...lookup.cidrGroups.ipv6);
  }

  const now = new Date().toISOString();
  const enabled = input.enabled ?? base.enabled;
  const allowedCidrs = normalizeCidrLines([...resolvedCidrs, ...customCidrs]);

  return {
    config: {
      enabled,
      window_minutes: normalizePositiveInt(
        input.window_minutes,
        base.window_minutes,
        { min: 1, max: 24 * 60 },
      ),
      failed_login_threshold: normalizePositiveInt(
        input.failed_login_threshold,
        base.failed_login_threshold,
        { min: 1, max: 1000 },
      ),
      block_duration_value: normalizePositiveInt(
        input.block_duration_value,
        base.block_duration_value,
        { min: 1, max: 365 },
      ),
      block_duration_unit: normalizeSSHSecurityDurationUnit(
        input.block_duration_unit ?? base.block_duration_unit,
      ),
      allowed_regions: storedSelections,
      custom_cidrs: customCidrs,
      configured_at: previous?.configured_at || now,
      updated_at: now,
    },
    runtime: {
      enabled,
      allowed_cidrs: enabled ? allowedCidrs : [],
      updated_at: now,
    },
  };
};
