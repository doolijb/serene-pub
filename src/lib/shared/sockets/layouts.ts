/**
 * The `layouts:*` wire shapes (session layout v2 §4.6).
 *
 * ## Why these are standalone exports rather than `namespace Sockets.Layouts`
 *
 * `shared/sockets/types.ts` — where every other family's shapes live, inside
 * one `declare global { namespace Sockets }` block — is being edited by another
 * lane as this lands. A family declared here, imported by name, needs no line
 * in that file and cannot conflict with one. When it is clean again, one
 * `export * from "./layouts"` there gives the rest of the app the same import
 * point it has for everything else; nothing below has to move for that.
 *
 * ## What this family is NOT
 *
 * The existing `sessions:panelLayout:*` and `sessions:layoutPreset:*` events
 * keep working, unchanged, against the legacy blob. This family is the v2
 * **layout document** half: it speaks `LayoutDoc`, it knows about **origin**
 * and **visibility**, and it is what the v2 stage and editor use. The two
 * coexist until P6 retires the legacy renderer.
 */
import type { LayoutDoc, LayoutPreset } from "@serene-pub/sdk"

/** Who brought a row: the reconcilers' two, and a person's own. */
export type LayoutPresetOriginWire = "core" | "plugin" | "user"

/** Who may see a row. Shipped rows are always shared. */
export type LayoutVisibility = "shared" | "private"

/** Which tier of the resolution chain (§4.4) answered with the document. */
export type LayoutTier =
	| "session"
	| "preset"
	| "user-default"
	| "genre"
	| "built-in"

/**
 * One **session layout preset** on the wire.
 *
 * The first five fields are the legacy shape (`Sockets.Sessions.LayoutPreset`),
 * kept intact and still populated so the pre-v2 client reads this row exactly
 * as it reads the ones it asks for today; everything after them is v2.
 */
export interface LayoutPresetRow {
	id: number
	name: string
	genreId: string
	/**
	 * ⏳ LEGACY: `true` for a row the caller cannot manage — core's and a
	 * plugin's. The v2 client reads `origin` instead.
	 */
	isDefault: boolean
	/** ⏳ LEGACY: `{ zoneLayout?, widgetGrid?, arrangedGrid? }`, verbatim. */
	layout: Record<string, unknown>
	origin: LayoutPresetOriginWire
	visibility: LayoutVisibility
	slug: string
	description: string | null
	/** The v2 document, or null for a row that has none (a legacy user save). */
	document: LayoutDoc | null
	/** The declaring plugin's manifest id, for a `plugin` row. */
	pluginId: string | null
	/** The author, for a `user` row. */
	authorUserId: number | null
	updatedAt: string
}

/** The document a session resolves to, and what it was resolved from. */
export interface ResolvedLayout {
	sessionId: number
	document: LayoutDoc
	/** The preset that answered, or that the session is pinned to. */
	presetId: number | null
	/** The answering preset's origin; null when no preset answered. */
	origin: LayoutPresetOriginWire | null
	tier: LayoutTier
	/** Per-instance settings: the preset's pins under this person's own values. */
	settings: Record<string, Record<string, unknown>>
	/** Style pins by instance key: the preset's, under this person's own. */
	stylePins: Record<string, { id: number; slug: string }>
}

/**
 * Where a verb is scoped. A session names its own genre, so a caller holding
 * one need not (and the session is also what says whether they are a guest);
 * a caller outside a session names the genre itself.
 */
export interface LayoutScope {
	sessionId?: number
	genreId?: string
}

export interface LayoutsListParams extends LayoutScope {}
export interface LayoutsListResponse {
	genreId: string
	presets: LayoutPresetRow[]
}

export interface LayoutsSaveParams extends LayoutScope {
	name: string
	description?: string
	preset: LayoutPreset
}
export interface LayoutsSaveResponse {
	preset: LayoutPresetRow
	presets: LayoutPresetRow[]
}

export interface LayoutsUpdateParams {
	presetId: number
	name?: string
	description?: string
	/** A re-capture: the document (and its settings and pins) as they are now. */
	preset?: LayoutPreset
}
export interface LayoutsUpdateResponse {
	preset: LayoutPresetRow
	presets: LayoutPresetRow[]
}

export interface LayoutsShareParams extends LayoutScope {
	presetId: number
	visibility: LayoutVisibility
}
export interface LayoutsShareResponse {
	preset: LayoutPresetRow
	presets: LayoutPresetRow[]
}

export interface LayoutsCloneParams {
	presetId: number
	name?: string
}
export interface LayoutsCloneResponse {
	preset: LayoutPresetRow
	presets: LayoutPresetRow[]
}

export interface LayoutsDeleteParams {
	presetId: number
}
export interface LayoutsDeleteResponse {
	id: number
	genreId: string
	/** How many sessions were on it; they fall through the chain. */
	affectedSessions: number
	presets: LayoutPresetRow[]
}

export interface LayoutsUsageParams {
	presetId: number
}
export interface LayoutsUsageResponse {
	id: number
	sessions: number
}

export interface LayoutsSetDefaultParams extends LayoutScope {
	/** Null clears the default — new sessions take the genre's own again. */
	presetId: number | null
}
export interface LayoutsSetDefaultResponse {
	genreId: string
	presetId: number | null
}

export interface LayoutsExportParams {
	presetId: number
}
export interface LayoutsExportResponse {
	presetId: number
	genreId: string
	name: string
	description: string | null
	/** The portable bundle: document, per-instance settings, style pins. */
	preset: LayoutPreset
}

export interface LayoutsImportParams extends LayoutScope {
	name?: string
	description?: string
	preset: LayoutPreset
}
export interface LayoutsImportResponse {
	preset: LayoutPresetRow
	presets: LayoutPresetRow[]
}

export interface LayoutsResolveParams {
	sessionId: number
}
export type LayoutsResolveResponse = ResolvedLayout
