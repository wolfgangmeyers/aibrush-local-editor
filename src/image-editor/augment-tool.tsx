import React, { FC, useState, useEffect } from "react";
import axios from "axios";


import { Renderer } from "./renderer";
import { BaseTool } from "./tool";
import {
    ImageUtilWorker,
    imageDataToCanvas,
    fixImageSize,
} from "../lib/imageutil";
import moment from "moment";
import { Alert } from "react-bootstrap";
import upscaleWorkflow from "../workflows/upscale_api.json";
import { Upscale } from "../lib/workflows";
import { ProgressBar } from "../components/ProgressBar";

export const anonymousClient = axios.create();

interface Props {
    renderer: Renderer;
    tool: BaseTool;
}

export const AugmentControls: FC<Props> = ({ renderer, tool }) => {
    const [backupImage, setBackupImage] = useState<string | undefined>();
    const [activeAugmentation, setActiveAugmentation] = useState<
        "upscale" | "face_restore" | null
    >(null);
    const [imageWorker, setImageWorker] = useState<
        ImageUtilWorker | undefined
    >();
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<number>(0);

    useEffect(() => {
        const imageWorker = new ImageUtilWorker();
        setImageWorker(imageWorker);
        return () => {
            imageWorker.destroy();
        };
    }, []);

    const augmentImageData = async (
        imageData: ImageData,
    ): Promise<ImageData> => {
        if (!imageWorker) {
            throw new Error("Image worker not initialized");
        }
        let c = imageDataToCanvas(imageData);
        let encodedImage = c.toDataURL("image/webp").split(",")[1];
        c.remove();

        const workflow = new Upscale(upscaleWorkflow);
        let imageUrl: string;
        setError(null);
        imageUrl = await workflow.run(encodedImage, (progress) => {
            setProgress(progress);
        });

        const canvas = document.createElement("canvas");
        const img = new Image();
        img.src = imageUrl;
        await new Promise((resolve) => {
            img.onload = resolve;
        });
        canvas.width = img.width / 2;
        canvas.height = img.height / 2;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const newImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        canvas.remove();
        return newImageData;
    };

    const onUpscale = async () => {
        setActiveAugmentation("upscale");
        setError(null);
        try {
            const backupImage = renderer.getEncodedImage(null, "png");
            setBackupImage(backupImage);
            let imageData = renderer.getImageData(null);
            if (!imageData) {
                return;
            }
            // ensure width and height are multiples of 64
            if ((imageData.width % 64) + (imageData.height % 64) !== 0) {
                const c = fixImageSize(imageDataToCanvas(imageData));
                imageData = c
                    .getContext("2d")!
                    .getImageData(0, 0, c.width, c.height);
            }

            const newImageData = await augmentImageData(
                imageData,
            );
            const newCanvas = imageDataToCanvas(newImageData);
            renderer.setBaseImage(newCanvas);
            newCanvas.remove();
        } catch (err: any) {
            // check for err.response.data.message
            const errMessage = err.response?.data?.message || err.message || "Augmentation failed";
            setError(errMessage);
        } finally {
            setActiveAugmentation(null);
        }
    };

    if (activeAugmentation) {
        return (
            <div className="form-group" style={{ marginTop: "16px" }}>
                <div style={{ marginTop: "16px" }}>
                    <i className="fa fa-spinner fa-spin"></i>&nbsp;{" "}
                    Upscaling...
                    <br />
                    <ProgressBar progress={progress} />
                </div>
            </div>
        );
    }

    if (backupImage) {
        return (
            <div className="form-group" style={{ marginTop: "16px" }}>
                {/* <ErrorNotification message={error} timestamp={lastError} /> */}
                {error && <Alert variant="danger">{error}</Alert>}
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        setBackupImage(undefined);
                        const img = new Image();
                        // set src as data uri
                        const src = "data:image/png;base64," + backupImage;
                        img.src = src;
                        img.onload = () => {
                            renderer.setBaseImage(img);
                        };
                    }}
                >
                    {/* cancel icon */}
                    <i className="fas fa-times"></i>&nbsp; Revert
                </button>
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        setBackupImage(undefined);
                        if (tool.saveListener) {
                            const encodedImage = renderer.getEncodedImage(null, "png");
                            if (encodedImage) {
                                tool.saveListener(encodedImage, "png");
                            }
                        }
                    }}
                    style={{ marginLeft: "8px" }}
                >
                    {/* save icon */}
                    <i className="fas fa-save"></i>&nbsp; Save
                </button>
            </div>
        );
    }

    // const maxSize = 2048 * 2048;
    // if (renderer.getWidth() * renderer.getHeight() > maxSize) {
    //     return (
    //         <div style={{ marginTop: "16px" }}>
    //             This image is too large to augment.
    //         </div>
    //     );
    // }

    // Show buttons for import and export and "save a copy"
    return (
        <>
            {/* <ErrorNotification message={error} timestamp={lastError} /> */}
            {error && <Alert variant="danger">{error}</Alert>}
            <div className="form-group" style={{ marginTop: "16px" }}>
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        onUpscale();
                    }}
                    style={{ marginLeft: "8px" }}
                >
                    {/* upscale icon */}
                    <i className="fas fa-arrows-alt"></i>&nbsp; Upscale Image 2x
                </button>
            </div>
        </>
    );
};
