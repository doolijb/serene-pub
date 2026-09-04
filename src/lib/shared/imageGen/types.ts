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
	/**
	 * How much of an input image to overwrite. Only meaningful on an EDIT, which
	 * is why it reads as unsupported on every txt2img backend — and it stays
	 * declared here rather than on `ImageEditRequest` because it arrives from the
	 * image sampling config, which `buildImageRequest` turns into one of these
	 * whichever action ends up running. `ImageEditRequest` inherits it, so the
	 * knob has one name in one place.
	 */
	denoise?: number
	/** Checkpoint override; falls back to the connection's own `model`. */
	model?: string
	// img2img / inpainting inputs USED to live here as `init: { bytes, mime, mask }`,
	// declared unsupported by the only adapter that ever received one. They now
	// belong to `ImageEditRequest` in `$lib/server/adapters/actions`, as MediaRefs
	// rather than bytes:
	//   - `generateImage` and `editImage` are different wire routes (txt2img vs
	//     img2img), so they are different actions with different requests, and a
	//     field only one of them can honour does not belong to both.
	//   - a request that CANNOT carry an init is what makes "this backend is
	//     txt2img-only" checkable rather than reported at the HTTP call.
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
 * stores it, the same message part shows it. `audio` is here for that same
 * reason and no other — `synthesizeSpeech` returns these, and `durationMs` was
 * already the field it needs. Nothing produces one yet.
 *
 * Deliberately not the SDK's full `MediaKind`: `document` is a thing a person
 * attaches, never a thing a backend renders.
 */
export interface GeneratedMediaItem {
	kind: "image" | "audio" | "video"
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
 * The `generateImage` ACTION PROFILE — the ergonomics of one render.
 *
 * ## Not a `CapabilitySet`, and the two must never be merged
 *
 * A `CapabilitySet` answers "what kind of data does this turn into what other
 * kind" — the transform question, gated by the manifest and resolved through
 * four layers onto the connection row. Every field below answers something else
 * entirely: whether a render reports progress, whether it can be stopped,
 * whether the sizes are a free pair or a fixed list. Those are properties of HOW
 * one call behaves, not of what it accepts and returns, and folding them into
 * the capability set would put "Can be cancelled" in the same column as "Chat"
 * on the connection screen.
 *
 * Reported rather than assumed so a form can grey out a control instead of
 * offering one that quietly does nothing.
 *
 * ## What is no longer here
 *
 * `img2img` was a boolean beside a transform that said the same thing, and the
 * two disagreed: `A1111Adapter` reported `img2img: false` while the manifest
 * declared `text+image->image: "native"` for the very same type, and nothing
 * noticed for a release. The fact now has one spelling — the presence of an
 * `editImage` method — from which the capability key is derived. Do not
 * reintroduce it.
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
	/**
	 * Renders frames rather than a still.
	 *
	 * Stays in the profile rather than becoming a `text->video` transform because
	 * the SDK's `TRANSFORMS` does not name that id: it has no label, no tagline
	 * and nothing renders it. Adding the id is small; deciding whether the action
	 * would then be `generateMedia` is not, and neither should be settled while
	 * nothing produces video.
	 */
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
