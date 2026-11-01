/**
 * audio.cpp, run by Serene Pub — its settings row.
 *
 * `audiocpp_settings` holds one row. There is deliberately no fixed id: the
 * row is found as the OLDEST one (lowest id), and created on first need.
 * Nothing seeds it at a hardcoded id, so a user-created row can never be
 * overwritten by a later seed.
 */
import { asc } from "drizzle-orm"
import { audiocppSettings } from "$lib/server/db/schema"

/** audio.cpp's own 8080 collides with llama.cpp in local discovery. */
export const AUDIOCPP_DEFAULT_PORT = 5002

export type AudioCppSettingsRow = typeof audiocppSettings.$inferSelect

/**
 * The one settings row, created with defaults when absent.
 *
 * Insert-if-empty, then re-select the oldest row, so two concurrent callers
 * converge on the same row; if a duplicate ever exists, the oldest wins.
 */
export async function ensureAudioCppSettings(
	db: Db
): Promise<AudioCppSettingsRow> {
	const oldest = () =>
		db
			.select()
			.from(audiocppSettings)
			.orderBy(asc(audiocppSettings.id))
			.limit(1)
	const [existing] = await oldest()
	if (existing) return existing
	await db
		.insert(audiocppSettings)
		.values({ port: AUDIOCPP_DEFAULT_PORT })
	const [row] = await oldest()
	return row
}
