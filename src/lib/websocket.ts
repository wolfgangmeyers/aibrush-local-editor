
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
        ws.onmessage = (event) => {
            const result = JSON.parse(event.data);
            if (result.type === "executed" && result.data.prompt_id === this.promptId) {
                this.waiting = false;
                this.onCompletion!(result.data.output);
                ws.close();
            }
            if (result.type === "progress") {
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
        }, 30000);
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