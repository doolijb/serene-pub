/**
 * Message blocks as parts (20 §6; plans/29 R-15 *Forms*; 30 §U5d, built
 * 2026-09-17).
 *
 * A block tree core writes lands as ONE part of type `core:blocks` with the
 * list under `data.blocks` — the convention `MessagePartsView` already
 * renders (any part whose `data.blocks` is an array), so a plugin's
 * namespaced part and core's own meet the same renderer. Nothing here enters
 * `textOf`: a block is not the body, and the row's `content` carries the
 * question in prose where a transcript needs it (`make-choices@1`'s `text`).
 *
 * The readers below are the host's: `sessions:triggerFunction` (through
 * `fireAction`) reads the form a press names off the ROW, never off the
 * client, and the `answer-form` commit reads the same block the event named.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	findFormBlock,
	type FormAnswered,
	type FormBlock,
	type MessageBlock
} from "@serene-pub/sdk"
import { recordSessionChange } from "$lib/server/messages/sessionChanges"

/** The part type a core-written block tree is stored under. */
export const CORE_BLOCKS_PART = "core:blocks"

/** The change the door records the first time it finds a form overtaken (U5f). */
export const FORM_SUPERSEDED_EVENT = "core:event/form-superseded@1"

/** The block trees a message carries, in part order, whoever wrote them. */
export async function blockTreesOf(
	db: Db,
	messageId: number
): Promise<MessageBlock[][]> {
	const parts = await db
		.select({ data: schema.messageParts.data, ordinal: schema.messageParts.ordinal })
		.from(schema.messageParts)
		.where(eq(schema.messageParts.messageId, messageId))
		.orderBy(schema.messageParts.step, schema.messageParts.revision, schema.messageParts.ordinal)
	const out: MessageBlock[][] = []
	for (const p of parts) {
		const blocks = (p.data as { blocks?: unknown } | null)?.blocks
		if (Array.isArray(blocks)) out.push(blocks as MessageBlock[])
	}
	return out
}

/** The form block `blockId` names on message `messageId`, or null. */
export async function loadFormBlock(
	db: Db,
	messageId: number,
	blockId: string
): Promise<FormBlock | null> {
	for (const tree of await blockTreesOf(db, messageId)) {
		const found = findFormBlock(tree, blockId)
		if (found) return found
	}
	return null
}

/**
 * The facts about a form a fire carries onto the run's input as `form` —
 * read off the stored block, so a spec's `read-answer@1` sees what the row
 * says and not what a client claimed. `characterId` is the addressee's row
 * when the addressee is a `character:` reference with a well-formed id.
 */
export interface FormFacts {
	blockId: string
	messageId: number
	kind: FormBlock["kind"]
	question: string | null
	addressee: string | null
	characterId: number | null
	/** `choices` only: the option key the press answered with, and its label. */
	choice?: string
	label?: string
}

/**
 * Store a block tree as the message's ONE `core:blocks` part (U5d review,
 * S5): when the row already carries one, its data is replaced in place — the
 * part keeps its address — and any further `core:blocks` part is removed;
 * when it carries none, one is appended. A message's block tree is a value
 * a write sets, not a log it appends to: an `update-message` that hands the
 * row new blocks means *these* blocks, and two trees would render as two
 * rows of buttons.
 */
export async function replaceBlocksPart(
	db: Db,
	messageId: number,
	blocks: MessageBlock[]
): Promise<void> {
	const existing = await db
		.select({ id: schema.messageParts.id })
		.from(schema.messageParts)
		.where(
			and(
				eq(schema.messageParts.messageId, messageId),
				eq(schema.messageParts.type, CORE_BLOCKS_PART)
			)
		)
		.orderBy(schema.messageParts.step, schema.messageParts.revision, schema.messageParts.ordinal)
	if (!existing.length) {
		const { appendParts } = await import("$lib/server/messages/store")
		await appendParts(db, messageId, [{ type: CORE_BLOCKS_PART, data: { blocks } }])
		return
	}
	const [keep, ...extra] = existing
	await db
		.update(schema.messageParts)
		.set({ data: { blocks } })
		.where(eq(schema.messageParts.id, keep!.id))
	if (extra.length)
		await db.delete(schema.messageParts).where(
			inArray(
				schema.messageParts.id,
				extra.map((p) => p.id)
			)
		)
	await db
		.update(schema.messages)
		.set({ updatedAt: new Date() })
		.where(eq(schema.messages.id, messageId))
}

/**
 * Mark a form answered (U5d review, W7): the `core:blocks` part carrying
 * block `blockId` is updated **in place** with `answered` set on that block —
 * who (the addressee when the form was addressed, else the user who
 * pressed), when, and for a `choices` block which option. Stamped by
 * `fireAction` once the action's run landed, so a second press finds it and
 * is refused, and a client greys the block. Returns the tree as stored, or
 * null when no part carries the block.
 */
export async function markFormAnswered(
	db: Db,
	messageId: number,
	blockId: string,
	answered: FormAnswered
): Promise<MessageBlock[] | null> {
	const parts = await db
		.select({ id: schema.messageParts.id, data: schema.messageParts.data })
		.from(schema.messageParts)
		.where(eq(schema.messageParts.messageId, messageId))
		.orderBy(schema.messageParts.step, schema.messageParts.revision, schema.messageParts.ordinal)
	for (const part of parts) {
		const blocks = (part.data as { blocks?: unknown } | null)?.blocks
		if (!Array.isArray(blocks) || !findFormBlock(blocks as MessageBlock[], blockId)) continue
		const marked = markBlock(blocks as MessageBlock[], blockId, answered)
		await db
			.update(schema.messageParts)
			.set({ data: { ...(part.data ?? {}), blocks: marked } })
			.where(eq(schema.messageParts.id, part.id))
		return marked
	}
	return null
}

/**
 * Record that a form was **superseded** (plans/29 R-15 *Staleness and
 * order*; U5f) — the channel head moved past it before it was answered, and
 * a press on it reached the door. Recorded ONCE per block: the first time
 * the door sees it stale, so the next reply's inlet learns the question
 * lapsed; a second stale press adds nothing. Staleness itself is never
 * stored on the block — it is computed from the head wherever the block is
 * held, and this row is the ledger's note of it, not the fact.
 *
 * ⚠ **The once is a lock, not a check.** The check and the insert are one
 * transaction under `pg_advisory_xact_lock(hashtext('formSuperseded'),
 * sessionId)` — the `nextLane` idiom (`messages/channels.ts`) — because two
 * stale presses can reach the door together (a person's press and an
 * oracle's dispatched answer are two callers of `fireAction`, and only the
 * socket door is serialised in memory), and a check made ahead of the insert
 * is made by both before either records.
 *
 * ⚠ **The one direct ledger write.** Every other session event goes through
 * `emitSessionEvent` (PLAN-turn-order §4.1, A2), whose plugin fan-out must
 * not sit inside a transaction (`db/transactionGuard.ts`). This write must —
 * the once IS the transaction — so it records directly and fans out to
 * nothing; PLAN §8 (13) holds the gap.
 */
export async function recordFormSuperseded(
	db: Db,
	form: { sessionId: number; messageId: number; blockId: string }
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext('formSuperseded'), ${form.sessionId})`
		)
		const [already] = await tx
			.select({ id: schema.sessionChanges.id })
			.from(schema.sessionChanges)
			.where(
				and(
					eq(schema.sessionChanges.sessionId, form.sessionId),
					eq(schema.sessionChanges.event, FORM_SUPERSEDED_EVENT),
					eq(schema.sessionChanges.messageId, form.messageId),
					sql`${schema.sessionChanges.payload}->>'blockId' = ${form.blockId}`
				)
			)
			.limit(1)
		if (already) return
		await recordSessionChange(tx, {
			event: FORM_SUPERSEDED_EVENT,
			sessionId: form.sessionId,
			messageId: form.messageId,
			blockId: form.blockId
		})
	})
}

/** A copy of the tree with `answered` set on the form block `id` names. */
function markBlock(blocks: MessageBlock[], id: string, answered: FormAnswered): MessageBlock[] {
	return blocks.map((b) => {
		if ((b.kind === "choices" || b.kind === "form") && b.id === id) return { ...b, answered }
		if (b.kind === "group") return { ...b, blocks: markBlock(b.blocks, id, answered) }
		return b
	})
}
