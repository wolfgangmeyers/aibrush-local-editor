## FILE MAP

Root
- `README.md`: Setup guide for ComfyUI, models, custom nodes, and running the app.
- `index.html`: SPA entry, Font Awesome CSS, mounts `#root` and loads `src/main.tsx`.
- `package.json`: Dependencies (React, TS, Vite, axios, blueimp-load-image, file-saver, react-bootstrap, react-color, react-router, uuid) and scripts.
- `tsconfig.json` / `tsconfig.node.json`: TypeScript configs for app and Vite.
- `vite.config.ts`: Vite setup with React plugin; dev server host/port.
- `UNLICENSE`: License.
- `yarn.lock`: Lockfile.

Public assets
- `public/favicon.ico`, `public/vite.svg`: Icons used in the app shell.
- `public/blank-canvas.jpg`: Initial canvas image.
- `public/transparent1024.png`: Transparent image asset (not referenced in code directly; a transparent base64 is generated at runtime in `workflows.ts`).
- `public/css/fontawesome.min.css`, `public/webfonts/*`: Font Awesome CSS and fonts.
- `public/workers/imageutil.js`: Web worker implementing feathering and alpha-mask processing; receives a message with pixels/mask and responds with processed pixels.

Source
- `src/main.tsx`: React bootstrap; renders `App` and loads `index.css`.
- `src/App.tsx`: Mounts `ImageEditor` in a Bootstrap container and imports core CSS.
- `src/index.css`: Global CSS variables, theme, button styles, and light-mode overrides.
- `src/bootstrap.min.css`: Bootstrap CSS (vendored).
- `src/vite-env.d.ts`: Vite type references.

Components (`src/components`)
- `AspectRatioSelector.tsx`: Slider to pick predefined aspect ratios; renders a dashed rectangle preview.
- `BackendSelector.tsx`: Modal to set `backend-host` in localStorage; gear icon button.
- `BusyModal.tsx`: Modal for long-running tasks with spinner or custom children.
- `LoraSelector.tsx`: Modal to add a LoRA from available list with strength slider; emits `{name, strength}`.
- `ProgressBar.tsx`: Bootstrap-styled progress bar.
- `SelectedLora.tsx`: `SelectedLoraTag` pill with an X icon to remove.

Image Editor (`src/image-editor`)
- `ImageEditor.tsx`: Main editor shell; creates `Renderer`, declares tool list, binds controls, resizes canvas, handles undo/redo and reset view.
- `renderer.ts`: Multi-layer canvas engine, cursor/overlay rendering, masks, snapshots/undo/redo, zoom/pan, selection commit, outpaint expand, reference image overlay.
- `zoomHelper.tsx`: Coordinate transforms, wheel zoom, panning, pinch-zoom; translate between mouse and canvas coordinates.
- `tool.ts`: `Tool` interface + `BaseTool` implementation; common input handling, arg persistence, touch handling.
- `models.ts`: Basic `Rect` and `Cursor` interfaces.
- `selection-tool.tsx`: Selection rectangle controller with live preview; clamps to image bounds unless outpainting.
  - `Controls` subcomponent: aspect ratio slider, size slider, and focus checkbox.
- `enhance-tool.tsx`: Enhance workflow (img2img) with states, mask editing via `PencilTool`, LoRA/model controls, denoise, accelerator; integrates with ComfyUI via `lib/workflows.Img2Img`.
  - `EnhanceControls`: Side-panel UI to drive enhance operations and display progress/errors.
- `inpaint-tool.tsx`: Inpainting workflow with erase/mask → submit → confirm; outpaint support; uses `Img2Img` with `inpaintingxl_api.json`.
  - `InpaintControls`: Side-panel UI for inpaint flow, brush size, LoRAs, reference strength, and submit/retry/save.
- `pencil-tool.tsx`: Freehand drawing and mask painting; pressure-sensitive brush, color picker; `Controls` subcomponent manages palette and brush.
- `smudge-tool.tsx`: Smudging tool; averages neighborhood pixels along a stroke; `SmudgeControls` provides brush size/opacity and commit.
- `augment-tool.tsx`: Non-tool control set for upscale/extend/downscale/remove background using `lib/workflows`.
- `reference-images.tsx`: Add/remove/preview reference images and toggle display in `Renderer`.
- `import-export.tsx`: Import image from file; export current canvas to PNG/WEBP/JPEG using `file-saver`.
- `ColorPicker.tsx`, `ColorPicker.css`: Inline color picker button that opens `ChromePicker`.
- `PaletteButton.tsx`: Color swatch with optional ChromePicker for custom colors.
- `ImageEditor.css`: Layout CSS for canvas, selection arrows, and palette.

Library (`src/lib`)
- `aspecRatios.ts`: `AspectRatio` class and common ratios; scaling rounds to multiples of 64; helpers to find the closest ratio.
- `cache.tsx`: `useCache` hook backed by localStorage.
- `comfyfetcher.ts`: `ComfyFetcher` for `/view` and `/object_info` endpoints.
- `imageutil.ts`: Canvas/image helpers: base64 conversions, thumbnails, tiling and merging, resize to multiples of 64, feathering, mask application (blurred alpha), worker pool `ImageUtilWorker`, uploads.
- `loras.ts`: `SelectedLora` interface.
- `objectinfo.ts`: Comfy object info TypeScript types.
- `sleep.ts`: Promise-based sleep.
- `websocket.ts`: `WebsocketHelper` waits on ComfyUI `/ws` for progress/executed for a specific prompt.
- `workflows.ts`: Workflow runners: `Img2Img`, `Upscale`, `Rembg`; manage workflow JSON cloning, node lookups by `_meta.title`, parameter injection, submission and result fetch.

Workflows (`src/workflows`)
- `dreamshaper_img2img64_*_api.json`: SDXL-based img2img workflows with mask and IP-Adapter pipeline (Comfy graph JSON with `_meta.title` annotations used by code to locate nodes).
- `pixart-sigma-img2img-mask-api.json`: PixArt sigma variant workflow.
- `flux-dev-api.json`: FLUX dev variant workflow.
- `inpaintingxl_api.json`: XL inpainting workflow for mask-based edits.
- `rembg-api.json`: Background removal workflow.
- `upscale_api.json`: ESRGAN-based upscaler workflow.

Assets (`src/assets`)
- `react.svg`: Vite template asset; unused at runtime.


