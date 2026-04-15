import type {
  DDNSProviderContext,
  DDNSProviderDefinition,
  DDNSUpdateResult,
} from "../types";
import { normalizeDomain } from "./helpers";
import {
  EDGEONE_OVERSEAS_ACCESS_MODE_FIELD,
  requestEdgeOneJson,
} from "./edgeone-shared";

type EdgeOneOriginDetail = {
  HostHeader?: string | null;
  Origin?: string;
  OriginType?: string;
};

type EdgeOneAccelerationDomain = {
  DomainName?: string;
  OriginDetail?: EdgeOneOriginDetail | null;
};

type EdgeOneDescribeAccelerationDomainsResponse = {
  AccelerationDomains?: EdgeOneAccelerationDomain[];
  TotalCount?: number;
};

export const edgeoneCnameProvider: DDNSProviderDefinition = {
  name: "edgeone_cname",
  label: "腾讯云 EdgeOne（CNAME 接入）",
  fields: [
    {
      key: "secret_id",
      label: "SecretId",
      type: "text",
      placeholder: "AKID...",
      required: true,
    },
    {
      key: "secret_key",
      label: "SecretKey",
      type: "password",
      placeholder: "腾讯云 SecretKey",
      required: true,
    },
    {
      key: "zone_id",
      label: "Zone ID",
      type: "text",
      placeholder: "zone-xxxxxxxx",
      required: true,
      description: "EdgeOne 站点 ID，用于定位加速域名所属的站点",
    },
    {
      key: "domain",
      label: "加速域名",
      type: "text",
      placeholder: "home.example.com",
      required: true,
      description:
        "已在 EdgeOne 中创建的加速域名；仅支持当前源站类型为 IP_DOMAIN，且一次只能更新一个源站地址",
    },
    {
      key: EDGEONE_OVERSEAS_ACCESS_MODE_FIELD,
      label: "海外访问控制",
      type: "select",
      required: false,
      options: [
        { label: "不使用", value: "off" },
        { label: "屏蔽海外IP", value: "block_overseas" },
      ],
      description:
        "当开启时，将调用 EdgeOne 安全策略 API 屏蔽海外 IP 访问；港澳台不属于海外。该设置只会在配置变更时同步一次，不会随每次 DDNS 更新重复执行。",
    },
    {
      key: "endpoint",
      label: "API Endpoint",
      type: "text",
      placeholder: "https://teo.tencentcloudapi.com",
      required: false,
      description:
        "默认国内版，可改为 https://teo.intl.tencentcloudapi.com 或地域接入域名",
    },
    {
      key: "region",
      label: "Region",
      type: "text",
      placeholder: "留空",
      required: false,
      description: "可选；大多数场景可留空",
    },
  ],
};

async function edgeOneCnameRequest<T>(
  context: DDNSProviderContext,
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { config } = context;
  const secretId = config.secret_id?.trim();
  const secretKey = config.secret_key?.trim();
  if (!secretId || !secretKey) {
    throw new Error("腾讯云 EdgeOne（CNAME 接入）配置不完整");
  }

  return requestEdgeOneJson<T>(context, action, payload);
}

function resolveDesiredOrigin(
  ipv4: string | null,
  ipv6: string | null,
): { family: "ipv4" | "ipv6"; value: string } {
  if (ipv4 && ipv6) {
    throw new Error(
      "腾讯云 EdgeOne（CNAME 接入）一次只能更新一个源站地址，请将 DDNS 更新范围设置为“仅更新 IPv4”或“仅更新 IPv6”",
    );
  }

  if (ipv4) {
    return { family: "ipv4", value: ipv4 };
  }

  if (ipv6) {
    return { family: "ipv6", value: ipv6 };
  }

  throw new Error("腾讯云 EdgeOne（CNAME 接入）缺少可更新的 IP 地址");
}

function isValidCustomHostHeader(value: string | undefined): boolean {
  const host = normalizeDomain(value || "");
  if (!host) {
    return false;
  }

  if (
    host.includes("/") ||
    host.includes(":") ||
    host.includes("[") ||
    host.includes("]") ||
    host.includes("*") ||
    /\s/.test(host) ||
    /^https?:\/\//i.test(host)
  ) {
    return false;
  }

  if (host.length > 253) {
    return false;
  }

  return host.split(".").every((label) => {
    return (
      label.length > 0 &&
      label.length <= 63 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[a-z0-9-]+$/i.test(label)
    );
  });
}

function isHostHeaderFormatError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("InvalidHostHeaderFormat") ||
    message.includes("HostHeaderInvalid")
  );
}

function buildOriginInfoPayload(
  desiredOrigin: { family: "ipv4" | "ipv6"; value: string },
  hostHeader?: string,
): Record<string, string> {
  return {
    OriginType: "IP_DOMAIN",
    Origin: desiredOrigin.value,
    ...(hostHeader ? { HostHeader: hostHeader } : {}),
  };
}

export async function edgeoneCnameUpdate(
  context: DDNSProviderContext,
  ipv4: string | null,
  ipv6: string | null,
): Promise<DDNSUpdateResult> {
  const { config } = context;
  const secretId = config.secret_id?.trim();
  const secretKey = config.secret_key?.trim();
  const zoneId = config.zone_id?.trim();
  const domain = normalizeDomain(config.domain || "");
  if (!secretId || !secretKey || !zoneId || !domain) {
    return {
      success: false,
      message: "腾讯云 EdgeOne（CNAME 接入）配置不完整",
    };
  }

  let desiredOrigin: ReturnType<typeof resolveDesiredOrigin>;
  try {
    desiredOrigin = resolveDesiredOrigin(ipv4, ipv6);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const list =
    await edgeOneCnameRequest<EdgeOneDescribeAccelerationDomainsResponse>(
      context,
      "DescribeAccelerationDomains",
      {
        ZoneId: zoneId,
        Offset: 0,
        Limit: 20,
        Match: "all",
        Filters: [
          {
            Name: "domain-name",
            Values: [domain],
            Fuzzy: false,
          },
        ],
      },
    );

  const existing = (list.AccelerationDomains || []).find((item) => {
    return normalizeDomain(item.DomainName || "") === domain;
  });

  if (!existing) {
    return {
      success: false,
      message: `未找到 EdgeOne 加速域名: ${domain}`,
    };
  }

  const originType = (existing.OriginDetail?.OriginType || "")
    .trim()
    .toUpperCase();
  if (originType && originType !== "IP_DOMAIN") {
    return {
      success: false,
      message: `当前加速域名源站类型为 ${originType}，仅支持 IP_DOMAIN 类型的加速域名进行 DDNS 更新`,
    };
  }

  const currentOrigin = existing.OriginDetail?.Origin?.trim() || "";
  const rawHostHeader = existing.OriginDetail?.HostHeader?.trim();
  const hostHeader = isValidCustomHostHeader(rawHostHeader)
    ? normalizeDomain(rawHostHeader!)
    : undefined;
  const ignoredInvalidHostHeader = Boolean(rawHostHeader) && !hostHeader;

  if (currentOrigin === desiredOrigin.value) {
    return {
      success: true,
      message: "腾讯云 EdgeOne（CNAME 接入）源站已是最新，无需更新",
      ipv4Updated: desiredOrigin.family === "ipv4",
      ipv6Updated: desiredOrigin.family === "ipv6",
    };
  }

  try {
    await edgeOneCnameRequest(context, "ModifyAccelerationDomain", {
      ZoneId: zoneId,
      DomainName: domain,
      OriginInfo: buildOriginInfoPayload(desiredOrigin, hostHeader),
    });
  } catch (error) {
    if (!hostHeader || !isHostHeaderFormatError(error)) {
      throw error;
    }

    await edgeOneCnameRequest(context, "ModifyAccelerationDomain", {
      ZoneId: zoneId,
      DomainName: domain,
      OriginInfo: buildOriginInfoPayload(desiredOrigin),
    });
  }

  return {
    success: true,
    message: ignoredInvalidHostHeader
      ? "腾讯云 EdgeOne（CNAME 接入）源站更新成功 (1)"
      : "腾讯云 EdgeOne（CNAME 接入）源站更新成功",
    ipv4Updated: desiredOrigin.family === "ipv4",
    ipv6Updated: desiredOrigin.family === "ipv6",
  };
}
