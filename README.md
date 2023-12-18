# AiBrush Local Editor

## Set up ComfyUI

If you're running windows, you can grab a standalone ComfyUI zip from https://github.com/comfyanonymous/ComfyUI/releases

Unzip that on your system and edit the `run_nvidia_gpu.bat` file as follows:

```bat
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --enable-cors-header=http://localhost:5173
```

<!-- TODO: download checkpoints -->
<!-- TODO: download lora -->
<!-- TODO: custom nodes -->

Now you can start up ComfyUI by running `run_nvidia_gpu.bat`.

## Install dependencies

Make sure you have NodeJS and yarn installed.

Navigate to the root of this folder and run:

```shell
yarn
```

Then to start up the UI:

```shell
yarn dev
```

Navigate to http://localhost:5173/ and you can use the editor.
