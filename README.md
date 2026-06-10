# AI Fabric Studio MVP

面向纺织与服装设计师的 **Fabric Layer Recolor** 本地原型。

AI Fabric Studio 的目标不是成为 Photoshop 或通用图片换色工具，而是帮助设计师识别面料中的不同颜色结构，并分别开发新的配色方案。

> This is a local-first textile color development prototype, not a general-purpose image editor.

## Product Vision

用户上传一张面料图片后，系统尝试识别：

- **Ground Fabric / Base**：底布、底组织或主要背景结构
- **Pattern Motif**：花型或主要图案区域
- **Stripe / Jacquard**：条纹、提花或具有方向性的织物区域
- **Secondary Motif / Accent**：次级花型与细节色

用户可以分别修改各结构的颜色，同时尽量保留原图中的织物明暗、纹理和表面变化，最后导出新的面料配色 PNG。

## Current MVP

- 上传 PNG、JPG 或 WebP 面料图片
- 提供内置 textile sample，方便快速体验
- 自动识别 2–4 个主要颜色区域
- 为每个颜色结构生成 pixel mask
- 显示每个区域的覆盖比例和 mask preview
- 使用 textile-oriented layer naming
- 分别修改 Base、Pattern、Stripe / Jacquard 和 Accent 颜色
- 保留原始 luminance 与局部纹理进行 recolor
- 导出配色结果 PNG
- 全部图像处理在浏览器本地完成，不上传图片

## MVP Workflow

```text
Upload Fabric
      ↓
Preview Original Fabric
      ↓
Detect Fabric Layers
      ↓
Review Ground / Motif / Stripe Masks
      ↓
Choose Color for Each Fabric Layer
      ↓
Apply Color
      ↓
Download PNG
```

## Run Locally

### Requirements

- Node.js 20 or newer
- npm

### Start the project

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd ai-fabric-studio
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

For a quick walkthrough, click **Try sample fabric**.

### Production verification

```bash
npm run lint
npm run build
npm start
```

## Technology

- **Frontend:** Next.js 16, React 19, TypeScript
- **Interface:** custom responsive CSS
- **Image processing:** browser Canvas and ImageData APIs
- **Segmentation:** K-means dominant color clustering
- **Mask format:** per-pixel `Uint8Array`
- **Export:** client-side PNG data URL

No login, payment, database, cloud storage, model training, PBR, U3M, CLO, or Browzwear integration is included in this MVP.

## Architecture

```text
app/page.tsx
  ├── Upload and textile workflow UI
  ├── Layer controls
  ├── Recolor preview
  └── PNG export

lib/fabric-segmentation.ts
  ├── Image loading and resizing
  ├── K-means color clustering
  ├── Pixel mask generation
  ├── Fabric layer classification
  ├── Texture-preserving recolor
  └── Mask and image rendering
```

The segmentation engine is isolated in
[`lib/fabric-segmentation.ts`](./lib/fabric-segmentation.ts).

`detectFabricLayers()` returns a stable `SegmentationResult` containing the original
image and an array of `FabricLayer` objects. A later SAM, semantic segmentation, or
textile-specific model can replace the current clustering implementation without
redesigning the interface.

## Important Product Intent

When reviewing this project, do **not** evaluate it primarily as:

- a photo filter
- a Photoshop replacement
- a generic color replacement tool
- a complete SaaS product

Evaluate it as an early textile workflow prototype whose core value is:

> Separating the perceived construction of a fabric into editable color layers.

The intended professional vocabulary and interaction model should remain centered on:

- fabric layer
- ground structure
- base color
- pattern motif
- stripe
- jacquard
- textile colorway
- surface and weave preservation

## Known MVP Limitations

- Color clustering does not understand true textile construction.
- Similar colors in unrelated regions may be grouped into the same mask.
- Shadows, highlights, compression noise, and folds can become separate clusters.
- The current Stripe / Jacquard label is inferred heuristically from spatial distribution.
- Mask boundaries do not yet include smoothing or manual correction tools.
- Images are resized to a maximum processing edge of 1100 pixels.
- Export uses the analyzed resolution rather than the original full resolution.
- The algorithm cannot yet distinguish yarn systems, weave structures, embroidery, or print techniques.

These are expected constraints of the first MVP, not claims of production-grade AI segmentation.

## Suggested Evaluation Path

For a meaningful review:

1. Run the project and open the homepage.
2. Use **Try sample fabric** to understand the intended workflow.
3. Inspect all detected mask previews.
4. Change Base Color and Pattern Color to clearly different colors.
5. Click **Apply Color** and compare the result with the source.
6. Change the number of detected structures between 2, 3, and 4.
7. Upload real examples such as floral print, stripe, jacquard, check, or textured solid fabric.
8. Evaluate whether the product language and workflow feel native to textile design.
9. Separate UX problems from segmentation-algorithm limitations.
10. Prioritize improvements that strengthen Fabric Layer Recolor rather than adding generic editor features.

## Review Questions

- Is the Fabric Layer Recolor concept immediately understandable?
- Does the interface feel designed for fashion and textile professionals?
- Are Ground Fabric, Pattern Motif, and Stripe / Jacquard useful mental models?
- Does the result preserve enough textile texture to support colorway exploration?
- Which interactions still feel like a generic image editor?
- What information would a textile designer need before trusting a detected layer?
- Which mask correction capability would deliver the most value?
- What should be P0, P1, and P2 for the next prototype?
- Which improvements require better UX, and which require a stronger segmentation model?
- Does this prototype support a credible path toward SAM or textile-specific segmentation?

## Prompt for ChatGPT Review

将 GitHub 仓库链接和部署链接发到了解你历史背景的 ChatGPT 对话中，并附上以下提示：

```text
请结合你对我的历史背景、审美偏好、工作方式和产品思维的了解，
浏览这个 AI Fabric Studio MVP，并阅读 GitHub README 和核心代码。

请不要把它当作普通图片编辑器或 Photoshop 替代品。
它的核心是面向纺织与服装行业的 Fabric Layer Recolor：
分别识别和修改 Ground Fabric、Pattern Motif、Stripe / Jacquard
以及其他面料颜色结构。

请实际体验以下流程：
1. Upload Fabric
2. Detect Fabric Layers
3. 检查每个 mask
4. 修改 Base Color 和 Pattern Color
5. Apply Color
6. Download PNG

请从以下角度进行评估：
- 它是否符合我长期想建立的 textile / fashion AI 产品方向
- 哪些部分体现了我的产品思维和审美
- 哪些部分仍然过于通用或偏普通图片工具
- 纺织设计师是否能理解并信任这个 workflow
- 当前 color clustering 的有效范围和主要误导风险
- 下一版应该优先改善 UX、mask editing 还是 segmentation

请输出：
1. 总体判断
2. 做对的部分
3. 关键问题
4. P0 / P1 / P2 改进清单
5. 建议保留的产品原则
6. 不建议现在加入的功能

请保持具体、批判性，并结合你对我的长期了解，不要只给通用 UI 建议。
```

## Future Direction

Potential next steps:

- SAM-assisted region proposals
- Manual mask brush, erase, merge, and split
- Edge smoothing and feather controls
- Full-resolution recolor export
- Better color-space clustering using Lab or perceptual embeddings
- Repeat-aware pattern analysis
- Textile-specific semantic layer models
- Multiple saved colorways and side-by-side comparison
- Pantone or brand palette input

These directions should be evaluated against the central product principle:

> Improve the designer’s control over textile structure before adding broader editing features.

## Status

This repository is an exploratory MVP intended for local testing, design critique, and
validation of the Fabric Layer Recolor concept.

