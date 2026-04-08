import { Elysia, t } from "elysia";
import { scheduleSyncReverseProxyTrustedIPs } from "../lib/reverse-proxy-trusted-ips";
import { whitelistManager } from "../lib/whitelist-manager";
import { routeDoc, withRouteDoc } from "../lib/openapi";

export const whitelistRoutes = new Elysia({
  prefix: "/api/admin/whitelist",
  tags: ["Whitelist"],
})
  .get(
    "/",
    async () => {
      const records = await whitelistManager.getAllActiveRecords();
      return { success: true, data: records };
    },
    routeDoc("获取白名单列表"),
  )
  .post(
    "/",
    async ({ body }) => {
      const id = await whitelistManager.addWhiteList({
        ip: body.ip,
        expireAt: body.expireAt,
        source: body.source,
        comment: body.comment,
      });
      scheduleSyncReverseProxyTrustedIPs({ reason: "whitelist-add" });
      return { success: true, data: { id } };
    },
    withRouteDoc("新增白名单记录", {
      body: t.Object({
        ip: t.String(),
        expireAt: t.Union([t.Number(), t.Null()]),
        source: t.Union([t.Literal("manual"), t.Literal("auto")]),
        comment: t.Optional(t.String()),
      }),
    }),
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      const deleted = await whitelistManager.removeWhiteList(params.id);
      if (!deleted) {
        set.status = 404;
        return { success: false, message: "Record not found" };
      }
      scheduleSyncReverseProxyTrustedIPs({ reason: "whitelist-remove" });
      return { success: true };
    },
    withRouteDoc("删除白名单记录", {
      params: t.Object({
        id: t.String(),
      }),
    }),
  )
  .patch(
    "/:id/comment",
    async ({ params, body, set }) => {
      const updated = await whitelistManager.updateComment(
        params.id,
        body.comment,
      );
      if (!updated) {
        set.status = 404;
        return { success: false, message: "Record not found" };
      }
      return { success: true };
    },
    withRouteDoc("更新白名单备注", {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        comment: t.String(),
      }),
    }),
  );
