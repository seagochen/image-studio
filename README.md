# Image Studio

Image Studio 是一个基于浏览器的分层图像编辑器（栅格 / 绘制 / 蒙版 / 标注 / 调整图层、选区、透视、画布裁剪、图层对齐、可编辑投影/描边、历史跳转、导出预览，以及可选的 AI 编辑）。
同一份源码、同一个 Docker 镜像支持两种**显式**运行模式（[#1](https://github.com/seagochen/image-studio/issues/1)）：

| 模式 | 用途 | 容器提供的内容 | 身份 / 项目 / AI |
| --- | --- | --- | --- |
| `standalone` 独立模式 | 本机 Docker 运行 | 静态页面、`/healthz`、本地项目 API、AI 代理 | 无需登录；SQLite + 存储目录（挂载卷）；可在“设置 → API Key”接入 skillsmaster.jp AI，Key 只保存在服务端 |
| `platform` 平台挂载模式 | 由 skillsmaster 管理后台挂载到 `/apps/image-studio/*` | 仅静态资源、`/healthz`、`/runtime-config.json` | 沿用 skillsmaster 同源 Session / App Session 与平台项目、AI 接口 |

浏览器启动时读取 `/apps/image-studio/runtime-config.json` 决定模式；读取失败时直接报错，**不会**在两种模式之间自动回退。

## 快速开始（独立模式）

前置条件：Docker Engine 20.10+ 与 Docker Compose v2。

```bash
git clone https://github.com/seagochen/image-studio.git
cd image-studio

cp .env.example .env                       # 宿主机侧映射：端口、数据库目录、存储目录……
mkdir -p data/db data/storage secrets      # 必须预先创建，且对容器用户 (默认 1000:1000) 可写
docker compose up -d --build

open http://localhost:3000                 # 自动跳转到 /apps/image-studio/
```

容器内服务监听 **80** 端口，默认映射到宿主机 `127.0.0.1:3000`。停止：`docker compose down`（数据保留在 `data/`）。

## 配置文件

所有端口、数据库、存储目录的映射都写在文件里，分为两层：

### 1. 宿主机侧：`.env`（由 `docker compose` 读取）

从 [`.env.example`](.env.example) 复制而来：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `IMAGE_STUDIO_BIND_ADDRESS` | `127.0.0.1` | 发布到宿主机的地址。改成 `0.0.0.0` 前请先启用访问控制 |
| `IMAGE_STUDIO_HOST_PORT` | `3000` | 宿主机端口 |
| `IMAGE_STUDIO_CONTAINER_PORT` | `80` | 容器端口，须与配置文件中 `server.port` 一致 |
| `IMAGE_STUDIO_CONFIG_FILE` | `./config/standalone.json` | 以只读方式挂载到 `/etc/image-studio/config.json` |
| `IMAGE_STUDIO_DB_DIR` | `./data/db` | 挂载到 `/data/db`（SQLite：项目、素材、AI 操作元数据） |
| `IMAGE_STUDIO_STORAGE_DIR` | `./data/storage` | 挂载到 `/data/storage`（素材原图、AI 结果） |
| `IMAGE_STUDIO_SECRETS_DIR` | `./secrets` | 以只读方式挂载到 `/run/secrets/image-studio`（密钥文件） |
| `IMAGE_STUDIO_UID` / `IMAGE_STUDIO_GID` | `1000` | 容器运行用户；须对上面两个数据目录有写权限 |

### 2. 容器侧：`config/standalone.json`

```jsonc
{
  "mode": "standalone",                       // 必填：standalone | platform
  "server": { "host": "0.0.0.0", "port": 80 },
  "storage": {
    "databasePath": "/data/db/image-studio.sqlite",
    "dataDir": "/data/storage",
    "maxUploadBytes": 26214400,               // 单个素材上限（25 MiB）
    "maxDocumentBytes": 8388608               // 单个项目文档 JSON 上限
  },
  "access": { "tokenFile": null, "basicAuth": null },  // 见“访问控制”
  "ai": {
    "enabled": true,                          // false 时彻底关闭 AI（设置菜单中也不能保存 Key）
    "baseUrl": "https://api.skillsmaster.jp",
    "manifestPath": "/mode-manifest",
    "runsPath": "/v1/runs",
    "requestTimeoutMs": 60000,
    "idempotentSubmit": false                 // 见“提交结果未知时的处理”
  }
}
```

> 从 0.1.0 早期版本升级：容器内数据路径由 `/var/lib/image-studio/{db,storage}` 改为 `/data/{db,storage}`。使用仓库自带的 `docker-compose.yml` 与 `config/standalone.json` 时宿主机目录不变，`git pull` 后重新 `docker compose up -d --build` 即可；如果使用自定义配置文件，请同步修改 `storage` 路径和卷挂载目标。

不使用配置文件时，也可以只设置环境变量 `IMAGE_STUDIO_MODE=platform|standalone`（其余取默认值）。skillsmaster Module Manager 挂载平台模块时会注入 `SKILLSMASTER_MODE=platform`：它必须与配置文件或 `IMAGE_STUDIO_MODE` 给出的模式一致，否则容器拒绝启动。`PORT`、`SKILLSMASTER_API_BASE_URL`、`SKILLSMASTER_CUSTOMER_KEY_FILE`、`IMAGE_STUDIO_ACCESS_TOKEN_FILE` 环境变量可覆盖文件中的对应项。

## 接入 skillsmaster AI（可选）

未配置 API Key 时普通编辑与保存完全可用，AI 编辑对话框会提示去设置 Key。

### 方式一：在界面中设置（推荐）

1. 在 skillsmaster.jp 获取 API Key。
2. 打开 Image Studio，点击顶部菜单 **设置 → API Key**。
3. 粘贴 Key 并点击 **保存**。

保存时服务端会先用该 Key 访问 skillsmaster.jp：被拒绝（401/403）的 Key 不会保存；skillsmaster.jp 暂时不可达时会保存并提示“暂时无法验证”。
Key 以 `0600` 权限保存在存储卷的 `settings/skillsmaster-api-key`（即宿主机 `data/storage/settings/`），容器重启后仍然有效；对话框之后只显示末 4 位，也可以在此删除。
平台挂载模式下不显示此菜单项（平台模式使用 skillsmaster 登录会话）。

### 方式二：由部署方通过文件提供

```bash
printf '%s' 'YOUR-CUSTOMER-KEY' > secrets/skillsmaster-customer-key
```

在 `config/standalone.json` 的 `ai` 中加入 `"customerKeyFile": "/run/secrets/image-studio/skillsmaster-customer-key"`（或 `"customerKeyEnv": "变量名"`），执行 `docker compose restart`。
密钥文件须对容器用户（`IMAGE_STUDIO_UID`）可读。以这种方式提供的 Key 优先，并在 **设置 → API Key** 中显示为只读。

### 安全性

- 客户 key 只由容器服务端读取，以 `X-Customer-Key` 请求头代理 manifest、提交、轮询与结果下载；不会出现在静态 bundle、浏览器响应、浏览器存储或日志中，也只会发送到 `baseUrl` 同源地址。
- 独立适配器不调用平台专用的 `/image-studio/projects/:id/operations` 预登记接口，也不发送 `X-Image-Studio-Operation-Id`。操作 ID 记录在本地 SQLite，并作为上游 `Idempotency-Key`；已经拿到 run ID 的操作再次提交时直接返回原 run，不会重复提交。
- 上游返回的错误信息若包含客户 key，会被替换为通用提示；`npm run check:bundle`（CI 中执行）会确认浏览器 bundle 中没有任何服务端凭证相关的引用。
- AI 结果字节保存在存储卷中，断线或容器重启后可直接恢复交付。
- skillsmaster 不可达时返回明确的 `502` 错误，不影响编辑与保存。

### 提交结果未知时的处理

每个 AI 操作在 SQLite 中记录提交状态（`pending → sent → accepted / rejected / unknown`）。请求发出前先写入 `sent`，因此：

- 连接被拒绝、DNS 失败等**确定没有发出**的错误：操作保持可重试。
- 超时、连接中断、上游 5xx、成功响应缺少 run ID，或容器在提交过程中崩溃（启动时发现仍为 `sent` 的记录）：记为 `unknown`，操作标记为失败并提示“无法确定 skillsmaster 是否已受理”。**同一操作不会被自动重提**，同一 ID 再次提交返回 `409`。需要时由用户在 AI 对话框中点击“重试”，这会创建一个新的操作。
- 上游 4xx：明确拒绝，记为 `rejected`。

只有确认 skillsmaster 的 runs API 会按 `Idempotency-Key` 去重之后，才应把 `ai.idempotentSubmit` 设为 `true`。开启后，结果未知的操作保持可恢复，并以同一个 `Idempotency-Key` 重新提交。

## 访问控制

未配置凭证时，容器只响应 `Host` 为 `localhost`、`127.0.0.1`、`[::1]` 或 `*.localhost` 的请求，作为本机单用户编辑器免登录使用（同时防御 DNS rebinding）。其他主机名一律返回 `403`。

**开放给其他主机时必须配置访问令牌文件：**

```bash
openssl rand -base64 48 > secrets/access-token      # 至少 32 个字符
```

```json
"access": { "tokenFile": "/run/secrets/image-studio/access-token", "sessionHours": 12, "secureCookie": true }
```

然后把 `.env` 中的 `IMAGE_STUDIO_BIND_ADDRESS` 改为 `0.0.0.0`，并在前面放置 HTTPS 反向代理（启用 HTTPS 后再设 `secureCookie: true`）。

- 浏览器首次访问时显示登录页，输入令牌后服务端发放 `HttpOnly; SameSite=Strict` 会话 Cookie。Cookie 只包含用令牌派生密钥签名的过期时间，不包含令牌本身；更换令牌文件并重启后，已有会话全部失效。退出登录：`DELETE /apps/image-studio/session`。
- 脚本可以使用 `Authorization: Bearer <令牌>`。
- 用会话 Cookie 发起的写请求必须带有同源 `Origin` 或 `Sec-Fetch-Site: same-origin`，否则返回 `403`；跨站写请求在任何模式下都会被拒绝。
- 同一来源地址每分钟连续输错 10 次后，暂时拒绝登录（`429`）。
- 兼容旧配置：`"basicAuth": { "username": "studio", "passwordFile": "/run/secrets/image-studio/access-password" }` 仍然有效，可以与令牌同时使用。
- 由自带认证的可信反向代理转发时，可以在 `access.allowedHosts` 中列出代理使用的主机名，而不配置令牌。
- `/healthz` 不需要认证。

## 崩溃恢复与迁移

每次启动时（在开始接受请求之前）：

1. 对 SQLite 执行 `PRAGMA quick_check`。检查失败时拒绝启动，并提示从备份恢复。
2. 按 `PRAGMA user_version` 依次执行 schema 迁移，每一步都在独立事务中完成。如果数据库版本比镜像新（例如镜像被降级），拒绝启动。
3. 清理被中断写入留下的 `*.tmp` 文件、数据库中已不存在的项目目录、素材文件和 AI 结果文件。结果文件丢失的 AI 操作会在下次请求时重新下载。
4. 把提交中途被中断的 AI 操作记为 `unknown`（见上文）。

素材和 AI 结果都先写临时文件再原子重命名，数据库写入在事务中完成，所以任意时刻掉电最多留下可清理的孤儿文件，不会出现指向半个文件的记录。

## 备份与恢复

**在线备份**（容器运行中也可以执行）：

```bash
docker compose exec image-studio node /app/server/backup.mjs /tmp/backup
docker compose cp image-studio:/tmp/backup ./image-studio-backup-$(date +%F)
```

`backup.mjs` 用 `VACUUM INTO` 生成一致的数据库快照，再复制存储目录，并写入 `manifest.json`（时间、schema 版本、项目数）。复制期间如果有保存操作，快照之后新增的素材可能不在备份里，所以需要严格一致时请使用离线备份。

**离线备份**（严格一致）：

```bash
docker compose stop
tar czf image-studio-backup-$(date +%F).tgz data/db data/storage
docker compose start
```

**恢复**：先停止容器，再把 `image-studio.sqlite` 放回 `data/db/`，把 `storage/` 放回 `data/storage/`（或者直接解压离线备份），保持属主为 `IMAGE_STUDIO_UID:GID`，然后启动。启动恢复流程会自动执行必要的迁移并清理孤儿文件。

## 平台挂载模式与镜像交付

镜像默认即为平台模式（`IMAGE_STUDIO_MODE=platform`，端口 `8080`，与 [`module.json`](module.json) 一致），以 `101:101` 运行，支持只读根文件系统。该模式拒绝任何 `storage` / `ai` / `access` 配置、客户 key 和访问令牌，不打开数据库、不挂载卷，本地项目 API 一律返回 `404`，因此平台鉴权失败时不可能回退为本地单用户模式。

打包、签名、候选验证、启用和回退的完整步骤见 [docs/platform-rollout.md](docs/platform-rollout.md)：

```bash
scripts/package-image.sh release          # 构建 → 双模式冒烟测试 → 归档 + sha256 (+ 可选签名)
scripts/smoke-image.sh image-studio:0.1.0 # 单独对已构建的镜像跑双模式冒烟测试
```

本地验证平台模式：`docker run --rm --read-only -p 8080:8080 image-studio:0.1.0`，然后 `curl localhost:8080/healthz`。

## 开发

```bash
npm ci
npm run test:server      # 独立模式服务端测试（node:test）
npm test                 # 服务端 + 前端（Jest）测试
npm run typecheck
npm run dev              # Vite 开发服务器 :5173，后端路由代理到 IMAGE_STUDIO_DEV_BACKEND（默认 http://127.0.0.1:3000）
npm start                # 直接运行容器服务端（需 IMAGE_STUDIO_CONFIG 或 IMAGE_STUDIO_MODE）
npm run check:bundle     # 构建后检查 bundle 中没有服务端凭证引用
```

路线图与范围取舍见 [docs/ROADMAP.md](docs/ROADMAP.md)（#2）；实体数位笔验收见 [docs/pen-acceptance.md](docs/pen-acceptance.md)（#3）。
PhotoCraft 布局的浅色工作台、命令搜索、历史跳转、可调整面板、文字编辑、选区存档、参考线、可编辑滤镜链及路径/矢量蒙版见 [docs/photocraft-workbench.md](docs/photocraft-workbench.md)。

目录结构：

```
src/            前端（React + Konva）
  runtime/      运行模式契约（runtime-config.json）
  ai/           AI 适配器：httpGateway（平台）/ standaloneGateway（独立）
  projects/     项目客户端（两种模式共用同一套 /image-studio/projects 契约）
  shared/       从 skillsmaster 迁入的共享模块：文档/AI 操作契约、资源限制、画布坐标、语言、平台鉴权
public/icons.svg  产品图标精灵（独立模式由容器在 /icons.svg 提供）
server/         容器服务端：静态资源、/healthz、本地项目 API（node:sqlite）、AI 代理、访问控制、备份
scripts/        镜像冒烟测试、打包签名、bundle 凭证检查
docs/           路线图、数位笔验收、平台接入与回退
tests/browser/  浏览器内可复跑的验证页（4K 蒙版/导出、数位笔诊断等）
config/         运行时配置示例（standalone.json / platform.json）
docker-compose.yml, .env.example   独立模式的端口与卷映射
```

## 许可证

本项目以 [GNU General Public License v3.0](LICENSE) 发布。

### 编辑菜单与剪贴板

画布获得焦点时，`Ctrl+C`（macOS `⌘C`）复制选中图层，`Ctrl+X`（`⌘X`）剪切，
`Ctrl+V`（`⌘V`）粘贴，`Del` 删除。顶部“编辑”菜单提供同样操作；剪切、粘贴和删除支持撤销/重做。
锁定或不可编辑图层禁止剪切与删除；输入框和弹窗保留自己的按键行为。

剪贴板是当前编辑器会话内的独立图层快照，支持图层组及其蒙版；重复粘贴生成独立图层，
保留原有位置，并置于图层列表顶部。刷新页面会清空剪贴板。
存在当前图层的像素选区时，复制/剪切优先处理选区像素，按选区边界裁剪并保留透明区域；
粘贴生成独立的图片图层，保持选区位置。删除仅清除选区内容，无选区时操作整个图层。
绘图和文字/形状图层的选区复制为图片，清除操作通过蒙版保留源对象的可编辑性。
这些操作不读取或写入系统剪贴板。
