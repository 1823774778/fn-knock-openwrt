import { Elysia, t } from "elysia";
import { ipLocationService } from "../lib/ip-location";
import { withRouteDoc } from "../lib/openapi";

const IP_LOCATION_BATCH_LIMIT = 20;

export const ipLocationRoutes = new Elysia({
  prefix: "/api/admin/ip-location",
  tags: ["IP Location"],
}).post(
  "/batch",
  async ({ body, set }) => {
    if (body.ips.length > IP_LOCATION_BATCH_LIMIT) {
      set.status = 400;
      return {
        success: false,
        message: `单次最多查询 ${IP_LOCATION_BATCH_LIMIT} 个 IP`,
      };
    }

    const items = await ipLocationService.ensureEnqueuedBatch(body.ips);
    return {
      success: true,
      data: {
        items,
      },
    };
  },
  withRouteDoc("批量查询 IP 地理位置", {
    body: t.Object({
      ips: t.Array(t.String()),
    }),
  }),
);
