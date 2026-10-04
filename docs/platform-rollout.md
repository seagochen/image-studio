# 平台容器接入、验收与回退

对应 [#8](https://github.com/seagochen/image-studio/issues/8)。上传、审批和挂载由 skillsmaster 管理后台执行（skillsmaster #196 / #205），本文件记录 Image Studio 这一侧的产物、检查项和回退步骤。

## 镜像约定

同一个镜像（同一 image ID）用于两种模式：

| | platform（默认） | standalone |
| --- | --- | --- |
| 运行用户 | `101:101` | 镜像默认 `101:101`；docker compose 可用 `IMAGE_STUDIO_UID/GID` 覆盖 |
| 根文件系统 | 只读（`--read-only`），不需要任何可写路径 | 只读根也可运行；数据写入 `/data` 卷 |
| 端口 | `8080`（`module.json` 的 `containerPort`） | 配置文件中的 `server.port`（compose 默认 80） |
| 提供的内容 | 静态资源、`/healthz`、`/runtime-config.json` | 另加本地项目 API 与 AI 代理 |
| 数据 / 密钥 | 无。拒绝 `storage` / `ai` / `access` 配置、客户 key 和访问令牌 | `/data/db`（SQLite）、`/data/storage`（素材、AI 结果、界面保存的 Key） |

skillsmaster 注入的 `SKILLSMASTER_MODE=platform` 必须与镜像内其他模式来源一致，否则容器拒绝启动，因此平台宿主不可能把它跑成独立模式。`scripts/smoke-image.sh` 会检查以上全部约定，CI 每次都会执行。

## 1. 打包

```bash
# 版本号取自 module.json；IMAGE_STUDIO_SIGNING_KEY 是可选的 PEM 私钥
IMAGE_STUDIO_SIGNING_KEY=/secure/image-studio-signing.pem scripts/package-image.sh release
```

产物位于 `release/`：

- `image-studio-<版本>.tar.gz`：`docker save` 归档
- `.sha256`：归档校验和
- `.sig`：归档的 SHA-256 签名（配置了签名密钥时才生成）
- `.release.json`：module id、版本、image ID、git commit、校验和与运行约定

打包前会先跑一遍双模式冒烟测试，失败则不生成归档。验签命令：

```bash
openssl dgst -sha256 -verify image-studio-signing.pub.pem -signature image-studio-<版本>.tar.gz.sig image-studio-<版本>.tar.gz
sha256sum -c image-studio-<版本>.tar.gz.sha256
```

## 2. 候选验证

在 skillsmaster 管理后台上传归档和 `module.json`，作为**候选**版本挂载（先不启用）。然后用一个普通用户和一个第二用户逐项核对：

- [ ] 已登录用户打开 `/apps/image-studio/` 时无需二次登录；刷新和深链（`/apps/image-studio/projects/<id>`）正常
- [ ] 新建、保存、关闭后重新打开项目；另一个标签页保存后，本页保存返回可恢复的 409
- [ ] AI 编辑：列出模式、带蒙版提交、轮询、应用结果图层；额度与审计记录在平台侧
- [ ] 登出后再访问：进入平台登录流程，不会出现可用的本地编辑器
- [ ] 停用该用户或模块：请求被拒绝，不会回退到本地 API（容器对 `/image-studio/*`、`/local-ai/*` 一律返回 404）
- [ ] 跨用户访问：用户 B 打开用户 A 的项目 URL 时被拒绝
- [ ] 旧项目兼容：打开 bundled 版本时期保存的项目，图层、蒙版与 AI 操作记录完整
- [ ] 容器以 `101:101` 运行、只读根、未挂载卷，`/healthz` 正常

## 3. 启用与移除 bundled 覆盖

候选验证全部通过后，在管理后台批准并启用该镜像，再移除 skillsmaster 中 bundled Image Studio 的路由覆盖，让 `/apps/image-studio/*` 指向挂载模块。启用后再完整执行一遍第 2 节。

bundled 镜像与相关代码暂不删除（留作回退），清理工作在后续 issue 中进行。

## 4. 回退

出现阻断问题时：

1. 在 skillsmaster 中恢复 bundled Image Studio 的覆盖项（即第 3 节移除的那一项），让 `/apps/image-studio/*` 重新由 bundled 版本提供。
2. 在管理后台停用挂载模块（不需要删除归档，以便之后重新启用）。
3. 验证：打开 `/apps/image-studio/`，确认由 bundled 版本提供服务，并能打开回退前保存的项目。

项目和 AI 数据保存在平台侧，挂载容器不持有任何数据，所以回退不涉及数据迁移，两个方向都可以重复执行。每次演练都在 #8 记录日期、版本和结果。

## 5. 关闭 #8

逐项核对 skillsmaster #205 / #196 的完整验收，并把第 2 节的结果与一次回退演练记录贴到 #8 后，再决定是否关闭。
