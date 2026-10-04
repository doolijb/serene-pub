/**
 * The `session_layout_presets` table's server module: the core seed
 * reconciler, the list a session is offered, the ONE copy helper every
 * starting point goes through (`copyLayoutIntoSession` — see "the copy
 * model" below), and the verbs a person manages their own **session layout
 * presets** with (save as new, rename, re-capture, share, clone, delete).
 *
 * Every row stores ONE format, the **session layout** (`SessionLayoutV1`,
 * NOMENCLATURE §9): the live blob the screen draws, `{ zoneLayout?,
 * widgetGrid?, arrangedGrid?, widgetSettings?, widgetStyles? }`, verbatim in
 * `layout`.
 *
 * ## What core seeds
 *
 * Every layout a CORE genre declares (`GenreDecl.layouts`, core-catalog's
 * `layout({ … })`), each under its own seed key: the first, `default`, is the
 * genre's **genre default layout** (`layout:<genreId>:default`), any other
 * `layout:<genreId>:core/<slug>`. A core genre that declares none (Chat, the
 * Guide) gets an empty `default` — the floor arrangement the app draws when a
 * layout places nothing. A PLUGIN genre's layouts are its owner's, projected
 * by `./pluginLayouts`; core seeds nothing for one and prunes what it once
 * did. Runs on boot, right after the pipeline specs the genre list is read
 * from.
 *
 * It writes only what changed. A row that already holds what core ships is
 * not touched, and `layout_updated_at` moves only when `layout` does — never
 * with `updated_at`, which rename, share and a version stamp bump — so a
 * session can tell the layout it started from was **Updated** since.
 *
 * ## The upgrade-safety landmine (why this looks the way it does)
 *
 * The codified seed rule (see defaults.ts) is: match on a natural key, NEVER on
 * a numeric id, and never let a seed touch a user row. Both invariants are
 * enforced structurally rather than by care:
 *
 *   • Upsert and prune both match on `seed_key`, and every write additionally
 *     requires `author_user_id IS NULL`. A user-authored preset carries
 *     `seed_key = NULL` and an author, so it fails BOTH predicates — it is
 *     invisible to every statement below, and cannot be overwritten or pruned
 *     by a reseed even if it somehow shared a key.
 *   • Rows are inserted with NO explicit id — the identity sequence assigns one —
 *     so there is no id collision with user rows and no `resyncIdSequences` need.
 *
 * ## Prune scope
 *
 * A core genre's stale rows (a key core no longer ships) are pruned only for
 * the core genres actually being synced, exactly as widgetStyles confines
 * itself to the widget ids it processed: a genre that has gone away keeps its
 * rows rather than having the `layout_preset_id` references pointing at them
 * silently nulled by the FK's `ON DELETE SET NULL`. Core's rows for a NON-core
 * genre are pruned wherever they are, because they were never core's to hold:
 * that genre's default is its owning plugin's row.
 */
import {
	and,
	asc,
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notInArray,
	notLike,
	or,
	type SQL
} from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import {
	DEFAULT_PRESET_NAME,
	coreLayoutSeedKey,
	isCoreGenre
} from "$lib/shared/sessionLayout/presets"
import {
	canManage,
	canSee,
	canShare,
	type LayoutActor
} from "./layoutPermissions"
import {
	canonicalize,
	drawnWidgetIds,
	getGenre,
	i18nText,
	validateSessionLayout,
	widgetOfInstance,
	type SessionLayoutV1
} from "@serene-pub/sdk"

/** Who may see a row. Core and plugin rows are always `shared`. */
export type LayoutVisibility = "shared" | "private"

/** A session layout, as every `layout` column stores it: verbatim JSON. */
type SessionLayoutBlob = Record<string, unknown>

/**
 * Do two stored layouts say the same thing? Compared canonically (keys
 * sorted), so a row read back from the database in another key order is not
 * "changed". What both reconcilers ask before they write a layout.
 */
export function sameLayout(a: unknown, b: unknown): boolean {
	return canonicalize(a ?? {}) === canonicalize(b ?? {})
}

/** What a reseed stamps on the rows it wrote, and which app version wrote them. */
export interface SyncLayoutPresetsOptions {
	/** Provenance for `seeded_by_version`, as `syncWidgetStyles` takes it. */
	version?: string
}

/** The slug the genre's own layout holds — reserved to the genre's owner. */
export const DEFAULT_LAYOUT_SLUG = "default"

/** One row core ships for a core genre. */
interface ShippedLayout {
	seedKey: string
	slug: string
	name: string
	description: string | null
	layout: SessionLayoutBlob
}

/**
 * The layouts a CORE genre ships, as rows: every entry of its declared
 * `layouts` (the first is `default`, `genre()` enforces it), else the empty
 * floor. Core's genres register when the catalog is imported, which is why
 * the import comes first.
 */
async function shippedLayoutsOf(genreId: string): Promise<ShippedLayout[]> {
	await import("@serene-pub/core-catalog")
	const declared = getGenre(genreId)?.layouts ?? []
	if (!declared.length)
		return [
			{
				seedKey: coreLayoutSeedKey(genreId, DEFAULT_LAYOUT_SLUG),
				slug: DEFAULT_LAYOUT_SLUG,
				name: DEFAULT_PRESET_NAME,
				description: null,
				layout: {}
			}
		]
	return declared.map((l) => ({
		seedKey: coreLayoutSeedKey(genreId, l.slug),
		slug: l.slug,
		name: i18nText(l.name) || DEFAULT_PRESET_NAME,
		description: i18nText(l.description) || null,
		// A plain copy: the declaration is frozen, the column is JSON.
		layout: JSON.parse(JSON.stringify(l.preset)) as SessionLayoutBlob
	}))
}

/**
 * Reconcile core's shipped layouts against `session_layout_presets`.
 * Idempotent, and a second run writes nothing: safe to run every boot.
 *
 * `genreIds` is every genre the instance has (core's and plugins'); only the
 * core ones are seeded — see the header.
 */
export async function syncLayoutPresets(
	genreIds: readonly string[],
	options: SyncLayoutPresetsOptions = {}
): Promise<void> {
	// De-duplicate: the genre list unions create-spec genres with transitional
	// input-type genres, and `seed_key` is globally unique — a repeated genre id
	// would make the second insert collide.
	const coreGenres = [...new Set(genreIds.filter(Boolean))].filter(isCoreGenre)

	// Every row already holding a seed key — authored ones INCLUDED, because
	// `seed_key` is globally unique. Nothing in the app ever gives a user row a
	// seed key (the save path writes NULL), but if one somehow held a shipped
	// key, filtering it out here would send us down the insert branch and the
	// unique constraint would abort the boot seed. Reading it and skipping is
	// both crash-proof and the stronger reading of "never touch a user row".
	const existing = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(isNotNull(schema.sessionLayoutPresets.seedKey))
	const existingByKey = new Map(existing.map((r) => [r.seedKey as string, r]))

	const shippedKeys: string[] = []
	for (const genreId of coreGenres) {
		for (const shipped of await shippedLayoutsOf(genreId)) {
			shippedKeys.push(shipped.seedKey)
			const found = existingByKey.get(shipped.seedKey)
			// A row someone authored is not ours to re-force, whatever key it holds.
			if (found && found.authorUserId !== null) continue
			// …nor is a plugin's. A plugin's seed keys are namespaced
			// (`layout:<genreId>:<pluginId>/<slug>`, and no plugin is `core`) so
			// one cannot collide with core's, but the scope is stated rather than
			// inferred.
			if (found && found.origin === "plugin") continue
			const shippedFields = {
				genreId,
				origin: "core" as const,
				pluginId: null,
				withdrawnAt: null,
				slug: shipped.slug,
				name: shipped.name,
				description: shipped.description,
				visibility: "shared" as const,
				layout: shipped.layout,
				seededByVersion: options.version ?? null
			}
			if (!found) {
				await db.insert(schema.sessionLayoutPresets).values({
					// NO id — the sequence assigns one (seed rule). The layout is
					// new, so `layout_updated_at` takes its default.
					seedKey: shipped.seedKey,
					authorUserId: null,
					...shippedFields
				})
				continue
			}
			// Write only what moved; stamp `layout_updated_at` only when the
			// layout did. Never the id, never the author.
			const layoutMoved = !sameLayout(found.layout, shipped.layout)
			const moved = (Object.keys(shippedFields) as Array<keyof typeof shippedFields>).some(
				(k) => k !== "layout" && found[k] !== shippedFields[k]
			)
			if (!layoutMoved && !moved) continue
			await db
				.update(schema.sessionLayoutPresets)
				.set({
					...shippedFields,
					...(layoutMoved ? { layoutUpdatedAt: new Date() } : {})
				})
				.where(
					and(
						eq(schema.sessionLayoutPresets.seedKey, shipped.seedKey),
						isNull(schema.sessionLayoutPresets.authorUserId)
					)
				)
		}
	}

	// Prune a core genre's seeded rows whose key core no longer ships (a
	// layout it dropped, a row left by an older key scheme). Scoped to
	// author-less, seed-keyed, `origin = 'core'` rows AND to the core genres
	// actually processed, so a plugin's rows, another genre's rows and every
	// user row are untouched. `inArray` over an empty list matches nothing.
	if (coreGenres.length)
		await db
			.delete(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.origin, "core"),
					isNull(schema.sessionLayoutPresets.authorUserId),
					isNotNull(schema.sessionLayoutPresets.seedKey),
					inArray(schema.sessionLayoutPresets.genreId, coreGenres),
					notInArray(schema.sessionLayoutPresets.seedKey, shippedKeys)
				)
			)

	// Prune core's rows for a NON-core genre, wherever they are: an older
	// reconciler seeded an empty `default` for every plugin genre, and that
	// row would stand in for the genre's own (its owning plugin's) default.
	// The FK is `SET NULL`, so a session that started from one loses only
	// that label: its layout is its own copy.
	await db
		.delete(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.origin, "core"),
				isNull(schema.sessionLayoutPresets.authorUserId),
				isNotNull(schema.sessionLayoutPresets.seedKey),
				notLike(schema.sessionLayoutPresets.genreId, "core:%")
			)
		)
}

/* ── reads ──────────────────────────────────────────────────────────────
 * Visibility is the ruled matrix (`layoutPermissions.ts`), and it lives in ONE
 * predicate: `visibleTo`. A caller sees every shipped row that has not been
 * withdrawn, every shared row, and their own — never anybody else's private
 * one, admin included. Enforced in the query rather than by the caller
 * remembering to filter, because this is the only place that reads the table.
 */

/** One row on the wire. */
type LayoutPresetWire = Sockets.Sessions.LayoutPreset

type PresetRow = typeof schema.sessionLayoutPresets.$inferSelect

/** Is this a plain (non-array, non-null) object? */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v)
}

/**
 * Is this row a candidate for its genre's **genre default layout**? The
 * `default` slug, shipped by the genre's OWNER (core for a `core:` genre, a
 * plugin for a plugin genre — `./pluginLayouts` refuses `default` from any
 * package that does not own the genre), not withdrawn. The lowest id among the
 * candidates is the one (`genreDefaultLayoutRow`), so the list and the lookup
 * cannot disagree.
 */
function isGenreDefaultCandidate(row: PresetRow): boolean {
	return (
		row.slug === DEFAULT_LAYOUT_SLUG &&
		row.origin === (isCoreGenre(row.genreId) ? "core" : "plugin") &&
		row.authorUserId === null &&
		!row.withdrawnAt
	)
}

/**
 * What the wire needs beyond a row: the names a card is labelled with, and the
 * two facts that depend on who is asking. Read once per list, never per row.
 */
interface WireContext {
	userId: number
	genreDefaultIds: ReadonlySet<number>
	newSessionLayoutIds: ReadonlySet<number>
	pluginNames: ReadonlyMap<string, string>
	authorNames: ReadonlyMap<number, string>
}

async function wireContext(
	handle: Db,
	rows: readonly PresetRow[],
	userId: number
): Promise<WireContext> {
	const genreIds = [...new Set(rows.map((r) => r.genreId))]
	const genreDefaultIds = new Set<number>()
	for (const genreId of genreIds) {
		const def = await genreDefaultLayoutRow(genreId, handle)
		if (def) genreDefaultIds.add(def.id)
	}
	const newSessionLayoutIds = new Set<number>()
	if (genreIds.length) {
		const chosen = await handle
			.select({ id: schema.userLayoutDefaults.layoutPresetId })
			.from(schema.userLayoutDefaults)
			.where(
				and(
					eq(schema.userLayoutDefaults.userId, userId),
					inArray(schema.userLayoutDefaults.genreId, genreIds)
				)
			)
		for (const c of chosen) if (c.id != null) newSessionLayoutIds.add(c.id)
	}
	const pluginIds = [
		...new Set(rows.map((r) => r.pluginId).filter((p): p is string => !!p))
	]
	const pluginNames = new Map<string, string>()
	if (pluginIds.length)
		for (const p of await handle
			.select({ pluginId: schema.plugins.pluginId, name: schema.plugins.name })
			.from(schema.plugins)
			.where(inArray(schema.plugins.pluginId, pluginIds)))
			pluginNames.set(p.pluginId, p.name)
	const authorIds = [
		...new Set(
			rows.map((r) => r.authorUserId).filter((a): a is number => a !== null)
		)
	]
	const authorNames = new Map<number, string>()
	if (authorIds.length)
		for (const u of await handle
			.select({
				id: schema.users.id,
				username: schema.users.username,
				displayName: schema.users.displayName
			})
			.from(schema.users)
			.where(inArray(schema.users.id, authorIds)))
			authorNames.set(u.id, u.displayName || u.username)
	return {
		userId,
		genreDefaultIds,
		newSessionLayoutIds,
		pluginNames,
		authorNames
	}
}

/**
 * Row → wire. `seedKey` is deliberately not published: it is the reconciler's
 * private matching key, and a client that could read it would be one edit away
 * from being able to send one.
 *
 * Spelled out field by field, so a column added later never joins the wire
 * silently. Every field the editor's panes read (briefs 4 and 6 of the layout
 * plan) is here, so no later brief edits the wire.
 */
function toWire(row: PresetRow, ctx: WireContext): LayoutPresetWire {
	return {
		id: row.id,
		name: row.name,
		genreId: row.genreId,
		origin: row.origin as LayoutPresetWire["origin"],
		slug: row.slug,
		description: row.description ?? null,
		pluginId: row.pluginId ?? null,
		pluginName: row.pluginId
			? (ctx.pluginNames.get(row.pluginId) ?? row.pluginId)
			: null,
		isGenreDefault: ctx.genreDefaultIds.has(row.id),
		visibility: row.visibility === "shared" ? "shared" : "private",
		mine: canManage(row, { id: ctx.userId }),
		authorName:
			row.authorUserId !== null
				? (ctx.authorNames.get(row.authorUserId) ?? null)
				: null,
		isNewSessionLayout: ctx.newSessionLayoutIds.has(row.id),
		layout: isPlainObject(row.layout) ? row.layout : {},
		layoutUpdatedAt: new Date(row.layoutUpdatedAt).toISOString()
	}
}

/** Rows → wire, with one context read for all of them. */
async function wireRows(
	rows: readonly PresetRow[],
	userId: number,
	handle: Db = db
): Promise<LayoutPresetWire[]> {
	if (!rows.length) return []
	const ctx = await wireContext(handle, rows, userId)
	return rows.map((r) => toWire(r, ctx))
}

/** One row → wire. */
async function wireRow(
	row: PresetRow,
	userId: number,
	handle: Db = db
): Promise<LayoutPresetWire> {
	return (await wireRows([row], userId, handle))[0]
}

/**
 * `WHERE genre = … AND not withdrawn AND (shipped OR shared OR mine)` — the
 * one visibility predicate, and the SQL half of `canSee`.
 *
 * The first branch asks `origin`, not `author_user_id`, on purpose: `origin` is
 * a column no user-facing verb writes, so a row cannot be made to masquerade as
 * a shipped one.
 */
function visibleTo(genreId: string, userId: number): SQL | undefined {
	return and(
		eq(schema.sessionLayoutPresets.genreId, genreId),
		isNull(schema.sessionLayoutPresets.withdrawnAt),
		or(
			ne(schema.sessionLayoutPresets.origin, "user"),
			eq(schema.sessionLayoutPresets.visibility, "shared"),
			eq(schema.sessionLayoutPresets.authorUserId, userId)
		)
	)
}

/**
 * The group a row lists in, in the order the editor's **Start from** cards
 * are grouped: the genre default layout, core's other layouts, plugins' (one
 * group per plugin), yours, then shared with you.
 */
function listGroup(row: PresetRow, ctx: WireContext): number {
	if (ctx.genreDefaultIds.has(row.id)) return 0
	if (row.origin === "core") return 1
	if (row.origin === "plugin") return 2
	return row.authorUserId === ctx.userId ? 3 : 4
}

/**
 * The session layout presets a person may **start from** in a genre, grouped
 * as the editor draws them (`listGroup`); within a group, plugins by name and
 * then every row in creation order — a stable list that does not reshuffle
 * when someone renames one.
 */
export async function listLayoutPresets(
	genreId: string,
	userId: number,
	handle: Db = db
): Promise<LayoutPresetWire[]> {
	const rows = await handle
		.select()
		.from(schema.sessionLayoutPresets)
		.where(visibleTo(genreId, userId))
	if (!rows.length) return []
	const ctx = await wireContext(handle, rows, userId)
	const pluginName = (r: PresetRow) =>
		r.pluginId ? (ctx.pluginNames.get(r.pluginId) ?? r.pluginId) : ""
	return rows
		.slice()
		.sort((a, b) => {
			const ga = listGroup(a, ctx)
			const gb = listGroup(b, ctx)
			if (ga !== gb) return ga - gb
			if (ga === 2) {
				const byName = pluginName(a).localeCompare(pluginName(b))
				if (byName) return byName
				const byId = (a.pluginId ?? "").localeCompare(b.pluginId ?? "")
				if (byId) return byId
			}
			return a.id - b.id
		})
		.map((r) => toWire(r, ctx))
}

/**
 * The row behind a preset id, when the caller may copy it into a session of
 * this genre — the guard every copy passes: the session's genre, and visible
 * to the caller (shipped and not withdrawn, shared, or theirs). `null` for
 * anything else, a stranger's private row included, so the id space cannot
 * be walked.
 */
async function applicableRow(
	handle: Db,
	presetId: number,
	genreId: string,
	userId: number
): Promise<PresetRow | null> {
	if (!Number.isInteger(presetId)) return null
	const [row] = await handle
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.id, presetId),
				visibleTo(genreId, userId)
			)
		)
		.limit(1)
	return row ?? null
}

/**
 * May the caller copy this preset into a session of this genre (or name it as
 * their new-session layout)? Same genre, and one they can see. Without it, any
 * id at all could be copied, and a stranger's private layout would be copied
 * into whoever named it.
 */
export async function canApplyLayoutPreset(
	presetId: number,
	genreId: string,
	userId: number,
	handle: Db = db
): Promise<boolean> {
	return !!(await applicableRow(handle, presetId, genreId, userId))
}

/**
 * A genre's **genre default layout** row: its `default` layout, shipped by the
 * genre's OWNER — core's row for a `core:` genre, the owning plugin's for a
 * plugin genre (`./pluginLayouts` refuses `default` from any package that
 * does not own the genre, so a plugin row under that slug is the owner's).
 * Never a person's, never a withdrawn one. `null` when the owner ships none —
 * a plugin genre whose package declares no layout — and a session then starts
 * from scratch.
 */
export async function genreDefaultLayoutRow(
	genreId: string,
	handle: Db = db
): Promise<PresetRow | null> {
	const [row] = await handle
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.genreId, genreId),
				eq(schema.sessionLayoutPresets.slug, DEFAULT_LAYOUT_SLUG),
				eq(
					schema.sessionLayoutPresets.origin,
					isCoreGenre(genreId) ? "core" : "plugin"
				),
				isNull(schema.sessionLayoutPresets.authorUserId),
				isNull(schema.sessionLayoutPresets.withdrawnAt)
			)
		)
		.orderBy(asc(schema.sessionLayoutPresets.id))
		.limit(1)
	return row ?? null
}

/* ── the copy model ─────────────────────────────────────────────────────
 * A session's layout is its OWN `session_panel_layouts` row, per person per
 * session (owner LA). Nothing is layered over anything at read time: a
 * starting point is COPIED in (owner L2), and the row keeps only provenance —
 * which preset it **started from**, and when — to label it, to offer "Start
 * again from", and to notice the source changed since (`layout_updated_at`
 * later than `layout_copied_at`, the **Updated** chip). Provenance is never
 * read to draw.
 *
 * One fact, one home, inside a session: the arrangement is the row's
 * `layout`; per-instance values are `widget_settings` rows; style pins are
 * `layout_settings.widgetStyles`. A preset carries all three in its one blob
 * (`widgetSettings`, `widgetStyles`), so a copy unpacks it and Save as new
 * packs it.
 */

/** The slots of a session layout that ARE its arrangement. */
const ARRANGEMENT_SLOTS = ["zoneLayout", "widgetGrid", "arrangedGrid"] as const

/**
 * A layout's arrangement: its `zoneLayout`, `widgetGrid` and `arrangedGrid`,
 * verbatim, with an absent slot left absent. Never `widgetSettings` or
 * `widgetStyles` (a session keeps those in their own homes), and never the
 * session-only `active` and `tierSizeOverrides`.
 */
export function arrangementOf(layout: unknown): SessionLayoutBlob {
	const out: SessionLayoutBlob = {}
	if (!isPlainObject(layout)) return out
	for (const slot of ARRANGEMENT_SLOTS)
		if (layout[slot] !== undefined) out[slot] = layout[slot]
	return out
}

/** A `{ [widget instance id]: object }` map's well-formed entries, copied. */
function objectEntries(v: unknown): Record<string, Record<string, unknown>> {
	const out: Record<string, Record<string, unknown>> = {}
	if (!isPlainObject(v)) return out
	for (const [k, val] of Object.entries(v))
		if (isPlainObject(val)) out[k] = { ...val }
	return out
}

/**
 * The person's **new-session layout** for a genre if it still applies to them
 * (not deleted, unshared or withdrawn — `canApplyLayoutPreset`), else the
 * genre default layout, else `null` (start from scratch). What a first open
 * copies.
 */
export async function resolveNewSessionLayout(
	tx: Db,
	userId: number,
	genreId: string
): Promise<number | null> {
	const [chosen] = await tx
		.select({ id: schema.userLayoutDefaults.layoutPresetId })
		.from(schema.userLayoutDefaults)
		.where(
			and(
				eq(schema.userLayoutDefaults.userId, userId),
				eq(schema.userLayoutDefaults.genreId, genreId)
			)
		)
		.limit(1)
	if (chosen?.id != null && (await applicableRow(tx, chosen.id, genreId, userId)))
		return chosen.id
	return (await genreDefaultLayoutRow(genreId, tx))?.id ?? null
}

/** What a copy was asked to do. */
export interface CopyLayoutIntoSession {
	sessionId: number
	userId: number
	/** The session's genre: a preset from any other is refused. */
	genreId: string
	/** The session layout preset to copy; `null` is **Start from scratch**. */
	layoutPresetId: number | null
	/**
	 * The first open: write only if the person has no row yet, so two tabs
	 * opening a session at once make one row (the loser writes nothing).
	 */
	onlyIfAbsent?: boolean
}

export type CopyLayoutOutcome =
	| { ok: true; copied: boolean }
	| { ok: false; error: string }

/**
 * Copy a layout into one person's session — the ONE helper behind the first
 * open, **Start from**, **Start again from**, **Reset to genre default layout**
 * and **Start from scratch**. Inside the caller's transaction, `tx` only.
 *
 * - The preset must apply (`applicableRow`); anything else is refused with
 *   the unknown-layout sentence and nothing is written.
 * - The row's `layout` becomes the source's arrangement (`arrangementOf`), so
 *   this session's `active` and `tierSizeOverrides` go with it.
 * - The source's `widgetSettings` and `widgetStyles` WIN for each widget
 *   instance they name; this session keeps its values for every other one
 *   (owner LB). A widget-settings key is held to the widgets the session can
 *   seat (`seatedKeys`), as a `:set` is.
 * - **Start from scratch** (`null`) is the minimal working setup AT ITS
 *   DEFAULTS (owner LC): the layout is `{}`, which the page draws as the
 *   conversation in the middle (unless the genre omits it, whose primary the
 *   floor places) and the genre's declared panels, and every one of this
 *   session's widget settings and style pins is cleared (`resetToDefaults`).
 *   ALL of them, not only the drawn instances': what `{}` draws is the page's
 *   floor, which moves with the genre's declarations and the plugins enabled,
 *   so the server cannot name those instances without keeping a second copy
 *   of that rule; and a value kept for an instance scratch does not draw
 *   would come back the moment the person adds that widget again, which is
 *   not starting from scratch. Nothing is lost that a draw could show:
 *   **Save as new layout** never packs an undrawn instance's values either.
 *   A FIRST open that finds nothing to copy (a genre with no genre default
 *   layout) also writes `{}`, but clears nothing: it is not the person
 *   asking to start over.
 * - Provenance: `started from` the preset (null for scratch), copied now.
 */
export async function copyLayoutIntoSession(
	tx: Db,
	args: CopyLayoutIntoSession
): Promise<CopyLayoutOutcome> {
	let source: SessionLayoutBlob = {}
	if (args.layoutPresetId !== null) {
		const row = await applicableRow(
			tx,
			args.layoutPresetId,
			args.genreId,
			args.userId
		)
		if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
		if (isPlainObject(row.layout)) source = row.layout
	}
	const layout = arrangementOf(source)
	const incomingPins = objectEntries(source.widgetStyles)
	const incomingSettings = objectEntries(source.widgetSettings)
	const at = new Date()
	const provenance = {
		startedFromLayoutPresetId: args.layoutPresetId,
		layoutCopiedAt: at
	}
	const mine = and(
		eq(schema.sessionPanelLayouts.sessionId, args.sessionId),
		eq(schema.sessionPanelLayouts.userId, args.userId)
	)

	if (args.onlyIfAbsent) {
		const inserted = await tx
			.insert(schema.sessionPanelLayouts)
			.values({
				sessionId: args.sessionId,
				userId: args.userId,
				layout,
				...provenance,
				layoutSettings: Object.keys(incomingPins).length
					? { widgetStyles: incomingPins }
					: {}
			})
			.onConflictDoNothing({
				target: [
					schema.sessionPanelLayouts.userId,
					schema.sessionPanelLayouts.sessionId
				]
			})
			.returning({ id: schema.sessionPanelLayouts.id })
		if (!inserted.length) return { ok: true, copied: false }
	} else {
		const [existing] = await tx
			.select({ layoutSettings: schema.sessionPanelLayouts.layoutSettings })
			.from(schema.sessionPanelLayouts)
			.where(mine)
			.limit(1)
		const settings = isPlainObject(existing?.layoutSettings)
			? existing.layoutSettings
			: {}
		let layoutSettings: Record<string, unknown> = settings
		if (args.layoutPresetId === null) {
			// Scratch: every pin goes; a key that is not a pin rides through.
			layoutSettings = { ...settings }
			delete layoutSettings.widgetStyles
		} else if (Object.keys(incomingPins).length)
			layoutSettings = {
				...settings,
				widgetStyles: {
					...objectEntries(settings.widgetStyles),
					...incomingPins
				}
			}
		await tx
			.insert(schema.sessionPanelLayouts)
			.values({
				sessionId: args.sessionId,
				userId: args.userId,
				layout,
				...provenance,
				layoutSettings
			})
			.onConflictDoUpdate({
				target: [
					schema.sessionPanelLayouts.userId,
					schema.sessionPanelLayouts.sessionId
				],
				set: { layout, ...provenance, layoutSettings, updatedAt: at }
			})
	}

	if (args.layoutPresetId === null) {
		// A first open with nothing to copy (a genre with no genre default
		// layout) is not Start from scratch: it clears nothing the person
		// already holds for the session.
		if (!args.onlyIfAbsent) await resetToDefaults(tx, args.sessionId, args.userId)
		return { ok: true, copied: true }
	}

	const keys = await seatedKeys(
		tx,
		args.sessionId,
		args.userId,
		args.genreId,
		Object.keys(incomingSettings)
	)
	for (const key of keys) {
		const values = incomingSettings[key]
		// The layout says "this widget at its declared defaults": it wins, so
		// the session's own deviations for it go.
		if (!Object.keys(values).length) {
			await tx
				.delete(schema.widgetSettings)
				.where(
					and(
						eq(schema.widgetSettings.sessionId, args.sessionId),
						eq(schema.widgetSettings.userId, args.userId),
						eq(schema.widgetSettings.widgetSlug, key)
					)
				)
			continue
		}
		await tx
			.insert(schema.widgetSettings)
			.values({
				sessionId: args.sessionId,
				userId: args.userId,
				widgetSlug: key,
				values
			})
			.onConflictDoUpdate({
				target: [
					schema.widgetSettings.userId,
					schema.widgetSettings.sessionId,
					schema.widgetSettings.widgetSlug
				],
				set: { values, updatedAt: new Date() }
			})
	}
	return { ok: true, copied: true }
}

/**
 * Every widget instance of this person's session back at its declared
 * defaults: their `widget_settings` rows for the session go (settings are
 * deviations from the defaults, so no row IS the defaults). The style pins
 * are cleared by the caller, which is already writing `layout_settings`.
 * **Start from scratch**'s half of owner LC.
 */
async function resetToDefaults(
	tx: Db,
	sessionId: number,
	userId: number
): Promise<void> {
	await tx
		.delete(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, sessionId),
				eq(schema.widgetSettings.userId, userId)
			)
		)
}

/**
 * The widget-settings keys a copy may write into this session: a key whose
 * widget the session can SEAT (core's, the genre's declared panels, an
 * enabled plugin's, an offered authored component's — `seatableWidgetIds`),
 * or one this person already has a row for here. The rule `:set` holds a
 * client's keys to, because a key becomes a `widget_slug` verbatim. A key in
 * neither is dropped with a warning, never the whole copy.
 */
async function seatedKeys(
	tx: Db,
	sessionId: number,
	userId: number,
	genreId: string,
	keys: readonly string[]
): Promise<string[]> {
	if (!keys.length) return []
	const { seatableWidgetIds } = await import("$lib/server/plugins/frameHost")
	const seatable = await seatableWidgetIds(tx, genreId)
	const stored = new Set(
		(
			await tx
				.select({ widgetSlug: schema.widgetSettings.widgetSlug })
				.from(schema.widgetSettings)
				.where(
					and(
						eq(schema.widgetSettings.sessionId, sessionId),
						eq(schema.widgetSettings.userId, userId)
					)
				)
		).map((r) => r.widgetSlug)
	)
	return keys.filter((key) => {
		if (seatable.has(widgetOfInstance(key)) || stored.has(key)) return true
		console.warn(
			`session layout copy: dropped widget settings for '${key}' — no ` +
				`such widget in session ${sessionId}.`
		)
		return false
	})
}

/**
 * Has the preset this session's layout **started from** changed since the
 * copy? Its `layout_updated_at` later than the row's `layout_copied_at` — the
 * **Updated** chip. A label only: nothing moves until the person starts again.
 * `false` without a source, without a copy stamp, or when the source is no
 * longer one they can see.
 */
export function startedFromUpdated(
	source: Pick<LayoutPresetWire, "layoutUpdatedAt"> | undefined,
	layoutCopiedAt: Date | null
): boolean {
	if (!source || !layoutCopiedAt) return false
	return new Date(source.layoutUpdatedAt).getTime() > layoutCopiedAt.getTime()
}

/** The longest a user-supplied preset name may be. */
export const LAYOUT_PRESET_NAME_MAX = 80

/** The longest a description may be. One line about a layout, not an essay. */
export const LAYOUT_PRESET_DESCRIPTION_MAX = 400

/** The name, trimmed and bounded; the description likewise, or null. */
const cleanName = (name: unknown): string =>
	typeof name === "string" ? name.trim().slice(0, LAYOUT_PRESET_NAME_MAX) : ""
/**
 * "*Name* (copy)", within the bound: the name gives way, never the suffix —
 * cut after it was added, a long name's copy read exactly like its source.
 */
const COPY_SUFFIX = " (copy)"
const copyName = (name: string): string =>
	`${cleanName(name).slice(0, LAYOUT_PRESET_NAME_MAX - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`.trim()
const cleanDescription = (d: unknown): string | null => {
	const t = typeof d === "string" ? d.trim().slice(0, LAYOUT_PRESET_DESCRIPTION_MAX) : ""
	return t || null
}

/**
 * A name as a **slug**: the stable key the row is addressed by within its
 * owner. Kebab, lower case, ASCII — the grammar shipped slugs already use
 * (`default`, `cinematic`), so a person's row and a genre's read the same way.
 */
export function layoutSlugFrom(name: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
	return base || "layout"
}

/**
 * …and the first form of it this author has not already used in this genre.
 *
 * The partial unique index `(author_user_id, genre_id, slug)` is the real
 * guarantee; this is what keeps it from being hit in the ordinary case of
 * somebody saving "Wide" twice. A race that beats it still raises the
 * constraint, which the caller retries — see `insertUserPreset`.
 */
async function freeUserSlug(
	handle: Db,
	genreId: string,
	userId: number,
	name: string
): Promise<string> {
	const base = layoutSlugFrom(name)
	const taken = new Set(
		(
			await handle
				.select({ slug: schema.sessionLayoutPresets.slug })
				.from(schema.sessionLayoutPresets)
				.where(
					and(
						eq(schema.sessionLayoutPresets.genreId, genreId),
						eq(schema.sessionLayoutPresets.origin, "user"),
						eq(schema.sessionLayoutPresets.authorUserId, userId)
					)
				)
		).map((r) => r.slug)
	)
	if (!taken.has(base)) return base
	for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
	return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

/** The fields a user row carries whatever verb wrote it. */
interface UserPresetContent {
	name: string
	description: string | null
	/** The session layout, verbatim. `{}` reads as "no overrides". */
	layout: SessionLayoutBlob
	/** When `layout` was written; the column's default (now) when absent. */
	layoutUpdatedAt?: Date
}

/**
 * Insert one user row, retrying its slug once if a concurrent save took it.
 *
 * `seedKey` is unconditionally NULL, `origin` unconditionally `user` and
 * `authorUserId` unconditionally the caller: the three facts that keep
 * everything saved here outside both reconcilers' reach forever.
 *
 * The first attempt runs in its own (nested) transaction, so a slug collision
 * inside a caller's transaction rolls back only that attempt and the retry
 * can still write.
 */
async function insertUserPreset(
	genreId: string,
	userId: number,
	content: UserPresetContent,
	visibility: LayoutVisibility = "private",
	handle: Db = db
): Promise<PresetRow> {
	const values = {
		seedKey: null,
		genreId,
		origin: "user" as const,
		pluginId: null,
		withdrawnAt: null,
		authorUserId: userId,
		visibility,
		seededByVersion: null,
		...content
	}
	const slug = await freeUserSlug(handle, genreId, userId, content.name)
	try {
		return await handle.transaction(async (attempt) => {
			const [row] = await attempt
				.insert(schema.sessionLayoutPresets)
				.values({ ...values, slug })
				.returning()
			return row
		})
	} catch {
		// The unique index is the authority, not the read above it. One retry
		// with a slug nothing can have raced us to. Anything that was NOT a
		// slug collision fails the same way twice, and the second throw is the
		// one the caller sees — untouched, so a real fault still reads as one.
		const [row] = await handle
			.insert(schema.sessionLayoutPresets)
			.values({
				...values,
				slug: `${slug}-${crypto.randomUUID().slice(0, 8)}`
			})
			.returning()
		return row
	}
}

/**
 * Insert a user-authored session layout preset, private, its slug taken from
 * the name, from a finished layout blob stored AS GIVEN (unchecked). No
 * socket reaches it: it is the seam tests and fixtures save through. What a
 * person reaches is **Save as new layout** (`saveAsNewLayout`), which packs
 * the blob from a session and checks it.
 */
export async function saveUserLayoutPreset(args: {
	genreId: string
	userId: number
	name: string
	description?: string
	layout: SessionLayoutBlob
}): Promise<LayoutPresetWire> {
	const row = await insertUserPreset(args.genreId, args.userId, {
		name: cleanName(args.name),
		description: cleanDescription(args.description),
		layout: args.layout ?? {}
	})
	return wireRow(row, args.userId)
}

/**
 * **Save as new layout** (owner L3): write a new private session layout preset
 * from this session's layout, and make it what this session **started from**.
 * One transaction.
 *
 * The row's `layout` is the sent arrangement (`arrangementOf`) plus, packed
 * from this session's own homes, the `widgetSettings` rows and the
 * `layout_settings.widgetStyles` pins of the widget instances the session
 * DRAWS: the arrangement's own (`drawnWidgetIds`) and the page's report of
 * what its floor adds (`args.drawnWidgetIds`: the conversation or the genre's
 * primary widget, and the genre's panels an empty layout draws by default —
 * none of which an arrangement names). A removed copy's leftover rows never
 * travel.
 *
 * The preset's `layout_updated_at` and the session's `layout_copied_at` are
 * one instant, so the session does not read its own save as **Updated**.
 *
 * A packed layout the app cannot draw (`drawable`) is refused and nothing is
 * written.
 */
export async function saveAsNewLayout(args: {
	sessionId: number
	genreId: string
	userId: number
	name: string
	description?: string
	layout: SessionLayoutBlob
	/** Every widget instance the session draws, as the page reports it. */
	drawnWidgetIds: readonly string[]
}): Promise<
	| {
			ok: true
			preset: LayoutPresetWire
			startedFromLayoutPresetId: number
			layoutCopiedAt: Date
	  }
	| Refused
> {
	const at = new Date()
	const row = await db.transaction(async (tx) => {
		const layout = await packSessionLayout(tx, args)
		if (!drawable(layout, "save")) return null
		const saved = await insertUserPreset(
			args.genreId,
			args.userId,
			{
				name: cleanName(args.name),
				description: cleanDescription(args.description),
				layout,
				layoutUpdatedAt: at
			},
			"private",
			tx
		)
		await markStartedFrom(tx, args, saved.id, at)
		return saved
	})
	if (!row) return { ok: false, error: LAYOUT_PRESET_CANT_SAVE }
	return {
		ok: true,
		preset: await wireRow(row, args.userId),
		startedFromLayoutPresetId: row.id,
		layoutCopiedAt: at
	}
}

/** The session a layout is saved from, and what it draws. */
interface SavedFrom {
	sessionId: number
	userId: number
	/** The sent session layout; only its arrangement is read. */
	layout: SessionLayoutBlob
	/** Every widget instance the session draws, as the page reports it. */
	drawnWidgetIds: readonly string[]
}

/**
 * A session's layout as a **session layout preset** carries it — the ONE
 * packing behind **Save as new layout** and **Save changes to "*Name*"**: the
 * sent arrangement (`arrangementOf`), plus this person's `widget_settings`
 * rows and `layout_settings.widgetStyles` pins for the instances the session
 * DRAWS (the arrangement's own, `drawnWidgetIds`, and the page's report of
 * what its floor adds). A removed copy's leftover rows never travel.
 */
async function packSessionLayout(
	tx: Db,
	from: SavedFrom
): Promise<SessionLayoutBlob> {
	const arrangement = arrangementOf(from.layout)
	const placed = new Set([
		...drawnWidgetIds(arrangement as SessionLayoutV1),
		...from.drawnWidgetIds
	])
	const settings: Record<string, Record<string, unknown>> = {}
	for (const r of await tx
		.select({
			widgetSlug: schema.widgetSettings.widgetSlug,
			values: schema.widgetSettings.values
		})
		.from(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, from.sessionId),
				eq(schema.widgetSettings.userId, from.userId)
			)
		))
		if (
			placed.has(r.widgetSlug) &&
			isPlainObject(r.values) &&
			Object.keys(r.values).length
		)
			settings[r.widgetSlug] = r.values
	const [own] = await tx
		.select({ layoutSettings: schema.sessionPanelLayouts.layoutSettings })
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, from.sessionId),
				eq(schema.sessionPanelLayouts.userId, from.userId)
			)
		)
		.limit(1)
	const pins = Object.fromEntries(
		Object.entries(
			objectEntries(
				isPlainObject(own?.layoutSettings)
					? own.layoutSettings.widgetStyles
					: undefined
			)
		).filter(([id]) => placed.has(id))
	)
	return {
		...arrangement,
		...(Object.keys(settings).length ? { widgetSettings: settings } : {}),
		...(Object.keys(pins).length ? { widgetStyles: pins } : {})
	}
}

/**
 * Record that this session's layout **started from** a preset it was just
 * saved INTO, at `at` — the instant the preset's layout was written (or, for
 * a re-capture that changed nothing, now: later than its `layout_updated_at`
 * either way), so the session never reads its own save as **Updated**. The
 * session's layout itself is not written: Done (`:set`) owns it, and the page
 * commits before it saves. A person with no row yet gets one holding the
 * sent arrangement.
 */
async function markStartedFrom(
	tx: Db,
	from: SavedFrom,
	layoutPresetId: number,
	at: Date
): Promise<void> {
	const provenance = { startedFromLayoutPresetId: layoutPresetId, layoutCopiedAt: at }
	await tx
		.insert(schema.sessionPanelLayouts)
		.values({
			sessionId: from.sessionId,
			userId: from.userId,
			layout: arrangementOf(from.layout),
			...provenance
		})
		.onConflictDoUpdate({
			target: [
				schema.sessionPanelLayouts.userId,
				schema.sessionPanelLayouts.sessionId
			],
			set: { ...provenance, updatedAt: at }
		})
}

/** A shipped layout asked to be re-captured. */
export const LAYOUT_PRESET_BUILT_IN_UPDATE =
	"Built-in layouts can't be changed — save a copy instead."

/**
 * **Save changes to "*Name*"** (owner L3/L4; brief 6a): re-capture this
 * session's layout into one of the caller's own session layout presets, packed
 * exactly as **Save as new layout** packs it (`packSessionLayout`), and make
 * it what this session **started from**. One transaction.
 *
 * - Behind the manage gate (`manageablePreset`: the author, or an admin on a
 *   shared row; a shipped row is nobody's), then the session's genre: a
 *   layout of another genre is answered as unknown, because it was never in
 *   this session's list.
 * - `layout_updated_at` moves only when the packed layout differs from the
 *   stored one (`sameLayout`), so every OTHER session that started from it
 *   reads **Updated** only when there is something new to start again from.
 * - The session's `layout_copied_at` is stamped either way, at the same
 *   instant as a change, so this session does not read its own save as
 *   **Updated**.
 * - A packed layout the app cannot draw (`drawable`) is refused, and the row
 *   keeps what it had.
 * - **Never silently over an Updated layout** (brief 6b): when this session
 *   started from this row and reads it as **Updated** — changes were saved
 *   into it since this session copied it, from another session or by an
 *   admin — the save is refused (`LAYOUT_PRESET_UPDATED_SINCE`) unless the
 *   person was asked and said to save over them (`overwriteUpdated`).
 *   Nothing moves on the refusal. Checked inside the transaction, so a save
 *   racing the other one cannot slip past it.
 * - `moved` says whether `layout_updated_at` moved, so the caller tells the
 *   sessions that now read **Updated** (`sessions/startedFromPush.ts`).
 */
export async function saveChangesToLayout(args: {
	presetId: number
	sessionId: number
	genreId: string
	userId: number
	isAdmin?: boolean
	layout: SessionLayoutBlob
	drawnWidgetIds: readonly string[]
	/** The person was told the row changed since this session copied it, and said save over it. */
	overwriteUpdated?: boolean
}): Promise<
	| {
			ok: true
			preset: LayoutPresetWire
			startedFromLayoutPresetId: number
			layoutCopiedAt: Date
			/** `layout_updated_at` moved: other sessions that started from it now read Updated. */
			moved: boolean
	  }
	| Refused
> {
	if (!isPlainObject(args.layout)) return { ok: false, error: "Invalid layout" }
	const at = new Date()
	const outcome = await db.transaction(
		async (tx): Promise<{ ok: true; row: PresetRow; moved: boolean } | Refused> => {
			const found = await manageablePreset(
				args.presetId,
				{ id: args.userId, isAdmin: args.isAdmin },
				LAYOUT_PRESET_BUILT_IN_UPDATE,
				"change",
				tx
			)
			if (!found.ok) return found
			if (found.row.genreId !== args.genreId)
				return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
			if (
				!args.overwriteUpdated &&
				(await readsUpdated(tx, args, found.row))
			)
				return { ok: false, error: LAYOUT_PRESET_UPDATED_SINCE }
			const layout = await packSessionLayout(tx, args)
			if (!drawable(layout, "save"))
				return { ok: false, error: LAYOUT_PRESET_CANT_SAVE }
			let row = found.row
			let moved = false
			if (!sameLayout(found.row.layout, layout)) {
				// The predicate is restated on the write, as every manage verb's is.
				const [written] = await tx
					.update(schema.sessionLayoutPresets)
					.set({ layout, layoutUpdatedAt: at })
					.where(manageWrite(args.presetId, found.row, args.userId))
					.returning()
				if (!written) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
				row = written
				moved = true
			}
			await markStartedFrom(tx, args, row.id, at)
			return { ok: true, row, moved }
		}
	)
	if (!outcome.ok) return outcome
	return {
		ok: true,
		preset: await wireRow(outcome.row, args.userId),
		startedFromLayoutPresetId: outcome.row.id,
		layoutCopiedAt: at,
		moved: outcome.moved
	}
}

/**
 * Does this session read the row it is saving into as **Updated** — it
 * started from that row, and the row's `layout_updated_at` is later than
 * the session's `layout_copied_at`? (`startedFromUpdated`'s rule, asked of
 * the stored row inside the save's transaction.) A session that started from
 * another row, or has no row yet, is not overwriting anything it copied.
 */
async function readsUpdated(
	tx: Db,
	from: SavedFrom,
	row: PresetRow
): Promise<boolean> {
	const [own] = await tx
		.select({
			startedFromLayoutPresetId: schema.sessionPanelLayouts.startedFromLayoutPresetId,
			layoutCopiedAt: schema.sessionPanelLayouts.layoutCopiedAt
		})
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, from.sessionId),
				eq(schema.sessionPanelLayouts.userId, from.userId)
			)
		)
		.limit(1)
	if (!own || own.startedFromLayoutPresetId !== row.id || !own.layoutCopiedAt)
		return false
	return new Date(row.layoutUpdatedAt).getTime() > own.layoutCopiedAt.getTime()
}
/* ── managing what you saved ────────────────────────────────────────────
 * Managing a preset is a NARROWER permission than seeing one, and the matrix
 * is `layoutPermissions.ts` — this half only turns its answers into the
 * sentences a person reads. Core's and a plugin's rows are the reconcilers'
 * and nobody else's, however senior the asker; a shared row is its author's
 * and an admin's; a private one is its author's alone.
 */

/**
 * What a foreign, missing, or unusable id is refused with. One sentence for
 * all, so the id space cannot be walked. Worded for the screen — the page
 * shows it verbatim, and on screen it is a layout, never a "preset"
 * (NOMENCLATURE §9) — and for its commonest cause: a card someone else
 * stopped sharing or deleted while it was still on this person's list.
 */
export const LAYOUT_PRESET_UNKNOWN = "That layout isn't available."
/** …and what a shipped default is refused with, per verb. */
export const LAYOUT_PRESET_BUILT_IN_RENAME =
	"Built-in layouts can't be renamed — save a copy instead."
export const LAYOUT_PRESET_BUILT_IN_DELETE =
	"Built-in layouts can't be deleted."
export const LAYOUT_PRESET_BUILT_IN_SHARE =
	"Built-in layouts are already shared with everyone."
/** Shared with the save path's own check; a rename may not blank a name. */
export const LAYOUT_PRESET_NEEDS_NAME = "A layout needs a name."
/** A guest may keep and edit their own layouts; publishing one is not theirs. */
export const LAYOUT_PRESET_GUEST_NO_SHARE =
	"You can use and save your own layouts, but not share one with the pub."
/**
 * **Save changes to** from a session that reads its layout as **Updated**,
 * unasked: saving would overwrite what was saved into it since this session
 * copied it (brief 6b). The page asks first and names the other way out.
 */
export const LAYOUT_PRESET_UPDATED_SINCE =
	"That layout has changed since this session copied it. Start again from it, or save over those changes."
/** A layout a person saves (Save as new, Save changes to) that the app cannot draw. */
export const LAYOUT_PRESET_CANT_SAVE =
	"This layout can't be saved: part of it isn't in a shape the app can draw."
/** …and a stored one (saved before saves were checked) asked to be shared. */
export const LAYOUT_PRESET_CANT_SHARE =
	"This layout can't be shared: part of it isn't in a shape the app can draw."

/**
 * Is this a session layout the app can draw: no `validateSessionLayout`
 * ERROR (a slot of the wrong shape, an id that is no widget instance id, an
 * instance in two zones…)? The check plugin layouts already pass at install,
 * now asked of what people save and share, because a saved layout is copied
 * verbatim into other sessions — and, shared, into other people's. Warnings
 * (an unknown widget draws a placeholder, a key readers ignore) never refuse.
 * The errors go to the log; the person reads one plain sentence.
 */
function drawable(layout: unknown, verb: "save" | "share"): boolean {
	const verdict = validateSessionLayout(layout)
	if (!verdict.ok)
		console.warn(
			`session layout preset: refused to ${verb} a layout the app cannot draw — ${verdict.errors.join("; ")}`
		)
	return verdict.ok
}

/** A refused manage attempt — the sentence is the whole result. */
type Refused = { ok: false; error: string }

/**
 * The one ownership gate behind rename, re-capture, share, delete and usage.
 *
 * The order of the checks is a PRIVACY order, not a logical one: a row that
 * belongs to somebody else, or that a withdrawn plugin left behind, is refused
 * with the EXACT sentence a row that does not exist gets, so the id space
 * cannot be walked to learn what other people have saved. Only rows the caller
 * can already see — the shipped ones, which everybody sees, and the shared ones
 * — earn a distinct, more helpful refusal.
 */
async function manageablePreset(
	presetId: number,
	actor: LayoutActor,
	builtInError: string,
	verb: "change" | "delete" = "change",
	handle: Db = db
): Promise<{ ok: true; row: PresetRow } | Refused> {
	// The id arrives off the wire: a non-integer would reach the driver as a
	// malformed comparison rather than a miss.
	if (!Number.isInteger(presetId))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	const [row] = await handle
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, presetId))
		.limit(1)
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	// Withdrawn is "not there", not "not yours": the plugin is gone for now.
	if (row.withdrawnAt) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	// Shipped is visible to all, editable by none. Also catches the row that
	// should not exist — authored AND seed-keyed — because letting its author
	// rename or delete it would hand a user the reconciler's private key.
	if (row.origin !== "user" || row.seedKey !== null)
		return { ok: false, error: builtInError }
	if (canManage(row, actor)) return { ok: true, row }
	// Not theirs. A private row is answered as absent; a shared one is a real
	// object they can see, so it gets the real reason.
	if (!canSee(row, actor)) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return {
		ok: false,
		error: `Only the owner or an admin can ${verb} a shared layout.`
	}
}

/**
 * Rename one of the caller's own presets. The name is trimmed and capped the
 * same way `saveUserLayoutPreset` caps it, so the two paths cannot disagree
 * about what a stored name may be.
 */
export async function renameUserLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
	name: string
}): Promise<{ ok: true; preset: LayoutPresetWire } | Refused> {
	const name = cleanName(args.name)
	if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_RENAME
	)
	if (!found.ok) return found
	// The predicate is restated on the write rather than trusted from the read:
	// the gate above cannot hold a row still, and a rename that lands on a row
	// the gate did not approve is the one failure worth making impossible.
	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set({ name })
		.where(manageWrite(args.presetId, found.row, args.userId))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: await wireRow(row, args.userId) }
}

/**
 * The predicate every approved write restates: this id, still a user row, still
 * its author's, still without a seed key — and, when the caller is NOT the
 * author (an admin, whom the gate lets manage only a shared row), still
 * shared. The gate read the row; this makes the write land on the same row
 * the gate approved, in the state it approved, and on no other: an author
 * taking a row private between an admin's gate and write leaves the write
 * with nothing to land on. Exported for its test.
 */
export function manageWrite(
	presetId: number,
	row: PresetRow,
	actorId: number
): SQL | undefined {
	return and(
		eq(schema.sessionLayoutPresets.id, presetId),
		eq(schema.sessionLayoutPresets.origin, "user"),
		eq(
			schema.sessionLayoutPresets.authorUserId,
			row.authorUserId as number
		),
		isNull(schema.sessionLayoutPresets.seedKey),
		row.authorUserId === actorId
			? undefined
			: eq(schema.sessionLayoutPresets.visibility, "shared")
	)
}

/**
 * How many session layouts **started from** a preset: `session_panel_layouts`
 * rows naming it in `layout_preset_id`. Provenance only — each holds its own
 * copy, so nothing about them depends on the preset.
 */
async function startedFromCount(presetId: number): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(schema.sessionPanelLayouts)
		.where(
			eq(schema.sessionPanelLayouts.startedFromLayoutPresetId, presetId)
		)
	return Number(row?.n ?? 0)
}

/** How many people use a preset as a **new-session layout** (`user_layout_defaults`). */
async function newSessionLayoutUserCount(presetId: number): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(schema.userLayoutDefaults)
		.where(eq(schema.userLayoutDefaults.layoutPresetId, presetId))
	return Number(row?.n ?? 0)
}

/**
 * Delete one of the caller's own presets, reporting how many sessions had
 * started from it.
 *
 * Deleting changes no session's layout: each holds its own copy (the copy
 * model). `layout_preset_id` is `ON DELETE SET NULL` on both
 * `session_panel_layouts` and `user_layout_defaults`, so a session only loses
 * its "started from" label, and a person whose new-session layout it was gets
 * the genre default layout at their next first open. The count is taken
 * FIRST: after the delete the FK has already erased the evidence.
 */
export async function deleteUserLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
}): Promise<
	| {
			ok: true
			id: number
			genreId: string
			affectedSessions: number
			/** What it was: a shared one was on other people's lists too. */
			visibility: "shared" | "private"
	  }
	| Refused
> {
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_DELETE,
		"delete"
	)
	if (!found.ok) return found
	const affectedSessions = await startedFromCount(args.presetId)
	// Restated for the same reason as the rename's — see above.
	const deleted = await db
		.delete(schema.sessionLayoutPresets)
		.where(manageWrite(args.presetId, found.row, args.userId))
		.returning({ id: schema.sessionLayoutPresets.id })
	if (!deleted.length) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return {
		ok: true,
		id: args.presetId,
		genreId: found.row.genreId,
		affectedSessions,
		visibility: found.row.visibility === "shared" ? "shared" : "private"
	}
}

/**
 * What the delete confirmation says about one of the caller's own presets:
 * how many sessions started from it (they keep their layout), and how many
 * people use it for new sessions (they get the genre default layout instead).
 * Behind the same gate as the delete it precedes, so the counts can never
 * answer for a preset the asker could not delete anyway.
 */
export async function layoutPresetUsage(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
}): Promise<
	| { ok: true; id: number; sessions: number; newSessionLayoutUsers: number }
	| Refused
> {
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_DELETE,
		"delete"
	)
	if (!found.ok) return found
	return {
		ok: true,
		id: args.presetId,
		sessions: await startedFromCount(args.presetId),
		newSessionLayoutUsers: await newSessionLayoutUserCount(args.presetId)
	}
}

/**
 * Publish one of the caller's own presets to the instance, or take it back.
 *
 * Taking a shared row private touches nobody else's row: a session that names
 * it keeps its `layout_preset_id`, and the row simply stops answering for
 * everyone but the author — the same degradation a deleted preset gives.
 *
 * Publishing asks two things taking private does not: the guest rule
 * (`canShare`), and that the stored layout is one the app can draw
 * (`drawable`) — it is about to reach every account, and a row saved before
 * saves were checked may not be. Taking a layout private is never publishing:
 * the manage gate is enough, whoever is a guest where.
 *
 * `genreId` is the genre of the session the share is reached through (the
 * socket always passes it): a layout of another genre was never in that
 * session's list, so it is answered as unknown.
 */
export async function shareLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
	isGuest?: boolean
	genreId?: string
	visibility: LayoutVisibility
}): Promise<{ ok: true; preset: LayoutPresetWire } | Refused> {
	if (args.visibility !== "shared" && args.visibility !== "private")
		return { ok: false, error: "A layout can only be private or shared." }
	const actor: LayoutActor = {
		id: args.userId,
		isAdmin: args.isAdmin,
		isGuest: args.isGuest
	}
	const found = await manageablePreset(
		args.presetId,
		actor,
		LAYOUT_PRESET_BUILT_IN_SHARE
	)
	if (!found.ok) return found
	if (args.genreId !== undefined && found.row.genreId !== args.genreId)
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	if (args.visibility === "shared") {
		if (!canShare(found.row, actor))
			return { ok: false, error: LAYOUT_PRESET_GUEST_NO_SHARE }
		if (!drawable(found.row.layout, "share"))
			return { ok: false, error: LAYOUT_PRESET_CANT_SHARE }
	}

	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set({ visibility: args.visibility })
		.where(manageWrite(args.presetId, found.row, args.userId))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: await wireRow(row, args.userId) }
}

/**
 * Copy any preset the caller can SEE into a new private row of their own.
 *
 * Seeing it is the whole permission, because the copy SNAPSHOTS the layout
 * and the description and keeps no reference back: the original moving does
 * not move the copy, and nothing is taken from its owner. This is how a
 * built-in becomes editable.
 */
export async function cloneLayoutPreset(args: {
	presetId: number
	userId: number
	name?: string
}): Promise<{ ok: true; preset: LayoutPresetWire } | Refused> {
	if (!Number.isInteger(args.presetId))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	const [source] = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, args.presetId))
		.limit(1)
	const actor: LayoutActor = { id: args.userId }
	if (!source || !canSee(source, actor))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }

	// A blank name is no name: the copy takes the "(copy)" default.
	const name = cleanName(args.name) || copyName(source.name)
	if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
	const row = await insertUserPreset(source.genreId, args.userId, {
		name,
		description: source.description ?? null,
		layout: source.layout ?? {}
	})
	return { ok: true, preset: await wireRow(row, args.userId) }
}
