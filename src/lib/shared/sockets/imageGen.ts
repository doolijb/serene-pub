/**
 * Image-generation socket types (PLAN: local image gen). Kept in `shared` so
 * BOTH the server handler (`sockets/images.ts`) and the client typed-socket map
 * reference one definition — and deliberately NOT in the big `sockets/types.ts`
 * `Sockets` namespace, which is mid-refactor; `Handler`/`SocketEventMap` accept
 * any types, so this stands on its own.
 */

import type { ImageGenRequest } from "$lib/shared/imageGen/types"

export interface ImagesGenerateParams {
	connectionId: number
	prompt: string
	negativePrompt?: string
	/**
	 * Which sampling config supplies the parameters. Omitted means the instance's
	 * image default; that having no value either means the backend keeps its own.
	 */
	samplingConfigId?: number
	/** Scope the stored media to a session, when generated in-chat. */
	sessionId?: number
	/**
	 * Per-run values that beat the config. The knobs a person is turning right
	 * now, as opposed to the ones they saved.
	 */
	overrides?: Partial<ImageGenRequest>
	/**
	 * Supplied by the caller so it can cancel a run it has not yet heard back
	 * about — the window between pressing Generate and the first progress event
	 * is exactly when someone realises they made a mistake. Server-generated if
	 * absent.
	 */
	runId?: string
}

/** A stored generated image — `id` resolves to `/media/{id}` for display. */
export interface GeneratedMedia {
	id: number
	uuid: string
	path: string
	mime: string
	kind: string
	width: number | null
	height: number | null
	seed?: number | string
}

export interface ImagesGenerateResponse {
	ok: boolean
	error?: string
	runId?: string
	media?: GeneratedMedia[]
	/** Which request keys the backend honoured, and which it could not. */
	applied?: string[]
	ignored?: string[]
	/** The run was stopped on request rather than failing. */
	cancelled?: boolean
}

/**
 * What a backend-specific connection form needs to render itself.
 *
 * Asked for by connection TYPE rather than by id, because the form exists before
 * the connection does — someone picking "Fooocus" from the new-connection list
 * needs its fields before there is a row to attach them to.
 */
export interface ImageProfileSchemaParams {
	type: string
}

export interface ImageProfileSchemaResponse {
	type: string
	/** The SDK field language; rendered by SchemaForm without core knowing the fields. */
	schema?: Record<string, unknown>
	defaults?: Record<string, unknown>
	capabilities?: Record<string, unknown>
	error?: string
}

export interface ImagesCancelParams {
	runId: string
}

export interface ImagesCancelResponse {
	ok: boolean
	/** False when the run had already finished — not an error, just late. */
	found: boolean
	error?: string
}
