
export class ImageFetcher {
    private url: string;
    constructor(url: string) {
        this.url = url;
    }
    async fetch_image(filename: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            const response = await fetch(`${this.url}?filename=${filename}&subfolder=&type=output&rand=${Math.random()}`);
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
}