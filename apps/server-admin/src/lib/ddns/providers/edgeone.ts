import type {
  DDNSProviderContext,
  DDNSProviderDefinition,
  DDNSUpdateResult,
} from "../types";
import { normalizeDomain, toPositiveInt, updateDualStack } from "./helpers";
import {
  EDGEONE_OVERSEAS_ACCESS_MODE_FIELD,
  requestEdgeOneJson,
} from "./edgeone-shared";

type EdgeOneDnsRecord = {
  RecordId?: string;
  Name?: string;
  Type?: string;
  Location?: string;
  Content?: string;
  TTL?: number;
};

type EdgeOneDescribeDnsRecordsResponse = {
  DnsRecords?: EdgeOneDnsRecord[];
  TotalCount?: number;
};

type EdgeOneCreateDnsRecordResponse = {
  RecordId?: string;
};

export const edgeoneProvider: DDNSProviderDefinition = {
  name: "edgeone",
  label: "腾讯云 EdgeOne",
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
      description: "EdgeOne 站点 ID，用于定位托管的 Zone",
    },
    {
      key: "domain",
      label: "完整域名",
      type: "text",
      placeholder: "home.example.com",
      required: true,
      description: "要更新的完整主机名；中文域名请先转为 punycode",
    },
    {
      key: "location",
      label: "解析线路",
      type: "text",
      placeholder: "Default 或 CN.BJ",
      required: false,
      description: "可选；默认留空表示 Default 全局线路",
    },
    {
      key: "ttl",
      label: "TTL",
      type: "text",
      placeholder: "300",
      required: false,
      description: "默认 300 秒，EdgeOne 允许 60-86400",
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

function normalizeEdgeOneLocation(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "default";
  }
  return trimmed.toLowerCase();
}

async function edgeoneRequest<T>(
  context: DDNSProviderContext,
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { config } = context;
  const secretId = config.secret_id?.trim();
  const secretKey = config.secret_key?.trim();
  if (!secretId || !secretKey) {
    throw new Error("腾讯云 EdgeOne 配置不完整");
  }

  return requestEdgeOneJson<T>(context, action, payload);
}

export async function edgeoneUpdate(
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
    return { success: false, message: "腾讯云 EdgeOne 配置不完整" };
  }

  const ttl = toPositiveInt(config.ttl, 300);
  const desiredLocation = normalizeEdgeOneLocation(config.location);

  return updateDualStack(
    "腾讯云 EdgeOne",
    ipv4,
    ipv6,
    async (recordType, ip) => {
      const list = await edgeoneRequest<EdgeOneDescribeDnsRecordsResponse>(
        context,
        "DescribeDnsRecords",
        {
          ZoneId: zoneId,
          Offset: 0,
          Limit: 100,
          Match: "all",
          Filters: [
            {
              Name: "name",
              Values: [domain],
              Fuzzy: false,
            },
          ],
        },
      );

      const existing = (list.DnsRecords || []).find((record) => {
        return (
          normalizeDomain(record.Name || "") === domain &&
          (record.Type || "").toUpperCase() === recordType &&
          normalizeEdgeOneLocation(record.Location) === desiredLocation
        );
      });

      if (existing) {
        if (existing.Content === ip) {
          return;
        }

        if (!existing.RecordId) {
          throw new Error("EdgeOne 返回的记录缺少 RecordId");
        }

        await edgeoneRequest(context, "ModifyDnsRecords", {
          ZoneId: zoneId,
          DnsRecords: [
            {
              RecordId: existing.RecordId,
              Name: domain,
              Type: recordType,
              Content: ip,
              TTL: ttl,
              ...(desiredLocation !== "default"
                ? { Location: config.location?.trim() }
                : {}),
            },
          ],
        });
        return;
      }

      const result = await edgeoneRequest<EdgeOneCreateDnsRecordResponse>(
        context,
        "CreateDnsRecord",
        {
          ZoneId: zoneId,
          Name: domain,
          Type: recordType,
          Content: ip,
          TTL: ttl,
          ...(desiredLocation !== "default"
            ? { Location: config.location?.trim() }
            : {}),
        },
      );

      if (!result.RecordId) {
        throw new Error("EdgeOne 未返回创建后的 RecordId");
      }
    },
  );
}
