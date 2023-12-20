# AiBrush Local Editor

## Set up ComfyUI

If you're running windows, you can grab a standalone ComfyUI zip from https://github.com/comfyanonymous/ComfyUI/releases

Unzip that on your system and edit the `run_nvidia_gpu.bat` file as follows:

```bat
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --enable-cors-header=http://localhost:5173
```

## Models to Download

- The workflows included with this tool use [DreamshaperXL](https://civitai.com/models/112902/dreamshaper-xl). Download it into the `ComfyUI/models/checkpoints` folder.
- Download the [SDXL Inpainting](https://civitai.com/models/146028/sdxl-inpainting-01-official-reupload) model and place in the `ComfyUI/models/unet` folder.
- Download the [LCM&TurboMix LoRA](https://civitai.com/models/216190) model and place in the `ComfyUI/models/loras` folder.


## Custom Nodes

- Navigate to the `ComfyUI/custom_nodes` folder and git clone the https://github.com/Acly/comfyui-tooling-nodes repo.

## Running ComfyUI

Now you can start up ComfyUI by running `run_nvidia_gpu.bat`.

## Install dependencies

Make sure you have NodeJS and yarn installed.

Navigate to the root of this folder and install library dependencies:

```shell
yarn
```

Then to start up the UI:

```shell
yarn dev
```

Navigate to http://localhost:5173/ and you can use the editor.
