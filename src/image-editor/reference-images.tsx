import { FC, useEffect, useState } from "react";
import { Renderer } from "./renderer";
import { BaseTool } from "./tool";
import loadImage from "blueimp-load-image";

interface Props {
    renderer: Renderer;
    tool: BaseTool;
}

export const ReferenceImagesControls: FC<Props> = ({ renderer }) => {
    const [referenceImages, setReferenceImages] = useState<HTMLCanvasElement[]>([]);
    const [showReferenceImages, setShowReferenceImages] = useState<boolean>(true);

    useEffect(() => {
        setReferenceImages(renderer.getReferenceImages());
    }, [renderer]);

    const onImageSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            loadImage(
                files[0],
                (img) => {
                    renderer.addReferenceImage(img as HTMLCanvasElement);
                    setReferenceImages(referenceImages => {
                        return [...referenceImages, img as HTMLCanvasElement]
                    });
                },
                { canvas: true }
            );
        }
    };

    return (
        <>
            {referenceImages.length < 10 && <div className="form-group" style={{ marginTop: "16px" }}>
                <label
                    id="loadimage-wrapper"
                    className={`btn btn-primary `}
                    style={{ display: "inline" }}
                >
                    {/* upload image */}
                    <i className="fas fa-upload"></i>&nbsp; Add Reference Image
                    <input
                        id="loadimage"
                        type="file"
                        style={{ display: "none" }}
                        onChange={onImageSelected}
                    />
                </label>
            </div>}
            {/* checkbox for displaying reference images in renderer */}
            <div className="form-group" style={{ marginTop: "16px" }}>
                <div className="form-check">
                    <input
                        className="form-check-input"
                        type="checkbox"
                        checked={showReferenceImages}
                        onChange={(event) => {
                            setShowReferenceImages(event.target.checked);
                            renderer.renderReferenceImages = event.target.checked;
                        }}
                    />
                    <label className="form-check-label">Show Reference Images</label>
                </div>
            </div>
            {/* show reference images */}
            {referenceImages.map((img, index) => (
                <div key={index} className="form-group" style={{ marginTop: "16px" }}>
                    
                    <canvas
                        style={{ display: "inline", margin: "8px", width: "100px", height: "100px" }}
                        width={img.width}
                        height={img.height}
                        ref={(canvas) => {
                            if (canvas) {
                                const ctx = canvas.getContext("2d");
                                if (ctx) {
                                    ctx.drawImage(img, 0, 0);
                                }
                            }
                        }}
                    ></canvas>
                    <button
                        className="btn btn-primary btn-sm"
                        style={{position: "relative", top: "-90px", left: "-5px"}}
                        onClick={() => {
                            renderer.removeReferenceImage(index);
                            setReferenceImages(referenceImages => referenceImages.filter((_, i) => i !== index));
                        }}
                    >
                        {/* cancel icon */}
                        <i className="fas fa-times"></i>&nbsp;
                        
                    </button>
                </div>
            ))}
        </>
    )
}