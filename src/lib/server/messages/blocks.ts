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

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	findFormBlock,
	type FormBlock,
	type MessageBlock
} from "@serene-pub/sdk"

/** The part type a core-written block tree is stored under. */
export const CORE_BLOCKS_PART = "core:blocks"

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
