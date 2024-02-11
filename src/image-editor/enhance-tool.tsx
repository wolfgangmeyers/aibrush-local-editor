import React, { FC, useEffect, useState } from "react";

import { Tool, BaseTool } from "./tool";
import { Renderer } from "./renderer";
import {
    ImageUtilWorker,
    applyAlphaMask,
    featherEdges,
    loadImageDataElement,
} from "../lib/imageutil";
import { SelectionTool, Controls as SelectionControls } from "./selection-tool";
import { ProgressBar } from "../components/ProgressBar";
import { PencilTool } from "./pencil-tool";
import { MaskEditor } from "./mask-editor-controls";
import { Rect } from "./models";
import { Img2Img } from "../lib/workflows";

// import img2img from "../workflows/dreamshaper_img2img64_api.json";
// import img2imgmask from "../workflows/dreamshaper_img2img64_mask_api.json";
import img2imgmaskipadapter from "../workflows/dreamshaper_img2img64_mask_ipadapter_api.json";
import { useCache } from "../lib/cache";
import { fetcher } from "../lib/comfyfetcher";
import { LoraSelector } from "../components/LoraSelector";
import { SelectedLora } from "../lib/loras";
import { SelectedLoraTag } from "../components/SelectedLora";


type EnhanceToolState =
    | "select"
    | "default"
    | "uploading"
    | "processing"
    | "confirm"
    | "erase"
    | "mask";

// eraser width modifier adds a solid core with a feather edge
// equal to the what is used on enhanced selections
const eraserWidthModifier = 1.3;

export class EnhanceTool extends BaseTool implements Tool {
    readonly selectionTool: SelectionTool;
    readonly pencilTool: PencilTool;

    private prompt: string = "";
    private negativePrompt: string = "";
    private variationStrength: number = 0.35;
    private _dirty = false;
    private worker: ImageUtilWorker;
    private idCounter = 0;

    private _state: EnhanceToolState = "default";
    private stateHandler: (state: EnhanceToolState) => void = () => { };
    private selectionControlsListener: (show: boolean) => void = () => { };
    private maskHandler: (isMasked: boolean) => void = () => { };

    private imageData: Array<ImageData> = [];
    private selectedImageDataIndex: number = -1;
    private selectedImageData: ImageData | null = null;
    private panning = false;
    private erasing = false;
    private progressListener?: (progress: number) => void;
    private errorListener?: (error: string | null) => void;
    private dirtyListener?: (dirty: boolean) => void;
    private savedEncodedMask?: string;
    private referenceImagesWeight = 1;
    private selectedLoras: SelectedLora[] = [];
    private selectedModel: string = "dreamshaperXL_turboDpmppSDE.safetensors";

    set dirty(dirty: boolean) {
        this._dirty = dirty;
        if (this.dirtyListener) {
            this.dirtyListener(dirty);
        }
    }

    get dirty() {
        return this._dirty;
    }

    onDirty(listener: (dirty: boolean) => void): void {
        this.dirtyListener = listener;
    }

    onError(handler: (error: string | null) => void) {
        this.errorListener = handler;
    }

    private notifyError(error: string | null) {
        if (this.errorListener) {
            this.errorListener(error);
        }
    }

    get state(): EnhanceToolState {
        return this._state;
    }

    set state(state: EnhanceToolState) {
        if (state !== this._state) {
            this.renderer.setCursor(undefined);
            if (this._state == "select") {
                this.selectionTool.destroy();
            }
            // if (this._state === "mask") {
            //     this.renderer.setCursor(undefined);
            // }
            // if (this._state === "erase") {
            //     this.renderer.setCursor(undefined);
            // }
            this._state = state;
            this.stateHandler(state);
            if (state == "confirm") {
                this.selectionControlsListener(true);
            } else {
                this.selectionControlsListener(false);
                if (state == "select") {
                    this.selectionTool.updateArgs({
                        ...this.selectionTool.getArgs(),
                        outpaint: false,
                    });
                }
            }
        }
    }

    constructor(renderer: Renderer) {
        super(renderer, "enhance");
        this.selectionTool = new SelectionTool(renderer);
        this.pencilTool = new PencilTool(
            renderer,
            "mask",
            "#FFFFFF",
            "mask-editor"
        );
        this.state = "select";
        let selectionArgs = this.selectionTool.getArgs();
        this.selectionTool.updateArgs(selectionArgs);
        this.pencilTool.updateArgs({
            ...this.pencilTool.getArgs(),
            brushColor: "#FFFFFF",
        });
        // unset the cursor from the pencil tool (hack)
        this.renderer.setCursor(undefined);
        this.worker = new ImageUtilWorker();
    }

    onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
        if (this.state == "select") {
            this.selectionTool.onMouseDown(event);
            return;
        }
        if (this.state == "mask") {
            this.pencilTool.onPointerDown(event);
            return;
        }
        let { x, y } = this.zoomHelper.translateMouseToCanvasCoordinates(
            event.nativeEvent.offsetX,
            event.nativeEvent.offsetY
        );
        if (event.button === 1) {
            this.panning = true;
            return;
        }
        if (this.state == "erase" && this.selectedImageData) {
            this.erasing = true;
            // clone selected ImageData
            this.selectedImageData = new ImageData(
                this.selectedImageData.data.slice(),
                this.selectedImageData.width,
                this.selectedImageData.height
            );

            this.erasePoint(x, y);
        }
    }

    private erasePoint(x: number, y: number) {
        const selectionOverlay = this.renderer.getSelectionOverlay()!;
        const baseWidth = Math.min(
            selectionOverlay.width,
            selectionOverlay.height
        );
        const eraserRadius = Math.floor((baseWidth / 8) * eraserWidthModifier);

        const relX = x - selectionOverlay.x;
        const relY = y - selectionOverlay.y;
        const imageData = this.selectedImageData!;

        const startX = Math.max(0, relX - eraserRadius);
        const startY = Math.max(0, relY - eraserRadius);
        const endX = Math.min(imageData.width, relX + eraserRadius);
        const endY = Math.min(imageData.height, relY + eraserRadius);

        // relX=64.28541697636388, relY=64.24464312259761, startX=0.28541697636387653, startY=0.24464312259760845, endX=128.28541697636388, endY=128.2446431225976

        for (let i = startX; i < endX; i++) {
            for (let j = startY; j < endY; j++) {
                const index = (j * imageData.width + i) * 4;
                const distance = Math.sqrt(
                    Math.pow(i - relX, 2) + Math.pow(j - relY, 2)
                );
                if (distance < eraserRadius) {
                    // set alpha to a linear gradient from the center,
                    // 100% in the middle and 0% at the edge
                    const alphaPct =
                        (distance / eraserRadius) * eraserWidthModifier -
                        (eraserWidthModifier - 1);

                    const alpha = Math.min(
                        Math.floor(alphaPct * 255),
                        imageData.data[index + 3]
                    );
                    imageData.data[index + 3] = alpha;
                }
            }
        }
        this.renderer.setEditImage(imageData);
    }

    private updateCursor(x: number, y: number) {
        if (this.state == "erase" && this.selectedImageData) {
            const selectionOverlay = this.renderer.getSelectionOverlay()!;
            const baseWidth = Math.min(
                selectionOverlay.width,
                selectionOverlay.height
            );
            const featherWidth = Math.floor(baseWidth / 8);
            this.renderer.setCursor({
                color: "white",
                radius: featherWidth * eraserWidthModifier,
                type: "circle",
                x,
                y,
            });
        } else {
            this.renderer.setCursor({
                color: "white",
                radius: 10,
                type: "crosshairs",
                x,
                y,
            });
        }
    }

    onMouseMove(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>): void { }
    onMouseDown(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>): void { }
    onMouseUp(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>): void { }

    onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
        if (this.state == "select") {
            this.selectionTool.onMouseMove(event);
            return;
        }
        if (this.state == "mask") {
            this.pencilTool.onPointerMove(event);
            return;
        }
        let { x, y } = this.zoomHelper.translateMouseToCanvasCoordinates(
            event.nativeEvent.offsetX,
            event.nativeEvent.offsetY
        );
        if (this.panning) {
            this.zoomHelper.onPan(event);
        }

        this.updateCursor(x, y);
        if (this.erasing) {
            this.erasePoint(x, y);
        }
    }

    onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
        if (this.state == "select") {
            this.selectionTool.onMouseUp(event);
        }
        if (this.state == "mask") {
            this.pencilTool.onPointerUp(event);
        }
        this.panning = false;
        this.erasing = false;
    }

    onMouseLeave(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>): void {
        if (this.state == "select") {
            this.selectionTool.onMouseLeave(event);
        }
        if (this.state == "mask") {
            this.pencilTool.onMouseLeave(event);
        }
        this.panning = false;
        this.erasing = false;
    }

    onWheel(event: WheelEvent) {
        this.zoomHelper.onWheel(event);
        let { x, y } = this.zoomHelper.translateMouseToCanvasCoordinates(
            event.offsetX,
            event.offsetY
        );
        this.updateCursor(x, y);
    }

    updateArgs(args: any) {
        args = {
            ...this.getArgs(),
            ...args,
        };
        this.prompt = args.prompt || "";
        this.negativePrompt = args.negativePrompt || "";
        this.variationStrength = args.variationStrength || 0.75;
        this.referenceImagesWeight = args.referenceImagesWeight || 1;
        this.selectedLoras = JSON.parse(JSON.stringify(args.selectedLoras || []));
        this.selectedModel = args.selectedModel || "dreamshaperXL_turboDpmppSDE.safetensors";
    }

    onChangeState(handler: (state: EnhanceToolState) => void) {
        this.stateHandler = handler;
    }

    onChangeMask(handler: (isMasked: boolean) => void) {
        this.maskHandler = handler;
    }

    onShowSelectionControls(listener: (show: boolean) => void): void {
        this.selectionControlsListener = listener;
    }

    onProgress(listener: (progress: number) => void): void {
        this.progressListener = listener;
    }

    private newId(): string {
        return `${this.idCounter++}`;
    }

    private async loadImageData(
        imageDataUrl: string,
        maskData: ImageData | undefined,
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
            0,
            0,
            selectionOverlay.width,
            selectionOverlay.height
        );
        const imageData = ctx.getImageData(
            0,
            0,
            selectionOverlay.width,
            selectionOverlay.height
        );
        if (maskData) {
            applyAlphaMask(imageData, maskData, true);
        } else {
            featherEdges(selectionOverlay, this.renderer.getWidth(), this.renderer.getHeight(), imageData);
        }

        return imageData;
    }

    cancel() {
        if (this.state == "erase") {
            this.state = "confirm";
            this.selectedImageData =
                this.imageData[this.selectedImageDataIndex];
            this.renderer.setEditImage(this.selectedImageData);
        } else {
            this.state = "select";
            this.imageData = [];
            this.renderer.setEditImage(null);
            this.dirty = false;
        }
    }

    erase() {
        this.state = "erase";
    }

    mask() {
        if (this.renderer.isMasked()) {
            this.renderer.deleteMask();
        }
        this.renderer.createMask();
        this.state = "mask";
        this.maskHandler(true);
    }

    deleteMask() {
        this.renderer.deleteMask();
        if (this.state == "mask") {
            this.state = "default";
        }
        this.maskHandler(false);
    }

    async restoreMask() {
        if (this.savedEncodedMask) {
            this.renderer.createMask();
            await this.renderer.setEncodedMask(this.savedEncodedMask, "webp");
            this.state = "mask";
            this.maskHandler(true);
        }
    }

    deleteSelected() {
        this.imageData.splice(this.selectedImageDataIndex, 1);
        if (this.selectedImageDataIndex >= this.imageData.length) {
            this.selectedImageDataIndex = this.imageData.length - 1;
        }
        if (this.imageData.length === 0) {
            this.state = "default";
            this.renderer.setEditImage(null);
        } else {
            this.renderer.setEditImage(this.imageData[this.selectedImageDataIndex]);
        }
    }

    private updateProgress(progress: number) {
        if (this.progressListener) {
            this.progressListener(progress);
        }
    }

    async submit() {
        if (this.state === "default") {
            this.imageData = [];
            this.savedEncodedMask = undefined;
        }
        if (this.savedEncodedMask) {
            await this.restoreMask();
        }
        this.dirty = true;
        this.notifyError(null);
        const selectionOverlay = this.renderer.getSelectionOverlay();
        let encodedImage = this.renderer.getEncodedImage(
            selectionOverlay!,
            "jpeg"
        );
        if (!encodedImage) {
            console.error("No selection");
            return;
        }
        let encodedMask: string | undefined;
        let maskData: ImageData | undefined;
        if (this.renderer.isMasked()) {
            encodedMask = this.renderer.getEncodedMask(
                "mask"
            );
            this.savedEncodedMask = encodedMask;
            maskData = this.renderer.getImageData(selectionOverlay!, "mask");
        }
        let workflow: Img2Img;
        const referenceImages = this.renderer.getEncodedReferenceImages();
        workflow = new Img2Img(img2imgmaskipadapter);
        if (referenceImages.length > 0) {
            workflow.set_reference_images(referenceImages);
            workflow.set_reference_images_weight(this.referenceImagesWeight);
        }
        if (this.selectedLoras.length > 0) {
            workflow.set_selected_loras(this.selectedLoras);
        }
        workflow.set_seed(Math.floor(Math.random() * 1000000000));
        workflow.set_denoise(this.variationStrength);
        workflow.set_selected_model(this.selectedModel);

        console.log("workflow", workflow);

        this.state = "processing";
        let imageUrl: string;

        try {
            imageUrl = await workflow.run(this.prompt, this.negativePrompt, encodedImage, encodedMask, progress => this.updateProgress(progress))
        } catch (err: any) {
            console.error("Error creating images", err);
            const errMessage =
                err.response?.data?.message ||
                err.message ||
                "Failed to create image";
            this.notifyError(errMessage);
            this.state = "default";
            return;
        }

        this.imageData.push(await this.loadImageData(imageUrl, maskData, selectionOverlay!));
        if (this.imageData.length === 0) {
            this.state = "default";
            this.notifyError("No images returned");
            return;
        }
        this.selectedImageDataIndex = this.imageData.length - 1;
        this.renderer.setEditImage(this.imageData[this.selectedImageDataIndex]);
        this.selectedImageData = this.imageData[this.selectedImageDataIndex];
        this.state = "confirm";
        this.deleteMask();
    }

    select(direction: "left" | "right") {
        if (direction == "left") {
            this.selectedImageDataIndex--;
            if (this.selectedImageDataIndex < -1) {
                this.selectedImageDataIndex = this.imageData.length - 1;
            }
        }
        if (direction == "right") {
            this.selectedImageDataIndex++;
            if (this.selectedImageDataIndex >= this.imageData.length) {
                this.selectedImageDataIndex = -1;
            }
        }
        if (this.selectedImageDataIndex === -1) {
            this.selectedImageData = null;
        } else {
            this.selectedImageData =
                this.imageData[this.selectedImageDataIndex];
        }
        this.renderer.setEditImage(this.selectedImageData);
    }

    onSaveImage(listener: (encodedImage: string, args?: any) => void): void {
        this.saveListener = listener;
    }

    confirm() {
        this.renderer.commitSelection();
        this.state = "select";
        this.imageData = [];
        const encodedImage = this.renderer.getEncodedImage(null, "png");
        if (encodedImage && this.saveListener) {
            this.saveListener(encodedImage, "png");
        }
        this.dirty = false;
    }

    destroy(): boolean {
        if (this.renderer.isMasked()) {
            this.renderer.deleteMask();
        }
        this.renderer.setCursor(undefined);
        this.worker.destroy();
        return true;
    }
}

interface ControlsProps {
    renderer: Renderer;
    tool: EnhanceTool;
}

const defaultPrompt = "A cute squirrel playing a banjo";
const defaultNegativePrompt = "low quality, distorted, deformed, dull, boring, plain, ugly, noise";

export const EnhanceControls: FC<ControlsProps> = ({
    renderer,
    tool,
}) => {
    const [variationStrength, setVariationStrength] = useCache("denoise", 0.5);
    const [prompt, setPrompt] = useCache("prompt", defaultPrompt);
    const [negativePrompt, setNegativePrompt] = useCache(
        "negative-prompt",
        defaultNegativePrompt
    );
    const [state, setState] = useState<EnhanceToolState>(tool.state);
    const [isMasked, setIsMasked] = useState<boolean>(tool.renderer.isMasked());
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [referenceImagesWeight, setReferenceImagesWeight] = useCache("reference-images-weight", 1);
    const [loras, setLoras] = useState<string[]>([]);
    const [models, setModels] = useState<string[]>([]);
    const [selectedLoras, setSelectedLoras] = useCache<SelectedLora[]>("selected-loras", []);
    const [selectingLoras, setSelectingLoras] = useState(false);
    const [selectedModel, setSelectedModel] = useCache("selected-model", "dreamshaperXL_turboDpmppSDE.safetensors");

    const hasReferenceImages = renderer.referencImageCount() > 0;


    tool.onChangeState(setState);
    tool.onChangeMask(setIsMasked);
    tool.onProgress(setProgress);
    tool.onError(setError);

    useEffect(() => {
        fetcher.fetch_object_info().then(objectInfo => {
            setLoras(objectInfo.LoraLoader.input.required.lora_name[0]);
            setModels(objectInfo.CheckpointLoaderSimple.input.required.ckpt_name[0]);
        })
    }, []);

    if (state == "processing" || state == "uploading") {
        return (
            <div style={{ marginTop: "16px" }}>
                <i className="fa fa-spinner fa-spin"></i>&nbsp;{" "}
                {state === "processing" ? "Enhancing..." : "Uploading..."}
                <br />
                <ProgressBar progress={progress} />
            </div>
        );
    }

    return (
        <div
            style={{
                marginTop: "16px",
                marginBottom: "8px",
                marginLeft: "16px",
            }}
        >
            {error && (
                <div className="alert alert-danger" role="alert">
                    {/* dismiss button */}
                    <button
                        type="button"
                        className="close"
                        data-dismiss="alert"
                        aria-label="Close"
                        onClick={() => setError(null)}
                    >
                        <span aria-hidden="true">&times;</span>
                    </button>
                    {error}
                </div>
            )}
            {state === "select" && (
                <>
                    <p>
                        {/* info icon */}
                        <i className="fa fa-info-circle"></i>&nbsp; Move the
                        selection rectangle to the area that you want to enhance
                    </p>
                    <SelectionControls
                        renderer={renderer}
                        tool={tool.selectionTool}
                        lockAspectRatio={true}
                    />
                </>
            )}
            {state === "default" && (
                <>
                    <p>
                        {/* info icon */}
                        <i className="fa fa-info-circle"></i>&nbsp; Confirm the
                        parameters below and continue
                    </p>
                    {/* prompt */}
                    <div className="form-group">
                        <label htmlFor="prompt">
                            Prompt&nbsp;
                        </label>
                        {/* refresh icon */}

                        <input
                            type="text"
                            className="form-control"
                            id="prompt"
                            value={prompt}
                            onChange={(e) => {
                                setPrompt(e.target.value);
                            }}
                        />

                        <small className="form-text text-muted">
                            Customize the text prompt here
                        </small>
                    </div>
                    {/* negative prompt */}
                    <div className="form-group">
                        <label htmlFor="negative-prompt">
                            Negative Prompt&nbsp;
                        </label>
                        <input
                            type="text"
                            className="form-control"
                            id="negative-prompt"
                            value={negativePrompt}
                            onChange={(e) => {
                                setNegativePrompt(e.target.value);
                            }}
                        />
                        <small className="form-text text-muted">
                            Customize the negative text prompt here
                        </small>
                    </div>
                    <div className="form-group">
                        <label htmlFor="variation-strength">
                            Variation Strength:{" "}
                            {Math.round(variationStrength * 100)}%
                        </label>
                        <input
                            type="range"
                            className="form-control-range"
                            id="variation-strength"
                            min="0"
                            max="1"
                            step="0.05"
                            value={variationStrength}
                            onChange={(e) => {
                                setVariationStrength(
                                    parseFloat(e.target.value)
                                );
                            }}
                        />
                        <small className="form-text text-muted">
                            How much variation to use
                        </small>
                    </div>
                    {/* loras */}
                    <div className="form-group">
                        <label htmlFor="loras">Loras</label>
                        {selectedLoras.map(lora => (
                            <SelectedLoraTag key={`selected-lora-${lora}`} lora={lora} onRemove={(lora) => setSelectedLoras(selectedLoras => selectedLoras.filter(selectedLora => selectedLora.name !== lora.name))} />
                        ))}
                        <button style={{marginTop: "8px"}} className="btn btn-primary btn-sm form-control" onClick={() => setSelectingLoras(true)}>
                            <i className="fas fa-plus" />&nbsp;Add
                        </button>
                    </div>
                    {/* model */}
                    <div className="form-group">
                        {/* dropdown */}
                        <label htmlFor="model">Model</label>
                        <select
                            className="form-control"
                            id="model"
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                        >
                            {models.map((model) => (
                                <option key={model} value={model}>
                                    {model}
                                </option>
                            ))}
                        </select>
                    </div>
                    {/* if we have reference images, allow the user to set the strength */}
                    {hasReferenceImages && (
                        <div className="form-group">
                            <label htmlFor="reference-images-weight">
                                Reference Images Weight:{" "}
                                {Math.round(referenceImagesWeight * 100)}%
                            </label>
                            <input
                                type="range"
                                className="form-control-range"
                                id="reference-images-weight"
                                min="0"
                                max="1"
                                step="0.05"
                                value={referenceImagesWeight}
                                onChange={(e) => {
                                    setReferenceImagesWeight(
                                        parseFloat(e.target.value)
                                    );
                                }}
                            />
                            <small className="form-text text-muted">
                                How much to use the reference images
                            </small>
                        </div>
                    )}
                </>
            )}
            {state === "erase" && (
                <p>
                    {/* info icon */}
                    <i className="fa fa-info-circle"></i>&nbsp; Erase any
                    undesired sections before saving
                </p>
            )}
            {state === "mask" && (
                <MaskEditor
                    onConfirm={() => (tool.state = "default")}
                    onRevert={() => {
                        tool.deleteMask();
                    }}
                    tool={tool.pencilTool}
                />
            )}

            <div className="form-group">
                {state === "select" && (
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                            tool.state = "default";
                        }}
                        style={{ marginRight: "8px" }}
                    >
                        {/* magic icon */}
                        <i className="fa fa-magic"></i>&nbsp; Continue
                    </button>
                )}
                {(state === "default" ||
                    state === "confirm" ||
                    state === "erase") && (
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                                tool.cancel();
                            }}
                            style={{ marginRight: "8px" }}
                        >
                            {/* cancel icon */}
                            <i className="fa fa-times"></i>&nbsp; Revert
                        </button>
                    )}
                {(state === "confirm" || state === "erase") && (
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => tool.confirm()}
                        style={{ marginRight: "8px" }}
                    >
                        <i className="fa fa-save"></i>&nbsp; Save
                    </button>
                )}
                {state === "confirm" && (
                    <>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => tool.erase()}
                            style={{ marginRight: "8px" }}
                        >
                            <i className="fa fa-eraser"></i>&nbsp; Erase
                        </button>
                    </>
                )}
                {state === "confirm" && (
                    <>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                                tool.updateArgs({
                                    variationStrength,
                                    prompt,
                                    negativePrompt,
                                    referenceImagesWeight,
                                    selectedLoras: JSON.parse(JSON.stringify(selectedLoras)),
                                    selectedModel,
                                });
                                tool.submit();
                            }}
                            style={{ marginRight: "8px" }}
                        >
                            {/* retry button */}
                            <i className="fa fa-redo"></i>&nbsp; Retry
                        </button>
                    </>
                )}
                {state === "confirm" && (
                    <>
                        <button
                            className="btn btn-danger btn-sm"
                            onClick={() => tool.deleteSelected()}
                            style={{ marginRight: "8px" }}
                        >
                            {/* delete button */}
                            <i className="fa fa-trash"></i>&nbsp; Delete
                        </button>
                    </>
                )}
                {state === "default" && (
                    <>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                                tool.updateArgs({
                                    variationStrength,
                                    prompt,
                                    negativePrompt,
                                    referenceImagesWeight,
                                    selectedLoras: JSON.parse(JSON.stringify(selectedLoras)),
                                    selectedModel,
                                });
                                tool.submit();
                            }}
                            style={{ marginRight: "8px" }}
                        >
                            <i className="fa fa-magic"></i>&nbsp; Enhance
                        </button>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => tool.mask()}
                            style={{ marginRight: "8px" }}
                        >
                            <i className="fa fa-cut"></i>&nbsp; Mask
                        </button>
                        {isMasked && (
                            <button
                                className="btn btn-danger btn-sm"
                                onClick={() => tool.deleteMask()}
                                style={{ marginRight: "8px" }}
                            >
                                <i className="fa fa-cut"></i>&nbsp; Unmask
                            </button>
                        )}
                    </>
                )}
            </div>
            {selectingLoras && <LoraSelector
                loras={loras}
                onClose={() => setSelectingLoras(false)}
                onSelect={(selected) => {
                    setSelectedLoras(selectedLoras => [...selectedLoras, selected]);
                    setSelectingLoras(false);
                }}
                selectedLoras={selectedLoras.map(lora => lora.name)}
            />}
        </div>
    );
};
