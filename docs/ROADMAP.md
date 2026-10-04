# Image Studio 能力路线图

本文件是 [#2](https://github.com/seagochen/image-studio/issues/2) 在仓库内的落地版本：Issue 负责讨论与优先级决策，本文件记录当前生效的范围取舍和子 Issue 状态。两者不一致时以 Issue 最新结论为准，并在同一个 PR 中更新本文件。

产品定位：**AI + 一个过得去的绘图工具**。本地编辑器负责表达意图、选区/蒙版、图层构图和结果精修；差异化来自有明确用户价值的 AI 工作流。不追求完整复刻 Photoshop。RAW、印前、复杂矢量排版不是默认发布门槛。

## 产品与计算边界

| 范围 | 约定 |
| --- | --- |
| 本地计算 | 绘制、选区、蒙版、图层合成、几何变换、调整预览与标准导出在浏览器本地完成。GPU/Worker 不可用或内存不足时走可验证的降级路径，不得损坏文档。 |
| 身份 / 持久化 / AI | 按运行模式接入（[#5](https://github.com/seagochen/image-studio/issues/5)）。平台模式沿用 skillsmaster 用户、App Session、额度、审计与 owner 隔离；独立模式使用本仓库的本地项目服务（[#6](https://github.com/seagochen/image-studio/issues/6)）。AI 凭证只在服务端读取，不进入浏览器 bundle（`npm run check:bundle` 在 CI 中检查）。 |
| AI 操作 | 只提交本次任务需要的图层、选区/蒙版与参数；结果作为新的可编辑图层写回。操作必须幂等、可恢复、可取消；失败不阻断普通编辑。提交结果未知时不自动重提（[#7](https://github.com/seagochen/image-studio/issues/7)）。 |

## 子 Issue 状态

“状态”只同步各子 Issue 的结论，验收清单以各自 Issue 为准。

| Issue | 内容 | 阶段 | 状态 |
| --- | --- | --- | --- |
| [#1](https://github.com/seagochen/image-studio/issues/1) | 独立运行与平台挂载双模式（父任务） | 基础 | 已关闭，阶段工作拆分到 #4–#8 |
| [#4](https://github.com/seagochen/image-studio/issues/4) | 自足构建与契约归属 | 基础 | 本仓库侧完成：独立 npm ci / 类型检查 / 测试 / 构建 / Docker / CI。父仓库改用子仓库入口及契约逐字比对需在 skillsmaster 侧完成 |
| [#5](https://github.com/seagochen/image-studio/issues/5) | 显式运行模式与浏览器适配器 | 基础 | 本仓库侧完成：`runtime-config.json` 缺失、非法或请求失败时报错；平台鉴权失败只进入平台登录；启动流程有单元测试 |
| [#6](https://github.com/seagochen/image-studio/issues/6) | 独立项目服务与持久存储 | 基础 | 本仓库侧完成：SQLite + 存储卷、409 冲突、素材校验、远程访问令牌与会话、Origin 校验、崩溃恢复、孤儿文件清理、schema 迁移、在线备份 |
| [#7](https://github.com/seagochen/image-studio/issues/7) | 独立 AI 代理与重启恢复 | 基础 | 本仓库侧完成：提交状态持久化，超时/崩溃/5xx 记为“结果未知”且不自动重提。上游幂等协议需与 skillsmaster 确认后才可开启 `ai.idempotentSubmit` |
| [#8](https://github.com/seagochen/image-studio/issues/8) | 平台容器接入与双模式验收 | 交付 | 镜像侧完成：平台模式以 101:101、只读根运行，独立模式使用 `/data` 卷；签名归档与回退流程见 [platform-rollout.md](platform-rollout.md)。skillsmaster #205/#196 的平台侧验收待完成 |
| [#3](https://github.com/seagochen/image-studio/issues/3) | 真实数位笔与浏览器兼容性 | 质量 | 工具就绪：[pen-acceptance.md](pen-acceptance.md) 与 `tests/browser/pen-diagnostics.html`。实体设备记录待补 |

## 能力路线

优先级从高到低。只有建立了独立子 Issue（写明用户场景、文档迁移、兼容边界、性能预算、失败行为和可复跑验收，并回链 #2）的能力才进入排期。

1. **近期：AI 工作流与编辑边界**。局部生成、结构引导、风格迁移各开子 Issue；验证蒙版外像素约束、结果以新图层写回、保存/重开、取消、失败回退与额度语义。黑白照片忠实上色与生成式线稿上色是两个不同能力，分开立项。
2. **局部编辑与高分辨率基础**。Alpha 通道/选区存档、vector/clipping mask 与现有通用 raster mask 的边界；tile/脏区、撤销预算、OPFS 恢复、可取消渲染和 4K/8K 内存预算使用同一套契约。
3. **非破坏性编辑**。自由变换、透视/扭曲、保留源像素的嵌入/链接对象，以及可重开参数、可排序、可隐藏、可加蒙版的滤镜链；预览、保存与导出语义统一。
4. **色彩工作流**。RGB 工作流稳定后，再按真实需求评估 16-bit RGB、ICC profile 读取/转换/写出、Display P3。高位深与 ICC 不是 AI 工作流的上线门槛。
5. **创作与布局工具**。路径/矢量编辑、专业文字排版、图层效果/高级混合、画布尺寸/DPI、参考线/网格/吸附/对齐，各自按用户需求评估。
6. **互操作与质量门禁**。维护 OpenRaster/GIMP/Krita 兼容样例和 fallback；为透明边缘、蒙版、混合、色彩、保存导出一致性、恶意文件和大画布性能建立可复跑门禁，覆盖 Chromium/Firefox/Safari 与真实输入设备（#3）。
7. **远期可选**。RAW/摄影、CMYK/印前、多用户协作、插件 API。只有确认了目标用户并各自建立子 Issue 后才纳入排期，不属于“AI + 绘图工具”的发布承诺。

## 一致性约束

- 选区/蒙版、增量历史、渲染、变换、色彩和导出共享同一套文档语义（`src/shared/imageStudioDocumentContract.ts`）。新能力扩展文档时必须提供版本迁移，旧项目仍能打开。
- 大画布与跨浏览器的证据由对应子 Issue 提供（`tests/browser/*-4k.html` 等可复跑页面）。
- 未列入近期优先级的能力不阻塞已独立验收的功能。
- 范围或产品定位变化时，同步更新 #2、本文件及对应子 Issue。skillsmaster 主仓库不再维护重复的 Image Studio 专业化清单。
