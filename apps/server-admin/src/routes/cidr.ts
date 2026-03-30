import { Elysia, t } from "elysia";
import { CidrServiceError, cidrService } from "../lib/cidr";

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

export const cidrRoutes = new Elysia({ prefix: "/api/admin/cidr" })
  .get("/provinces", async ({ set }) => {
    try {
      const payload = await cidrService.getProvinces();
      return { success: true, data: payload };
    } catch (error) {
      const handled = handleCidrError(error);
      set.status = handled.status;
      return { success: false, message: handled.message };
    }
  })
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
    {
      query: t.Object({
        province: t.String(),
      }),
    },
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
    {
      query: t.Object({
        province: t.Optional(t.String()),
      }),
    },
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
    {
      query: t.Object({
        province: t.String(),
        city: t.Optional(t.String()),
      }),
    },
  );
