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