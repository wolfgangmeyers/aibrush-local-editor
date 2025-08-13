# Workflows Documentation

This document describes the available ComfyUI workflows and their integration with the AiBrush Local Editor.

## Overview

Workflows are JSON-based ComfyUI pipeline definitions that are dynamically configured at runtime through the workflow classes in `src/lib/workflows.ts`. Each workflow uses `_meta.title` labels on nodes for stable parameter injection.

## Workflow Classes

### 1. Img2Img (`src/lib/workflows.ts`)

Primary image generation and editing workflow with extensive customization options.

**Supported Workflows:**
- `dreamshaper_img2img64_api.json` - SDXL-based img2img with LCM acceleration
- `dreamshaper_img2img64_mask_api.json` - SDXL with mask support
- `dreamshaper_img2img64_mask_ipadapter_api.json` - SDXL with IP-Adapter for reference images
- `pixart-sigma-img2img-mask-api.json` - PixArt-Sigma model variant
- `flux-dev-api.json` - Flux model variant
- `inpaintingxl_api.json` - Specialized SDXL inpainting model

**Parameters:**
- `prompt`: Positive text prompt
- `negativePrompt`: Negative text prompt (not used in Flux)
- `encoded_image`: Base64-encoded input image
- `encoded_mask`: Optional base64-encoded mask
- `denoise`: Variation strength (0.0-1.0)
- `seed`: Random seed for reproducibility
- `selected_model`: Model checkpoint selection
- `selected_loras`: Array of LoRA models with strengths
- `reference_images`: Array of encoded reference images for IP-Adapter
- `reference_images_weight`: IP-Adapter influence weight
- `accelerator`: Enable/disable LCM acceleration

**Key Methods:**
- `disable_accelerator()`: Switches from LCM to standard sampling
- `set_reference_images()`: Dynamically adds reference image nodes
- `set_selected_loras()`: Configures LoRA model chain

### 2. Upscale (`src/lib/workflows.ts`)

Model-based image upscaling using ESRGAN variants.

**Supported Workflows:**
- `upscale_api.json` - 2x upscaling with automatic resolution balancing

**Parameters:**
- `encoded_image`: Base64-encoded input image

**Notes:**
- Automatically handles tiling for large images
- Returns downscaled result for balanced resolution

### 3. Rembg (`src/lib/workflows.ts`)

Background removal using the RMBG model.

**Supported Workflows:**
- `rembg-api.json` - Automatic background removal

**Parameters:**
- `encoded_image`: Base64-encoded input image

**Notes:**
- Returns image with transparent background
- Preserves original dimensions

### 4. FluxKontext (`src/lib/workflows.ts`)

High-quality image enhancement using the Flux Kontext model.

**Supported Workflows:**
- `flux_1_kontext_dev_basic_api.json` - Flux Kontext with fixed optimal settings

**Parameters:**
- `prompt`: Text prompt describing desired enhancement
- `encoded_image`: Base64-encoded input image

**Notes:**
- Simplified interface with no adjustable parameters
- Uses pre-tuned settings for optimal quality
- Particularly effective for clarity and detail enhancement

## Workflow JSON Structure

All workflow JSONs follow these conventions:

### Node Identification
```json
{
  "node_id": {
    "inputs": { ... },
    "class_type": "NodeClassName",
    "_meta": {
      "title": "unique_identifier"
    }
  }
}
```

### Common Node Types

**Input Nodes:**
- `ETN_LoadImageBase64` - Loads base64-encoded images
- `CLIPTextEncode` - Encodes text prompts

**Processing Nodes:**
- `KSampler` - Main sampling/generation node
- `VAEEncode/VAEDecode` - Latent space conversion
- `ModelSamplingDiscrete` - Sampling configuration
- `LoraLoader` - LoRA model loading
- `IPAdapterAdvanced` - Reference image guidance

**Output Nodes:**
- `SaveImage` - Saves result to ComfyUI output

### Dynamic Parameter Injection

The workflow classes use the `_meta.title` field to identify and modify nodes at runtime:

```typescript
private node(title: string): any {
    return this.workflow[this.id(title)];
}

// Example usage
this.node("positive_prompt").inputs.text = prompt;
this.node("load_source_image").inputs.image = encoded_image;
```

## Adding New Workflows

To add a new workflow:

1. **Create the workflow in ComfyUI:**
   - Design and test your workflow
   - Add `_meta.title` to all nodes that need runtime configuration
   - Export as API format JSON

2. **Add to `src/workflows/` directory:**
   - Use descriptive filename ending in `_api.json`
   - Ensure all dynamic nodes have unique titles

3. **Create or extend a workflow class:**
   ```typescript
   export class NewWorkflow {
       constructor(workflowJSON: any) { ... }
       run(params: ...) { ... }
   }
   ```

4. **Integrate with tools:**
   - Import workflow JSON
   - Instantiate workflow class
   - Call from appropriate tool

## Node Title Conventions

Standard node titles used across workflows:

- `positive_prompt` - Main text prompt
- `negative_prompt` - Negative text prompt
- `load_source_image` - Primary input image
- `load_mask` - Mask/alpha channel input
- `sampler` - Main KSampler node
- `load_sdxl_checkpoint` - SDXL model loader
- `load_flux_model` - Flux model loader
- `load_reference_image_N` - Reference images (N = 1, 2, 3...)
- `apply_ipadapter` - IP-Adapter application node

## Workflow Selection Logic

The `Img2Img` class automatically selects appropriate sub-workflows based on:

1. **Model type detection:**
   - Checks for PixArt nodes: `isPixart()`
   - Checks for Flux nodes: `isFlux()`
   - Falls back to SDXL workflows

2. **Feature availability:**
   - Reference images → IP-Adapter workflow
   - Mask present → Mask-enabled workflow
   - LoRAs selected → Adds LoRA chain dynamically

## WebSocket Integration

All workflows use the same execution pattern:

1. Configure workflow parameters
2. Submit to ComfyUI via HTTP POST to `/prompt`
3. Receive `prompt_id` in response
4. Listen on WebSocket for progress updates
5. Download result from `/view` endpoint

## Performance Considerations

- **Image sizing:** All images are padded/cropped to multiples of 64
- **Memory usage:** IP-Adapter and multiple reference images increase VRAM requirements
- **Processing time:** 
  - LCM accelerated: 6-10 steps
  - Standard SDXL: 20-50 steps
  - Flux Schnell: 4 steps
  - Flux Dev: 20 steps
  - Flux Kontext: 20 steps (fixed)

## Error Handling

Workflow errors are handled at multiple levels:

1. **Node validation:** ComfyUI validates node connections and parameters
2. **WebSocket timeout:** 1-hour maximum execution time
3. **Image loading:** Fallback to transparent image for missing masks
4. **Model availability:** Checked via `/object_info` endpoint