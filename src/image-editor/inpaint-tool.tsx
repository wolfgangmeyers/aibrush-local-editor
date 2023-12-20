import React, { FC, useState, useEffect } from "react";

import { Tool, BaseTool } from "./tool";
import { Renderer } from "./renderer";
import { SelectionTool } from "./selection-tool";
import { Rect } from "./models";
import { getClosestAspectRatio } from "../lib/aspecRatios";
import {
    ImageUtilWorker,
    loadImageDataElement,
} from "../lib/imageutil";
import moment from "moment";
import { ProgressBar } from "../components/ProgressBar";
import { Img2Img } from "../lib/workflows";

type InpaintToolState =
    | "select"
    | "erase"
    | "inpaint"
    | "uploading"
    | "processing"
    | "confirm"
    | undefined;

import inpaintingxl from "../workflows/inpaintingxl-api.json";

export class InpaintTool extends BaseTool implements Tool {
    private selectionTool: SelectionTool;
    private prompt: string = "";
    private negativePrompt: string = "";
    private count: number = 4;
    private brushSize: number = 10;
    private _dirty = false;
    private worker: ImageUtilWorker;
    private idCounter = 0;

    private _state: InpaintToolState;
    private stateHandler: (state: InpaintToolState) => void = () => { };
    private selectionControlsListener: (show: boolean) => void = () => { };

    private imageData: Array<ImageData> = [];
    private selectedImageDataIndex: number = -1;
    private selectedImageData: ImageData | null = null;
    private panning = false;
    private erasing = false;
    private progressListener?: (progress: number) => void;
    private errorListener?: (error: string | null) => void;
    private dirtyListener?: (dirty: boolean) => void;
    private savedEncodedMask?: string;

    set dirty(dirty: boolean) {
        this._dirty = dirty;
        if (this.dirtyListener) {
            this.dirtyListener(dirty);
        }
    }

    get dirty() {
        return this._dirty;
    }

    private newId(): string {
        return `${this.idCounter++}`;
    }

    onError(handler: (error: string | null) => void) {
        this.errorListener = handler;
    }

    private notifyError(error: string | null) {
        if (this.errorListener) {
            this.errorListener(error);
        }
    }

    get state(): InpaintToolState {
        return this._state;
    }

    set state(state: InpaintToolState) {
        if (state != this._state) {
            if (this._state == "select") {
                this.selectionTool.destroy();
            }
            if (this._state === "erase") {
                this.renderer.setCursor(undefined);
            }
            this._state = state;
            this.stateHandler(state);

            if (state == "confirm") {
                this.selectionControlsListener(true);
            } else {
                this.selectionControlsListener(false);
                if (state == "select") {
                    const imageWidth = this.renderer.getWidth();
                    const imageHeight = this.renderer.getHeight();
                    const selectionWidth = Math.min(
                        imageWidth,
                        imageHeight,
                        1024
                    );
                    this.selectionTool.updateArgs({
                        selectionOverlay: {
                            x: 0,
                            y: 0,
                            width: selectionWidth,
                            height: selectionWidth,
                        },
                    });
                }
            }
        }
    }

    selectSupported(): boolean {
        // return !(
        //     this.renderer.getWidth() == this.renderer.getHeight() &&
        //     getUpscaleLevel(
        //         this.renderer.getWidth(),
        //         this.renderer.getHeight()
        //     ) === 0
        // );
        return true;
    }

    constructor(renderer: Renderer) {
        super(renderer, "inpaint");
        this.selectionTool = new SelectionTool(renderer);
        if (this.selectSupported()) {
            this.state = "select";
            this.selectionTool.updateArgs({
                outpaint: this.getArgs().outpaint,
            });
        } else {
            this.state = "erase";
        }
        this.worker = new ImageUtilWorker();
    }

    onMouseDown(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (this.state == "select") {
            this.selectionTool.onMouseDown(event);
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
        if (this.state == "erase") {
            this.erasing = true;
            this.erasePoint(x, y);
        }
    }

    private erasePoint(x: number, y: number) {
        if (!this.dirty) {
            this.dirty = true;
        }
        this.renderer.erasePoint(x, y, this.brushSize);
        this.renderer.render();
    }

    private updateCursor(x: number, y: number) {
        if (this.state == "erase") {
            this.renderer.setCursor({
                color: "white",
                radius: this.brushSize / 2,
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

    onMouseMove(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        let { x, y } = this.zoomHelper.translateMouseToCanvasCoordinates(
            event.nativeEvent.offsetX,
            event.nativeEvent.offsetY
        );
        this.updateCursor(x, y);
        if (this.state == "select") {
            this.selectionTool.onMouseMove(event);
            return;
        }

        if (this.panning) {
            this.zoomHelper.onPan(event);
        }

        if (this.erasing) {
            this.erasePoint(x, y);
        }
    }

    onMouseUp(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (this.state == "select") {
            this.selectionTool.onMouseUp(event);
        }
        this.panning = false;
        this.erasing = false;
    }

    onMouseLeave(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>): void {
        if (this.state == "select") {
            this.selectionTool.onMouseLeave(event);
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
        super.updateArgs(args);
        this.prompt = args.prompt || "";
        this.negativePrompt = args.negativePrompt || "";
        this.count = args.count || 4;
        this.brushSize = args.brushSize || 10;

        this.updateCursor(
            this.renderer.getWidth() / 2,
            this.renderer.getHeight() / 2
        );
        this.selectionTool.updateArgs({
            outpaint: args.outpaint,
        });
    }

    onChangeState(handler: (state: InpaintToolState) => void) {
        this.stateHandler = handler;
    }

    onShowSelectionControls(listener: (show: boolean) => void): void {
        this.selectionControlsListener = listener;
    }

    onProgress(listener: (progress: number) => void): void {
        this.progressListener = listener;
    }

    private async loadImageData(
        imageDataUrl: string,
        alphaMask: ImageData,
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

        const id = this.newId();
        const resp = await this.worker.processRequest({
            id,
            alphaMode: "alpha",
            alphaPixels: alphaMask.data,
            feather: true,
            height: this.renderer.getHeight(),
            width: this.renderer.getWidth(),
            pixels: imageData.data,
            selectionOverlay,
            featherWidth: 10,
        });
        const updatedImageData = new ImageData(
            resp.pixels,
            imageData.width,
            imageData.height
        );
        // remove canvas
        canvas.remove();
        return updatedImageData;
    }

    cancel() {
        if (this.selectSupported()) {
            this.state = "select";
        } else {
            this.state = "erase";
        }
        this.renderer.snapshot();
        this.renderer.undo();
        this.renderer.clearRedoStack();
        this.imageData = [];
        this.renderer.setEditImage(null);
        this.dirty = false;
    }

    deleteSelected() {
        this.imageData.splice(this.selectedImageDataIndex, 1);
        if (this.selectedImageDataIndex >= this.imageData.length) {
            this.selectedImageDataIndex = this.imageData.length - 1;
        }
        if (this.imageData.length === 0) {
            this.state = "inpaint";
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
        this.notifyError(null);
        let selectionOverlay = this.renderer.getSelectionOverlay();
        if (!selectionOverlay) {
            console.error("No selection");
            return;
        }

        if (this.state === "inpaint") {
            this.imageData = [];
        }

        if (this.getArgs().outpaint) {
            // check if selection overlay is out of renderer bounds (width, height)
            if (
                selectionOverlay.x < 0 ||
                selectionOverlay.y < 0 ||
                selectionOverlay.x + selectionOverlay.width >
                this.renderer.getWidth() ||
                selectionOverlay.y + selectionOverlay.height >
                this.renderer.getHeight()
            ) {
                this.renderer.expandToOverlay();
                selectionOverlay = this.renderer.getSelectionOverlay()!;
            }
        }

        this.state = "uploading";
        this.updateProgress(0);

        // get the erased area, then undo the erase to get the original image
        const encodedMask = this.renderer.getEncodedMask("base");
        const maskData = this.renderer.getImageData(selectionOverlay);
        if (!maskData || !encodedMask) {
            console.error("Failed to get mask data");
            return;
        }
        // hack to restore the image
        this.renderer.snapshot();
        this.renderer.undo();
        this.renderer.clearRedoStack();

        const encodedImage = this.renderer.getEncodedImage(
            selectionOverlay,
            "webp"
        );
        if (!encodedImage) {
            console.error("Failed to get encoded image");
            return;
        }

        const workflow: Img2Img = new Img2Img(inpaintingxl, Math.random(), 1);
        workflow.set_seed(Math.floor(Math.random() * 1000000000));


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
            this.state = "inpaint";
            return;
        }

        this.imageData.push(await this.loadImageData(imageUrl, maskData, selectionOverlay!));
        if (this.imageData.length === 0) {
            this.state = "inpaint";
            this.notifyError("No images returned");
            return;
        }
        this.selectedImageDataIndex = this.imageData.length - 1;
        this.renderer.setEditImage(this.imageData[this.selectedImageDataIndex]);
        this.selectedImageData = this.imageData[this.selectedImageDataIndex];
        this.state = "confirm";
    }

    onDirty(listener: (dirty: boolean) => void): void {
        this.dirtyListener = listener;
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

        this.imageData = [];
        const encodedImage = this.renderer.getEncodedImage(null, "png");
        if (encodedImage && this.saveListener) {
            this.saveListener(encodedImage, "png");
        }
        this.dirty = false;
        if (this.selectSupported()) {
            this.state = "select";
        } else {
            this.state = "erase";
        }
    }

    destroy(): boolean {
        if (this.dirty) {
            if (!window.confirm("Discard changes?")) {
                return false;
            }
        }
        this.renderer.setCursor(undefined);
        this.renderer.setEditImage(null);
        this.worker.destroy();
        return true;
    }
}

interface ControlsProps {
    renderer: Renderer;
    tool: InpaintTool;
}

const defaultPrompt = "A cute squirrel playing a banjo";
const defaultNegativePrompt = "low quality, distorted, deformed, dull, boring, plain, ugly, noise";

export const InpaintControls: FC<ControlsProps> = ({
    tool,
}) => {
    const [count, setCount] = useState(4);
    const [prompt, setPrompt] = useState(defaultPrompt);
    const [negativePrompt, setNegativePrompt] = useState(defaultNegativePrompt);
    const [state, setState] = useState<InpaintToolState>(tool.state);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [brushSize, setBrushSize] = useState(10);
    const [dirty, setDirty] = useState(false);
    const [outpaint, setoutpaint] = useState<boolean | undefined>(
        tool.getArgs().outpaint
    );

    useEffect(() => {
        tool.updateArgs({
            brushSize,
        });
    }, [brushSize]);

    tool.onChangeState(setState);
    tool.onProgress(setProgress);
    tool.onError(setError);
    tool.onDirty(setDirty);

    if (state === "uploading" || state === "processing") {
        return (
            <div style={{ marginTop: "16px" }}>
                <i className="fa fa-spinner fa-spin"></i>&nbsp;{" "}
                {state === "uploading" ? "Uploading..." : "Inpainting..."}
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
                        selection rectangle to the area that you want to
                        inpaint. For outpainting, try zooming out.
                    </p>
                    <div className="form-group">
                        {/* allow outpaint checkbox */}
                        <div className="form-check">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="allowoutpaint"
                                checked={!!outpaint}
                                onChange={(e) => {
                                    setoutpaint(e.target.checked);
                                    tool.updateArgs({
                                        outpaint: e.target.checked,
                                    });
                                }}
                            />
                            <label
                                className="form-check-label"
                                htmlFor="allowoutpaint"
                            >
                                Allow outpainting
                            </label>
                        </div>
                    </div>
                </>
            )}

            {state === "erase" && (
                <>
                    <p>
                        {/* info icon */}
                        <i className="fa fa-info-circle"></i>&nbsp; Erase the
                        area that you want to inpaint.
                    </p>
                    <div className="form-group">
                        <label style={{ width: "100%" }}>
                            Brush size
                            <small
                                className="form-text text-muted"
                                style={{ float: "right" }}
                            >
                                {brushSize}px
                            </small>
                        </label>
                        <input
                            type="range"
                            className="form-control-range"
                            min="1"
                            max="100"
                            value={brushSize}
                            onChange={(e) =>
                                setBrushSize(parseInt(e.target.value))
                            }
                        />
                    </div>
                </>
            )}

            {state === "inpaint" && (
                <>
                    <p>
                        {/* info icon */}
                        <i className="fa fa-info-circle"></i>&nbsp; Confirm the
                        parameters below and continue
                    </p>
                    <div className="form-group">
                        <label htmlFor="prompt">
                            Prompt&nbsp;
                        </label>
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
                        <label htmlFor="negativeprompt">
                            Negative prompt
                        </label>
                        <input
                            type="text"
                            className="form-control"
                            value={negativePrompt}
                            onChange={(e) => {
                                setNegativePrompt(e.target.value);
                            }}
                        />
                        <small className="form-text text-muted">
                            Customize the negative text prompt here
                        </small>
                    </div>
                </>
            )}

            {state === "confirm" && (
                <>
                    <p>
                        Use the <i className="fa fa-arrow-left"></i> and{" "}
                        <i className="fa fa-arrow-right"></i> buttons to
                        navigate between the inpaint options
                    </p>
                </>
            )}

            <div className="form-group">
                {(dirty ||
                    state === "confirm" ||
                    (state == "erase" && tool.selectSupported()) ||
                    state == "inpaint") && (
                        <button
                            style={{ marginRight: "8px" }}
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                                tool.cancel();
                            }}
                        >
                            {/* cancel icon */}
                            <i className="fa fa-times"></i>&nbsp; Revert
                        </button>
                    )}

                {/* TODO: save/restore mask (or alternative) on retry */}
                {/* {state === "confirm" && (
                    <>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => tool.submit()}
                            style={{ marginRight: "8px" }}
                        >
                            <i className="fa fa-redo"></i>&nbsp; Retry
                        </button>
                    </>
                )} */}
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

                {state === "confirm" && (
                    <>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => tool.confirm()}
                            style={{ marginRight: "8px" }}
                        >
                            {/* save icon */}
                            <i className="fa fa-save"></i>&nbsp; Save
                        </button>
                    </>
                )}
                {state == "select" && (
                    <button
                        style={{ marginRight: "8px" }}
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => (tool.state = "erase")}
                    >
                        <i className="fa fa-eraser"></i>&nbsp; Continue
                    </button>
                )}
                {state == "erase" && (
                    <button
                        style={{ marginRight: "8px" }}
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => (tool.state = "inpaint")}
                    >
                        <i className="fa fa-paint-brush"></i>&nbsp; Continue
                    </button>
                )}
                {state === "inpaint" && (
                    <button
                        style={{ marginRight: "8px" }}
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                            tool.updateArgs({
                                count,
                                prompt,
                                negativePrompt,
                            });
                            tool.submit();
                        }}
                    >
                        {/* paint icon */}
                        <i className="fa fa-paint-brush"></i>&nbsp; Inpaint
                    </button>
                )}
            </div>
        </div>
    );
};
