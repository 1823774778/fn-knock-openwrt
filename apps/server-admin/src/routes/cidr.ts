import { Elysia, t } from "elysia";
import { CidrServiceError, cidrService } from "../lib/cidr";
import { routeDoc, withRouteDoc } from "../lib/openapi";

const handleCidrError = (
  error: unknown,
): { status: number; message: string } => {
  if (error instanceof CidrServiceError) {
    return {
      status: error.statusCode,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : "CIDR 服务异常",
  };
};

export const cidrRoutes = new Elysia({
  prefix: "/api/admin/cidr",
  tags: ["CIDR"],
})
  .get(
    "/provinces",
    async ({ set }) => {
      try {
        const payload = await cidrService.getProvinces();
        return { success: true, data: payload };
      } catch (error) {
        const handled = handleCidrError(error);
        set.status = handled.status;
        return { success: false, message: handled.message };
      }
    },
    routeDoc("获取省份列表"),
  )
  .get(
    "/cities",
    async ({ query, set }) => {
      try {
        const payload = await cidrService.getCities(query.province);
        return { success: true, data: payload };
      } catch (error) {
        const handled = handleCidrError(error);
        set.status = handled.status;
        return { success: false, message: handled.message };
      }
    },
    withRouteDoc("获取指定省份的城市列表", {
      query: t.Object({
        province: t.String(),
      }),
    }),
  )
  .get(
    "/selector",
    async ({ query, set }) => {
      try {
        const payload = await cidrService.getSelector(query.province);
        return { success: true, data: payload };
      } catch (error) {
        const handled = handleCidrError(error);
        set.status = handled.status;
        return { success: false, message: handled.message };
      }
    },
    withRouteDoc("获取省市联动选择器数据", {
      query: t.Object({
        province: t.Optional(t.String()),
      }),
    }),
  )
  .get(
    "/cidrs",
    async ({ query, set }) => {
      try {
        const payload = await cidrService.getCidrs({
          province: query.province,
          city: query.city,
        });
        return { success: true, data: payload };
      } catch (error) {
        const handled = handleCidrError(error);
        set.status = handled.status;
        return { success: false, message: handled.message };
      }
    },
    withRouteDoc("查询省市对应的 CIDR 列表", {
      query: t.Object({
        province: t.String(),
        city: t.Optional(t.String()),
      }),
    }),
  );
