/**
 * Core's side of the executor: the I/O a binding is not allowed to do itself.
 *
 * The executor sequences; the host performs effects. A binding describes what
 * it wants — "read these messages", "write this message" — and this module is
 * what actually touches the database. That split is not ceremony:
 *
 *   · it is the only way a **sidecar** Consumer can ever work, since a separate
 *     process has no database channel (F19). In-process and out-of-process
 *     Consumers obeying the same contract means the review gate sees the same
 *     thing in both cases — a payload, before anything has happened.
 *   · it keeps every effect inside the substrate the review gate, the budget
 *     and the receipt already sit in. A binding that closed over `db` would be
 *     outside all three, and nothing would look wrong until an admin asked why
 *     a run wrote something the receipt does not mention.
 *
 * Scope enforcement lives here too, for the same reason: the host is handed the
 * **node** that asked, so a Query's read is checked against what that spec is
 * allowed to see rather than against the query it happened to send (F30).
 */

import { and, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { HostServices, NodeRef } from "@serene-pub/sdk"

type Db = { select: any; insert: any; update: any }

export interface HostScope {
	/** The chat this run belongs to. Reads outside it are refused, not filtered. */
	chatId?: number
	/** Who triggered the run, for authorship on writes. */
	userId?: number
}

export class HostScopeError extends Error {}

/**
 * A read a spec is not entitled to make is an **error, not an empty result**.
 *
 * Returning `[]` would let a mis-scoped pipeline look like a working one with a
 * quiet chat, and the symptom — "the bot forgot everything" — points at
 * retrieval rather than at permissions, which is where the week goes.
 */
function assertScoped(
	node: NodeRef,
	wanted: number | undefined,
	allowed: number | undefined
) {
	if (wanted === undefined) return
	if (allowed === undefined || wanted !== allowed)
		throw new HostScopeError(
			`${node.key} (${node.typeId}) asked for chat ${wanted}, but this run is scoped to ` +
				`${allowed ?? "no chat"}. A pipeline may only read the chat it was triggered in.`
		)
}

export function createHost(db: Db, scope: HostScope = {}): HostServices {
	return {
		async read(table, query, node) {
			const q = (query ?? {}) as Record<string, any>

			switch (table) {
				case "chat_messages": {
					const chatId = q.chatId ?? scope.chatId
					assertScoped(node, q.chatId, scope.chatId)
					if (chatId === undefined) return []

					// `isHidden` is the existing convention for a message that should
					// not reach a model. Honoured here rather than left to each
					// binding, so a new Query type cannot forget it.
					const rows = await db
						.select()
						.from(schema.chatMessages)
						.where(
							and(
								eq(schema.chatMessages.chatId, chatId),
								eq(schema.chatMessages.isHidden, false)
							)
						)
						.orderBy(desc(schema.chatMessages.id))
						.limit(Math.min(q.limit ?? 100, 500))

					// Reversed after a descending limit: "the most recent N, in
					// reading order" is what every caller wants, and doing it here
					// means no binding has to remember which end it got.
					return rows.reverse().map(toMessage)
				}

				case "chats": {
					const chatId = q.chatId ?? scope.chatId
					assertScoped(node, q.chatId, scope.chatId)
					if (chatId === undefined) return []
					return await db
						.select()
						.from(schema.chats)
						.where(eq(schema.chats.id, chatId))
						.limit(1)
				}

				default:
					throw new HostScopeError(
						`${node.key} (${node.typeId}) tried to read '${table}', which no Query type is ` +
							`bound to. Reads are enumerated here on purpose — a table nobody listed is a ` +
							`table nobody reviewed for scope.`
					)
			}
		},

		async commit(payload, node) {
			const p = (payload ?? {}) as Record<string, any>

			switch (node.typeId) {
				case "core:consumer/create-message": {
					const chatId = p.chatId ?? scope.chatId
					if (chatId === undefined)
						throw new HostScopeError(
							`${node.key} has no chat to write to — the run was started without a chat scope`
						)
					const [row] = await db
						.insert(schema.chatMessages)
						.values({
							chatId,
							userId: p.userId ?? scope.userId ?? null,
							characterId: p.characterId ?? null,
							personaId: p.personaId ?? null,
							role: p.role ?? "assistant",
							content: String(p.text ?? ""),
							metadata: p.metadata ?? {},
							isGenerating: false
						})
						.returning()
					return { id: row.id, chatId: row.chatId }
				}

				case "core:consumer/update-message": {
					const target = p.target
					const id =
						typeof target === "number"
							? target
							: (target?.id ?? target?.ids?.[0])
					if (id === undefined)
						throw new HostScopeError(
							`${node.key} was given no message id to update. update-message takes a row id ` +
								`from outside the run — a message created in the same run cannot be updated ` +
								`by a second node (13 §10b).`
						)
					const [row] = await db
						.update(schema.chatMessages)
						.set({ content: String(p.text ?? ""), isEdited: true })
						.where(eq(schema.chatMessages.id, id))
						.returning()
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to update`
						)
					assertScoped(node, row.chatId, scope.chatId)
					return { id: row.id, chatId: row.chatId }
				}

				default:
					throw new HostScopeError(
						`${node.key} (${node.typeId}) has no commit path in core. A Consumer that core ` +
							`cannot perform is one a user could add to a pipeline and watch fail at run time.`
					)
			}
		}
	}
}

/**
 * The row shape a Query publishes.
 *
 * Deliberately narrow: a binding gets what a prompt needs, not the whole row.
 * `queueItemId`, `embedding` and `debugMeta` have no business reaching a plugin
 * that asked for chat history, and the cheapest way to guarantee that is to
 * never put them in the value (F30).
 */
function toMessage(r: any) {
	return {
		id: r.id,
		role: r.role,
		content: r.content,
		characterId: r.characterId ?? null,
		personaId: r.personaId ?? null,
		isNarratorResponse: r.isNarratorResponse,
		createdAt: r.createdAt
	}
}
