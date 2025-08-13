
export class WebsocketHelper {
    private url: string;
    private waiting: boolean;
    private promptId: string | undefined;
    private onCompletion: ((output: string) => void) | undefined;
    private onProgress: ((progress: number) => void) | undefined;

    constructor(url: string) {
        this.url = url;
        this.waiting = false;
    }

    private _waitForCompletion() {
        if (!this.onCompletion || !this.promptId) {
            return;
        }
        const ws = new WebSocket(this.url);
        console.log(`WebSocket opened for prompt_id: ${this.promptId}`);
        ws.onmessage = (event) => {
            const result = JSON.parse(event.data);
            
            // Log all executed messages to debug
            if (result.type === "executed") {
                console.log(`Received executed message for prompt_id: ${result.data.prompt_id}, expecting: ${this.promptId}`);
            }
            
            if (result.type === "executed" && result.data.prompt_id === this.promptId) {
                console.log(`Matched execution for prompt_id: ${this.promptId}`);
                this.waiting = false;
                this.onCompletion!(result.data.output);
                ws.close();
            }
            if (result.type === "progress" && result.data.prompt_id === this.promptId) {
                if (this.onProgress) {
                    const progress = result.data.value / result.data.max;
                    this.onProgress(progress);
                }
            }
        };
        setTimeout(() => {
            if (this.waiting) {
                ws.close();
            }
        }, 3600000); // one hour
    }

    public waitForCompletion(promptId: string, onCompletion: (output: string) => void, onProgress?: (progress: number) => void) {
        if (this.waiting) {
            return;
        }
        this.waiting = true;
        this.promptId = promptId;
        this.onCompletion = onCompletion;
        this.onProgress = onProgress;
        // start a thread to wait for completion
        setTimeout(() => {
            this._waitForCompletion();
        }, 0);
    }
}