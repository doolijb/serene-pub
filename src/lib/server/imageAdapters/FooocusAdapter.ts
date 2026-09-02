/**
 * Fooocus adapter — talks to **Fooocus-API** (the FastAPI wrapper; Fooocus itself
 * has no HTTP server) over its NATIVE endpoints, so Fooocus's own vocabulary is
 * first-class rather than the flat A1111 subset:
 *
 *   POST /v1/generation/text-to-image   — submit (async, returns a job id)
 *   GET  /v1/generation/query-job       — poll: stage, percent, step preview, results
 *   POST /v1/generation/stop            — cancel the running job
 *   GET  /v1/engines/all-models         — checkpoints + loras (list + health)
 *   GET  /v1/engines/styles             — the style names the profile form offers
 *
 * ## Async, not sync
 *
 * `async_process: false` would be one call and no polling, and it was what this
 * started as. But a render is tens of seconds to minutes: a synchronous request
 * gives no progress, no preview, and nothing to cancel — the page can only show a
 * spinner and hope. Polling a job costs one request every 750ms and buys all
 * three, so it is worth the loop.
 *
 * ## What Fooocus cannot do
 *
 * Two things it is genuinely worth knowing about, both reported as `ignored`
 * rather than silently absorbed:
 *
 *   - **Sizes are a fixed list.** `aspect_ratios_selection` takes one of about a
 *     dozen "W*H" strings, not free pixels. A requested size is snapped to the
 *     nearest by aspect ratio, and the snap is reported — returning a
 *     differently-shaped image without saying so is the version of this that
 *     wastes an afternoon.
 *   - **Steps and sampler live in `advanced_params`,** not at the top level, and
 *     `overwrite_step` only takes effect above 0. A performance preset
 *     (Speed/Quality/…) normally decides the step count, so setting both means
 *     the explicit one wins.
 */
import {
	BaseImageAdapter,
	CONNECTION_TYPE,
	Translation,
	type ImageAdapterExports,
	type ImageCapabilities,
	type ImageGenOptions,
	type ImageGenRequest,
	type ImageGenResult,
	type GeneratedMediaItem
} from "./BaseImageAdapter"
import type { SettingsSchema } from "@serene-pub/sdk"

const DEFAULT_BASE_URL = "http://localhost:8888"

/** How often to ask the job endpoint where it has got to. */
const POLL_MS = 750

/**
 * The sizes Fooocus offers, as it spells them.
 *
 * Hardcoded because Fooocus-API exposes no endpoint that lists them, and they are
 * a property of Fooocus's own configuration rather than of the installed model.
 * SDXL-native resolutions, all ~1M pixels.
 */
const ASPECT_RATIOS = [
	"704*1408",
	"704*1344",
	"768*1344",
	"768*1280",
	"832*1216",
	"832*1152",
	"896*1152",
	"896*1088",
	"960*1088",
	"960*1024",
	"1024*1024",
	"1024*960",
	"1088*960",
	"1088*896",
	"1152*896",
	"1152*832",
	"1216*832",
	"1280*768",
	"1344*768",
	"1344*704",
	"1408*704"
] as const

const DEFAULT_ASPECT = "1152*896"

const SIZE_PRESETS = ASPECT_RATIOS.map((s) => {
	const [width, height] = s.split("*").map(Number)
	return { width, height }
})

/**
 * The Fooocus-only settings, declared so core can render a form for them without
 * knowing what any of them mean.
 */
const PROFILE_SCHEMA: SettingsSchema = {
	performance: {
		type: "enum",
		label: "Performance",
		description:
			"Fooocus's speed/quality preset. It normally decides the step count — an explicit Steps value overrides it.",
		of: ["Speed", "Quality", "Extreme Speed", "Lightning", "Hyper-SD"],
		default: "Speed",
		quick: true
	},
	styles: {
		type: "string[]",
		label: "Styles",
		description:
			"Fooocus style names, one per line. Test the connection to see which this install has.",
		default: ["Fooocus V2"],
		quick: true
	},
	sharpness: {
		type: "number",
		label: "Sharpness",
		description: "Fooocus's own sharpening pass.",
		min: 0,
		max: 30,
		default: 2
	},
	saveExtension: {
		type: "enum",
		label: "Image Format",
		description: "What Fooocus encodes the result as.",
		of: ["png", "jpg", "webp"],
		default: "png"
	}
}

const PROFILE_DEFAULTS = {
	performance: "Speed",
	styles: ["Fooocus V2"],
	sharpness: 2,
	saveExtension: "png"
}

const CAPABILITIES: ImageCapabilities = {
	progress: true,
	preview: true,
	cancel: true,
	batch: true,
	img2img: false,
	video: false,
	// The single most consequential thing to know about this backend.
	freeSize: false,
	sizePresets: SIZE_PRESETS,
	// Fooocus accepts sampler/scheduler names through advanced_params but
	// publishes no list, so an empty array here means "we cannot say", not "none".
	samplers: [],
	schedulers: []
}

/** The optional `X-API-KEY` header, when Fooocus-API was started with --apikey. */
function authHeaders(connection: SelectConnection): Record<string, string> {
	const key = (connection.extraJson as any)?.apiKey
	return typeof key === "string" && key ? { "X-API-KEY": key } : {}
}

function base(connection: SelectConnection): string {
	return (connection.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
}

/**
 * The offered size closest in SHAPE to what was asked for.
 *
 * By aspect ratio rather than by pixel count, because every option is about the
 * same number of pixels anyway — what a person actually chose when they typed
 * 832×1216 is "portrait, fairly tall", and the nearest ratio preserves that
 * whereas the nearest area does not.
 */
function snapAspect(
	width?: number,
	height?: number
): { value: string; snapped: boolean } {
	if (!width || !height) return { value: DEFAULT_ASPECT, snapped: false }

	const exact = `${width}*${height}`
	if ((ASPECT_RATIOS as readonly string[]).includes(exact))
		return { value: exact, snapped: false }

	const want = width / height
	let best = DEFAULT_ASPECT
	let bestDelta = Infinity
	for (const option of ASPECT_RATIOS) {
		const [w, h] = option.split("*").map(Number)
		const delta = Math.abs(w / h - want)
		if (delta < bestDelta) {
			bestDelta = delta
			best = option
		}
	}
	return { value: best, snapped: true }
}

const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp"
}

interface JobStatus {
	job_id?: string
	job_stage?: string
	job_progress?: number
	job_status?: string | null
	job_step_preview?: string | null
	job_result?: Array<{
		base64?: string | null
		url?: string | null
		seed?: string | number
		finish_reason?: string
	}> | null
}

class FooocusAdapter extends BaseImageAdapter {
	/** The job this instance submitted, so cancelling stops OURS and not a stranger's. */
	private jobId: string | null = null

	async generate(
		req: ImageGenRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const signal = this.linkAbort(opts.signal)
		const profile = this.profile(PROFILE_DEFAULTS)
		const t = new Translation()

		// Already cancelled before we started: submit nothing. Relying on fetch to
		// reject would be nearly the same thing, except that the job would already
		// have been accepted by the time it did — and stopping it means calling a
		// GLOBAL stop endpoint, which on a shared instance would kill whatever
		// somebody else had running.
		if (signal.aborted) return this.aborted(t)

		const { value: aspect, snapped } = snapAspect(req.width, req.height)
		if (req.width || req.height) {
			if (snapped) {
				// Reported, not swallowed: the image really will not be the size
				// that was asked for.
				t.ignore("width")
				t.ignore("height")
			} else {
				t.applied.push("width", "height")
			}
		}

		// `overwrite_step` only takes effect above 0; below that Fooocus uses
		// whatever the performance preset dictates.
		const advanced: Record<string, unknown> = {}
		const steps = t.take("steps", req.steps)
		if (steps !== undefined) advanced.overwrite_step = steps
		const sampler = t.take("sampler", req.sampler)
		if (sampler !== undefined) advanced.sampler_name = sampler
		const scheduler = t.take("scheduler", req.scheduler)
		if (scheduler !== undefined) advanced.scheduler_name = scheduler
		const clipSkip = t.take("clipSkip", req.clipSkip)
		if (clipSkip !== undefined) advanced.clip_skip = clipSkip

		// Fooocus-API's text-to-image endpoint is txt2img only, and this build
		// renders stills. Declared unsupported here so the caller learns it from
		// the result rather than from an image that ignored half the request.
		t.take("denoise", req.denoise, false)
		t.take("init", req.init, false)
		t.take("video", req.video, false)

		const model = req.model ?? this.connection.model
		const body: Record<string, unknown> = {
			prompt: t.apply("prompt", req.prompt),
			negative_prompt: req.negativePrompt
				? t.apply("negativePrompt", req.negativePrompt)
				: "",
			performance_selection: profile.performance,
			style_selections: profile.styles,
			aspect_ratios_selection: aspect,
			image_number: t.take("batch", req.batch) ?? 1,
			image_seed: t.take("seed", req.seed) ?? -1,
			sharpness: profile.sharpness,
			guidance_scale: t.take("cfg", req.cfg) ?? 4,
			// Omitted entirely when unset, so Fooocus keeps its own default
			// checkpoint rather than being handed `undefined`.
			...(model ? { base_model_name: t.apply("model", model) } : {}),
			save_extension: profile.saveExtension,
			require_base64: true,
			async_process: true
		}
		if (Object.keys(advanced).length) body.advanced_params = advanced

		const root = base(this.connection)
		const headers = {
			"Content-Type": "application/json",
			...authHeaders(this.connection)
		}

		// ── submit ───────────────────────────────────────────────────────
		let submitted: JobStatus
		try {
			const res = await fetch(`${root}/v1/generation/text-to-image`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal
			})
			if (!res.ok) {
				const text = await res.text().catch(() => "")
				throw new Error(
					`Fooocus generation failed (${res.status}): ${text.slice(0, 300)}`
				)
			}
			submitted = (await res.json()) as JobStatus
		} catch (e) {
			if (signal.aborted) return this.aborted(t)
			throw new Error(
				`Fooocus request failed: ${e instanceof Error ? e.message : String(e)}`
			)
		}

		this.jobId = submitted.job_id ?? null
		if (!this.jobId)
			throw new Error(
				"Fooocus accepted the request but returned no job id, so there is nothing to poll."
			)

		opts.onProgress?.({ stage: "queued", percent: 0 })

		// ── poll ─────────────────────────────────────────────────────────
		try {
			for (;;) {
				if (signal.aborted)
					return await this.cancelAndReport(root, headers, t)
				await sleep(POLL_MS, signal)
				if (signal.aborted)
					return await this.cancelAndReport(root, headers, t)

				const res = await fetch(
					`${root}/v1/generation/query-job?job_id=${encodeURIComponent(this.jobId)}&require_step_preview=true`,
					{ headers, signal }
				)
				if (!res.ok) {
					const text = await res.text().catch(() => "")
					throw new Error(
						`Fooocus job query failed (${res.status}): ${text.slice(0, 300)}`
					)
				}
				const job = (await res.json()) as JobStatus
				const stage = (job.job_stage ?? "").toUpperCase()

				if (stage === "SUCCESS") {
					opts.onProgress?.({ stage: "saving", percent: 100 })
					return {
						media: toMedia(job, profile.saveExtension as string),
						isAborted: false,
						applied: t.applied,
						ignored: t.ignored,
						raw: { jobId: this.jobId }
					}
				}
				if (stage === "ERROR" || stage === "FAILED")
					throw new Error(
						`Fooocus reported the job failed: ${job.job_status ?? "no reason given"}`
					)

				opts.onProgress?.({
					stage: stage === "WAITING" ? "queued" : "sampling",
					percent: clampPercent(job.job_progress),
					...(job.job_step_preview
						? {
								preview: {
									base64: stripDataUrl(job.job_step_preview),
									mime: "image/png"
								}
							}
						: {}),
					...(job.job_status ? { message: job.job_status } : {})
				})
			}
		} catch (e) {
			if (signal.aborted)
				return await this.cancelAndReport(root, headers, t)
			throw e
		}
	}

	private aborted(t: Translation): ImageGenResult {
		return {
			media: [],
			isAborted: true,
			applied: t.applied,
			ignored: t.ignored
		}
	}

	/**
	 * Stop the job, then report the abort.
	 *
	 * `/v1/generation/stop` is GLOBAL — it stops whatever Fooocus is currently
	 * rendering, not a job named by id. So it is only ever called when THIS
	 * adapter has a job in flight, which keeps a cancel here from killing someone
	 * else's render on a shared instance. It is best-effort: if the call fails the
	 * run is still over as far as this caller is concerned.
	 */
	private async cancelAndReport(
		root: string,
		headers: Record<string, string>,
		t: Translation
	): Promise<ImageGenResult> {
		if (this.jobId) {
			try {
				await fetch(`${root}/v1/generation/stop`, {
					method: "POST",
					headers
				})
			} catch {
				// Best-effort; the caller has already stopped waiting.
			}
			this.jobId = null
		}
		return this.aborted(t)
	}
}

function toMedia(job: JobStatus, ext: string): GeneratedMediaItem[] {
	const mime = MIME_BY_EXT[ext] ?? "image/png"
	return (job.job_result ?? [])
		.filter((r) => typeof r.base64 === "string" && r.base64)
		.map((r) => ({
			kind: "image" as const,
			mime,
			base64: stripDataUrl(r.base64 as string),
			// Fooocus returns the seed as a string; keep a number when it is one,
			// so provenance reads as a seed rather than as text that looks like one.
			seed: numericSeed(r.seed),
			meta: {
				backend: "fooocus",
				...(r.finish_reason ? { finishReason: r.finish_reason } : {}),
				...(r.url ? { sourceUrl: r.url } : {})
			}
		}))
}

const numericSeed = (
	v: string | number | undefined
): number | string | undefined => {
	if (v === undefined || v === null) return undefined
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : v
}

/** Fooocus sometimes prefixes previews with a data URL header; the store wants raw. */
const stripDataUrl = (s: string): string => s.replace(/^data:[^;]+;base64,/, "")

const clampPercent = (v: unknown): number => {
	const n = typeof v === "number" ? v : Number(v)
	if (!Number.isFinite(n)) return 0
	return Math.max(0, Math.min(100, n))
}

/** A cancellable wait, so an abort during the gap between polls takes effect at once. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve()
		const timer = setTimeout(done, ms)
		function done() {
			clearTimeout(timer)
			signal.removeEventListener("abort", done)
			resolve()
		}
		signal.addEventListener("abort", done, { once: true })
	})
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: string[]; error?: string }> {
	try {
		const res = await fetch(`${base(connection)}/v1/engines/all-models`, {
			headers: authHeaders(connection)
		})
		if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
		const data = (await res.json()) as { model_filenames?: string[] }
		return { models: data.model_filenames ?? [] }
	} catch (e) {
		return {
			models: [],
			error: e instanceof Error ? e.message : String(e)
		}
	}
}

async function testConnection(connection: SelectConnection): Promise<{
	ok: boolean
	error?: string
	extra?: Record<string, unknown>
}> {
	try {
		const res = await fetch(`${base(connection)}/v1/engines/all-models`, {
			headers: authHeaders(connection)
		})
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

		// The style list comes back with the test rather than from its own call:
		// it is the one thing the profile form cannot sensibly guess, and this is
		// the moment the form already knows the connection is reachable.
		let styles: string[] = []
		try {
			const s = await fetch(`${base(connection)}/v1/engines/styles`, {
				headers: authHeaders(connection)
			})
			if (s.ok) {
				const data = await s.json()
				if (Array.isArray(data)) styles = data.map(String)
			}
		} catch {
			// A missing style list is not a failed connection.
		}

		return { ok: true, ...(styles.length ? { extra: { styles } } : {}) }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

const exports: ImageAdapterExports = {
	Adapter: FooocusAdapter,
	listModels,
	testConnection,
	capabilities: CAPABILITIES,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

// Referenced so the type import isn't dropped and the mapping is discoverable.
void CONNECTION_TYPE.IMAGE_FOOOCUS

export default exports
