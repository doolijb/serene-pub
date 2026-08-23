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

import { run, type NodeEvent, type Receipt } from "@serene-pub/sdk"
import { createReviewer } from "$lib/server/pipelines/runtime/reviewGate"
import { createHost, type HostScope } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { loadPublished, RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { saveReceipt } from "$lib/server/pipelines/runtime/receipts"
import { v4 as uuidv4 } from "uuid"

export class PipelineUnavailableError extends Error {}

export interface TurnRequest {
	db: any
	chatId: number
	userId: number
	/** Whose turn it is. Null in narrator mode. */
	currentCharacterId: number | null
	/** A message being composed but not stored — see `HostScope.draftMessage`. */
	draftMessage?: { content: string; personaId?: number | null }
	/** The message that triggered this turn. */
	text: string
	/** Which spec to run. Defaults to core's. */
	specId?: string
	/**
	 * The seed for anything that varies.
	 *
	 * **Defaults to a fresh value per turn, not to something derived from the
	 * chat.** It first defaulted to `turn:${chatId}`, which is constant for the
	 * life of a chat — so every turn would have picked the same example dialogue
	 * and the variety the seeding exists to preserve would have been quietly
	 * gone. The seed is recorded on the run row, so a caller reproducing a turn
	 * passes the recorded one back rather than reconstructing it.
	 */
	seed?: string
	/**
	 * This run's identity.
	 *
	 * Generated per run unless supplied. The SDK defaults it to the literal
	 * `"run:test"` when a host does not pass one, which is a reasonable default
	 * for a test and a trap for a host: every run would share an id, and the
	 * unique index on the receipt table is what caught it.
	 */
	runId?: string
	/** Where streamed tokens go while the model is still generating. */
	sink?: HostScope["sink"]
	signal?: AbortSignal
	/** Stop before the provider call and report what *would* be sent. */
	preview?: boolean
	/**
	 * Skip recording the receipt.
	 *
	 * For the comparison tool, which runs a preview against every chat on the
	 * instance and would otherwise fill the run history with rows nobody asked
	 * for. A real turn always records.
	 */
	skipReceipt?: boolean
}

/**
 * Any published spec, run against this chat — the entry every trigger shares.
 *
 * `runTurn` shapes the input for a chat reply; the summarize and graph-build
 * sockets shape theirs. What none of them get to vary is the substrate: the
 * same world, the same host, the same bindings, the same receipt rule —
 * because two entry points that assembled those differently would be two
 * pipelines wearing one name.
 */
export interface SpecRunRequest {
	db: any
	chatId: number
	userId: number
	/** Which spec to run. */
	specId: string
	/**
	 * Whose turn it is, when the spec has one. Null or absent in narrator mode
	 * and for specs with no speaker at all (summarize, graph build).
	 *
	 * Reaches the provider through `HostScope`, because the stop list has to
	 * exclude the speaking character's own name — see the note there.
	 */
	currentCharacterId?: number | null
	/** A message being composed but not stored — see `HostScope.draftMessage`. */
	draftMessage?: { content: string; personaId?: number | null }
	/** The input node's value, shaped by the caller for the spec it names. */
	input: unknown
	seed?: string
	runId?: string
	sink?: HostScope["sink"]
	/**
	 * Node lifecycle observation — the executor's inherent progress (F34).
	 * Fires for every invocation with identity and never a payload, so any
	 * surface can drive a progress card without knowing the pipeline.
	 */
	onNode?: (event: NodeEvent) => void
	signal?: AbortSignal
	/**
	 * Stop before a node and report what *would* happen there. `true` stops at
	 * the first Provider on the spine (debug preview); `{atNode}` stops at a
	 * named node — which is how a generate-and-review flow runs everything
	 * *except* its write, and hands the result to a person instead.
	 */
	preview?: boolean | { atNode: string }
	skipReceipt?: boolean
}

export async function runSpec(request: SpecRunRequest): Promise<Receipt> {
	const { specId } = request
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
		currentCharacterId: request.currentCharacterId,
		draftMessage: request.draftMessage,
		sink: request.sink,
		signal: request.signal
	}

	const receipt = await run(doc, {
		world: await buildWorld(request.db, {
			chatId: request.chatId,
			userId: request.userId,
			// Which pipeline is running, so its own configs and overrides are
			// read. Without it the run resolves against the legacy projection
			// only, and everything a person set in the pipeline panel is
			// invisible to the thing it was supposed to configure.
			specId
		}),
		input: request.input,
		runId: request.runId ?? uuidv4(),
		seed: request.seed ?? uuidv4(),
		triggerSource: request.preview ? "ui" : "event",
		preview: request.preview,
		bindings: coreBindings(),
		host: createHost(request.db, scope),
		onNode: request.onNode,
		// Every run can park at a gated node — the review position is a
		// config option (`settings.review`), so whether it *does* is the
		// person's to decide in the panel, never the trigger's to wire.
		reviewer: createReviewer({
			userId: request.userId,
			chatId: request.chatId,
			specId,
			signal: request.signal
		})
	})

	// Recorded before returning, and never allowed to fail the turn. A run that
	// produced a good reply and then could not write its own receipt has still
	// produced a good reply.
	if (!request.skipReceipt)
		await saveReceipt(request.db, receipt, {
			chatId: request.chatId,
			userId: request.userId,
			messageId: writtenMessageId(receipt) ?? undefined
		})

	return receipt
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
	return await runSpec({
		db: request.db,
		chatId: request.chatId,
		userId: request.userId,
		specId: request.specId ?? RESPOND_SPEC_ID,
		currentCharacterId: request.currentCharacterId,
		draftMessage: request.draftMessage,
		input: {
			text: request.text,
			// Both as ports and bundled. A query that wants the pair takes the
			// scope; a node that wants only the speaker takes the id, instead
			// of accepting the whole scope and reaching into it.
			chatId: request.chatId,
			characterId: request.currentCharacterId ?? null,
			// The speaker rides on the chat scope: a scope for a turn is this
			// chat *and* whose turn it is.
			chatScope: {
				chatId: request.chatId,
				currentCharacterId: request.currentCharacterId
			}
		},
		seed: request.seed,
		runId: request.runId,
		sink: request.sink,
		signal: request.signal,
		preview: request.preview,
		skipReceipt: request.skipReceipt
	})
}

/**
 * The row a Consumer wrote, read back off the receipt.
 *
 * Linking the run to its message is what turns "why does this reply say that"
 * into a lookup. The id is not known when the run starts — the Consumer creates
 * the row mid-run — so it is read from the write result afterwards.
 *
 * **The discriminant is checked, not assumed.** A Consumer publishes
 * `write-result@1`: `{status: "committed", ids}` or `{status: "pending",
 * proposalId}`, because under async review a write is a *proposal* a reviewer
 * may still reject. The first version of this reached straight for an id and
 * would have linked a run to a row that does not exist yet — which is precisely
 * the failure the shape is discriminated to prevent, and the reason it is
 * deliberately not assignable to `row-ids@1`.
 */
export function writtenMessageId(receipt: Receipt): number | null {
	for (const node of receipt.nodes) {
		if (node.kind !== "consumer") continue
		const out = node.output as any
		if (out?.status !== "committed") continue
		const id = out?.ids?.id
		if (typeof id === "number") return id
	}
	return null
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
