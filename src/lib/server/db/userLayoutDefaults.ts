/**
 * "Use this layout for my new Adventure sessions" — a person's **new-session
 * layout** (NOMENCLATURE §9), stored in the `user_layout_defaults` table, one
 * row per person per genre. The table and this module keep their names (R5).
 * Read at a person's first open of a session (`resolveNewSessionLayout` in
 * `./layoutPresets`), which copies it in; set and cleared by
 * `sessions:layoutPreset:setNewSessionLayout` (a card's _Use for new *Genre*
 * sessions_ / _Stop using for new sessions_).
 *
 * ## Why a table and not a user setting
 *
 * It is per GENRE, and the set of genres is open: a plugin brings its own, and
 * a settings blob keyed by genre id would keep rows for genres that have gone
 * away with nothing able to prune them. A row with a real FK is also what makes
 * "the preset I defaulted to was deleted" a `SET NULL` rather than a dangling
 * id — the person falls through to the genre default layout, which is what they
 * would have had before they chose.
 *
 * ## What it is not
 *
 * Not a session's layout: that is the `session_panel_layouts` row, per session.
 * Setting one changes nothing about a session that already exists — it is
 * read only when a person opens a session they have no layout for yet.
 */
import { and, eq } from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import {
	canApplyLayoutPreset,
	genreDefaultLayoutRow,
	LAYOUT_PRESET_UNKNOWN
} from "./layoutPresets"

/** A refused write — the sentence is the whole result. */
type Refused = { ok: false; error: string }

/** This person's default preset for a genre, or null when they have none. */
export async function getUserLayoutDefault(
	userId: number,
	genreId: string
): Promise<number | null> {
	const [row] = await db
		.select({ layoutPresetId: schema.userLayoutDefaults.layoutPresetId })
		.from(schema.userLayoutDefaults)
		.where(
			and(
				eq(schema.userLayoutDefaults.userId, userId),
				eq(schema.userLayoutDefaults.genreId, genreId)
			)
		)
		.limit(1)
	return row?.layoutPresetId ?? null
}

/**
 * Set — or, with `presetId: null`, clear — this person's default for a genre.
 * Clearing deletes the row: no row and a nulled one read the same (the genre
 * default layout applies), and a clear never writes, so a genre id nothing
 * ships cannot leave a row behind.
 *
 * The preset must be one they may APPLY: same genre, and visible to them.
 * Without that check any id at all could be defaulted to, and a stranger's
 * private layout would be copied into every new session they started.
 * Refused with the same sentence a missing id gets, so the id space cannot be
 * walked (the privacy order `layoutPresets.ts` keeps).
 *
 * The genre default layout is what no row already means, so choosing it
 * CLEARS (answered as `presetId: null`): one stored way to say it, and no pin
 * to an id that would stop following the genre if its default row were ever
 * replaced.
 */
export async function setUserLayoutDefault(args: {
	userId: number
	genreId: string
	presetId: number | null
}): Promise<{ ok: true; genreId: string; presetId: number | null } | Refused> {
	const { userId, genreId } = args
	if (!genreId) return { ok: false, error: "That genre is unknown." }

	const presetId = args.presetId
	if (
		presetId === null ||
		(Number.isInteger(presetId) &&
			(await genreDefaultLayoutRow(genreId))?.id === presetId)
	) {
		await db
			.delete(schema.userLayoutDefaults)
			.where(
				and(
					eq(schema.userLayoutDefaults.userId, userId),
					eq(schema.userLayoutDefaults.genreId, genreId)
				)
			)
		return { ok: true, genreId, presetId: null }
	}

	if (
		!Number.isInteger(presetId) ||
		!(await canApplyLayoutPreset(presetId, genreId, userId))
	)
		return { ok: false, error: LAYOUT_PRESET_UNKNOWN }

	// Upsert on the natural key, never on an id: the unique index
	// `(user_id, genre_id)` is the row's identity, and two tabs setting a
	// default at once must not make two rows.
	await db
		.insert(schema.userLayoutDefaults)
		.values({ userId, genreId, layoutPresetId: presetId })
		.onConflictDoUpdate({
			target: [
				schema.userLayoutDefaults.userId,
				schema.userLayoutDefaults.genreId
			],
			set: { layoutPresetId: presetId, updatedAt: new Date() }
		})

	return { ok: true, genreId, presetId }
}
