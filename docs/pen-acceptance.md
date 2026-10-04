# 实体数位笔验收流程

对应 [#3](https://github.com/seagochen/image-studio/issues/3)。合成 PointerEvent 测试（`src/__tests__/imageStudioBrushEngine.test.ts` 等）只能证明代码契约，证明不了真实设备、驱动和浏览器组合下的手感，这部分靠本流程补齐。结果回链 #3，并同步到路线图 [#2](https://github.com/seagochen/image-studio/issues/2)。

## 工具

`tests/browser/pen-diagnostics.html` 会记录每个 Pointer Event 的原始字段（pressure、tiltX/Y、twist、altitude/azimuth、coalesced 数量、pointer capture 状态），并让样本经过编辑器自己的 `pointerSamples()` 归一化。它会实时标出断线（相邻样本距离 > 40px 或间隔 > 120ms）和压力跳变（相邻样本差 > 0.4），也可以导出 JSON 报告。

```bash
npm ci
npx vite --host            # 让平板 / 另一台设备能访问
# 在被测设备上打开：
#   http://<开发机 IP>:5173/apps/image-studio/tests/browser/pen-diagnostics.html
```

填写页面顶部的 Device / Driver，逐个选择 Scenario 后绘制，最后点 **Download report** 保存 JSON。手感部分（笔刷大小、透明度、流量、旋转）需要在真实编辑器里配合本页数据一起确认：用 `npm run dev` 打开编辑器，或者使用候选/生产 Image Studio 页面。

## 设备矩阵

至少覆盖一款 Wacom 类数位板和一款原生触控笔设备（Apple Pencil、Surface Pen 或 Android 主动笔）。只在设备所在平台上测试对应浏览器。

| 设备 | 系统 / 驱动 | Chrome | Firefox | Safari | 记录人 / 日期 |
| --- | --- | --- | --- | --- | --- |
| Wacom 类数位板（型号） | macOS / Windows + 驱动版本 |  |  | macOS |  |
| 原生触控笔（型号） | iPadOS / Windows / Android |  |  | iPadOS |  |

每格填“通过”或“问题编号”，并附对应报告 JSON（可上传到 Issue 评论）。

## 场景与判定

| 场景 | 操作 | 通过标准 |
| --- | --- | --- |
| pressure sweep | 从极轻到最重缓慢画线 | `pressure` 在 (0, 1] 内连续变化；首个样本没有异常的 0 或 1；编辑器中尺寸 / 透明度 / 流量随压力平滑变化 |
| tilt and twist | 倾斜笔身、旋转笔杆（支持的设备） | 支持的字段在报告中为 `tiltReported` / `twistReported: true`；不支持时为 false，编辑器回退为默认角度且不报错 |
| fast strokes | 快速画大幅折线、圆圈 | `gaps: 0`；有 `coalesced` 时 `maxCoalesced > 1`；编辑器中线条没有折断 |
| out-of-bounds capture | 按住笔拖出画布，再拖回后抬笔 | `outsideSamples > 0`，`captureLost: false`，`endedBy: pointerup`；编辑器中笔画不中断，也不会卡在“按下”状态 |
| lift and re-enter | 笔尖离开感应范围后重新接近 | 每次都产生独立笔画；没有残留连线 |
| long airbrush hold | 喷枪笔刷原地按住 10 秒以上 | 样本速率稳定；编辑器中没有异常累积或卡顿 |
| mouse fallback | 用鼠标绘制 | `pointerType: mouse`；归一化压力固定 0.5 |
| touch fallback | 用手指绘制（触屏设备） | `pointerType: touch`；页面不滚动、不缩放；笔与手掌同时接触时不产生误笔画 |

## 发现问题时

1. 记录复现步骤、设备 / 系统 / 驱动 / 浏览器版本，并附报告 JSON 中对应笔画的 `events`。
2. 能用事件序列表达的差异（例如首样本 pressure 为 0、缺少 coalesced 事件、`pointercancel` 时序）都要补一条以该序列为输入的回归测试，放在 `src/__tests__/imageStudioBrushEngine.test.ts` 或 `imageStudioSelectedPointerSession.test.tsx`。
3. 无法自动化的部分保留复跑步骤和设备记录，写到 #3 的评论里。
