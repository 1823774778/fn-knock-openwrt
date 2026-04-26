import { createServer, type IncomingMessage, type Server } from "node:http";

export interface AutoHttpsConfig {
  enabled: boolean;
}

export type AutoHttpsRuntimeStatus = "disabled" | "active" | "error";

export interface AutoHttpsRuntimeState {
  enabled: boolean;
  active: boolean;
  status: AutoHttpsRuntimeStatus;
  listen_host: string;
  listen_port: number;
  redirect_scheme: "https";
  last_error: string | null;
  last_error_at: string | null;
  updated_at: string;
}

const AUTO_HTTPS_LISTEN_PORT = 80;
const AUTO_HTTPS_LISTEN_HOST =
  process.env.FN_KNOCK_AUTO_HTTPS_HOST?.trim() || "0.0.0.0";

const nowIso = () => new Date().toISOString();

const stripDefaultHttpPort = (host: string) => {
  if (/^\[[^\]]+\]:80$/i.test(host)) {
    return host.slice(0, -3);
  }
  if (!host.startsWith("[") && /:80$/i.test(host)) {
    return host.slice(0, -3);
  }
  return host;
};

const normalizeRequestHost = (req: IncomingMessage) => {
  const rawHost = Array.isArray(req.headers.host)
    ? req.headers.host[0]
    : req.headers.host;
  const host = String(rawHost || "localhost")
    .replace(/[\r\n]/g, "")
    .trim();
  return stripDefaultHttpPort(host || "localhost");
};

const resolveRedirectPath = (req: IncomingMessage, host: string) => {
  try {
    const url = new URL(req.url || "/", `http://${host}`);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
};

const normalizeListenError = (error: unknown) => {
  const err = error as NodeJS.ErrnoException;
  if (err?.code === "EACCES") {
    return "没有权限监听 80 端口，请确认当前设备或容器允许程序绑定低端口。";
  }
  if (err?.code === "EADDRINUSE") {
    return "80 端口已被其他程序占用，自动 HTTPS 无法启动。请尝试飞牛系统设置，安全性，端口设置，编辑，取消勾选：重定向 80 与 443 端口";
  }
  if (err?.message) {
    return `监听 80 端口失败：${err.message}`;
  }
  return "监听 80 端口失败。";
};

const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const createRedirectServer = () => {
  const server = createServer((req, res) => {
    const host = normalizeRequestHost(req);
    const location = `https://${host}${resolveRedirectPath(req, host)}`;

    res.statusCode = 308;
    res.setHeader("Location", location);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "close");
    res.end();
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return server;
};

export class AutoHttpsRedirectManager {
  private server: Server | null = null;
  private state: AutoHttpsRuntimeState = this.buildState(false, false);
  private operation: Promise<AutoHttpsRuntimeState> = Promise.resolve(
    this.state,
  );

  getRuntimeState(): AutoHttpsRuntimeState {
    return this.state;
  }

  async applyConfig(config: AutoHttpsConfig): Promise<AutoHttpsRuntimeState> {
    this.operation = this.operation.then(
      () => this.applyConfigNow(config),
      () => this.applyConfigNow(config),
    );
    return this.operation;
  }

  private buildState(
    enabled: boolean,
    active: boolean,
    error?: string | null,
  ): AutoHttpsRuntimeState {
    return {
      enabled,
      active,
      status: !enabled ? "disabled" : active ? "active" : "error",
      listen_host: AUTO_HTTPS_LISTEN_HOST,
      listen_port: AUTO_HTTPS_LISTEN_PORT,
      redirect_scheme: "https",
      last_error: error || null,
      last_error_at: error ? nowIso() : null,
      updated_at: nowIso(),
    };
  }

  private buildErrorState(error: string): AutoHttpsRuntimeState {
    return {
      enabled: false,
      active: false,
      status: "error",
      listen_host: AUTO_HTTPS_LISTEN_HOST,
      listen_port: AUTO_HTTPS_LISTEN_PORT,
      redirect_scheme: "https",
      last_error: error,
      last_error_at: nowIso(),
      updated_at: nowIso(),
    };
  }

  private async applyConfigNow(
    config: AutoHttpsConfig,
  ): Promise<AutoHttpsRuntimeState> {
    if (!config.enabled) {
      await this.stopServer();
      this.state = this.buildState(false, false);
      return this.state;
    }

    if (this.server?.listening) {
      this.state = this.buildState(true, true);
      return this.state;
    }

    await this.stopServer();

    try {
      const server = createRedirectServer();
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(AUTO_HTTPS_LISTEN_PORT, AUTO_HTTPS_LISTEN_HOST);
      });
      this.server = server;
      this.state = this.buildState(true, true);
    } catch (error) {
      this.server = null;
      this.state = this.buildErrorState(normalizeListenError(error));
    }

    return this.state;
  }

  private async stopServer() {
    const server = this.server;
    this.server = null;
    if (!server?.listening) {
      return;
    }

    await closeServer(server).catch((error) => {
      console.error("[auto-https] failed to stop redirect server:", error);
    });
  }
}

export const autoHttpsRedirectManager = new AutoHttpsRedirectManager();
