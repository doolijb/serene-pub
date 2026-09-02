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
 *     is what a *backend* offers and nothing else does: Fooocus' performance mode
 *     and style list, a ComfyUI workflow, an A1111 `override_settings` block. It
 *     is declared as a schema so core renders a form for it without knowing what
 *     any of it means.
 *
 * The rule that keeps them honest: nothing backend-specific may appear in the
 * request, and nothing a person would recognise as a generation parameter may be
 * hidden in the profile. A knob in the wrong scope is either a control that does
 * nothing on three backends out of four, or a setting nobody can reach from the
 * node that needs it.
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { SettingsSchema } from "@serene-pub/sdk"
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
export interface ImageAdapterExports {
	Adapter: new (connection: SelectConnection) => BaseImageAdapter
	listModels: (
		connection: SelectConnection
	) => Promise<{ models: string[]; error?: string }>
	testConnection: (connection: SelectConnection) => Promise<{
		ok: boolean
		error?: string
		/** Anything else the test learned that a form can use — Fooocus' style list, say. */
		extra?: Record<string, unknown>
	}>
	/** What this backend can actually do, so a form can stop offering what it cannot. */
	capabilities: ImageCapabilities
	/**
	 * The backend-specific settings this adapter understands, in the SDK's field
	 * language — so the connection form is generated rather than written, and a
	 * new backend needs no new Svelte component.
	 */
	profileSchema?: SettingsSchema
	profileDefaults?: Record<string, unknown>
}

export abstract class BaseImageAdapter {
	connection: SelectConnection
	/** Aborts the in-flight request; `generate` wires this to fetch. */
	protected controller: AbortController | null = null

	constructor(connection: SelectConnection) {
		this.connection = connection
	}

	/**
	 * Render `req`.
	 *
	 * Implementations must report `applied` and `ignored` honestly, including for
	 * a value they had to *change* rather than drop — a size snapped to the
	 * nearest supported one is not the size that was asked for, and silently
	 * returning a differently-shaped image is the version of this that wastes an
	 * afternoon.
	 */
	abstract generate(
		req: ImageGenRequest,
		opts?: ImageGenOptions
	): Promise<ImageGenResult>

	abort() {
		this.controller?.abort()
	}

	/**
	 * Optional pre-generate hook (a managed backend ensures its server is up and
	 * the image model is loaded here — mirrors the text adapters' preflight).
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
