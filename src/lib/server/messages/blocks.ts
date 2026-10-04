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
 * The readers below are the host's: `sessions:fireAction` (through
 * `fireAction`) reads the form a press names off the ROW, never off the
 * client, and the `answer-form` commit reads the same block the event named.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	findFormBlock,
	formBlocksOf,
	isFormStale,
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
 * The session's **open form** on a channel (W-GATE D3, 2026-09-27): the
 * newest form that is unanswered and not overtaken, with the action it is
 * answered by — `session.openForm` in the published values, what an
 * action's `presentWhen` reads (the Lair's *Answer the door* is present only
 * while its knock is open).
 *
 * Only the channel's newest row can hold one, or — when that row is itself
 * an answer (`metadata.answersForm`) — the row it answers: any other line
 * overtakes every form above it (`stalenessHead`). The verdict is the door's
 * own (`isFormStale` over `stalenessHead`), so a listing never offers what a
 * press would be refused.
 *
 * `action` is the identity every option (or the form's one submit) fires;
 * null when the options fire different actions — one value, so a predicate
 * compares a string and never searches a list.
 */
export interface OpenForm {
	messageId: number
	blockId: string
	action: string | null
}

export async function openFormOf(
	db: Db,
	sessionId: number,
	channel = "main"
): Promise<OpenForm | null> {
	const [newest] = await db
		.select({ id: schema.sessionMessages.id, metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	if (!newest) return null
	const answers = Number(
		(newest.metadata as { answersForm?: { messageId?: unknown } } | null)?.answersForm
			?.messageId
	)
	const rowId = Number.isInteger(answers) && answers > 0 ? answers : newest.id
	const forms = (await blockTreesOf(db, rowId)).flatMap((tree) => formBlocksOf(tree))
	if (!forms.length) return null
	const { stalenessHead } = await import("$lib/server/messages/channels")
	const headNow = await stalenessHead(db, sessionId, channel, rowId)
	for (const form of [...forms].reverse()) {
		if (form.answered || isFormStale(form, headNow) || typeof form.id !== "string") continue
		const fired =
			form.kind === "choices" ? form.actions.map((o) => o.action ?? null) : [form.action ?? null]
		const action = fired.length && fired.every((a) => a && a === fired[0]) ? fired[0]! : null
		return { messageId: rowId, blockId: form.id, action }
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
	/** What the question was about, by name — the block's `referent` (lair pass B12). */
	referent?: string
	/** Where the question was asked from, by name — the block's `vantage` (plan A27). */
	vantage?: string
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
function markBlock(
	blocks: MessageBlock[],
	id: string,
	answered: FormAnswered | null
): MessageBlock[] {
	return blocks.map((b) => {
		if ((b.kind === "choices" || b.kind === "form") && b.id === id) {
			if (answered) return { ...b, answered }
			const { answered: _gone, ...open } = b
			return open as MessageBlock
		}
		if (b.kind === "group") return { ...b, blocks: markBlock(b.blocks, id, answered) }
		return b
	})
}

/**
 * Take a form's `answered` mark off again (lair pass R9): an answer rejected
 * at review that wrote nothing is no answer (`answerStanding`,
 * `reviewGate.ts`), so the block is open as it was before the press. In
 * place, like `markFormAnswered`. True when a mark was there to take off.
 */
export async function clearFormAnswered(
	db: Db,
	messageId: number,
	blockId: string
): Promise<boolean> {
	const parts = await db
		.select({ id: schema.messageParts.id, data: schema.messageParts.data })
		.from(schema.messageParts)
		.where(eq(schema.messageParts.messageId, messageId))
		.orderBy(schema.messageParts.step, schema.messageParts.revision, schema.messageParts.ordinal)
	for (const part of parts) {
		const blocks = (part.data as { blocks?: unknown } | null)?.blocks
		if (!Array.isArray(blocks)) continue
		const block = findFormBlock(blocks as MessageBlock[], blockId)
		if (!block) continue
		if (!block.answered) return false
		await db
			.update(schema.messageParts)
			.set({ data: { ...(part.data ?? {}), blocks: markBlock(blocks as MessageBlock[], blockId, null) } })
			.where(eq(schema.messageParts.id, part.id))
		return true
	}
	return false
}
