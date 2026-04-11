# fn-knock Docker Deployment

`deploy/docker` 用来承载 `fn-knock` 的 Docker 本地测试和远端发布。

当前构建链路已经按“多阶段 + 持久化缓存”设计：

- `deps` 阶段只根据 workspace manifests 安装依赖
- `admin-view-builder`、`auth-view-builder`、`server-builder` 分别独立构建各自产物
- `runtime` 阶段只带最终运行文件
- 本地和远端发布统一通过 `docker buildx` 构建
- 脚本默认会自动创建并复用 `fn-knock-buildx` 这个 `docker-container` builder
- 默认持久化缓存目录为 `~/.cache/fn-knock-buildx`

## 目录说明

- `Dockerfile`：多阶段构建镜像，构建共享运行时产物并打包到最终镜像
- `compose.yaml`：本地 compose 主文件，包含 `build` 配置
- `compose.override.yaml`：本地调试覆盖项
- `compose.remote.yaml`：远端发布专用 compose 文件，只使用已加载镜像，不在远端构建
- `entrypoint.sh`：在单容器内启动 Go 网关和 Node 后端
- `.env.example`：本地与远端通用的环境变量模板

## 本地测试

### 准备环境

```bash
cp deploy/docker/.env.example deploy/docker/.env
```

默认变量：

```dotenv
FN_KNOCK_IMAGE=fn-knock:local
TZ=Asia/Shanghai
ADMIN_VIEW_PORT=7991
BACKEND_PORT=7998
AUTH_PORT=7997
GO_BACKEND_PORT=7996
GO_REPROXY_PORT=7999
```

### 常用命令

```bash
# 构建镜像
npm run fn-knock:docker:build

# 启动本地环境
npm run fn-knock:docker:up

# 查看日志
npm run fn-knock:docker:logs

# 忘记管理面板密码时重置
npm run fn-knock:docker:reset-panel-password

# 停止环境
npm run fn-knock:docker:down
```

启动后默认访问地址：

- 管理后台入口：`http://127.0.0.1:7991`
- 网关代理入口：`http://127.0.0.1:7999`

本地测试特点：

- 自动读取 `deploy/docker/.env`，不存在时回退到 `deploy/docker/.env.example`
- 容器默认时区为 `Asia/Shanghai`，可通过 `TZ` 环境变量覆盖
- 自动加载 `compose.override.yaml`
- 默认附加 `EXPOSE_RUNTIME_HMAC_SECRET=1`，便于本地调试
- 只对外开放 `ADMIN_VIEW_PORT` 和 `GO_REPROXY_PORT`，`BACKEND_PORT` 仅保留在容器内部
- 首次访问 `ADMIN_VIEW_PORT` 需要设置管理面板密码，后续访问需要先输入该密码
- 成功登录后，可在“系统设置 -> 面板”里直接修改管理面板密码
- `ADMIN_VIEW_PORT` 只允许内网访问，公网请求会直接收到拒绝页面
- `ADMIN_VIEW_PORT` 会把通过认证的请求内部代理到 `BACKEND_PORT`
- 构建通过 `docker buildx` 执行，并将缓存写入 `~/.cache/fn-knock-buildx/<arch>`
- 如果当前活动 builder 是 `docker` driver，脚本会自动切到托管的 `fn-knock-buildx`

### 忘记管理面板密码

如果你是在开发仓库里操作本地 compose 环境，可以直接执行：

```bash
npm run fn-knock:docker:reset-panel-password
```

如果是最终客户机上的 Docker 主机，先登录到主机：

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

这个命令只会清除：

- Docker 管理面板密码
- 管理面板登录会话
- 密码输错后的退避状态

不会删除业务配置、反代规则、证书、白名单、日志目录或数据卷内容。执行完成后，下次访问 `ADMIN_VIEW_PORT` 会重新进入“首次设置密码”流程。

### 本地前端调试 Docker 模式

如果当前本地运行的是普通开发环境，但需要调试 Docker 模式下的管理面板密码页、Docker 专属文案或能力限制提示，可以直接在浏览器 DevTools 中设置前端调试标记：

```js
localStorage.setItem("fn_knock:debug:docker-mode", "1");
localStorage.setItem("fn_knock:debug:docker-admin-stage", "setup"); // setup | login | authenticated
location.reload();
```

调试标记说明：

- `fn_knock:debug:docker-mode=1`
  开启前端 Docker 模式调试覆盖
- `fn_knock:debug:docker-admin-stage=setup`
  模拟首次进入，需要先设置管理面板密码
- `fn_knock:debug:docker-admin-stage=login`
  模拟密码已设置，但当前还未登录
- `fn_knock:debug:docker-admin-stage=authenticated`
  模拟已经通过管理面板密码验证

行为说明：

- 该调试方式只覆盖 `apps/server-admin-view` 的前端判断，不会修改 Node 后端的真实 `deployment_target`
- 开启后，前端会按 Docker 模式展示对应的能力限制，例如禁用直连模式、宿主机防火墙能力、Smart Connect 等
- 当阶段为 `setup` 时，前端提交成功的密码会自动保存到 `fn_knock:debug:docker-admin-password`
- 当阶段为 `login` 时，前端会使用 `fn_knock:debug:docker-admin-password` 作为本地校验密码
- 如果没有保存过调试密码，`login` 会自动回退到 `setup`

清理调试标记：

```js
localStorage.removeItem("fn_knock:debug:docker-mode");
localStorage.removeItem("fn_knock:debug:docker-admin-stage");
localStorage.removeItem("fn_knock:debug:docker-admin-password");
location.reload();
```

## 发布新版本到远端 Docker

### 默认目标

发布命令默认将镜像发布到：

- SSH 主机：`root@192.168.31.135`
- 远端部署目录：`/opt/fn-knock-docker`

### 发布命令

```bash
npm run fn-knock:docker:local-deploy
```

发布脚本会自动完成以下事情：

1. SSH 检测远端主机架构
2. 同时使用 `docker buildx build` 本地构建 `linux/amd64` 和 `linux/arm64`
3. 生成一组镜像 tag
4. 用 `docker save | ssh ... docker load` 把两套镜像都传到远端
5. 上传 `compose.remote.yaml` 和远端 `.env`
6. 远端根据主机架构自动选择对应 tag 启动
7. 远端执行 `docker compose up -d --remove-orphans --force-recreate`
8. 等待健康检查通过

构建缓存说明：

- `deps` 阶段只要 `package.json` / workspace `package.json` 不变，就能直接复用依赖层
- 三个构建阶段相互独立，修改后端代码时不会强制重建两个前端阶段
- Docker 内不再依赖 `assemble-runtime.sh` 的聚合构建路径，而是直接构建各自工作区产物
- 各阶段会复用 `~/.cache/fn-knock-buildx/<arch>` 下的 buildx 缓存
- 如果依赖声明变化、Dockerfile 变化、或源码真实影响产物，仍然会触发对应层重建，这是正常行为

### 镜像 tag 规则

如果没有手工指定 `FN_KNOCK_DOCKER_IMAGE_TAG`，脚本会从 `apps/server-admin/src/lib/app-version.ts` 读取 `APP_LOCAL_VERSION`，先生成基础 tag：

```text
<APP_LOCAL_VERSION>-<YYYYMMDDHHMMSS>
```

然后自动产出两套镜像：

```text
fn-knock:<base-tag>-amd64
fn-knock:<base-tag>-arm64
```

例如：

```text
fn-knock:1.4.1-20260409094530-amd64
fn-knock:1.4.1-20260409094530-arm64
```

推荐发布新版本时先更新 `APP_LOCAL_VERSION`，再执行部署命令。

如果希望手工指定基础 tag：

```bash
FN_KNOCK_DOCKER_IMAGE_TAG=1.4.2 npm run fn-knock:docker:local-deploy
```

实际发布镜像会变成：

```text
fn-knock:1.4.2-amd64
fn-knock:1.4.2-arm64
```

当前默认远端 `root@192.168.31.135` 已确认是 `x86_64`，因此实际运行的是 `-amd64` 镜像，但 `-arm64` 也会同步上传到远端 Docker。

### 发布后排查

```bash
# 查看远端容器状态
npm run fn-knock:docker:remote-ps

# 查看远端日志
npm run fn-knock:docker:remote-logs
```

## 可配置环境变量

### 本地构建/测试

- `FN_KNOCK_DOCKER_ENV_FILE`：指定 env 文件路径
- `FN_KNOCK_DOCKER_IMAGE`：覆盖本地构建镜像名
- `TZ`：容器时区，默认 `Asia/Shanghai`
- `FN_KNOCK_DOCKER_LOCAL_ARCH`：覆盖本地构建架构
- `FN_KNOCK_DOCKER_CACHE_DIR`：指定 buildx 本地缓存目录
- `FN_KNOCK_DOCKER_BUILDER`：指定 buildx builder 名称
- `FN_KNOCK_DOCKER_MANAGED_BUILDER`：托管 builder 名称，默认 `fn-knock-buildx`
- `FN_KNOCK_DOCKER_HTTP_PROXY` / `FN_KNOCK_DOCKER_HTTPS_PROXY` / `FN_KNOCK_DOCKER_ALL_PROXY`：覆盖 Docker 构建代理；未设置时会回退到标准 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`
- `FN_KNOCK_DOCKER_NO_PROXY`：覆盖 Docker 构建时的 `NO_PROXY`
- `FN_KNOCK_DOCKER_PROXY_HOST_ALIAS`：容器访问宿主机代理的地址别名，默认 `host.docker.internal`

### 远端发布

- `FN_KNOCK_DOCKER_IMAGE_REPO`：镜像仓库名，默认 `fn-knock`
- `FN_KNOCK_DOCKER_IMAGE_TAG`：手工指定远端发布基础 tag，最终会自动扩展为 `-amd64` 和 `-arm64`
- `FN_KNOCK_DOCKER_REMOTE_HOST`：远端 SSH 地址，默认 `root@192.168.31.135`
- `FN_KNOCK_DOCKER_REMOTE_DIR`：远端 compose 落地目录，默认 `/opt/fn-knock-docker`
- `FN_KNOCK_DOCKER_WAIT_TIMEOUT`：远端健康检查等待秒数，默认 `180`

示例：

```bash
FN_KNOCK_DOCKER_REMOTE_HOST=root@192.168.31.136 \
FN_KNOCK_DOCKER_REMOTE_DIR=/srv/fn-knock \
FN_KNOCK_DOCKER_IMAGE_TAG=1.4.2 \
npm run fn-knock:docker:local-deploy
```

如果你的本机代理监听在 `127.0.0.1:7890`，可以直接这样执行：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
npm run fn-knock:docker:local-deploy
```

脚本会在 `docker buildx` builder 和实际构建阶段自动注入代理，并把 `127.0.0.1` / `localhost` 改写成容器内可访问的 `host.docker.internal`。如果你手工指定了 `FN_KNOCK_DOCKER_BUILDER`，则需要确保那个 builder 自己已经带上相同的代理环境。

## 运行时限制

Docker 模式下后端会自动识别 `FN_KNOCK_RUNTIME_TARGET=docker`，并收敛能力边界：

- 禁用 `run_type=0`
- 禁用宿主机防火墙管理
- 禁用 Smart Connect / dnsmasq 相关能力
- 禁用应用内 FPK 更新

管理端在 Docker 中会保留 `127.0.0.1:${BACKEND_PORT}` 作为容器内部后端接口，并在 `0.0.0.0:${ADMIN_VIEW_PORT}` 提供一个只允许内网访问的管理入口。用户浏览器访问 `ADMIN_VIEW_PORT` 后，请求会先完成管理面板密码验证，再由该入口内部代理到 `BACKEND_PORT`。
