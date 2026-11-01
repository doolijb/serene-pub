/**
 * The "Keep spoken audio" sweep (design §12). Hourly timer owned by this
 * module; `startSpokenRetention()` is called once at boot (see the report for
 * the wiring point) and `stopSpokenRetention()` at shutdown. Both idempotent.
 */
import { and, inArray, isNotNull, lt } from "drizzle-orm"
import { db as defaultDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	deleteSpokenFiles,
	findSpoken,
	readKeepSpokenAudio
} from "./spoken"

export const SPOKEN_RETENTION_INTERVAL_MS = 60 * 60 * 1000

export async function sweepSpokenAudio(
	db: Db = defaultDb as unknown as Db,
	now: Date = new Date()
): Promise<{ cleared: number; bytes: number }> {
	const keep = await readKeepSpokenAudio(db)
	if (keep === "forever") return { cleared: 0, bytes: 0 }

	let ids: number[]
	if (keep === "archived") {
		const archived = db
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(isNotNull(schema.sessions.archivedAt))
		ids = (
			await findSpoken(
				db,
				and(
					isNotNull(schema.files.sessionId),
					inArray(schema.files.sessionId, archived)
				)
			)
		).ids
	} else {
		const cutoff = new Date(now.getTime() - keep * 24 * 60 * 60 * 1000)
		ids = (await findSpoken(db, lt(schema.files.createdAt, cutoff))).ids
	}
	return deleteSpokenFiles(db, ids)
}

let timer: ReturnType<typeof setInterval> | null = null

export function startSpokenRetention(): void {
	if (timer) return
	timer = setInterval(() => {
		sweepSpokenAudio().catch((e) =>
			console.warn("[media] spoken retention sweep failed:", e)
		)
	}, SPOKEN_RETENTION_INTERVAL_MS)
	timer.unref?.()
}

export function stopSpokenRetention(): void {
	if (!timer) return
	clearInterval(timer)
	timer = null
}
