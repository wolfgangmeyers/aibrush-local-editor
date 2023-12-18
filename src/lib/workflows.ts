


import { WebsocketHelper } from "./websocket";
import { ImageFetcher } from "./imagefetcher";

let defaultTransparentImage = "";

function getTransparentImage() {
    if (defaultTransparentImage === "") {
        // use html canvas to create a transparent image
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.fillStyle = "rgba(0, 0, 0, 0)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            defaultTransparentImage = canvas.toDataURL("image/png").split(",")[1];

            // // fill the left half with red
            // ctx.fillStyle = "rgba(255, 0, 0, 255)";
            // ctx.fillRect(0, 0, canvas.width / 2, canvas.height);

        }
    }
    return defaultTransparentImage;
}

export class Img2Img {
    private client_id: string;
    private prompt_pos: any;
    private prompt_neg: any;
    private ksampler: any;
    private image_loader: any;
    private mask_loader: any;
    private websocket_helper: WebsocketHelper;
    private image_fetcher: ImageFetcher;
    private workflow: any;

    constructor(workflow: any, seed: number | null = null, denoise: number | null = null) {
        this.workflow = JSON.parse(JSON.stringify(workflow));
        this.client_id = Math.random().toString();
        // this.checkpoint_loader = this.workflow["4"];
        this.prompt_pos = this.workflow["6"];
        this.prompt_neg = this.workflow["7"];
        this.ksampler = this.workflow["3"];
        this.image_loader = this.workflow["16"];
        this.mask_loader = this.workflow["19"];
        if (seed) {
            this.ksampler["inputs"]["seed"] = seed;
        }
        if (denoise) {
            this.ksampler["inputs"]["denoise"] = denoise;
        }
        this.websocket_helper = new WebsocketHelper("ws://127.0.0.1:8188/ws?clientId=" + this.client_id);
        this.image_fetcher = new ImageFetcher("http://127.0.0.1:8188/view")
    }

    set_seed(seed: number) {
        this.ksampler["inputs"]["seed"] = seed;
    }

    set_denoise(denoise: number) {
        this.ksampler["inputs"]["denoise"] = denoise;
    }

    run(prompt: string, negativePrompt: string, encoded_image: string, encoded_mask?: string, on_progress?: (progress: number) => void): Promise<string> {
        return new Promise((resolve) => {
            console.log("running...");
            this.prompt_pos["inputs"]["text"] = prompt;
            this.prompt_neg["inputs"]["text"] = negativePrompt;
            // encode the image as png and base64
            this.image_loader["inputs"]["image"] = encoded_image;
            if (encoded_mask) {
                this.mask_loader["inputs"]["image"] = encoded_mask;
            } else {
                this.mask_loader["inputs"]["image"] = getTransparentImage();
            }
            const p = {
                "prompt": this.workflow,
                "client_id": this.client_id
            };
            const data = JSON.stringify(p);
            const req = new Request("http://127.0.0.1:8188/prompt", {
                method: "POST",
                body: data
            });

            // submit the request and get the prompt_id from the response
            fetch(req).then(response => {
                response.json().then(response_json => {
                    const prompt_id = response_json["prompt_id"];
                    console.log("prompt_id: " + prompt_id);
                    // wait for the prompt to complete
                    const handle_websocket_completion = async (output: any) => {
                        // get the image
                        const dataUrl = await this.image_fetcher.fetch_image(output["images"][0]["filename"]);
                        // call the callback with the image
                        resolve(dataUrl);
                    };
                    this.websocket_helper.waitForCompletion(prompt_id, handle_websocket_completion, on_progress);
                });
            });
        });

    }

}