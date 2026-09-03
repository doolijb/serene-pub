/**
 * The vocabulary every image backend is spoken to in.
 *
 * Four backends are in view — an A1111-compatible server (KoboldCPP, Forge,
 * SD.Next), ComfyUI, and a hosted API — and no two agree on anything. A1111
 * takes flat width/height, though some servers behind that same API offer only a
 * fixed size list; ComfyUI takes a whole graph; OpenAI takes a size string and
 * ignores seed, steps and CFG entirely. The only way that does not turn into
 * a branch per backend in the node, the pipeline and the picker is for the
 * request to name what a person means, and for each adapter to be the single
 * place that knows how its own backend spells it.
 *
 * So: an adapter TRANSLATES, and it REPORTS. Everything it could not honour comes
 * back in `ignored` rather than being silently dropped — because "why did
 * changing steps do nothing" has to be answerable, and the honest answer is
 * usually "this backend has no such knob".
 */

/**
 * One render, in backend-neutral terms.
 *
 * Every field is optional except the prompt: unset means "whatever this backend
 * already does", which is the only answer that stays true across all of them.
 */
export interface ImageGenRequest {
	prompt: string
	negativePrompt?: string
	/** Requested pixels. A backend with fixed sizes snaps and reports the snap. */
	width?: number
	height?: number
	/** Denoising steps. */
	steps?: number
	/** Classifier-free guidance (A1111 calls it `cfg_scale`). */
	cfg?: number
	/** -1, or omitted, draws a fresh one. */
	seed?: number
	sampler?: string
	scheduler?: string
	/** How many images this run should produce. */
	batch?: number
	clipSkip?: number
	/** How much of `init` to overwrite. Only meaningful with one. */
	denoise?: number
	/** Checkpoint override; falls back to the connection's own `model`. */
	model?: string
	/**
	 * img2img / inpainting. Declared now and honoured by adapters that report
	 * `img2img`, so the port and the plumbing do not have to be retrofitted
	 * around an existing contract later.
	 */
	init?: {
		bytes: Uint8Array
		mime: string
		mask?: Uint8Array
	}
	/**
	 * Animation. Present for the same reason as `init`: KoboldCPP already renders
	 * frames, and a `video` that arrives later would mean revisiting every
	 * signature between here and the media table.
	 */
	video?: { frames?: number; fps?: number }
}

/**
 * Where a render has got to.
 *
 * Named stages rather than a bare percentage because "12%" answers a different
 * question from "still loading the model" — the second is what tells someone
 * whether waiting another minute is reasonable.
 */
export type ImageGenStage =
	| "queued"
	| "loading"
	| "conditioning"
	| "sampling"
	| "decoding"
	| "saving"

export interface ImageGenProgress {
	stage: ImageGenStage
	/** 0–100. Backends that report only a step count get one computed from it. */
	percent: number
	step?: number
	steps?: number
	etaSec?: number
	/** A partially-denoised frame, when the backend offers one. Transient: shown, never stored. */
	preview?: { base64: string; mime: string }
	message?: string
}

/**
 * One rendered thing. `base64` is raw — no `data:` prefix.
 *
 * `kind` rather than an image-only type because a video is the same journey
 * through the same pipeline: the same adapter renders it, the same media row
 * stores it, the same message part shows it.
 */
export interface GeneratedMediaItem {
	kind: "image" | "video"
	mime: string
	base64: string
	width?: number
	height?: number
	/** What the backend actually used — often not what was asked for. */
	seed?: number | string
	frames?: number
	fps?: number
	durationMs?: number
	/** Backend-specific provenance, stored on the media row rather than interpreted. */
	meta?: Record<string, unknown>
}

export interface ImageGenResult {
	media: GeneratedMediaItem[]
	isAborted: boolean
	/** Request keys this backend translated and sent. */
	applied: string[]
	/**
	 * Request keys it could not: no equivalent knob, or a value it had to change
	 * (a size snapped to the nearest supported one). The difference between "you
	 * set it and it did nothing" and "you did not set it" is only visible if the
	 * adapter says so.
	 */
	ignored: string[]
	/** Whatever the backend returned, for the receipt. Never interpreted. */
	raw?: unknown
}

/**
 * What a backend can actually do.
 *
 * Reported rather than assumed so a picker can grey out a control instead of
 * offering one that quietly does nothing, and so the node can refuse an img2img
 * wire at bind time rather than at the HTTP call.
 */
export interface ImageCapabilities {
	/** Emits progress events mid-render. */
	progress: boolean
	/** Progress carries partially-denoised frames. */
	preview: boolean
	/** A render in flight can be stopped. */
	cancel: boolean
	/** More than one image per request. */
	batch: boolean
	img2img: boolean
	video: boolean
	/** Arbitrary width/height, as opposed to a fixed list. */
	freeSize: boolean
	/** When `freeSize` is false, the sizes that ARE available. */
	sizePresets?: Array<{ width: number; height: number }>
	/** Known-good names, when the backend can tell us. Empty means "we cannot say". */
	samplers?: string[]
	schedulers?: string[]
}

export interface ImageGenOptions {
	signal?: AbortSignal
	onProgress?: (p: ImageGenProgress) => void
}
