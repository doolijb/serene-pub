/**
 * The image-adapter family (PLAN: local image generation).
 *
 * Image generation is a DIFFERENT modality from text — no prompt/token/streaming
 * machinery — so it is a parallel family, NOT a subclass of
 * `BaseConnectionAdapter`. It borrows the same *structural* patterns the text
 * adapters use (a lazy `get*Adapter` factory, a `*AdapterExports` default export
 * with `Adapter`/`listModels`/`testConnection`/defaults), and rides the same
 * `connections` table — an image connection is just a row with
 * `modality: "image-gen"`.
 *
 * `generate(params)` is the whole contract: hand it a prompt + generic
 * parameters, get back rendered images. Each concrete adapter maps the generic
 * params onto its backend's own vocabulary (the Fooocus adapter, for instance,
 * translates size to an aspect-ratio string and reads its performance mode /
 * styles from `params.extra`).
 */
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export { CONNECTION_TYPE }

/** Generic, backend-neutral generation request. */
export interface ImageGenParams {
	prompt: string
	negativePrompt?: string
	/** Classifier-free guidance (Fooocus/A1111: cfg / guidance_scale). */
	cfg?: number
	width?: number
	height?: number
	/** -1 (or omitted) = random. */
	seed?: number
	/** How many images to render. */
	batch?: number
	/** Checkpoint override; falls back to the connection's `model`. */
	model?: string
	/**
	 * Backend-specific passthrough — the knobs that have no neutral analog. The
	 * Fooocus adapter reads `performance`, `styles`, `sharpness`, `aspectRatio`
	 * here; an A1111 adapter would read `sampler`, `steps`, etc.
	 */
	extra?: Record<string, unknown>
}

/** One rendered image. `base64` is raw (no `data:` prefix). */
export interface GeneratedImage {
	base64: string
	mime: string
	width?: number
	height?: number
	seed?: number | string
	meta?: Record<string, unknown>
}

export interface ImageGenResult {
	images: GeneratedImage[]
	isAborted: boolean
}

/** What a concrete image-adapter module default-exports (mirrors AdapterExports). */
export interface ImageAdapterExports {
	Adapter: new (connection: SelectConnection) => BaseImageAdapter
	listModels: (
		connection: SelectConnection
	) => Promise<{ models: string[]; error?: string }>
	testConnection: (
		connection: SelectConnection
	) => Promise<{ ok: boolean; error?: string }>
	/** Default generation params surfaced in the UI / used when unset. */
	generationDefaults: Record<string, unknown>
}

export abstract class BaseImageAdapter {
	connection: SelectConnection
	/** Aborts the in-flight request; `generate` wires this to fetch. */
	protected controller: AbortController | null = null

	constructor(connection: SelectConnection) {
		this.connection = connection
	}

	/** Render `params`. `signal` (if given) is linked to the internal controller. */
	abstract generate(
		params: ImageGenParams,
		signal?: AbortSignal
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
}
