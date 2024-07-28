export interface CheckpointLoaderSimple {
    input: {
        required: {
            ckpt_name: string[][];
        }
    }
}
export interface LoraLoader {
    input: {
        required: {
            lora_name: string[][];
        }
    }
} 

export interface ComfyObjectInfo {
    CheckpointLoaderSimple: CheckpointLoaderSimple;
    LoraLoader: LoraLoader;
}