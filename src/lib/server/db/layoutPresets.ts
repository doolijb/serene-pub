/**
 * The `session_layout_presets` table's server module (PLAN 25 redesign,
 * 2026-08-30): the boot seed reconciler, plus the reads the socket handlers
 * resolve a session's active layout through.
 *
 * Seeds one shipped **default** preset per genre and prunes the defaults of
 * genres it is syncing whose seed key is no longer shipped — the same "seed the
 * defaults, remove defaults no longer in the list" pass `widgetStyles.ts` runs
 * for widget skins, which this deliberately mirrors statement for statement.
 * Runs on boot, right after the pipeline specs the genre list is read from.
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
 * ## Why the shipped default is an EMPTY layout — and the one exception
 *
 * `{}` means "no overrides", which is precisely what the client renders when a
 * user has saved nothing: the app's own built-in arrangement. That makes the
 * default preset a real, selectable row that means "the shipped layout" —
 * applying it clears your overrides — while keeping the preset system inert for
 * everyone who never touches it. See `$lib/shared/sessionLayout/presets` for
 * how the layers compose.
 *
 * A genre may nevertheless ship an arrangement (`SeedableGenre.layout`), and
 * the Adventure genre does: a world strip above the conversation, the party
 * docked down the right. That is a genre saying what its surface IS, which is
 * a different statement from a user saving one, and it still composes the same
 * way — under the user's own `layoutSettings` and under their own arrangement,
 * so anybody who has moved a panel keeps what they moved.
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
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	notInArray,
	or
} from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import {
	DEFAULT_PRESET_NAME,
	layoutPresetSeedKey
} from "$lib/shared/sessionLayout/presets"

/** The genres to seed a default preset for. */
export interface SeedableGenre {
	genreId: string
	/**
	 * The preset's name. Absent means `Default`.
	 *
	 * A genre that ships an arrangement of its own gets to name it — "Adventure"
	 * rather than "Default" — because the presets list shows it beside a user's
	 * own saved layouts, and "Default" there reads as "no layout" when it is in
	 * fact the genre's whole intended surface.
	 */
	name?: string
	/**
	 * The arrangement, verbatim. Absent means `{}` — "no overrides", i.e. the
	 * app's own built-in layout, which is what keeps the preset system inert for
	 * every genre that does not ship one (see the header).
	 */
	layout?: Record<string, unknown>
}

/**
 * Reconcile the shipped per-genre default presets against
 * `session_layout_presets`. Idempotent: safe to run every boot.
 */
export async function syncLayoutPresets(
	genres: SeedableGenre[]
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
		const shipped = byGenre.get(genreId)
		const name = shipped?.name ?? DEFAULT_PRESET_NAME
		const layout = shipped?.layout ?? {}
		if (!found) {
			writes.push(
				db.insert(schema.sessionLayoutPresets).values({
					// NO id — the sequence assigns one (seed rule).
					seedKey,
					genreId,
					authorUserId: null,
					name,
					layout
				})
			)
		} else {
			// Re-force the shipped fields; never the id, never the author.
			writes.push(
				db
					.update(schema.sessionLayoutPresets)
					.set({ genreId, name, layout })
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
	// (a row left by an older key scheme). Scoped to author-less, seed-keyed
	// rows AND to the genre ids actually processed, so another genre's default
	// and every user row are untouched. The early return only saves a round
	// trip: `inArray` over an empty list already matches nothing, so an empty
	// genre set could not delete anything even without it.
	if (genreIds.length) {
		await db
			.delete(schema.sessionLayoutPresets)
			.where(
				and(
					isNull(schema.sessionLayoutPresets.authorUserId),
					isNotNull(schema.sessionLayoutPresets.seedKey),
					inArray(schema.sessionLayoutPresets.genreId, genreIds),
					notInArray(schema.sessionLayoutPresets.seedKey, shippedKeys)
				)
			)
	}
}

/* ── reads ──────────────────────────────────────────────────────────────
 * Visibility is the simple rule the table's shape already implies: a caller
 * may see the shipped per-genre defaults (author-less) and their OWN saved
 * presets. Another user's presets are never listed, never resolvable, and
 * never applicable — enforced in the query, not by the caller remembering to
 * filter, because this is the only place that reads the table.
 */

/** The row shape the socket contract publishes. */
type LayoutPreset = Sockets.Sessions.LayoutPreset

/**
 * Row → wire. `seedKey` is deliberately not published: it is the reconciler's
 * private matching key, and a client that could read it would be one edit away
 * from being able to send one.
 */
function toWire(row: {
	id: number
	name: string
	genreId: string
	authorUserId: number | null
	layout: Record<string, unknown>
}): LayoutPreset {
	return {
		id: row.id,
		name: row.name,
		genreId: row.genreId,
		isDefault: row.authorUserId === null,
		layout: row.layout && typeof row.layout === "object" ? row.layout : {}
	}
}

/** `WHERE genre = … AND (seeded OR mine)` — the one visibility predicate. */
function visibleTo(genreId: string, userId: number) {
	return and(
		eq(schema.sessionLayoutPresets.genreId, genreId),
		or(
			isNull(schema.sessionLayoutPresets.authorUserId),
			eq(schema.sessionLayoutPresets.authorUserId, userId)
		)
	)
}

/**
 * The presets a user may choose from for a genre: the shipped default first,
 * then their own, oldest first (creation order — a stable list that doesn't
 * reshuffle when someone renames one).
 */
export async function listLayoutPresets(
	genreId: string,
	userId: number
): Promise<LayoutPreset[]> {
	const rows = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(visibleTo(genreId, userId))
	return rows
		.slice()
		.sort((a, b) => {
			const ad = a.authorUserId === null ? 0 : 1
			const bd = b.authorUserId === null ? 0 : 1
			return ad !== bd ? ad - bd : a.id - b.id
		})
		.map(toWire)
}

/**
 * Is this preset one the caller may apply to this session? The guard behind
 * `layoutPresetId` on the write path: a preset must belong to the session's
 * genre AND be either seeded or the caller's own. Without it, any id at all
 * could be pinned into another user's row, which would then resolve and render
 * a stranger's layout.
 */
export async function canApplyLayoutPreset(
	presetId: number,
	genreId: string,
	userId: number
): Promise<boolean> {
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
 * The layout of the preset a session is actually on, already through its whole
 * fallback chain: the pinned preset if it still resolves for this caller, else
 * the genre's shipped default, else `{}`.
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

/**
 * Save the caller's arrangement as a new user-authored preset.
 *
 * `seedKey` is unconditionally NULL and `authorUserId` unconditionally the
 * caller: the two facts that keep everything saved here outside the boot
 * reconciler's reach forever.
 */
export async function saveUserLayoutPreset(args: {
	genreId: string
	userId: number
	name: string
	layout: Record<string, unknown>
}): Promise<LayoutPreset> {
	const [row] = await db
		.insert(schema.sessionLayoutPresets)
		.values({
			seedKey: null,
			genreId: args.genreId,
			authorUserId: args.userId,
			name: args.name.trim().slice(0, LAYOUT_PRESET_NAME_MAX),
			layout: args.layout
		})
		.returning()
	return toWire(row)
}

/* ── managing what you saved ────────────────────────────────────────────
 * Managing a preset is a NARROWER permission than seeing one. The list a
 * caller reads mixes the shipped defaults with their own saves; only the rows
 * they authored are theirs to rename or delete. Admins are deliberately not a
 * superset — a person's saved layouts are their own business — so there is no
 * privilege parameter here for a caller to get wrong.
 */

/** What a foreign, missing, or unusable id is refused with. One sentence for all. */
export const LAYOUT_PRESET_UNKNOWN = "Unknown layout preset"
/** …and what a shipped default is refused with, per verb. */
export const LAYOUT_PRESET_BUILT_IN_RENAME =
	"Built-in layouts can't be renamed — save a copy instead."
export const LAYOUT_PRESET_BUILT_IN_DELETE =
	"Built-in layouts can't be deleted."
/** Shared with the save path's own check; a rename may not blank a name. */
export const LAYOUT_PRESET_NEEDS_NAME = "A preset needs a name"

/** A refused manage attempt — the sentence is the whole result. */
type Refused = { ok: false; error: string }

/**
 * The one ownership gate behind rename, delete and usage.
 *
 * The order of the checks is a privacy order, not a logical one: a row that
 * belongs to somebody else is refused with the EXACT sentence a row that does
 * not exist gets, so the id space cannot be walked to learn what other people
 * have saved. Only rows the caller can already see — the shipped defaults,
 * which everybody sees — earn a distinct, more helpful refusal.
 */
async function manageablePreset(
	presetId: number,
	userId: number,
	builtInError: string
): Promise<
	| {
			ok: true
			row: typeof schema.sessionLayoutPresets.$inferSelect
	  }
	| Refused
> {
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
	// Author-less is the shipped default: visible to all, editable by none.
	if (row.authorUserId === null) return { ok: false, error: builtInError }
	if (row.authorUserId !== userId)
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	// Authored AND seed-keyed should not exist — the save path writes NULL —
	// but if one ever did, letting its author rename or delete it would hand a
	// user the boot reconciler's private matching key. Treat it as shipped.
	if (row.seedKey !== null) return { ok: false, error: builtInError }
	return { ok: true, row }
}

/**
 * Rename one of the caller's own presets. The name is trimmed and capped the
 * same way `saveUserLayoutPreset` caps it, so the two paths cannot disagree
 * about what a stored name may be.
 */
export async function renameUserLayoutPreset(args: {
	presetId: number
	userId: number
	name: string
}): Promise<{ ok: true; preset: LayoutPreset } | Refused> {
	const name =
		typeof args.name === "string"
			? args.name.trim().slice(0, LAYOUT_PRESET_NAME_MAX)
			: ""
	if (!name) return { ok: false, error: LAYOUT_PRESET_NEEDS_NAME }
	const found = await manageablePreset(
		args.presetId,
		args.userId,
		LAYOUT_PRESET_BUILT_IN_RENAME
	)
	if (!found.ok) return found
	// The predicate is restated on the write rather than trusted from the read:
	// the gate above cannot hold a row still, and a rename that lands on a row
	// the gate did not approve is the one failure worth making impossible.
	const [row] = await db
		.update(schema.sessionLayoutPresets)
		.set({ name })
		.where(
			and(
				eq(schema.sessionLayoutPresets.id, args.presetId),
				eq(schema.sessionLayoutPresets.authorUserId, args.userId),
				isNull(schema.sessionLayoutPresets.seedKey)
			)
		)
		.returning()
	if (!row) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	return { ok: true, preset: toWire(row) }
}

/** How many `session_panel_layouts` rows are pinned to a preset. */
async function pinnedSessionCount(presetId: number): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(schema.sessionPanelLayouts)
		.where(eq(schema.sessionPanelLayouts.layoutPresetId, presetId))
	return Number(row?.n ?? 0)
}

/**
 * Delete one of the caller's own presets, reporting how many sessions were on
 * it.
 *
 * Nothing is stranded and nothing cascades away: `layout_preset_id` is
 * `ON DELETE SET NULL`, so a session that was pinned to this preset quietly
 * falls back to the genre default with its own layout blob and widget settings
 * untouched. That is the intended behaviour — which is exactly why the count is
 * taken FIRST: after the delete the FK has already erased the evidence, and a
 * client that wants to warn before the fact has nothing to warn with.
 */
export async function deleteUserLayoutPreset(args: {
	presetId: number
	userId: number
}): Promise<
	| { ok: true; id: number; genreId: string; affectedSessions: number }
	| Refused
> {
	const found = await manageablePreset(
		args.presetId,
		args.userId,
		LAYOUT_PRESET_BUILT_IN_DELETE
	)
	if (!found.ok) return found
	const affectedSessions = await pinnedSessionCount(args.presetId)
	// Restated for the same reason as the rename's — see above.
	const deleted = await db
		.delete(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.id, args.presetId),
				eq(schema.sessionLayoutPresets.authorUserId, args.userId),
				isNull(schema.sessionLayoutPresets.seedKey)
			)
		)
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
}): Promise<{ ok: true; id: number; sessions: number } | Refused> {
	const found = await manageablePreset(
		args.presetId,
		args.userId,
		LAYOUT_PRESET_BUILT_IN_DELETE
	)
	if (!found.ok) return found
	return {
		ok: true,
		id: args.presetId,
		sessions: await pinnedSessionCount(args.presetId)
	}
}
