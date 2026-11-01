/**
 * Spoken audio (speech build S8, design §12) — a `files` row whose
 * `meta.spoken === true`. It is a DERIVED form: reproducible from script +
 * voice + seed, never an original, so it is listed only on request, swept with
 * the derived forms, and reclaimed with no confirmation.
 *
 * This module owns the one predicate, the SQL twin of it, the pub setting
 * `speech.keepSpokenAudio` (`system_settings.keep_spoken_audio`), and the one
 * delete path for spoken files. A message part that named a deleted file is
 * lane D/E's to read as "not spoken yet"; nothing here touches messages.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** `forever` | `archived` (until the session is archived) | N days. */
export type KeepSpokenAudio = "forever" | "archived" | number

export const KEEP_SPOKEN_MAX_DAYS = 3650

export function isSpokenMedia(meta: unknown): boolean {
	return (
		typeof meta === "object" &&
		meta !== null &&
		(meta as Record<string, unknown>).spoken === true
	)
}

/** `files.meta` is `json` (not jsonb); `->>` works on both. */
export function spokenSql(): SQL {
	return sql`(${schema.files.meta}->>'spoken') = 'true'`
}

/** The inverse, NULL-safe (a row with no meta is not spoken). */
export function notSpokenSql(): SQL {
	return sql`(${schema.files.meta}->>'spoken') IS DISTINCT FROM 'true'`
}

/** Stored text -> value. Anything unreadable falls back to `forever` (keep). */
export function parseKeepSpokenAudio(raw: string): KeepSpokenAudio {
	const s = String(raw ?? "").trim().toLowerCase()
	if (s === "forever" || s === "archived") return s
	if (/^\d+$/.test(s)) {
		const n = Number(s)
		if (n >= 1 && n <= KEEP_SPOKEN_MAX_DAYS) return n
	}
	return "forever"
}

export function formatKeepSpokenAudio(v: KeepSpokenAudio): string {
	return typeof v === "number" ? String(Math.trunc(v)) : v
}

/** Strict check for a value arriving from a client. */
export function isValidKeepSpokenAudio(v: unknown): v is KeepSpokenAudio {
	if (v === "forever" || v === "archived") return true
	return (
		typeof v === "number" &&
		Number.isInteger(v) &&
		v >= 1 &&
		v <= KEEP_SPOKEN_MAX_DAYS
	)
}

export async function readKeepSpokenAudio(db: Db): Promise<KeepSpokenAudio> {
	const [row] = await db
		.select({ keep: schema.systemSettings.keepSpokenAudio })
		.from(schema.systemSettings)
		.limit(1)
	return parseKeepSpokenAudio(row?.keep ?? "forever")
}

export async function writeKeepSpokenAudio(
	db: Db,
	keep: KeepSpokenAudio
): Promise<void> {
	await db
		.update(schema.systemSettings)
		.set({ keepSpokenAudio: formatKeepSpokenAudio(keep) })
}

/** Spoken file ids + bytes under an extra filter (a session, an age, …). */
export async function findSpoken(
	db: Db,
	extra?: SQL | undefined
): Promise<{ ids: number[]; bytes: number }> {
	const rows = await db
		.select({ id: schema.files.id })
		.from(schema.files)
		.where(extra ? and(spokenSql(), extra) : spokenSql())
	const ids = rows.map((r) => r.id)
	return { ids, bytes: await storedBytes(db, ids) }
}

async function storedBytes(db: Db, ids: number[]): Promise<number> {
	if (!ids.length) return 0
	const [row] = await db
		.select({
			bytes: sql<number>`COALESCE(SUM(${schema.variants.bytes}), 0)::bigint`
		})
		.from(schema.variants)
		.where(inArray(schema.variants.fileId, ids))
	return Number(row?.bytes ?? 0)
}

/**
 * Delete spoken files through the same path as `media:delete` (`deleteFile`:
 * every variant's bytes and thumbnail, then the row). Only rows that are
 * still spoken are touched, whatever ids are passed.
 */
export async function deleteSpokenFiles(
	db: Db,
	ids: number[]
): Promise<{ cleared: number; bytes: number }> {
	if (!ids.length) return { cleared: 0, bytes: 0 }
	const { deleteFile } = await import("./index")
	const live = await db
		.select({ id: schema.files.id })
		.from(schema.files)
		.where(and(inArray(schema.files.id, ids), spokenSql()))
	const liveIds = live.map((r) => r.id)
	const bytes = await storedBytes(db, liveIds)
	let cleared = 0
	for (const id of liveIds) {
		try {
			await deleteFile(db, id)
			cleared++
		} catch (e) {
			console.warn(`[media] could not clear spoken file ${id}:`, e)
		}
	}
	return { cleared, bytes }
}

/** Spoken files in one session. */
export function inSession(sessionId: number): SQL {
	return eq(schema.files.sessionId, sessionId)
}
