import React, { FC, useState } from "react";
import loadImage from "blueimp-load-image";
import saveAs from "file-saver";

import { Renderer } from "./renderer";
import { BaseTool } from "./tool";
import { Dropdown } from "react-bootstrap";
import { useCache } from "../lib/cache";

interface Props {
    renderer: Renderer;
    tool: BaseTool;
}

export const ImportExportControls: FC<Props> = ({ renderer, tool }) => {

    const [backupImage, setBackupImage] = useState<string | undefined>();
    const [prompt, _] = useCache("prompt", "image");

    const onImageSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            loadImage(
                files[0],
                (img) => {
                    const backupImage = renderer.getEncodedImage(null, "png");
                    setBackupImage(backupImage);
                    renderer.setBaseImage(img as HTMLImageElement);
                },
                { canvas: false }
            );
        }
    };

    const onExport = (format: "png" | "webp" | "jpeg") => {
        const encodedImage = renderer.getEncodedImage(null, format);
        if (encodedImage) {
            // base64 decode
            const byteString = atob(encodedImage);
            // save as file
            const buffer = new ArrayBuffer(byteString.length);
            const intArray = new Uint8Array(buffer);
            for (let i = 0; i < byteString.length; i++) {
                intArray[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([intArray], { type: `image/${format}` });
            let newFilename = prompt.replace(/[^a-z0-9]/gi, "_").toLowerCase();
            if (newFilename.length > 255) {
                newFilename = newFilename.substring(0, 255);
            }
            if (newFilename.length === 0) {
                newFilename = "image";
            }
            saveAs(blob, `${newFilename}.${format}`);
        }
    };

    if (backupImage) {
        return (
            <div className="form-group" style={{marginTop: "16px"}}>
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
                    <i className="fas fa-times"></i>&nbsp;
                    Revert
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
                    style={{marginLeft: "8px"}}
                >
                    {/* save icon */}
                    <i className="fas fa-save"></i>&nbsp;
                    Save
                </button>
            </div>
        );
    }

    // Show buttons for import and export and "save a copy"
    return (
        <>
            <div className="form-group" style={{marginTop: "16px"}}>
                <label
                    id="loadimage-wrapper"
                    className={`btn btn-primary `}
                    style={{ display: "inline" }}
                >
                    {/* upload image */}
                    <i className="fas fa-upload"></i>&nbsp; Import Image
                    <input
                        id="loadimage"
                        type="file"
                        style={{ display: "none" }}
                        onChange={onImageSelected}
                    />
                </label>
            </div>
            <div className="form-group">
                <Dropdown>
                    <Dropdown.Toggle variant="primary" id="dropdown-basic">
                        <i className="fas fa-download"></i>&nbsp; Export Image
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                        <Dropdown.Item onClick={() => onExport("png")}>PNG</Dropdown.Item>
                        <Dropdown.Item onClick={() => onExport("webp")}>WEBP</Dropdown.Item>
                        <Dropdown.Item onClick={() => onExport("jpeg")}>JPEG</Dropdown.Item>
                    </Dropdown.Menu>
                </Dropdown>
            </div>
        </>
    );
};
