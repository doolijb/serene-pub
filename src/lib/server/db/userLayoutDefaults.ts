/**
 * "Use this layout for my new Adventure sessions" — the `user_layout_defaults`
 * table (session layout v2 §4.2), one row per person per genre and the third
 * tier of the resolution chain (§4.4).
 *
 * ## Why a table and not a user setting
 *
 * It is per GENRE, and the set of genres is open: a plugin brings its own, and
 * a settings blob keyed by genre id would keep rows for genres that have gone
 * away with nothing able to prune them. A row with a real FK is also what makes
 * "the preset I defaulted to was deleted" a `SET NULL` rather than a dangling
 * id — the person falls through to the genre's own layout, which is what they
 * would have had before they chose.
 *
 * ## What it is not
 *
 * Not the ACTIVE layout: that is the `session_panel_layouts` row, per session.
 * Setting a default changes nothing about a session that already exists — it is
 * read when a session resolves and finds no preset of its own.
 */
import { and, eq } from "drizzle-orm"
import { db } from "."
import * as schema from "./schema"
import { canApplyLayoutPreset, LAYOUT_PRESET_UNKNOWN } from "./layoutPresets"

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
 *
 * The preset must be one they may APPLY: same genre, and visible to them.
 * Without that check any id at all could be defaulted to, and the chain would
 * then resolve a stranger's private layout for every new session they started.
 * Refused with the same sentence a missing id gets, so the id space cannot be
 * walked (the privacy order `layoutPresets.ts` keeps).
 */
export async function setUserLayoutDefault(args: {
	userId: number
	genreId: string
	presetId: number | null
}): Promise<{ ok: true; genreId: string; presetId: number | null } | Refused> {
	const { userId, genreId } = args
	if (!genreId) return { ok: false, error: "That session type is unknown." }

	if (args.presetId != null) {
		const allowed = await canApplyLayoutPreset(
			args.presetId,
			genreId,
			userId
		)
		if (!allowed) return { ok: false, error: LAYOUT_PRESET_UNKNOWN }
	}

	// Upsert on the natural key, never on an id: the unique index
	// `(user_id, genre_id)` is the row's identity, and two tabs setting a
	// default at once must not make two rows.
	await db
		.insert(schema.userLayoutDefaults)
		.values({ userId, genreId, layoutPresetId: args.presetId })
		.onConflictDoUpdate({
			target: [
				schema.userLayoutDefaults.userId,
				schema.userLayoutDefaults.genreId
			],
			set: { layoutPresetId: args.presetId, updatedAt: new Date() }
		})

	return { ok: true, genreId, presetId: args.presetId }
}
