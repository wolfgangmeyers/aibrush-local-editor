import { FC, useEffect, useState } from 'react';
import { Tool, BaseTool } from './tool';
import { Renderer } from './renderer';
import { SelectionTool } from './selection-tool';
import { loadImageDataElement, featherEdges } from '../lib/imageutil';
import { Rect } from './models';
import fluxKontextWorkflow from '../workflows/flux_1_kontext_dev_basic_api.json';
import { FluxKontext } from '../lib/workflows';
import { useCache } from '../lib/cache';
import { ProgressBar } from '../components/ProgressBar';

type FluxKontextToolState = 
    | "select"      // Selecting the 1024x1024 region
    | "prompt"      // Entering the enhancement prompt
    | "processing"  // Running the workflow
    | "confirm";    // Reviewing results with retry/delete/confirm options

export class FluxKontextTool extends BaseTool implements Tool {
    readonly selectionTool: SelectionTool;
    
    private prompt: string = "";
    private _dirty = false;
    
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

    constructor(renderer: Renderer) {
        super(renderer, "flux-kontext");
        this.selectionTool = new SelectionTool(renderer);
        
        // Set fixed 1024x1024 selection with initial position
        this.selectionTool.updateArgs({
            ...this.selectionTool.getArgs(),
            selectionOverlay: {
                x: 0,
                y: 0,
                width: 1024,
                height: 1024
            },
            aspectRatio: { width: 1, height: 1 },
            size: 1024,
            outpaint: false,
            fixedSize: true  // Custom flag to disable size controls
        });
        
        this.state = "select";
    }

    get state(): FluxKontextToolState {
        return this._state;
    }

    set state(state: FluxKontextToolState) {
        this._state = state;
        this.stateHandler(state);
        // Show selection controls (arrows) when in confirm state, just like EnhanceTool
        this.selectionControlsListener(state === "confirm");
    }

    get dirty(): boolean {
        return this._dirty;
    }

    set dirty(dirty: boolean) {
        this._dirty = dirty;
        this.dirtyListener?.(dirty);
    }

    setPrompt(prompt: string) {
        this.prompt = prompt;
    }

    async submit() {
        this.dirty = true;
        this.notifyError(null);
        
        const selectionOverlay = this.renderer.getSelectionOverlay();
        
        if (!selectionOverlay || selectionOverlay.width === 0 || selectionOverlay.height === 0) {
            console.error("Invalid selection", selectionOverlay);
            this.notifyError("Please select an area first");
            return;
        }
        
        const encodedImage = this.renderer.getEncodedImage(selectionOverlay, "jpeg");
        
        if (!encodedImage) {
            console.error("No selection");
            this.notifyError("Failed to capture selection");
            return;
        }
        
        this.state = "processing";
        
        try {
            // Create a new workflow instance for each submit (like EnhanceTool does)
            const workflow = new FluxKontext(fluxKontextWorkflow);
            console.log("Starting FluxKontext workflow...");
            const imageUrl = await workflow.run(
                this.prompt, 
                encodedImage, 
                progress => {
                    console.log("Progress:", progress);
                    this.updateProgress(progress);
                }
            );
            console.log("Workflow completed, imageUrl:", imageUrl);
            
            // Load and store the result
            this.imageData.push(await this.loadImageData(imageUrl, selectionOverlay!));
            this.selectedImageDataIndex = this.imageData.length - 1;
            this.renderer.setEditImage(this.imageData[this.selectedImageDataIndex]);
            this.selectedImageData = this.imageData[this.selectedImageDataIndex];
            this.state = "confirm";
            
        } catch (err: unknown) {
            console.error("Error creating images", err);
            const errMessage = (err as any).response?.data?.message || (err as Error).message || "Failed to enhance image";
            this.notifyError(errMessage);
            this.state = "prompt";
        }
    }

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

    cancel() {
        this.imageData = [];
        this.selectedImageDataIndex = -1;
        this.selectedImageData = null;
        this.renderer.setEditImage(null);
        this.state = "select";
        this.dirty = false;
    }

    confirm() {
        if (this.selectedImageData) {
            const selectionOverlay = this.renderer.getSelectionOverlay();
            if (selectionOverlay) {
                this.renderer.commitSelection();
                const encodedImage = this.renderer.getEncodedImage(null, "png");
                if (encodedImage && this.saveListener) {
                    this.saveListener(encodedImage, "png");
                }
            }
        }
        this.cancel();
    }

    deleteSelected() {
        if (this.selectedImageDataIndex >= 0 && this.selectedImageDataIndex < this.imageData.length) {
            this.imageData.splice(this.selectedImageDataIndex, 1);
            
            if (this.imageData.length === 0) {
                this.selectedImageDataIndex = -1;
                this.selectedImageData = null;
                this.renderer.setEditImage(null);
                this.state = "prompt";
            } else {
                this.selectedImageDataIndex = Math.min(this.selectedImageDataIndex, this.imageData.length - 1);
                this.selectedImageData = this.imageData[this.selectedImageDataIndex];
                this.renderer.setEditImage(this.selectedImageData);
            }
        }
    }

    select(direction: "left" | "right") {
        if (this.imageData.length === 0) return;
        
        const delta = direction === "right" ? 1 : -1;
        this.selectedImageDataIndex = Math.max(0, Math.min(this.imageData.length - 1, this.selectedImageDataIndex + delta));
        this.selectedImageData = this.imageData[this.selectedImageDataIndex];
        this.renderer.setEditImage(this.selectedImageData);
    }

    continueToPrompt() {
        // Make sure we have a valid selection before continuing
        const selectionOverlay = this.renderer.getSelectionOverlay();
        if (!selectionOverlay || selectionOverlay.width === 0 || selectionOverlay.height === 0) {
            // Initialize default selection if none exists
            this.selectionTool.updateArgs({
                ...this.selectionTool.getArgs(),
                selectionOverlay: {
                    x: 0,
                    y: 0,
                    width: 1024,
                    height: 1024
                }
            });
        }
        this.state = "prompt";
    }

    backToSelection() {
        this.state = "select";
    }

    retry() {
        this.submit();
    }

    // Input delegation to SelectionTool when in select state
    onMouseDown(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (this.state === "select") {
            this.selectionTool.onMouseDown(event);
        }
    }

    onMouseMove(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (this.state === "select") {
            this.selectionTool.onMouseMove(event);
        }
    }

    onMouseUp(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (this.state === "select") {
            this.selectionTool.onMouseUp(event);
        }
    }

    onMouseLeave(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (this.state === "select") {
            this.selectionTool.onMouseLeave(event);
        }
    }

    onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
        if (this.state === "select") {
            this.selectionTool.onPointerDown(event);
        }
    }

    onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
        if (this.state === "select") {
            this.selectionTool.onPointerMove(event);
        }
    }

    onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
        if (this.state === "select") {
            this.selectionTool.onPointerUp(event);
        }
    }

    onTouchStart(event: React.TouchEvent<HTMLCanvasElement>) {
        if (this.state === "select") {
            this.selectionTool.onTouchStart(event);
        }
    }

    onTouchMove(event: React.TouchEvent<HTMLCanvasElement>) {
        if (this.state === "select") {
            this.selectionTool.onTouchMove(event);
        }
    }

    onTouchEnd(event: React.TouchEvent<HTMLCanvasElement>) {
        if (this.state === "select") {
            this.selectionTool.onTouchEnd(event);
        }
    }

    onKeyDown(event: KeyboardEvent) {
        if (this.state === "select") {
            this.selectionTool.onKeyDown(event);
        }
    }

    onKeyUp(event: KeyboardEvent) {
        if (this.state === "select") {
            this.selectionTool.onKeyUp(event);
        }
    }

    onWheel(event: WheelEvent) {
        if (this.state === "select") {
            this.selectionTool.onWheel(event);
        }
    }

    destroy(): boolean {
        this.cancel();
        return true;
    }

    // Listeners
    onChangeState(handler: (state: FluxKontextToolState) => void) {
        this.stateHandler = handler;
    }

    onShowSelectionControls(handler: (show: boolean) => void) {
        this.selectionControlsListener = handler;
    }

    onProgress(handler: (progress: number) => void) {
        this.progressListener = handler;
    }

    onError(handler: (error: string | null) => void) {
        this.errorListener = handler;
    }

    onDirty(handler: (dirty: boolean) => void) {
        this.dirtyListener = handler;
    }

    private updateProgress(progress: number) {
        this.progressListener?.(progress);
    }

    private notifyError(error: string | null) {
        this.errorListener?.(error);
    }

    getArgs() {
        return {
            ...this.selectionTool.getArgs()
        };
    }

    updateArgs(args: any) {
        // When the tool is activated, ensure selection is initialized
        if (!args.selectionOverlay || args.selectionOverlay.width === 0) {
            args = {
                ...args,
                selectionOverlay: {
                    x: 0,
                    y: 0,
                    width: 1024,
                    height: 1024
                },
                aspectRatio: { width: 1, height: 1 },
                size: 1024,
                outpaint: false
            };
        }
        this.selectionTool.updateArgs(args);
    }
}

interface ControlsProps {
    renderer: Renderer;
    tool: FluxKontextTool;
}

export const FluxKontextControls: FC<ControlsProps> = ({ tool }) => {
    const [prompt, setPrompt] = useCache("flux-kontext-prompt", "");
    const [state, setState] = useState<FluxKontextToolState>(tool.state);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        tool.onChangeState(setState);
        tool.onProgress(setProgress);
        tool.onError(setError);
        tool.setPrompt(prompt);
    }, [tool, prompt]);

    if (state === "select") {
        return (
            <div className="tool-controls">
                <div className="alert alert-info">
                    <i className="fas fa-info-circle me-2"></i>
                    Move the selection square to the area you want to enhance
                </div>
                
                <div className="mb-3">
                    <label className="form-label">Selection Size</label>
                    <div className="text-muted">1024×1024 (fixed)</div>
                </div>

                <button 
                    className="btn btn-primary w-100"
                    onClick={() => tool.continueToPrompt()}
                >
                    Continue
                </button>
            </div>
        );
    }

    if (state === "prompt") {
        return (
            <div className="tool-controls">
                <div className="alert alert-info">
                    <i className="fas fa-info-circle me-2"></i>
                    Describe how you want this area enhanced
                </div>

                <div className="mb-3">
                    <label htmlFor="flux-kontext-prompt" className="form-label">
                        Enhancement Prompt
                    </label>
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
                </div>

                {error && (
                    <div className="alert alert-danger">
                        <i className="fas fa-exclamation-triangle me-2"></i>
                        {error}
                    </div>
                )}

                <div className="d-flex gap-2">
                    <button 
                        className="btn btn-secondary flex-fill"
                        onClick={() => tool.backToSelection()}
                    >
                        <i className="fas fa-arrow-left me-2"></i>
                        Back
                    </button>
                    <button 
                        className="btn btn-primary flex-fill"
                        onClick={() => tool.submit()}
                        disabled={!prompt.trim()}
                    >
                        <i className="fas fa-sparkles me-2"></i>
                        Enhance
                    </button>
                </div>
            </div>
        );
    }

    if (state === "processing") {
        return (
            <div className="tool-controls">
                <div style={{ marginTop: "16px" }}>
                    <i className="fa fa-spinner fa-spin"></i>&nbsp;{" "}
                    Enhancing...
                    <br />
                    <ProgressBar progress={progress} />
                </div>
            </div>
        );
    }

    if (state === "confirm") {
        return (
            <div className="tool-controls">

                <div className="d-grid gap-2">
                    <button 
                        className="btn btn-success"
                        onClick={() => tool.confirm()}
                    >
                        <i className="fas fa-check me-2"></i>
                        Save to Image
                    </button>
                    
                    <button 
                        className="btn btn-primary"
                        onClick={() => tool.retry()}
                    >
                        <i className="fas fa-redo me-2"></i>
                        Retry
                    </button>
                    
                    <button 
                        className="btn btn-warning"
                        onClick={() => tool.deleteSelected()}
                    >
                        <i className="fas fa-trash me-2"></i>
                        Delete This Result
                    </button>
                    
                    <button 
                        className="btn btn-secondary"
                        onClick={() => tool.cancel()}
                    >
                        <i className="fas fa-times me-2"></i>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return null;
};