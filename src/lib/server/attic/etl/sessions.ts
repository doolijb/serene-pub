/**
 * Every 0.5.3 chat becomes a **Chat** session (`core:genre/chat`), under its
 * own id, with its messages under theirs.
 *
 * What a 0.5.3 chat held that a session does not:
 *   · its connection (D10 — a session names no connection; the instance's
 *     defaults and the pipeline's configuration decide);
 *   · its prompt and narrator configs as columns — the wiring reads those from
 *     the attic and selects the migrated configuration for the session;
 *   · its reply strategy as a column — the wiring rebinds the turn-order
 *     strategy for the session when it was not the default (D8);
 *   · each character's visibility — one **character detail** setting for the
 *     whole cast now, the most verbose of the chat's seats (D7).
 *
 * No layout row is written and no greeting is generated: a session with no
 * layout of its own draws its preset's, and a 0.5.3 chat already holds its
 * greetings as messages.
 */
import * as schema from "$lib/server/db/schema"
import { DERELICT_REPLY_SENTENCE } from "$lib/server/sessions/derelictReplies"
import * as attic from "../tables"
import { vectorColumns } from "../embeddings"
import {
	countDrop,
	countLoss,
	insertBatched,
	pagesById,
	readById,
	mapped,
	movedTo,
	type RestoreContext
} from "../context"

export const CHAT_GENRE_ID = "core:genre/chat"

/** 0.5.3's per-seat visibility, as the session-wide character detail. */
const DETAIL_OF: Record<string, string> = {
	visible: "full",
	minimal: "brief",
	hidden: "speaker-only"
}
const VERBOSITY = ["full", "brief", "speaker-only"]

/**
 * The most verbose level any seat had, so every character the model saw in
 * 0.5.3 it still sees. Seats that had left the chat are only consulted when
 * no seat remains.
 */
export function characterDetailOf(
	seats: Array<{ visibility: string; removedAt: Date | null }>
): { detail: string; mixed: boolean } {
	const live = seats.filter((s) => s.removedAt == null)
	const pool = live.length ? live : seats
	const levels = [
		...new Set(pool.map((s) => DETAIL_OF[s.visibility] ?? "full"))
	]
	if (!levels.length) return { detail: "full", mixed: false }
	levels.sort((a, b) => VERBOSITY.indexOf(a) - VERBOSITY.indexOf(b))
	return { detail: levels[0], mixed: levels.length > 1 }
}

export async function restoreSessions(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const chats = await readById(tx, attic.chats)
	const seats = await tx.select().from(attic.chatCharacters)
	const seatsByChat = new Map<number, typeof seats>()
	for (const s of seats) {
		const list = seatsByChat.get(s.chatId) ?? []
		list.push(s)
		seatsByChat.set(s.chatId, list)
	}

	await insertBatched(
		tx,
		schema.sessions,
		chats.map((c) => {
			const { detail, mixed } = characterDetailOf(seatsByChat.get(c.id) ?? [])
			if (mixed)
				ctx.notes.add({
					topic: "character-detail",
					objectLabel: c.name ?? `chat ${c.id}`,
					summary: `The chat "${c.name ?? c.id}" showed its characters at different levels of detail; one level applies to the whole cast now, so it uses the most detailed one it had ("${detail}").`
				})
			if (c.connectionId != null) countLoss(ctx, "a chat's own connection")
			return {
				id: c.id,
				name: c.name,
				isGroup: c.isGroup,
				genreId: CHAT_GENRE_ID,
				presetId: null,
				// Only a level that differs from the genre's default is
				// written, so the session keeps following the default.
				genreFields: detail === "full" ? {} : { characterDetail: detail },
				sessionType: c.chatType,
				userId: mapped(ctx, "users", c.userId)!,
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
				scenario: c.scenario,
				metadata: c.metadata,
				annex: {},
				lorebookId: c.lorebookId,
				lorebookBranchId: null,
				samplingConfigId: mapped(ctx, "sampling_configs", c.samplingConfigId),
				drafts: c.drafts
			}
		}),
		200
	)

	await insertBatched(
		tx,
		schema.sessionCharacters,
		seats.map((s) => ({
			sessionId: s.chatId,
			characterId: s.characterId,
			envoySlug: null,
			position: s.position,
			isActive: s.isActive,
			removedAt: s.removedAt,
			removedName: s.removedName
		}))
	)

	const personas = await tx.select().from(attic.chatPersonas)
	await insertBatched(
		tx,
		schema.sessionPersonas,
		personas.map((p) => ({
			sessionId: p.chatId,
			personaId: movedTo(ctx, "personas", p.personaId),
			position: p.position,
			removedAt: p.removedAt,
			removedName: p.removedName
		}))
	)

	const guests = await tx.select().from(attic.chatGuests)
	await insertBatched(
		tx,
		schema.sessionGuests,
		guests.map((g) => ({
			sessionId: g.chatId,
			userId: mapped(ctx, "users", g.userId)!,
			isPlayer: g.isPlayer
		}))
	)

	const tags = await tx.select().from(attic.chatTags)
	await insertBatched(
		tx,
		schema.sessionTags,
		tags.map((t) => ({ sessionId: t.chatId, tagId: t.tagId }))
	)

	// 0.5.3 had no writer for chat lorebooks, so this is empty on every
	// install; a row found anyway is said rather than silently dropped.
	const chatLorebooks = await tx.select().from(attic.chatLorebooks)
	if (chatLorebooks.length) {
		countDrop(ctx, "chat_lorebooks", chatLorebooks.length)
		ctx.notes.add({
			topic: "session-lorebooks",
			objectLabel: "chat lorebooks",
			summary: `${chatLorebooks.length} extra lorebook attachment(s) on chats were not carried over: a session has one lorebook. Each chat's own lorebook is unchanged.`
		})
	}
}

/** One key renamed, every other key kept in its place. */
function renamedKey<T extends Record<string, unknown>>(
	object: T,
	from: string,
	to: string
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(object).map(([key, value]) => [key === from ? to : key, value])
	)
}

/**
 * A 0.5.3 message's metadata as 0.6 stores it: 0.5.3 kept a reply's
 * reasoning under the retired word — `thinking`, and `swipes.thinkingHistory`
 * beside each alternative — and 0.6 keeps it as `reasoning` and
 * `swipes.reasoningHistory` (NOMENCLATURE §23). Nothing else moves.
 */
export function messageMetadataFrom053(
	metadata: (typeof attic.chatMessages.$inferSelect)["metadata"]
): (typeof schema.sessionMessages.$inferInsert)["metadata"] {
	if (!metadata || typeof metadata !== "object") return metadata
	const renamed = renamedKey(metadata, "thinking", "reasoning")
	const swipes = metadata.swipes
	if (swipes && typeof swipes === "object")
		renamed.swipes = renamedKey(swipes, "thinkingHistory", "reasoningHistory")
	return renamed as (typeof schema.sessionMessages.$inferInsert)["metadata"]
}

/**
 * Messages, by id, in batches. A reply 0.5.3 left generating when it stopped
 * is settled exactly as `sessions/derelictReplies.ts` settles one at boot —
 * nothing will ever finish it — so the first start does not show it spinning.
 */
export async function restoreMessages(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	for await (const rows of pagesById(tx, attic.chatMessages)) {
		await insertBatched(
			tx,
			schema.sessionMessages,
			rows.map((m) => {
				const derelict = m.isGenerating
				return {
					id: m.id,
					sessionId: m.chatId,
					userId: mapped(ctx, "users", m.userId),
					characterId: m.characterId,
					personaId: movedTo(ctx, "personas", m.personaId),
					role: m.role,
					channel: "main",
					isNarratorResponse: m.isNarratorResponse,
					content: m.content,
					createdAt: m.createdAt,
					updatedAt: m.updatedAt,
					isEdited: m.isEdited,
					metadata: messageMetadataFrom053(m.metadata),
					isGenerating: false,
					generationStage: derelict ? null : m.generationStage,
					generationStatus: null,
					error: derelict ? { message: DERELICT_REPLY_SENTENCE } : m.error,
					queueItemId: derelict ? null : m.queueItemId,
					isHidden: m.isHidden,
					debugMeta: m.debugMeta,
					...vectorColumns(ctx.embeddings, "chat_messages", m)
				}
			}),
			250
		)
	}
}
