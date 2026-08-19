/**
 * Sending a prompt that was built somewhere else.
 *
 * The legacy path builds and sends in one call, so there is no moment between
 * "the payload exists" and "the payload was sent" — which is the entire debug
 * preview, and also the reason a review gate has nothing to show. The pipeline
 * splits them: a Task assembles, this dispatches.
 *
 * It reaches the **same seven adapters** through the same `generate()`. There is
 * no second HTTP client here and no second request shape; `withCompiledPrompt`
 * makes `compilePrompt()` return the supplied payload instead of building one,
 * and everything after that is untouched legacy code. That is what makes parity
 * checkable rather than asserted — a pipeline run and a legacy run differ only
 * in who built the prompt.
 *
 * ## What does not cross this line
 *
 * The connection — its URL, its key, its headers, its model id — is resolved
 * here and **never returned**. A binding asks for text and receives text. This
 * is not a convention that could be relaxed later for a plugin that "just needs
 * the base URL": a Provider that could read connection material would be a
 * plugin that can exfiltrate an API key by describing an effect, and the review
 * gate would show a perfectly innocent-looking node.
 *
 * What comes back is the completion, whether it was aborted, and token counts.
 */

import { resolveTaskConfig } from "$lib/server/utils/resolveTaskConfig"
import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"

export class DispatchError extends Error {}

/** Just the query surface this module needs, so any caller's db will do. */
export interface DbLike {
	query: { chats: { findFirst: (args: unknown) => Promise<any> } }
}

export interface DispatchRequest {
	/** The payload an adapter would otherwise have built for itself. */
	compiledPrompt: unknown
	/**
	 * The database the run is against — handed in, not imported.
	 *
	 * This started as an `import("$lib/server/db")` and the end-to-end test
	 * caught it: the pipeline ran against a test database and the dispatch
	 * quietly read from the application's, reporting the chat as deleted. A
	 * module that reaches for the global connection is one that cannot be run
	 * against anything else, which includes every future case where "anything
	 * else" matters — a dry run, a replay, a second instance.
	 */
	db: DbLike
	chatId: number
	userId?: number
	/** Null in narrator mode, matching the legacy adapter's own convention. */
	currentCharacterId?: number | null
	/** Forwarded verbatim; carries `isNarratorResponse` among other things. */
	generatingMessageMetadata?: Record<string, unknown>
	/** Called with each chunk when the adapter streams. */
	onChunk?: (chunk: string) => void
	onThinking?: (chunk: string) => void
	signal?: AbortSignal
}

export interface DispatchResult {
	text: string
	thinking?: string
	isAborted: boolean
	/** Which adapter answered, by connection type — a label, not a handle. */
	via: string
}

/**
 * The hydrated chat an adapter's constructor needs.
 *
 * Read here rather than passed along a data edge. It is a large object with a
 * user's whole cast in it, and a pipeline value is a thing that lands in the
 * receipt and in every downstream node's input — the prompt text is what the
 * pipeline is carrying, not the rows it came from.
 */
async function loadAdapterChat(db: DbLike, chatId: number) {
	const chat = await db.query.chats.findFirst({
		where: (c: any, { eq }: any) => eq(c.id, chatId),
		with: {
			chatCharacters: { with: { character: true } },
			chatPersonas: { with: { persona: true } },
			lorebook: { with: { lorebookBindings: true } }
		}
	})
	if (!chat)
		throw new DispatchError(
			`there is no chat ${chatId} to generate in — it was deleted while the run was in flight`
		)

	// Same filter the legacy path applies: these FKs are nullable with
	// `onDelete: "set null"`, so a deleted character leaves a row with nothing
	// to prompt from, and `BasePromptChat` requires the relation to be present
	// on the rows it does list.
	return {
		...chat,
		chatCharacters: (chat.chatCharacters ?? []).filter(
			(cc: any) => cc.character !== null
		),
		chatPersonas: (chat.chatPersonas ?? []).filter(
			(cp: any) => cp.persona !== null
		)
	}
}

/**
 * Turn Assemble's allocated context into the payload an adapter expects.
 *
 * Assemble publishes **blocks plus a rendered string**, deliberately — that is
 * the shape the budget panel and the `why` trail need (16 §7). An adapter wants
 * `{prompt, messages, meta}`. Something has to bridge the two, and it is here
 * rather than in a Task because the bridge needs the connection's prompt format,
 * and a Task is handed no connection at all.
 *
 * This gap was invisible until a parity run: the spine test passed because its
 * fake adapter accepted whatever it was given, so the pipeline was handing a
 * real adapter an object with no `prompt` and no `messages` on it — which would
 * have generated from an empty string and read as a model fault.
 *
 * A payload that already looks compiled passes through untouched, so a plugin
 * that assembles its own wire format is not forced back through core's.
 */
export function toCompiledPrompt(
	payload: any,
	connection: { promptFormat?: string | null },
	meta: { currentCharacterId?: number | null; messageCount?: number } = {}
): any {
	if (
		payload &&
		(payload.prompt !== undefined || payload.messages !== undefined)
	)
		return payload

	const rendered = payload?.rendered
	const messages = payload?.messages
	if (rendered === undefined && messages === undefined)
		throw new DispatchError(
			"the assembled context carried neither a rendered prompt nor a message array. " +
				"Assemble produces one or the other depending on the connection's prompt " +
				"format; receiving neither means the render step did not run."
		)

	return {
		prompt: rendered,
		messages,
		meta: {
			promptFormat: connection.promptFormat ?? "vicuna",
			// Null rather than invented. The pipeline knows which template *engine*
			// rendered this but not the config's display name, and a plausible-looking
			// wrong name in the debug panel is worse than an honest blank.
			templateName: null,
			timestamp: new Date().toISOString(),
			// The pipeline does not truncate by dropping text off the end; it allocates
			// a budget and records per block why each one was included or not. That
			// trail is in the receipt, which is strictly more than this field held.
			truncationReason: null,
			currentTurnCharacterId: meta.currentCharacterId ?? null,
			tokenCounts: {
				total: payload?.totalTokens ?? 0,
				limit: payload?.budget?.total ?? 0
			},
			chatMessages: {
				included: countIncluded(payload, "history"),
				total: meta.messageCount ?? countIncluded(payload, "history"),
				includedIds: idsOf(payload, true),
				excludedIds: idsOf(payload, false)
			},
			sources: payload?.groups ?? {}
		}
	}
}

const countIncluded = (payload: any, source: string): number =>
	(payload?.blocks ?? []).filter(
		(b: any) => b.included && b.source === source
	).length

const idsOf = (payload: any, included: boolean): number[] =>
	(payload?.blocks ?? [])
		.filter(
			(b: any) =>
				Boolean(b.included) === included && b.source === "history"
		)
		.map((b: any) => b.id)
		.filter((id: unknown): id is number => typeof id === "number")

export async function dispatchGeneration(
	request: DispatchRequest
): Promise<DispatchResult> {
	if (!request.compiledPrompt)
		throw new DispatchError(
			"dispatch was given no prompt to send. A Provider with an empty payload would " +
				"generate from nothing and return something that reads like a model problem."
		)

	const isNarrator = Boolean(
		request.generatingMessageMetadata?.isNarratorResponse
	)

	const chat = await loadAdapterChat(request.db, request.chatId)
	const {
		sampling: defaultSampling,
		contextConfig,
		promptConfig
	} = await getUserConfigurations(request.userId as number)

	// The same resolver the legacy path uses, so a chat-level connection
	// override or a per-config one applies identically on both paths. Resolving
	// it again here rather than threading it through the pipeline is deliberate:
	// see the header.
	const resolved = await resolveTaskConfig({
		taskType: isNarrator ? "narratorPrompt" : "chat",
		promptConfigId: promptConfig?.id,
		chatId: request.chatId
	})

	const connection = resolved.connection
	if (!connection)
		throw new DispatchError(
			"no AI connection is configured, so there is nothing to send this prompt to. " +
				"Set one up under Connections."
		)

	const { Adapter } = await getConnectionAdapter(connection.type)
	const adapter = new Adapter({
		chat: chat as any,
		connection,
		sampling: resolved.sampling ?? defaultSampling,
		contextConfig,
		promptConfig,
		currentCharacterId: request.currentCharacterId ?? null,
		tokenCounter: new TokenCounters(
			(connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
		),
		tokenLimit: 4096,
		contextThresholdPercent: 0.8,
		generatingMessageMetadata: request.generatingMessageMetadata ?? {}
	})

	// After this line the adapter builds nothing. Everything below is the same
	// code the legacy path runs.
	adapter.withCompiledPrompt(
		toCompiledPrompt(request.compiledPrompt, connection, {
			currentCharacterId: request.currentCharacterId ?? null
		})
	)

	// An abort has to reach the adapter's own flag; the signal alone would stop
	// this function while the request kept running against the provider.
	const onAbort = () => adapter.abort()
	request.signal?.addEventListener("abort", onAbort, { once: true })

	try {
		const result = await adapter.generate()
		let text = ""
		let thinking = ""

		if (typeof result.completionResult === "function") {
			// Streaming. The chunks are forwarded *and* accumulated: the caller
			// may be driving a socket, and the pipeline still needs one value to
			// put on the port. Accumulating only would make the pipeline path
			// feel slower than the legacy one for the same model.
			await result.completionResult(
				(chunk: string) => {
					text += chunk
					request.onChunk?.(chunk)
				},
				(chunk: string) => {
					thinking += chunk
					request.onThinking?.(chunk)
				}
			)
		} else {
			text = result.completionResult ?? ""
			thinking = result.thinkingContent ?? ""
			// Non-streaming adapters return thinking in one piece rather than
			// through the callback, so it is forwarded here instead.
			if (thinking) request.onThinking?.(thinking)
			if (text) request.onChunk?.(text)
		}

		return {
			text,
			thinking: thinking || undefined,
			isAborted: Boolean(result.isAborted),
			via: connection.type
		}
	} finally {
		request.signal?.removeEventListener("abort", onAbort)
	}
}
