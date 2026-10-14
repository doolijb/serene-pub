/**
 * A person's own export, as ComfyUI's "Export (API)" writes it: SDXL with an
 * IP-Adapter reference, a second sampler pass, a LoRA and a preview node —
 * the shapes the fitting walk has to tell apart.
 */
import type { ComfyGraph } from "../graph"

export const SDXL_IPADAPTER_EXPORT: ComfyGraph = {
	"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "juggernautXL_v9.safetensors" } },
	"10": {
		class_type: "LoraLoader",
		inputs: {
			model: ["4", 0],
			clip: ["4", 1],
			lora_name: "pixel-art-xl.safetensors",
			strength_model: 0.7,
			strength_clip: 0.7
		}
	},
	"11": { class_type: "IPAdapterUnifiedLoader", inputs: { model: ["10", 0], preset: "PLUS (high strength)" } },
	"12": { class_type: "LoadImage", inputs: { image: "hero_reference.png", upload: "image" } },
	"13": {
		class_type: "IPAdapter",
		inputs: {
			model: ["11", 0],
			ipadapter: ["11", 1],
			image: ["12", 0],
			weight: 0.85,
			start_at: 0,
			end_at: 1,
			weight_type: "standard"
		}
	},
	"6": { class_type: "CLIPTextEncode", inputs: { text: "a knight, smiling", clip: ["10", 1] } },
	"7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, text", clip: ["10", 1] } },
	"5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
	"3": {
		class_type: "KSampler",
		inputs: {
			seed: 123456,
			steps: 30,
			cfg: 6.5,
			sampler_name: "dpmpp_2m",
			scheduler: "karras",
			denoise: 1,
			model: ["13", 0],
			positive: ["6", 0],
			negative: ["7", 0],
			latent_image: ["5", 0]
		}
	},
	"8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
	"20": { class_type: "PreviewImage", inputs: { images: ["8", 0] } },
	"21": { class_type: "LatentUpscaleBy", inputs: { samples: ["3", 0], upscale_method: "nearest-exact", scale_by: 1.5 } },
	"22": {
		class_type: "KSampler",
		inputs: {
			seed: 123456,
			steps: 15,
			cfg: 6.5,
			sampler_name: "dpmpp_2m",
			scheduler: "karras",
			denoise: 0.45,
			model: ["13", 0],
			positive: ["6", 0],
			negative: ["7", 0],
			latent_image: ["21", 0]
		}
	},
	"23": { class_type: "VAEDecode", inputs: { samples: ["22", 0], vae: ["4", 2] } },
	"9": { class_type: "SaveImage", inputs: { filename_prefix: "knight", images: ["23", 0] } },
	"24": { class_type: "SaveImage", inputs: { filename_prefix: "knight_lowres", images: ["8", 0] } }
}
