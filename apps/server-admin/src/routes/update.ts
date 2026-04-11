import { Elysia } from "elysia";
import { updateManager } from "../lib/update-manager";
import { routeDoc } from "../lib/openapi";
import {
  getCapabilityUnavailableMessage,
  getRuntimeCapabilities,
} from "../lib/runtime-profile";

export const updateRoutes = new Elysia({
  prefix: "/api/admin/update",
  tags: ["Update"],
})
  .get(
    "/status",
    async () => {
      const data = await updateManager.getStatus();
      return { success: true, data };
    },
    routeDoc("获取更新状态"),
  )
  .post(
    "/check",
    async () => {
      await updateManager.checkNow("manual");
      const data = await updateManager.getStatus();
      return { success: true, data };
    },
    routeDoc("检查更新"),
  )
  .post(
    "/download",
    async ({ set }) => {
      if (!getRuntimeCapabilities().self_update_available) {
        set.status = 403;
        return {
          success: false,
          message: getCapabilityUnavailableMessage("self_update_available"),
        };
      }

      try {
        await updateManager.triggerDownload();
        const data = await updateManager.getStatus();
        return { success: true, message: "已开始下载更新包", data };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: error instanceof Error ? error.message : "启动下载失败",
        };
      }
    },
    routeDoc("下载更新包"),
  )
  .post(
    "/install",
    async ({ set }) => {
      if (!getRuntimeCapabilities().self_update_available) {
        set.status = 403;
        return {
          success: false,
          message: getCapabilityUnavailableMessage("self_update_available"),
        };
      }

      try {
        await updateManager.triggerInstall();
        return { success: true, message: "更新安装流程已启动" };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: error instanceof Error ? error.message : "启动安装失败",
        };
      }
    },
    routeDoc("安装更新"),
  )
  .post(
    "/check-and-download",
    async ({ set }) => {
      if (!getRuntimeCapabilities().self_update_available) {
        set.status = 403;
        return {
          success: false,
          message: getCapabilityUnavailableMessage("self_update_available"),
        };
      }

      try {
        await updateManager.checkNow("manual-check-and-download");
        await updateManager.triggerDownload();
        const data = await updateManager.getStatus();
        return { success: true, message: "已发起检查并开始下载", data };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: error instanceof Error ? error.message : "启动失败",
        };
      }
    },
    routeDoc("检查并下载更新"),
  )
  .get(
    "/confirm",
    async () => {
      const data = await updateManager.consumeConfirmMessage();
      return { success: true, data };
    },
    routeDoc("获取更新确认信息"),
  );
