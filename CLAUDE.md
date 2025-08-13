# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev        # Start dev server on localhost:5173 with HMR
npm run build      # Type check and build for production
npm run lint       # Run ESLint on TypeScript files
npm run preview    # Preview production build locally
```

### ComfyUI Backend
Start ComfyUI with CORS enabled:
```bash
python main.py --enable-cors-header=http://localhost:5173
```

## Architecture Overview

This is an AI-powered image editor using React/TypeScript frontend with ComfyUI backend. The architecture centers around:

### Core Components

1. **Multi-Layer Canvas System** (`src/image-editor/renderer.ts`):
   - Background, base image, edit, and mask layers
   - Offscreen rendering for performance
   - Undo/redo with snapshot system (max 10)

2. **Tool System** (`src/tools/`):
   - All tools extend `BaseTool` interface
   - Tools: Enhance, Inpaint, Pencil, Smudge, Selection, Augment
   - Each tool manages its own state and controls

3. **Workflow Integration** (`src/workflows/`):
   - JSON workflows for ComfyUI
   - Dynamic parameter injection via `_meta.title` nodes
   - Support for SDXL, Flux, PixArt, Flux Kontext models

4. **State Management**:
   - Canvas state in `ImageEditor.tsx`
   - Tool arguments in localStorage
   - WebSocket for ComfyUI progress updates

### Key Files

- **Entry**: `src/main.tsx` → `src/App.tsx` → `src/image-editor/ImageEditor.tsx`
- **Rendering Engine**: `src/image-editor/renderer.ts` - Canvas layer management
- **ComfyUI Client**: `src/comfyui-utils/comfyuiClient.ts` - API and WebSocket communication
- **Tool Implementation**: `src/image-editor/[tool-name].tsx` - Each tool in image-editor directory
- **Workflow Classes**: `src/lib/workflows.ts` - Img2Img, FluxKontext, Rembg, Upscale classes
- **WebSocket Handler**: `src/lib/websocket.ts` - Handles ComfyUI progress and completion

### Adding New Features

**New Tool**:
1. Create file in `src/image-editor/` (NOT `src/tools/`)
2. Extend `BaseTool` and implement `Tool` interface
3. Add to `ImageEditor.tsx` tools array with icon and controls
4. Include controls component in same file as tool class

**New Workflow**:
1. Add JSON to `src/workflows/`
2. Use `_meta.title` for parameter injection
3. Create workflow class in `src/lib/workflows.ts`
4. CRITICAL: Create new workflow instance for EACH run

### Important Patterns

- Always preserve exact canvas dimensions and selection state
- Use `renderer.ts` methods for all canvas operations
- Store tool settings in localStorage with `tool_args_` prefix
- Handle ComfyUI errors gracefully with user feedback
- Image processing in Web Workers when CPU-intensive
- Arrow navigation is in ImageEditor.tsx, controlled via `showSelectionControls`
- Show arrows by setting `this.selectionControlsListener(state === "confirm")`
- Create new workflow instances per run to avoid websocket conflicts
- Selection must be initialized with valid dimensions to avoid getImageData errors
- Only use SaveImage nodes in workflows (avoid PreviewImage to prevent premature completion)
- Set random seeds in KSampler nodes for variation: `Math.floor(Math.random() * 1000000000)`
- Check both `output.images` and `output[nodeId].images` for ComfyUI outputs
- Pass subfolder and type params to ComfyFetcher.fetch_image() to avoid 404s

### Testing Considerations

- No formal test framework configured
- Rely on TypeScript for type safety
- Manual testing with various image formats/sizes
- Test with different ComfyUI model configurations