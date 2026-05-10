import { IPDetector } from "../../plugins/ip-detector";
import {
  findDDNSNetworkInterface,
  listDDNSNetworkInterfaces,
  listSelectableDDNSInterfaceAddresses,
  normalizeNetworkInterface,
} from "./network";
import { getUpdateScopeDetectionOptions } from "./providers/helpers";
import type { DDNSIpSource, DDNSUpdateScope } from "./types";

export const DDNS_IP_SOURCE_FIELD = "ip_source";
export const DDNS_INTERFACE_IPV4_INDEX_FIELD = "interface_ipv4_index";
export const DDNS_INTERFACE_IPV6_INDEX_FIELD = "interface_ipv6_index";
export const DEFAULT_DDNS_IP_SOURCE: DDNSIpSource = "public";
export const DEFAULT_DDNS_INTERFACE_ADDRESS_INDEX = "";

export type DDNSResolvedTargetIPs = {
  ipv4: string | null;
  ipv6: string | null;
  source: DDNSIpSource;
  sourceLabel: string;
  warnings: string[];
};

export function normalizeIpSource(
  value: string | null | undefined,
): DDNSIpSource {
  return value === "interface" ? "interface" : DEFAULT_DDNS_IP_SOURCE;
}

export function normalizeInterfaceAddressIndex(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return DEFAULT_DDNS_INTERFACE_ADDRESS_INDEX;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_DDNS_INTERFACE_ADDRESS_INDEX;
  }

  return String(parsed);
}

export function getDDNSIpSourceLabel(
  source: DDNSIpSource,
  networkInterface?: string | null,
): string {
  if (source === "interface") {
    const normalizedInterface = normalizeNetworkInterface(networkInterface);
    return normalizedInterface ? `网卡 ${normalizedInterface}` : "所选网卡";
  }

  return "公网";
}

export function getDDNSTargetIPUnavailableMessage(
  source: DDNSIpSource,
  scope: DDNSUpdateScope,
): string {
  if (source === "interface") {
    if (scope === "ipv6_only") {
      return "当前获取方式为从网卡直接获取，但所选网卡上没有可用的 IPv6 地址";
    }
    if (scope === "ipv4_only") {
      return "当前获取方式为从网卡直接获取，但所选网卡上没有可用的 IPv4 地址";
    }
    return "当前获取方式为从网卡直接获取，但所选网卡上没有可用的 IPv4 或 IPv6 地址";
  }

  if (scope === "ipv6_only") {
    return "当前获取方式为从公网获取，但未获取到可用的 IPv6 地址";
  }
  if (scope === "ipv4_only") {
    return "当前获取方式为从公网获取，但未获取到可用的 IPv4 地址";
  }
  return "当前获取方式为从公网获取，但未获取到可用的 IPv4 或 IPv6 地址";
}

function resolveInterfaceAddress(
  interfaceName: string,
  family: "ipv4" | "ipv6",
  index: string | null | undefined,
): string | null {
  const candidates = listSelectableDDNSInterfaceAddresses(
    interfaceName,
    family,
  );
  if (candidates.length === 0) {
    return null;
  }

  const normalizedIndex = normalizeInterfaceAddressIndex(index);
  if (!normalizedIndex) {
    throw new Error(
      `从网卡直接获取时，请先选择一个 ${family === "ipv4" ? "IPv4" : "IPv6"} 地址`,
    );
  }

  const selected = candidates[Number(normalizedIndex)];
  if (!selected) {
    throw new Error(
      `所选网卡的第 ${Number(normalizedIndex) + 1} 个 ${family === "ipv4" ? "IPv4" : "IPv6"} 地址已不可用，请重新选择`,
    );
  }

  return selected.address;
}

function listKnownSelectableIPv6Addresses(interfaceName?: string): string[] {
  if (interfaceName) {
    return listSelectableDDNSInterfaceAddresses(interfaceName, "ipv6").map(
      (item) => item.address,
    );
  }

  return listDDNSNetworkInterfaces().flatMap((item) =>
    item.selectableAddresses
      .filter((address) => address.family === "ipv6")
      .map((address) => address.address),
  );
}

export async function resolveDDNSTargetIPs(options: {
  updateScope: DDNSUpdateScope;
  networkInterface?: string | null;
  ipSource?: string | null;
  interfaceIpv4Index?: string | null;
  interfaceIpv6Index?: string | null;
}): Promise<DDNSResolvedTargetIPs> {
  const source = normalizeIpSource(options.ipSource);
  const detectionOptions = getUpdateScopeDetectionOptions(options.updateScope);
  const normalizedInterface = normalizeNetworkInterface(
    options.networkInterface,
  );

  if (source === "public") {
    const ips = await IPDetector.getCurrentIPs({
      networkInterface: normalizedInterface,
      ...detectionOptions,
    });
    const warnings: string[] = [];

    if (detectionOptions.enableIPv4 && ips.errors.ipv4) {
      warnings.push(
        ips.ipv6
          ? `IPv4 获取失败，将继续使用 IPv6 (${ips.errors.ipv4})`
          : `IPv4 获取失败 (${ips.errors.ipv4})`,
      );
    }
    if (detectionOptions.enableIPv6 && ips.errors.ipv6) {
      warnings.push(
        ips.ipv4
          ? `IPv6 获取失败，将继续使用 IPv4 (${ips.errors.ipv6})`
          : `IPv6 获取失败 (${ips.errors.ipv6})`,
      );
    }
    if (detectionOptions.enableIPv6 && ips.ipv6) {
      const knownIPv6Addresses = listKnownSelectableIPv6Addresses(
        normalizedInterface,
      );
      if (
        knownIPv6Addresses.length > 0 &&
        !knownIPv6Addresses.includes(ips.ipv6)
      ) {
        warnings.push(
          `公网探测得到的 IPv6 (${ips.ipv6}) 不在本机或 Docker 宿主机的可选网卡地址中；如果外网无法访问该地址，请改用“从网卡直接获取”并选择宿主机公网 IPv6`,
        );
      }
    }

    return {
      ipv4: ips.ipv4,
      ipv6: ips.ipv6,
      source,
      sourceLabel: getDDNSIpSourceLabel(source, normalizedInterface),
      warnings,
    };
  }

  if (!normalizedInterface) {
    throw new Error("从网卡直接获取时，必须先明确选择一张出站网卡");
  }

  const selectedInterface = findDDNSNetworkInterface(normalizedInterface);
  if (!selectedInterface) {
    throw new Error(`未找到可用网卡: ${normalizedInterface}`);
  }

  return {
    ipv4: detectionOptions.enableIPv4
      ? resolveInterfaceAddress(
          selectedInterface.name,
          "ipv4",
          options.interfaceIpv4Index,
        )
      : null,
    ipv6: detectionOptions.enableIPv6
      ? resolveInterfaceAddress(
          selectedInterface.name,
          "ipv6",
          options.interfaceIpv6Index,
        )
      : null,
    source,
    sourceLabel: getDDNSIpSourceLabel(source, selectedInterface.name),
    warnings: [],
  };
}
