/**
 * Both prompt paths, on one of *your* chats.
 *
 * The parity corpus proves the two paths agree on fixtures somebody wrote. This
 * answers the different and more interesting question: do they agree on a real
 * chat, with its real lorebook, its real character cards and its real history —
 * the ones nobody thought to write a fixture for.
 *
 * It sends nothing and writes nothing. The pipeline side runs with
 * `preview: true`, which halts at the pre-call substrate with the real payload;
 * the legacy side compiles a prompt and drops it. A chat can be compared while
 * the user is in the middle of it.
 *
 * Read by `scripts/compare-prompts.js`, which is how a person runs it.
 */

import { checkParity, type ParityResult } from "@serene-pub/sdk"
import { runTurn } from "./runTurn"
import { legacyRender } from "./parity"
import * as schema from "$lib/server/db/schema"
import { eq, desc } from "drizzle-orm"

export interface CompareRequest {
	db: any
	chatId: number
	/** Defaults to the chat's own owner. */
	userId?: number
	/** Defaults to the chat's first active character. */
	currentCharacterId?: number | null
}

export interface CompareResult extends ParityResult {
	chatId: number
	/** Present when the run could not reach the provider — the reason why. */
	stopped?: string
}

/**
 * Compile one chat both ways and diff.
 *
 * The connection is resolved for real, because the *prompt format* comes from it
 * and a comparison run against a different format than the chat uses would agree
 * on a prompt nobody sends.
 */
export async function comparePrompts(
	request: CompareRequest
): Promise<CompareResult> {
	const both = await compareBoth(request)
	if (both.stopped)
		return {
			chatId: request.chatId,
			fixture: `chat/${request.chatId}`,
			identical: false,
			stopped: both.stopped
		}
	return {
		chatId: request.chatId,
		...checkParity(`chat/${request.chatId}`, both.legacy, both.receipt!)
	}
}

/** Compile one chat both ways, without deciding what to do about the result. */
async function compareBoth(request: CompareRequest): Promise<{
	legacy: string
	pipeline: string
	receipt?: any
	stopped?: string
}> {
	const { db, chatId } = request

	const [chat] = await db
		.select()
		.from(schema.chats)
		.where(eq(schema.chats.id, chatId))
		.limit(1)
	if (!chat) throw new Error(`there is no chat ${chatId}`)

	const userId = request.userId ?? chat.userId

	// Whose turn it is. A comparison has to pick someone, and the chat's first
	// active character is who the app would pick for a plain reply.
	let currentCharacterId: number | null = request.currentCharacterId ?? null
	if (request.currentCharacterId === undefined) {
		const [cc] = await db
			.select()
			.from(schema.chatCharacters)
			.where(eq(schema.chatCharacters.chatId, chatId))
			.limit(1)
		currentCharacterId = cc?.characterId ?? null
	}

	const [lastMessage] = await db
		.select()
		.from(schema.chatMessages)
		.where(eq(schema.chatMessages.chatId, chatId))
		.orderBy(desc(schema.chatMessages.id))
		.limit(1)
	const text = lastMessage?.content ?? ""

	const { getUserConfigurations } = await import(
		"$lib/server/utils/getUserConfigurations"
	)
	const { resolveTaskConfig } = await import(
		"$lib/server/utils/resolveTaskConfig"
	)
	const configs = await getUserConfigurations(userId)
	const resolved = await resolveTaskConfig({
		taskType: "chat",
		promptConfigId: configs.promptConfig?.id,
		chatId
	})

	const legacy = await legacyRender(
		db,
		{ chatId, userId, currentCharacterId, text },
		{
			connection: resolved.connection ?? { promptFormat: "vicuna" },
			sampling: resolved.sampling ?? configs.sampling,
			contextConfig: configs.contextConfig,
			promptConfig: configs.promptConfig
		}
	)

	const receipt: any = await runTurn({
		db,
		chatId,
		userId,
		currentCharacterId,
		text,
		preview: true,
		seed: `compare:${chatId}`
	})

	if (!receipt.preview)
		return {
			legacy,
			pipeline: "",
			stopped:
				`${receipt.outcome}` +
				(receipt.haltNodeKey ? ` at '${receipt.haltNodeKey}'` : "") +
				(receipt.haltReason ? ` — ${receipt.haltReason}` : "")
		}

	const rendered = receipt.preview.context?.rendered
	return {
		legacy,
		pipeline:
			typeof rendered === "string"
				? rendered
				: (rendered?.rendered ?? JSON.stringify(rendered)),
		receipt
	}
}

/**
 * Both prompts in full, for when the excerpt is not enough.
 *
 * `checkParity` reports the first difference with sixty characters of context,
 * which is the right default and is useless when the difference is structural —
 * a block in a different place, a section rendered twice. This is the escape
 * hatch, behind `PROMPT_DIFF=1` so it is not the default output.
 */
export async function comparePromptTexts(request: CompareRequest): Promise<{
	legacy: string
	pipeline: string
}> {
	const result = await compareBoth(request)
	return { legacy: result.legacy, pipeline: result.pipeline }
}
