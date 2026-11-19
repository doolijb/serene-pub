/**
 * Provider bindings: embedding, text generation (`generateBinding`, shared by
 * generate-text and generate-with-tools), transcription, JSON generation
 * (`generateJsonBinding`), image generation, speech, and the tool call.
 * `coreBindings()` spreads this map.
 *
 * Imports helpers from `bindings.shared.ts`, never from `bindings.ts`.
 */

import type { Bindings } from "@serene-pub/sdk"
import { ok, halt, reads } from "@serene-pub/sdk"
/**
 * The node declarations themselves, as types.
 *
 * `import type`, so `verbatimModuleSyntax` erases it outright: importing
 * contracts for real would run `describeQueryDefinition`'s `register()` for every core
 * type as a side effect of loading the runtime, which is the boot sequence's job
 * and not this file's.
 */
import type * as C from "@serene-pub/contracts"
import type {
	NodeInput,
	OracleCtx,
	SharedInput,
	Supplied
} from "./bindingTypes"
import {
	planTranscription,
	withTranscripts
} from "$lib/server/attachments/transcription"
import { explicitStopsFrom } from "$lib/server/connections/stops"
import { streamingModeFrom } from "$lib/server/connections/streaming"
import { ComposedError } from "$lib/server/connections/visibility"
import { STATUS } from "./bindings.shared"

/**
 * A tool's answer, written the way the model was taught to write its question.
 *
 * The mirror of `advertise-tools`' prompt door: it teaches one fenced block
 * called `tool_call`, so a result comes back in a `tool_result` block. One
 * convention, both directions — a model that learned the first reads the
 * second without being told, and a person reading the transcript can see
 * exactly what the model was given.
 *
 * JSON rather than prose because the payload is data with a shape (see
 * `project_json_prompt_rationale`), and truncated because a tool that returns
 * a hundred entries would otherwise spend the next prompt's whole budget on
 * one answer — the model is told it was truncated rather than left to conclude
 * the world is small.
 */
const TOOL_RESULT_LIMIT = 6000

export function renderToolResult(result: unknown): string {
	let body: string
	try {
		body = JSON.stringify(result ?? null, null, 0) ?? "null"
	} catch {
		body = JSON.stringify({
			error: "the tool returned something unreadable"
		})
	}
	const truncated =
		body.length > TOOL_RESULT_LIMIT
			? body.slice(0, TOOL_RESULT_LIMIT) +
				` … (truncated at ${TOOL_RESULT_LIMIT} characters)`
			: body
	return "```tool_result\n" + truncated + "\n```"
}

/**
 * Generate, for both pins (20 §9).
 *
 * `core:oracle/generate-text@1` and `core:oracle/generate-with-tools@1`
 * differ by two ports and nothing else, and the second exists only because the
 * first is published and frozen. One function so the two cannot come to
 * disagree about a stop sequence or an attachment — the failure two copies of
 * a fifty-line forward always eventually produce.
 *
 * The input is the INTERSECTION of the two contracts, which is what makes
 * binding one function to two ids sound: every name read here is declared by
 * whichever one the run resolved. The two ports outside that intersection —
 * `tools` in and `toolCall` out — are named as `Supplied`, because they are
 * genuinely wired on one of the two.
 */
/**
 * One handler, two pins — and two DIFFERENT read declarations, which is why it
 * is bound through a per-pin arrow below rather than registered twice as the
 * same function object. `reads` attaches to the function, so a shared handler
 * carries one declaration; `generate-with-tools@1` reads `tools` and
 * `generate-text@1` declares no such port, and each pin says exactly its own.
 */

const generateBinding = async (
	input: SharedInput<
		[typeof C.generateText, typeof C.generateWithTools],
		Supplied<
			"tools",
			"the `tools` in-port of core:oracle/generate-with-tools@1, which the other pin does not declare"
		>
	>,
	ctx: OracleCtx
) => {
	// Before the call, not after: the status is what the person reads WHILE
	// the model writes (R-19). The queue may interpose *waiting for the
	// model* / *loading the model* and restores this once it generates.
	ctx.status?.(STATUS.typing)
	const result: any = await ctx.call({
		// The rendered prompt: the assemble node's output on the declared
		// `context` port. `compiledPrompt` is the CALL payload's word for it
		// (`host.ts` reads `p.compiledPrompt`). No input-side alias
		// (`input.compiledPrompt`, `input.main`) and no
		// `generatingMessageMetadata` forward: neither definition declares
		// those names, nothing supplies them, and the host defaults the
		// metadata to `{}` itself (R-12).
		compiledPrompt: input?.context,
		currentCharacterId: input?.currentCharacterId ?? null,
		// The node's own slots — tier 2, and the top one, of
		// `capability default → pipeline config`.
		//
		// Forwarded here for the same reason the `generate-image` binding
		// below forwards them, and their absence was the reason the
		// panel's Connection and Sampling pickers on the reply step were
		// decoration: the values stored, and no reader ever saw them. The
		// host resolves them; this binding only has to stop dropping them.
		connection: input?.connection ?? null,
		sampling: input?.sampling ?? null,
		// The files this step's `attachments` port carries, as media
		// REFERENCES and in order. Forwarded rather than resolved: the
		// substrate turns a uuid into bytes, having first checked it
		// against the run — a binding never sees the bytes, exactly as it
		// never sees the connection.
		attachments: input?.attachments,
		/**
		 * The author's own stop sequences (ruling 2026-09-10).
		 *
		 * ⚠ **Declared since this node definition was written and read by
		 * nothing** — the third member of the dead-control family bugs
		 * 12 and 15 kept finding, and the one `paramsSlotWiring.test.ts`
		 * carries three ledger lines for. The panel rendered the
		 * textarea, the scope chain stored the lines, and no request
		 * ever carried them.
		 *
		 * Forwarded rather than composed: this is the EXPLICIT kind, and
		 * the other two — the completion template's own list and the
		 * scene's speaker labels — are derived from facts the dispatch
		 * already holds. `connections/stops.ts` puts all three together
		 * once and applies the wire rule; an author's sequence is their
		 * choice rather than the template's, so it is the one kind that
		 * rides either wire.
		 *
		 * ⚠ A spec must NAME the slot (`params: slot.params()`) for this
		 * to be anything but `undefined` — `resolveInput` resolves only
		 * the config keys a node's config mentions. The three shipped
		 * reply specs do not name it yet; that half is core-catalog work.
		 */
		stopSequences: explicitStopsFrom(input?.params?.stopSequences),
		/**
		 * How this step is sent — `auto` defers to the connection, `off` forces
		 * one request and waits.
		 *
		 * The same slot as the stop sequences and the same rule: forwarded
		 * rather than resolved, because what `auto` means is the CONNECTION's
		 * answer and a binding never sees one.
		 */
		streaming: streamingModeFrom(input?.params?.streaming),
		/**
		 * The advertisement's native door, forwarded verbatim.
		 *
		 * Undefined on `generate-text`, which declares no such port, so that
		 * node's request is byte-identical to what it always was. The dispatch
		 * REFUSES a request carrying tools that its connection or adapter
		 * cannot send rather than sending it stripped — see there.
		 */
		tools: Array.isArray(input?.tools) ? input.tools : undefined,
		/**
		 * 🚧 What the step asks the model to WRITE (O6) — `params.outputs`,
		 * `["text"]` unless stated — and, for a spoken reply, the speech
		 * sampling's values (O7). Forwarded, never interpreted: the dispatch
		 * derives the requirement (`requirementForOutputs`) and refuses a
		 * pair that cannot write what was asked, in words.
		 */
		outputs: Array.isArray((input?.params as { outputs?: unknown } | undefined)?.outputs)
			? ((input!.params as { outputs: unknown[] }).outputs).filter(
					(k): k is string => typeof k === "string" && !!k
				)
			: undefined,
		speechSampling: (input as { speechSampling?: unknown })?.speechSampling ?? null
	})

	/**
	 * What the provider said about the prompt it just read (ruled "later,
	 * non-disruptive").
	 *
	 * ⚠ **Before the halts below, deliberately.** A run that was cancelled
	 * mid-generation, or that came back with nothing, still paid for the prompt
	 * — and those are exactly the turns somebody asks about. Reported to the
	 * RECEIPT rather than put on a port: it is accounting about the call, not a
	 * value the next node consumes.
	 *
	 * Only the numbers the service actually gave. Several report none, and
	 * absent must not become zero — see `OracleCtx.reportCacheUsage`.
	 */
	if (
		typeof result?.tokensPrompt === "number" ||
		typeof result?.tokensCached === "number" ||
		typeof result?.tokensCacheWrite === "number"
	)
		ctx.reportCacheUsage?.({
			...(typeof result.tokensPrompt === "number"
				? { prompt: result.tokensPrompt }
				: {}),
			...(typeof result.tokensCached === "number"
				? { cached: result.tokensCached }
				: {}),
			...(typeof result.tokensCacheWrite === "number"
				? { cacheWrite: result.tokensCacheWrite }
				: {})
		})

	/**
	 * What the request could not carry of the sampling config.
	 *
	 * ⚠ **Before the halts below, for the same reason the counts above
	 * are.** A run that came back with nothing still sent a request, and a
	 * request that dropped a sampler is exactly the one somebody asks
	 * about. Reported only when the adapter left something out, so a node
	 * that carried everything writes nothing to the receipt.
	 *
	 * The same channel `generate-image` reports on further down, for the
	 * same reason it does: "why did changing this do nothing" has no
	 * answer anywhere else on the screen.
	 */
	if (Array.isArray(result?.samplingIgnored) && result.samplingIgnored.length)
		ctx.reportSampling?.(
			result.samplingApplied ?? {},
			result.samplingIgnored
		)

	if (result?.isAborted)
		return halt("generation was aborted before the model finished")
	if (!result?.text)
		// Never name the provider type in this string. `haltReason` is a
		// plain string on the SDK receipt, so nothing downstream can
		// take it back out again — and a non-admin reads their own
		// receipt through `pipelines:run`. That fact goes on the field
		// below, which the projection can remove.
		return halt("the model returned nothing — there is no message to write")

	/**
	 * 🚧 The reply as PARTS, in order (O5): its reasoning, its prose, then
	 * every media part the model wrote — a spoken reply's audio, stored and
	 * referenced by the host. `main`/`text` stay the prose alone, so every
	 * spec wired to them reads what it always read; a write wired to `parts`
	 * (`update-message`) lands the media in the model's order.
	 */
	const parts: import("@serene-pub/sdk").OutputPart[] = [
		...(result.reasoning ? [{ t: "reasoning" as const, text: result.reasoning }] : []),
		{ t: "text" as const, text: result.text },
		...(Array.isArray(result.media)
			? (result.media as import("@serene-pub/sdk").MediaRef[]).map((ref) => ({
					t: "media" as const,
					ref
				}))
			: [])
	]
	return ok({
		main: result.text,
		text: result.text,
		parts,
		reasoning: result.reasoning,
		// The connection *type*, not the connection: enough to answer
		// "which provider answered this turn" from the receipt, and
		// nothing that could be replayed by whoever reads it.
		//
		// Under `connection` rather than as a bare `via` string, because
		// this value IS the node's receipt output and a non-admin can
		// fetch their own receipt. Which provider the administrator runs
		// is still the administrator's business; the projection removes
		// this key for everyone else.
		connection: { type: result.via },
		/**
		 * What this request stopped on, and what it was not allowed to.
		 *
		 * On the node's OUTPUT because that is where a receipt reader
		 * looks, and because the failure it reports has no error
		 * attached to it: a stop sequence the model never saw means a
		 * reply that runs on past its turn, and one held back by the
		 * wire rule is a control that looks configured and is not.
		 * `dropped` is the half that answers "why is my stop sequence
		 * not working"; `wire` names the rule that decided.
		 *
		 * Carries no connection identity — three kinds, some strings the
		 * user themselves wrote, and the wire mode — so the projection
		 * has nothing to remove here.
		 */
		stops: result.stops,
		/**
		 * What the adapter put on the wire, and what came back.
		 *
		 * On the output beside `stops` for the same reason `stops` is there, and
		 * under the same rule `connection` above follows: this one names the
		 * base URL, the model and the body, so the projection removes the whole
		 * key for everyone who is not an administrator. Absent on an adapter
		 * that recorded nothing.
		 */
		...(result.wire ? { wire: result.wire } : {}),
		/**
		 * `{ tool, args }` or null — the same shape `parse-tool-call`
		 * publishes, so `run-tool` and a loop's predicate take either door
		 * without knowing which was used.
		 *
		 * Published from both pins, and always null on `generate-text`: an
		 * out-port the contract does not declare is unreachable from any spec,
		 * so it costs that node one key in its receipt output — and the
		 * alternative is a branch on the type id inside a function whose whole
		 * point is not having one.
		 */
		toolCall: result.toolCall ?? null
	})
}

/**
 * Select what a downstream port can take, from a document it cannot reach into.
 *
 * A data reference is `{node, port}` with no sub-path, so `path` is how one node
 * serves both the step that reads the whole answer and the block that iterates
 * one list inside it — the same parameter and the same spelling `parse-json@1`
 * carries.
 *
 * Several comma-separated paths join in order. That is what makes an answer
 * split into ARMS wireable: a schema can only be strict about a list whose items
 * are all one shape, so a keeper that reports values and item moves reports two
 * lists, and the node that resolves them takes one.
 */

export function selectJsonPaths(
	json: unknown,
	path: unknown
): { value: unknown; items: unknown[] } {
	const spec = typeof path === "string" ? path.trim() : ""
	const at = (dotted: string): unknown => {
		let value: unknown = json
		for (const segment of dotted ? dotted.split(".") : []) {
			if (value == null || typeof value !== "object") return undefined
			value = (value as Record<string, unknown>)[segment]
		}
		return value
	}
	// A single value becomes a one-element list and an absent one an empty
	// list, so a `map` wired to `items` is always wired to a list.
	const listed = (value: unknown): unknown[] =>
		Array.isArray(value) ? value : value == null ? [] : [value]

	const paths = spec
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)
	if (paths.length <= 1) {
		const value = at(paths[0] ?? "")
		return { value, items: listed(value) }
	}
	const items = paths.flatMap((p) => listed(at(p)))
	// `value` IS the joined list when several paths were named: there is no
	// single value to publish, and a reader of `value` on a multi-path node is
	// asking the same question `items` answers.
	return { value: items, items }
}

/**
 * Generate a DOCUMENT.
 *
 * Its own function rather than a third id on `generateBinding`, and the reason
 * is the shape of the request rather than the shape of the code: that one
 * forwards a turn — a speaker, the files travelling with it, the assistant line
 * the model continues — and this one forwards a question. The two share a
 * dispatcher, which is where the parts that genuinely are the same live.
 *
 * ⚠ **The absence of a trailing assistant line is the TRANSCRIPT's guarantee,
 * not this function's.** By the time a prompt reaches here it has been rendered,
 * and on a completion wire the seed is an open block inside one string that
 * nothing can take back out. `core:task/prose-transcript@1` is where the line is
 * never written, and the shipped spec wires it for exactly that reason.
 */
const generateJsonBinding = async (
	input: NodeInput<typeof C.generateJson>,
	ctx: OracleCtx
) => {
	// A question, not a turn (§9): the planner and the state-keeper think;
	// only the oracle that writes the prose types.
	ctx.status?.(STATUS.thinking)
	const result: any = await ctx.call({
		compiledPrompt: input?.context,
		// Names no speaker: the stop composer's speaker labels and the
		// continuation machinery both key on this, and neither belongs on a
		// request that is not somebody's turn.
		currentCharacterId: null,
		connection: input?.connection ?? null,
		sampling: input?.sampling ?? null,
		stopSequences: explicitStopsFrom(input?.params?.stopSequences),
		// Same slot, same rule as on the turn-taking sibling above: `auto` is
		// the connection's answer and only the dispatch has the connection.
		streaming: streamingModeFrom(input?.params?.streaming),
		// The ask. Which door it goes out through is the dispatch's answer,
		// because only the dispatch has the connection.
		schema: input?.schema ?? undefined
	})

	if (
		typeof result?.tokensPrompt === "number" ||
		typeof result?.tokensCached === "number" ||
		typeof result?.tokensCacheWrite === "number"
	)
		ctx.reportCacheUsage?.({
			...(typeof result.tokensPrompt === "number"
				? { prompt: result.tokensPrompt }
				: {}),
			...(typeof result.tokensCached === "number"
				? { cached: result.tokensCached }
				: {}),
			...(typeof result.tokensCacheWrite === "number"
				? { cacheWrite: result.tokensCacheWrite }
				: {})
		})

	/**
	 * What the request could not carry of the sampling config.
	 *
	 * ⚠ **Before the halts below, for the same reason the counts above
	 * are.** A run that came back with nothing still sent a request, and a
	 * request that dropped a sampler is exactly the one somebody asks
	 * about. Reported only when the adapter left something out, so a node
	 * that carried everything writes nothing to the receipt.
	 *
	 * The same channel `generate-image` reports on further down, for the
	 * same reason it does: "why did changing this do nothing" has no
	 * answer anywhere else on the screen.
	 */
	if (Array.isArray(result?.samplingIgnored) && result.samplingIgnored.length)
		ctx.reportSampling?.(
			result.samplingApplied ?? {},
			result.samplingIgnored
		)

	if (result?.isAborted)
		return halt("generation was aborted before the model finished")
	/**
	 * 🚧 An empty answer halts — unless the step reads it as an unreadable one
	 * (`emptyIsUnreadable`, the Dungeon Crawler 100-turn walk, B7): then the
	 * check a spec places after the call — ask once more, then go on without
	 * it — runs, where the halt failed the turn on "there is no answer to read".
	 */
	if (!result?.text && input?.params?.emptyIsUnreadable !== true)
		return halt("the model returned nothing — there is no answer to read")

	/**
	 * An answer that cannot be read is reported, not thrown away.
	 *
	 * `json` is null and `parseError` says which way it failed, so a reader can
	 * tell a model that ignored its schema from one whose reply hit the token
	 * limit mid-document. The node is `optional`, so downstream this is the same
	 * absence a halt would have produced — with the sentence kept.
	 */
	const { extractJson, JsonExtractionError } = await import(
		"$lib/server/utils/extractJson"
	)
	let json: unknown = null
	let parseError: string | undefined
	if (!result?.text) parseError = "the model returned nothing — there is no answer to read"
	else try {
		json = JSON.parse(extractJson(result.text))
	} catch (e) {
		parseError =
			e instanceof JsonExtractionError && e.truncated
				? "the answer stopped in the middle of its JSON, which usually means the reply hit its token limit"
				: "the answer was not readable as JSON"
	}

	const { value, items } = selectJsonPaths(json, input?.params?.path)

	return ok({
		main: json,
		json,
		value,
		items,
		text: result?.text ?? "",
		// The connection TYPE, not the connection — the same key the projection
		// removes for everyone who is not an administrator.
		connection: { type: result.via },
		stops: result.stops,
		// The exchange, under the key the projection removes — see the
		// `generate-text` sibling above.
		...(result.wire ? { wire: result.wire } : {}),
		// Which door the request went out through. Without it, "the model
		// ignored the schema" and "no schema was ever sent" read identically.
		structured: result.structured ?? null,
		...(parseError ? { parseError } : {})
	})
}

export function providerBindings(): Bindings {
	return {
		// ── Providers ───────────────────────────────────────────────────────
		/**
		 * Embed text for semantic retrieval.
		 *
		 * A Provider rather than part of the vector Query, because a Query may
		 * not reach a model (16 §1) — and because putting the call on the spine
		 * is what makes it visible to the budget and the receipt. Retrieval that
		 * quietly embedded would be a model call nobody was billed for and
		 * nobody could see.
		 */
		/**
		 * Embedding, and the `enabled` setting that was declared and read by
		 * nothing.
		 *
		 * `enabled: 'auto' | 'on' | 'off'` has been on this node's params slot
		 * since it was written and this binding ignored it, which put it in the
		 * dead-control family bugs 12 and 15 kept finding. It is live now because
		 * the reply pipeline needs the middle value to mean something:
		 *
		 *   · **off** — do not call at all. No vectors, no model, no cost.
		 *   · **auto** (the default) — call, and treat a failure as *no vectors*
		 *     rather than as a failed turn. Most installs have no embedding
		 *     model loaded, and the host's answer for that case is a thrown
		 *     "no embedding model is loaded and validated". Under `auto` that is
		 *     not an error, it is an absence.
		 *   · **on** — call, and let a failure be a failure. Somebody who asked
		 *     for this explicitly should hear about it.
		 *
		 * ⚠ **`auto` is the plan's second governing rule in one branch**: *an
		 * unavailable mechanism subtracts a signal; it never reroutes, disables a
		 * path, or excludes a candidate.* The reason is not tidiness — loading an
		 * embedding model once silently removed almost all lore from prompts, and
		 * the inverse (not having one costing a turn) is the same class of
		 * failure pointed the other way.
		 *
		 * The *reason* is not swallowed with the error: `core:query/vector-search@1`
		 * reads `embedding_status` itself and puts "no embedding model is loaded
		 * and validated" on the receipt, which is where a reader looks. This node
		 * has no diagnostics port and inventing one would move its content hash.
		 *
		 * A node whose `params` slot is not wired gets `undefined` here and is
		 * treated as `auto`, which is the behaviour it had before this existed.
		 */
		"core:oracle/embed-text@1": reads<typeof C.embedText>(
			async (input: NodeInput<typeof C.embedText>, ctx: OracleCtx) => {
				const empty = ok({ main: null, vector: null, vectors: [] })
				const enabled = input?.params?.enabled ?? "auto"
				if (enabled === "off") return empty

				let result: any
				try {
					result = await ctx.call({
						text: input?.text,
						texts: input?.texts
					})
				} catch (e) {
					if (enabled === "on") throw e
					return empty
				}
				return ok({
					main: result?.vector ?? null,
					vector: result?.vector ?? null,
					vectors: result?.vectors ?? []
				})
			},
			// No connection slot (owner ruling D-c, 2026-10-05): the host
			// embeds through the install's active embedding connection
			// (`embeddingApi()`), and a pipeline never chooses it.
			{ ports: ["text", "texts"], params: ["enabled"] }
		),

		/**
		 * Generate.
		 *
		 * The binding is short because it is supposed to be: it names the effect
		 * and the host performs it (F19). Everything that could tempt a Provider
		 * into doing its own I/O — picking the connection, building the request,
		 * handling the stream — is on the other side of `ctx.call`, which is the
		 * side the budget, the receipt and the review gate can all see.
		 *
		 * It halts rather than errs when the model produced nothing. An empty
		 * completion is a thing that happens — a stop sequence at position zero, a
		 * context overflow, an aborted stream — and it is not a fault in the
		 * pipeline. Halting says "this run has no answer" where an `err` would send
		 * whoever is reading the receipt looking for a bug.
		 */
		"core:oracle/generate-text@1": reads<typeof C.generateText>(
			(input, ctx) => generateBinding(input, ctx),
			{
				ports: [
					"context",
					"currentCharacterId",
					"attachments",
					"connection",
					"sampling",
					"speechSampling"
				],
				params: ["stopSequences", "streaming", "outputs"]
			}
		),
		/**
		 * 🚧 **Transcribe audio** (O9) — the explicit step before placement.
		 * Pure where it can be: which files need hearing is decided here
		 * (`planTranscription`); nothing wanted — no audio, a call that hears
		 * it, a cached transcript — sends nothing and hands the record on as
		 * it came. The hearing itself is the host's (`ctx.call`): the
		 * Transcription loadout's pair, each file read under the run's
		 * access rule, each transcript cached on its file.
		 */
		"core:oracle/transcribe-audio@1": reads<typeof C.transcribeAudio>(
			async (input: NodeInput<typeof C.transcribeAudio>, ctx: OracleCtx) => {
				const attachments = (input?.attachments ?? {}) as Record<
					string,
					import("@serene-pub/sdk").HistoryAttachmentV1[]
				>
				const plan = planTranscription({
					lines: (input?.messages ?? []) as any[],
					attachments,
					hears: (input?.hears ?? null) as import("@serene-pub/sdk").ConnectionReadsV1 | null,
					mediaLookback: input?.params?.mediaLookback
				})
				if (!plan.wanted.length)
					return ok({ main: attachments, attachments, notes: [] })
				ctx.status?.(STATUS.listening)
				const heard = (await ctx.call({
					files: plan.wanted.map((f) => ({
						uuid: f.uuid,
						mime: f.mime,
						...(f.filename ? { filename: f.filename } : {})
					})),
					connection: input?.connection ?? null,
					language:
						typeof input?.params?.language === "string" &&
						input.params.language.trim()
							? input.params.language.trim()
							: undefined
				})) as { transcripts?: Record<string, string>; notes?: string[] }
				const merged = withTranscripts(attachments, heard?.transcripts ?? {})
				return ok({
					main: merged,
					attachments: merged,
					notes: Array.isArray(heard?.notes) ? heard.notes : []
				})
			},
			{
				ports: ["messages", "attachments", "hears", "connection"],
				params: ["mediaLookback", "language"]
			}
		),
		/**
		 * The structured door (A). A separate function above rather than a
		 * third id on the shared one: it forwards a question, not a turn.
		 */
		"core:oracle/generate-json@1": reads<typeof C.generateJson>(
			generateJsonBinding,
			{
				ports: ["context", "schema", "connection", "sampling"],
				params: ["path", "stopSequences", "streaming", "emptyIsUnreadable"]
			}
		),
		/**
		 * The native tool door (20 §9) — the same node with the declarations on
		 * the wire.
		 *
		 * One handler, two pins, so the two cannot drift about a stop sequence
		 * or an attachment. Its input is the INTERSECTION of the two contracts,
		 * which is what makes that sound: every name read below is declared by
		 * whichever one the run resolved. `tools` and `toolCall` are the two
		 * that are not in the intersection, and they are named at the site —
		 * and declared read on THIS pin alone, which is why each pin binds
		 * through its own arrow (see `generateBinding`).
		 */
		"core:oracle/generate-with-tools@1": reads<
			typeof C.generateWithTools
		>((input, ctx) => generateBinding(input, ctx), {
			ports: [
				"context",
				"tools",
				"currentCharacterId",
				"attachments",
				"connection",
				"sampling"
			],
			params: ["stopSequences", "streaming"]
		}),

		/**
		 * The image render — the structural twin of generate-text above.
		 *
		 * Thin on purpose: it forwards the slots' resolved values and hands back
		 * the references the substrate stored. Everything that varies between
		 * backends lives in the adapter, and everything that varies between
		 * installs lives in the connection and sampling rows; there is nothing
		 * left here for a binding to decide.
		 */
		"core:oracle/generate-image@1": reads<typeof C.generateImage>(
			async (
				input: NodeInput<typeof C.generateImage>,
				ctx: OracleCtx
			) => {
				const result: any = await ctx.call({
					// The declared `prompt` port; the `main` alias for an unrefined
					// `$.node` wiring that sat behind it had no supplier (R-12).
					prompt: input?.prompt ?? "",
					negative: input?.negative,
					prompts: input?.prompts,
					connection: input?.connection,
					sampling: input?.sampling,
					// The `workflow` slot (§4.10), which `host.ts` reads as
					// `p.workflow`. ⚠ Dropped here until §16 follow-up D3
					// (2026-10-12): the spec named it, the panel stored it,
					// the loadout layer filled it, and no render ever saw it.
					workflow: input?.workflow,
					init: input?.init,
					// The widened ports and params (DESIGN-image-generation
					// §4.1), forwarded as the host's binding reads them:
					// `references` and `series` as ports, the picture's
					// params (`orientation`, `cutOut`, the `references`
					// policy, `seed`) under `params`. Until I5 none of them
					// reached the host — it read four keys this payload
					// never carried.
					mask: input?.mask,
					references: input?.references,
					series: input?.series,
					params: {
						orientation: input?.params?.orientation,
						cutOut: input?.params?.cutOut,
						references: input?.params?.references,
						seed: input?.params?.seed
					},
					// `off` here means a render with no progress poll and no
					// previews — the image node's whole use for the parameter.
					streaming: streamingModeFrom(input?.params?.streaming)
				})

				// Halts rather than errs, for the same reason generate-text does: a
				// cancelled render is a run with no answer, not a fault to debug.
				if (result?.isAborted)
					return halt("the render was cancelled before it finished")
				if (!result?.media?.length)
					return halt(
						"the backend finished without returning an image"
					)

				// What the backend honoured and what it could not, on the receipt —
				// the only way "why did changing steps do nothing" is answerable.
				ctx.reportSampling?.(
					Object.fromEntries(
						(result.applied ?? []).map((k: string) => [k, true])
					),
					result.ignored ?? []
				)

				return ok({
					main: result.media,
					media: result.media,
					image: result.image,
					caption: result.caption
				})
			},
			{
				ports: [
					"prompt",
					"negative",
					"init",
					"mask",
					"references",
					"series",
					"prompts",
					"connection",
					"sampling",
					"workflow"
				],
				params: ["streaming", "orientation", "cutOut", "references", "seed"]
			}
		),

		/**
		 * 🚧 **Speak** (speech build, seam S3) — the line's cues in, one audio file
		 * out. The host does the work (`dispatchSpeech`): it groups the cues by
		 * voice and inflection, renders each group through the line template,
		 * resolves the voice, calls the Narration loadout's model once per group,
		 * joins the audio and stores it (spoken, owned by the session's owner).
		 *
		 * ⚠ **Any failure is "nothing spoken", never an error.** The step runs after
		 * the reply is saved, and a voice that could not be made must not turn a
		 * delivered reply into a failed turn (the sprite picker's posture): the
		 * ports publish null, `attach-audio` writes nothing, and the reason — a
		 * sentence that names no connection — goes to the run's log. A line with
		 * nothing to speak makes no call at all.
		 *
		 * `streaming` is read and treated as off (A5); no connection is published
		 * (R53) — the host records the one it used on the receipt's request.
		 */
		"core:oracle/speak@1": reads<typeof C.speak>(
			async (input: NodeInput<typeof C.speak>, ctx: OracleCtx) => {
				const none = (cueMap: unknown = { source: "none", spans: [] }) =>
					ok({ main: null, audio: null, cueMap, spokenAs: null, meta: null })
				const cues = Array.isArray(input?.cues) ? input.cues : []
				const text = typeof input?.text === "string" ? input.text : ""
				if (!cues.length && !text.trim()) return none()

				let result: any
				try {
					result = await ctx.call({
						cues,
						text,
						speaker: input?.speaker ?? null,
						language: input?.language ?? null,
						template: input?.template,
						prompts: input?.prompts,
						variables: input?.variables,
						connection: input?.connection,
						sampling: input?.sampling,
						params: {
							gapMs: input?.params?.gapMs,
							streaming: input?.params?.streaming
						}
					})
				} catch (e) {
					// A composed sentence names no connection and is safe to log;
					// anything else (an adapter's own words) stays on the server.
					ctx.log(
						"warn",
						e instanceof ComposedError
							? `not spoken: ${e.message}`
							: "not spoken: the speech step failed (see the server log)"
					)
					if (!(e instanceof ComposedError))
						console.warn("[speak] failed:", e instanceof Error ? e.message : e)
					return none()
				}
				for (const note of Array.isArray(result?.notes) ? result.notes : [])
					ctx.log("info", String(note))
				if (result?.isAborted || !result?.audio) return none()

				// What the service honoured and what it could not — the only way
				// "why did the speed do nothing" is answerable.
				ctx.reportSampling?.(
					Object.fromEntries((result.applied ?? []).map((k: string) => [k, true])),
					result.ignored ?? []
				)
				return ok({
					main: result.audio,
					audio: result.audio,
					cueMap: result.cueMap ?? { source: "none", spans: [] },
					spokenAs: result.spokenAs ?? null,
					meta: result.meta ?? null
				})
			},
			{
				ports: [
					"cues",
					"speaker",
					"language",
					"text",
					"connection",
					"sampling",
					"prompts",
					"template",
					"variables"
				],
				params: ["streaming", "gapMs"]
			}
		),

		/**
		 * The call itself — the one impure step of a tool loop (20 §9).
		 *
		 * Three rules, and each closes a way an agentic turn ends badly:
		 *
		 *  - **A null call is not an error.** It is the ordinary last
		 *    iteration, where the model answered in prose and the loop is
		 *    about to stop on its predicate. Nothing runs.
		 *  - **A tool that was not advertised is refused by name.** `tools` is
		 *    the list the model was actually given, so a name it invented
		 *    cannot reach a tool that exists but was withheld from this step —
		 *    and the refusal says the name, because a model that reads "unknown
		 *    tool" with no name asks for the same one again.
		 *  - **An error is a result.** `main` carries `{ tool, error }` and
		 *    `text` renders it, so the model reads what went wrong and tries
		 *    something else. A throw here would end the run at the one moment
		 *    the agent could have recovered.
		 *
		 * The time-box is the node definition's own `timeoutMs`: one invocation is
		 * one tool, so the executor's timeout already is the tool's, and a
		 * second deadline here could only disagree with it.
		 */
		"core:oracle/run-tool@1": reads<typeof C.runTool>(
			async (input: NodeInput<typeof C.runTool>, ctx: OracleCtx) => {
				const call = input?.call as
					| { tool?: unknown; args?: unknown }
					| null
					| undefined
				const tool = typeof call?.tool === "string" ? call.tool : ""
				// The ordinary last iteration: the model answered instead of
				// asking, so nothing runs and the prose is what this iteration
				// contributed to the conversation.
				if (!tool)
					return ok({
						main: null,
						text: "",
						answer: String(input?.text ?? "")
					})

				const advertised = (
					Array.isArray(input?.tools) ? input.tools : []
				)
					.map((t: any) => t?.name)
					.filter((n: unknown): n is string => typeof n === "string")
				if (advertised.length && !advertised.includes(tool)) {
					const refusal = {
						tool,
						error:
							`'${tool}' is not one of the tools offered here. ` +
							(advertised.length
								? `Available: ${advertised.join(", ")}.`
								: "No tools are offered on this step.")
					}
					return ok({
						main: refusal,
						text: renderToolResult(refusal),
						answer: ""
					})
				}

				const args =
					call?.args && typeof call.args === "object"
						? (call.args as Record<string, unknown>)
						: {}
				const result = (await ctx.call({ tool, args })) as Record<
					string,
					unknown
				>
				return ok({
					main: result,
					text: renderToolResult(result),
					// Empty because this iteration worked rather than answered:
					// the prose beside a tool call is the model narrating its own
					// reasoning, and the turn's reply is the iteration that made
					// no call. It is on the receipt either way.
					answer: ""
				})
			},
			{ ports: ["call", "tools", "text"] }
		),
	}
}
