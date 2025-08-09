## AiBrush Local Editor: Architecture

### Purpose
AiBrush Local Editor is a browser-based React + TypeScript image editor tailored for local AI-assisted editing using ComfyUI as the backend. It provides selection-based img2img, inpainting, masking, freehand painting, smudging, upscaling, background removal, and reference image guidance via IP-Adapter and LoRA. The app is a single-page application built with Vite and uses localStorage for simple state persistence.

## Tech Stack
- React 18, TypeScript, Vite
- react-bootstrap for UI components
- blueimp-load-image for client-side image loading
- file-saver for downloads
- Web APIs: Canvas 2D, Web Workers, WebSocket, fetch
- Backend: ComfyUI HTTP + WebSocket (`/prompt`, `/view`, `/ws`, `/object_info`)

## Runtime Architecture

### Entry and Composition
- `index.html` mounts the SPA and loads Font Awesome.
- `src/main.tsx` bootstraps React and renders `App`.
- `src/App.tsx` mounts the `ImageEditor` within a Bootstrap container.

### Core UI: `ImageEditor`
`src/image-editor/ImageEditor.tsx`
- Creates a single visible `<canvas>` and constructs a `Renderer` that manages multiple offscreen canvas layers.
- Declares the available editor tools and their side-panel controls:
  - enhance (img2img with prompt, masks, IP-Adapter, LoRA, model selection)
  - inpaint (erase → generate → review)
  - pencil (freehand painting on an edit layer)
  - smudge (local blurring/averaging on an edit layer)
  - upscale (upscale, extend canvas, remove background)
  - reference images (add/remove overlays that guide generation)
  - import/export (load/save images)
- Hooks global pointer/touch/wheel events on the canvas and dispatches them to the active `Tool`.
- Resizes the renderer on window resize to fit the viewport and initializes a blank canvas image.
- Shows undo/redo if possible and a gear-button `BackendSelector` to configure the ComfyUI host.

### Rendering Engine: `Renderer`
`src/image-editor/renderer.ts`
- Maintains layered canvases:
  - backgroundLayer: checkered pattern
  - baseImageLayer: the committed image
  - editLayer: transient drawing or generated selection preview
  - maskLayer: optional binary/alpha mask overlay (semi-transparent at render time)
- State and helpers:
  - selectionOverlay and selectionOverlayPreview rectangles
  - cursor rendering (crosshairs, circle, filled-circle, colorpicker)
  - zoom and pan controls via `setTransform` on the visible canvas
  - undo/redo stack and snapshots (capped at 10)
  - list of reference images (small thumbnails rendered on the right edge)
- Operations:
  - set/get image and mask data, encode/decode images (png/webp/jpeg)
  - draw/erase/smudge primitives (on edit or mask layers)
  - commitSelection() blends editLayer over baseImageLayer safely (temporary canvas workaround for browser bug)
  - create/delete/invert/reset mask
  - expandToOverlay(): expands the base canvas to include an outpaint selection
  - resetView(): auto-fit image within canvas while preserving aspect

### Viewport and Input: `ZoomHelper`
`src/image-editor/zoomHelper.tsx`
- Converts between mouse/touch coordinates and canvas coordinates under current zoom and offsets.
- Implements wheel zoom (zoom to cursor), panning, and two-finger pinch-zoom.

## Tools Model

### Base API
`src/image-editor/tool.ts`
- `Tool` interface: mouse/pointer/touch/keyboard, wheel, destroy, get/update args, selection nav, save callback.
- `BaseTool`: shared behaviors
  - Persists tool arguments to localStorage (`tool_args_${name}`)
  - Crosshair cursor on hover; wheel zoom via `ZoomHelper`
  - Touch handling (long-press detection for pointer emulation or pinch)
  - Save listener callback storage

### Selection Tool
`src/image-editor/selection-tool.tsx`
- Drives the primary selection rectangle used by generation tools.
- Maintains a live `selectionOverlayPreview` while hovering; commits on click.
- Snaps preview origin to 16-pixel increments; clamps to image bounds unless outpaint is enabled.
- Side controls: `Controls` with `AspectRatioSelector`, size slider, and a “focus” toggle that centers and scales to 50%.

### Enhance Tool (img2img + mask)
`src/image-editor/enhance-tool.tsx`
- States: select → default → processing → confirm (with optional mask or erase sub-states).
- Integrates with `SelectionTool` and a `PencilTool` for mask editing.
- Parameters persisted via `useCache`: prompt, negative prompt, variation strength (denoise), reference images weight, selected LoRAs, model selection, and accelerator toggle.
- Model list and LoRAs fetched from ComfyUI `/object_info` via `ComfyFetcher`.
- Submits to ComfyUI via `lib/workflows.Img2Img` using JSON workflows:
  - chooses between PixArt, Flux, or SDXL/LoRA/IP-Adapter pipelines based on selected model name and provided reference images.
  - handles mask if present (or injects a transparent default).
  - resizes small selections up to at least 1MP before submission to improve quality, then downscales back in-canvas.
- “Erase” step lets the user soften or remove regenerated content before commit, with a feathered eraser sized to selection.

### Inpaint Tool
`src/image-editor/inpaint-tool.tsx`
- States: select → erase → inpaint → uploading/processing → confirm.
- Mask creation via erasing alpha in the selection on the base image (then undo to restore base before sending).
- Supports outpainting: if the selection extends beyond current bounds, calls `expandToOverlay()` before sampling.
- Submits to ComfyUI via `lib/workflows.Img2Img` with `inpaintingxl_api.json` workflow.
- Keeps a saved encoded mask for “retry” flows and preserves selection state across iterations.

### Pencil Tool
`src/image-editor/pencil-tool.tsx`
- Freehand drawing on the `editLayer` or `maskLayer`.
- Pressure-sensitive brush based on `PointerEvent.pressure`.
- Color picker mode samples a pixel color from the base image.
- Side controls expose brush size, palette with persistent additions, and a modal color picker.

### Smudge Tool
`src/image-editor/smudge-tool.tsx`
- Smudges along a line by averaging neighborhood pixels with opacity weighting.
- Draws on `editLayer` and requires a commit to apply to the base image.

### Augment Controls (Upscale/Extend/Background Remove)
`src/image-editor/augment-tool.tsx`
- Not a separate `Tool` class; it is a controls panel bound to a simple `BaseTool`.
- Uses `lib/workflows.Upscale` with `upscale_api.json` to 2x the image, then halves it to a balanced resolution.
- Uses `lib/workflows.Rembg` with `rembg-api.json` to remove backgrounds.
- “Extend Image” grows the canvas in 64px steps around a selection (via `expandToOverlay`).
- “Downscale” halves the canvas quickly on-device.

### Reference Images Controls
`src/image-editor/reference-images.tsx`
- Adds/removes up to 10 reference images with `blueimp-load-image` (loaded as canvases) and toggles their display overlay.
- The `Renderer` returns encoded reference images to workflows for IP-Adapter guidance.

### Import/Export Controls
`src/image-editor/import-export.tsx`
- Import an image file into the `Renderer` (with undo capability via a saved snapshot).
- Export to png/webp/jpeg via `file-saver`, naming the file based on the current prompt.

## Background Processing and Utilities

### Image Worker
`public/workers/imageutil.js` and `ImageUtilWorker` in `src/lib/imageutil.ts`
- Multi-worker pool (`new Worker('/workers/imageutil.js')`) handling CPU-heavy per-pixel operations.
- Functions: feather edge alpha, apply alpha/mask compositing with blur, convert mask/erasure formats.
- Used to improve responsiveness during selection-edge blending and alpha processing.

### Image Utilities
`src/lib/imageutil.ts`
- Format conversions (data URL ↔ base64), thumbnails, blob uploads, dimension fixes to multiples of 64.
- Selection feathering, tiling and merging for large upscales, canvas resize and encode/decode helpers.

### Workflows Integration
`src/lib/workflows.ts`
- Defines three orchestrators that wrap ComfyUI flows:
  - `Img2Img`: selection-based generation, mask-aware; handles PixArt/Flux/SDXL variants, reference images, LoRAs, denoise, seed, and “accelerator” tuning.
  - `Upscale`: model-based image upscaling.
  - `Rembg`: background removal.
- Workflow JSONs are loaded from `src/workflows/*.json` and cloned per-run. Nodes are addressed by `_meta.title` labels for stable references.
- Submits JSON to `http://{backend-host}/prompt` and listens for completion via `WebsocketHelper` on `ws://{backend-host}/ws?clientId=...`. On completion, downloads resulting images from `/view?filename=...` using `ComfyFetcher`.

### Backend API Accessors
`src/lib/comfyfetcher.ts`, `src/lib/websocket.ts`, `src/lib/objectinfo.ts`
- `ComfyFetcher` handles `/view` and `/object_info`. Object info populates LoRA and model dropdowns.
- `WebsocketHelper` encapsulates progress and completion events tied to a submitted prompt id.

### Persistence Helpers
`src/lib/cache.tsx`
- `useCache` React hook persists stateful UI values to localStorage by key.

### Aspect Ratios
`src/lib/aspecRatios.ts`
- Predefined common aspect ratios with scaling that rounds up to multiples of 64 to meet model constraints.

## UI Components
- `BackendSelector`: set and persist `backend-host` in localStorage (default `localhost:8188`).
- `AspectRatioSelector`: slider control rendering a live-dashed rectangle preview for the current aspect.
- `BusyModal`: centered modal for long-running operations.
- `ProgressBar`: bootstrap-styled progress indicator (0–100%).
- `LoraSelector` and `SelectedLoraTag`: modal for adding/removing LoRAs and pill-style tags with remove icons.

## Data Flow Overview
1) User selects a tool and a region on the canvas.
2) Tool assembles inputs (prompt, negative prompt, mask, ref images, model, denoise, LoRAs) and encodes the selection to base64.
3) Workflow runner (`Img2Img`/`Upscale`/`Rembg`) clones the JSON, injects parameters, POSTs to `/prompt`.
4) `WebsocketHelper` listens for progress and completion for the returned `prompt_id`.
5) On completion, `ComfyFetcher` loads the output image by filename; the tool decodes and composites it into the `Renderer` selection.
6) User can iterate (retry), erase edges, save to commit, or revert.

## State and Persistence
- Local storage keys used across the app:
  - `backend-host`
  - `tool_args_{tool-name}` for per-tool settings and selection overlays
  - `prompt`, `negative-prompt`, `denoise`, `reference-images-weight`, `selected-loras`, `selected-model`, `accelerator`, `size`, `focus`
- Undo/redo maintained inside `Renderer` for committed states.

## Error Handling and Constraints
- Many operations are guarded; errors are surfaced as bootstrap alerts in side panels.
- Selection and canvas dimensions are normalized to multiples of 64 for model compatibility.
- Extend and selection move in 64px steps to keep tiling safe.
- Long-running websocket listeners are time-capped (one hour) to prevent leaks.

## Styling and Layout
- Global theme in `src/index.css` (dark by default; honors prefers-color-scheme) and local styles in `src/image-editor/ImageEditor.css`.
- Bootstrap is included via `src/bootstrap.min.css` and Font Awesome via `public/css/fontawesome.min.css`.

## Backend Expectations
- ComfyUI is started with CORS enabled for the Vite dev origin:
  `--enable-cors-header=http://localhost:5173`
- Custom nodes/IP-Adapter “plus” nodes and model files are installed as described in `README.md`.

## Extending the System
- Add a new workflow:
  1) Export a ComfyUI graph JSON with predictable `_meta.title` names for dynamic updates.
  2) Place it under `src/workflows`.
  3) Create a runner class or extend `Img2Img` to inject parameters.
  4) Wire it into a new Tool or into existing controls.
- Add a new Tool:
  1) Implement a class extending `BaseTool` and a matching controls component.
  2) Add an entry to the `tools` array in `ImageEditor.tsx` with icon and renderControls.
  3) Persist args via `BaseTool.updateArgs` and/or `useCache`.

## Notable Design Choices
- Offscreen layered canvases for deterministic composition and preview (edit layer vs base image).
- Snapshot-based undo/redo with size-limited stacks.
- Stateless server integration using prompt IDs and websocket progress.
- JSON-driven workflows with `_meta.title` lookups ensure resilient wiring when node IDs change.


