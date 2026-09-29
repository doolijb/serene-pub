/**
 * The `session_layout_presets` table's server module: the core seed
 * reconciler, the reads a session's layout is answered from, and the verbs a
 * person manages their own **session layout presets** with (save, rename,
 * re-capture, share, clone, delete).
 *
 * Every row stores ONE format, the **session layout** (NOMENCLATURE §9): the
 * live blob the screen draws, `{ zoneLayout?, widgetGrid?, arrangedGrid?,
 * widgetSettings? }`, verbatim in `layout`. The retired layout document
 * (LayoutDoc v2) and its columns are gone (plan
 * `PLAN-layout-one-format-2026-09-28`, brief 2).
 *
 * Seeds one shipped **genre default layout** per genre and prunes the defaults
 * of genres it is syncing whose seed key is no longer shipped — the same "seed
 * the defaults, remove defaults no longer in the list" pass `widgetStyles.ts`
 * runs for widget skins, which this deliberately mirrors statement for
 * statement. Runs on boot, right after the pipeline specs the genre list is
 * read from.
 *
 * ## The upgrade-safety landmine (why this looks the way it does)
 *
 * The codified seed rule (see defaults.ts) is: match on a natural key, NEVER on
 * a numeric id, and never let a seed touch a user row. Both invariants are
 * enforced structurally rather than by care:
 *
 *   • Upsert and prune both match on `seed_key` (`layout:<genreId>:default`),
 *     and every write additionally requires `author_user_id IS NULL`. A
 *     user-authored preset carries `seed_key = NULL` and an author, so it fails
 *     BOTH predicates — it is invisible to every statement below, and cannot be
 *     overwritten or pruned by a reseed even if it somehow shared a key.
 *   • Rows are inserted with NO explicit id — the identity sequence assigns one —
 *     so there is no id collision with user rows and no `resyncIdSequences` need.
 *
 * ## Why most shipped defaults are an EMPTY layout
 *
 * `{}` means "no overrides", which is precisely what the client renders when a
 * user has saved nothing: the app's own built-in arrangement. A genre may
 * nevertheless ship an arrangement (`SeedableGenre.layout`), and the core
 * genres with a surface of their own do (Adventure's world strip above the
 * conversation, the party docked down the right). ⏳ Until the copy model
 * lands (brief 3) a session's own slots are still drawn over this row's
 * (`$lib/shared/sessionLayout/presets`).
 *
 * ## Prune scope
 *
 * Confined to the genre ids actually being synced, exactly as widgetStyles
 * confines itself to the widget ids it processed. A genre that has gone away
 * (a plugin disabled between boots) is NOT in scope, so its default survives
 * rather than being deleted out from under the `layout_preset_id` references
 * pointing at it — those would be silently nulled by the FK's `ON DELETE SET
 * NULL`, quietly resetting people's choices. An orphaned default is harmless:
 * nothing lists it, because nothing lists that genre.
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
	or,
	type SQL
} from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import {
	DEFAULT_PRESET_NAME,
	layoutPresetSeedKey
} from "$lib/shared/sessionLayout/presets"
import {
	canManage,
	canSee,
	canShare,
	type LayoutActor
} from "./layoutPermissions"
import { getGenre, i18nText } from "@serene-pub/sdk"
import type { GenreLayoutDecl } from "@serene-pub/sdk"

/** Who may see a row. Core and plugin rows are always `shared`. */
export type LayoutVisibility = "shared" | "private"

/** A session layout, as every `layout` column stores it: verbatim JSON. */
type SessionLayoutBlob = Record<string, unknown>

/** The genres to seed a default preset for. */
export interface SeedableGenre {
	genreId: string
	/**
	 * The preset's name. Absent means the name the core genre declares for its
	 * first layout, else `Default`.
	 *
	 * A genre that ships an arrangement of its own gets to name it — "Adventure"
	 * rather than "Default" — because the presets list shows it beside a user's
	 * own saved layouts, and "Default" there reads as "no layout" when it is in
	 * fact the genre's whole intended surface.
	 */
	name?: string
	/**
	 * The **session layout** this genre ships, verbatim. Absent means `{}` —
	 * "no overrides", i.e. the app's own built-in layout, which is what keeps
	 * the preset system inert for every genre that does not ship one (see the
	 * header).
	 */
	layout?: SessionLayoutBlob
}

/** What a reseed stamps on the rows it wrote, and which app version wrote them. */
export interface SyncLayoutPresetsOptions {
	/** Provenance for `seeded_by_version`, as `syncWidgetStyles` takes it. */
	version?: string
}

/**
 * Reconcile the shipped per-genre default presets against
 * `session_layout_presets`. Idempotent: safe to run every boot.
 *
 * A row's `layout` comes from `SeedableGenre.layout` (the boot task passes
 * core-catalog's `CORE_LAYOUT_PRESETS`), and its name from the entry, else
 * the core genre's declared first layout, else `Default`.
 */
export async function syncLayoutPresets(
	genres: SeedableGenre[],
	options: SyncLayoutPresetsOptions = {}
): Promise<void> {
	// De-duplicate: the genre list unions create-spec genres with transitional
	// input-type genres, and `seed_key` is globally unique — a repeated genre id
	// would make the second insert collide.
	const genreIds = [...new Set(genres.map((g) => g.genreId).filter(Boolean))]
	const shippedKeys = genreIds.map(layoutPresetSeedKey)
	// Last wins, so a caller that unions a genre list with a shipped one may
	// pass the bare id first and the furnished entry after it. Deduplicating on
	// the id above and looking the content up here keeps those two facts apart:
	// which genres exist, and what each one ships.
	const byGenre = new Map(
		genres.filter((g) => g.genreId).map((g) => [g.genreId, g])
	)

	// Every row already holding a seed key — authored ones INCLUDED, because
	// `seed_key` is globally unique. Nothing in the app ever gives a user row a
	// seed key (the save path writes NULL), but if one somehow held a shipped
	// key, filtering it out here would send us down the insert branch and the
	// unique constraint would abort the boot seed. Reading it and skipping is
	// both crash-proof and the stronger reading of "never touch a user row".
	const existing = await db
		.select({
			id: schema.sessionLayoutPresets.id,
			seedKey: schema.sessionLayoutPresets.seedKey,
			origin: schema.sessionLayoutPresets.origin,
			authorUserId: schema.sessionLayoutPresets.authorUserId
		})
		.from(schema.sessionLayoutPresets)
		.where(isNotNull(schema.sessionLayoutPresets.seedKey))
	const existingByKey = new Map(existing.map((r) => [r.seedKey as string, r]))

	const writes: Promise<unknown>[] = []
	for (const genreId of genreIds) {
		const seedKey = layoutPresetSeedKey(genreId)
		const found = existingByKey.get(seedKey)
		// A row someone authored is not ours to re-force, whatever key it holds.
		if (found && found.authorUserId !== null) continue
		// …nor is a plugin's. A plugin's seed keys are namespaced
		// (`layout:<genreId>:<pluginId>/<slug>`) so one cannot collide with a
		// genre default's key, but the scope is stated rather than inferred.
		if (found && found.origin === "plugin") continue
		const shipped = byGenre.get(genreId)
		const name =
			shipped?.name ?? (await coreLayoutName(genreId)) ?? DEFAULT_PRESET_NAME
		const layout = shipped?.layout ?? {}
		const shippedFields = {
			genreId,
			origin: "core" as const,
			pluginId: null,
			withdrawnAt: null,
			slug: DEFAULT_LAYOUT_SLUG,
			name,
			visibility: "shared" as const,
			layout,
			seededByVersion: options.version ?? null
		}
		if (!found) {
			writes.push(
				db.insert(schema.sessionLayoutPresets).values({
					// NO id — the sequence assigns one (seed rule).
					seedKey,
					authorUserId: null,
					...shippedFields
				})
			)
		} else {
			// Re-force the shipped fields; never the id, never the author.
			writes.push(
				db
					.update(schema.sessionLayoutPresets)
					.set(shippedFields)
					.where(
						and(
							eq(schema.sessionLayoutPresets.seedKey, seedKey),
							isNull(schema.sessionLayoutPresets.authorUserId)
						)
					)
			)
		}
	}
	await Promise.all(writes)

	// Prune: seeded defaults for the genres we just synced whose key is gone
	// (a row left by an older key scheme). Scoped to author-less, seed-keyed,
	// `origin = 'core'` rows AND to the genre ids actually processed, so a
	// plugin's rows, another genre's default and every user row are untouched.
	// The early return only saves a round trip: `inArray` over an empty list
	// already matches nothing, so an empty genre set could not delete anything
	// even without it.
	if (genreIds.length) {
		await db
			.delete(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.origin, "core"),
					isNull(schema.sessionLayoutPresets.authorUserId),
					isNotNull(schema.sessionLayoutPresets.seedKey),
					inArray(schema.sessionLayoutPresets.genreId, genreIds),
					notInArray(schema.sessionLayoutPresets.seedKey, shippedKeys)
				)
			)
	}
}

/** The slug the genre's own layout holds — reserved to the genre's owner. */
export const DEFAULT_LAYOUT_SLUG = "default"

/**
 * The layout a CORE genre declares first (`GenreDecl.layouts[0]`, the
 * genre's default — R71). Read for its NAME only: core's arrangement arrives
 * as a session layout through `SeedableGenre.layout`. Core's genres register
 * when the catalog is imported, which is why the import comes first; a
 * plugin's genre is its own sync's business (./pluginLayouts), never this
 * reconciler's.
 */
async function coreGenreLayout(
	genreId: string
): Promise<GenreLayoutDecl | null> {
	if (!genreId.startsWith("core:")) return null
	await import("@serene-pub/core-catalog")
	return getGenre(genreId)?.layouts?.[0] ?? null
}

/** The name a core genre ships its default layout under. */
async function coreLayoutName(genreId: string): Promise<string | null> {
	return i18nText((await coreGenreLayout(genreId))?.name) ?? null
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

/**
 * Row → wire. `seedKey` is deliberately not published: it is the reconciler's
 * private matching key, and a client that could read it would be one edit away
 * from being able to send one.
 *
 * Spelled out field by field, so a column added later never joins the wire
 * silently.
 */
function toWire(row: PresetRow): LayoutPresetWire {
	return {
		id: row.id,
		name: row.name,
		genreId: row.genreId,
		// Not the caller's to manage: core's and a plugin's rows.
		isDefault: row.authorUserId === null,
		layout: row.layout && typeof row.layout === "object" ? row.layout : {}
	}
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

/** The rank a row lists at: core, then plugins, then people's own. */
const ORIGIN_ORDER: Record<string, number> = { core: 0, plugin: 1, user: 2 }

/**
 * The presets a user may choose from for a genre: the shipped ones first, then
 * their own and the instance's shared ones, oldest first (creation order — a
 * stable list that doesn't reshuffle when someone renames one).
 */
export async function listLayoutPresets(
	genreId: string,
	userId: number
): Promise<LayoutPresetWire[]> {
	const rows = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(visibleTo(genreId, userId))
	return rows
		.slice()
		.sort((a, b) => {
			const ao = ORIGIN_ORDER[a.origin] ?? 2
			const bo = ORIGIN_ORDER[b.origin] ?? 2
			return ao !== bo ? ao - bo : a.id - b.id
		})
		.map(toWire)
}

/**
 * Is this preset one the caller may apply to this session? The guard behind
 * `layoutPresetId` on the write path: a preset must belong to the session's
 * genre AND be one the caller can see. Without it, any id at all could be
 * pinned into another user's row, which would then resolve and render a
 * stranger's layout.
 */
export async function canApplyLayoutPreset(
	presetId: number,
	genreId: string,
	userId: number
): Promise<boolean> {
	if (!Number.isInteger(presetId)) return false
	const [row] = await db
		.select({ id: schema.sessionLayoutPresets.id })
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.id, presetId),
				visibleTo(genreId, userId)
			)
		)
		.limit(1)
	return !!row
}

/**
 * ⏳ The `layout` of the preset a session is drawn over, already through its
 * whole fallback chain: the pinned preset if it still resolves for this
 * caller, else the genre's shipped default, else `{}`. Brief 3's copy model
 * retires it: a session's own row becomes the whole layout.
 *
 * `{}` is not a failure mode — it is what the shipped default itself carries,
 * and it composes to "no base at all" (see `presetBase`), which is exactly what
 * every session rendered before presets existed.
 */
export async function resolveActivePresetLayout(
	genreId: string,
	userId: number,
	layoutPresetId: number | null
): Promise<Record<string, unknown>> {
	if (layoutPresetId != null) {
		const [pinned] = await db
			.select({ layout: schema.sessionLayoutPresets.layout })
			.from(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.id, layoutPresetId),
					visibleTo(genreId, userId)
				)
			)
			.limit(1)
		if (pinned?.layout && typeof pinned.layout === "object")
			return pinned.layout as Record<string, unknown>
	}
	const [fallback] = await db
		.select({ layout: schema.sessionLayoutPresets.layout })
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(
					schema.sessionLayoutPresets.seedKey,
					layoutPresetSeedKey(genreId)
				),
				isNull(schema.sessionLayoutPresets.authorUserId)
			)
		)
		.limit(1)
	return fallback?.layout && typeof fallback.layout === "object"
		? (fallback.layout as Record<string, unknown>)
		: {}
}

/** The longest a user-supplied preset name may be. */
export const LAYOUT_PRESET_NAME_MAX = 80

/** The longest a description may be. One line about a layout, not an essay. */
export const LAYOUT_PRESET_DESCRIPTION_MAX = 400

/** The name, trimmed and bounded; the description likewise, or null. */
const cleanName = (name: unknown): string =>
	typeof name === "string" ? name.trim().slice(0, LAYOUT_PRESET_NAME_MAX) : ""
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
	genreId: string,
	userId: number,
	name: string
): Promise<string> {
	const base = layoutSlugFrom(name)
	const taken = new Set(
		(
			await db
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
}

/**
 * Insert one user row, retrying its slug once if a concurrent save took it.
 *
 * `seedKey` is unconditionally NULL, `origin` unconditionally `user` and
 * `authorUserId` unconditionally the caller: the three facts that keep
 * everything saved here outside both reconcilers' reach forever.
 */
async function insertUserPreset(
	genreId: string,
	userId: number,
	content: UserPresetContent,
	visibility: LayoutVisibility = "private"
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
	const slug = await freeUserSlug(genreId, userId, content.name)
	try {
		const [row] = await db
			.insert(schema.sessionLayoutPresets)
			.values({ ...values, slug })
			.returning()
		return row
	} catch {
		// The unique index is the authority, not the read above it. One retry
		// with a slug nothing can have raced us to. Anything that was NOT a
		// slug collision fails the same way twice, and the second throw is the
		// one the caller sees — untouched, so a real fault still reads as one.
		const [row] = await db
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
 * Save the caller's session layout as a new user-authored preset. The row is
 * private, and its slug is taken from the name.
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
	return toWire(row)
}
/* ── managing what you saved ────────────────────────────────────────────
 * Managing a preset is a NARROWER permission than seeing one, and the matrix
 * is `layoutPermissions.ts` — this half only turns its answers into the
 * sentences a person reads. Core's and a plugin's rows are the reconcilers'
 * and nobody else's, however senior the asker; a shared row is its author's
 * and an admin's; a private one is its author's alone.
 */

/** What a foreign, missing, or unusable id is refused with. One sentence for all. */
export const LAYOUT_PRESET_UNKNOWN = "Unknown layout preset"
/** …and what a shipped default is refused with, per verb. */
export const LAYOUT_PRESET_BUILT_IN_RENAME =
	"Built-in layouts can't be renamed — save a copy instead."
export const LAYOUT_PRESET_BUILT_IN_DELETE =
	"Built-in layouts can't be deleted."
export const LAYOUT_PRESET_BUILT_IN_SHARE =
	"Built-in layouts are already shared with everyone."
/** Shared with the save path's own check; a rename may not blank a name. */
export const LAYOUT_PRESET_NEEDS_NAME = "A preset needs a name"
/** A guest may keep and edit their own layouts; publishing one is not theirs. */
export const LAYOUT_PRESET_GUEST_NO_SHARE =
	"You can use and save your own layouts, but not share one with the instance."

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
	verb: "change" | "delete" = "change"
): Promise<{ ok: true; row: PresetRow } | Refused> {
	// The id arrives off the wire: a non-integer would reach the driver as a
	// malformed comparison rather than a miss.
	if (!Number.isInteger(presetId))
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	const [row] = await db
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
		.where(manageWrite(args.presetId, found.row))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: toWire(row) }
}

/**
 * The predicate every approved write restates: this id, still a user row, still
 * its author's, still without a seed key. The gate read the row; this makes the
 * write land on the same row the gate approved and on no other.
 */
function manageWrite(presetId: number, row: PresetRow): SQL | undefined {
	return and(
		eq(schema.sessionLayoutPresets.id, presetId),
		eq(schema.sessionLayoutPresets.origin, "user"),
		eq(
			schema.sessionLayoutPresets.authorUserId,
			row.authorUserId as number
		),
		isNull(schema.sessionLayoutPresets.seedKey)
	)
}

/** How many `session_panel_layouts` rows name a preset (`layout_preset_id`). */
async function pinnedSessionCount(presetId: number): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(schema.sessionPanelLayouts)
		.where(
			eq(schema.sessionPanelLayouts.startedFromLayoutPresetId, presetId)
		)
	return Number(row?.n ?? 0)
}

/**
 * Delete one of the caller's own presets, reporting how many sessions were on
 * it.
 *
 * Nothing is stranded and nothing cascades away: `layout_preset_id` is
 * `ON DELETE SET NULL` on both `session_panel_layouts` and
 * `user_layout_defaults`, so a session that was pinned to this preset — and a
 * person who defaulted to it — quietly falls back to the genre default layout with their
 * own layout blob and widget settings untouched. That is the intended
 * behaviour, which is exactly why the count is taken FIRST: after the delete
 * the FK has already erased the evidence, and a client that wants to warn
 * before the fact has nothing to warn with.
 */
export async function deleteUserLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
}): Promise<
	| { ok: true; id: number; genreId: string; affectedSessions: number }
	| Refused
> {
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_DELETE,
		"delete"
	)
	if (!found.ok) return found
	const affectedSessions = await pinnedSessionCount(args.presetId)
	// Restated for the same reason as the rename's — see above.
	const deleted = await db
		.delete(schema.sessionLayoutPresets)
		.where(manageWrite(args.presetId, found.row))
		.returning({ id: schema.sessionLayoutPresets.id })
	if (!deleted.length) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return {
		ok: true,
		id: args.presetId,
		genreId: found.row.genreId,
		affectedSessions
	}
}

/**
 * How many sessions are on one of the caller's own presets — what the delete
 * confirmation warns with. Behind the same gate as the delete it precedes, so
 * the count can never answer for a preset the asker could not delete anyway.
 */
export async function layoutPresetUsage(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
}): Promise<{ ok: true; id: number; sessions: number } | Refused> {
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
		sessions: await pinnedSessionCount(args.presetId)
	}
}

/**
 * Rename, re-describe or RE-CAPTURE one of the caller's own presets.
 *
 * A re-capture replaces the whole `layout` — arrangement, widget settings and
 * style pins together, because they are one statement about how the surface
 * looks. Omitting `layout` leaves it exactly as it was.
 */
export async function updateUserLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
	name?: string
	description?: string
	layout?: SessionLayoutBlob
}): Promise<{ ok: true; preset: LayoutPresetWire } | Refused> {
	const found = await manageablePreset(
		args.presetId,
		{ id: args.userId, isAdmin: args.isAdmin },
		LAYOUT_PRESET_BUILT_IN_RENAME
	)
	if (!found.ok) return found

	const patch: Partial<UserPresetContent> = {}
	if (args.name !== undefined) {
		const name = cleanName(args.name)
		if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
		patch.name = name
	}
	if (args.description !== undefined)
		patch.description = cleanDescription(args.description)
	if (args.layout !== undefined) {
		if (!args.layout || typeof args.layout !== "object")
			return { ok: false, error: "Invalid layout" }
		patch.layout = args.layout
	}
	if (!Object.keys(patch).length)
		return { ok: true, preset: toWire(found.row) }

	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set(patch)
		.where(manageWrite(args.presetId, found.row))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: toWire(row) }
}

/**
 * Publish one of the caller's own presets to the instance, or take it back.
 *
 * Taking a shared row private touches nobody else's row: a session that names
 * it keeps its `layout_preset_id`, and the row simply stops answering for
 * everyone but the author — the same degradation a deleted preset gives.
 */
export async function shareLayoutPreset(args: {
	presetId: number
	userId: number
	isAdmin?: boolean
	isGuest?: boolean
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
	if (!canShare(found.row, actor))
		return { ok: false, error: LAYOUT_PRESET_GUEST_NO_SHARE }

	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set({ visibility: args.visibility })
		.where(manageWrite(args.presetId, found.row))
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: toWire(row) }
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

	const name = cleanName(args.name ?? `${source.name} (copy)`)
	if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
	const row = await insertUserPreset(source.genreId, args.userId, {
		name,
		description: source.description ?? null,
		layout: source.layout ?? {}
	})
	return { ok: true, preset: toWire(row) }
}
