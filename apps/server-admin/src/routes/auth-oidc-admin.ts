import { Elysia, t } from "elysia";
import { oidcAuthService } from "../lib/auth/oidc/service";
import { routeDoc, withRouteDoc } from "../lib/openapi";

const providerCreateBody = t.Object({
  name: t.Optional(t.String()),
  type: t.String(),
  enabled: t.Optional(t.Boolean()),
  connection_config: t.Optional(t.Record(t.String(), t.Any())),
});

const providerUpdateBody = t.Object({
  name: t.Optional(t.String()),
  enabled: t.Optional(t.Boolean()),
  connection_config: t.Optional(t.Record(t.String(), t.Any())),
});

export const oidcAdminRoutes = new Elysia({
  prefix: "/api/admin/auth/oidc",
  tags: ["Admin"],
})
  .get(
    "/catalog",
    () => ({
      success: true,
      data: {
        providers: oidcAuthService.listProviderCatalog(),
      },
    }),
    routeDoc("获取外部登录提供商目录"),
  )
  .get(
    "/providers",
    async ({ request }) => ({
      success: true,
      data: {
        providers: await oidcAuthService.listProviders(request),
      },
    }),
    routeDoc("获取外部登录提供商列表"),
  )
  .post(
    "/providers",
    async ({ body, set }) => {
      try {
        const provider = await oidcAuthService.createProvider(body);
        return { success: true, data: provider };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "创建外部登录提供商失败",
        };
      }
    },
    withRouteDoc("创建外部登录提供商", { body: providerCreateBody }),
  )
  .patch(
    "/providers/:id",
    async ({ params, body, set }) => {
      try {
        const provider = await oidcAuthService.updateProvider(params.id, body);
        return { success: true, data: provider };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "更新外部登录提供商失败",
        };
      }
    },
    withRouteDoc("更新外部登录提供商", { body: providerUpdateBody }),
  )
  .delete(
    "/providers/:id",
    async ({ params, set }) => {
      try {
        await oidcAuthService.deleteProvider(params.id);
        return { success: true };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "删除外部登录提供商失败",
        };
      }
    },
    routeDoc("删除外部登录提供商"),
  )
  .post(
    "/providers/:id/test",
    async ({ params, set }) => {
      try {
        return await oidcAuthService.testProvider(params.id);
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "测试外部登录提供商失败",
        };
      }
    },
    routeDoc("测试外部登录提供商"),
  )
  .get(
    "/totp/:totpId/bindings",
    async ({ params }) => ({
      success: true,
      data: {
        bindings: await oidcAuthService.listBindingsByTotp(params.totpId),
      },
    }),
    routeDoc("获取 TOTP 关联的外部账号绑定"),
  )
  .delete(
    "/bindings/:id",
    async ({ params, set }) => {
      try {
        await oidcAuthService.deleteBinding(params.id);
        return { success: true };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "删除外部账号绑定失败",
        };
      }
    },
    routeDoc("删除外部账号绑定"),
  )
  .post(
    "/invitations",
    async ({ body, request, set }) => {
      try {
        const result = await oidcAuthService.createInvite({
          request,
          totpId: body.totp_id,
          providerId: body.provider_id,
          note: body.note,
        });
        return {
          success: true,
          data: {
            invite_url: result.invite_url,
            expires_at: result.invite.expires_at,
          },
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: error instanceof Error ? error.message : "创建绑定邀请失败",
        };
      }
    },
    withRouteDoc("创建外部账号绑定邀请", {
      body: t.Object({
        totp_id: t.String(),
        provider_id: t.String(),
        note: t.Optional(t.String()),
      }),
    }),
  );
