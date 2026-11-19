/**
 * 🚧 The ONE server read of a session's speech settings (S7): through the
 * session fields cascade, so the genre's default and any preset apply;
 * falls back to the raw `sessions.genre_fields` when the cascade cannot be
 * read. Never throws — a missing session reads as the defaults.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	cascadeSessionFields,
	getSessionGenre,
	STANDARD_GENRE_ID
} from "$lib/server/pipelines/entities/sessionGenres"
import {
	readEnvoySpeech,
	readSpeechSessionSettings,
	type EnvoySpeech,
	type SpeechSessionSettings
} from "$lib/shared/sessions/speechSettings"

export async function sessionSpeechSettings(
	db: Db,
	sessionId: number
): Promise<SpeechSessionSettings> {
	try {
		const [session] = await db
			.select({
				genreId: schema.sessions.genreId,
				presetId: schema.sessions.presetId,
				genreFields: schema.sessions.genreFields
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (session) {
			const genre = await getSessionGenre(
				db,
				session.genreId ?? STANDARD_GENRE_ID
			)
			return readSpeechSessionSettings(
				await cascadeSessionFields(db, session, genre)
			)
		}
	} catch {
		// fall through to the stored fields
	}
	try {
		const [row] = await db
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		return readSpeechSessionSettings(row?.genreFields)
	} catch {
		return readSpeechSessionSettings(null)
	}
}

/**
 * 🚧 One envoy's speech settings in a session (speech follow-ups B7/C10):
 * the `speechEnvoyVoice:` / `speechEnvoyNarrationVoice:<envoySlug>` keyed family, read raw off
 * `sessions.genre_fields` (the family is not declared per key, so the
 * cascade's declared-key document never carries it). Never throws — a
 * missing session or envoy reads as all-null.
 */
export async function sessionEnvoySpeech(
	db: Db,
	sessionId: number | null,
	envoySlug: string
): Promise<EnvoySpeech> {
	if (sessionId == null || !envoySlug) return readEnvoySpeech(null, envoySlug)
	try {
		const [row] = await db
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		return readEnvoySpeech(row?.genreFields, envoySlug)
	} catch {
		return readEnvoySpeech(null, envoySlug)
	}
}
