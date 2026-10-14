/**
 * The **Gemini image dialect** — `POST {v1beta}/models/{model}:generateContent`
 * with image output (DESIGN-image-generation §1.7, §4.4).
 *
 * Gemini is not a connection type of its own here: it is the OPENAI type with
 * the `google-gemini` preset, whose chat goes through Google's OpenAI
 * compatibility layer (`…/v1beta/openai/`). That layer has no image route, so
 * this module speaks Gemini's NATIVE API beside it — the same key, the same
 * host, the address with `/openai` taken off. `withGeminiImages` folds it into
 * the OPENAI type's image module, which then routes each connection to this
 * dialect or to the OpenAI-images one by its preset or address.
 *
 * ## What this wire has and has not
 *
 * A prompt, input pictures (`inlineData` parts) and an `imageConfig` of an
 * aspect ratio and a size tier. No negative prompt, seed, steps, CFG, sampler,
 * mask or transparency: each is reported ignored, never refused, and the
 * sheet says so before the run. One picture a call — asking for more is
 * unreliable, so the host loops.
 *
 * ## A refusal is not a failure
 *
 * A blocked prompt (`promptFeedback.blockReason`) or a safety-stopped answer
 * (`finishReason` SAFETY, IMAGE_SAFETY, PROHIBITED_CONTENT …) comes back as a
 * `refusal` with `noRetry: true` and Google's words verbatim.
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
import type { SettingsSchema } from "@serene-pub/sdk"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { editAsGenerate, readFailure } from "./hostedImageHelpers"

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
/** What Gemini draws with when the pair names no model (recommended, 2026-10). */
export const GEMINI_DEFAULT_IMAGE_MODEL = "gemini-nano-banana-2.1"
const GEMINI_HOST = "generativelanguage.googleapis.com"

// ── Which connection, which model ───────────────────────────────────────────

interface SheetSubject {
	type?: string
	model?: string | null
	preset?: string | null
	baseUrl?: string | null
}

/** Whether a connection reaches Gemini: its preset says so, or its address. */
export function isGeminiImageService(c: SheetSubject): boolean {
	if (c.preset === "google-gemini") return true
	try {
		return new URL(normalizeBaseUrl(c.baseUrl)).hostname.toLowerCase() === GEMINI_HOST
	} catch {
		return false
	}
}

/** `models/gemini-x` and `gemini-x` are the same model. */
const bareId = (id: string | null | undefined) =>
	(id ?? "").trim().replace(/^models\//, "")

/** Ids this dialect treats as image models. */
export function isGeminiImageModelId(id: string | null | undefined): boolean {
	const s = bareId(id).toLowerCase()
	return s.startsWith("gemini") && (s.includes("-image") || s.includes("nano-banana"))
}

// ── The sheets ──────────────────────────────────────────────────────────────

const ASPECTS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
/** Flash models also take the tall and wide extremes. */
const FLASH_ASPECTS = [...ASPECTS, "1:4", "4:1", "1:8", "8:1"]

/**
 * Nano Banana 2.1 and 3.1 Flash: every aspect, 512 to 4K, up to four
 * character references (the API takes up to fourteen input images, but only
 * four are held as a likeness). The canvas is one more input image.
 */
export const GEMINI_FLASH_SHEET: DrawingSheet = {
	negative: false,
	seed: false,
	steps: false,
	cfg: false,
	sampler: false,
	clipSkip: false,
	size: { kind: "aspect", aspects: FLASH_ASPECTS, tiers: ["512", "1K", "2K", "4K"] },
	references: { max: 4 },
	init: true,
	mask: false,
	transparent: "none",
	perCall: 1,
	outputs: { perRun: 1, keyed: false },
	progress: false,
	preview: false,
	// The fetch is aborted; nothing else to stop.
	cancel: true,
	video: false
}

/** 3.1 Flash Lite: 1K only, one input picture (no multi-reference). */
export const GEMINI_FLASH_LITE_SHEET: DrawingSheet = {
	...GEMINI_FLASH_SHEET,
	size: { kind: "aspect", aspects: FLASH_ASPECTS, tiers: ["1K"] },
	references: null
}

/** 3 Pro Image: the ten standard aspects, 1K to 4K, five character references. */
export const GEMINI_PRO_SHEET: DrawingSheet = {
	...GEMINI_FLASH_SHEET,
	size: { kind: "aspect", aspects: ASPECTS, tiers: ["1K", "2K", "4K"] },
	references: { max: 5 }
}

/** 2.5 Flash Image (legacy): no size tier, up to three input pictures. */
export const GEMINI_LEGACY_SHEET: DrawingSheet = {
	...GEMINI_FLASH_SHEET,
	size: { kind: "aspect", aspects: ASPECTS },
	references: { max: 3 }
}

export function geminiImageSheetFor(c: SheetSubject): DrawingSheet {
	const id = bareId(c.model || GEMINI_DEFAULT_IMAGE_MODEL).toLowerCase()
	if (id.includes("flash-lite")) return GEMINI_FLASH_LITE_SHEET
	if (id.includes("pro")) return GEMINI_PRO_SHEET
	if (id.startsWith("gemini-2.5") || id.startsWith("gemini-2.0"))
		return GEMINI_LEGACY_SHEET
	return GEMINI_FLASH_SHEET
}

// ── Profile ─────────────────────────────────────────────────────────────────

/** The size tiers a person may pin; `auto` follows the asked width and height. */
export const GEMINI_SIZE_CHOICES = ["auto", "512", "1K", "2K", "4K"] as const
/** Friendly names for Google's block thresholds. */
const SAFETY_THRESHOLDS: Record<string, string> = {
	strict: "BLOCK_LOW_AND_ABOVE",
	medium: "BLOCK_MEDIUM_AND_ABOVE",
	relaxed: "BLOCK_ONLY_HIGH",
	none: "BLOCK_NONE",
	off: "OFF"
}
const SAFETY_CATEGORIES = [
	"HARM_CATEGORY_HARASSMENT",
	"HARM_CATEGORY_HATE_SPEECH",
	"HARM_CATEGORY_SEXUALLY_EXPLICIT",
	"HARM_CATEGORY_DANGEROUS_CONTENT"
]

export const GEMINI_PROFILE_SCHEMA: SettingsSchema = {
	imageSize: {
		type: "enum",
		of: GEMINI_SIZE_CHOICES,
		label: "Picture size (Gemini)",
		description:
			"Gemini only. Auto picks the tier nearest the size asked for; a fixed tier draws every picture at it. 512 is 3.1 Flash only, and Flash Lite draws at 1K whatever is set — the receipt says so.",
		default: "auto"
	},
	safety: {
		type: "enum",
		of: ["default", ...Object.keys(SAFETY_THRESHOLDS)],
		label: "Safety filter (Gemini)",
		description:
			"Gemini only. How readily Google blocks a prompt or a picture. Default is Google's own setting; Off and None are not available on every account.",
		default: "default"
	}
}

export const GEMINI_PROFILE_DEFAULTS = {
	imageSize: "auto" as string,
	safety: "default" as string
}

/** The tier nearest the asked size, within what this sheet draws. */
function tierFor(
	req: ImageGenRequest,
	tiers: readonly string[],
	pinned: string
): string | undefined {
	if (!tiers.length) return undefined
	if (pinned !== "auto") return tiers.includes(pinned) ? pinned : undefined
	const side = Math.max(req.width ?? 0, req.height ?? 0)
	if (!side) return undefined
	const want = side <= 512 ? "512" : side <= 1024 ? "1K" : side <= 2048 ? "2K" : "4K"
	if (tiers.includes(want)) return want
	// Nearest available: the smallest above, else the largest.
	const order = ["512", "1K", "2K", "4K"]
	const above = order.slice(order.indexOf(want)).find((t) => tiers.includes(t))
	return above ?? tiers[tiers.length - 1]
}

// ── The adapter ─────────────────────────────────────────────────────────────

const REFUSAL_FINISH = new Set([
	"SAFETY",
	"IMAGE_SAFETY",
	"PROHIBITED_CONTENT",
	"IMAGE_PROHIBITED_CONTENT",
	"BLOCKLIST",
	"SPII",
	"RECITATION",
	"IMAGE_RECITATION"
])

/** Gemini's native root for this connection: the OpenAI layer's address minus `/openai`. */
export function geminiNativeBase(connection: { baseUrl?: string | null }): string {
	const raw = normalizeBaseUrl(connection.baseUrl)
	if (!raw) return DEFAULT_BASE_URL
	return raw.replace(/\/+$/, "").replace(/\/openai$/i, "")
}

function keyHeaders(apiKey: unknown): Record<string, string> {
	const key = decryptApiKeyField(apiKey)
	return key ? { "x-goog-api-key": key } : {}
}

export class GeminiImageAdapter extends BaseImageAdapter {
	async generateImage(
		req: ImageGenRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const signal = this.linkAbort(opts.signal)
		const t = new Translation()
		if (signal.aborted) return { media: [], isAborted: true, applied: [], ignored: [] }

		const conn = this.connection
		const model = bareId(req.model ?? conn.model ?? GEMINI_DEFAULT_IMAGE_MODEL)
		const sheet = geminiImageSheetFor({ ...conn, model })
		const profile = this.profile(GEMINI_PROFILE_DEFAULTS)
		t.apply("prompt", req.prompt)
		if (req.model) t.apply("model", true)

		// ── Knobs this wire does not have ────────────────────────────────
		t.take("negativePrompt", req.negativePrompt || undefined, false)
		t.take("steps", req.steps, false)
		t.take("seed", req.seed !== undefined && req.seed >= 0 ? req.seed : undefined, false)
		t.take("cfg", req.cfg, false)
		t.take("sampler", req.sampler, false)
		t.take("scheduler", req.scheduler, false)
		t.take("clipSkip", req.clipSkip, false)
		t.take("video", req.video, false)
		t.take("transparent", req.transparent || undefined, false)
		t.take("outputFormat", req.outputFormat, false)
		if (req.denoise !== undefined) t.ignore("denoise")
		const asked = req.batch ?? 1
		if (req.batch !== undefined) {
			if (asked > sheet.perCall) t.ignore("batch")
			else t.apply("batch", true)
		}

		// ── Size: an aspect and a tier ─────────────────────────────────────
		const imageConfig: Record<string, string> = {}
		const size = sheet.size
		if (size.kind === "aspect" && req.aspect && size.aspects.includes(req.aspect)) {
			imageConfig.aspectRatio = t.apply("aspect", req.aspect)
			if (req.width) t.apply("width", true)
			if (req.height) t.apply("height", true)
		} else {
			if (req.aspect) t.ignore("aspect")
			if (req.width) t.ignore("width")
			if (req.height) t.ignore("height")
		}
		const tiers = size.kind === "aspect" ? (size.tiers ?? []) : []
		const tier = tierFor(req, tiers, profile.imageSize)
		if (tier) imageConfig.imageSize = tier
		else if (profile.imageSize !== "auto") t.ignore("imageSize")

		// ── Pictures in: the canvas first, then the likeness ──────────────
		const parts: Array<Record<string, unknown>> = []
		const inline = (b64: string, mime: string) =>
			parts.push({ inlineData: { mimeType: mime, data: b64 } })
		if (req.init) {
			if (!sheet.init) t.ignore("init")
			else for (const b64 of await this.base64Of([req.init], "init", t, opts)) inline(b64, req.init.mime || "image/png")
		}
		if (req.references?.length) {
			if (!sheet.references) t.ignore("references")
			else {
				const take = req.references.slice(0, sheet.references.max)
				const loaded = await this.base64Of(take, "references", t, opts)
				loaded.forEach((b64, i) => inline(b64, take[i].mime || "image/png"))
				if (take.length < req.references.length) t.ignore("references")
			}
		}
		if (req.mask) t.ignore("mask")
		parts.push({ text: req.prompt })

		const body: Record<string, unknown> = {
			contents: [{ role: "user", parts }],
			generationConfig: {
				responseModalities: ["TEXT", "IMAGE"],
				...(Object.keys(imageConfig).length ? { imageConfig } : {})
			}
		}
		const threshold = SAFETY_THRESHOLDS[profile.safety]
		if (threshold) {
			body.safetySettings = SAFETY_CATEGORIES.map((category) => ({ category, threshold }))
			t.apply("safety", true)
		}

		opts.onProgress?.({ stage: "queued", percent: 0 })
		let res: Response
		try {
			res = await fetch(
				`${geminiNativeBase(conn)}/models/${encodeURIComponent(model)}:generateContent`,
				{
					method: "POST",
					headers: {
						...keyHeaders((conn.extraJson as any)?.apiKey),
						"Content-Type": "application/json"
					},
					body: JSON.stringify(body),
					signal
				}
			)
		} catch (e) {
			if (signal.aborted)
				return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			throw new Error(`Image request failed: ${e instanceof Error ? e.message : String(e)}`)
		}

		if (!res.ok) {
			const { text, body: err } = await readFailure(res)
			const said = err?.error?.message
			throw new Error(
				`Image generation failed (${res.status}): ${typeof said === "string" && said ? said : text.slice(0, 300)}`
			)
		}

		const data = (await res.json()) as any
		const block = data?.promptFeedback?.blockReason
		if (block)
			return {
				media: [],
				isAborted: false,
				applied: t.applied,
				ignored: t.ignored,
				refusal: {
					message: `Gemini refused this prompt (${block})${data.promptFeedback.blockReasonMessage ? `: ${data.promptFeedback.blockReasonMessage}` : "."}`,
					code: String(block),
					details: data.promptFeedback,
					noRetry: true
				},
				raw: data
			}

		const media: GeneratedMediaItem[] = []
		const said: string[] = []
		let finish: string | undefined
		for (const cand of data?.candidates ?? []) {
			finish ??= cand?.finishReason
			for (const part of cand?.content?.parts ?? []) {
				const img = part?.inlineData ?? part?.inline_data
				if (img?.data)
					media.push({
						kind: "image",
						mime: img.mimeType ?? img.mime_type ?? "image/png",
						base64: img.data,
						meta: {
							backend: "gemini-image",
							model,
							...(imageConfig.aspectRatio ? { aspect: imageConfig.aspectRatio } : {}),
							...(imageConfig.imageSize ? { imageSize: imageConfig.imageSize } : {})
						}
					})
				else if (typeof part?.text === "string" && !part.thought) said.push(part.text)
			}
		}
		if (!media.length) {
			if (finish && REFUSAL_FINISH.has(finish))
				return {
					media: [],
					isAborted: false,
					applied: t.applied,
					ignored: t.ignored,
					refusal: {
						message: `Gemini stopped without a picture (${finish})${said.length ? `: ${said.join(" ")}` : "."}`,
						code: finish,
						details: data?.candidates?.[0]?.safetyRatings,
						noRetry: true
					},
					raw: data
				}
			// Answered in words only — usually a model declining. Asking again
			// can draw, so the host may retry.
			if (said.length)
				return {
					media: [],
					isAborted: false,
					applied: t.applied,
					ignored: t.ignored,
					refusal: {
						message: `Gemini answered without a picture: ${said.join(" ").slice(0, 500)}`,
						code: finish ?? "NO_IMAGE",
						noRetry: false
					},
					raw: data
				}
			throw new Error("Gemini completed without returning an image.")
		}
		if (said.length) for (const m of media) m.meta = { ...m.meta, text: said.join(" ") }
		opts.onProgress?.({ stage: "saving", percent: 100 })
		return {
			media,
			isAborted: false,
			applied: t.applied,
			ignored: t.ignored,
			...(data?.usageMetadata ? { raw: { usage: data.usageMetadata } } : {})
		}
	}

	/** The canvas is one more input picture on this wire. */
	async editImage(req: ImageEditRequest, opts: ImageGenOptions = {}): Promise<ImageGenResult> {
		return this.generateImage(editAsGenerate(req), opts)
	}
}

// ── Listing and testing ─────────────────────────────────────────────────────

/** Gemini's image models, from its own model list. */
export async function listGeminiImageModels(
	connection: SelectConnection
): Promise<{ models: Array<{ id: string; name: string; modality: "image-gen" }>; error?: string }> {
	try {
		const res = await fetch(`${geminiNativeBase(connection)}/models?pageSize=1000`, {
			headers: keyHeaders((connection.extraJson as any)?.apiKey)
		})
		if (!res.ok) {
			const { body } = await readFailure(res)
			return { models: [], error: body?.error?.message ?? `HTTP ${res.status}` }
		}
		const body = (await res.json()) as any
		return {
			models: (Array.isArray(body?.models) ? body.models : [])
				.filter(
					(m: any) =>
						isGeminiImageModelId(m?.name) &&
						(!Array.isArray(m?.supportedGenerationMethods) ||
							m.supportedGenerationMethods.includes("generateContent"))
				)
				.map((m: any) => ({
					id: bareId(m.name),
					name: typeof m.displayName === "string" && m.displayName ? m.displayName : bareId(m.name),
					modality: "image-gen" as const
				}))
		}
	} catch (e) {
		return { models: [], error: e instanceof Error ? e.message : String(e) }
	}
}

export async function testGeminiImages(connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	const { models, error } = await listGeminiImageModels(connection)
	if (error) return { ok: false, error }
	if (!models.length)
		return {
			ok: false,
			error: "Reachable, but Gemini lists no image models for this key."
		}
	return {
		ok: true,
		extra: {
			imageModels: models.map((m) => m.id),
			capabilities: { "text->image": "native", "text+image->image": "native" }
		}
	}
}

const exports: ImageAdapterExports = {
	Adapter: GeminiImageAdapter,
	listModels: listGeminiImageModels,
	testConnection: testGeminiImages,
	sheet: GEMINI_FLASH_SHEET,
	sheetFor: geminiImageSheetFor,
	profileSchema: GEMINI_PROFILE_SCHEMA,
	profileDefaults: GEMINI_PROFILE_DEFAULTS
}

export default exports

// ── Folding into the OPENAI type ────────────────────────────────────────────

/**
 * The OPENAI type's image module with Gemini folded in: a connection with
 * the `google-gemini` preset (or Google's address) draws through this
 * dialect, every other one through `base` (the OpenAI-images dialect).
 *
 * The class is a real subclass whose `generateImage`/`editImage` delegate,
 * so the manifest conformance walk still finds both actions on it. The
 * profile is the two schemas side by side — each Gemini field says
 * "Gemini only", the way OpenAI's `moderation` says "gpt-image models only".
 */
export function withGeminiImages(base: ImageAdapterExports): ImageAdapterExports {
	const Base = base.Adapter
	class OpenAIFamilyImageAdapter extends BaseImageAdapter {
		private readonly inner: BaseImageAdapter
		constructor(connection: AdapterConnection) {
			super(connection)
			this.inner = isGeminiImageService(connection as any)
				? new GeminiImageAdapter(connection)
				: new Base(connection)
		}
		generateImage(req: ImageGenRequest, opts?: ImageGenOptions) {
			return this.inner.generateImage(req, opts)
		}
		editImage(req: ImageEditRequest, opts?: ImageGenOptions) {
			if (!this.inner.editImage)
				throw new Error("This connection cannot edit pictures.")
			return this.inner.editImage(req, opts)
		}
		abort() {
			this.inner.abort()
		}
		preflight(signal?: AbortSignal) {
			return this.inner.preflight(signal)
		}
	}
	const gemini = (c: unknown) => isGeminiImageService(c as SheetSubject)
	return {
		...base,
		Adapter: OpenAIFamilyImageAdapter,
		listModels: (c) => (gemini(c) ? exports.listModels(c) : base.listModels(c)),
		testConnection: (c) => (gemini(c) ? testGeminiImages(c) : base.testConnection(c)),
		sheetFor: (c) =>
			gemini(c) ? geminiImageSheetFor(c) : (base.sheetFor?.(c) ?? base.sheet),
		profileSchema: { ...(base.profileSchema ?? {}), ...GEMINI_PROFILE_SCHEMA },
		profileDefaults: { ...(base.profileDefaults ?? {}), ...GEMINI_PROFILE_DEFAULTS }
	}
}
