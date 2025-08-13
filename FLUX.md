# Flux Kontext Tool Implementation Plan

## Overview
Implement a new tool for the AiBrush Local Editor that uses the Flux Kontext workflow to enhance specific regions of an image with high-quality AI processing. The tool will follow the existing enhance tool pattern but with a simpler interface.

## Requirements
1. Fixed 1024x1024 square selection (no aspect ratio or resize controls)
2. Multiline text input for prompts with word wrap
3. Selection phase → Prompt phase → Processing → Result review with retry/delete/confirm
4. Integration with the new FluxKontext workflow class

## Implementation Steps

### Phase 1: Create the FluxKontextTool Class
**File:** `src/image-editor/flux-kontext-tool.tsx`

#### 1.1 Tool Class Structure
```typescript
export class FluxKontextTool extends BaseTool implements Tool {
    readonly selectionTool: SelectionTool;
    
    private prompt: string = "";
    private _dirty = false;
    private worker: ImageUtilWorker;
    
    private _state: FluxKontextToolState = "select";
    private stateHandler: (state: FluxKontextToolState) => void = () => { };
    private selectionControlsListener: (show: boolean) => void = () => { };
    
    private imageData: Array<ImageData> = [];
    private selectedImageDataIndex: number = -1;
    private selectedImageData: ImageData | null = null;
    
    // Progress and error handling
    private progressListener?: (progress: number) => void;
    private errorListener?: (error: string | null) => void;
    private dirtyListener?: (dirty: boolean) => void;
}
```

#### 1.2 Tool States
```typescript
type FluxKontextToolState = 
    | "select"      // Selecting the 1024x1024 region
    | "prompt"      // Entering the enhancement prompt
    | "processing"  // Running the workflow
    | "confirm";    // Reviewing results with retry/delete/confirm options
```

#### 1.3 Key Methods
- `constructor`: Initialize with SelectionTool, set fixed 1024x1024 size
- `submit()`: Run the FluxKontext workflow with current prompt and selection
- `cancel()`: Revert to selection state
- `confirm()`: Commit the enhanced region to base image
- `deleteSelected()`: Remove current result from array
- `select(direction)`: Navigate between multiple results
- Input handlers: Delegate to SelectionTool when in "select" state

### Phase 2: Create the Controls Component
**File:** `src/image-editor/flux-kontext-tool.tsx` (same file)

#### 2.1 FluxKontextControls Component
```typescript
interface ControlsProps {
    renderer: Renderer;
    tool: FluxKontextTool;
}

export const FluxKontextControls: FC<ControlsProps> = ({ renderer, tool }) => {
    const [prompt, setPrompt] = useCache("flux-kontext-prompt", "");
    const [state, setState] = useState<FluxKontextToolState>(tool.state);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    
    // Hook up state listeners
    tool.onChangeState(setState);
    tool.onProgress(setProgress);
    tool.onError(setError);
}
```

#### 2.2 UI States

**Select State:**
- Info message: "Move the selection square to the area you want to enhance"
- Fixed square preview (no aspect ratio or size controls)
- "Continue" button to proceed to prompt state

**Prompt State:**
- Info message: "Describe how you want this area enhanced"
- Multiline textarea with word wrap for prompt input
- "Cancel" button to go back to selection
- "Enhance" button to submit

**Processing State:**
- Spinner with "Enhancing..." message
- Progress bar showing completion percentage

**Confirm State:**
- Navigation arrows for multiple results
- "Save" button to commit to base image
- "Retry" button to run again with same/modified prompt
- "Delete" button to remove current result
- "Cancel" button to discard all and return to selection

### Phase 3: Workflow Integration

#### 3.1 Import and Initialize
```typescript
import fluxKontextWorkflow from "../workflows/flux_1_kontext_dev_basic_api.json";
import { FluxKontext } from "../lib/workflows";
```

#### 3.2 Submit Method Implementation
```typescript
async submit() {
    this.dirty = true;
    this.notifyError(null);
    
    const selectionOverlay = this.renderer.getSelectionOverlay();
    let encodedImage = this.renderer.getEncodedImage(selectionOverlay!, "jpeg");
    
    if (!encodedImage) {
        console.error("No selection");
        return;
    }
    
    const workflow = new FluxKontext(fluxKontextWorkflow);
    this.state = "processing";
    
    try {
        const imageUrl = await workflow.run(
            this.prompt, 
            encodedImage, 
            progress => this.updateProgress(progress)
        );
        
        // Load and store the result
        this.imageData.push(await this.loadImageData(imageUrl, selectionOverlay!));
        this.selectedImageDataIndex = this.imageData.length - 1;
        this.renderer.setEditImage(this.imageData[this.selectedImageDataIndex]);
        this.selectedImageData = this.imageData[this.selectedImageDataIndex];
        this.state = "confirm";
        
    } catch (err: any) {
        console.error("Error creating images", err);
        const errMessage = err.response?.data?.message || err.message || "Failed to enhance image";
        this.notifyError(errMessage);
        this.state = "prompt";
    }
}
```

### Phase 4: Fixed Selection Configuration

#### 4.1 SelectionTool Setup
```typescript
constructor(renderer: Renderer) {
    super(renderer, "flux-kontext");
    this.selectionTool = new SelectionTool(renderer);
    
    // Set fixed 1024x1024 selection
    this.selectionTool.updateArgs({
        ...this.selectionTool.getArgs(),
        aspectRatio: { width: 1, height: 1 },
        size: 1024,
        outpaint: false,
        fixedSize: true  // Custom flag to disable size controls
    });
    
    this.state = "select";
    this.worker = new ImageUtilWorker();
}
```

### Phase 5: Image Editor Integration

#### 5.1 Add Tool to ImageEditor.tsx
```typescript
{
    name: "flux-kontext",
    iconClass: "fas fa-sparkles",  // Or another appropriate icon
    constructor: (r: Renderer) => new FluxKontextTool(r),
    defaultArgs: {},
    renderControls: (t: Tool, renderer: Renderer) => {
        t.onShowSelectionControls(setShowSelectionControls);
        return (
            <FluxKontextControls
                tool={t as FluxKontextTool}
                renderer={renderer}
                key={"flux-kontext-controls"}
            />
        );
    },
}
```

### Phase 6: UI Refinements

#### 6.1 Multiline Prompt Input
```typescript
<textarea
    className="form-control"
    id="flux-kontext-prompt"
    value={prompt}
    onChange={(e) => setPrompt(e.target.value)}
    rows={4}
    style={{ 
        resize: "vertical",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word"
    }}
    placeholder="Describe how you want this area enhanced..."
/>
```

#### 6.2 Simplified Selection Display
- Remove aspect ratio selector component
- Remove size slider
- Display fixed "1024×1024" text instead
- Keep the selection preview rectangle

### Phase 7: Helper Methods

#### 7.1 Image Loading and Feathering
```typescript
private async loadImageData(
    imageDataUrl: string,
    selectionOverlay: Rect
): Promise<ImageData> {
    const imageElement = await loadImageDataElement(imageDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = selectionOverlay.width;
    canvas.height = selectionOverlay.height;
    const ctx = canvas.getContext("2d");
    
    if (!ctx) {
        throw new Error("Failed to get canvas context");
    }
    
    ctx.drawImage(
        imageElement,
        0, 0,
        selectionOverlay.width,
        selectionOverlay.height
    );
    
    const imageData = ctx.getImageData(
        0, 0,
        selectionOverlay.width,
        selectionOverlay.height
    );
    
    // Apply feathering for smooth blending
    featherEdges(
        selectionOverlay, 
        this.renderer.getWidth(), 
        this.renderer.getHeight(), 
        imageData
    );
    
    return imageData;
}
```

## File Structure
```
src/
├── image-editor/
│   ├── flux-kontext-tool.tsx    # New tool implementation
│   └── ImageEditor.tsx          # Add tool to tools array
├── workflows/
│   └── flux_1_kontext_dev_basic_api.json  # Already modified
└── lib/
    └── workflows.ts              # FluxKontext class already added
```

## Testing Checklist
- [ ] Selection displays as fixed 1024×1024 square
- [ ] Selection can be moved but not resized
- [ ] Prompt textarea supports multiline input with word wrap
- [ ] Workflow executes successfully with prompt and image
- [ ] Results display in selection area with proper feathering
- [ ] Multiple results can be navigated with arrows
- [ ] Retry maintains prompt and selection
- [ ] Delete removes current result
- [ ] Confirm commits to base image
- [ ] Cancel properly reverts state
- [ ] Progress bar shows during processing
- [ ] Error messages display appropriately
- [ ] Tool switches work correctly
- [ ] Undo/redo functionality works after confirm

## Dependencies
- FluxKontext workflow class in `src/lib/workflows.ts` ✓
- Modified workflow JSON with simplified node titles ✓
- SelectionTool for region selection
- ImageUtilWorker for image processing
- useCache hook for prompt persistence
- Bootstrap components for UI

## Notes
- The tool intentionally omits features from enhance tool: masks, negative prompts, LoRAs, model selection, denoise strength
- Fixed 1024×1024 size ensures optimal quality for Flux Kontext model
- Feathering ensures smooth blending at selection edges
- Multiple results can be generated and compared before committing

## IMPLEMENTATION STATUS

### Completed Features
- ✅ FluxKontext workflow class created in `src/lib/workflows.ts`
- ✅ Fixed workflow output handling - ComfyUI returns `output.images` directly, not `output[node_id].images`
- ✅ Random seed generation for varied results
- ✅ Removed PreviewImage node that was causing premature completion
- ✅ Fixed websocket completion handling to properly wait for SaveImage node

### Known Issues Fixed
1. **404 Error on image fetch**: Fixed by passing subfolder and type parameters to fetch_image()
2. **Premature completion**: Removed PreviewImage node (173) that was sending early completion signals
3. **Cached results**: Added proper seed randomization with `Math.floor(Math.random() * 1000000000)`
4. **Output structure mismatch**: Handle both `output.images` and `output["136"].images` formats

## CRITICAL IMPLEMENTATION LESSONS

### 1. Workflow Instance Creation (MUST CREATE NEW FOR EACH RUN)
**CRITICAL**: Create a NEW workflow instance for EACH submit, not once in constructor:
```typescript
// WRONG - causes websocket confusion on subsequent runs
constructor() {
    this.workflow = new FluxKontext(workflowJSON);
}
async submit() {
    await this.workflow.run(...);
}

// CORRECT - like EnhanceTool does with Img2Img
async submit() {
    const workflow = new FluxKontext(workflowJSON);
    await workflow.run(...);
}
```
Each workflow run needs its own client_id and websocket connection to avoid progress/completion handler conflicts.

### 2. Selection Initialization
Must provide initial selectionOverlay with dimensions:
```typescript
this.selectionTool.updateArgs({
    selectionOverlay: { x: 0, y: 0, width: 1024, height: 1024 },
    aspectRatio: { width: 1, height: 1 },
    size: 1024,
    outpaint: false
});
```
Without this, getSelectionOverlay() returns null/0 dimensions causing "Failed to execute 'getImageData'" errors.

### 3. Arrow Navigation Location
**IMPORTANT**: Arrow navigation is NOT in individual tool controls!
- Arrows are rendered by ImageEditor.tsx when `showSelectionControls` is true
- Show arrows by calling `this.selectionControlsListener(true)` when state changes
- EnhanceTool shows arrows in "confirm" state, NOT "select" state:
```typescript
set state(state) {
    this._state = state;
    this.stateHandler(state);
    // Show arrows in confirm state like EnhanceTool
    this.selectionControlsListener(state === "confirm");
}
```

### 4. Progress Bar Component
Use the existing ProgressBar component from components/ProgressBar.tsx:
```typescript
import { ProgressBar } from '../components/ProgressBar';
// Progress expects 0-1 value, component converts to percentage
<ProgressBar progress={progress} />
```

### 5. FluxKontext Workflow Class Structure
The workflow class must:
- Create new client_id and WebsocketHelper for each run
- Handle the specific output format (may be in output.images or output["136"]["images"])
- Pass optional subfolder and type params to ComfyFetcher.fetch_image()

### 6. Image Output Handling
ComfyUI output structure varies. Check multiple locations:
```typescript
// Simple pattern used by most workflows
const dataUrl = await this.comfy_fetcher.fetch_image(output["images"][0]["filename"]);
```

### 7. Error Handling Patterns
- Check selection validity before getEncodedImage
- Provide user-friendly error messages via notifyError
- Catch and handle workflow errors, reverting to previous state

### 8. State Management
Tool states should follow this pattern:
- "select" - Choosing area (no arrows)
- "prompt" - Entering text
- "processing" - Running workflow  
- "confirm" - Reviewing results (arrows shown here)

### 9. File Location
Tool files go in src/image-editor/, NOT in a separate src/tools/ directory:
- src/image-editor/flux-kontext-tool.tsx (tool and controls in same file)
- Add to tools array in src/image-editor/ImageEditor.tsx

### 10. Import Paths
Use relative imports from image-editor location:
```typescript
import { Tool, BaseTool } from './tool';
import { SelectionTool } from './selection-tool'; 
import { loadImageDataElement, featherEdges } from '../lib/imageutil';
import { Rect } from './models';
import workflow from '../workflows/flux_1_kontext_dev_basic_api.json';
import { FluxKontext } from '../lib/workflows';
import { useCache } from '../lib/cache';
```

### 11. Workflow Output Nodes (CRITICAL)
**IMPORTANT**: Only use ONE output node (SaveImage) in workflows to avoid premature completion:
- PreviewImage nodes send completion signals with temp/cached images before processing finishes
- Multiple output nodes can cause race conditions in websocket completion handling
- ComfyUI sends "executed" message when ANY output node completes, not when ALL complete

### 12. ComfyUI Output Structure Variations
Workflows can return different output structures:
```typescript
// Direct structure (most common)
output.images[0]

// Node-indexed structure (when multiple SaveImage nodes)
output["136"].images[0]  // where 136 is the node ID

// Each image info contains:
{
  filename: "ComfyUI_00001_.png",
  subfolder: "",
  type: "output"  // or "temp" for preview/cached images
}
```

### 13. Websocket Prompt ID Matching
- Each workflow run creates a new client_id and WebsocketHelper
- WebSocket checks `result.data.prompt_id === this.promptId` to match messages
- Progress messages also need prompt_id checking to avoid cross-talk
- One "executed" message sent per prompt when workflow completes

### 14. Seed Randomization
Always randomize seed for variation between runs:
```typescript
this.node("KSampler").inputs.seed = Math.floor(Math.random() * 1000000000);
```

### 15. Error Handling in Promises
When using async workflows, properly handle both resolve and reject:
```typescript
return new Promise((resolve, reject) => {
    // ... workflow setup ...
    const handle_websocket_completion = async (output: any) => {
        if (!output || !output.images) {
            reject(new Error("Failed to get image from workflow output"));
            return;
        }
        // ... process output ...
        resolve(dataUrl);
    };
});
```