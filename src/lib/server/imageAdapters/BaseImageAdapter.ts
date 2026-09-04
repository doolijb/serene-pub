/**
 * The image-adapter family (PLAN: local image generation).
 *
 * Image generation is a DIFFERENT modality from text — no prompt assembly, no
 * token budget, no streaming text — so it is a parallel family, NOT a subclass of
 * `BaseConnectionAdapter`. It borrows the same *structural* patterns the text
 * adapters use (a lazy `get*Adapter` factory, a `*AdapterExports` default export)
 * and rides the same `connections` table: an image connection is a row with
 * `modality: "image-gen"`.
 *
 * ## The two scopes, and why they are separate
 *
 * A backend's settings split cleanly in two, and keeping them apart is what lets
 * one node serve every backend:
 *
 *   - **The request** (`ImageGenRequest`) is what a *person* means: a prompt, a
 *     size, how many steps. It is the same everywhere, comes from the sampling
 *     config, and the adapter translates it. This is the only thing the pipeline
 *     knows about.
 *   - **The profile** (`profileSchema`, stored on `connections.extraJson.profile`)
 *     is what a *backend* offers and nothing else does: an A1111
 *     `override_settings` block, a ComfyUI workflow, a vendor's own preset list. It
 *     is declared as a schema so core renders a form for it without knowing what
 *     any of it means.
 *
 * The rule that keeps them honest: nothing backend-specific may appear in the
 * request, and nothing a person would recognise as a generation parameter may be
 * hidden in the profile. A knob in the wrong scope is either a control that does
 * nothing on three backends out of four, or a setting nobody can reach from the
 * node that needs it.
 *
 * ## The families stay parallel; the ACTIONS are shared
 *
 * Everything above still holds — this is not a subclass of
 * `BaseConnectionAdapter` and should not become one. What changed is that the
 * two families no longer each define a method called `generate` with a different
 * contract behind it. The signatures now come from ONE place,
 * `$lib/server/adapters/actions`, because what a connection type can express is
 * DERIVED from which of those named actions its modules implement — and that
 * inference is sound only while a method's name pins its in and out kinds. So
 * `generateImage` here and `generateText` there mean the same things they mean
 * everywhere, and the two classes can implement different actions without
 * colliding, which is precisely why they never had to be merged.
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { SettingsSchema } from "@serene-pub/sdk"
import type { AdapterActions } from "$lib/server/adapters/actions"
import type {
	ImageCapabilities,
	ImageGenOptions,
	ImageGenRequest,
	ImageGenResult
} from "$lib/shared/imageGen/types"

export { CONNECTION_TYPE }
export type {
	ImageCapabilities,
	ImageGenOptions,
	ImageGenProgress,
	ImageGenRequest,
	ImageGenResult,
	ImageGenStage,
	GeneratedMediaItem
} from "$lib/shared/imageGen/types"

/** What a concrete image-adapter module default-exports (mirrors AdapterExports). */
/**
 * The actions this family does not require, merged on as an INTERFACE.
 *
 * Same reason as `BaseConnectionAdapter`: `declare x?: …` on the class body
 * declares a PROPERTY, and a subclass implementing it as a method is TS2425 —
 * a surface that compiles but cannot be fulfilled.
 *
 * The TEXT actions are included deliberately, and their absence is just as
 * meaningful as their presence: an image module implementing `generateText`
 * would be how a connection type derived `text->text` from the wrong family, so
 * the possibility is typed rather than left to a convention. `generateImage` is
 * omitted because the class declares it `abstract`.
 */
export interface BaseImageAdapter
	extends Partial<Omit<AdapterActions, "generateImage">> {}

export interface ImageAdapterExports {
	Adapter: new (connection: SelectConnection) => BaseImageAdapter
	listModels: (
		connection: SelectConnection
	) => Promise<{ models: string[]; error?: string }>
	testConnection: (connection: SelectConnection) => Promise<{
		ok: boolean
		error?: string
		/** Anything else the test learned that a form can use — a sampler list, say. */
		extra?: Record<string, unknown>
	}>
	/**
	 * The `generateImage` ACTION PROFILE — how one render behaves here, so a form
	 * can stop offering a control that would quietly do nothing.
	 *
	 * ⚠ NOT a `CapabilitySet`, and the two must never be merged. `progress`,
	 * `preview`, `cancel`, `freeSize`, `sizePresets` and `samplers` describe the
	 * ergonomics of a single call; a capability set describes what kind of data
	 * turns into what other kind. Folding these in would put "Can be cancelled"
	 * beside "Chat" on the connection screen, and would give the four-layer
	 * resolution a set of keys no preset, probe or person has any opinion about.
	 *
	 * The one field that DID belong on the other side has moved: `img2img` is now
	 * the presence of an `editImage` method, from which the `text+image->image`
	 * capability key is derived. It had been a boolean saying the same thing as a
	 * manifest entry, and the two disagreed — `A1111Adapter` reported
	 * `img2img: false` while the manifest declared the transform `native` for the
	 * same type.
	 */
	capabilities: ImageCapabilities
	/**
	 * The backend-specific settings this adapter understands, in the SDK's field
	 * language — so the connection form is generated rather than written, and a
	 * new backend needs no new Svelte component.
	 */
	profileSchema?: SettingsSchema
	profileDefaults?: Record<string, unknown>
}

export abstract class BaseImageAdapter implements AdapterActions {
	connection: SelectConnection
	/** Aborts the in-flight request; `generateImage` wires this to fetch. */
	protected controller: AbortController | null = null

	constructor(connection: SelectConnection) {
		this.connection = connection
	}

	// ── Actions ─────────────────────────────────────────────────────────────
	//
	// Named and individually typed, from the shared `AdapterActions`. The
	// identifier `generate` names nothing in either adapter family any more: one
	// generically-named method meant `KoboldCppAdapter.generate` and
	// `A1111Adapter.generate` returned different kinds under one name, which is
	// exactly the thing that made "what does this API accept and return"
	// underivable from the code.

	/**
	 * Render `req`. `text->image`, and the one action an image adapter must have.
	 *
	 * Implementations must report `applied` and `ignored` honestly, including for
	 * a value they had to *change* rather than drop — a size snapped to the
	 * nearest supported one is not the size that was asked for, and silently
	 * returning a differently-shaped image is the version of this that wastes an
	 * afternoon.
	 */
	abstract generateImage(
		req: ImageGenRequest,
		opts?: ImageGenOptions
	): Promise<ImageGenResult>

	/**
	 * The actions an image adapter MAY grow, declared and never defined.
	 *
	 * `editImage` is the one that matters here: img2img is a DIFFERENT ROUTE
	 * (`/sdapi/v1/img2img`), which is the rule separating an action from a
	 * declared extension, so it is a method rather than a flag. Nothing
	 * implements it today and the manifest therefore declares neither
	 * `text+image->image` nor `image->image` for any type — the derivation and
	 * the declaration agree by construction rather than by anyone remembering.
	 *
	 * ⚠ `declare` emits nothing, which is required here:
	 * `useDefineForClassFields` defaults to TRUE under `target:"esnext"`, so a
	 * plain optional property would emit an OWN field of `undefined` shadowing
	 * every subclass's prototype method. And never give one a body — see the
	 * matching note on `BaseConnectionAdapter`.
	 *
	 * The text actions are declared too, and their absence is just as meaningful:
	 * an image module implementing `generateText` would be how a type derived
	 * `text->text` from the wrong family, so the possibility is typed rather than
	 * left to a convention.
	 */
	// Merged in as an INTERFACE below the class rather than declared here as
	// properties — see the note on that declaration.

	// ── Lifecycle (not actions) ─────────────────────────────────────────────

	abort() {
		this.controller?.abort()
	}

	/**
	 * Optional hook run before `generateImage()` (a managed backend ensures its
	 * server is up and the image model is loaded here — mirrors the text
	 * adapters' preflight).
	 */
	async preflight(_signal?: AbortSignal): Promise<void> {}

	/** Trim a trailing slash so `${base}/v1/...` never doubles up. */
	protected baseUrl(fallback: string): string {
		const raw = (this.connection.baseUrl || fallback).trim()
		return raw.replace(/\/+$/, "")
	}

	/**
	 * This connection's backend-specific settings, with the adapter's own
	 * defaults underneath.
	 *
	 * Typed by the caller because only the adapter knows its own profile shape —
	 * core stores and renders it without ever needing to.
	 */
	protected profile<T extends Record<string, unknown>>(defaults: T): T {
		const stored = (this.connection.extraJson as any)?.profile
		return stored && typeof stored === "object"
			? { ...defaults, ...stored }
			: defaults
	}

	/**
	 * Link an external signal to this adapter's own controller, so one abort
	 * stops both the fetch and any polling loop around it.
	 */
	protected linkAbort(signal?: AbortSignal): AbortSignal {
		this.controller = new AbortController()
		if (signal) {
			if (signal.aborted) this.controller.abort()
			else
				signal.addEventListener(
					"abort",
					() => this.controller?.abort(),
					{
						once: true
					}
				)
		}
		return this.controller.signal
	}
}

/**
 * Bookkeeping for what a translation could and could not carry across.
 *
 * A tiny helper rather than a convention, because "report what you ignored" is
 * only useful if every adapter does it, and the ones that do not are invisible.
 */
export class Translation {
	readonly applied: string[] = []
	readonly ignored: string[] = []

	/** Record that `key` was translated and will be sent. */
	apply<T>(key: string, value: T): T {
		this.applied.push(key)
		return value
	}

	/** Record that `key` was set but will not reach the backend as asked. */
	ignore(key: string): void {
		if (!this.ignored.includes(key)) this.ignored.push(key)
	}

	/**
	 * Take `value` if the request set it, recording the outcome either way.
	 * Returns undefined when unset, which callers spread away.
	 */
	take<T>(
		key: string,
		value: T | undefined,
		supported = true
	): T | undefined {
		if (value === undefined || value === null) return undefined
		if (!supported) {
			this.ignore(key)
			return undefined
		}
		this.applied.push(key)
		return value
	}
}
