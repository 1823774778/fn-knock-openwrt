import type { Elysia } from "elysia";
import { cron } from "@elysiajs/cron";
import { configManager } from "../lib/redis";
import { systemResourceMonitor } from "../lib/system-resource-monitor";

const parseIntSafe = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DEFAULT_SYSTEM_MONITOR_LOCK_TTL_SECONDS = 30;
const MAX_SYSTEM_MONITOR_LOCK_TTL_SECONDS = 300;

export const registerSystemMonitorCron = (app: Elysia) => {
  const pattern = process.env.SYSTEM_MONITOR_CRON || "*/5 * * * * *";
  const lockTtlSeconds = Math.max(
    1,
    Math.min(
      MAX_SYSTEM_MONITOR_LOCK_TTL_SECONDS,
      parseIntSafe(
        process.env.SYSTEM_MONITOR_LOCK_TTL,
        DEFAULT_SYSTEM_MONITOR_LOCK_TTL_SECONDS,
      ),
    ),
  );

  app.use(
    cron({
      name: "system-resource-monitor",
      pattern,
      async run() {
        try {
          const acquired = await configManager.setLockIfNotExists(
            "system-resource-monitor",
            lockTtlSeconds,
          );
          if (!acquired) return;

          await systemResourceMonitor.tick();
        } catch (error) {
          console.error("[system-monitor][cron] error:", error);
        }
      },
    }),
  );

  return app;
};
