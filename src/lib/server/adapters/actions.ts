/**
 * The ACTION SURFACE — the one place an adapter action's signature is written.
 *
 * Both adapter families take their members from here. No adapter declares a
 * request or a result type of its own, and no adapter narrows or widens one
 * locally, because the signature belongs to the ACTION rather than to the class
 * that happens to implement it: `generateImage` takes the same request and
 * returns the same result on every backend that has it.
 *
 * That fixity is not a style preference. `$lib/shared/connectionAdapters/actions`
 * derives what a connection type can express from WHICH of these methods exist
 * on its adapter classes, and that inference is only sound while a method's name
 * pins its in and out kinds. A subclass free to decide what `generateText`
 * returned would make "implements generateText" say nothing at all.
 *
 * ## Why the two families still have different constructors
 *
 * `BaseConnectionAdapter` takes ten generation-scoped parameters and holds
 * per-generation state; `BaseImageAdapter` takes a connection and nothing else.
 * The ruling that made the actions shared did not require the CLASSES to merge,
 * and merging them would put nine ignored parameters plus `compilePrompt`,
 * `tokenLimit` and `responseFormat` on an adapter with no prompt and no token
 * budget. A shared ACTION interface delivers the whole of what the derivation
 * needs — one declaration site, compile-checked implementations, no local
 * widening — so the families stay parallel and only the actions are shared.
 *
 * The honest consequence, stated rather than hidden: `generateImage(req, opts)`
 * satisfies "expected in, expected out" literally, while `generateText()`
 * satisfies it only FORMALLY. Its signature is fixed at the type level, so the
 * derivation is sound, but its input is still smuggled in through construction.
 * Giving `generateText` a real request parameter is the right follow-up and is
 * deliberately not this change: it would rewrite the whole text generation path
 * to serve a rename.
 */

import type { CompiledPrompt as PromptBuilderCompiledPrompt } from "$lib/server/connectionAdapters/types"
import type { MediaRef } from "@serene-pub/sdk"
import type {
	GeneratedMediaItem,
	ImageGenOptions,
	ImageGenRequest,
	ImageGenResult
} from "$lib/shared/imageGen/types"
import {
	ACTION_NAMES,
	type ActionName
} from "$lib/shared/connectionAdapters/actions"

export type {
	GeneratedMediaItem,
	ImageGenOptions,
	ImageGenRequest,
	ImageGenResult
}

// ── Options ─────────────────────────────────────────────────────────────────

/**
 * What every non-image action accepts alongside its request.
 *
 * Images take `ImageGenOptions` instead, which adds `onProgress` — a render is
 * the one action long enough that "still loading the model" is worth saying.
 */
export interface ActionOptions {
	signal?: AbortSignal
}

// ── generateText ────────────────────────────────────────────────────────────

/**
 * What a text generation returns.
 *
 * Verbatim what `abstract generate()` returned before the rename, so that the
 * rename stays mechanical and no call site has to change shape at the same time
 * it changes name. Two things at once is how a rename acquires a bug.
 *
 * `completionResult` is a string OR a function because streaming and
 * non-streaming adapters genuinely differ in when the text exists: a streaming
 * adapter hands back something the caller drives, and the callbacks are how
 * partial content and native reasoning arrive separately.
 */
export interface TextGenResult {
	completionResult:
		| string
		| ((
				contentCb: (chunk: string) => void,
				thinkingCb?: (chunk: string) => void
		  ) => Promise<void>)
	compiledPrompt: PromptBuilderCompiledPrompt
	isAborted: boolean
	/**
	 * Native thinking/reasoning content returned by the model, if any. Only
	 * populated for non-streaming responses — streaming adapters deliver thinking
	 * through `thinkingCb`.
	 */
	thinkingContent?: string
}

// ── editImage ───────────────────────────────────────────────────────────────

/**
 * img2img and inpainting: a picture in, a picture out.
 *
 * A DIFFERENT method from `generateImage` because it is a different wire route
 * (`/sdapi/v1/img2img`, not `/sdapi/v1/txt2img`), which is the rule the whole
 * action/extension split turns on — see `HOSTED_BY` in the shared table.
 *
 * `prompt` is optional here and required on `ImageGenRequest`, and its absence
 * is exactly what separates `image->image` (upscale, restyle) from
 * `text+image->image` (edit this picture, thus). Same route either way, so one
 * method: `image->image` is DECLARED against this action, not derived from a
 * second one.
 *
 * ⚠ `init` carries `MediaRef`s and never bytes, matching the SDK's media rule:
 * a uuid names one fixed set of bytes and is what lets a receipt record exactly
 * what a run saw. Bytes on the wire would put megabytes in every receipt, defeat
 * dedupe, and hand a plugin a copy the host cannot account for. This is why
 * `init` moved OFF `ImageGenRequest` rather than being widened in place: the old
 * `{ bytes, mime, mask }` shape belonged to neither the media rule nor to
 * txt2img, and it was declared unsupported by the only adapter that ever saw it.
 *
 * There is deliberately no `strength` field. The knob already exists as
 * `denoise` — the name the image sampling config, `buildImageRequest` and two
 * integration tests all spell it — and inheriting it from `ImageGenRequest` is
 * what keeps one number under one name.
 */
export type ImageEditRequest = Omit<ImageGenRequest, "prompt"> & {
	/** Absent means `image->image`: transform this, with nothing said about how. */
	prompt?: string
	/** What to work from. A list because inpainting backends take reference sets. */
	init: MediaRef[]
	/** Where to paint, for inpainting. Absent edits the whole frame. */
	mask?: MediaRef
}

// ── embedText ───────────────────────────────────────────────────────────────

/**
 * Array in, array out — because every backend batches and the app already does.
 *
 * `src/lib/server/embedding/` hand-rolls an OpenAI-compatible `/embeddings`
 * client with its own `batchEmbed()`, which three of these adapters could serve
 * instead. That is the named first follow-up, and this shape is written against
 * it rather than against a one-string-at-a-time call it would have to grow out
 * of immediately.
 */
export interface EmbedRequest {
	input: string[]
	/** Overrides the connection's own model, for a backend that hosts several. */
	model?: string
}

export interface EmbedResult {
	/** One vector per input, in input order. */
	vectors: number[][]
	/** What actually produced them — a stored vector is worthless without it. */
	model: string
	/** Vector width. Read back rather than assumed: a mismatch corrupts an index. */
	dimensions: number
	/** Whatever the backend returned, for the receipt. Never interpreted. */
	raw?: unknown
}

// ── transcribeAudio ─────────────────────────────────────────────────────────

export interface TranscribeRequest {
	audio: MediaRef
	/** BCP-47, when the caller knows. Absent lets the backend detect. */
	language?: string
	/** Vocabulary hint some backends accept to bias the decode. */
	prompt?: string
}

export interface TranscribeResult {
	text: string
	isAborted: boolean
	raw?: unknown
}

// ── synthesizeSpeech ────────────────────────────────────────────────────────

export interface SpeechRequest {
	text: string
	/** A backend's own voice id. Opaque here; the connection form offers the list. */
	voice?: string
	/** Container/codec, when the backend offers a choice ("mp3", "wav", …). */
	format?: string
	/** Rate multiplier, 1 being the backend's own. */
	speed?: number
}

/**
 * The same `applied`/`ignored` discipline images use, for the same reason: a TTS
 * backend drops a knob exactly the way an image backend does, and "why did
 * changing speed do nothing" has to be answerable.
 */
export interface SpeechResult {
	media: GeneratedMediaItem[]
	isAborted: boolean
	/** Request keys this backend translated and sent. */
	applied: string[]
	/** Keys it could not honour, or honoured at a value it had to change. */
	ignored: string[]
	raw?: unknown
}

// ── The surface ─────────────────────────────────────────────────────────────

/**
 * Every action, at its fixed signature. Base classes take their members from
 * here; nothing declares one of these shapes a second time.
 *
 * Every member is OPTIONAL, and that is the derivation: an adapter that does not
 * implement `synthesizeSpeech` is STATING that its API cannot speak, and the
 * capability panel, the picker and the bind guard all read that statement.
 *
 * ⚠ **Never add a body to any of these on a base class — not even a throwing
 * `NotImplemented` stub.** A stub puts the method on every prototype, makes
 * `"generateImage" in adapter` useless, and forces every reader to compare
 * `Ctor.prototype.x !== Base.prototype.x` — a check TypeScript cannot see and
 * the conformance test would pass while lying. With no base bodies the
 * inherited-versus-overridden question does not arise.
 *
 * ⚠ **`useDefineForClassFields` is UNSET with `target: "esnext"` in
 * `.svelte-kit/tsconfig.json`, so it DEFAULTS TO TRUE.** Declaring any of these
 * on a base class as a plain optional property emits a class field initialized
 * to `undefined` — an OWN property that SHADOWS every subclass's prototype
 * method. Every action would then read as unimplemented at runtime while
 * type-checking perfectly clean, and the conformance test would go green on a
 * lie. Base classes declare these with `declare` (which emits nothing) or as
 * `abstract`. Never as an initialized field.
 */
export interface AdapterActions {
	/** Write a reply. Its input is still supplied through construction — see the header. */
	generateText?(): Promise<TextGenResult>
	/** Draw from a description. */
	generateImage?(
		req: ImageGenRequest,
		opts?: ImageGenOptions
	): Promise<ImageGenResult>
	/** Change a picture that was handed in. A different route, hence a different method. */
	editImage?(
		req: ImageEditRequest,
		opts?: ImageGenOptions
	): Promise<ImageGenResult>
	/** Turn text into vectors. */
	embedText?(req: EmbedRequest, opts?: ActionOptions): Promise<EmbedResult>
	/** Speech in, text out. */
	transcribeAudio?(
		req: TranscribeRequest,
		opts?: ActionOptions
	): Promise<TranscribeResult>
	/** Text in, speech out. */
	synthesizeSpeech?(
		req: SpeechRequest,
		opts?: ActionOptions
	): Promise<SpeechResult>
}

// ── The runtime read ────────────────────────────────────────────────────────

/**
 * Which actions a class implements, read off its own prototype chain.
 *
 * Used by the conformance test and by nothing that ships. Every runtime path
 * reads the static manifest instead — the picker resolves capabilities for every
 * connection row against every slot, and reaching into an adapter module there
 * would statically import `@lmstudio/sdk`, which cannot be parsed at all under
 * nodejs-mobile's V8 on Android.
 *
 * The walk stops BEFORE `stopAt.prototype`, so an override and an inherited real
 * implementation both count — `KoboldCppManagedAdapter extends KoboldCppAdapter`
 * and genuinely can generate text — while an `abstract` or `declare` member on
 * the base never does. Both of those emit nothing, so the stop is a belt to the
 * "no base bodies" rule's braces: if a body ever appears on a base class, this
 * reports the action as ABSENT rather than as present-on-everything. That is the
 * conservative direction, and it fails loudly at the conformance test rather
 * than quietly at a bind.
 */
export function actionsOf(
	Ctor: Function | undefined,
	stopAt: Function
): Set<ActionName> {
	const found = new Set<ActionName>()
	const stop = stopAt?.prototype
	let proto: unknown = Ctor?.prototype
	while (proto && proto !== stop && proto !== Object.prototype) {
		for (const name of ACTION_NAMES)
			// `hasOwnProperty` and not `in`: `in` walks the chain itself and would
			// count a member from past the stop, which is the whole thing this
			// exists to exclude.
			if (Object.prototype.hasOwnProperty.call(proto, name)) found.add(name)
		proto = Object.getPrototypeOf(proto)
	}
	return found
}
