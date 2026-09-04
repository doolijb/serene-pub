/**
 * The A1111-compatible image API — one adapter, four backends.
 *
 *   POST /sdapi/v1/txt2img   — render
 *   GET  /sdapi/v1/progress  — how far along, with a partial frame
 *   POST /sdapi/v1/interrupt — stop the running render
 *   GET  /sdapi/v1/sd-models — the checkpoints installed
 *   GET  /sdapi/v1/samplers  — the sampler names this build accepts
 *
 * **KoboldCPP**, AUTOMATIC1111, **Forge** and **SD.Next** all speak this, which
 * is the entire argument for scoping an adapter by API FORMAT rather than by
 * vendor: one file, and the number of supported image backends goes from zero to
 * four. KoboldCPP is the one worth naming, because the app already downloads and
 * supervises its binary — so for a managed install, "set up image generation"
 * is picking a model file and nothing else.
 *
 * ## Where the four disagree
 *
 * The API is a shared surface, not a shared implementation, and this adapter is
 * where the differences are absorbed rather than pushed at the caller:
 *
 *   - **Batching.** A1111 renders `batch_size × n_iter`; KoboldCPP returns one
 *     image per request whatever it is asked for. Handled by asking, counting
 *     what came back, and reporting `batch` as ignored when it is short — rather
 *     than by branching on which backend is on the other end.
 *   - **Interrupt.** A1111 has `/sdapi/v1/interrupt`; KoboldCPP does not, and
 *     answers 404. Aborting the request is what actually stops a KoboldCPP
 *     render, so the endpoint is best-effort on top of that, never instead of it.
 *   - **`info`.** A1111 returns a JSON *string* carrying the seed actually used;
 *     KoboldCPP returns a thinner one or none. Every field is read defensively,
 *     because a missing seed should cost the provenance line and not the image.
 */
import {
	BaseImageAdapter,
	Translation,
	type GeneratedMediaItem,
	type ImageAdapterExports,
	type ImageCapabilities,
	type ImageGenOptions,
	type ImageGenRequest,
	type ImageGenResult
} from "./BaseImageAdapter"
import type { SettingsSchema } from "@serene-pub/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const DEFAULT_BASE_URL = "http://localhost:5001"

/** How often to ask how far along a render is. */
const POLL_MS = 750

const PROFILE_SCHEMA: SettingsSchema = {
	restoreFaces: {
		type: "boolean",
		label: "Restore faces",
		description: "Runs the face-restoration pass, where the backend has one.",
		default: false
	},
	overrideSettings: {
		type: "text",
		format: "json",
		label: "Override settings",
		description:
			"A1111 `override_settings`, as JSON — applied for this request only. For anything the shared parameters have no name for.",
		default: {}
	}
}

const PROFILE_DEFAULTS = {
	restoreFaces: false,
	overrideSettings: {} as Record<string, unknown>
}

const CAPABILITIES: ImageCapabilities = {
	progress: true,
	preview: true,
	cancel: true,
	// Asked for; whether it arrives depends on the backend, and the result says
	// which happened rather than this claiming to know in advance.
	batch: true,
	// No `img2img` key any more, and its absence is not an oversight: this class
	// implements `generateImage` and NOT `editImage`, and that is now the single
	// statement of "txt2img-only". The flag used to say it a second time and the
	// manifest a third — where it said the opposite (`text+image->image: native`)
	// for a release, because nothing checks a boolean against a table.
	video: false,
	// Free pixels, unlike the fixed-list backends — so the size fields in the
	// sampling config mean what they say.
	freeSize: true,
	samplers: [],
	schedulers: []
}

function authHeaders(connection: SelectConnection): Record<string, string> {
	const key = (connection.extraJson as any)?.apiKey
	return typeof key === "string" && key ? { Authorization: `Bearer ${key}` } : {}
}

function base(connection: SelectConnection): string {
	return (connection.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
}

/** A1111 wants multiples of 8; asking for 831 gets silently rounded anyway. */
const toStep8 = (n: number): number => Math.max(64, Math.round(n / 8) * 8)

interface TxtToImgResponse {
	images?: string[] | null
	/** A JSON *string*, not an object. Carries the seed actually used. */
	info?: string | null
	parameters?: Record<string, unknown> | null
}

interface ProgressResponse {
	progress?: number
	eta_relative?: number
	current_image?: string | null
	textinfo?: string | null
	state?: {
		job?: string
		sampling_step?: number
		sampling_steps?: number
	} | null
}

/**
 * `generateImage`, and deliberately nothing else.
 *
 * The set of methods here IS this backend's declared in-and-out: the manifest's
 * `text->image` key for every type routed at this module is derived from the one
 * below, and the absence of `editImage` is what makes "txt2img-only" a checkable
 * fact rather than a sentence in a comment. Adding img2img means adding
 * `editImage` — a different route (`/sdapi/v1/img2img`) with a different request
 * — not widening this one, and the capability key follows from the method rather
 * than being declared alongside it.
 */
class A1111Adapter extends BaseImageAdapter {
	/** Whether THIS adapter has a render in flight, so interrupt only stops ours. */
	private inFlight = false

	async generateImage(
		req: ImageGenRequest,
		opts: ImageGenOptions = {}
	): Promise<ImageGenResult> {
		const signal = this.linkAbort(opts.signal)
		const profile = this.profile(PROFILE_DEFAULTS)
		const t = new Translation()

		// Cancelled before we started: send nothing. Submitting and then
		// interrupting would, on a shared server, stop whatever else was running.
		if (signal.aborted)
			return { media: [], isAborted: true, applied: [], ignored: [] }

		const width = t.take("width", req.width)
		const height = t.take("height", req.height)
		const batch = t.take("batch", req.batch) ?? 1

		const overrides: Record<string, unknown> = {
			...(profile.overrideSettings ?? {})
		}
		// KoboldCPP is the exception among the four: it holds exactly one image
		// model at a time and has no checkpoint list to switch between. Which
		// model that is was decided before this request — by the `.kcpps` the
		// Manager wrote, or by the `--sdmodel` an external instance was started
		// with — so `sd_model_checkpoint` is a per-request answer to a question
		// nobody can ask here.
		//
		// True of all three ids, for two different reasons worth keeping apart.
		// On KOBOLDCPP and KOBOLDCPP_MANAGED `connection.model` is a TEXT gguf,
		// so the line below was literally sending "MN-12B-Lyra-v4-Q4_K_M.gguf"
		// as a checkpoint name. On KOBOLDCPP_MANAGED_IMAGE it genuinely IS the
		// image model — and still must not be sent, because naming it here would
		// claim the backend can switch to it mid-request when what actually
		// loads it is a full model swap through the Manager.
		//
		// Today's build ignores an override it doesn't recognise; a stricter one
		// would reject the render, so send nothing rather than something
		// meaningless.
		if (
			this.connection.type === CONNECTION_TYPE.KOBOLDCPP ||
			this.connection.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED ||
			this.connection.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		) {
			// Only a model the CALLER asked for is a broken promise worth
			// reporting; falling back to connection.model was this file's own
			// idea and nobody is owed an answer about it.
			t.take("model", req.model, false)
		} else {
			const model = req.model ?? this.connection.model
			if (model) overrides.sd_model_checkpoint = t.apply("model", model)
		}

		const body: Record<string, unknown> = {
			prompt: t.apply("prompt", req.prompt),
			negative_prompt: req.negativePrompt
				? t.apply("negativePrompt", req.negativePrompt)
				: "",
			...(width ? { width: toStep8(width) } : {}),
			...(height ? { height: toStep8(height) } : {}),
			...(req.steps !== undefined ? { steps: t.take("steps", req.steps) } : {}),
			...(req.cfg !== undefined
				? { cfg_scale: t.take("cfg", req.cfg) }
				: {}),
			...(req.seed !== undefined ? { seed: t.take("seed", req.seed) } : {}),
			...(req.sampler
				? { sampler_name: t.take("sampler", req.sampler) }
				: {}),
			...(req.scheduler
				? { scheduler: t.take("scheduler", req.scheduler) }
				: {}),
			// `n_iter` rather than `batch_size`: sequential images cost VRAM once,
			// where a batch multiplies it — and on the hardware this backend is
			// usually running on, that is the difference between four images and
			// an out-of-memory error.
			...(batch > 1 ? { n_iter: batch } : {}),
			...(profile.restoreFaces ? { restore_faces: true } : {}),
			...(Object.keys(overrides).length
				? { override_settings: overrides }
				: {}),
			save_images: false
		}

		// Declared unsupported rather than silently absorbed: this endpoint is
		// txt2img, and clipSkip belongs to `override_settings` on the builds that
		// have it at all. `denoise` still arrives because the image sampling config
		// carries it for whichever action ends up running — here there is nothing
		// to denoise from, so it is reported rather than sent.
		//
		// There is no `init` line any more. It was `t.take("init", req.init, false)`
		// — declining, at the HTTP call, a field this request can no longer carry:
		// an init belongs to `ImageEditRequest`, which is `editImage`'s input, and
		// this class has no `editImage`. Declining per render was the only answer
		// available while one request type served both actions, and it could only
		// ever be given after someone had already asked. The same answer now comes
		// from the shape of the request, before anything is sent.
		t.take("clipSkip", req.clipSkip, false)
		t.take("denoise", req.denoise, false)
		t.take("video", req.video, false)

		const root = base(this.connection)
		const headers = {
			"Content-Type": "application/json",
			...authHeaders(this.connection)
		}

		opts.onProgress?.({ stage: "queued", percent: 0 })

		// The render is one long request; progress is a SEPARATE poll alongside
		// it. That is the shape the API forces — there is no job id to follow —
		// and it is why the poller has to be started before the await and stopped
		// in a finally.
		this.inFlight = true
		const stopPolling = opts.onProgress
			? this.pollProgress(root, headers, signal, opts.onProgress)
			: () => {}

		let data: TxtToImgResponse
		try {
			const res = await fetch(`${root}/sdapi/v1/txt2img`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal
			})
			if (!res.ok) {
				const text = await res.text().catch(() => "")
				throw new Error(
					`Image generation failed (${res.status}): ${text.slice(0, 300)}`
				)
			}
			data = (await res.json()) as TxtToImgResponse
		} catch (e) {
			if (signal.aborted) {
				await this.interrupt(root, headers)
				return { media: [], isAborted: true, applied: t.applied, ignored: t.ignored }
			}
			throw new Error(
				`Image request failed: ${e instanceof Error ? e.message : String(e)}`
			)
		} finally {
			this.inFlight = false
			stopPolling()
		}

		const images = (data.images ?? []).filter(
			(b) => typeof b === "string" && b
		)
		if (!images.length)
			throw new Error(
				"The backend completed without returning an image. If it has no image model loaded, load one and try again."
			)

		// Asked for several and got one: KoboldCPP renders a single image per
		// request whatever `n_iter` says. Reported rather than branched on, so
		// this file never has to know which backend answered.
		if (batch > 1 && images.length < batch) t.ignore("batch")

		const seed = seedFrom(data.info)
		opts.onProgress?.({ stage: "saving", percent: 100 })

		return {
			media: images.map(
				(base64): GeneratedMediaItem => ({
					kind: "image",
					mime: "image/png",
					base64: stripDataUrl(base64),
					...(seed !== undefined ? { seed } : {}),
					meta: {
						backend: "a1111",
						...(data.info ? { info: data.info } : {})
					}
				})
			),
			isAborted: false,
			applied: t.applied,
			ignored: t.ignored
		}
	}

	/**
	 * Poll `/sdapi/v1/progress` until told to stop. Returns the stopper.
	 *
	 * Every failure here is swallowed: progress is a nicety, and a backend that
	 * does not implement the endpoint (or answers slowly because it is busy
	 * rendering) must not turn a working render into a failed one.
	 */
	private pollProgress(
		root: string,
		headers: Record<string, string>,
		signal: AbortSignal,
		onProgress: NonNullable<ImageGenOptions["onProgress"]>
	): () => void {
		let stopped = false
		const tick = async () => {
			while (!stopped && !signal.aborted) {
				await sleep(POLL_MS, signal)
				if (stopped || signal.aborted) return
				try {
					const res = await fetch(
						`${root}/sdapi/v1/progress?skip_current_image=false`,
						{ headers }
					)
					if (!res.ok) return
					const p = (await res.json()) as ProgressResponse
					const pct = Math.max(0, Math.min(100, (p.progress ?? 0) * 100))
					onProgress({
						stage: "sampling",
						percent: pct,
						...(p.state?.sampling_step != null
							? { step: p.state.sampling_step }
							: {}),
						...(p.state?.sampling_steps
							? { steps: p.state.sampling_steps }
							: {}),
						...(p.eta_relative
							? { etaSec: Math.round(p.eta_relative) }
							: {}),
						...(p.current_image
							? {
									preview: {
										base64: stripDataUrl(p.current_image),
										mime: "image/png"
									}
								}
							: {})
					})
				} catch {
					// A backend without the endpoint, or one too busy to answer.
					return
				}
			}
		}
		void tick()
		return () => {
			stopped = true
		}
	}

	/**
	 * Best-effort stop.
	 *
	 * Only ever called while THIS adapter has a render in flight — `/interrupt`
	 * stops whatever the server is currently doing, so calling it otherwise would
	 * cancel somebody else's work on a shared instance. KoboldCPP has no such
	 * endpoint and answers 404; aborting the request is what stops it, and this
	 * is the addition on top rather than the mechanism.
	 */
	private async interrupt(
		root: string,
		headers: Record<string, string>
	): Promise<void> {
		if (!this.inFlight) return
		try {
			await fetch(`${root}/sdapi/v1/interrupt`, { method: "POST", headers })
		} catch {
			// The caller has already stopped waiting.
		}
	}
}

/** A1111 returns `info` as a JSON string; the seed inside it is the real one. */
function seedFrom(info?: string | null): number | undefined {
	if (!info) return undefined
	try {
		const parsed = JSON.parse(info) as { seed?: unknown }
		const n = Number(parsed?.seed)
		return Number.isFinite(n) ? n : undefined
	} catch {
		return undefined
	}
}

const stripDataUrl = (s: string): string =>
	s.replace(/^data:[^;]+;base64,/, "")

/** A cancellable wait, so an abort between polls takes effect at once. */
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
		const res = await fetch(`${base(connection)}/sdapi/v1/sd-models`, {
			headers: authHeaders(connection)
		})
		if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
		const data = (await res.json()) as Array<{
			title?: string
			model_name?: string
		}>
		return {
			models: (Array.isArray(data) ? data : [])
				.map((m) => m.title ?? m.model_name)
				.filter((m): m is string => !!m)
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
	try {
		const res = await fetch(`${base(connection)}/sdapi/v1/sd-models`, {
			headers: authHeaders(connection)
		})
		if (!res.ok) {
			// A 404 here is the informative case: the server is up but has no
			// image support — a KoboldCPP started without --sdmodel, most likely.
			if (res.status === 404)
				return {
					ok: false,
					error:
						"Reachable, but it has no image API. If this is KoboldCPP, it needs an image model loaded before it can draw."
				}
			return { ok: false, error: `HTTP ${res.status}` }
		}

		// The sampler and scheduler names, so the sampling form can offer real
		// ones instead of asking a person to guess a string. Best-effort: a
		// backend without these endpoints is still a working connection.
		const extra: Record<string, unknown> = {}
		for (const [key, path] of [
			["samplers", "samplers"],
			["schedulers", "schedulers"]
		] as const) {
			try {
				const r = await fetch(`${base(connection)}/sdapi/v1/${path}`, {
					headers: authHeaders(connection)
				})
				if (!r.ok) continue
				const list = await r.json()
				if (Array.isArray(list))
					extra[key] = list
						.map((x: any) => x?.name)
						.filter((n: unknown): n is string => typeof n === "string")
			} catch {
				// Not every build has them.
			}
		}

		// What this connection can do, as the PROBE layer of capability
		// resolution. Reaching sd-models at all proves image generation works.
		extra.capabilities = { "text->image": "native" }

		return { ok: true, ...(Object.keys(extra).length ? { extra } : {}) }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

const exports: ImageAdapterExports = {
	Adapter: A1111Adapter,
	listModels,
	testConnection,
	capabilities: CAPABILITIES,
	profileSchema: PROFILE_SCHEMA,
	profileDefaults: PROFILE_DEFAULTS
}

export default exports
