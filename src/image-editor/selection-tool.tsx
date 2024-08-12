import React, { useState, useEffect } from "react";
import { Renderer } from "./renderer";
import { Rect } from "./models";
import { Tool, BaseTool } from "./tool";
import { AspectRatioSelector } from "../components/AspectRatioSelector";
import {
    DEFAULT_ASPECT_RATIO,
    aspectRatios,
    getClosestAspectRatio,
} from "../lib/aspecRatios";
import { useCache } from "../lib/cache";

export class SelectionTool extends BaseTool implements Tool {
    private selectionOverlay: Rect | undefined;
    private selectionOverlayPreview: Rect | undefined;
    private outpaint?: boolean;

    private selectionOverlayPreviewListener?: (selectionOverlay: Rect) => void;

    onSelectionOverlayPreview(
        listener: (selectionOverlay: Rect) => void
    ): void {
        this.selectionOverlayPreviewListener = listener;
    }

    // private selectionWidth: number = 512;
    // private selectionHeight: number = 512;

    private panning = false;

    // TODO: size modifier to make the selection overlay smaller

    constructor(renderer: Renderer) {
        super(renderer, "select");
    }

    updateArgs(args: any) {
        args = {
            ...this.getArgs(),
            ...args,
        }
        super.updateArgs(args);
        this.selectionOverlay = args.selectionOverlay || {
            x: 0,
            y: 0,
            width: 1024,
            height: 1024,
        };
        this.outpaint = args.outpaint;
        if (!this.outpaint) {
            this.selectionOverlay = this.clamp(this.selectionOverlay!);
        }
        this.sync();
    }

    private clamp(rect: Rect): Rect {
        const imageWidth = this.renderer.getWidth();
        const imageHeight = this.renderer.getHeight();
        let x = rect.x;
        let y = rect.y;
        let width = rect.width;
        let height = rect.height;
        // clamp to the canvas
        x = Math.max(0, Math.min(x, imageWidth - this.selectionOverlay!.width));
        y = Math.max(0, Math.min(y, imageHeight - rect.height));
        x = Math.min(x, imageWidth - rect.width);
        y = Math.min(y, imageHeight - rect.height);
        width = Math.min(width, imageWidth);
        height = Math.min(height, imageHeight);
        return {
            x: x,
            y: y,
            width: width,
            height: height,
        };
    }

    private sync(): void {
        this.renderer.setSelectionOverlay(this.selectionOverlay);
        this.renderer.setSelectionOverlayPreview(this.selectionOverlayPreview);
    }

    onMouseDown(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (event.type == "touch") {
            this.onMouseMove(event);
        } else if (event.button === 0) {
            this.selectionOverlay = this.selectionOverlayPreview;
            this.selectionOverlayPreview = undefined;
            this.sync();
            this.updateArgs({
                selectionOverlay: this.selectionOverlay,
            });
        } else if (event.button === 1) {
            this.panning = true;
        }
    }

    onMouseMove(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (this.panning) {
            this.zoomHelper.onPan(event);
        } else {
            let { x, y } = this.zoomHelper.translateMouseToCanvasCoordinates(
                event.nativeEvent.offsetX,
                event.nativeEvent.offsetY
            );

            // round to the nearest 16 pixels
            x = Math.round(x / 16) * 16;
            y = Math.round(y / 16) * 16;
            // offset by -256 to center the rect
            x -= 256;
            y -= 256;

            this.selectionOverlayPreview = {
                x: x,
                y: y,
                width: this.selectionOverlay!.width,
                height: this.selectionOverlay!.height,
            };

            if (!this.outpaint) {
                this.selectionOverlayPreview = this.clamp(this.selectionOverlayPreview);
            }

            if (this.selectionOverlayPreviewListener) {
                this.selectionOverlayPreviewListener(
                    this.selectionOverlayPreview
                );
            }


            this.sync();
        }
    }

    onMouseUp(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        if (event.button === 0 && event.type == "touch") {
            this.selectionOverlay = this.selectionOverlayPreview;
            this.selectionOverlayPreview = undefined;
            this.sync();
            this.updateArgs({
                selectionOverlay: this.selectionOverlay,
            });
        }
        this.panning = false;
    }

    onMouseLeave(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        this.selectionOverlayPreview = undefined;
        this.panning = false;
        this.sync();
    }

    onWheel(event: WheelEvent) {
        this.zoomHelper.onWheel(event);
    }

    destroy() {
        // this.renderer.setSelectionOverlay(undefined);
        this.renderer.setSelectionOverlayPreview(undefined);
        return true;
    }
}

interface ControlsProps {
    renderer: Renderer;
    tool: Tool;
    outpaint?: boolean;
}

export const Controls: React.FC<ControlsProps> = ({
    renderer,
    tool,
    outpaint,
}) => {
    const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
    const [size, setSize] = useCache("size", 1);
    const [focus, setFocus] = useCache("focus", false);

    useEffect(() => {

        const args = tool.getArgs();
        if (args.selectionOverlay) {
            // restore args
            const aspectRatio = getClosestAspectRatio(
                args.selectionOverlay.width,
                args.selectionOverlay.height
            );
            setAspectRatio(aspectRatio.id);
            setSize(args.selectionOverlay.width / aspectRatio.width);
            tool.updateArgs(args);
        } else {
            // set default args
            args.selectionOverlay = {
                x: 0,
                y: 0,
                width: aspectRatios[aspectRatio].width,
                height: aspectRatios[aspectRatio].height,
            };
            args.outpaint = outpaint;
            tool.updateArgs(args);
        }
    }, [tool]);

    function onChange(aspectRatioId: number, size: number, focus: boolean) {
        if (focus) {
            size = 0.5;
        }
        const args = tool.getArgs();
        const aspectRatio = aspectRatios[aspectRatioId];
        if (args.selectionOverlay) {
            const xDiff =
                args.selectionOverlay.width - aspectRatio.width * size;
            const yDiff =
                args.selectionOverlay.height - aspectRatio.height * size;
            args.selectionOverlay.width = Math.round(aspectRatio.width * size);
            args.selectionOverlay.height = Math.round(
                aspectRatio.height * size
            );
            args.selectionOverlay.x += xDiff / 2;
            args.selectionOverlay.y += yDiff / 2;
            if (!outpaint) {
                // clamp to canvas
                args.selectionOverlay.x = Math.round(
                    Math.max(
                        0,
                        Math.min(
                            args.selectionOverlay.x,
                            renderer.getWidth() - args.selectionOverlay.width
                        )
                    )
                );
                args.selectionOverlay.y = Math.round(
                    Math.max(
                        0,
                        Math.min(
                            args.selectionOverlay.y,
                            renderer.getHeight() - args.selectionOverlay.height
                        )
                    )
                );
            }
        }
        tool.updateArgs({
            selectionOverlay: args.selectionOverlay,
        });
    }

    // function onChangeFocus(focus: boolean) {
    //     setFocus(focus);
    //     if (focus) {
    //         setSize(0.5);
    //     } else {
    //         setSize(1);
    //     }
    // }

    return (
        <>
            {!focus && <>
                <AspectRatioSelector
                    aspectRatio={aspectRatio}
                    onChange={(aspectRatioId) => {
                        onChange(aspectRatioId, size, focus);
                        setAspectRatio(aspectRatioId);
                    }}
                />
                <div className="form-group">
                    <label htmlFor="size" style={{ width: "100%" }}>
                        Size
                        <small
                            className="form-text text-muted"
                            style={{ float: "right" }}
                        >
                            {Math.round(size * 100)}%
                        </small>
                    </label>
                    {<input
                        type="range"
                        className="form-control-range"
                        id="size"
                        min="1"
                        max="2"
                        step="0.1"
                        value={size}
                        onChange={(event) => {
                            onChange(aspectRatio, parseFloat(event.target.value), focus);
                            setSize(parseFloat(event.target.value));
                        }}
                    />}
                </div>
            </>}

            {/* allow outpaint checkbox */}
            <div className="form-group">
                {/* similar to example above to enable focus */}
                <input type="checkbox" id="focus" checked={focus} onChange={(event) => {
                    const size = event.target.checked ? 0.5 : 1;
                    onChange(aspectRatio, size, event.target.checked);
                    setFocus(event.target.checked);
                    setSize(size);
                }} />
                <label htmlFor="focus">Focus</label>
            </div>
        </>
    );
};
