/**
 * The **BFL dialect** — Black Forest Labs' FLUX API (`https://api.bfl.ai/v1`,
 * DESIGN-image-generation §1.7, §4.4).
 *
 * Asynchronous: `POST /v1/{model}` answers `{id, polling_url}`, and the
 * polling URL answers a `status` until it is `Ready`, with the picture as a
 * signed URL in `result.sample` (it expires in minutes, so it is fetched at
 * once). One picture a call. The key travels in `x-key`.
 *
 * ## One sheet per model
 *
 * - **FLUX.2 [pro] / [max]** — free width and height on a 16-pixel grid up
 *   to 4 megapixels, a seed, up to eight input pictures (`input_image` …
 *   `input_image_8`; the canvas is the first).
 * - **FLUX.2 [flex]** — the same, plus steps (1–50) and guidance (1.5–10).
 * - **FLUX.1 Kontext [pro] / [max]** — an aspect ratio rather than a size,
 *   a seed, up to four input pictures.
 * - **FLUX 3 Image** — an aspect ratio and a resolution tier, up to ten
 *   input pictures (`images`), and NO seed.
 *
 * None takes a negative prompt, a sampler, a mask or transparency; each is
 * reported ignored.
 *
 * ## Cancel
 *
 * BFL has no cancel route. Stopping stops the wait; the render finishes and
 * is billed. The sheet says `cancel: false` for that reason.
 *
 * ## A refusal is not a failure
 *
 * `Request Moderated` (the prompt or an input picture) and `Content
 * Moderated` (the output) come back as a `refusal` with `noRetry: true`.
 */
import {
	BaseImageAdapter,
	Translation,
	type DrawingSheet,
	type ImageAdapterExports,
	type ImageGenOptions,
	type ImageGenRequest,
	type ImageGenResult
} from "./BaseImageAdapter"
import type { ImageEditRequest } from "$lib/server/adapters/actions"
import type { SettingsSchema } from "@serene-pub/sdk"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { editAsGenerate, fetchPicture, readFailure, sleep } from "./hostedImageHelpers"

const DEFAULT_HOST = "https://api.bfl.ai"
const REGION_HOSTS: Record<string, string> = {
	global: "https://api.bfl.ai",
	eu: "https://api.eu.bfl.ai",
	us: "https://api.us.bfl.ai"
}
export const BFL_DEFAULT_MODEL = "flux-2-pro"

/** How often the polling URL is asked, and for how long. Mutable for tests. */
export const bflTiming = { pollMs: 1_000, maxWaitMs: 10 * 60_000 }

// ── Models and sheets ───────────────────────────────────────────────────────

const BASE_SHEET: DrawingSheet = {
	negative: false,
	seed: true,
	steps: false,
	cfg: false,
	sampler: false,
	clipSkip: false,
	size: { kind: "free", step: 16, min: 64, max: 2048, maxPixels: 4_194_304 },
	references: { max: 8 },
	init: true,
	mask: false,
	transparent: "none",
	perCall: 1,
	outputs: { perRun: 1, keyed: false },
	progress: true,
	preview: false,
	cancel: false,
	video: false
}

export const BFL_FLUX2_SHEET: DrawingSheet = BASE_SHEET
export const BFL_FLUX2_FLEX_SHEET: DrawingSheet = { ...BASE_SHEET, steps: true, cfg: true }

const KONTEXT_ASPECTS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "9:21"]
export const BFL_KONTEXT_SHEET: DrawingSheet = {
	...BASE_SHEET,
	size: { kind: "aspect", aspects: KONTEXT_ASPECTS },
	references: { max: 4 }
}

const FLUX3_ASPECTS = [
	"21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1",
	"4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21"
]
const FLUX3_TIERS = ["768sq", "1k", "1.5k", "2k", "4k"]
export const BFL_FLUX3_SHEET: DrawingSheet = {
	...BASE_SHEET,
	seed: false,
	size: { kind: "aspect", aspects: FLUX3_ASPECTS, tiers: FLUX3_TIERS },
	references: { max: 10 }
}

type Family = "flux2" | "flux2-flex" | "kontext" | "flux3"

export const BFL_MODELS: ReadonlyArray<{
	id: string
	name: string
	family: Family
	/** USD per picture where BFL states a flat price (pricing page, 2026-10). */
	perImage?: Record<string, number>
}> = [
	{ id: "flux-2-pro", name: "FLUX.2 [pro]", family: "flux2" },
	{ id: "flux-2-max", name: "FLUX.2 [max]", family: "flux2" },
	{ id: "flux-2-flex", name: "FLUX.2 [flex]", family: "flux2-flex" },
	{ id: "flux-kontext-pro", name: "FLUX.1 Kontext [pro]", family: "kontext", perImage: { default: 0.04 } },
	{ id: "flux-kontext-max", name: "FLUX.1 Kontext [max]", family: "kontext", perImage: { default: 0.08 } },
	{
		id: "flux-3-image",
		name: "FLUX 3 Image",
		family: "flux3",
		perImage: { "768sq": 0.041, "1k": 0.048, "2k": 0.1, "4k": 0.607 }
	}
]

export function bflFamily(model: string | null | undefined): Family {
	const id = (model || BFL_DEFAULT_MODEL).toLowerCase()
	const known = BFL_MODELS.find((m) => m.id === id)
	if (known) return known.family
	if (id.startsWith("flux-3")) return "flux3"
	if (id.includes("kontext")) return "kontext"
	if (id.includes("flex")) return "flux2-flex"
	return "flux2"
}

export function bflSheetFor(c: { model?: string | null }): DrawingSheet {
	switch (bflFamily(c.model)) {
		case "flux3":
			return BFL_FLUX3_SHEET
		case "kontext":
			return BFL_KONTEXT_SHEET
		case "flux2-flex":
			return BFL_FLUX2_FLEX_SHEET
		default:
			return BFL_FLUX2_SHEET
	}
}

// ── Profile ─────────────────────────────────────────────────────────────────

const PROFILE_SCHEMA: SettingsSchema = {
	safetyTolerance: {
		type: "integer",
		label: "Safety tolerance",
		description:
			"0 is the strictest, 5 the most permissive (FLUX 3 stops at 4; a higher value is sent as 4).",
		min: 0,
		max: 5,
		default: 2
	},
	promptUpsampling: {
		type: "boolean",
		label: "Prompt upsampling",
		description:
			"Lets BFL rewrite the prompt with more detail before drawing. FLUX 3 has no such option.",
		default: false
	},
	region: {
		type: "enum",
		of: ["global", "eu", "us"],
		label: "Region",
		description: "Where the request is served. EU keeps data in the European Union.",
		default: "global"
	}
}

const PROFILE_DEFAULTS = {
	safetyTolerance: 2,
	promptUpsampling: false,
	region: "global" as string
}

// ── The adapter ─────────────────────────────────────────────────────────────

function hostFor(connection: { baseUrl?: string | null; extraJson?: unknown }): string {
	const region = (connection.extraJson as any)?.profile?.region
	if (region && region !== "global" && REGION_HOSTS[region]) return REGION_HOSTS[region]
	return (normalizeBaseUrl(connection.baseUrl) || DEFAULT_HOST).replace(/\/+$/, "").replace(/\/v1$/, "")
}

function keyHeaders(apiKey: unknown): Record<string, string> {
	const key = decryptApiKeyField(apiKey)
	return key ? { "x-key": key } : {}
}

/**
 * The polling URL BFL answered, when it is BFL's own — the key is sent to
 * it, so an address anywhere else is replaced by `get_result` on our host.
 */
export function safePollingUrl(polling: unknown, host: string, id: string): string {
	try {
		const u = new URL(String(polling))
		const h = u.hostname.toLowerCase()
		if (u.protocol === "https:" && (h === "bfl.ai" || h.endsWith(".bfl.ai"))) return u.toString()
	} catch {
		// Fall through.
	}
	return `${host}/v1/get_result?id=${encodeURIComponent(id)}`
}

class BflAdapter extends BaseImageAdapter {
	async generateImage(
		req: ImageGenRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const signal = this.linkAbort(opts.signal)
		const t = new Translation()
		if (signal.aborted) return { media: [], isAborted: true, applied: [], ignored: [] }

		const conn = this.connection
		const model = req.model ?? conn.model ?? BFL_DEFAULT_MODEL
		if (req.model) t.apply("model", true)
		const family = bflFamily(model)
		const sheet = bflSheetFor({ model })
		const profile = this.profile(PROFILE_DEFAULTS)
		const body: Record<string, unknown> = { prompt: t.apply("prompt", req.prompt) }

		// ── Knobs ───────────────────────────────────────────────────────────
		t.take("negativePrompt", req.negativePrompt || undefined, false)
		t.take("sampler", req.sampler, false)
		t.take("scheduler", req.scheduler, false)
		t.take("clipSkip", req.clipSkip, false)
		t.take("transparent", req.transparent || undefined, false)
		t.take("video", req.video, false)
		if (req.mask) t.ignore("mask")
		if (req.denoise !== undefined) t.ignore("denoise")
		if (req.batch !== undefined) {
			if (req.batch > sheet.perCall) t.ignore("batch")
			else t.apply("batch", true)
		}
		const seed = t.take("seed", req.seed !== undefined && req.seed >= 0 ? req.seed : undefined, sheet.seed)
		if (seed !== undefined) body.seed = seed
		const steps = t.take("steps", req.steps, sheet.steps)
		if (steps !== undefined) body.steps = Math.max(1, Math.min(50, steps))
		const cfg = t.take("cfg", req.cfg, sheet.cfg)
		if (cfg !== undefined) body.guidance = Math.max(1.5, Math.min(10, cfg))

		// ── Size ────────────────────────────────────────────────────────────
		const size = sheet.size
		if (size.kind === "aspect") {
			if (req.aspect && size.aspects.includes(req.aspect)) {
				body.aspect_ratio = t.apply("aspect", req.aspect)
				if (req.width) t.apply("width", true)
				if (req.height) t.apply("height", true)
			} else {
				if (req.aspect) t.ignore("aspect")
				if (req.width) t.ignore("width")
				if (req.height) t.ignore("height")
			}
			if (size.tiers && family === "flux3") {
				const side = Math.max(req.width ?? 0, req.height ?? 0)
				if (side) body.resolution = side <= 768 ? "768sq" : side <= 1024 ? "1k" : side <= 1536 ? "1.5k" : side <= 2048 ? "2k" : "4k"
			}
		} else if (size.kind === "free") {
			const { width, height } = req
			const fits = (v: number) => v % size.step === 0 && v >= size.min && v <= size.max
			if (width && height && fits(width) && fits(height) && (!size.maxPixels || width * height <= size.maxPixels)) {
				body.width = t.apply("width", width)
				body.height = t.apply("height", height)
			} else {
				if (width) t.ignore("width")
				if (height) t.ignore("height")
			}
			if (req.aspect && !width && !height) t.ignore("aspect")
		}

		// ── Profile ─────────────────────────────────────────────────────────
		const tolerance = Math.max(0, Math.min(family === "flux3" ? 4 : 5, Math.round(Number(profile.safetyTolerance) || 0)))
		body.safety_tolerance = tolerance
		if (family !== "flux3") {
			if (profile.promptUpsampling) body.prompt_upsampling = true
			if (req.outputFormat === "jpeg" || req.outputFormat === "png")
				body.output_format = t.apply("outputFormat", req.outputFormat)
			else {
				if (req.outputFormat) t.ignore("outputFormat")
				body.output_format = "png"
			}
		} else {
			if (req.outputFormat) t.ignore("outputFormat")
			if (profile.promptUpsampling) t.ignore("promptUpsampling")
		}

		// ── Pictures in: the canvas first, then the likeness ────────────────
		const max = sheet.references?.max ?? 0
		const images: string[] = []
		if (req.init) images.push(...(await this.base64Of([req.init], "init", t, opts)))
		if (req.references?.length) {
			const room = Math.max(0, max - images.length)
			const take = req.references.slice(0, room)
			images.push(...(await this.base64Of(take, "references", t, opts)))
			if (take.length < req.references.length) t.ignore("references")
		}
		if (images.length) {
			if (family === "flux3") body.images = images
			else images.forEach((b64, i) => (body[i === 0 ? "input_image" : `input_image_${i + 1}`] = b64))
		}

		// ── Submit ──────────────────────────────────────────────────────────
		const host = hostFor(conn)
		const headers = keyHeaders((conn.extraJson as any)?.apiKey)
		opts.onProgress?.({ stage: "queued", percent: 0 })
		let id: string
		let polling: string
		try {
			const res = await fetch(`${host}/v1/${encodeURIComponent(model)}`, {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(body),
				signal
			})
			if (!res.ok) {
				const { text, body: err } = await readFailure(res)
				const said = typeof err?.detail === "string" ? err.detail : err?.detail?.[0]?.msg ?? err?.message
				throw new Error(
					res.status === 402
						? "BFL says this account has run out of credits."
						: `Image generation failed (${res.status}): ${said ?? text.slice(0, 300)}`
				)
			}
			const answer = (await res.json()) as { id?: string; polling_url?: string }
			if (!answer.id) throw new Error("BFL did not queue the request.")
			id = answer.id
			polling = safePollingUrl(answer.polling_url, host, id)
		} catch (e) {
			if (signal.aborted) return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			throw e instanceof Error ? e : new Error(String(e))
		}

		// ── Wait ────────────────────────────────────────────────────────────
		const started = Date.now()
		let result: any
		for (;;) {
			await sleep(bflTiming.pollMs, signal)
			if (signal.aborted) return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			let poll: any = null
			try {
				const res = await fetch(polling, { headers: { ...headers, Accept: "application/json" }, signal })
				poll = res.ok ? await res.json() : null
			} catch {
				poll = null
			}
			const status = poll?.status
			if (status === "Ready") {
				result = poll
				break
			}
			if (status === "Request Moderated" || status === "Content Moderated")
				return {
					media: [],
					isAborted: false,
					applied: t.applied,
					ignored: t.ignored,
					refusal: {
						message:
							status === "Request Moderated"
								? "BFL refused this prompt or an input picture (Request Moderated)."
								: "BFL drew the picture but withheld it (Content Moderated).",
						code: status,
						...(poll?.details ? { details: poll.details } : {}),
						noRetry: true
					},
					raw: poll
				}
			if (status === "Error" || status === "Failed" || status === "Task not found")
				throw new Error(`BFL could not draw this (${status})${poll?.details ? `: ${JSON.stringify(poll.details).slice(0, 300)}` : "."}`)
			if (typeof poll?.progress === "number") {
				const pct = poll.progress <= 1 ? poll.progress * 100 : poll.progress
				opts.onProgress?.({ stage: "sampling", percent: Math.round(pct) })
			}
			if (Date.now() - started > bflTiming.maxWaitMs)
				throw new Error("BFL did not finish within ten minutes.")
		}

		const sample = result?.result?.sample
		const pic = typeof sample === "string" ? await fetchPicture(sample, signal) : undefined
		if (!pic) {
			if (signal.aborted) return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			throw new Error("BFL finished, but its picture could not be fetched.")
		}
		const usedSeed = result?.result?.seed ?? seed
		opts.onProgress?.({ stage: "saving", percent: 100 })
		return {
			media: [
				{
					kind: "image",
					mime: pic.mime,
					base64: pic.base64,
					...(typeof usedSeed === "number" ? { seed: usedSeed } : {}),
					meta: {
						backend: "bfl",
						model,
						...(body.resolution ? { resolution: body.resolution } : {})
					}
				}
			],
			isAborted: false,
			applied: t.applied,
			ignored: t.ignored,
			raw: { id, ...(result?.cost !== undefined ? { cost: result.cost } : {}) }
		}
	}

	async editImage(req: ImageEditRequest, opts: ImageGenOptions = {}): Promise<ImageGenResult> {
		return this.generateImage(editAsGenerate(req), opts)
	}
}

// ── Listing and testing ─────────────────────────────────────────────────────

/** BFL's models, a static list (it has no listing route), with prices where flat. */
async function listModels(_connection: SelectConnection) {
	return {
		models: BFL_MODELS.map((m) => ({
			id: m.id,
			name: m.name,
			modality: "image-gen" as const,
			...(m.perImage
				? { facts: { pricing: { perImage: { ...m.perImage }, currency: "USD" }, source: "list" as const } }
				: {})
		}))
	}
}

async function testConnection(connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	const headers = keyHeaders((connection.extraJson as any)?.apiKey)
	if (!headers["x-key"]) return { ok: false, error: "BFL needs an API key." }
	try {
		const res = await fetch(`${hostFor(connection)}/v1/credits`, { headers })
		if (res.status === 401 || res.status === 403) return { ok: false, error: "BFL does not accept this key." }
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
		const body = (await res.json()) as any
		return {
			ok: true,
			extra: {
				imageModels: BFL_MODELS.map((m) => m.id),
				...(typeof body?.credits === "number" ? { credits: body.credits } : {}),
				capabilities: { "text->image": "native", "text+image->image": "native" }
			}
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

const exports: ImageAdapterExports = {
	Adapter: BflAdapter,
	listModels,
	testConnection,
	sheet: BFL_FLUX2_SHEET,
	sheetFor: bflSheetFor,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

export default exports
