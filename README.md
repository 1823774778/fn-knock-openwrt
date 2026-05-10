# fn-knock-turborepo

`fn-knock` 的 Turborepo 工作区，包含：

- `apps/server-admin` (Node.js 后端)
- `apps/server-admin-view` (管理前端)
- `apps/server-auth-view` (认证前端)
- `apps/fn-knock` (FPK 打包目录)

## Repository Overview

这个仓库同时覆盖三种使用方式：

- 直接从 Docker Hub 拉取镜像并运行，适合大多数最终用户
- 在本仓库内本地开发、调试和构建 Docker / FPK 产物
- 打包成 FPK 并发布到目标设备

如果你只是想安装并运行 `fn-knock`，推荐直接使用 Docker Hub 镜像，不需要先构建源码。

### 通过 Docker Hub 安装并运行

推荐先准备一个单独的运行目录：

```bash
mkdir -p /opt/fn-knock-docker
cd /opt/fn-knock-docker
```

先拉取最新镜像：

```bash
docker pull kcilnk/fn-knock:latest
```

创建 `.env`：

```dotenv
FN_KNOCK_IMAGE=kcilnk/fn-knock:latest
TZ=Asia/Shanghai
ADMIN_VIEW_PORT=7991
BACKEND_PORT=7998
AUTH_PORT=7997
GO_BACKEND_PORT=7996
GO_REPROXY_PORT=7999
FN_KNOCK_DOCKER_IPV4_SUBNET=172.30.0.0/16
FN_KNOCK_DOCKER_IPV6_SUBNET=fd42:fb33:7f7a:100::/64
DOCKER_ADMIN_TRUSTED_PROXY_CIDRS=
DOCKER_DISCOVER_LAN_IP=
```

创建 `docker-compose.yml`：

```yaml
services:
  fn-knock:
    image: ${FN_KNOCK_IMAGE}
    restart: unless-stopped
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      FN_KNOCK_RUNTIME_TARGET: docker
      REDIS_HOST: redis
      REDIS_PORT: 6379
      FN_KNOCK_DATA_DIR: /var/lib/fn-knock
      FN_KNOCK_GATEWAY_CONFIG_DIR: /usr/local/etc/fn-knock
      ADMIN_VIEW_PORT: ${ADMIN_VIEW_PORT:-7991}
      BACKEND_PORT: ${BACKEND_PORT:-7998}
      AUTH_PORT: ${AUTH_PORT:-7997}
      GO_BACKEND_PORT: ${GO_BACKEND_PORT:-7996}
      GO_REPROXY_PORT: ${GO_REPROXY_PORT:-7999}
      DOCKER_ADMIN_TRUSTED_PROXY_CIDRS: ${DOCKER_ADMIN_TRUSTED_PROXY_CIDRS:-}
      DOCKER_DISCOVER_LAN_IP: ${DOCKER_DISCOVER_LAN_IP:-}
      DDNS_HOST_IF_INET6_PATH: /host/proc/net/if_inet6
      ADMIN_VIEW_HOST: 0.0.0.0
      BACKEND_HOST: 127.0.0.1
    ports:
      - "${ADMIN_VIEW_PORT:-7991}:${ADMIN_VIEW_PORT:-7991}"
      - "${GO_REPROXY_PORT:-7999}:${GO_REPROXY_PORT:-7999}"
    networks:
      - fn_knock_net
    volumes:
      - fn_knock_data:/var/lib/fn-knock
      - fn_knock_gateway:/usr/local/etc/fn-knock
      - /proc/1/net:/host/proc/net:ro
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -fsS http://127.0.0.1:${ADMIN_VIEW_PORT:-7991}/api/admin/healthz || exit 1",
        ]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s

  redis:
    image: redis:7-bookworm
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    networks:
      - fn_knock_net
    volumes:
      - fn_knock_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  fn_knock_data:
  fn_knock_gateway:
  fn_knock_redis:

networks:
  fn_knock_net:
    enable_ipv6: true
    ipam:
      config:
        - subnet: ${FN_KNOCK_DOCKER_IPV4_SUBNET:-172.30.0.0/16}
        - subnet: ${FN_KNOCK_DOCKER_IPV6_SUBNET:-fd42:fb33:7f7a:100::/64}
```

启动：

```bash
docker compose up -d
docker compose logs -f fn-knock
```

默认端口与用途：

- `7991`：管理后台入口；首次访问需要先设置 Docker 管理面板密码
- `7999`：网关 / 代理入口；这是外部用户访问代理服务时使用的端口
- `7998`：Node 后端内部端口；默认不对宿主机暴露
- `7997`：认证前端内部端口；默认不对宿主机暴露
- `7996`：Go 后端内部端口；默认不对宿主机暴露
- `6379`：Redis 仅在 compose 内部使用；默认不对外暴露

运行起来以后，通常按这个顺序配置：

1. 打开 `http://<宿主机IP>:7991`，先设置管理面板密码并登录
2. 在管理后台内完成反向代理、子域名、证书、鉴权等业务配置
3. 让外部流量访问 `7999` 对应的网关入口
4. 如果要支持公网 IPv6，保留默认 IPv6 网络；如同一宿主机已有同网段 Docker 网络，修改 `FN_KNOCK_DOCKER_IPV4_SUBNET` 或 `FN_KNOCK_DOCKER_IPV6_SUBNET`
5. 如果 DDNS 的公网探测地址不是宿主机可入站地址，在 DDNS 中选择“从网卡直接获取”，再选择“宿主机”网卡上的公网 IPv6
6. 如果 `7991` 需要放到可信反向代理后面，设置 `DOCKER_ADMIN_TRUSTED_PROXY_CIDRS`
7. 只有在第三方反向代理无法自动识别宿主机局域网地址时，才额外设置 `DOCKER_DISCOVER_LAN_IP`

如果你始终希望跟随最新镜像，可以保持 `.env` 中的 `FN_KNOCK_IMAGE=kcilnk/fn-knock:latest`，更新时执行：

```bash
docker compose pull
docker compose up -d
```

如果你希望锁定版本，把 `FN_KNOCK_IMAGE` 改成 `:<version>` 即可，例如 `1.4.3`。更完整的 Docker 运行说明见 [deploy/docker/README.md](deploy/docker/README.md)。

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

- `amd64` 包只保留 `go-reauth-proxy-linux-amd64`，删除 `arm64` / `arm32` 的网关二进制
- `arm64` 包只保留 `go-reauth-proxy-linux-arm64`，删除 `amd64` / `arm32` 的网关二进制
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
npm run fn-knock:docker:hub-publish
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
- `FN_KNOCK_DOCKER_IPV4_SUBNET=172.30.0.0/16`
- `FN_KNOCK_DOCKER_IPV6_SUBNET=fd42:fb33:7f7a:100::/64`
- `DOCKER_ADMIN_TRUSTED_PROXY_CIDRS=`（可选，放行 7991 前面的可信反代出口 IP / CIDR）
- `DOCKER_DISCOVER_LAN_IP=`（可选兜底，仅第三方反代无法自动透传时使用）

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
- Docker 模式下 `7991` 默认只允许宿主机本地、局域网或 VPN 等内网来源访问；公网直连会直接返回拒绝页面
- 如果需要把 `7991` 放到可信反向代理后面，请在 Docker 环境中设置 `DOCKER_ADMIN_TRUSTED_PROXY_CIDRS` 为该反代节点的出口 IP / CIDR；这样仍会拒绝公网直连，但会放行来自该可信反代的访问
- 可信反代需要正常透传 `X-Forwarded-For` 或 `X-Real-IP`；`go-reauth-proxy` 当前转发逻辑已经会带上这些头
- 如果管理面板是通过 `go-reauth-proxy` 反代进入，“一键发现”会自动识别 Docker 宿主机对应的局域网 IPv4
- 只有在使用第三方反向代理，且该代理无法自动透传宿主机局域网提示时，才需要额外设置 `DOCKER_DISCOVER_LAN_IP=宿主机局域网IP` 作为兜底
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
2. 本地同时构建 `amd64`、`arm64` 和 `arm32` 三套镜像
3. 将三套镜像都通过 `docker save | ssh ... docker load` 传到远端
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
fn-knock:<base-tag>-arm32
```

例如：

```text
fn-knock:1.4.1-20260409094530-amd64
fn-knock:1.4.1-20260409094530-arm64
fn-knock:1.4.1-20260409094530-arm32
```

当前远端 `root@192.168.31.135` 是 `x86_64`，所以部署后会运行 `-amd64` 这套镜像，但 `-arm64` 和 `-arm32` 也会一并构建并上传，方便后续迁移或导出。

如果希望使用更可读的固定 tag，可以在发布时覆盖基础 tag：

```bash
FN_KNOCK_DOCKER_IMAGE_TAG=1.4.2 npm run fn-knock:docker:local-deploy
```

实际发布的镜像会是：

```text
fn-knock:1.4.2-amd64
fn-knock:1.4.2-arm64
fn-knock:1.4.2-arm32
```

发布完成后，可用以下命令查看远端状态和日志：

```bash
npm run fn-knock:docker:remote-ps
npm run fn-knock:docker:remote-logs
```

### 3. 发布到 Docker Hub

如果要把镜像直接发布到 Docker Hub，先登录：

```bash
docker login
```

然后指定 Docker Hub 仓库名执行发布命令：

```bash
FN_KNOCK_DOCKER_IMAGE_REPO=kcilnk/fn-knock \
npm run fn-knock:docker:hub-publish
```

这个命令会做三件事：

1. 分别构建并推送 `linux/amd64`、`linux/arm64` 和 `linux/arm/v7`
2. 生成并校验多架构 manifest
3. 让 `docker pull kcilnk/fn-knock:<version>` 自动按拉取端架构选择镜像

默认版本 tag 会直接沿用项目当前的：

```text
apps/server-admin/src/lib/app-version.ts -> APP_LOCAL_VERSION
```

例如当前版本是 `1.4.3`，则默认会发布：

```text
kcilnk/fn-knock:1.4.3-amd64
kcilnk/fn-knock:1.4.3-arm64
kcilnk/fn-knock:1.4.3-arm32
kcilnk/fn-knock:1.4.3
kcilnk/fn-knock:latest
```

如果你想手工覆盖版本号，也可以继续用现有变量：

```bash
FN_KNOCK_DOCKER_IMAGE_REPO=kcilnk/fn-knock \
FN_KNOCK_DOCKER_IMAGE_TAG=1.4.4 \
npm run fn-knock:docker:hub-publish
```

### 4. 常见环境变量

Docker 发布脚本支持这些覆盖项：

- `FN_KNOCK_DOCKER_ENV_FILE`，默认优先读取 `deploy/docker/.env`
- `FN_KNOCK_DOCKER_IMAGE`，覆盖本地构建镜像名
- `FN_KNOCK_DOCKER_IMAGE_REPO`，默认 `fn-knock`
- `FN_KNOCK_DOCKER_IMAGE_TAG`，发布时自定义基础 tag；远端部署会追加 `-amd64` / `-arm64` / `-arm32`，Docker Hub 会再生成同名 manifest tag
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
