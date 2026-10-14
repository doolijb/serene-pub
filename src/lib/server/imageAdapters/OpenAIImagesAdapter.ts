/**
 * The **OpenAI-images dialect** — `POST {base}/images/generations` and
 * `POST {base}/images/edits` (DESIGN-image-generation §1.7, §4.4).
 *
 * One module, the services that speak this shape: OpenAI itself (`gpt-image-*`,
 * `dall-e-*`), xAI (`grok-imagine-*`, an aspect ratio instead of a size),
 * Together (adds `negative_prompt`, `steps`, `seed`, `width`/`height`) and any
 * OpenAI-compatible server that answers `/v1/images/generations` (KoboldCPP,
 * LocalAI, text-generation-webui). All of them are the OPENAI connection type
 * with a different preset, so the drawing sheet is chosen per connection —
 * preset first, then the address, then the model id — by `openAIImagesSheetFor`.
 *
 * ## What this wire has and has not
 *
 * gpt-image has no negative prompt, seed, steps, CFG or sampler. Those are
 * reported ignored rather than refused (the Vercel rule the sheet keeps), and
 * the sheet says so before the run so the sampling form greys them. What it
 * does have that the SD family lacks lives on the connection's PROFILE:
 * `quality`, `moderation`, `outputCompression`.
 *
 * ## The route is picked by the inputs
 *
 * Reference images, a starting canvas or a mask send the request to `/edits`
 * as multipart — the canvas first (it is "reference 0", and the first image is
 * the one gpt-image preserves most faithfully), then the references; the mask
 * applies to that first image. Nothing to work from, `/generations` as JSON.
 *
 * ## A refusal is not a failure
 *
 * A moderation block (`moderation_blocked`) comes back as a `refusal` with the
 * provider's `moderation_details` verbatim and `noRetry: true`: the same prompt
 * is refused again and every attempt is billed, so the host stops the series.
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
import type { SettingsSchema, MediaRef } from "@serene-pub/sdk"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"

const DEFAULT_BASE_URL = "https://api.openai.com/v1"
/** What OpenAI draws with when the pair names no model. */
export const OPENAI_DEFAULT_IMAGE_MODEL = "gpt-image-2.5-sunburst"
const XAI_DEFAULT_IMAGE_MODEL = "grok-imagine-image-2.0"

/** The most one prompt may be, in characters. */
const MAX_PROMPT_CHARS = 32_000

// ── Which service, which model ─────────────────────────────────────────────

/** The services behind this one wire whose sheets differ. */
export type OpenAIImagesService = "openai" | "xai" | "together" | "compatible"

interface SheetSubject {
	type?: string
	model?: string | null
	preset?: string | null
	baseUrl?: string | null
}

const hostOf = (baseUrl: string | null | undefined): string => {
	try {
		return new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase()
	} catch {
		return ""
	}
}

/**
 * Which service a connection reaches: its preset says so, or its address
 * does whatever the preset. An empty address is OpenAI's own (the adapter's
 * default base URL).
 */
export function openAIImagesService(c: SheetSubject): OpenAIImagesService {
	if (c.preset === "openai-official") return "openai"
	if (c.preset === "xai-grok") return "xai"
	if (c.preset === "together-ai") return "together"
	const host = hostOf(c.baseUrl)
	const under = (d: string) => host === d || host.endsWith(`.${d}`)
	if (!normalizeBaseUrl(c.baseUrl) || host === "api.openai.com") return "openai"
	if (under("x.ai")) return "xai"
	if (under("together.xyz") || under("together.ai")) return "together"
	return "compatible"
}

/**
 * A gpt-image model id read for what it can do. `version` is the number after
 * `gpt-image-` (1, 1.5, 2, 2.5); `mini` marks the reduced variant.
 */
export function gptImageModel(
	model: string | null | undefined
): { version: number; mini: boolean } | null {
	const m = /^gpt-image-(\d+(?:\.\d+)?)(.*)$/i.exec(model?.trim() ?? "")
	if (!m) return null
	const version = Number(m[1])
	if (!Number.isFinite(version)) return null
	return { version, mini: /(^|-)mini(-|$)/i.test(m[2] ?? "") }
}

/** Ids this module treats as image models when a listing says nothing. */
export function isOpenAIImageModelId(id: string | null | undefined): boolean {
	const s = (id ?? "").trim().toLowerCase()
	return (
		s.startsWith("gpt-image") ||
		s.startsWith("dall-e") ||
		s.startsWith("grok-imagine-image") ||
		s.endsWith("-image") ||
		// Gemini's image models on a `google-gemini` connection, which the
		// Gemini image dialect draws with (`GeminiImageAdapter`).
		s.includes("nano-banana")
	)
}

// ── The sheets ──────────────────────────────────────────────────────────────

const NO_KNOBS = {
	negative: false,
	seed: false,
	steps: false,
	cfg: false,
	sampler: false,
	clipSkip: false
} as const

/** gpt-image-1, 1.5 and 1-mini: three sizes, or `auto`. */
export const GPT_IMAGE_1_SHEET: DrawingSheet = {
	...NO_KNOBS,
	size: { kind: "enum", sizes: ["1024x1024", "1536x1024", "1024x1536"] },
	references: { max: 16 },
	init: true,
	mask: true,
	transparent: "native",
	perCall: 10,
	outputs: { perRun: 1, keyed: false },
	progress: false,
	preview: false,
	// The fetch is aborted; nothing else to stop.
	cancel: true,
	video: false
}

export const GPT_IMAGE_1_MINI_SHEET: DrawingSheet = {
	...GPT_IMAGE_1_SHEET,
	references: { max: 1 }
}

/**
 * gpt-image-2 and later: any `WxH` on a 16-pixel grid, aspect between 1:3
 * and 3:1, 655,360–8,294,400 pixels in all. The per-side bounds follow from
 * those two (a 3:1 at the floor is ~464 px tall; 3840 is the 4K edge).
 */
export const GPT_IMAGE_2_SHEET: DrawingSheet = {
	...GPT_IMAGE_1_SHEET,
	size: {
		kind: "free",
		step: 16,
		min: 464,
		max: 3840,
		minPixels: 655_360,
		maxPixels: 8_294_400,
		maxRatio: 3
	}
}

/** DALL·E 3: one picture a call, three sizes, no edits, no transparency. */
export const DALL_E_3_SHEET: DrawingSheet = {
	...GPT_IMAGE_1_SHEET,
	size: { kind: "enum", sizes: ["1024x1024", "1792x1024", "1024x1792"] },
	references: null,
	init: false,
	mask: false,
	transparent: "none",
	perCall: 1
}

/** DALL·E 2: three squares; edits take one canvas and a mask. */
export const DALL_E_2_SHEET: DrawingSheet = {
	...GPT_IMAGE_1_SHEET,
	size: { kind: "enum", sizes: ["256x256", "512x512", "1024x1024"] },
	references: null,
	transparent: "none"
}

/**
 * xAI (`grok-imagine-image-*`): an aspect ratio and a resolution tier rather
 * than a size. Edits are not wired here — the sheet says no canvas and no
 * references, so a likeness is reported before the run rather than dropped.
 */
/**
 * The resolution tier an aspect sheet's request asks for, from the long edge
 * of the fitted size: `2k` at 1536 pixels or more, else `1k` — whichever of
 * the two the sheet lists.
 */
export function resolutionTier(longEdge: number, tiers: readonly string[]): string | null {
	const want = longEdge >= 1536 ? "2k" : "1k"
	return tiers.includes(want) ? want : null
}

export const XAI_IMAGES_SHEET: DrawingSheet = {
	...GPT_IMAGE_1_SHEET,
	size: {
		kind: "aspect",
		aspects: ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "1:2", "2:1"],
		tiers: ["1k", "2k"]
	},
	references: null,
	init: false,
	mask: false,
	transparent: "none"
}

/**
 * Together (FLUX and friends on `/v1/images/generations`): the SD-family knobs
 * a hosted OpenAI does not take — negative prompt, steps, seed, free width and
 * height. Up to four pictures a call.
 */
export const TOGETHER_IMAGES_SHEET: DrawingSheet = {
	...GPT_IMAGE_1_SHEET,
	negative: true,
	steps: true,
	seed: true,
	size: { kind: "free", step: 16, min: 256, max: 1792 },
	references: null,
	init: false,
	mask: false,
	transparent: "none",
	perCall: 4
}

/**
 * Any other server on this route (KoboldCPP, LocalAI, text-generation-webui):
 * a `WxH` size, one picture a call, nothing else promised. A server that
 * honours more says so in its receipt.
 */
export const COMPATIBLE_IMAGES_SHEET: DrawingSheet = {
	...GPT_IMAGE_1_SHEET,
	size: { kind: "free", step: 64, min: 256, max: 2048 },
	references: null,
	init: false,
	mask: false,
	transparent: "none",
	perCall: 1
}

/** The sheet for one model id on OpenAI's own wire, or null for an unknown one. */
function sheetForOpenAIModel(model: string | null | undefined): DrawingSheet | null {
	const gpt = gptImageModel(model)
	if (gpt) {
		if (gpt.version >= 2) return GPT_IMAGE_2_SHEET
		return gpt.mini ? GPT_IMAGE_1_MINI_SHEET : GPT_IMAGE_1_SHEET
	}
	const id = (model ?? "").toLowerCase()
	if (id.startsWith("dall-e-3")) return DALL_E_3_SHEET
	if (id.startsWith("dall-e-2")) return DALL_E_2_SHEET
	return null
}

/**
 * The sheet for one connection. The service decides first (xAI and Together
 * have their own whatever the model); then the model id (a gpt-image model
 * behind a proxy is still a gpt-image model); then OpenAI's default model on
 * OpenAI, and the plain compatible sheet anywhere else.
 */
export function openAIImagesSheetFor(c: SheetSubject): DrawingSheet {
	const service = openAIImagesService(c)
	if (service === "xai") return XAI_IMAGES_SHEET
	if (service === "together") return TOGETHER_IMAGES_SHEET
	const byModel = sheetForOpenAIModel(c.model)
	if (byModel) return byModel
	return service === "openai"
		? (sheetForOpenAIModel(OPENAI_DEFAULT_IMAGE_MODEL) ?? GPT_IMAGE_2_SHEET)
		: COMPATIBLE_IMAGES_SHEET
}

// ── Profile ─────────────────────────────────────────────────────────────────

export const QUALITY_CHOICES = [
	"auto",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
] as const

const PROFILE_SCHEMA: SettingsSchema = {
	quality: {
		type: "enum",
		of: QUALITY_CHOICES,
		label: "Quality",
		description:
			"How much effort each picture gets — higher costs more and takes longer. Extra high and Max exist on gpt-image-2.5 only; a model without the chosen level draws at its own default and the receipt says so.",
		default: "auto"
	},
	moderation: {
		type: "enum",
		of: ["auto", "low"],
		label: "Moderation",
		description:
			"How strictly the service filters what it draws. Low is less restrictive. gpt-image models only.",
		default: "auto"
	},
	outputCompression: {
		type: "integer",
		label: "Compression",
		description:
			"0–100, for JPEG and WebP output only. Leave blank for the service's default.",
		min: 0,
		max: 100
	}
}

const PROFILE_DEFAULTS = {
	quality: "auto" as string,
	moderation: "auto" as string,
	outputCompression: undefined as number | undefined
}

/** The quality levels a model takes; `null` = the knob does not exist there. */
function qualitiesFor(
	service: OpenAIImagesService,
	model: string
): readonly string[] | null {
	if (service !== "openai" && service !== "compatible") return null
	const gpt = gptImageModel(model)
	if (!gpt) return null
	return gpt.version >= 2.5
		? QUALITY_CHOICES
		: ["auto", "low", "medium", "high"]
}

// ── The adapter ─────────────────────────────────────────────────────────────

interface ImagesResponse {
	data?: Array<{ b64_json?: string | null; url?: string | null; revised_prompt?: string }>
	output_format?: string
	size?: string
	quality?: string
	background?: string
	usage?: unknown
}

const MIME: Record<string, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	webp: "image/webp"
}

function authHeaders(apiKey: unknown): Record<string, string> {
	const key = decryptApiKeyField(apiKey)
	return key ? { Authorization: `Bearer ${key}` } : {}
}

function base(connection: { baseUrl?: string | null }): string {
	return normalizeBaseUrl(connection.baseUrl) || DEFAULT_BASE_URL
}

/** Bytes and type of each referenced file, through the host's loader. */
async function loadFiles(
	refs: readonly MediaRef[],
	key: string,
	t: Translation,
	opts: ImageGenOptions
): Promise<Array<{ bytes: Uint8Array; mime: string }>> {
	if (!refs.length) return []
	if (!opts.loadMedia) {
		t.ignore(key)
		return []
	}
	const out: Array<{ bytes: Uint8Array; mime: string }> = []
	for (const ref of refs) {
		try {
			out.push(await opts.loadMedia(ref))
		} catch {
			t.ignore(key)
			return []
		}
	}
	t.apply(key, true)
	return out
}

const extOf = (mime: string) =>
	mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png"

/**
 * The provider's error, read for a moderation block. Anything else is null and
 * the caller throws an ordinary failure.
 */
function moderationRefusal(body: any): ImageGenResult["refusal"] | null {
	const err = body?.error ?? body
	const code = typeof err?.code === "string" ? err.code : undefined
	if (code !== "moderation_blocked") return null
	const details = err?.moderation_details ?? body?.moderation_details
	const said =
		typeof err?.message === "string" && err.message
			? err.message
			: "Your request was rejected by the image service's safety system."
	return {
		message:
			`The image service refused this prompt: ${said}` +
			(details !== undefined
				? ` (moderation details: ${typeof details === "string" ? details : JSON.stringify(details)})`
				: ""),
		code,
		...(details !== undefined ? { details } : {}),
		noRetry: true
	}
}

class OpenAIImagesAdapter extends BaseImageAdapter {
	async generateImage(
		req: ImageGenRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const signal = this.linkAbort(opts.signal)
		const t = new Translation()
		if (signal.aborted)
			return { media: [], isAborted: true, applied: [], ignored: [] }

		const conn = this.connection
		const service = openAIImagesService(conn)
		const model =
			req.model ??
			conn.model ??
			(service === "openai"
				? OPENAI_DEFAULT_IMAGE_MODEL
				: service === "xai"
					? XAI_DEFAULT_IMAGE_MODEL
					: undefined)
		const sheet = openAIImagesSheetFor({ ...conn, model })
		const gpt = gptImageModel(model)
		const profile = this.profile(PROFILE_DEFAULTS)

		if (req.prompt.length > MAX_PROMPT_CHARS)
			throw new Error(
				`The prompt is ${req.prompt.length} characters; this image service takes at most ${MAX_PROMPT_CHARS}.`
			)

		const fields: Record<string, string | number> = {}
		fields.prompt = t.apply("prompt", req.prompt)
		if (model) fields.model = req.model ? t.apply("model", model) : model

		// ── Count ───────────────────────────────────────────────────────────
		const asked = t.take("batch", req.batch) ?? 1
		const n = Math.max(1, Math.min(asked, sheet.perCall))
		if (n < asked) t.ignore("batch")
		if (n > 1) fields.n = n

		// ── Size ────────────────────────────────────────────────────────────
		this.size(req, sheet, service, fields, t)

		// ── SD-family knobs: only where the sheet says so ───────────────────
		if (sheet.negative && req.negativePrompt)
			fields.negative_prompt = t.apply("negativePrompt", req.negativePrompt)
		else t.take("negativePrompt", req.negativePrompt || undefined, false)
		const steps = t.take("steps", req.steps, sheet.steps)
		if (steps !== undefined) fields.steps = steps
		const seed = t.take(
			"seed",
			req.seed !== undefined && req.seed >= 0 ? req.seed : undefined,
			sheet.seed
		)
		if (seed !== undefined) fields.seed = seed
		t.take("cfg", req.cfg, sheet.cfg)
		t.take("sampler", req.sampler, sheet.sampler)
		t.take("scheduler", req.scheduler, sheet.sampler)
		t.take("clipSkip", req.clipSkip, sheet.clipSkip)
		t.take("video", req.video, false)

		// ── Profile: quality, moderation, compression ───────────────────────
		const qualities = qualitiesFor(service, model ?? "")
		if (profile.quality && profile.quality !== "auto") {
			if (qualities?.includes(profile.quality))
				fields.quality = t.apply("quality", profile.quality)
			else t.ignore("quality")
		}
		if (profile.moderation && profile.moderation !== "auto") {
			if (gpt) fields.moderation = t.apply("moderation", profile.moderation)
			else t.ignore("moderation")
		}

		// ── Transparency and format ─────────────────────────────────────────
		let format: string | undefined
		if (req.transparent) {
			if (sheet.transparent === "native" && gpt) {
				fields.background = t.apply("transparent", "transparent")
				// Alpha needs PNG or WebP; JPEG cannot carry it.
				format = req.outputFormat === "webp" ? "webp" : "png"
				if (req.outputFormat === "jpeg") t.ignore("outputFormat")
				else if (req.outputFormat) t.apply("outputFormat", true)
			} else t.ignore("transparent")
		}
		if (!format && req.outputFormat) {
			if (gpt || service === "together")
				format = t.apply("outputFormat", req.outputFormat)
			else t.ignore("outputFormat")
		}
		if (format) fields.output_format = format
		const compression = profile.outputCompression
		if (
			typeof compression === "number" &&
			Number.isFinite(compression) &&
			gpt &&
			(format === "jpeg" || format === "webp")
		)
			fields.output_compression = Math.max(0, Math.min(100, compression))

		// Base64 back, never a URL that expires: gpt-image always answers so and
		// rejects the parameter; everyone else is asked.
		if (!gpt)
			fields.response_format = service === "together" ? "base64" : "b64_json"

		// ── Inputs: canvas, references, mask → the edits route ──────────────
		const files: Array<{ bytes: Uint8Array; mime: string }> = []
		let mask: { bytes: Uint8Array; mime: string } | undefined
		if (req.init) {
			if (sheet.init) files.push(...(await loadFiles([req.init], "init", t, opts)))
			else t.ignore("init")
		}
		if (req.references?.length) {
			if (!sheet.references) t.ignore("references")
			else {
				const room = Math.max(0, sheet.references.max - files.length)
				const take = req.references.slice(0, room)
				files.push(...(await loadFiles(take, "references", t, opts)))
				if (take.length < req.references.length) t.ignore("references")
			}
		}
		if (req.mask) {
			// A mask paints over the first image; with none, it means nothing.
			if (!sheet.mask || !files.length) t.ignore("mask")
			else [mask] = await loadFiles([req.mask], "mask", t, opts)
		}
		if (req.denoise !== undefined) t.ignore("denoise")
		// An aspect is the host's derivation for aspect sheets; anywhere else
		// the width and height carry the shape.
		if (req.aspect && sheet.size.kind !== "aspect" && !req.width && !req.height)
			t.ignore("aspect")

		const edit = files.length > 0
		// Fidelity to the input images: gpt-image-1 and 1.5 take `high`; mini
		// takes only `low`, and 2+ preserve the first image at full fidelity
		// without being asked (the parameter is refused there).
		// Any input image counts: the canvas is reference 0.
		if (edit && gpt && gpt.version < 2 && !gpt.mini)
			fields.input_fidelity = "high"

		const root = base(conn)
		const headers = authHeaders((conn.extraJson as any)?.apiKey)
		opts.onProgress?.({ stage: "queued", percent: 0 })

		let res: Response
		try {
			if (edit) {
				const form = new FormData()
				for (const [k, v] of Object.entries(fields)) form.append(k, String(v))
				files.forEach((f, i) =>
					form.append(
						"image[]",
						new Blob([f.bytes as BlobPart], { type: f.mime }),
						`image-${i}.${extOf(f.mime)}`
					)
				)
				if (mask)
					form.append(
						"mask",
						new Blob([mask.bytes as BlobPart], { type: mask.mime }),
						`mask.${extOf(mask.mime)}`
					)
				res = await fetch(`${root}/images/edits`, {
					method: "POST",
					headers,
					body: form,
					signal
				})
			} else {
				res = await fetch(`${root}/images/generations`, {
					method: "POST",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify(fields),
					signal
				})
			}
		} catch (e) {
			if (signal.aborted)
				return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			throw new Error(
				`Image request failed: ${e instanceof Error ? e.message : String(e)}`
			)
		}

		if (!res.ok) {
			const text = await res.text().catch(() => "")
			let body: unknown = null
			try {
				body = JSON.parse(text)
			} catch {
				// Not JSON; the text is the message.
			}
			const refusal = moderationRefusal(body)
			if (refusal)
				return {
					media: [],
					isAborted: false,
					applied: t.applied,
					ignored: t.ignored,
					refusal,
					raw: body
				}
			const said = (body as any)?.error?.message
			throw new Error(
				`Image generation failed (${res.status}): ${
					typeof said === "string" && said ? said : text.slice(0, 300)
				}`
			)
		}

		const data = (await res.json()) as ImagesResponse
		const mime = MIME[data.output_format ?? format ?? "png"] ?? "image/png"
		const media: GeneratedMediaItem[] = []
		for (const item of data.data ?? []) {
			let b64 = item.b64_json ?? undefined
			if (!b64 && item.url) b64 = await fetchAsBase64(item.url, signal)
			if (!b64) continue
			media.push({
				kind: "image",
				mime,
				base64: b64.replace(/^data:[^;]+;base64,/, ""),
				...(seed !== undefined ? { seed } : {}),
				meta: {
					backend: "openai-images",
					service,
					...(model ? { model } : {}),
					...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {}),
					...(data.size ? { size: data.size } : {}),
					...(data.quality ? { quality: data.quality } : {}),
					...(data.background ? { background: data.background } : {})
				}
			})
		}
		if (!media.length)
			throw new Error("The image service completed without returning an image.")
		if (n > 1 && media.length < n) t.ignore("batch")
		opts.onProgress?.({ stage: "saving", percent: 100 })
		return {
			media,
			isAborted: false,
			applied: t.applied,
			ignored: t.ignored,
			...(data.usage ? { raw: { usage: data.usage } } : {})
		}
	}

	/**
	 * `editImage`: the edits route, named. Same request as a canvas-carrying
	 * `generateImage`; the first canvas is the image the mask applies to.
	 */
	async editImage(
		req: ImageEditRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const { init: canvases, prompt, mask, references, ...rest } = req
		const [init, ...more] = canvases
		const refs = [...more, ...(references ?? [])]
		return this.generateImage(
			{
				...rest,
				prompt: prompt ?? "",
				...(init ? { init } : {}),
				...(refs.length ? { references: refs } : {}),
				...(mask ? { mask } : {})
			},
			opts
		)
	}

	/** Translate the size for this sheet, reporting anything not carried. */
	private size(
		req: ImageGenRequest,
		sheet: DrawingSheet,
		service: OpenAIImagesService,
		fields: Record<string, string | number>,
		t: Translation
	): void {
		const { width, height } = req
		const size = sheet.size
		if (size.kind === "aspect") {
			if (req.aspect && size.aspects.includes(req.aspect)) {
				fields.aspect_ratio = t.apply("aspect", req.aspect)
				// The width and height were what the aspect was derived from.
				if (width) t.apply("width", true)
				if (height) t.apply("height", true)
				// …and what the resolution tier is read from (xAI: `1k`/`2k`):
				// 1536 or more on the long edge is the large tier. No size, no
				// tier — the service's default.
				const long = Math.max(width ?? 0, height ?? 0)
				if (size.tiers?.length && long > 0) {
					const tier = resolutionTier(long, size.tiers)
					if (tier) fields.resolution = t.apply("resolution", tier)
				}
			} else {
				if (req.aspect) t.ignore("aspect")
				if (width) t.ignore("width")
				if (height) t.ignore("height")
			}
			return
		}
		if (!width || !height) {
			// Half a size is not a size; the service picks (`auto`).
			if (width) t.ignore("width")
			if (height) t.ignore("height")
			return
		}
		const wxh = `${width}x${height}`
		const ok =
			size.kind === "enum"
				? size.sizes.includes(wxh)
				: width % size.step === 0 &&
					height % size.step === 0 &&
					width >= size.min &&
					height >= size.min &&
					width <= size.max &&
					height <= size.max &&
					(!size.minPixels || width * height >= size.minPixels) &&
					(!size.maxPixels || width * height <= size.maxPixels) &&
					(!size.maxRatio ||
						Math.max(width, height) / Math.min(width, height) <=
							size.maxRatio)
		if (!ok) {
			t.ignore("width")
			t.ignore("height")
			return
		}
		t.apply("width", true)
		t.apply("height", true)
		if (service === "together") {
			fields.width = width
			fields.height = height
		} else fields.size = wxh
	}
}

/** A picture a service answered with a URL rather than bytes. */
async function fetchAsBase64(
	url: string,
	signal: AbortSignal
): Promise<string | undefined> {
	try {
		const res = await fetch(url, { signal })
		if (!res.ok) return undefined
		return Buffer.from(await res.arrayBuffer()).toString("base64")
	} catch {
		return undefined
	}
}

// ── Listing and testing ─────────────────────────────────────────────────────

/**
 * The image models a connection's `/models` lists: ids that read as image
 * models (`gpt-image*`, `dall-e*`, `grok-imagine-image*`, `*-image`), or that
 * the listing itself marks as drawing (Together's `type: "image"`).
 */
async function listModels(
	connection: SelectConnection
): Promise<{ models: string[]; error?: string }> {
	try {
		const res = await fetch(`${base(connection)}/models`, {
			headers: authHeaders((connection.extraJson as any)?.apiKey)
		})
		if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
		const body = (await res.json()) as { data?: unknown } | unknown[]
		const entries = Array.isArray(body)
			? body
			: Array.isArray((body as any)?.data)
				? ((body as any).data as unknown[])
				: []
		return {
			models: entries
				.filter(
					(e: any) =>
						typeof e?.id === "string" &&
						(isOpenAIImageModelId(e.id) ||
							String(e?.type ?? "").toLowerCase() === "image")
				)
				.map((e: any) => e.id as string)
		}
	} catch (e) {
		return { models: [], error: e instanceof Error ? e.message : String(e) }
	}
}

async function testConnection(connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	const { models, error } = await listModels(connection)
	if (error) return { ok: false, error }
	if (!models.length)
		return {
			ok: false,
			error: "Reachable, but it lists no image models. Check that this service draws pictures and that the key may use them."
		}
	return {
		ok: true,
		extra: {
			imageModels: models,
			capabilities: { "text->image": "native" }
		}
	}
}

/**
 * Per-image prices this build can state, USD at 1024×1024 by quality
 * (OpenAI's pricing page, 2026-10). gpt-image-2.5 is billed by tokens and is
 * deliberately absent: a per-image figure there would be a guess.
 */
export const OPENAI_IMAGE_PRICES: Readonly<Record<string, Record<string, number>>> = {
	"gpt-image-2": { low: 0.006, medium: 0.053, high: 0.211 }
}

/**
 * What the app knows about one listed id on this wire, for the model sync:
 * `image-gen` for an id that reads as an image model, and the per-image price
 * where `OPENAI_IMAGE_PRICES` states one. `null` for anything else.
 */
export function openAIImageModelInfo(
	id: string | null | undefined
): {
	modality: "image-gen"
	facts?: { pricing: { perImage: Record<string, number>; currency: string }; source: "list" }
} | null {
	if (!isOpenAIImageModelId(id)) return null
	const prices = OPENAI_IMAGE_PRICES[(id ?? "").trim().toLowerCase()]
	return {
		modality: "image-gen",
		...(prices
			? { facts: { pricing: { perImage: { ...prices }, currency: "USD" }, source: "list" as const } }
			: {})
	}
}

const exports: ImageAdapterExports = {
	Adapter: OpenAIImagesAdapter,
	listModels,
	testConnection,
	sheet: GPT_IMAGE_2_SHEET,
	sheetFor: openAIImagesSheetFor,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

export default exports
