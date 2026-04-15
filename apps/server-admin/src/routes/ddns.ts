import { Elysia, t } from "elysia";
import { ddnsLogBuffer, ddnsManager } from "../lib/ddns";
import { runAutomaticDDNSCheck } from "../lib/ddns/auto-check";
import {
  DDNS_INTERFACE_IPV4_INDEX_FIELD,
  DDNS_INTERFACE_IPV6_INDEX_FIELD,
  DDNS_IP_SOURCE_FIELD,
  getDDNSTargetIPUnavailableMessage,
  resolveDDNSTargetIPs,
} from "../lib/ddns/ip-source";
import {
  applyUpdateScope,
  DDNS_UPDATE_SCOPE_FIELD,
  normalizeUpdateScope,
} from "../lib/ddns/providers/helpers";
import { DDNS_NETWORK_INTERFACE_FIELD } from "../lib/ddns/network";
import { emitDDNSUpdateCompletedEvent } from "../lib/system-events/helpers";
import { routeDoc, withRouteDoc } from "../lib/openapi";

const parseDDNSLogEntries = (raw: string[]) =>
  raw.map((s) => {
    try {
      return JSON.parse(s);
    } catch {
      return { time: "", level: "info", message: s };
    }
  });

export const ddnsRoutes = new Elysia({
  prefix: "/api/admin/ddns",
  tags: ["DDNS"],
})

  // ── Status ────────────────────────────────────────────────────
  .get(
    "/status",
    async () => {
      const status = await ddnsManager.getStatus();
      return { success: true, data: status };
    },
    routeDoc("获取 DDNS 当前状态"),
  )

  // ── Toggle ────────────────────────────────────────────────────
  .post(
    "/toggle",
    async ({ body }) => {
      const wasEnabled = await ddnsManager.isEnabled();
      await ddnsManager.setEnabled(body.enabled);

      if (body.enabled && !wasEnabled) {
        void runAutomaticDDNSCheck({
          trigger: "enable",
          emitSkipLog: true,
        });
      }

      return { success: true };
    },
    withRouteDoc("启用或停用 DDNS", {
      body: t.Object({ enabled: t.Boolean() }),
    }),
  )

  // ── Providers list ────────────────────────────────────────────
  .get(
    "/providers",
    () => {
      const providers = ddnsManager.getProviders();
      return { success: true, data: providers };
    },
    routeDoc("获取 DDNS 提供商列表"),
  )

  .get(
    "/interfaces",
    () => {
      const interfaces = ddnsManager.listNetworkInterfaces();
      return { success: true, data: interfaces };
    },
    routeDoc("获取可用网卡列表"),
  )

  // ── Set current provider ──────────────────────────────────────
  .post(
    "/provider",
    async ({ body, set }) => {
      try {
        await ddnsManager.setProvider(body.provider);
        return { success: true };
      } catch (e: any) {
        set.status = 400;
        return { success: false, message: e?.message || "设置提供商失败" };
      }
    },
    withRouteDoc("设置当前 DDNS 提供商", {
      body: t.Object({ provider: t.String() }),
    }),
  )

  // ── Get config for provider ───────────────────────────────────
  .get(
    "/config/:provider",
    async ({ params }) => {
      const config = await ddnsManager.getConfig(params.provider);
      return { success: true, data: config };
    },
    routeDoc("获取指定 DDNS 提供商配置"),
  )

  // ── Save config for provider ──────────────────────────────────
  .post(
    "/config/:provider",
    async ({ params, body }) => {
      await ddnsManager.saveConfig(params.provider, body.config);
      return { success: true };
    },
    withRouteDoc("保存指定 DDNS 提供商配置", {
      body: t.Object({ config: t.Record(t.String(), t.String()) }),
    }),
  )

  // ── Test (manual trigger) ─────────────────────────────────────
  .post(
    "/test",
    async ({ set }) => {
      try {
        const provider = await ddnsManager.getProvider();
        if (!provider) {
          set.status = 400;
          return { success: false, message: "请先选择 DDNS 提供商" };
        }

        const complete = await ddnsManager.isConfigComplete();
        if (!complete) {
          set.status = 400;
          return {
            success: false,
            message: "当前提供商配置不完整，请填写所有必填字段",
          };
        }

        await ddnsManager.appendLog(
          "info",
          "手动测试开始，正在解析当前目标 IP...",
        );

        const config = await ddnsManager.getConfig(provider);
        await ddnsManager.ensureProviderAuxiliaryState({
          providerName: provider,
          emitLog: true,
          logPrefix: "手动测试",
        });
        const updateScope = normalizeUpdateScope(
          config[DDNS_UPDATE_SCOPE_FIELD],
        );
        const ips = await resolveDDNSTargetIPs({
          updateScope,
          ipSource: config[DDNS_IP_SOURCE_FIELD],
          networkInterface: config[DDNS_NETWORK_INTERFACE_FIELD],
          interfaceIpv4Index: config[DDNS_INTERFACE_IPV4_INDEX_FIELD],
          interfaceIpv6Index: config[DDNS_INTERFACE_IPV6_INDEX_FIELD],
        });

        await ddnsManager.appendLog(
          "info",
          `当前目标 IP（${ips.sourceLabel}） — IPv4: ${ips.ipv4 || "无"}, IPv6: ${ips.ipv6 || "无"}`,
        );
        for (const warning of ips.warnings) {
          await ddnsManager.appendLog("warn", warning);
        }

        const scopedIPs = applyUpdateScope(updateScope, ips.ipv4, ips.ipv6);
        if (!scopedIPs.ipv4 && !scopedIPs.ipv6) {
          const message = getDDNSTargetIPUnavailableMessage(
            ips.source,
            updateScope,
          );
          await ddnsManager.appendLog("error", `${message}，测试中止`);
          set.status = 500;
          return { success: false, message };
        }

        const previousIp = await ddnsManager.getLastIP();
        const result = await ddnsManager.executeUpdate(ips.ipv4, ips.ipv6);
        await emitDDNSUpdateCompletedEvent({
          trigger: "manual_test",
          provider,
          success: result.success,
          message: result.message,
          updateScope,
          ipSource: ips.source,
          previousIpv4: previousIp.ipv4,
          previousIpv6: previousIp.ipv6,
          nextIpv4: scopedIPs.ipv4,
          nextIpv6: scopedIPs.ipv6,
        });

        if (result.success) {
          await ddnsManager.setLastIP(scopedIPs.ipv4, scopedIPs.ipv6, {
            merge: true,
          });
          await ddnsManager.appendLog("info", `更新成功: ${result.message}`);
        } else {
          await ddnsManager.appendLog("error", `更新失败: ${result.message}`);
        }

        return {
          success: result.success,
          message: result.message,
          data: { ipv4: ips.ipv4, ipv6: ips.ipv6 },
        };
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error("[ddns][manual-test] error:", e);
        await ddnsManager.appendLog("error", `测试异常: ${msg}`);
        set.status = 500;
        return { success: false, message: msg };
      }
    },
    routeDoc("手动触发 DDNS 测试更新"),
  )

  // ── Logs ──────────────────────────────────────────────────────
  .get(
    "/logs",
    async ({ query }) => {
      const limit = Math.max(
        1,
        Math.min(parseInt((query.limit as any) || "200", 10), 1000),
      );
      const logs = await ddnsManager.getLogs(limit);
      return { success: true, data: logs };
    },
    routeDoc("获取 DDNS 日志"),
  )

  .delete(
    "/logs",
    async () => {
      await ddnsManager.clearLogs();
      return { success: true };
    },
    routeDoc("清空 DDNS 日志"),
  )

  // ── Polling ──────────────────────────────────────────────────
  .get(
    "/poll",
    async ({ query }) => {
      const { cursor, reset, items } = await ddnsLogBuffer.poll(query.cursor);
      const status = await ddnsManager.getStatus();

      return {
        success: true,
        data: {
          cursor,
          reset,
          logs: parseDDNSLogEntries(items),
          status,
        },
      };
    },
    withRouteDoc("轮询 DDNS 日志与状态", {
      query: t.Object({
        cursor: t.Optional(t.String()),
      }),
    }),
  );
