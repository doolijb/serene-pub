/**
 * Image-generation socket types (PLAN: local image gen). Kept in `shared` so
 * BOTH the server handler (`sockets/images.ts`) and the client typed-socket map
 * reference one definition — and deliberately NOT in the big `sockets/types.ts`
 * `Sockets` namespace, which is mid-refactor; `Handler`/`SocketEventMap` accept
 * any types, so this stands on its own.
 */

import type { DrawingSheet, ImageGenRequest } from "$lib/shared/imageGen/types"

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
	/**
	 * 🚧 The workflow a template-payload connection (ComfyUI) draws with —
	 * required for one, ignored by a flat one (DESIGN-image-generation §4.8
	 * step 5, *Draw a test*). With no `samplingConfigId`, the workflow's own
	 * *Default* config supplies the dials.
	 */
	workflowId?: number
}

/**
 * A stored generated image.
 *
 * **No `path`.** It carried one until 0182 — the handler spread the on-disk
 * location of a freshly written file straight into a socket response, which
 * disclosed the data-dir layout and the owner's user id to every browser that
 * could read it. The existing path-leak tests only ever inspected
 * `toClientMedia`, so nothing caught it; `sockets/images.pathLeak.int.test.ts`
 * asserts the property over this shape now.
 *
 * `url` is the ready-made address, so a consumer never reconstructs one. It
 * **already carries a query string** (`?r={rev}`) — anything appending a
 * parameter joins with `&`.
 */
export interface GeneratedMedia {
	id: number
	uuid: string
	/** `/media/{uuid}?r={rev}` — the display form, not necessarily the bytes the
	 *  backend returned. */
	url: string
	/** Cache token off the file row. Present so a caller that builds its own
	 *  variant URL gets an address that changes when the bytes do. */
	rev: number
	/** The DISPLAY variant's mime — a hint, not a promise about what a given
	 *  request is answered with (Accept and `?v=` both move it). */
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
 * the connection does — someone picking a backend from the new-connection list
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

/**
 * The drawing sheet of an image PAIR — what the sampling form greys by.
 *
 * Both halves absent asks for the instance's Image default, which is the pair
 * a sampling config is most likely to run against. Admin only: the answer is a
 * fact about a connection.
 */
export interface ImageDrawingSheetParams {
	connectionId?: number | null
	connectionModelId?: number | null
	/**
	 * 🚧 For a template-payload connection: the workflow whose sheet to derive
	 * (`deriveComfySheet`). The sheet is then the workflow's, on this server.
	 */
	workflowId?: number | null
	/**
	 * 🚧 Ask about the pair this card's sprites are drawn with (the Sprites
	 * loadout's): the card's owner or an admin. A member hears only
	 * `expressions`; the sheet itself is an admin's.
	 */
	characterId?: number | null
}

export interface ImageDrawingSheetResponse {
	/** Null when no image pair is set; the form then greys nothing. */
	sheet?: DrawingSheet | null
	/** The image sampling keys this sheet drops (`samplingKeysSheetDrops`). */
	drops?: string[]
	/** 🚧 Echoed when the sheet was asked of a workflow, so a reply finds its asker. */
	workflowId?: number
	/** 🚧 Echoed when the sheet was asked for a card's sprites. */
	characterId?: number
	/**
	 * 🚧 The sheet's `expressions` flag — whether **Re-express from
	 * neutral** can run on this pair. Answered to a member too.
	 */
	expressions?: boolean
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
