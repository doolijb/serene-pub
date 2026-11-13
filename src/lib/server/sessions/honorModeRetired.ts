/**
 * ⏳ **The retired `honorMode` key** — the one-time mapping of stored data
 * from Honour mode to Keep every turn (owner rulings 2026-11-05: ★6 rename the
 * key instead of inverting stored values; ★sl-4 the words "Honour mode" leave
 * the UI).
 *
 * **Purpose.** Reads the old `honorMode` key once, where a person's choice was
 * stored, and writes what it came to under the two keys that replaced it —
 * `keepEveryTurn` (the turn delete) and `playerSheetLatitude` (the players'
 * hand edits on sheets) — then drops it. Old `true` (players edit sheets, the
 * host may delete the latest turn) becomes `keepEveryTurn: false` + `'as-ruled'`;
 * old `false` becomes `keepEveryTurn: true` + `'no-edits'`; absent maps
 * nothing, so the genre's defaults apply.
 *
 * **Why it exists.** 0.6 is in users' hands: sessions and session presets
 * made while the Dungeon Crawler declared `honorMode` carry it. Without this
 * they would fall to the genre defaults and a person's choice would silently
 * change meaning.
 *
 * **Owns.** `fromHonorMode` (the pure mapping) and `retireHonorMode` (the boot
 * pass over `sessions.genre_fields` and `session_presets.settings`).
 *
 * **Does NOT own.** The new keys' meaning (the SDK's `KEEP_EVERY_TURN_FIELD`,
 * `PLAYER_SHEET_LATITUDE_FIELD`; the reads are `sessionKeepsEveryTurn` and
 * `state/handEdits.ts`); presets a plugin projects (`owner_plugin_id` set —
 * the registry projection re-writes those from the plugin's declaration every
 * boot, so mapping only the row would make the projection read it as edited
 * by an admin); session import files and plugin preset settings (callers of
 * `fromHonorMode`, outside this module).
 *
 * **Idempotent without a ledger.** The pass finds rows by the old key and
 * drops it: a second boot finds none and changes nothing.
 *
 * **When it can go.** When no 0.6 data older than the rename can still arrive
 * (the 0.7 squash, or the importer no longer accepting older files).
 *
 * Imports are leaf only (schema, drizzle) and `db` is a parameter:
 * `db/defaults.ts` reaches this from `sync()`.
 */
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The retired key. */
const HONOR_MODE_KEY = "honorMode"

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

/** A preset entry's `{ value, lock, askAtStart }` wrapper (a plain value is no wrapper). */
const isWrapper = (v: unknown): v is Record<string, unknown> =>
	isRecord(v) && "value" in v

/**
 * What the old key came to, as a new record — or `null` when the record has
 * no `honorMode` key (nothing to do). The input is never changed.
 *
 * A new key already present wins and is never overwritten; `honorMode` is
 * always dropped; a non-boolean old value maps nothing but is still dropped.
 * When the old entry is a preset wrapper, each new key is written as a
 * wrapper carrying the same `lock` / `askAtStart` and the mapped `value`.
 */
export function fromHonorMode(
	record: Record<string, unknown>
): Record<string, unknown> | null {
	if (!isRecord(record) || !(HONOR_MODE_KEY in record)) return null
	const { [HONOR_MODE_KEY]: old, ...rest } = record
	const wrapped = isWrapper(old)
	const was = wrapped ? old.value : old
	if (typeof was !== "boolean") return rest
	const mapped: Record<string, unknown> = was
		? { keepEveryTurn: false, playerSheetLatitude: "as-ruled" }
		: { keepEveryTurn: true, playerSheetLatitude: "no-edits" }
	for (const [key, value] of Object.entries(mapped)) {
		if (key in rest) continue
		rest[key] = wrapped ? { ...old, value } : value
	}
	return rest
}

/**
 * The boot pass: every session's `genre_fields` and every core-owned preset's
 * `settings` still carrying `honorMode` is mapped in place. Plugin-owned
 * presets (`owner_plugin_id` set) are left alone. Returns how many rows
 * changed — zero on every boot after the first.
 */
export async function retireHonorMode(
	db: Db
): Promise<{ sessions: number; presets: number }> {
	let sessions = 0
	let presets = 0
	const sessionRows = await db
		.select({
			id: schema.sessions.id,
			genreFields: schema.sessions.genreFields
		})
		.from(schema.sessions)
		.where(
			sql`${schema.sessions.genreFields}::text like ${`%"${HONOR_MODE_KEY}"%`}`
		)
	for (const row of sessionRows) {
		const mapped = row.genreFields ? fromHonorMode(row.genreFields) : null
		if (!mapped) continue
		await db
			.update(schema.sessions)
			.set({ genreFields: mapped })
			.where(eq(schema.sessions.id, row.id))
		sessions++
	}
	const presetRows = await db
		.select({
			id: schema.sessionPresets.id,
			settings: schema.sessionPresets.settings
		})
		.from(schema.sessionPresets)
		.where(
			sql`(${schema.sessionPresets.ownerPluginId} is null or ${schema.sessionPresets.isImmutable} = false) and ${schema.sessionPresets.settings}::text like ${`%"${HONOR_MODE_KEY}"%`}`
		)
	for (const row of presetRows) {
		const mapped = row.settings ? fromHonorMode(row.settings) : null
		if (!mapped) continue
		await db
			.update(schema.sessionPresets)
			.set({ settings: mapped })
			.where(eq(schema.sessionPresets.id, row.id))
		presets++
	}
	return { sessions, presets }
}
