import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { isValidCIDR } from "../../../../packages/admin-shared/src/utils/cidr";
import { normalizeIp } from "./ip-normalize";

export type WhiteListTargetType = "ip" | "cidr" | "cname";

const DOMAIN_PATTERN = /^([a-z0-9-]+\.)+[a-z0-9-]+$/i;

const parseIPv4Bytes = (value: string): Uint8Array | null => {
  const normalized = normalizeIp(value);
  if (!normalized || isIP(normalized) !== 4) return null;

  const parts = normalized.split(".");
  if (parts.length !== 4) return null;

  const bytes = new Uint8Array(4);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const parsed = Number.parseInt(part || "", 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return null;
    }
    bytes[index] = parsed;
  }

  return bytes;
};

const parseIPv6Bytes = (value: string): Uint8Array | null => {
  const normalized = normalizeIp(value).toLowerCase();
  if (!normalized || isIP(normalized) !== 6) return null;

  let working = normalized;
  if (working.includes(".")) {
    const lastColon = working.lastIndexOf(":");
    if (lastColon < 0) return null;

    const ipv4Bytes = parseIPv4Bytes(working.slice(lastColon + 1));
    if (!ipv4Bytes) return null;

    const high = ((ipv4Bytes[0] || 0) << 8) | (ipv4Bytes[1] || 0);
    const low = ((ipv4Bytes[2] || 0) << 8) | (ipv4Bytes[3] || 0);
    working = `${working.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const sections = working.split("::");
  if (sections.length > 2) return null;

  const parseSide = (input: string): string[] | null => {
    if (!input) return [];
    const parts = input.split(":");
    if (parts.some((part) => !part)) {
      return null;
    }
    return parts;
  };

  const left = parseSide(sections[0] ?? "");
  const right = parseSide(sections[1] ?? "");
  if (!left || !right) return null;

  const missingCount =
    sections.length === 2 ? 8 - left.length - right.length : 0;
  if (missingCount < 0) return null;

  const hextets =
    sections.length === 2
      ? [...left, ...Array.from({ length: missingCount }, () => "0"), ...right]
      : left;
  if (hextets.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let index = 0; index < hextets.length; index += 1) {
    const parsed = Number.parseInt(hextets[index] || "", 16);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) {
      return null;
    }
    bytes[index * 2] = (parsed >> 8) & 0xff;
    bytes[index * 2 + 1] = parsed & 0xff;
  }

  return bytes;
};

const parseAddressBytes = (value: string): Uint8Array | null => {
  const normalized = normalizeIp(value);
  if (!normalized) return null;
  const version = isIP(normalized);
  if (version === 4) return parseIPv4Bytes(normalized);
  if (version === 6) return parseIPv6Bytes(normalized);
  return null;
};

const formatIPv4Bytes = (bytes: Uint8Array): string =>
  Array.from(bytes).join(".");

const formatIPv6Bytes = (bytes: Uint8Array): string => {
  if (bytes.length !== 16) return "";

  const hextets = Array.from({ length: 8 }, (_, index) =>
    (((bytes[index * 2] || 0) << 8) | (bytes[index * 2 + 1] || 0)).toString(16),
  );

  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index < hextets.length; index += 1) {
    if (hextets[index] === "0") {
      if (currentStart < 0) {
        currentStart = index;
        currentLength = 1;
      } else {
        currentLength += 1;
      }
      continue;
    }

    if (currentLength > bestLength) {
      bestStart = currentStart;
      bestLength = currentLength;
    }
    currentStart = -1;
    currentLength = 0;
  }

  if (currentLength > bestLength) {
    bestStart = currentStart;
    bestLength = currentLength;
  }

  if (bestLength < 2) {
    return hextets.join(":");
  }

  const left = hextets.slice(0, bestStart).join(":");
  const right = hextets.slice(bestStart + bestLength).join(":");

  if (!left && !right) return "::";
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
};

const formatAddressBytes = (bytes: Uint8Array): string => {
  if (bytes.length === 4) return formatIPv4Bytes(bytes);
  if (bytes.length === 16) return formatIPv6Bytes(bytes);
  return "";
};

const maskBytes = (
  input: Uint8Array,
  prefixLength: number,
): Uint8Array => {
  const masked = new Uint8Array(input);
  let remainingBits = prefixLength;

  for (let index = 0; index < masked.length; index += 1) {
    if (remainingBits >= 8) {
      remainingBits -= 8;
      continue;
    }

    if (remainingBits <= 0) {
      masked[index] = 0;
      continue;
    }

    const mask = (0xff << (8 - remainingBits)) & 0xff;
    masked[index] = (masked[index] ?? 0) & mask;
    remainingBits = 0;
  }

  return masked;
};

const parseCIDR = (
  value: string,
): { addressBytes: Uint8Array; prefixLength: number } | null => {
  const trimmed = String(value || "").trim();
  if (!isValidCIDR(trimmed)) return null;

  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex <= 0) return null;

  const address = trimmed.slice(0, slashIndex).trim();
  const prefixLength = Number.parseInt(trimmed.slice(slashIndex + 1), 10);
  if (!Number.isFinite(prefixLength) || prefixLength < 0) return null;

  const addressBytes = parseAddressBytes(address);
  if (!addressBytes) return null;

  const maxPrefixLength = addressBytes.length * 8;
  if (prefixLength > maxPrefixLength) return null;

  return {
    addressBytes,
    prefixLength,
  };
};

const bytesMatchPrefix = (
  address: Uint8Array,
  network: Uint8Array,
  prefixLength: number,
): boolean => {
  const fullBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if ((address[index] ?? 0) !== (network[index] ?? 0)) {
      return false;
    }
  }

  if (remainingBits === 0) {
    return true;
  }

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (
    ((address[fullBytes] ?? 0) & mask) === ((network[fullBytes] ?? 0) & mask)
  );
};

export const inferWhiteListTargetType = (
  value: string,
): WhiteListTargetType | null => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (isValidCIDR(trimmed)) return "cidr";
  if (normalizeIp(trimmed)) return "ip";
  if (normalizeDomainTarget(trimmed)) return "cname";
  return null;
};

export const normalizeDomainTarget = (value: string): string => {
  const trimmed = String(value || "")
    .trim()
    .replace(/\.+$/, "")
    .toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("/") || trimmed.includes("..")) return "";

  const ascii = domainToASCII(trimmed);
  if (!ascii || ascii.length > 253) return "";
  if (!DOMAIN_PATTERN.test(ascii)) return "";

  const labels = ascii.split(".");
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    return "";
  }

  return ascii;
};

export const normalizeWhiteListTarget = (
  value: string,
  targetType: WhiteListTargetType,
): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  if (targetType === "cidr") {
    const parsed = parseCIDR(trimmed);
    if (!parsed) return "";

    const networkBytes = maskBytes(parsed.addressBytes, parsed.prefixLength);
    const networkAddress = formatAddressBytes(networkBytes);
    return networkAddress ? `${networkAddress}/${parsed.prefixLength}` : "";
  }

  if (targetType === "cname") {
    return normalizeDomainTarget(trimmed);
  }

  return normalizeIp(trimmed);
};

export const isIpMatchedByCIDR = (ip: string, cidr: string): boolean => {
  const normalizedIp = normalizeIp(ip);
  const parsed = parseCIDR(cidr);
  if (!normalizedIp || !parsed) return false;

  const ipBytes = parseAddressBytes(normalizedIp);
  if (
    !ipBytes ||
    ipBytes.length !== parsed.addressBytes.length
  ) {
    return false;
  }

  return bytesMatchPrefix(ipBytes, parsed.addressBytes, parsed.prefixLength);
};

export const doesClientIpMatchWhiteListTarget = (
  clientIp: string,
  target: string,
  targetType: WhiteListTargetType,
): boolean => {
  if (targetType === "cname") {
    return false;
  }

  if (targetType === "cidr") {
    return isIpMatchedByCIDR(clientIp, target);
  }

  const normalizedClientIp = normalizeIp(clientIp);
  const normalizedTargetIp = normalizeIp(target);
  return (
    Boolean(normalizedClientIp) && normalizedClientIp === normalizedTargetIp
  );
};
