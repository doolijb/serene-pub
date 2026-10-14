/**
 * The **Horde dialect** — AI Horde's asynchronous image API
 * (`https://aihorde.net/api/v2`, DESIGN-image-generation §1.7, §4.4).
 *
 * A crowd of volunteer workers: free, and queued. A render is three kinds of
 * call — `POST /generate/async` submits it and answers an id; `GET
 * /generate/check/{id}` is the cheap poll (queue position, wait time, done);
 * `GET /generate/status/{id}` fetches the pictures once done (rate-limited,
 * so it is asked once). `DELETE /generate/status/{id}` cancels.
 *
 * ## The key is optional
 *
 * Anonymous requests use the key `0000000000` and go to the back of the
 * queue; a registered key earns kudos and priority. Either way every request
 * names this client in `Client-Agent`, which the Horde asks of integrations.
 *
 * ## What this wire has
 *
 * Everything the SD family has: a negative prompt (inline, after `###`),
 * seed, steps, CFG, sampler, clip skip, free size on a 64-pixel grid, a
 * starting canvas and an inpainting mask, up to twenty pictures a call, and
 * transparency drawn by the model (`transparent`, LayerDiffuse). References
 * ride `extra_source_images` — weakly: only some workers' models use them.
 *
 * ## A refusal is not a failure
 *
 * The Horde's prompt filter answers `rc: CorruptPrompt`, and a worker's own
 * filter returns a censored placeholder. Both come back as a `refusal` with
 * `noRetry: true`.
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
import {
	editAsGenerate,
	fetchPicture,
	readFailure,
	sleep
} from "./hostedImageHelpers"

const DEFAULT_BASE_URL = "https://aihorde.net/api"
/** The Horde's anonymous key. */
export const HORDE_ANONYMOUS_KEY = "0000000000"
/** `name:version:contact`, as the Horde asks of every integration. */
export const HORDE_CLIENT_AGENT = "serene-pub:0.6:https://github.com/doolijb/serene-pub"

/**
 * How often the cheap check is asked, and how long a render may wait in all.
 * A mutable object so a test can set the interval to zero.
 */
export const hordeTiming = { pollMs: 2_000, maxWaitMs: 20 * 60_000 }

// ── The sheet ───────────────────────────────────────────────────────────────

export const HORDE_SHEET: DrawingSheet = {
	negative: true,
	seed: true,
	steps: true,
	cfg: true,
	sampler: true,
	clipSkip: true,
	size: { kind: "free", step: 64, min: 64, max: 3072 },
	// Weak: `extra_source_images` reach only the workers whose models read them.
	references: { max: 4 },
	init: true,
	mask: true,
	transparent: "native",
	perCall: 20,
	outputs: { perRun: 1, keyed: false },
	// Queue position and wait time, from the check poll — no step count.
	progress: true,
	preview: false,
	cancel: true,
	video: false
}

// ── Samplers ────────────────────────────────────────────────────────────────

/** The Horde's sampler names. */
export const HORDE_SAMPLERS = [
	"k_euler_a",
	"k_euler",
	"k_lms",
	"k_heun",
	"k_dpm_2",
	"k_dpm_2_a",
	"k_dpm_fast",
	"k_dpm_adaptive",
	"k_dpmpp_2m",
	"k_dpmpp_2s_a",
	"k_dpmpp_sde",
	"DDIM",
	"lcm",
	"dpmsolver"
] as const

/** A1111-style names, as the sampling config stores them. */
const SAMPLER_ALIASES: Record<string, string> = {
	"euler a": "k_euler_a",
	euler_a: "k_euler_a",
	euler: "k_euler",
	lms: "k_lms",
	heun: "k_heun",
	"dpm2": "k_dpm_2",
	"dpm2 a": "k_dpm_2_a",
	"dpm fast": "k_dpm_fast",
	"dpm adaptive": "k_dpm_adaptive",
	"dpm++ 2m": "k_dpmpp_2m",
	dpmpp_2m: "k_dpmpp_2m",
	"dpm++ 2s a": "k_dpmpp_2s_a",
	"dpm++ sde": "k_dpmpp_sde",
	dpmpp_sde: "k_dpmpp_sde",
	ddim: "DDIM",
	lcm: "lcm"
}

/** The Horde's name for a sampler, or null when it has none. */
export function hordeSampler(name: string | undefined): string | null {
	if (!name) return null
	if ((HORDE_SAMPLERS as readonly string[]).includes(name)) return name
	const key = name.trim().toLowerCase().replace(/\s+karras$/, "")
	return SAMPLER_ALIASES[key] ?? null
}

// ── Profile ─────────────────────────────────────────────────────────────────

const PROFILE_SCHEMA: SettingsSchema = {
	models: {
		type: "string[]",
		label: "Models",
		description:
			"Horde models any worker may draw with, when the connection's own model is not set. Empty lets the Horde choose.",
		default: []
	},
	nsfw: {
		type: "boolean",
		label: "Allow adult content",
		description:
			"Lets workers that allow it draw adult content. Off asks workers to censor it.",
		default: false
	},
	trustedWorkers: {
		type: "boolean",
		label: "Trusted workers only",
		description: "Only workers the Horde trusts. Slower, rarely needed.",
		default: false
	},
	loras: {
		type: "text",
		format: "json",
		label: "LoRAs",
		description:
			'A JSON list sent as `loras`, e.g. [{"name": "123456", "model": 1}]. Workers fetch them from CivitAI.',
		default: []
	},
	postProcessing: {
		type: "string[]",
		label: "Post-processing",
		description:
			"Run after drawing: GFPGAN, CodeFormers, RealESRGAN_x4plus, strip_background and others the Horde lists.",
		default: []
	},
	hiresFix: {
		type: "boolean",
		label: "Hires fix",
		description: "Draw small, then upscale and refine — for large sizes.",
		default: false
	},
	shared: {
		type: "boolean",
		label: "Share with LAION",
		description:
			"Share the pictures for research. Shared requests cost a registered key less.",
		default: false
	}
}

const PROFILE_DEFAULTS = {
	models: [] as string[],
	nsfw: false,
	trustedWorkers: false,
	loras: [] as unknown,
	postProcessing: [] as string[],
	hiresFix: false,
	shared: false
}

// ── The adapter ─────────────────────────────────────────────────────────────

function hordeRoot(connection: { baseUrl?: string | null }): string {
	const raw = normalizeBaseUrl(connection.baseUrl) || DEFAULT_BASE_URL
	return `${raw.replace(/\/+$/, "").replace(/\/v2$/, "")}/v2`
}

function hordeHeaders(apiKey: unknown): Record<string, string> {
	const key = decryptApiKeyField(apiKey)
	return { apikey: key || HORDE_ANONYMOUS_KEY, "Client-Agent": HORDE_CLIENT_AGENT }
}

/** The Horde's filter, read from a failed submit. */
function hordeRefusal(body: any): ImageGenResult["refusal"] | null {
	if (body?.rc !== "CorruptPrompt") return null
	return {
		message: `The Horde refused this prompt: ${body.message ?? "it was flagged by the prompt filter."}`,
		code: "CorruptPrompt",
		details: body,
		noRetry: true
	}
}

class HordeAdapter extends BaseImageAdapter {
	async generateImage(
		req: ImageGenRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const signal = this.linkAbort(opts.signal)
		const t = new Translation()
		if (signal.aborted) return { media: [], isAborted: true, applied: [], ignored: [] }

		const conn = this.connection
		const sheet = HORDE_SHEET
		const profile = this.profile(PROFILE_DEFAULTS)
		const params: Record<string, unknown> = {}

		// ── Prompt: the negative goes inline ────────────────────────────────
		let prompt = t.apply("prompt", req.prompt)
		if (req.negativePrompt) prompt += ` ### ${t.apply("negativePrompt", req.negativePrompt)}`

		// ── Count ───────────────────────────────────────────────────────────
		const asked = t.take("batch", req.batch) ?? 1
		const n = Math.max(1, Math.min(asked, sheet.perCall))
		if (n < asked) t.ignore("batch")
		params.n = n

		// ── Size ────────────────────────────────────────────────────────────
		if (sheet.size.kind === "free") {
			const { step, min, max } = sheet.size
			for (const key of ["width", "height"] as const) {
				const v = req[key]
				if (v === undefined) continue
				if (v % step === 0 && v >= min && v <= max) params[key] = t.apply(key, v)
				else t.ignore(key)
			}
		}
		if (req.aspect && !req.width && !req.height) t.ignore("aspect")

		// ── SD knobs ────────────────────────────────────────────────────────
		const steps = t.take("steps", req.steps)
		if (steps !== undefined) params.steps = steps
		const cfg = t.take("cfg", req.cfg)
		if (cfg !== undefined) params.cfg_scale = cfg
		const seed = t.take("seed", req.seed !== undefined && req.seed >= 0 ? req.seed : undefined)
		if (seed !== undefined) params.seed = String(seed)
		if (req.sampler) {
			const s = hordeSampler(req.sampler)
			if (s) params.sampler_name = t.apply("sampler", s)
			else t.ignore("sampler")
		}
		if (req.scheduler) {
			if (/karras/i.test(req.scheduler)) params.karras = t.apply("scheduler", true)
			else t.ignore("scheduler")
		} else if (req.sampler && /karras$/i.test(req.sampler)) params.karras = true
		const clip = t.take("clipSkip", req.clipSkip)
		if (clip !== undefined) params.clip_skip = clip
		if (req.transparent) params.transparent = t.apply("transparent", true)
		t.take("outputFormat", req.outputFormat, false)
		t.take("video", req.video, false)

		// ── Profile ─────────────────────────────────────────────────────────
		if (profile.hiresFix) params.hires_fix = true
		if (Array.isArray(profile.loras) && profile.loras.length) params.loras = profile.loras
		if (profile.postProcessing?.length) params.post_processing = profile.postProcessing

		const body: Record<string, unknown> = {
			prompt,
			params,
			nsfw: !!profile.nsfw,
			censor_nsfw: !profile.nsfw,
			trusted_workers: !!profile.trustedWorkers,
			shared: !!profile.shared,
			r2: true
		}
		const model = req.model ?? conn.model
		if (model) {
			body.models = [model]
			if (req.model) t.apply("model", true)
		} else if (profile.models?.length) body.models = profile.models

		// ── Pictures in ─────────────────────────────────────────────────────
		if (req.init) {
			const [b64] = await this.base64Of([req.init], "init", t, opts)
			if (b64) {
				body.source_image = b64
				body.source_processing = "img2img"
				if (req.denoise !== undefined)
					params.denoising_strength = t.apply("denoise", req.denoise)
			}
		} else if (req.denoise !== undefined) t.ignore("denoise")
		if (req.mask) {
			if (!body.source_image) t.ignore("mask")
			else {
				const [m] = await this.base64Of([req.mask], "mask", t, opts)
				if (m) {
					body.source_mask = m
					body.source_processing = "inpainting"
				}
			}
		}
		if (req.references?.length) {
			const take = req.references.slice(0, sheet.references!.max)
			const loaded = await this.base64Of(take, "references", t, opts)
			if (loaded.length)
				body.extra_source_images = loaded.map((image) => ({ image, strength: 1 }))
			if (take.length < req.references.length) t.ignore("references")
		}

		// ── Submit ──────────────────────────────────────────────────────────
		const root = hordeRoot(conn)
		const headers = hordeHeaders((conn.extraJson as any)?.apiKey)
		opts.onProgress?.({ stage: "queued", percent: 0 })
		let id: string
		try {
			const res = await fetch(`${root}/generate/async`, {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal
			})
			if (!res.ok) {
				const { text, body: err } = await readFailure(res)
				const refusal = hordeRefusal(err)
				if (refusal)
					return { media: [], isAborted: false, applied: t.applied, ignored: t.ignored, refusal, raw: err }
				throw new Error(
					`The Horde refused the request (${res.status}): ${err?.message ?? text.slice(0, 300)}`
				)
			}
			const answer = (await res.json()) as { id?: string; kudos?: number; message?: string }
			if (!answer.id) throw new Error(`The Horde did not queue the request: ${answer.message ?? "no id"}`)
			id = answer.id
		} catch (e) {
			if (signal.aborted) return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			throw e instanceof Error ? e : new Error(String(e))
		}

		// ── Wait ────────────────────────────────────────────────────────────
		const started = Date.now()
		for (;;) {
			if (signal.aborted) {
				await this.cancel(root, headers, id)
				return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			}
			let check: any
			try {
				const res = await fetch(`${root}/generate/check/${id}`, { headers, signal })
				check = res.ok ? await res.json() : null
			} catch {
				check = null
			}
			if (check) {
				if (check.faulted) throw new Error("The Horde reported the render as failed.")
				if (check.is_possible === false) {
					await this.cancel(root, headers, id)
					throw new Error(
						"No Horde worker can take this request right now — try another model, a smaller size, or turn off options few workers offer."
					)
				}
				if (check.done) break
				const queued = (check.waiting ?? 0) > 0 && !(check.processing > 0)
				opts.onProgress?.({
					stage: queued ? "queued" : "sampling",
					percent: Math.round(((check.finished ?? 0) / n) * 100),
					...(typeof check.wait_time === "number" ? { etaSec: check.wait_time } : {}),
					message: queued
						? `In the Horde's queue${check.queue_position ? ` at position ${check.queue_position}` : ""}`
						: "A worker is drawing"
				})
			}
			if (Date.now() - started > hordeTiming.maxWaitMs) {
				await this.cancel(root, headers, id)
				throw new Error("The Horde did not finish within twenty minutes; the request was cancelled.")
			}
			await sleep(hordeTiming.pollMs, signal)
		}

		// ── Collect ─────────────────────────────────────────────────────────
		const res = await fetch(`${root}/generate/status/${id}`, { headers, signal })
		if (!res.ok) {
			const { text, body: err } = await readFailure(res)
			throw new Error(`The Horde could not return the pictures (${res.status}): ${err?.message ?? text.slice(0, 300)}`)
		}
		const status = (await res.json()) as any
		const media: GeneratedMediaItem[] = []
		let censored = 0
		for (const g of status?.generations ?? []) {
			if (g?.censored) {
				censored++
				continue
			}
			const img = typeof g?.img === "string" ? g.img : ""
			const pic = /^https?:\/\//.test(img)
				? await fetchPicture(img, signal)
				: img
					? { base64: img, mime: "image/webp" }
					: undefined
			if (!pic) continue
			media.push({
				kind: "image",
				mime: pic.mime,
				base64: pic.base64,
				...(g.seed !== undefined && Number.isFinite(Number(g.seed)) ? { seed: Number(g.seed) } : {}),
				meta: {
					backend: "horde",
					...(g.model ? { model: g.model } : {}),
					...(g.worker_name ? { worker: g.worker_name } : {}),
					...(status.kudos !== undefined ? { kudos: status.kudos } : {})
				}
			})
		}
		if (!media.length && censored)
			return {
				media: [],
				isAborted: false,
				applied: t.applied,
				ignored: t.ignored,
				refusal: {
					message: "The Horde's workers censored every picture for this prompt.",
					code: "censored",
					noRetry: true
				}
			}
		if (!media.length) throw new Error("The Horde completed without returning an image.")
		if (media.length < n) t.ignore("batch")
		opts.onProgress?.({ stage: "saving", percent: 100 })
		return {
			media,
			isAborted: false,
			applied: t.applied,
			ignored: t.ignored,
			raw: { id, kudos: status?.kudos }
		}
	}

	async editImage(req: ImageEditRequest, opts: ImageGenOptions = {}): Promise<ImageGenResult> {
		return this.generateImage(editAsGenerate(req), opts)
	}

	private async cancel(root: string, headers: Record<string, string>, id: string) {
		try {
			await fetch(`${root}/generate/status/${id}`, { method: "DELETE", headers })
		} catch {
			// Best effort: an orphaned request finishes and is never collected.
		}
	}
}

// ── Listing and testing ─────────────────────────────────────────────────────

/** The image models at least one worker serves now, busiest first. */
async function listModels(connection: SelectConnection): Promise<{
	models: Array<{ id: string; name: string; modality: "image-gen" }>
	error?: string
}> {
	try {
		const res = await fetch(`${hordeRoot(connection)}/status/models?type=image`, {
			headers: hordeHeaders((connection.extraJson as any)?.apiKey)
		})
		if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
		const body = (await res.json()) as any[]
		return {
			models: (Array.isArray(body) ? body : [])
				.filter((m) => typeof m?.name === "string" && (m.count ?? 0) > 0)
				.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
				.map((m) => ({ id: m.name, name: m.name, modality: "image-gen" as const }))
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
		return { ok: false, error: "The Horde answered, but no worker is serving an image model right now." }
	const root = hordeRoot(connection)
	const headers = hordeHeaders((connection.extraJson as any)?.apiKey)
	const extra: Record<string, unknown> = {
		imageModels: models.map((m) => m.id),
		capabilities: { "text->image": "native" }
	}
	// Who the key belongs to, and its kudos. Anonymous is fine.
	if (headers.apikey !== HORDE_ANONYMOUS_KEY) {
		try {
			const res = await fetch(`${root}/find_user`, { headers })
			if (res.status === 401 || res.status === 404)
				return { ok: false, error: "The Horde does not know this API key." }
			if (res.ok) {
				const user = (await res.json()) as any
				extra.user = user?.username
				extra.kudos = user?.kudos
			}
		} catch {
			// The listing answered; a user lookup failing is not a failed test.
		}
	} else extra.anonymous = true
	// Whether any worker takes a starting canvas right now.
	try {
		const res = await fetch(`${root}/workers?type=image`, { headers })
		if (res.ok) {
			const workers = (await res.json()) as any[]
			;(extra.capabilities as Record<string, string>)["text+image->image"] =
				Array.isArray(workers) && workers.some((w) => w?.img2img === true) ? "native" : "none"
		}
	} catch {
		// Unknown stays unknown: the manifest's assumption holds.
	}
	return { ok: true, extra }
}

const exports: ImageAdapterExports = {
	Adapter: HordeAdapter,
	listModels,
	testConnection,
	sheet: HORDE_SHEET,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

export default exports
