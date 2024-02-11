import { ComfyObjectInfo } from "./objectinfo";

export class ComfyFetcher {
    private url: string;
    constructor(url: string) {
        this.url = url;
    }
    async fetch_image(filename: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            const response = await fetch(`${this.url}/view?filename=${filename}&subfolder=&type=output&rand=${Math.random()}`);
            const blob = await response.blob();
            // base64 encode the image
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const dataUrl = reader.result;
                resolve(dataUrl as string);
            };
        });
    }

    async fetch_object_info(): Promise<ComfyObjectInfo> {
        const response = await fetch(`${this.url}/object_info`);
        const json = await response.json();
        console.log("object info", json);
        return json;
    }
}

export const fetcher = new ComfyFetcher("http://localhost:8188");
