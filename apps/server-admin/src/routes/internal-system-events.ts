import { Elysia, t } from "elysia";
import {
  isSystemEventLevel,
  isSystemEventSource,
  isSystemEventSubjectKind,
  isSystemEventType,
} from "../lib/system-events/constants";
import { hydrateSystemEventIpLocations } from "../lib/system-events/ip-locations";
import { systemEventManager } from "../lib/system-events/manager";
import { withRouteDoc } from "../lib/openapi";

export const internalSystemEventRoutes = new Elysia({
  prefix: "/api/internal/system-events",
  tags: ["Internal Events"],
}).post(
  "/",
  async ({ body, request, set }) => {
    const origin = request.headers.get("origin")?.trim();
    if (origin) {
      set.status = 404;
      return { success: false, message: "Not found" };
    }

    const forwardedHeadersPresent =
      Boolean(request.headers.get("x-forwarded-host")) ||
      Boolean(request.headers.get("x-forwarded-for")) ||
      Boolean(request.headers.get("x-real-ip")) ||
      Boolean(request.headers.get("x-forwarded-proto"));
    if (forwardedHeadersPresent) {
      set.status = 404;
      return { success: false, message: "Not found" };
    }

    if (!isSystemEventType(body.type)) {
      set.status = 400;
      return { success: false, message: "Unsupported system event type" };
    }
    if (!isSystemEventSource(body.source)) {
      set.status = 400;
      return { success: false, message: "Unsupported system event source" };
    }
    if (body.level && !isSystemEventLevel(body.level)) {
      set.status = 400;
      return { success: false, message: "Unsupported system event level" };
    }
    if (body.subject && !isSystemEventSubjectKind(body.subject.kind)) {
      set.status = 400;
      return { success: false, message: "Unsupported subject kind" };
    }

    const event = await systemEventManager.publish({
      type: body.type,
      source: body.source,
      ...(body.level ? { level: body.level } : {}),
      ...(body.happened_at ? { happened_at: body.happened_at } : {}),
      ...(body.dedupe_key ? { dedupe_key: body.dedupe_key } : {}),
      ...(body.dedupe_ttl_seconds
        ? { dedupe_ttl_seconds: body.dedupe_ttl_seconds }
        : {}),
      ...(body.subject ? { subject: body.subject } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
      payload: body.payload as any,
    } as any);

    if (event) {
      await hydrateSystemEventIpLocations([event]);
    }

    return {
      success: true,
      skipped: !event,
      data: event,
    };
  },
  withRouteDoc("写入内部系统事件", {
    body: t.Object({
      type: t.String(),
      source: t.String(),
      level: t.Optional(t.String()),
      happened_at: t.Optional(t.String()),
      dedupe_key: t.Optional(t.String()),
      dedupe_ttl_seconds: t.Optional(t.Number()),
      subject: t.Optional(
        t.Object({
          kind: t.String(),
          id: t.String(),
        }),
      ),
      tags: t.Optional(t.Array(t.String())),
      payload: t.Record(t.String(), t.Any()),
    }),
  }),
);
