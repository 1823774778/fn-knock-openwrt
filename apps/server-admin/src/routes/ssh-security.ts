import { Elysia, t } from "elysia";
import { sshSecurityService } from "../lib/ssh-security/service";
import { routeDoc, withRouteDoc } from "../lib/openapi";

const parseDeleteIps = (body: unknown): string[] => {
  if (!body || typeof body !== "object") return [];
  const value = (body as { ips?: unknown }).ips;
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
};

export const sshSecurityRoutes = new Elysia({
  prefix: "/api/admin/ssh-security",
  tags: ["SSH Security"],
})
  .get(
    "/config",
    async () => ({
      success: true,
      data: await sshSecurityService.getDetails(),
    }),
    routeDoc("获取 SSH 安全配置"),
  )
  .post(
    "/config",
    async ({ body, set }) => {
      try {
        const details =
          body && Object.keys(body).length === 1 && "enabled" in body
            ? await sshSecurityService.patchEnabled(body.enabled === true)
            : await sshSecurityService.updateConfig({
                enabled: body.enabled,
                window_minutes: body.window_minutes,
                failed_login_threshold: body.failed_login_threshold,
                block_duration_value: body.block_duration_value,
                block_duration_unit: body.block_duration_unit,
                allowed_regions: body.allowed_regions,
                custom_cidrs: body.custom_cidrs,
              });
        return { success: true, data: details };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "更新 SSH 安全配置失败",
        };
      }
    },
    withRouteDoc("更新 SSH 安全配置", {
      body: t.Partial(
        t.Object({
          enabled: t.Boolean(),
          window_minutes: t.Number(),
          failed_login_threshold: t.Number(),
          block_duration_value: t.Number(),
          block_duration_unit: t.Union([
            t.Literal("minute"),
            t.Literal("hour"),
            t.Literal("day"),
          ]),
          allowed_regions: t.Array(
            t.Object({
              province: t.String(),
              query_city: t.Optional(t.Union([t.String(), t.Null()])),
            }),
          ),
          custom_cidrs: t.Array(t.String()),
        }),
      ),
    }),
  )
  .post(
    "/firewall/sync",
    async ({ set }) => {
      try {
        const result = await sshSecurityService.syncFirewallBlocks();
        return {
          success: true,
          data: result,
          message: `已同步 ${result.allowed_cidrs} 条允许 CIDR 与 ${result.synced} 个 SSH 封锁 IP 到 ${result.ports.join("、")} 端口`,
        };
      } catch (error) {
        set.status = 502;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "同步 SSH 防火墙失败",
        };
      }
    },
    routeDoc("同步 SSH 防火墙封锁规则"),
  )
  .post(
    "/firewall/clear",
    async ({ set }) => {
      try {
        const result = await sshSecurityService.clearFirewall();
        return {
          success: true,
          data: result,
          message: "已清空 SSH 专用防火墙规则",
        };
      } catch (error) {
        set.status = 502;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "清空 SSH 防火墙失败",
        };
      }
    },
    routeDoc("清空 SSH 专用防火墙规则"),
  )
  .get(
    "/login-logs",
    async ({ query, set }) => {
      try {
        return {
          success: true,
          data: await sshSecurityService.listLoginLogs(query),
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "读取 SSH 登录日志失败",
        };
      }
    },
    routeDoc("查询 SSH 登录日志"),
  )
  .get(
    "/blocks",
    async ({ query }) => ({
      success: true,
      data: await sshSecurityService.listBlocks(query),
    }),
    routeDoc("查询 SSH 封锁列表"),
  )
  .get(
    "/blocks/:ip",
    async ({ params, set }) => {
      const record = await sshSecurityService.getBlock(params.ip);
      if (!record) {
        set.status = 404;
        return { success: false, message: "封锁记录不存在" };
      }
      return { success: true, data: record };
    },
    withRouteDoc("查询 SSH 封锁详情", {
      params: t.Object({
        ip: t.String(),
      }),
    }),
  )
  .delete(
    "/blocks/:ip",
    async ({ params, set }) => {
      try {
        const removed = await sshSecurityService.removeBlock(params.ip);
        if (!removed) {
          set.status = 404;
          return { success: false, message: "封锁记录不存在" };
        }
        return { success: true };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: error instanceof Error ? error.message : "解除封锁失败",
        };
      }
    },
    withRouteDoc("解除单个 SSH 封锁", {
      params: t.Object({
        ip: t.String(),
      }),
    }),
  )
  .delete(
    "/blocks",
    async ({ body, set }) => {
      const ips = parseDeleteIps(body);
      if (ips.length === 0) {
        set.status = 400;
        return { success: false, message: "请选择要解除封锁的 IP" };
      }

      try {
        const removed = await sshSecurityService.removeBlocks(ips);
        return { success: true, data: { removed } };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: error instanceof Error ? error.message : "批量解除封锁失败",
        };
      }
    },
    routeDoc("批量解除 SSH 封锁"),
  );
