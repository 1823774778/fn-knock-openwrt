import { dockerAdminPanelManager } from "./lib/docker-admin-panel";
import { redis } from "./lib/redis";

const printHelp = () => {
  console.log(`fn-knock Docker 管理面板密码重置工具

用法:
  node /opt/fn-knock/server/server-admin/reset-docker-admin-panel.js

作用:
  - 清除管理面板密码
  - 清除所有管理面板登录会话
  - 清除登录失败退避状态

执行完成后，下次访问 Docker 管理入口会重新进入“首次设置密码”流程。`);
};

const main = async () => {
  const args = new Set(process.argv.slice(2));
  if (args.has("-h") || args.has("--help")) {
    printHelp();
    return;
  }

  const summary = await dockerAdminPanelManager.resetPasswordState();

  console.log("[fn-knock] Docker 管理面板密码状态已清理");
  console.log(
    JSON.stringify(
      {
        passwordCleared: summary.password_cleared,
        sessionsCleared: summary.sessions_cleared,
        loginFailuresCleared: summary.login_failures_cleared,
      },
      null,
      2,
    ),
  );
  console.log(
    "[fn-knock] 下次访问 Docker 管理入口时，需要重新设置管理面板密码",
  );
};

main()
  .catch((error) => {
    console.error(
      "[fn-knock] 清理 Docker 管理面板密码失败:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await redis.quit();
    } catch {
      // ignore redis shutdown errors during process exit
    }
  });
