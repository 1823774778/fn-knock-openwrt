import { networkInterfaces } from "node:os";

export interface LocalIpv4Candidate {
  label: string;
  value: string;
  interface: string;
}

const EXCLUDED_INTERFACE_PATTERNS = [
  /^lo$/i,
  /^docker/i,
  /^br-/i,
  /^veth/i,
  /^tailscale/i,
  /^zt/i,
  /^tun/i,
  /^tap/i,
  /^wg/i,
] as const;

const isExcludedInterface = (name: string): boolean =>
  EXCLUDED_INTERFACE_PATTERNS.some((pattern) => pattern.test(name));

const isIpv4Family = (family: string | number): boolean =>
  family === "IPv4" || family === 4;

export const isPrivateIpv4Address = (value: string): boolean => {
  const [a, b] = value.split(".").map((item) => Number.parseInt(item, 10));
  if (
    a === undefined ||
    b === undefined ||
    !Number.isInteger(a) ||
    !Number.isInteger(b)
  ) {
    return false;
  }

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

export const listPrivateIpv4Candidates = (): LocalIpv4Candidate[] => {
  const seen = new Set<string>();
  const results: LocalIpv4Candidate[] = [];

  for (const [name, items] of Object.entries(networkInterfaces())) {
    if (!items || isExcludedInterface(name)) {
      continue;
    }

    for (const item of items) {
      if (item.internal || !isIpv4Family(item.family)) {
        continue;
      }

      const address = String(item.address ?? "").trim();
      if (!address || !isPrivateIpv4Address(address) || seen.has(address)) {
        continue;
      }

      seen.add(address);
      results.push({
        label: `${address} (${name})`,
        value: address,
        interface: name,
      });
    }
  }

  return results.sort((left, right) =>
    left.interface === right.interface
      ? left.value.localeCompare(right.value)
      : left.interface.localeCompare(right.interface),
  );
};
