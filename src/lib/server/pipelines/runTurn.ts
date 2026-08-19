/**
 * One chat turn, run as a pipeline.
 *
 * This is the entry point the app calls instead of constructing a
 * `PromptBuilder` and an adapter: load the published spec, build the config
 * world and the host, run, hand back the receipt.
 *
 * **It does not replace anything by itself.** The legacy path is still what
 * `generateResponse.ts` runs; this exists so the switch is a small, deliberate
 * change at one call site rather than a rewrite of the generation path. The
 * parity corpus is what makes that switch safe to make — until it was green,
 * a function like this was a second implementation with a nicer name.
 *
 * ## Streaming
 *
 * Tokens reach the user through the host's `sink`, not through the pipeline's
 * values. A socket handle is not a value: it would land in the receipt and in
 * every downstream node's input. The port still carries the finished text, so
 * the run is complete and replayable while the user watched it arrive.
 */

import { run, type Receipt } from "@serene-pub/sdk"
import { createHost, type HostScope } from "./host"
import { buildWorld } from "./world"
import { coreBindings } from "./bindings"
import { loadPublished, RESPOND_SPEC_ID } from "./bootstrap"

export class PipelineUnavailableError extends Error {}

export interface TurnRequest {
	db: any
	chatId: number
	userId: number
	/** Whose turn it is. Null in narrator mode. */
	currentCharacterId: number | null
	/** The message that triggered this turn. */
	text: string
	/** Which spec to run. Defaults to core's. */
	specId?: string
	/**
	 * The run's identity, and the seed for anything that varies.
	 *
	 * Passed in rather than generated here so a caller retrying a turn can
	 * reproduce it exactly — the example-dialogue pick and anything else a type
	 * declares randomness for come from this.
	 */
	seed?: string
	/** Where streamed tokens go while the model is still generating. */
	sink?: HostScope["sink"]
	signal?: AbortSignal
	/** Stop before the provider call and report what *would* be sent. */
	preview?: boolean
}

/**
 * Run a turn and return its receipt.
 *
 * The receipt is the return value rather than the generated text, and that is
 * deliberate: a caller needs to know *whether* it ran, what it decided, and what
 * it wrote, and a turn that halted legibly is a normal outcome rather than an
 * exception. Text is on the receipt for callers that only want that.
 */
export async function runTurn(request: TurnRequest): Promise<Receipt> {
	const specId = request.specId ?? RESPOND_SPEC_ID
	const doc = await loadPublished(request.db, specId)
	if (!doc)
		throw new PipelineUnavailableError(
			`no published version of '${specId}'. Core publishes its own at startup, so ` +
				`this usually means the type registry refused to sync — check the server log ` +
				`for a pipeline bootstrap warning.`
		)

	const scope: HostScope = {
		chatId: request.chatId,
		userId: request.userId,
		sink: request.sink,
		signal: request.signal
	}

	return await run(doc, {
		world: await buildWorld(request.db, {
			chatId: request.chatId,
			userId: request.userId
		}),
		input: {
			text: request.text,
			// The speaker rides on the chat scope: a scope for a turn is this
			// chat *and* whose turn it is.
			chatScope: {
				chatId: request.chatId,
				currentCharacterId: request.currentCharacterId
			}
		},
		seed: request.seed ?? `turn:${request.chatId}`,
		triggerSource: request.preview ? "ui" : "event",
		preview: request.preview,
		bindings: coreBindings(),
		host: createHost(request.db, scope)
	})
}

/** The text a completed turn produced, or null if it did not produce one. */
export function generatedText(receipt: Receipt): string | null {
	const node = receipt.nodes.find(
		(n) => n.typeId === "core:provider/generate-text@1"
	)
	const text = (node?.output as any)?.text
	return typeof text === "string" && text.length > 0 ? text : null
}

/**
 * Why a turn produced nothing, in a sentence a user could be shown.
 *
 * A halt is not a failure — an aborted generation and an empty completion both
 * halt — so this reads the receipt rather than assuming an error. Returns null
 * when the run finished normally.
 */
export function haltExplanation(receipt: Receipt): string | null {
	if (receipt.outcome === "ok") return null
	const at = receipt.haltNodeKey
	const why = receipt.haltReason ?? "the run stopped without saying why"
	return at ? `${why} (at '${at}')` : why
}
