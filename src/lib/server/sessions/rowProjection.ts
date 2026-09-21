/**
 * What a session card quotes: the row's message count and its last visible
 * line.
 *
 * ONE projection with two callers. `sessions:list`
 * (`sockets/sessions.ts`'s `buildSessionsListFor`) asks it for every session at
 * once; the `sessions:rowChanged` push (`sessions/rowPush.ts`) asks it for a
 * single session after a message lands, is edited, hidden, deleted or
 * streamed. Both therefore read the same three exclusions — an in-flight
 * generation, a hidden message, a blank body — so a row the push keeps current
 * says exactly what the next list would.
 *
 * `db` is a parameter, never an import: the list calls it on the app handle,
 * the push on its own, and a test on the one it built.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"

/**
 * `characters`, joined a SECOND time as the voiced side.
 *
 * `session_messages.persona_id` and `session_messages.character_id` both point
 * at `characters`, so a query that reads the speaking character AND the voiced
 * one has to name the table twice — one join cannot answer for both, and
 * without the alias the second silently overwrites the first.
 */
const voicedCharacter = alias(schema.characters, "voiced_character")

/**
 * A message's last line as a person reads it: one line, no markup.
 *
 * The same 160-character shape as `retrievalExcerpt` in `sockets/pipelines.ts`,
 * plus a markdown strip — this text is rendered as PLAIN text in a card, and a
 * roleplay message is mostly `*stage directions*`, so the markers would show.
 *
 * Underscores are left alone on purpose: `_emphasis_` is rare next to how often
 * a name or a key in a message is `snake_case`, and stripping them would eat
 * the word rather than the markup.
 */
export function messageExcerpt(content: string | null | undefined): string {
	if (typeof content !== "string") return ""
	const flat = content
		// Code first: a fence's contents are not prose, and an inline span's
		// backticks would otherwise survive into the card.
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		// Images before links — an image inside a link must not leave its alt
		// text behind as the link's label.
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		// Line-leading markers: quote, heading, bullet, ordered item.
		.replace(
			/^[ \t]{0,3}(?:>+[ \t]*|#{1,6}[ \t]+|[-*+][ \t]+|\d+\.[ \t]+)/gm,
			""
		)
		// Emphasis markers, never the words between them.
		.replace(/\*+/g, "")
		.replace(/~~/g, "")
		.replace(/\s+/g, " ")
		.trim()
	return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat
}

/**
 * The last visible line of each of these sessions, keyed by session id.
 *
 * `DISTINCT ON (session_id) … ORDER BY session_id, id DESC` — the newest row
 * per session in ONE pass, whether the caller asked about one session or forty.
 * `id DESC` and not `created_at`: that column is a `date` (day granularity), so
 * it cannot order two messages from the same afternoon. The session page sorts
 * by id for the same reason.
 *
 * The three exclusions are what "visible line" means: a placeholder
 * mid-generation, a message the owner hid, and a blank body. Without them a
 * session that is generating right now shows an empty quote. A session with
 * nothing to show is absent from the map rather than present with a null.
 *
 * The read is unscoped by channel, deliberately: it must be the line the
 * session PAGE shows last, and that read (`getSessionFromDB`) is unscoped too.
 * The channel-scoped read is the prompt path's, which is a different question.
 */
export async function lastVisibleMessages(
	db: Db,
	sessionIds: number[]
): Promise<Map<number, Sockets.Sessions.List.LastMessage>> {
	const lastMessages = new Map<number, Sockets.Sessions.List.LastMessage>()
	if (sessionIds.length === 0) return lastMessages

	const latestRows = await db
		.selectDistinctOn([schema.sessionMessages.sessionId], {
			sessionId: schema.sessionMessages.sessionId,
			content: schema.sessionMessages.content,
			role: schema.sessionMessages.role,
			metadata: schema.sessionMessages.metadata,
			updatedAt: schema.sessionMessages.updatedAt,
			characterName: schema.characters.name,
			characterNickname: schema.characters.nickname,
			// The VOICED character, joined under an alias: both columns
			// point at `characters`, and one table cannot be joined twice
			// under the same name.
			personaName: voicedCharacter.name
		})
		.from(schema.sessionMessages)
		.leftJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionMessages.characterId)
		)
		.leftJoin(
			voicedCharacter,
			eq(voicedCharacter.id, schema.sessionMessages.personaId)
		)
		.where(
			and(
				inArray(schema.sessionMessages.sessionId, sessionIds),
				eq(schema.sessionMessages.isGenerating, false),
				eq(schema.sessionMessages.isHidden, false),
				// Whitespace spelled with `chr()` rather than an escape:
				// `\t` inside a template literal would reach the server as
				// a literal control character in the SQL text.
				sql`btrim(${schema.sessionMessages.content}, ' ' || chr(9) || chr(10) || chr(13)) <> ''`
			)
		)
		.orderBy(
			schema.sessionMessages.sessionId,
			desc(schema.sessionMessages.id)
		)

	for (const row of latestRows) {
		const excerpt = messageExcerpt(row.content)
		if (!excerpt) continue
		// Persona before character: a message carries at most one of the
		// two, and a persona message is the caller's own side.
		const speakerName = row.personaName
			? resolvePersonaName({ name: row.personaName }, "")
			: row.characterName || row.characterNickname
				? resolveCharacterName(
						{
							name: row.characterName,
							nickname: row.characterNickname
						},
						""
					)
				: (row.metadata?.narratorName ?? "")
		lastMessages.set(row.sessionId, {
			excerpt,
			speakerName: speakerName || null,
			isUser: row.role === "user",
			createdAt: new Date(row.updatedAt).toISOString()
		})
	}
	return lastMessages
}
