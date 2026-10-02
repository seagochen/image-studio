# Image Studio

Image Studio 是一个基于浏览器的分层图像编辑器（栅格 / 绘制 / 蒙版 / 标注 / 调整图层、选区、透视、导出，以及可选的 AI 编辑）。
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
| `IMAGE_STUDIO_DB_DIR` | `./data/db` | 挂载到 `/var/lib/image-studio/db`（SQLite：项目、素材、AI 操作元数据） |
| `IMAGE_STUDIO_STORAGE_DIR` | `./data/storage` | 挂载到 `/var/lib/image-studio/storage`（素材原图、AI 结果） |
| `IMAGE_STUDIO_SECRETS_DIR` | `./secrets` | 以只读方式挂载到 `/run/secrets/image-studio`（密钥文件） |
| `IMAGE_STUDIO_UID` / `IMAGE_STUDIO_GID` | `1000` | 容器运行用户；须对上面两个数据目录有写权限 |

### 2. 容器侧：`config/standalone.json`

```jsonc
{
  "mode": "standalone",                       // 必填：standalone | platform
  "server": { "host": "0.0.0.0", "port": 80 },
  "storage": {
    "databasePath": "/var/lib/image-studio/db/image-studio.sqlite",
    "dataDir": "/var/lib/image-studio/storage",
    "maxUploadBytes": 26214400,               // 单个素材上限（25 MiB）
    "maxDocumentBytes": 8388608               // 单个项目文档 JSON 上限
  },
  "access": { "basicAuth": null },            // 见“访问控制”
  "ai": {
    "enabled": true,                          // false 时彻底关闭 AI（设置菜单中也不能保存 Key）
    "baseUrl": "https://skillsmaster.jp",
    "manifestPath": "/mode-manifest",
    "runsPath": "/v1/runs",
    "requestTimeoutMs": 60000
  }
}
```

不使用配置文件时，也可以只设置环境变量 `IMAGE_STUDIO_MODE=platform|standalone`（其余取默认值）。`PORT`、`SKILLSMASTER_API_BASE_URL`、`SKILLSMASTER_CUSTOMER_KEY_FILE` 环境变量可覆盖文件中的对应项。

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
- 独立适配器不调用平台专用的 `/image-studio/projects/:id/operations` 预登记接口，也不发送 `X-Image-Studio-Operation-Id`。操作 ID 记录在本地 SQLite，并作为上游 `Idempotency-Key`，重复提交不会产生重复任务。
- AI 结果字节保存在存储卷中，断线或容器重启后可直接恢复交付。
- skillsmaster 不可达时返回明确的 `502` 错误，不影响编辑与保存。

## 访问控制

默认只发布到 `127.0.0.1`，作为本机单用户编辑器免登录使用。若要开放给其他主机，**必须**同时启用 HTTP Basic 认证：

```bash
printf '%s' 'a-long-random-password' > secrets/access-password
```

```json
"access": { "basicAuth": { "username": "studio", "passwordFile": "/run/secrets/image-studio/access-password" } }
```

再把 `.env` 中的 `IMAGE_STUDIO_BIND_ADDRESS` 改为 `0.0.0.0`，并建议在其前面放置 HTTPS 反向代理。`/healthz` 不需要认证。本地 API 还会拒绝跨站来源的写请求。

## 备份与恢复

所有持久数据都在两个挂载目录中：

```bash
docker compose stop
tar czf image-studio-backup-$(date +%F).tgz data/db data/storage
docker compose start
```

恢复时停止容器，解压回原位置（保持属主为 `IMAGE_STUDIO_UID:GID`），再启动即可。

## 平台挂载模式与镜像交付

镜像默认即为平台模式（`IMAGE_STUDIO_MODE=platform`，端口 `8080`，与 [`module.json`](module.json) 一致）。该模式拒绝任何 `storage` / `ai` / `access` 配置及客户 key，不打开数据库、不挂载卷，本地项目 API 一律 `404`，因此平台鉴权失败时不可能回退为本地单用户模式。

向 skillsmaster 提交同一镜像归档：

```bash
docker build -t image-studio:0.1.0 .
docker save image-studio:0.1.0 | gzip > image-studio-0.1.0.tar.gz
# 在 skillsmaster 管理后台上传该归档与 module.json
```

本地验证平台模式：`docker run --rm -p 8080:8080 image-studio:0.1.0`，然后 `curl localhost:8080/healthz`。

## 开发

```bash
npm ci
npm run test:server      # 独立模式服务端测试（node:test）
npm test                 # 服务端 + 前端（Jest）测试
npm run typecheck
npm run dev              # Vite 开发服务器 :5173，后端路由代理到 IMAGE_STUDIO_DEV_BACKEND（默认 http://127.0.0.1:3000）
npm start                # 直接运行容器服务端（需 IMAGE_STUDIO_CONFIG 或 IMAGE_STUDIO_MODE）
```

目录结构：

```
src/            前端（React + Konva）
  runtime/      运行模式契约（runtime-config.json）
  ai/           AI 适配器：httpGateway（平台）/ standaloneGateway（独立）
  projects/     项目客户端（两种模式共用同一套 /image-studio/projects 契约）
  shared/       从 skillsmaster 迁入的共享模块：文档/AI 操作契约、资源限制、画布坐标、语言、平台鉴权
public/icons.svg  产品图标精灵（独立模式由容器在 /icons.svg 提供）
server/         容器服务端：静态资源、/healthz、本地项目 API（node:sqlite）、AI 代理
config/         运行时配置示例（standalone.json / platform.json）
docker-compose.yml, .env.example   独立模式的端口与卷映射
```

## 许可证

本项目以 [GNU General Public License v3.0](LICENSE) 发布。
