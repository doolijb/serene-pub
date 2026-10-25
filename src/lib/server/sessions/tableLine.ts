/**
 * 🚧 **A line the table hears** from a person's own edit (2026-10-18, the
 * 100-turn walk #35: _Give to…_ moved a potion from one sheet to another
 * and nobody was told). The widget names it with its write
 * (`set-attribute-value`'s `say`); here, once the write has landed, it is
 * written on the session's **table channel** — the voiceless folio a genre
 * keeps for its rolls and reckonings (`TABLE_CHANNEL`, PLAN-rulesets §30) —
 * anchored to the story's newest line, so the Story draws it inline under
 * that line and a delete of that line takes it too. A session whose genre
 * keeps no table channel writes nothing: the change lines under the story
 * already say what moved.
 */
import { and, desc, eq } from "drizzle-orm"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"

type Db = any

/** The table channel's slug (core-catalog `TABLE_CHANNEL`). */
const TABLE = "table"

/** Write `text` as a table line in `sessionId`, when its genre keeps a table; the row written, else null. */
export async function sayOnTable(
	db: Db,
	io: unknown,
	sessionId: number,
	text: string
): Promise<{ id: number } | null> {
	const line = text.replace(/\s+/g, " ").trim().slice(0, 200)
	if (!line) return null
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session?.genreId) return null
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const shape = (await getSessionGenre(db, session.genreId))?.shape as { channels?: unknown } | undefined
	const channels = Array.isArray(shape?.channels) ? (shape!.channels as Array<{ slug?: unknown }>) : []
	if (!channels.some((c) => c?.slug === TABLE)) return null
	// The story's newest line: the moment the line belongs to.
	const [anchor] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, "main"),
				// 🚧 The live history (RF fix 5): the line's insert replaces the
				// forward stack, so a rewound row is no anchor.
				liveMessageWhere()
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	const { insertLegacy, attachParts } = await import("$lib/server/messages/store")
	const row = await insertLegacy(db, {
		sessionId,
		role: "assistant",
		channel: TABLE,
		content: line,
		metadata: (anchor ? { anchorMessageId: anchor.id } : { tableLine: true }) as any
	})
	if (io) {
		const { broadcastToSessionUsers } = await import("$lib/server/sockets/utils/broadcastHelpers")
		const [sessionMessage] = await attachParts(db, [row])
		await broadcastToSessionUsers(io as any, sessionId, "sessionMessage", { sessionMessage })
	}
	return { id: row.id }
}
