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

import type { ConnectionIdentity } from "$lib/shared/connections/identity"
import type { MediaRef } from "@serene-pub/sdk"

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
	/**
	 * Images the picture should RESEMBLE — a likeness (the oracle's
	 * `references` port). Not `init` and not `mask`: the three are different
	 * wire fields on every backend that has them (KoboldCPP: `extra_images`
	 * vs `init_images` vs `mask`). References, never bytes; the adapter loads
	 * them through `ImageGenOptions.loadMedia`.
	 */
	references?: MediaRef[]
	/**
	 * The starting canvas (img2img). On the request since 2026-10-12
	 * (DESIGN-image-generation §4.2): the drawing sheet's `init` is now the
	 * statement of whether a backend takes one, read before the run, so the
	 * request no longer has to be a different type to make it checkable.
	 */
	init?: MediaRef
	/** Where to paint, for inpainting. Absent edits the whole frame. */
	mask?: MediaRef
	/** A transparent background, drawn by the model itself. */
	transparent?: boolean
	/**
	 * `"W:H"`, derived from width/height by the HOST (`fitRequestToSheet`) for
	 * aspect-only providers. Adapters never compute it a second time.
	 */
	aspect?: string
	outputFormat?: "png" | "webp" | "jpeg"
	/**
	 * Animation. Present for the same reason as `init`: KoboldCPP already renders
	 * frames, and a `video` that arrives later would mean revisiting every
	 * signature between here and the media table.
	 */
	video?: { frames?: number; fps?: number }
	/**
	 * 🚧 A workflow's dial values (§7.1, as reversed 2026-10-12), by variable
	 * name: the workflow's own defaults, with a loadout's overrides merged
	 * over them. The request's own fields (steps, size, …), when set, win
	 * over a same-named value here. Only a template-payload adapter reads
	 * them.
	 */
	workflowValues?: Record<string, unknown>
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
	/**
	 * Which connection this step is about.
	 *
	 * A FIELD, because the sentence beside it must not name one: an image model
	 * is a path on the administrator's disk, and this event fans out to everyone
	 * watching the session. `withoutConnectionIdentity` removes the key at every
	 * egress, so an administrator's client can render "Loading sd-1.5" and
	 * nobody else's is even told there is a connection.
	 */
	connection?: ConnectionIdentity
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
	/**
	 * The series key the BACKEND says this picture belongs to — a keyed
	 * graph's marked output node, by its id prefix (DESIGN-image-generation
	 * §4.11). `null` is an extra the backend drew outside any key (another
	 * SaveImage in the branch); absent means "keyed by the call", which is
	 * what every flat dialect answers.
	 */
	key?: string | null
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
	/**
	 * The service declined to draw this prompt (a moderation block), as
	 * distinct from failing to: `media` is empty and this says why, in the
	 * provider's own words. `noRetry` means asking again with the same prompt
	 * gets the same answer and costs money, so the host stops the series
	 * rather than spending the remaining calls on it.
	 */
	refusal?: {
		message: string
		/** The provider's own code (`moderation_blocked`). */
		code?: string
		/** The provider's own detail, verbatim, for the receipt. */
		details?: unknown
		noRetry: boolean
	}
}

/**
 * The **drawing sheet**: what an image adapter declares it can draw with
 * (DESIGN-image-generation §4.3) — which request knobs it honours, its size
 * rules, how many reference images it takes, whether it draws transparency
 * itself, and how many pictures one call returns. Replaces the ad-hoc
 * `ImageCapabilities` that preceded it.
 *
 * ## Not a `CapabilitySet`, and the two must never be merged
 *
 * A `CapabilitySet` answers "what kind of data turns into what other kind" —
 * the transform question, gated by the manifest and resolved through four
 * layers onto the connection row. Every field here answers something else: how
 * ONE call behaves. Folding them together would put "Can be cancelled" in the
 * same column as "Chat" on the connection screen.
 *
 * ## Who reads it
 *
 *  - the **host** packs a series into calls from `perCall` and `outputs`, fits
 *    the size from `size`, and refuses at bind what a spec marks required and
 *    the sheet cannot do (`references`, `transparent`);
 *  - the **sampling form** greys the knobs a `false` here would drop;
 *  - adapters still report `applied`/`ignored` per call, so the receipt and the
 *    Info pane stay honest even where the sheet is coarser than the backend.
 *
 * Declared per adapter and refined per model where the model name tells
 * (`ImageAdapterExports.sheetFor`) — KoboldCPP takes reference images only
 * with an edit model loaded.
 *
 * `img2img` is not here and must not come back as a flag: whether a backend
 * takes a starting canvas is `init`, and the `text+image->image` transform is
 * a manifest fact with its own spelling.
 */
export interface DrawingSheet {
	/** A negative prompt is sent. */
	negative: boolean
	seed: boolean
	steps: boolean
	cfg: boolean
	sampler: boolean
	clipSkip: boolean
	/**
	 * How a size is asked for:
	 *  - `free` — any width × height on a `step` grid, within `min`..`max`;
	 *  - `enum` — one of a fixed list of `"WxH"` strings;
	 *  - `aspect` — an aspect ratio (`"W:H"`), optionally a resolution tier.
	 * The host fits the request to it (`fitRequestToSheet`); adapters never
	 * compute it twice.
	 */
	size:
		| {
				kind: "free"
				step: 8 | 16 | 64
				/** Per side, in pixels. */
				min: number
				max: number
				/**
				 * Bounds on the AREA (width × height), for a provider that
				 * limits total pixels rather than each side (gpt-image-2:
				 * 655,360–8,294,400). Absent means only the per-side bounds.
				 */
				minPixels?: number
				maxPixels?: number
				/** Longest side over shortest side, at most (gpt-image-2: 3). */
				maxRatio?: number
		  }
		| { kind: "enum"; sizes: string[] }
		| { kind: "aspect"; aspects: string[]; tiers?: string[] }
	/** Reference images (a likeness) it takes. `null` = no reference input at all. */
	references: { max: number } | null
	/** Takes a starting canvas (img2img). */
	init: boolean
	/** Takes an inpainting mask. */
	mask: boolean
	/** `none` ⇒ a cut-out falls to `core:task/cut-out@1`. */
	transparent: "native" | "none"
	/** Pictures one call can return; the host loops above it. */
	perCall: number
	/**
	 * What one call returns per item: `perRun` pictures, and whether the
	 * outputs come back keyed (a Comfy graph's marked output nodes) or only
	 * in order.
	 */
	outputs: { perRun: number; keyed: boolean }
	/** Emits progress events mid-render. */
	progress: boolean
	/** Progress carries partially-denoised frames. */
	preview: boolean
	/** A render in flight can be stopped. */
	cancel: boolean
	/** Renders frames rather than a still. */
	video: boolean
	/**
	 * 🚧 What one call ships: `flat` (absent) — a request of named knobs;
	 * `template` — a provider document with holes the host renders (a ComfyUI
	 * workflow, §4.10). A `template` pair needs the oracle's `workflow` slot,
	 * and the bind guard refuses one without it.
	 */
	payload?: "flat" | "template"
	/**
	 * 🚧 **expressions** — the backend can redraw a finished picture with a
	 * different facial expression, keeping everything else (NovelAI's
	 * `augment-image` `emotion` tool). Absent means no. The adapter's
	 * `expressImage(ref, label)` is the call; nothing reads the flag yet — the
	 * sprite row's second action (DESIGN-image-generation §6.3) will.
	 */
	expressions?: boolean
}

/**
 * The image sampling keys a sheet can say it drops, and the sheet field that
 * decides each. What the sampling form greys; one table so the form and any
 * later reader cannot disagree about which flag governs which knob.
 */
export const SHEET_GATED_SAMPLING_KEYS: Readonly<
	Record<string, (sheet: DrawingSheet) => boolean>
> = {
	seed: (s) => s.seed,
	steps: (s) => s.steps,
	cfg: (s) => s.cfg,
	sampler: (s) => s.sampler,
	scheduler: (s) => s.sampler,
	clipSkip: (s) => s.clipSkip,
	// `denoise` only means something with a starting canvas.
	denoise: (s) => s.init
}

/** The sampling keys this sheet would drop — what a form greys. */
export function samplingKeysSheetDrops(
	sheet: DrawingSheet | null | undefined
): string[] {
	if (!sheet) return []
	return Object.entries(SHEET_GATED_SAMPLING_KEYS)
		.filter(([, honours]) => !honours(sheet))
		.map(([key]) => key)
}

export interface ImageGenOptions {
	signal?: AbortSignal
	onProgress?: (p: ImageGenProgress) => void
	/**
	 * Read the bytes of a referenced file — `references`, `init`, `mask`.
	 *
	 * Handed in by the host rather than imported by the adapter: loading a
	 * file needs the media module, which needs the database, and the image
	 * adapters stay free of that graph (the same line `AttachmentInput` draws
	 * for the text family). Absent means the caller can load nothing, and an
	 * adapter reports every file it was handed as ignored.
	 */
	loadMedia?: (ref: MediaRef) => Promise<{ bytes: Uint8Array; mime: string }>
	/**
	 * 🚧 The provider document a `payload: "template"` adapter draws with — the
	 * oracle's `workflow` slot, resolved by the host to its `workflows` row.
	 * Flat adapters never read it.
	 */
	workflow?: ImageWorkflowDocument
	/**
	 * 🚧 A keyed-graph call (§4.7 rule 1): every series item this ONE call
	 * draws, each with its rendered prompt rows and its `vars`. Present only
	 * when the host packed the series as a keyed graph; the request's own
	 * `prompt` is then the first item's.
	 */
	series?: ImageSeriesCallItem[]
	/** The run this call belongs to, for a document that writes it (`{{runId}}`). */
	runId?: string
}

/** One series item inside a keyed-graph call. */
export interface ImageSeriesCallItem {
	/** Sanitised (§4.11): `[a-z0-9._-]`, never a `:`. */
	key: string
	prompt: string
	negative?: string
	vars?: Record<string, unknown>
}

/**
 * A `workflows` row as an adapter receives it: the document with its holes,
 * the variable declarations, and the output mark.
 */
export interface ImageWorkflowDocument {
	id: number
	name: string
	dialect: string
	/** The graph with its Handlebars holes, as text (not JSON until rendered). */
	document: string
	variables: WorkflowVariable[]
	/** The marked output node's id, or null when none was marked. */
	outputNode: string | null
}

/**
 * One declared workflow variable (DESIGN-image-generation §4.8 step 3, §7.1).
 *
 * `name` is the hole's path as the document writes it (`prompt`,
 * `references.[0].filename`, `lora_strength`). `enumSource` names where a
 * select's options come from: `objectInfo:<class>.<input>` — the connection's
 * cached `/object_info` enum.
 */
export interface WorkflowVariable {
	name: string
	type: "string" | "number" | "integer" | "boolean" | "enum"
	default?: unknown
	min?: number
	max?: number
	step?: number
	enumSource?: string
	/** Display grouping in the variables panel. */
	group?: string
	/** A person-facing label, from a marker node's title when there was one. */
	label?: string
}
