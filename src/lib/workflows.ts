import { WebsocketHelper } from "./websocket";
import { ComfyFetcher } from "./comfyfetcher";
import { SelectedLora } from "./loras";

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

function getIds(workflow: any): any {
    const nameLookup: any = {};
    const ids = Object.keys(workflow);
    for (const id of ids) {
        const node = workflow[id];
        const title = node._meta.title;
        nameLookup[title] = id;
    }
    return nameLookup;

}

export class Img2Img {
    private client_id: string;
    private websocket_helper: WebsocketHelper;
    private workflow: any;
    private comfy_fetcher: ComfyFetcher;

    private ids: any;
    private backendHost: string;

    constructor(workflowJSON: any) {
        this.backendHost = localStorage.getItem("backend-host") || "localhost:8188";
        this.workflow = JSON.parse(JSON.stringify(workflowJSON));
        this.client_id = Math.random().toString();
        this.ids = getIds(this.workflow);
        this.websocket_helper = new WebsocketHelper(`ws://${this.backendHost}/ws?clientId=${this.client_id}`);
        this.comfy_fetcher = new ComfyFetcher(`http://${this.backendHost}`)
    }

    private node(title: string): any {
        return this.workflow[this.id(title)];
    }

    private id(title: string): string {
        return this.ids[title];
    }

    private clone(title: string, newTitle: string): any {
        const result = JSON.parse(JSON.stringify(this.node(title)));
        result._meta.title = newTitle;
        this.ids[newTitle] = newTitle;
        this.workflow[newTitle] = result;
        return result;
    }

    private isPixart(): boolean {
        // load_pixart_checkpoint
        if (this.node("load_pixart_checkpoint")) {
            return true;
        }
        return false;
    }

    private isFlux(): boolean {
        if (this.node("load_flux_model")) {
            return true;
        }
        return false;
    }

    disable_accelerator() {
        // no-op for pixart
        if (this.isPixart() || this.isFlux()) {
            return;
        }
        // load_sdxl_checkpoint
        this.node("sampler").inputs.model = [
            this.id("load_sdxl_checkpoint"),
            0
        ];
        this.node("sampler").inputs.steps = 50;
        this.node("sampler").inputs.cfg = 7;
        this.node("sampler").sampler_name = "k_euler";
    }

    set_seed(seed: number) {
        if (this.isFlux()) {
            this.node("noise").inputs.noise_seed = seed;
        } else {
            this.node("sampler").inputs.seed = seed;
        }
    }

    set_denoise(denoise: number) {
        if (this.isFlux()) {
            this.node("scheduler").inputs.denoise = denoise;
        } else {
            this.node("sampler").inputs.denoise = denoise;
        }
    }

    set_reference_images_weight(weight: number) {
        // no-op for pixart
        if (this.isPixart() || this.isFlux()) {
            return;
        }
        this.node("apply_ipadapter").inputs.weight = weight;
    }

    set_selected_model(model: string) {
        if (this.isFlux()) {
            this.node("load_flux_model").inputs.unet_name = model;
            // if (model === "flux1-schnell.sft") {
            if (model.indexOf("flux1-schnell") !== -1) {
                this.node("scheduler").inputs.steps = 4;
            } else {
                this.node("scheduler").inputs.steps = 20;
            }
            return;
        }
        // no-op for pixart
        if (this.isPixart()) {
            return;
        }
        this.node("load_sdxl_checkpoint").inputs.ckpt_name = model;
    }

    set_reference_images(encodedImages: string[]) {
        // no-op for pixart
        if (this.isPixart()) {
            return;
        }
        // reverse the order of the encoded images so that the first image provided
        // has the highest weight
        encodedImages.reverse();
        let refImageCount = 1;
        this.node(`load_reference_image_${refImageCount}`).inputs.image = encodedImages.pop();
        if (encodedImages.length > 0) {
            refImageCount++;
            this.node(`load_reference_image_${refImageCount}`).inputs.image = encodedImages.pop();
            this.node("apply_ipadapter").inputs.image = [
                this.id(`batch_reference_images_${refImageCount - 1}`),
                0
            ];
        }
        // no nodes exist in the workflow for more than 2 reference images
        // so we need to add them to the workflow and update references
        while (encodedImages.length > 0) {
            refImageCount++;
            const load_reference_image_id = `load_reference_image_${refImageCount}`;
            this.workflow[load_reference_image_id] = {
                inputs: {
                    image: encodedImages.pop()
                },
                class_type: "ETN_LoadImageBase64",
                _meta: {
                    title: load_reference_image_id
                }
            }
            this.ids[load_reference_image_id] = load_reference_image_id;

            const batch_reference_images_id = `batch_reference_images_${refImageCount - 1}`;
            this.workflow[batch_reference_images_id] = {
                inputs: {
                    image1: [
                        this.id(`batch_reference_images_${refImageCount - 2}`),
                        0
                    ],
                    image2: [
                        this.id(load_reference_image_id),
                        0
                    ]
                },
                class_type: "ImageBatch",
                _meta: {
                    title: batch_reference_images_id
                }
            }
            this.ids[batch_reference_images_id] = batch_reference_images_id;
            this.node("apply_ipadapter").inputs.image = [
                this.id(batch_reference_images_id),
                0
            ];
        }
        this.node("sampler").inputs.model = [
            this.id("apply_ipadapter"),
            0
        ];
        if (this.node("refiner_sampler")) {
            this.node("refiner_sampler").inputs.model = [
                this.id("apply_ipadapter"),
                0
            ];
        }
        console.log("set_reference_images complete. workflow: ", JSON.stringify(this.workflow, null, 2));
    }

    set_selected_loras(selected_loras: SelectedLora[]) {
        // no-op for pixart
        if (this.isPixart()) {
            return;
        }
        let loras = JSON.parse(JSON.stringify(selected_loras));
        if (selected_loras.length > 0) {
            let loraNumber = 0;
            let lora = loras.pop();

            const loraNodeName = `load_lora_${loraNumber}`;
            this.clone("load_turbo_lora", loraNodeName);
            this.node(loraNodeName).inputs.lora_name = lora?.name;
            this.node(loraNodeName).inputs.strength_model = lora?.strength;
            this.node(loraNodeName).inputs.strength_clip = lora?.strength;
            this.node(loraNodeName).inputs.model = JSON.parse(JSON.stringify(
                this.node("sampler").inputs.model
            ));
            this.node(loraNodeName).inputs.clip = [
                this.id("load_sdxl_checkpoint"),
                1
            ];
            this.node("sampler").inputs.model = [
                this.id(loraNodeName),
                0
            ];
            loraNumber++;
        }
    }

    run(prompt: string, negativePrompt: string, encoded_image: string, encoded_mask?: string, on_progress?: (progress: number) => void): Promise<string> {
        return new Promise((resolve) => {
            console.log("running...", JSON.stringify(this.workflow, null, 2));
            this.node("positive_prompt").inputs.text = prompt;
            if (!this.isFlux()) {
                this.node("negative_prompt").inputs.text = negativePrompt;
            }
            this.node("load_source_image").inputs.image = encoded_image;
            if (encoded_mask) {
                this.node("load_mask").inputs.image = encoded_mask;
            } else {
                this.node("load_mask").inputs.image = getTransparentImage();
            }
            const p = {
                "prompt": this.workflow,
                "client_id": this.client_id
            };
            const data = JSON.stringify(p);
            const req = new Request(`http://${this.backendHost}/prompt`, {
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
                        const dataUrl = await this.comfy_fetcher.fetch_image(output["images"][0]["filename"]);
                        // call the callback with the image
                        resolve(dataUrl);
                    };
                    this.websocket_helper.waitForCompletion(prompt_id, handle_websocket_completion, on_progress);
                });
            });
        });

    }
}

export class Upscale {
    private client_id: string;
    private websocket_helper: WebsocketHelper;
    private workflow: any;
    private comfy_fetcher: ComfyFetcher;
    private ids: any;
    private backendHost: string;

    constructor(workflowJSON: any) {
        this.backendHost = localStorage.getItem("backend-host") || "localhost:8188";
        this.workflow = JSON.parse(JSON.stringify(workflowJSON));
        this.client_id = Math.random().toString();
        this.ids = getIds(this.workflow);
        this.websocket_helper = new WebsocketHelper(`ws://${this.backendHost}/ws?clientId=${this.client_id}`);
        this.comfy_fetcher = new ComfyFetcher(`http://${this.backendHost}`)
    }

    private node(title: string): any {
        return this.workflow[this.id(title)];
    }

    private id(title: string): string {
        return this.ids[title];
    }

    run(encoded_image: string, on_progress?: (progress: number) => void): Promise<string> {
        return new Promise((resolve) => {
            this.node("load_source_image").inputs.image = encoded_image;
            const p = {
                "prompt": this.workflow,
                "client_id": this.client_id
            };
            const data = JSON.stringify(p);
            const req = new Request(`http://${this.backendHost}/prompt`, {
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
                        const dataUrl = await this.comfy_fetcher.fetch_image(output["images"][0]["filename"]);
                        // call the callback with the image
                        resolve(dataUrl);
                    };
                    this.websocket_helper.waitForCompletion(prompt_id, handle_websocket_completion, on_progress);
                });
            });
        })
    }
}

export class Rembg {
    private client_id: string;
    private websocket_helper: WebsocketHelper;
    private workflow: any;
    private comfy_fetcher: ComfyFetcher;
    private ids: any;
    private backendHost: string;

    constructor(workflowJSON: any) {
        this.backendHost = localStorage.getItem("backend-host") || "localhost:8188";
        this.workflow = JSON.parse(JSON.stringify(workflowJSON));
        this.client_id = Math.random().toString();
        this.ids = getIds(this.workflow);
        this.websocket_helper = new WebsocketHelper(`ws://${this.backendHost}/ws?clientId=${this.client_id}`);
        this.comfy_fetcher = new ComfyFetcher(`http://${this.backendHost}`)
    }

    private node(title: string): any {
        return this.workflow[this.id(title)];
    }

    private id(title: string): string {
        return this.ids[title];
    }

    run(encoded_image: string, on_progress?: (progress: number) => void): Promise<string> {
        return new Promise((resolve) => {
            this.node("load-image").inputs.image = encoded_image;
            
            const p = {
                "prompt": this.workflow,
                "client_id": this.client_id
            };
            const data = JSON.stringify(p);
            const req = new Request(`http://${this.backendHost}/prompt`, {
                method: "POST",
                body: data
            });

            fetch(req).then(response => {
                response.json().then(response_json => {
                    const prompt_id = response_json["prompt_id"];
                    console.log("prompt_id: " + prompt_id);
                    
                    const handle_websocket_completion = async (output: any) => {
                        const dataUrl = await this.comfy_fetcher.fetch_image(output["images"][0]["filename"]);
                        resolve(dataUrl);
                    };
                    this.websocket_helper.waitForCompletion(prompt_id, handle_websocket_completion, on_progress);
                });
            });
        });
    }
}

export class FluxKontext {
    private workflow: any;
    private comfy_fetcher: ComfyFetcher;
    private ids: any;
    private backendHost: string;

    constructor(workflowJSON: any) {
        this.backendHost = localStorage.getItem("backend-host") || "localhost:8188";
        this.workflow = JSON.parse(JSON.stringify(workflowJSON));
        this.ids = getIds(this.workflow);
        this.comfy_fetcher = new ComfyFetcher(`http://${this.backendHost}`)
    }

    private node(title: string): any {
        return this.workflow[this.id(title)];
    }

    private id(title: string): string {
        return this.ids[title];
    }

    run(prompt: string, encoded_image: string, on_progress?: (progress: number) => void): Promise<string> {
        return new Promise((resolve, reject) => {
            // Create a new client_id and websocket for this run
            const client_id = Math.random().toString();
            const websocket_helper = new WebsocketHelper(`ws://${this.backendHost}/ws?clientId=${client_id}`);
            
            // Set the prompt text
            this.node("positive_prompt").inputs.text = prompt;
            
            // Set the input image - note the workflow uses ETN_LoadImageBase64
            this.node("Load Image Base64").inputs.image = encoded_image;
            
            // Set a random seed for variation - using larger range and Date.now() for more uniqueness
            const randomSeed = Math.floor(Math.random() * 1000000000000) + Date.now();
            this.node("KSampler").inputs.seed = randomSeed;
            console.log("Using seed:", randomSeed);
            
            const p = {
                "prompt": this.workflow,
                "client_id": client_id
            };
            const data = JSON.stringify(p);
            const req = new Request(`http://${this.backendHost}/prompt`, {
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
                        console.log("FluxKontext websocket completion received, output:", output);
                        
                        // Check if this is the SaveImage node (136) output we want
                        // Ignore PreviewImage node (173) or other temp outputs
                        let imageInfo;
                        
                        // First check for the specific SaveImage node output (136)
                        if (output["136"] && output["136"]["images"] && output["136"]["images"][0]) {
                            imageInfo = output["136"]["images"][0];
                            console.log("Using SaveImage node (136) output");
                        } else if (output["images"] && output["images"][0]) {
                            // Fallback to direct structure, but check if it's not a temp/preview
                            const img = output["images"][0];
                            if (img.type === "temp" || img.filename.includes("temp")) {
                                console.log("Ignoring temp/preview image, waiting for final output...");
                                return; // Don't resolve yet, wait for the real output
                            }
                            imageInfo = img;
                            console.log("Using direct output structure");
                        } else {
                            console.log("Output structure not ready yet:", output);
                            return; // Don't resolve or reject, just wait for next message
                        }
                        
                        console.log("Fetching image with info:", imageInfo);
                        // ComfyUI provides filename, subfolder, and type in the output
                        const dataUrl = await this.comfy_fetcher.fetch_image(
                            imageInfo["filename"],
                            imageInfo["subfolder"] || "",
                            imageInfo["type"] || "output"
                        );
                        console.log("Image fetched successfully");
                        resolve(dataUrl);
                    };
                    websocket_helper.waitForCompletion(prompt_id, handle_websocket_completion, on_progress);
                });
            });
        });
    }
}
