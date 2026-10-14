/**
 * The **NovelAI dialect** — `POST https://image.novelai.net/ai/generate-image`
 * (DESIGN-image-generation §1.7, §4.4).
 *
 * Anime-trained diffusion (V4.5, V5) behind a subscription key (`pst-…`).
 * The answer is a ZIP holding `image_0.png`, `image_1.png`…; it is unpacked
 * here, never handed on.
 *
 * ## V4 and later need the structured prompt
 *
 * From V4 the service reads `v4_prompt` and `v4_negative_prompt` — a caption
 * object with per-character captions — and answers 500 without them. The
 * plain `input` and `negative_prompt` are still sent beside them.
 *
 * ## References are character references
 *
 * A likeness rides `director_reference_images` with its matching
 * `_descriptions`, `_information_extracted`, `_strength_values` and
 * `_secondary_strength_values` arrays (field names read from the
 * `nekoai-js` client, 2026-10; NovelAI publishes no reference for them).
 * The service prefers references of 1024×1536, 1536×1024 or 1472×1472; others
 * are sent as they are.
 *
 * ## Expressions
 *
 * `POST /ai/augment-image` with `req_type: "emotion"` redraws a finished
 * picture with another facial expression — the one backend that can change a
 * sprite's expression without redrawing the character. `expressImage(ref,
 * label)` is that call; the sheet's `expressions: true` says it exists.
 *
 * ## Not here
 *
 * Transparency: V5's native alpha output is not documented anywhere this
 * build could verify, so the sheet says `transparent: "none"` and a cut-out
 * falls to the host. NovelAI has no moderation refusal to report.
 */
import {
	BaseImageAdapter,
	Translation,
	type DrawingSheet,
	type GeneratedMediaItem,
	type ImageAdapterExports,
	type ImageGenOptions,
	type ImageGenRequest,
	type ImageGenResult
} from "./BaseImageAdapter"
import type { ImageEditRequest } from "$lib/server/adapters/actions"
import type { MediaRef, SettingsSchema } from "@serene-pub/sdk"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import {
	editAsGenerate,
	imagePixelSize,
	readFailure,
	sniffImageMime,
	unzip
} from "./hostedImageHelpers"

const DEFAULT_BASE_URL = "https://image.novelai.net"
/** The account API, for the key test. */
const ACCOUNT_API = "https://api.novelai.net"

/** The image models, newest first (2026-10). */
export const NOVELAI_IMAGE_MODELS = [
	{ id: "nai-diffusion-5-full", name: "NAI Diffusion V5 Full" },
	{ id: "nai-diffusion-5-curated", name: "NAI Diffusion V5 Curated" },
	{ id: "nai-diffusion-4-5-full", name: "NAI Diffusion V4.5 Full" },
	{ id: "nai-diffusion-4-5-curated", name: "NAI Diffusion V4.5 Curated" }
] as const
export const NOVELAI_DEFAULT_IMAGE_MODEL = "nai-diffusion-5-full"

/** The expressions `augment-image` knows (`req_type: "emotion"`). */
export const NOVELAI_EXPRESSIONS = [
	"neutral",
	"happy",
	"sad",
	"angry",
	"scared",
	"surprised",
	"tired",
	"excited",
	"nervous",
	"thinking",
	"confused",
	"shy",
	"disgusted",
	"smug",
	"bored",
	"laughing",
	"irritated",
	"aroused",
	"embarrassed",
	"worried",
	"love",
	"determined",
	"hurt",
	"playful"
] as const

/**
 * The standard sprite labels (`STANDARD_SPRITE_LABELS`) as the nearest
 * expression `augment-image` knows. Two vocabularies, reconciled here at the
 * boundary (R5): a label NovelAI already knows passes through unchanged.
 */
const SPRITE_LABEL_EXPRESSIONS: Readonly<Record<string, (typeof NOVELAI_EXPRESSIONS)[number]>> = {
	admiration: "happy",
	amusement: "laughing",
	anger: "angry",
	annoyance: "irritated",
	approval: "happy",
	caring: "love",
	confusion: "confused",
	curiosity: "thinking",
	desire: "love",
	disappointment: "sad",
	disapproval: "irritated",
	disgust: "disgusted",
	embarrassment: "embarrassed",
	excitement: "excited",
	fear: "scared",
	gratitude: "happy",
	grief: "sad",
	joy: "happy",
	love: "love",
	nervousness: "nervous",
	optimism: "determined",
	pride: "smug",
	realization: "surprised",
	relief: "happy",
	remorse: "sad",
	sadness: "sad",
	surprise: "surprised",
	neutral: "neutral"
}

/** The NovelAI expression for a sprite label, or null when it has none. */
export function novelAIExpressionFor(label: string): string | null {
	const key = label.trim().toLowerCase()
	if ((NOVELAI_EXPRESSIONS as readonly string[]).includes(key)) return key
	return SPRITE_LABEL_EXPRESSIONS[key] ?? null
}

export const NOVELAI_SAMPLERS = [
	"k_euler_ancestral",
	"k_euler",
	"k_dpmpp_2s_ancestral",
	"k_dpmpp_2m_sde",
	"k_dpmpp_2m",
	"k_dpmpp_sde"
] as const

const SAMPLER_ALIASES: Record<string, string> = {
	"euler a": "k_euler_ancestral",
	euler_a: "k_euler_ancestral",
	euler: "k_euler",
	"dpm++ 2s a": "k_dpmpp_2s_ancestral",
	"dpm++ 2m sde": "k_dpmpp_2m_sde",
	"dpm++ 2m": "k_dpmpp_2m",
	"dpm++ sde": "k_dpmpp_sde"
}

export function novelAISampler(name: string | undefined): string | null {
	if (!name) return null
	if ((NOVELAI_SAMPLERS as readonly string[]).includes(name)) return name
	return SAMPLER_ALIASES[name.trim().toLowerCase().replace(/\s+karras$/, "")] ?? null
}

/** V4 and later read the structured prompt; older models do not. */
export const isV4Plus = (model: string) => /nai-diffusion-(4|5|[6-9])/.test(model)

// ── The sheet ───────────────────────────────────────────────────────────────

export const NOVELAI_SHEET: DrawingSheet = {
	negative: true,
	seed: true,
	steps: true,
	cfg: true,
	sampler: true,
	clipSkip: false,
	size: { kind: "free", step: 64, min: 64, max: 1792 },
	references: { max: 4 },
	init: true,
	mask: true,
	transparent: "none",
	// `n_samples`: up to four at the normal sizes.
	perCall: 4,
	outputs: { perRun: 1, keyed: false },
	progress: false,
	preview: false,
	cancel: true,
	video: false,
	expressions: true
}

// ── Profile ─────────────────────────────────────────────────────────────────

const PROFILE_SCHEMA: SettingsSchema = {
	ucPreset: {
		type: "enum",
		of: ["0", "1", "2", "3"],
		label: "Undesired content preset",
		description:
			"NovelAI's built-in negative prompt: 0 Heavy, 1 Light, 2 Furry focus / Human focus (by model), 3 None.",
		default: "0"
	},
	qualityToggle: {
		type: "boolean",
		label: "Add quality tags",
		description: "Lets NovelAI append its quality tags to every prompt.",
		default: true
	},
	noiseSchedule: {
		type: "enum",
		of: ["karras", "exponential", "polyexponential"],
		label: "Noise schedule",
		default: "karras"
	},
	cfgRescale: {
		type: "number",
		label: "Prompt guidance rescale",
		description: "0–1. Tames the oversaturation a high guidance causes.",
		min: 0,
		max: 1,
		default: 0
	},
	sm: {
		type: "boolean",
		label: "SMEA",
		description: "V3 models only; V4 and later ignore it and the receipt says so.",
		default: false
	},
	smDyn: {
		type: "boolean",
		label: "SMEA DYN",
		description: "V3 models only, with SMEA on.",
		default: false
	},
	referenceStyle: {
		type: "boolean",
		label: "References carry style",
		description:
			"Off copies only the character from a reference picture; on copies its art style too.",
		default: false
	}
}

const PROFILE_DEFAULTS = {
	ucPreset: "0" as string,
	qualityToggle: true,
	noiseSchedule: "karras" as string,
	cfgRescale: 0,
	sm: false,
	smDyn: false,
	referenceStyle: false
}

// ── The adapter ─────────────────────────────────────────────────────────────

function root(connection: { baseUrl?: string | null }): string {
	return (normalizeBaseUrl(connection.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

function bearer(apiKey: unknown): Record<string, string> {
	const key = decryptApiKeyField(apiKey)
	return key ? { Authorization: `Bearer ${key}` } : {}
}

/** The pictures in an answer's ZIP, in `image_N` order. */
export function novelAIPictures(bytes: Uint8Array): Array<{ base64: string; mime: string }> {
	const files = [...unzip(bytes).entries()].sort(([a], [b]) =>
		a.localeCompare(b, undefined, { numeric: true })
	)
	return files
		.filter(([name]) => /\.(png|jpe?g|webp)$/i.test(name))
		.map(([, data]) => ({ base64: Buffer.from(data).toString("base64"), mime: sniffImageMime(data) }))
}

class NovelAIImageAdapter extends BaseImageAdapter {
	async generateImage(
		req: ImageGenRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const signal = this.linkAbort(opts.signal)
		const t = new Translation()
		if (signal.aborted) return { media: [], isAborted: true, applied: [], ignored: [] }

		const conn = this.connection
		const sheet = NOVELAI_SHEET
		const model = req.model ?? conn.model ?? NOVELAI_DEFAULT_IMAGE_MODEL
		if (req.model) t.apply("model", true)
		const v4 = isV4Plus(model)
		const profile = this.profile(PROFILE_DEFAULTS)
		const p: Record<string, unknown> = {
			params_version: 3,
			add_original_image: true,
			legacy: false,
			legacy_v3_extend: false,
			qualityToggle: !!profile.qualityToggle,
			ucPreset: Number(profile.ucPreset) || 0,
			noise_schedule: profile.noiseSchedule,
			cfg_rescale: Number(profile.cfgRescale) || 0
		}

		const prompt = t.apply("prompt", req.prompt)
		const negative = req.negativePrompt ? t.apply("negativePrompt", req.negativePrompt) : ""
		p.negative_prompt = negative

		// ── Count and size ──────────────────────────────────────────────────
		const asked = t.take("batch", req.batch) ?? 1
		const n = Math.max(1, Math.min(asked, sheet.perCall))
		if (n < asked) t.ignore("batch")
		p.n_samples = n
		if (sheet.size.kind === "free") {
			const { step, min, max } = sheet.size
			for (const key of ["width", "height"] as const) {
				const v = req[key]
				if (v === undefined) continue
				if (v % step === 0 && v >= min && v <= max) p[key] = t.apply(key, v)
				else t.ignore(key)
			}
		}
		p.width ??= 832
		p.height ??= 1216
		if (req.aspect && !req.width && !req.height) t.ignore("aspect")

		// ── Knobs ───────────────────────────────────────────────────────────
		const steps = t.take("steps", req.steps)
		p.steps = steps ?? 28
		const cfg = t.take("cfg", req.cfg)
		p.scale = cfg ?? 5
		const seed =
			t.take("seed", req.seed !== undefined && req.seed >= 0 ? req.seed : undefined) ??
			Math.floor(Math.random() * 4_294_967_288)
		p.seed = seed
		if (req.sampler) {
			const s = novelAISampler(req.sampler)
			if (s) p.sampler = t.apply("sampler", s)
			else t.ignore("sampler")
		}
		p.sampler ??= "k_euler_ancestral"
		t.take("scheduler", req.scheduler, false)
		t.take("clipSkip", req.clipSkip, false)
		t.take("transparent", req.transparent || undefined, false)
		t.take("outputFormat", req.outputFormat, false)
		t.take("video", req.video, false)
		if (v4) {
			if (profile.sm) t.ignore("sm")
			if (profile.smDyn) t.ignore("smDyn")
		} else {
			p.sm = !!profile.sm
			p.sm_dyn = !!profile.sm && !!profile.smDyn
		}
		if (v4) {
			p.v4_prompt = {
				caption: { base_caption: prompt, char_captions: [] },
				use_coords: false,
				use_order: true
			}
			p.v4_negative_prompt = {
				caption: { base_caption: negative, char_captions: [] },
				legacy_uc: false
			}
		}

		// ── Pictures in ─────────────────────────────────────────────────────
		let action = "generate"
		let wireModel = model
		if (req.init) {
			const [b64] = await this.base64Of([req.init], "init", t, opts)
			if (b64) {
				action = "img2img"
				p.image = b64
				p.strength = req.denoise !== undefined ? t.apply("denoise", req.denoise) : 0.7
				p.noise = 0
				p.extra_noise_seed = seed
			}
		} else if (req.denoise !== undefined) t.ignore("denoise")
		if (req.mask) {
			if (action !== "img2img") t.ignore("mask")
			else {
				const [m] = await this.base64Of([req.mask], "mask", t, opts)
				if (m) {
					action = "infill"
					p.mask = m
					wireModel = model.endsWith("-inpainting") ? model : `${model}-inpainting`
				}
			}
		}
		if (req.references?.length) {
			const take = req.references.slice(0, sheet.references!.max)
			const loaded = await this.base64Of(take, "references", t, opts)
			if (loaded.length) {
				const caption = profile.referenceStyle ? "character&style" : "character"
				p.director_reference_images = loaded
				p.director_reference_descriptions = loaded.map(() => ({
					caption: { base_caption: caption, char_captions: [] },
					legacy_uc: false
				}))
				p.director_reference_information_extracted = loaded.map(() => 1)
				p.director_reference_strength_values = loaded.map(() => 1)
				p.director_reference_secondary_strength_values = loaded.map(() => 1)
			}
			if (take.length < req.references.length) t.ignore("references")
		}

		const body = { input: prompt, model: wireModel, action, parameters: p }
		opts.onProgress?.({ stage: "queued", percent: 0 })
		const bytes = await this.post(`${root(conn)}/ai/generate-image`, body, signal)
		if (!bytes) return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }

		const pictures = novelAIPictures(bytes)
		const media: GeneratedMediaItem[] = pictures.map((pic, i) => ({
			kind: "image",
			mime: pic.mime,
			base64: pic.base64,
			// NovelAI draws sample i with seed + i.
			seed: seed + i,
			meta: { backend: "novelai", model: wireModel, action }
		}))
		if (!media.length) throw new Error("NovelAI completed without returning an image.")
		if (media.length < n) t.ignore("batch")
		opts.onProgress?.({ stage: "saving", percent: 100 })
		return { media, isAborted: false, applied: t.applied, ignored: t.ignored }
	}

	async editImage(req: ImageEditRequest, opts: ImageGenOptions = {}): Promise<ImageGenResult> {
		return this.generateImage(editAsGenerate(req), opts)
	}

	/**
	 * 🚧 Redraw `ref` with the expression `label` (one of
	 * `NOVELAI_EXPRESSIONS`, or a standard sprite label mapped to one by
	 * `novelAIExpressionFor`), keeping the rest of the picture — the sheet's
	 * `expressions`. Not an action in the transform table: the Sprites tab's
	 * **Re-express from neutral** calls it (`sprites/reexpress.ts`, §6.3).
	 */
	async expressImage(
		ref: MediaRef,
		label: string,
		opts: ImageGenOptions & { prompt?: string; strength?: number } = {}
	): Promise<ImageGenResult> {
		const expression = novelAIExpressionFor(label)
		if (!expression)
			throw new Error(
				`NovelAI cannot draw the expression "${label}". It knows: ${NOVELAI_EXPRESSIONS.join(", ")}.`
			)
		const signal = this.linkAbort(opts.signal)
		const t = new Translation()
		if (!opts.loadMedia) throw new Error("No picture loader was handed to the expression call.")
		const { bytes } = await opts.loadMedia(ref)
		const size = imagePixelSize(bytes)
		if (!size) throw new Error("The picture's size could not be read (PNG, JPEG or WebP only).")
		t.apply("init", true)
		t.apply("expression", expression)
		const body = {
			req_type: "emotion",
			width: size.width,
			height: size.height,
			image: Buffer.from(bytes).toString("base64"),
			prompt: `${expression};;${opts.prompt ?? ""}`,
			// 0 is the full change; 5 the weakest.
			defry: Math.max(0, Math.min(5, Math.round(opts.strength ?? 0)))
		}
		opts.onProgress?.({ stage: "queued", percent: 0 })
		const out = await this.post(`${root(this.connection)}/ai/augment-image`, body, signal)
		if (!out) return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
		const pictures = novelAIPictures(out)
		if (!pictures.length) throw new Error("NovelAI completed without returning an image.")
		opts.onProgress?.({ stage: "saving", percent: 100 })
		return {
			media: pictures.map((pic) => ({
				kind: "image",
				mime: pic.mime,
				base64: pic.base64,
				meta: { backend: "novelai", tool: "emotion", expression }
			})),
			isAborted: false,
			applied: t.applied,
			ignored: t.ignored
		}
	}

	/** POST JSON, answer the ZIP's bytes; `null` when aborted. */
	private async post(url: string, body: unknown, signal: AbortSignal): Promise<Uint8Array | null> {
		let res: Response
		try {
			res = await fetch(url, {
				method: "POST",
				headers: {
					...bearer((this.connection.extraJson as any)?.apiKey),
					"Content-Type": "application/json",
					Accept: "application/zip"
				},
				body: JSON.stringify(body),
				signal
			})
		} catch (e) {
			if (signal.aborted) return null
			throw new Error(`Image request failed: ${e instanceof Error ? e.message : String(e)}`)
		}
		if (!res.ok) {
			const { text, body: err } = await readFailure(res)
			const said = err?.message
			throw new Error(
				res.status === 401
					? "NovelAI refused the key. Check that it is a persistent API token (pst-…)."
					: res.status === 402
						? "NovelAI says this account needs an active subscription or more Anlas for this picture."
						: `Image generation failed (${res.status}): ${typeof said === "string" && said ? said : text.slice(0, 300)}`
			)
		}
		try {
			return new Uint8Array(await res.arrayBuffer())
		} catch (e) {
			if (signal.aborted) return null
			throw e
		}
	}
}

// ── Listing and testing ─────────────────────────────────────────────────────

async function listModels(_connection: SelectConnection) {
	return {
		models: NOVELAI_IMAGE_MODELS.map((m) => ({ id: m.id, name: m.name, modality: "image-gen" as const }))
	}
}

async function testConnection(connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	const headers = bearer((connection.extraJson as any)?.apiKey)
	if (!headers.Authorization) return { ok: false, error: "NovelAI needs an API key." }
	try {
		const res = await fetch(`${ACCOUNT_API}/user/subscription`, { headers })
		if (res.status === 401) return { ok: false, error: "NovelAI does not accept this key." }
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
		const sub = (await res.json()) as any
		const steps = sub?.trainingStepsLeft ?? {}
		const anlas =
			(Number(steps.fixedTrainingStepsLeft) || 0) + (Number(steps.purchasedTrainingSteps) || 0)
		return {
			ok: true,
			extra: {
				imageModels: NOVELAI_IMAGE_MODELS.map((m) => m.id),
				subscriptionActive: !!sub?.active,
				anlas,
				capabilities: { "text->image": "native", "text+image->image": "native" }
			}
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

const exports: ImageAdapterExports = {
	Adapter: NovelAIImageAdapter,
	listModels,
	testConnection,
	sheet: NOVELAI_SHEET,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

export default exports
