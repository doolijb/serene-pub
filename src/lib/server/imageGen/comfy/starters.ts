/**
 * The six starter workflows (DESIGN-image-generation §4.5 "Starter
 * workflows"), seeded as `workflows` rows by `seed_key` — never a fixed id.
 *
 * Each is written here as a plain ComfyUI API graph with ordinary literals,
 * then put through the same fitting walk a person's own export gets
 * (`fitComfyWorkflow` → `applyFit`), so a starter and an import cannot come
 * to different conclusions about where the holes go. A few starters adjust
 * the result afterwards — a cfg Flux needs left at 1, a sprite's fixed
 * background phrase, a cut-out's alpha decode chosen by `{{transparent}}` —
 * and say so beside the adjustment.
 *
 * Starters are read-only and refreshed on every boot; a person duplicates one
 * to change it.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { WorkflowVariable } from "$lib/shared/imageGen/types"
import { applyFit, fitComfyWorkflow } from "./fit"
import type { ComfyGraph } from "./graph"

export interface StarterWorkflow {
	seedKey: string
	name: string
	description: string
	document: string
	variables: WorkflowVariable[]
	outputNode: string | null
}

interface StarterSource {
	seedKey: string
	name: string
	description: string
	graph: ComfyGraph
	/** Holes the walk suggests that this starter keeps literal. */
	keepLiteral?: string[]
	/** A last textual adjustment of the document with holes. */
	adjust?: (document: string) => string
}

const NEGATIVE_DEFAULT = "lowres, blurry, bad anatomy, watermark, text"

const sdGraph = (ckpt: string, size: number, steps: number, sampler: string, scheduler: string): ComfyGraph => ({
	"3": {
		class_type: "KSampler",
		inputs: {
			seed: 0,
			steps,
			cfg: 7,
			sampler_name: sampler,
			scheduler,
			denoise: 1,
			model: ["4", 0],
			positive: ["6", 0],
			negative: ["7", 0],
			latent_image: ["5", 0]
		}
	},
	"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
	"5": { class_type: "EmptyLatentImage", inputs: { width: size, height: size, batch_size: 1 } },
	"6": { class_type: "CLIPTextEncode", inputs: { text: "a picture", clip: ["4", 1] } },
	"7": { class_type: "CLIPTextEncode", inputs: { text: NEGATIVE_DEFAULT, clip: ["4", 1] } },
	"8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
	"9": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["8", 0] } }
})

const fluxLoaders = (unet: ComfyGraph[string]): ComfyGraph => ({
	"1": unet,
	"2": {
		class_type: "DualCLIPLoader",
		inputs: {
			clip_name1: "t5xxl_fp8_e4m3fn.safetensors",
			clip_name2: "clip_l.safetensors",
			type: "flux"
		}
	},
	"3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } }
})

export const STARTER_SOURCES: readonly StarterSource[] = [
	{
		seedKey: "workflow-comfyui-sd15-txt2img",
		name: "SD 1.5 text-to-image",
		description:
			"The classic Stable Diffusion 1.5 graph: a prompt, a negative, a size. Core ComfyUI nodes only.",
		graph: sdGraph("v1-5-pruned-emaonly.safetensors", 512, 20, "euler", "normal")
	},
	{
		seedKey: "workflow-comfyui-sdxl-txt2img",
		name: "SDXL text-to-image",
		description: "Stable Diffusion XL at 1024 pixels. Core ComfyUI nodes only.",
		graph: sdGraph("sd_xl_base_1.0.safetensors", 1024, 25, "dpmpp_2m", "karras")
	},
	{
		seedKey: "workflow-comfyui-flux-gguf-txt2img",
		name: "Flux (GGUF) text-to-image",
		description:
			"Flux from a GGUF file. Needs the ComfyUI-GGUF custom nodes (UnetLoaderGGUF). Flux takes no negative prompt.",
		graph: {
			...fluxLoaders({
				class_type: "UnetLoaderGGUF",
				inputs: { unet_name: "flux1-dev-Q4_K_S.gguf" }
			}),
			"4": { class_type: "CLIPTextEncode", inputs: { text: "a picture", clip: ["2", 0] } },
			"5": { class_type: "FluxGuidance", inputs: { conditioning: ["4", 0], guidance: 3.5 } },
			"6": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
			"7": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
			"8": {
				class_type: "KSampler",
				inputs: {
					seed: 0,
					steps: 20,
					cfg: 1,
					sampler_name: "euler",
					scheduler: "simple",
					denoise: 1,
					model: ["1", 0],
					positive: ["5", 0],
					negative: ["6", 0],
					latent_image: ["7", 0]
				}
			},
			"9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
			"10": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["9", 0] } }
		},
		// Flux is distilled: its guidance is FluxGuidance, and cfg stays 1.
		keepLiteral: ["8.cfg"]
	},
	{
		seedKey: "workflow-comfyui-flux-kontext-reference",
		name: "Flux Kontext with reference",
		description:
			"Draws from one reference picture with Flux Kontext (ReferenceLatent). Core ComfyUI nodes, recent ComfyUI.",
		graph: {
			...fluxLoaders({
				class_type: "UNETLoader",
				inputs: { unet_name: "flux1-dev-kontext_fp8_scaled.safetensors", weight_dtype: "default" }
			}),
			"4": { class_type: "LoadImage", inputs: { image: "reference.png" } },
			"5": { class_type: "FluxKontextImageScale", inputs: { image: ["4", 0] } },
			"6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["3", 0] } },
			"7": { class_type: "CLIPTextEncode", inputs: { text: "a picture", clip: ["2", 0] } },
			"8": { class_type: "ReferenceLatent", inputs: { conditioning: ["7", 0], latent: ["6", 0] } },
			"9": { class_type: "FluxGuidance", inputs: { conditioning: ["8", 0], guidance: 2.5 } },
			"10": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["7", 0] } },
			"11": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
			"12": {
				class_type: "KSampler",
				inputs: {
					seed: 0,
					steps: 20,
					cfg: 1,
					sampler_name: "euler",
					scheduler: "simple",
					denoise: 1,
					model: ["1", 0],
					positive: ["9", 0],
					negative: ["10", 0],
					latent_image: ["11", 0]
				}
			},
			"13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["3", 0] } },
			"14": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["13", 0] } }
		},
		keepLiteral: ["12.cfg"]
	},
	{
		seedKey: "workflow-comfyui-sdxl-ipadapter-sprite",
		name: "SDXL + IP-Adapter sprite (plain background)",
		description:
			"A full-body character on a plain green background, kept like the reference picture. Needs the ComfyUI_IPAdapter_plus custom nodes and their SDXL models.",
		graph: {
			"1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
			"2": { class_type: "IPAdapterUnifiedLoader", inputs: { model: ["1", 0], preset: "PLUS (high strength)" } },
			"3": { class_type: "LoadImage", inputs: { image: "reference.png" } },
			"4": {
				class_type: "IPAdapter",
				inputs: {
					model: ["2", 0],
					ipadapter: ["2", 1],
					image: ["3", 0],
					weight: 0.8,
					start_at: 0,
					end_at: 1,
					weight_type: "standard"
				}
			},
			"5": { class_type: "CLIPTextEncode", inputs: { text: "a character", clip: ["1", 1] } },
			"6": {
				class_type: "CLIPTextEncode",
				inputs: { text: `${NEGATIVE_DEFAULT}, scenery, background details, shadow`, clip: ["1", 1] }
			},
			"7": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
			"8": {
				class_type: "KSampler",
				inputs: {
					seed: 0,
					steps: 25,
					cfg: 6,
					sampler_name: "dpmpp_2m",
					scheduler: "karras",
					denoise: 1,
					model: ["4", 0],
					positive: ["5", 0],
					negative: ["6", 0],
					latent_image: ["7", 0]
				}
			},
			"9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["1", 2] } },
			"10": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["9", 0] } }
		},
		// The plain background is what makes the cut-out step trivial (§1.9):
		// part of this graph, not of anybody's prompt.
		adjust: (doc) =>
			doc.replace(
				'"text": "{{prompt}}"',
				'"text": "{{prompt}}, full body, standing, centered, plain flat green background"'
			)
	},
	{
		seedKey: "workflow-comfyui-sdxl-layerdiffuse-cutout",
		name: "SDXL + LayerDiffuse cut-out",
		description:
			"Draws with a transparent background, no cut-out step needed. Needs the ComfyUI-layerdiffuse custom nodes.",
		graph: {
			"1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
			"2": {
				class_type: "LayeredDiffusionApply",
				inputs: { model: ["1", 0], config: "SDXL, Conv Injection", weight: 1 }
			},
			"3": { class_type: "CLIPTextEncode", inputs: { text: "a character", clip: ["1", 1] } },
			"4": { class_type: "CLIPTextEncode", inputs: { text: NEGATIVE_DEFAULT, clip: ["1", 1] } },
			"5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
			"6": {
				class_type: "KSampler",
				inputs: {
					seed: 0,
					steps: 25,
					cfg: 7,
					sampler_name: "dpmpp_2m",
					scheduler: "karras",
					denoise: 1,
					model: ["2", 0],
					positive: ["3", 0],
					negative: ["4", 0],
					latent_image: ["5", 0]
				}
			},
			"7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
			"8": {
				class_type: "LayeredDiffusionDecodeRGBA",
				inputs: { samples: ["6", 0], images: ["7", 0], sd_version: "SDXL", sub_batch_size: 16 }
			},
			"9": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["8", 0] } }
		},
		// The output reads `{{transparent}}`: the alpha decode when a
		// transparent background is asked for, the plain decode otherwise —
		// which is what makes this graph's sheet say `transparent: native`.
		adjust: (doc) =>
			doc.replace(
				/("images": )\[\s*"8",\s*0\s*\]/,
				'$1[{{#if transparent}}"8"{{else}}"7"{{/if}}, 0]'
			)
	}
]

/** Build one starter's row content through the fitting walk. */
export function buildStarter(source: StarterSource): StarterWorkflow {
	const proposal = fitComfyWorkflow(source.graph)
	const keep = new Set(source.keepLiteral ?? [])
	const chosen = proposal.holes
		.filter((h) => h.suggested && !keep.has(`${h.nodeId}.${h.inputKey}`))
		.map((h) => `${h.nodeId}.${h.inputKey}`)
	const applied = applyFit(source.graph, proposal, chosen)
	return {
		seedKey: source.seedKey,
		name: source.name,
		description: source.description,
		document: source.adjust ? source.adjust(applied.document) : applied.document,
		variables: applied.variables,
		outputNode: applied.outputNode
	}
}

export const STARTER_WORKFLOWS: readonly StarterWorkflow[] = STARTER_SOURCES.map(buildStarter)

/**
 * Write the starters, matched by `seed_key`. Insert what is missing; refresh
 * what exists — safe because a starter is read-only (the handlers refuse
 * edits), so there is no person's change for the refresh to undo.
 */
export async function seedWorkflows(db: Db): Promise<void> {
	const existing = await db
		.select({ id: schema.workflows.id, seedKey: schema.workflows.seedKey })
		.from(schema.workflows)
	for (const starter of STARTER_WORKFLOWS) {
		const found = existing.find((w) => w.seedKey === starter.seedKey)
		const data = {
			seedKey: starter.seedKey,
			name: starter.name,
			description: starter.description,
			dialect: "comfyui",
			document: starter.document,
			variables: starter.variables,
			outputNode: starter.outputNode
		}
		const same =
			found &&
			(await db.query.workflows.findFirst({ where: (w, { eq }) => eq(w.id, found.id) }).then(
				(row) =>
					!!row &&
					row.name === data.name &&
					row.description === data.description &&
					row.document === data.document &&
					row.outputNode === data.outputNode &&
					JSON.stringify(row.variables) === JSON.stringify(data.variables)
			))
		if (same) continue
		if (found)
			await db
				.update(schema.workflows)
				.set({ ...data, updatedAt: new Date() })
				.where(eq(schema.workflows.id, found.id))
		else await db.insert(schema.workflows).values(data)
	}
}
