# fn-knock-turborepo

`fn-knock` 的 Turborepo 工作区，包含：

- `apps/server-admin` (Node.js 后端)
- `apps/server-admin-view` (管理前端)
- `apps/server-auth-view` (认证前端)
- `apps/fn-knock` (FPK 打包目录)

## 一键彻底部署（推荐）

在仓库根目录执行：

```bash
npm run fn-knock:deploy
```

该命令会按顺序完成：

1. 本地构建打包资源（前端 + 后端产物同步到 `apps/fn-knock/app`）
2. 上传到远端，分别生成 `amd64` / `arm64` 两个 FPK，并拉回本地
3. 卸载旧版本并安装/启动远端生成的 `amd64` FPK
4. 校验远端安装文件 `index.cgi` 的哈希是否与本地一致

远端双架构打包时会自动做差异化处理：

- `amd64` 包保留 `go-reauth-proxy-linux-amd64`，删除 `go-reauth-proxy-linux-arm64`
- `arm64` 包保留 `go-reauth-proxy-linux-arm64`，删除 `go-reauth-proxy-linux-amd64`
- `amd64` 包会把 `manifest` 中的 `platform` 改成 `x86`
- `arm64` 包会把 `manifest` 中的 `platform` 改成 `arm`
- `arm64` 包会把 `manifest` 中的 `install_dep_apps` 改成 `nodejs_v20`
- `amd64` 包仍保留 `install_dep_apps=nodejs_v20:redis`

## 分步命令

```bash
# 构建共享运行时目录（供 FPK / Docker 复用）
npm run fn-knock:assemble-runtime

# 仅构建本地打包目录
npm run fn-knock:build-package

# 本地构建 + 远端双架构 fnpack 打包 + 拉回 FPK
npm run fn-knock:fpk:remote

# 远端安装并查看运行日志
npm run fn-knock:install:remote

# 校验安装内容（hash + 关键脚本片段）
npm run fn-knock:verify:remote
```

## 可配置环境变量

部署脚本支持以下环境变量覆盖默认值：

- `FN_KNOCK_REMOTE_HOST`，默认 `root@192.168.31.98`
- `FN_KNOCK_REMOTE_DIR`，默认 `/tmp/fn-knock-fpk`
- `FN_KNOCK_APP_NAME`，默认 `fn-knock`
- `FN_KNOCK_LOCAL_APP_DIR`，默认 `apps/fn-knock`
- `FN_KNOCK_LOCAL_FPK_PATH`，默认 `apps/fn-knock/dist/fn-knock.fpk`
  实际会拉回为 `apps/fn-knock/dist/fn-knock-amd64.fpk` 和 `apps/fn-knock/dist/fn-knock-arm64.fpk`

示例：

```bash
FN_KNOCK_REMOTE_HOST=root@192.168.31.99 npm run fn-knock:deploy
```

## Docker 本地测试与发布

Docker 相关文件位于 `deploy/docker`，核心命令已经补齐：

```bash
npm run fn-knock:docker:build
npm run fn-knock:docker:up
npm run fn-knock:docker:down
npm run fn-knock:docker:logs
npm run fn-knock:docker:local-deploy
npm run fn-knock:docker:remote-ps
npm run fn-knock:docker:remote-logs
```

### 1. 本地测试

首次使用建议先复制一份本地配置：

```bash
cp deploy/docker/.env.example deploy/docker/.env
```

默认配置如下：

- `FN_KNOCK_IMAGE=fn-knock:local`
- `TZ=Asia/Shanghai`
- `ADMIN_VIEW_PORT=7991`
- `BACKEND_PORT=7998`
- `AUTH_PORT=7997`
- `GO_BACKEND_PORT=7996`
- `GO_REPROXY_PORT=7999`

本地测试常用流程：

```bash
# 只构建镜像，不启动容器
npm run fn-knock:docker:build

# 启动本地容器栈（会先走 buildx 构建，再启动 fn-knock + redis）
npm run fn-knock:docker:up

# 另开一个终端查看日志
npm run fn-knock:docker:logs

# 忘记管理面板密码时重置
npm run fn-knock:docker:reset-panel-password

# 停止并清理容器
npm run fn-knock:docker:down
```

本地启动后默认访问：

- 管理后台入口：`http://127.0.0.1:7991`
- 网关代理入口：`http://127.0.0.1:7999`

说明：

- `fn-knock:docker:up` 会自动读取 `deploy/docker/.env`；如果该文件不存在，则回退到 `deploy/docker/.env.example`
- 本地 compose 会额外加载 `deploy/docker/compose.override.yaml`，默认开启 `EXPOSE_RUNTIME_HMAC_SECRET=1`，便于本地调试
- Docker 容器默认时区为 `Asia/Shanghai`，可通过 `TZ` 环境变量覆盖
- Docker 模式下后端会自动识别为 `deployment_target=docker`
- Docker 模式下只对外开放 `7991` 和 `7999`，`7998` 仅保留在容器内部供 Node 后端使用
- Docker 模式下管理后台必须先经过 `7991`，首次进入需要设置管理面板密码，后续访问需要登录密码
- 登录后可在“系统设置 -> 面板”里修改 Docker 管理面板密码
- Docker 模式下 `7991` 只允许内网访问；公网来源会直接返回拒绝页面
- Docker 模式下 `7991` 会把通过认证的请求内部代理到 `7998`，而不是把 `7998` 直接暴露给外部
- 本地和远端构建都会复用 `docker buildx` 持久化缓存，默认目录为 `~/.cache/fn-knock-buildx`

#### 忘记管理面板密码

如果你是在开发仓库里操作本地 compose 环境，可以直接执行：

```bash
npm run fn-knock:docker:reset-panel-password
```

如果是客户机上的 Docker 主机，先登录到主机：

```bash
ssh root@<docker-host>
```

然后执行推荐命令：

```bash
cd /opt/fn-knock-docker && docker compose exec -T fn-knock fn-knock-reset-panel-password
```

如果只知道容器已经在跑 Docker，但不确定 compose 目录，也可以直接执行：

```bash
docker exec -it "$(docker ps --filter label=com.docker.compose.service=fn-knock --format '{{.Names}}' | head -n 1)" fn-knock-reset-panel-password
```

当前 `root@192.168.31.135` 上我已实际确认可用的命令就是：

```bash
cd /opt/fn-knock-docker && docker compose exec -T fn-knock fn-knock-reset-panel-password
```

这些命令都会进入运行中的 `fn-knock` 容器，清除 Docker 管理面板密码、面板会话和登录退避状态。业务配置和数据卷不会被删除。执行后再次访问 `7991`，会重新进入首次设置管理面板密码的流程。

#### 本地前端调试 Docker 模式

如果当前本地运行的不是 Docker 环境，但需要调试 Docker 模式下的管理面板密码流程和相关界面限制，可以在浏览器 DevTools 中手动写入 `localStorage` 调试标记，然后刷新页面：

```js
localStorage.setItem("fn_knock:debug:docker-mode", "1");
localStorage.setItem("fn_knock:debug:docker-admin-stage", "setup"); // setup | login | authenticated
location.reload();
```

说明：

- 该调试开关只影响 `apps/server-admin-view` 前端视图，不会把后端真实运行环境切换成 Docker
- 开启后，前端会按 Docker 部署展示对应的能力限制文案，并模拟管理面板密码的首次设置 / 登录 / 已登录三种状态
- `setup` 表示首次设置密码，`login` 表示已设置密码但未登录，`authenticated` 表示直接以已登录状态进入
- 在 `setup` 状态下成功提交密码后，前端会把密码保存在 `fn_knock:debug:docker-admin-password`，后续 `login` 会使用该值校验

清理调试状态：

```js
localStorage.removeItem("fn_knock:debug:docker-mode");
localStorage.removeItem("fn_knock:debug:docker-admin-stage");
localStorage.removeItem("fn_knock:debug:docker-admin-password");
location.reload();
```

### 2. 发布新版本到远端 Docker 主机

`fn-knock:docker:local-deploy` 会把本地构建好的镜像直接通过 SSH 发布到 `root@192.168.31.135` 并在远端运行。

默认流程：

1. 通过 SSH 探测远端架构
2. 本地同时构建 `amd64` 和 `arm64` 两套镜像
3. 将两套镜像都通过 `docker save | ssh ... docker load` 传到远端
4. 上传远端专用 `compose.yaml` 和 `.env`
5. 在远端按主机自身架构选择对应镜像启动
6. 在远端执行 `docker compose up -d --remove-orphans --force-recreate`
7. 等待健康检查通过并输出访问地址

直接发布：

```bash
npm run fn-knock:docker:local-deploy
```

当前默认远端为：

- `FN_KNOCK_DOCKER_REMOTE_HOST=root@192.168.31.135`
- `FN_KNOCK_DOCKER_REMOTE_DIR=/opt/fn-knock-docker`

如果你要发布“新版本”，推荐先更新版本号文件：

- `apps/server-admin/src/lib/app-version.ts` 中的 `APP_LOCAL_VERSION`

随后执行发布命令。若未显式指定 tag，脚本会先生成一个基础 tag：

```text
<APP_LOCAL_VERSION>-<YYYYMMDDHHMMSS>
```

然后自动发布为：

```text
fn-knock:<base-tag>-amd64
fn-knock:<base-tag>-arm64
```

例如：

```text
fn-knock:1.4.1-20260409094530-amd64
fn-knock:1.4.1-20260409094530-arm64
```

当前远端 `root@192.168.31.135` 是 `x86_64`，所以部署后会运行 `-amd64` 这套镜像，但 `-arm64` 也会一并构建并上传，方便后续迁移或导出。

如果希望使用更可读的固定 tag，可以在发布时覆盖基础 tag：

```bash
FN_KNOCK_DOCKER_IMAGE_TAG=1.4.2 npm run fn-knock:docker:local-deploy
```

实际发布的镜像会是：

```text
fn-knock:1.4.2-amd64
fn-knock:1.4.2-arm64
```

发布完成后，可用以下命令查看远端状态和日志：

```bash
npm run fn-knock:docker:remote-ps
npm run fn-knock:docker:remote-logs
```

### 3. 常见环境变量

Docker 发布脚本支持这些覆盖项：

- `FN_KNOCK_DOCKER_ENV_FILE`，默认优先读取 `deploy/docker/.env`
- `FN_KNOCK_DOCKER_IMAGE`，覆盖本地构建镜像名
- `FN_KNOCK_DOCKER_IMAGE_REPO`，默认 `fn-knock`
- `FN_KNOCK_DOCKER_IMAGE_TAG`，远端发布时自定义基础 tag，最终会自动追加 `-amd64` / `-arm64`
- `FN_KNOCK_DOCKER_LOCAL_ARCH`，覆盖本地构建架构，默认使用当前主机架构
- `TZ`，容器时区，默认 `Asia/Shanghai`
- `FN_KNOCK_DOCKER_CACHE_DIR`，默认 `~/.cache/fn-knock-buildx`
- `FN_KNOCK_DOCKER_BUILDER`，可指定 `docker buildx` builder 名称
- `FN_KNOCK_DOCKER_HTTP_PROXY` / `FN_KNOCK_DOCKER_HTTPS_PROXY` / `FN_KNOCK_DOCKER_ALL_PROXY`，覆盖 Docker 构建代理；未设置时会回退到标准 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`
- `FN_KNOCK_DOCKER_NO_PROXY`，覆盖 Docker 构建时的 `NO_PROXY`
- `FN_KNOCK_DOCKER_PROXY_HOST_ALIAS`，容器访问宿主机代理的地址别名，默认 `host.docker.internal`
- `FN_KNOCK_DOCKER_REMOTE_HOST`，默认 `root@192.168.31.135`
- `FN_KNOCK_DOCKER_REMOTE_DIR`，默认 `/opt/fn-knock-docker`
- `FN_KNOCK_DOCKER_WAIT_TIMEOUT`，默认 `180` 秒

示例：

```bash
FN_KNOCK_DOCKER_REMOTE_HOST=root@192.168.31.136 \
FN_KNOCK_DOCKER_IMAGE_TAG=1.4.2 \
npm run fn-knock:docker:local-deploy
```

如果代理监听在本机 `127.0.0.1:7890`，可以直接这样跑，脚本会自动把容器侧地址改写成 `host.docker.internal`：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
npm run fn-knock:docker:local-deploy
```

Docker 模式下会自动启用运行时能力约束：

- 禁用 `run_type=0`
- 禁用宿主机防火墙管理
- 禁用 Smart Connect / dnsmasq 安装
- 禁用应用内 FPK 更新

更细的 Docker 文件说明可见 `deploy/docker/README.md`。

## 依赖要求

- 本机可用 `node`, `npm`, `rsync`, `ssh`, `scp`
- 远端可用 `fnpack`, `appcenter-cli`
- 本机对远端 root SSH 免密（或已完成可交互认证）
