import { useState, useEffect, useRef } from "react";
import axios from "axios";

import "./ImageEditor.css";
import { createRenderer, Renderer } from "./renderer";
import { Tool, BaseTool } from "./tool";
import { EnhanceTool, EnhanceControls } from "./enhance-tool";
import {
    PencilTool,
    Controls as PencilControls,
    defaultColors,
} from "./pencil-tool";
import { SmudgeTool, SmudgeControls } from "./smudge-tool";
import { ImportExportControls } from "./import-export";
import { BusyModal } from "../components/BusyModal";
import { InpaintControls, InpaintTool } from "./inpaint-tool";
import { ReferenceImagesControls } from "./reference-images";

interface CanPreventDefault {
    preventDefault: () => void;
}

interface ToolConfig {
    name: string;
    iconClass: string;
    constructor: (r: Renderer) => Tool;
    renderControls: (t: Tool, renderer: Renderer) => JSX.Element;
    defaultArgs: any;
}

export const anonymousClient = axios.create();
delete anonymousClient.defaults.headers.common["Authorization"];

export const ImageEditor = () => {
    const [showSelectionControls, setShowSelectionControls] = useState(false);
    const tools: Array<ToolConfig> = [
        
        {
            name: "enhance",
            iconClass: "fas fa-magic",
            constructor: (r: Renderer) => new EnhanceTool(r),
            defaultArgs: {
                variationStrength: 0.75,
            },
            renderControls: (t: Tool, renderer: Renderer) => {
                t.onShowSelectionControls(setShowSelectionControls);
                return (
                    <EnhanceControls
                        tool={t as EnhanceTool}
                        renderer={renderer}
                        key={"enhance-controls"}
                    />
                );
            },
        },
        {
            name: "inpaint",
            iconClass: "fas fa-paint-brush",
            constructor: (r: Renderer) => new InpaintTool(r),
            defaultArgs: {},
            renderControls: (t: Tool, renderer: Renderer) => {
                t.onShowSelectionControls(setShowSelectionControls);
                return (
                    <InpaintControls
                        tool={t as InpaintTool}
                        renderer={renderer}
                        key={"inpaint-controls"}
                    />
                );
            },
        },
        {
            name: "pencil",
            iconClass: "fas fa-pencil-alt",
            constructor: (r: Renderer) => new PencilTool(r, "base"),
            defaultArgs: {},
            renderControls: (t: Tool, renderer: Renderer) => {
                return (
                    <PencilControls
                        tool={t as PencilTool}
                        renderer={renderer}
                        colors={defaultColors}
                        key={"pencil-controls"}
                    />
                );
            },
        },
        {
            name: "smudge",
            // finger icon
            iconClass: "fas fa-hand-pointer",
            constructor: (r: Renderer) => new SmudgeTool(r),
            defaultArgs: {},
            renderControls: (t: Tool, renderer: Renderer) => {
                return (
                    <SmudgeControls
                        tool={t as SmudgeTool}
                        renderer={renderer}
                        key={"smudge-controls"}
                    />
                );
            },
        },
        {
            name: "reference images",
            iconClass: "fas fa-images",
            constructor: (r: Renderer) => new BaseTool(r, "reference images"),
            defaultArgs: {},
            renderControls: (t: Tool, renderer: Renderer) => {
                return (
                    <ReferenceImagesControls
                        renderer={renderer}
                        tool={t as BaseTool}
                        key={"reference-images-controls"}
                    />
                );
            },
        },
        {
            name: "import-export",
            iconClass: "fas fa-file-import",
            constructor: (r: Renderer) => new BaseTool(r, "import-export"),
            defaultArgs: {},
            renderControls: (t: Tool, renderer: Renderer) => {
                return (
                    <ImportExportControls
                        renderer={renderer}
                        tool={t as BaseTool}
                        key={"import-export-controls"}
                    />
                );
            },
        }
    ];

    const [renderer, setRenderer] = useState<Renderer | null>(null);
    const [tool, setTool] = useState<Tool | null>(null);
    const [toolConfig, setToolConfig] = useState<ToolConfig | null>(null);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const [busyMessage, setBusyMessage] = useState<string | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);

    const onSelectTool = (toolconfig: ToolConfig) => {
        if (renderer) {
            if (tool) {
                if (!tool.destroy()) {
                    return;
                }
            }
            const newTool = toolconfig.constructor(renderer);
            setTool(newTool);
            setToolConfig(toolconfig);
            // newTool.onSaveImage((encodedImage) => {
            //     console.log("Saving image...");
            //     saveNewImage(encodedImage);
            // });
        }
    };

    useEffect(() => {
        if (renderer) {
            onSelectTool(tools[0]);
            renderer.onSnapshot(() => {
                setCanUndo(renderer.canUndo());
                setCanRedo(renderer.canRedo());
            });
        }
    }, [renderer]);

    useEffect(() => {
        if (canvasRef.current) {
            const listener = (e: WheelEvent) => {
                if (tool) {
                    e.preventDefault();
                    tool.onWheel(e);
                }
            };
            canvasRef.current.addEventListener("wheel", listener);
            return () => {
                canvasRef.current?.removeEventListener("wheel", listener);
            };
        }
    }, [tool, canvasRef.current]);

    useEffect(() => {
        if (canvasRef.current) {
            const renderer = createRenderer(canvasRef.current);
            
            setRenderer(renderer);
            const image = new Image();
            image.src = "blank-canvas.jpg";
            image.onload = () => {
                renderer.setBaseImage(image);
            };
        }
        
    }, [canvasRef.current])

    // implement a useEffect hook that resizes the canvas (renderer.updateCanvasSize(width, height)) when the window is resized, and also on initial load
    // the canvas size should be set based on the current screen size
    useEffect(() => {
        if (renderer) {
            const listener = () => {
                let width = window.innerWidth * 0.85;
                let height = window.innerHeight;
                if (window.innerWidth <= 992) {
                    width = window.innerWidth;
                    height = window.innerHeight * 0.85;
                }
                renderer.updateCanvasSize(width, height);
                // renderer.resetView();
            };
            window.addEventListener("resize", listener);
            listener();
            renderer.resetView();
            return () => {
                window.removeEventListener("resize", listener);
            };
        }
    }, [renderer]);

    function renderTool(t: ToolConfig) {
        let buttonClass = `btn btn-secondary light-button image-editor-tool-button`;
        const isSelected = tool && tool.name == t.name;
        if (isSelected) {
            buttonClass = `btn btn-primary image-editor-tool-button`;
        }
        return (
            <button
                style={{ margin: "4px" }}
                className={buttonClass}
                onClick={() => onSelectTool(t)}
                key={`tool-button-${t.name}`}
            >
                <i className={t.iconClass}></i>
            </button>
        );
    }

    function preventDefault(e: CanPreventDefault): boolean {
        e.preventDefault();
        return true;
    }

    return (
        <>
            <div className="row">
                <div className="col-12">
                    <h1 style={{ fontSize: "40px", textAlign: "left" }}>
                        &nbsp; AiBrush Local Editor
                    </h1>
                </div>
            </div>
            <div
                className="row"
                style={{ marginTop: "32px", marginBottom: "0px" }}
            >
                <div
                    className="col-lg-3"
                    style={{ textAlign: "left", marginBottom: "8px" }}
                >
                    {renderer && (
                        <>
                            <div style={{ marginBottom: "16px" }}>
                                {tools.map((t) => renderTool(t))}
                            </div>
                            {tool && toolConfig && (
                                <>
                                    {/* capitalize tool name */}
                                    <h4 style={{ marginLeft: "16px" }}>
                                        {tool.name.charAt(0).toUpperCase() +
                                            tool.name.slice(1)}
                                    </h4>
                                    {toolConfig.renderControls(
                                        tool!,
                                        renderer!
                                    )}
                                </>
                            )}
                            {(canRedo || canUndo) && (
                                <div className="form-group">
                                    <div className="btn-group">
                                        <button
                                            className="btn btn-primary image-popup-button"
                                            disabled={!renderer || !canUndo}
                                            onClick={() =>
                                                renderer && renderer.undo()
                                            }
                                        >
                                            {/* undo */}
                                            <i className="fas fa-undo"></i>
                                        </button>
                                        <button
                                            className="btn btn-primary image-popup-button"
                                            disabled={!renderer || !canRedo}
                                            onClick={() =>
                                                renderer && renderer.redo()
                                            }
                                        >
                                            <i className="fas fa-redo"></i>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <div className="col-lg-9">
                    <div style={{ verticalAlign: "middle" }}>
                        <div>
                            <canvas
                                style={{
                                    cursor: "none",
                                    touchAction: "none",
                                    userSelect: "none",
                                }}
                                width={768}
                                height={512}
                                ref={canvasRef}
                                className="image-editor-canvas"
                                onMouseDown={(e) =>
                                    preventDefault(e) &&
                                    tool &&
                                    tool.onMouseDown(e)
                                }
                                onMouseMove={(e) =>
                                    preventDefault(e) &&
                                    tool &&
                                    tool.onMouseMove(e)
                                }
                                onMouseUp={(e) =>
                                    preventDefault(e) &&
                                    tool &&
                                    tool.onMouseUp(e)
                                }
                                onMouseLeave={(e) =>
                                    preventDefault(e) &&
                                    tool &&
                                    tool.onMouseLeave(e)
                                }
                                onTouchStart={(e) =>
                                    preventDefault(e) &&
                                    tool &&
                                    tool.onTouchStart(e)
                                }
                                onTouchMove={(e) =>
                                    preventDefault(e) &&
                                    tool &&
                                    tool.onTouchMove(e)
                                }
                                onTouchEnd={(e) =>
                                    preventDefault(e) &&
                                    tool &&
                                    tool.onTouchEnd(e)
                                }
                                onPointerMove={(e) =>
                                    tool &&
                                    tool.onPointerMove(e)
                                }
                                onPointerDown={(e) => 
                                    tool &&
                                    tool.onPointerDown(e)
                                }
                                onPointerUp={(e) =>
                                    tool &&
                                    tool.onPointerUp(e)
                                }
                            ></canvas>
                            {showSelectionControls && (
                                <>
                                    <button
                                        className="btn btn-secondary canvas-select-left"
                                        onClick={() => tool!.select("left")}
                                    >
                                        <i className="fas fa-chevron-left"></i>
                                    </button>
                                    <button
                                        className="btn btn-secondary canvas-select-right"
                                        onClick={() => tool!.select("right")}
                                    >
                                        <i className="fas fa-chevron-right"></i>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="row">
                        <button
                            className="btn btn-primary"
                            // center horizontally
                            style={{
                                position: "absolute",
                                left: "50%",
                                transform: "translate(-50%, 0)",
                            }}
                            onClick={() => {
                                if (renderer) {
                                    renderer.resetView();
                                }
                            }}
                        >
                            {/* reset zoom */}
                            <i className="fas fa-search-plus"></i>&nbsp; Reset
                            View
                        </button>
                        {/* redo */}
                    </div>
                    {/* vertically center button within the div */}
                </div>
            </div>
            {busyMessage && (
                <BusyModal show={true} title="Please Wait">
                    {busyMessage}
                </BusyModal>
            )}
        </>
    );
};
