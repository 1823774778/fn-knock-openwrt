import { Elysia, t } from "elysia";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { portScannerPlugin } from "../plugins/scanner";
import { acmePlugin } from "../plugins/acme";
import { ConfigManager } from "../lib/redis";
import { DOCKER_ADMIN_DISCOVER_IP_HEADER_NAME } from "../lib/docker-admin-panel";
import { isPrivateIpv4Address } from "../lib/local-network";
import { routeDoc } from "../lib/openapi";
import { getRuntimeProfile } from "../lib/runtime-profile";

const runtimeProfile = getRuntimeProfile();
const DOCKER_DISCOVER_PORTS = [
  80,
  81,
  88,
  443,
  3000,
  3001,
  5000,
  5001,
  5666,
  6688,
  7000,
  7001,
  7080,
  7443,
  8000,
  8001,
  8080,
  8081,
  8082,
  8086,
  8088,
  8090,
  8091,
  8096,
  8097,
  8123,
  8443,
  8888,
  9000,
  9001,
  9090,
  9091,
  9443,
  10000,
  12345,
  16601,
  18080,
  19999,
] as const;

const normalizeHostLike = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return new URL(`http://${trimmed}`).hostname.trim().toLowerCase();
  } catch {
    return trimmed
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .trim()
      .toLowerCase();
  }
};

const isUsablePrivateIpv4 = (value: string): boolean =>
  isIP(value) === 4 &&
  isPrivateIpv4Address(value) &&
  !value.startsWith("127.");

const DOCKER_DISCOVER_LAN_IP = (() => {
  const raw = process.env.DOCKER_DISCOVER_LAN_IP?.trim() || "";
  return isUsablePrivateIpv4(raw) ? raw : "";
})();

if (
  runtimeProfile.is_docker &&
  process.env.DOCKER_DISCOVER_LAN_IP &&
  !DOCKER_DISCOVER_LAN_IP
) {
  console.warn(
    `[scan] ignoring invalid DOCKER_DISCOVER_LAN_IP=${process.env.DOCKER_DISCOVER_LAN_IP}`,
  );
}

const resolveDockerDiscoverTargetHost = async (
  request: Request,
): Promise<string | null> => {
  const forwardedDiscoverIp = String(
    request.headers.get(DOCKER_ADMIN_DISCOVER_IP_HEADER_NAME) || "",
  ).trim();
  if (isUsablePrivateIpv4(forwardedDiscoverIp)) {
    return forwardedDiscoverIp;
  }

  if (DOCKER_DISCOVER_LAN_IP) {
    return DOCKER_DISCOVER_LAN_IP;
  }

  const candidateValues = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
  ]
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => normalizeHostLike(value))
    .filter(Boolean);

  try {
    candidateValues.push(new URL(request.url).hostname.trim().toLowerCase());
  } catch {
    // ignore malformed request URL
  }

  for (const candidate of candidateValues) {
    if (!candidate || candidate === "localhost") {
      continue;
    }

    if (isUsablePrivateIpv4(candidate)) {
      return candidate;
    }

    if (isIP(candidate) !== 0) {
      continue;
    }

    try {
      const resolved = await lookup(candidate, { family: 4, all: true });
      const privateMatch = resolved.find((item) =>
        isUsablePrivateIpv4(item.address),
      );
      if (privateMatch) {
        return privateMatch.address;
      }
    } catch {
      // ignore resolution failures and continue
    }
  }

  return null;
};

const buildDockerDiscoverHosts = (value: string): string[] => {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return [];
  }

  const octets = parts.map((item) => Number.parseInt(item, 10));
  if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return [];
  }

  const [a, b, c] = octets;
  return Array.from({ length: 254 }, (_, index) => `${a}.${b}.${c}.${index + 1}`);
};

const buildDockerDiscoverScope = (value: string): string | null => {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((item) => Number.parseInt(item, 10));
  if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return null;
  }

  const [a, b, c] = octets;
  return `${a}.${b}.${c}.0/24`;
};

const buildSingletonPortRanges = (ports: readonly number[]) =>
  ports.map((port) => ({ start: port, end: port }));

export const assetsRoutes = new Elysia({
  prefix: "/api/admin/scan",
  tags: ["Assets"],
})
  .use(portScannerPlugin)
  .use(acmePlugin)
  .get(
    "/discover",
    async ({ request, scannerService, set }) => {
      const configManager = new ConfigManager();
      const config = await configManager.getConfig();
      const proxy_mappings = config.proxy_mappings || [];

      const targetIp = runtimeProfile.is_docker
        ? await resolveDockerDiscoverTargetHost(request)
        : "127.0.0.1";
      if (!targetIp) {
        set.status = 400;
        return {
          success: false,
          message:
            "Docker 模式下未能识别当前机器的局域网 IP。若当前是通过第三方反向代理访问，请改用会透传局域网提示的代理链路，或临时设置 DOCKER_DISCOVER_LAN_IP 后重试。",
        };
      }
      const envPorts = [
        parseInt(process.env.ADMIN_VIEW_PORT || "7991", 10),
        parseInt(process.env.BACKEND_PORT || "7998", 10),
        parseInt(process.env.AUTH_PORT || "7997", 10),
        parseInt(process.env.GO_BACKEND_PORT || "7996", 10),
        parseInt(process.env.GO_REPROXY_PORT || "7999", 10),
        7995,
        8000, // 旧的飞牛端口
      ];

      const mappingPorts: number[] = [];
      for (const mapping of proxy_mappings) {
        if (mapping.target) {
          try {
            const parsedUrl = new URL(mapping.target);
            if (parsedUrl.port) {
              mappingPorts.push(parseInt(parsedUrl.port, 10));
            } else if (parsedUrl.protocol === "http:") {
              mappingPorts.push(80);
            } else if (parsedUrl.protocol === "https:") {
              mappingPorts.push(443);
            }
          } catch (e) {
            console.warn(
              `[扫描警告] 无法解析代理映射的 URL: ${mapping.target}`,
            );
          }
        }
      }

      const excludePorts = Array.from(new Set([...envPorts, ...mappingPorts, 8200, 30661, 30662]));
      console.log("准备跳过的端口:", excludePorts);

      try {
        const scanHosts = runtimeProfile.is_docker
          ? buildDockerDiscoverHosts(targetIp)
          : [targetIp];
        const scanScope = runtimeProfile.is_docker
          ? buildDockerDiscoverScope(targetIp)
          : targetIp;

        if (runtimeProfile.is_docker) {
          console.log(
            `[扫描] Docker 模式按网段发现: scope=${scanScope} hosts=${scanHosts.length} ports=${DOCKER_DISCOVER_PORTS.length}`,
          );
        }

        const scanResult = runtimeProfile.is_docker
          ? await scannerService.scanAndAnalyzeMany(scanHosts, {
              skipPorts: excludePorts,
              timeout: 80,
              maxConcurrent: 64,
              hostConcurrency: 6,
              portRanges: buildSingletonPortRanges(DOCKER_DISCOVER_PORTS),
            })
          : await scannerService.scanAndAnalyze(targetIp, {
              skipPorts: excludePorts,
              maxConcurrent: 200,
            });
        return {
          success: true,
          data: {
            ...scanResult,
            host: targetIp,
            scanScope,
          },
        };
      } catch (error) {
        return {
          success: false,
          message: (error as Error).message,
        };
      }
    },
    routeDoc("扫描可发现服务"),
  );
