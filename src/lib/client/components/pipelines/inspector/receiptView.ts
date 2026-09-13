/**
 * A run receipt, projected into what the inspector draws.
 *
 * Pure, and in a `.ts` rather than in the component, so "which nodes ran",
 * "what does this run's one-line verdict say" and "what did the wire rule hold
 * back" are assertable against a saved receipt without a socket or a DOM. The
 * component renders these shapes and computes nothing of its own.
 *
 * ## Read what the server sent, reconstruct nothing
 *
 * Connection identity is removed at the egress for a non-admin
 * (`server/connections/visibility.ts`), so `model` is null, a provider's
 * `request` is absent for them, and so is the exchange the adapter recorded
 * under `wire`. Every reader below treats an absent field as absent — never as a reason to derive the value from somewhere else, which
 * would put back exactly what the projection removed.
 */

import { REPLY_SENT_BY_ADAPTER } from "$lib/shared/constants/replyReceipt"

/** The run row `pipelines:run` answers with, as this projection needs it. */
export interface InspectedRun {
	runId: string
	specSlug: string
	specVersion: string
	specHash: string | null
	specHashIsCurrent: boolean
	outcome: string
	haltNodeKey: string | null
	haltReason: string | null
	elapsedMs: number
	tokensSpent: number
	isPreview: boolean
	artifacts: { kind: string; entityId: number; action: string }[]
	sessionId: number | null
	startedAt: string
	receipt: unknown
}

/** One node's entry in `receipt.nodes`, read structurally. */
export type ReceiptNode = Record<string, any>

/** The four tones a result reads as. The word itself stays on the row. */
export type ResultBadge = "ok" | "halt" | "skip" | "error"

export interface NodeRow {
	seq: number
	nodeKey: string
	/** The key, carrying its map iteration when the node ran inside one. */
	label: string
	typeId: string
	kind: string
	/** The executor's own word, whatever it was. */
	result: string
	badge: ResultBadge
	elapsedMs: number
	tokens: number | null
	reason: string | null
	notes: string[]
	isProvider: boolean
	/** The model the receipt recorded for this call, when it recorded one. */
	model: string | null
	cacheHit: boolean
	/** The node failed, its type declares `optional`, and the run continued. */
	recoveredAsEmpty: boolean
	hasWire: boolean
	hasPrompt: boolean
	/** The node as the receipt holds it, for the detail pane's own readers. */
	raw: ReceiptNode
}

const asRecord = (v: unknown): Record<string, any> | null =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, any>)
		: null

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : [])

const asString = (v: unknown): string | null =>
	typeof v === "string" && v.length ? v : null

/**
 * Which tone a result reads in.
 *
 * `cancelled` is a stop, not a failure, so it shares the halt tone; anything
 * unrecognised reads as an error, because a word this does not know is not a
 * word to render as success.
 */
function badgeOf(result: string): ResultBadge {
	if (result === "ok") return "ok"
	if (result === "halt" || result === "cancelled") return "halt"
	if (result === "skip" || result === "skipped") return "skip"
	return "error"
}

/** The model behind one provider call, where the receipt still names it. */
function modelOf(node: ReceiptNode): string | null {
	const request = asRecord(node.request)
	const connection =
		asRecord(request?.connection) ??
		asRecord(asRecord(node.output)?.connection)
	if (!connection) return null
	return (
		asString(asRecord(connection.metadata)?.model) ??
		asString(connection.model)
	)
}

/**
 * One row per node, in `seq` order.
 *
 * Sorted here rather than trusted: `seq` is the order the executor ran them in
 * and the order a reader follows, and a receipt is a stored blob whose array
 * order is nobody's guarantee.
 */
export function nodeRows(receipt: unknown): NodeRow[] {
	const nodes = asArray(asRecord(receipt)?.nodes)
	return nodes
		.map((raw: ReceiptNode): NodeRow => {
			const nodeKey = String(raw?.nodeKey ?? "")
			const result = String(raw?.result ?? "")
			const iteration =
				typeof raw?.iteration === "number" ? raw.iteration : null
			return {
				seq: Number(raw?.seq ?? 0),
				nodeKey,
				label:
					iteration == null ? nodeKey : `${nodeKey} [${iteration}]`,
				typeId: String(raw?.typeId ?? ""),
				kind: String(raw?.kind ?? ""),
				result,
				badge: badgeOf(result),
				elapsedMs: Number(raw?.elapsedMs ?? 0),
				tokens: typeof raw?.tokens === "number" ? raw.tokens : null,
				reason: asString(raw?.reason),
				notes: asArray(raw?.notes).map((n) => String(n)),
				isProvider: raw?.kind === "provider",
				model: modelOf(raw ?? {}),
				cacheHit: raw?.cacheHit === true,
				recoveredAsEmpty: raw?.recoveredAsEmpty === true,
				hasWire: wireView(raw) !== null,
				hasPrompt: promptView(raw, receipt) !== null,
				raw: raw ?? {}
			}
		})
		.sort((a, b) => a.seq - b.seq)
}

/**
 * The node a reply adapter sent for, where the receipt says one.
 *
 * The reply road's `ok` is not the ordinary one: every node ran, and the last
 * of them handed its payload to the connection adapter rather than sending it.
 * The node's own reason is where that is recorded — see `recordReplyOutcome`.
 */
function sentByAdapter(receipt: Record<string, unknown> | null): string | null {
	const node = asArray(receipt?.nodes).find(
		(n: ReceiptNode) => asString(n?.reason) === REPLY_SENT_BY_ADAPTER
	)
	return node ? (asString(node.nodeKey) ?? null) : null
}

/**
 * What happened, in one sentence.
 *
 * The first thing a reader needs and the one thing the receipt states in
 * pieces: an outcome, a node key and a reason phrased for a log. A preview
 * halt gets its own sentence because "halted" reads as a fault and a preview
 * is the pipeline doing exactly what it was asked — stopping at the
 * pre-call substrate so the adapter makes the call.
 */
export function verdict(run: InspectedRun): string {
	const receipt = asRecord(run.receipt)
	const node = run.haltNodeKey ?? asString(receipt?.haltNodeKey)
	const reason = run.haltReason ?? asString(receipt?.haltReason)
	const at = node ? ` at ${node}` : ""

	if (run.outcome === "ok") {
		const count = asArray(receipt?.nodes).length
		const ran = `Ran all ${count} ${count === 1 ? "node" : "nodes"}`
		const sent = sentByAdapter(receipt)
		return sent
			? `${ran}; the reply adapter sent ${sent}'s prompt and wrote the message.`
			: `${ran}.`
	}
	if (run.outcome === "cancelled") return `Stopped${at} on request.`
	if (run.outcome === "err")
		return reason ? `Failed${at}: ${reason}.` : `Failed${at}.`

	const isPreview =
		asRecord(receipt?.preview) !== null || !!reason?.startsWith("preview:")
	if (isPreview)
		return `Halted${at} as a preview: the adapter sent this prompt.`
	return reason ? `Halted${at}: ${reason}.` : `Halted${at}.`
}

/* ── the wire ───────────────────────────────────────────────────────── */

export interface StopRow {
	value: string
	kind: string
	/** The stop's own explanation, where the receipt carries one. */
	why: string | null
}

/**
 * One call an adapter made, as the tab draws it.
 *
 * The receipt's own record is the adapter's — a request and a response. This
 * is that record with the body already pretty-printed, because the panel
 * renders these shapes and computes nothing of its own.
 */
export interface WireCall {
	url: string
	method: string
	/** The request body as the adapter built it, pretty-printed. */
	body: string
	status: number | null
	/** The response text, or the frames as they arrived. */
	raw: string
	streamed: boolean
	chunks: number | null
	durationMs: number | null
	/** The cap took the rest of the response. */
	truncated: boolean
	/** Fields the record replaced, by path. */
	redacted: string[]
}

export interface WireView {
	/** Which wire rule applied — `chat` or `completions`. */
	wire: string | null
	sent: StopRow[]
	dropped: StopRow[]
	/** The structured-output request, for a node that made one. */
	structured: Record<string, any> | null
	/**
	 * What the adapter actually sent and read, where the receipt carries it.
	 *
	 * Empty for a run recorded before this was kept, for a node that never
	 * reached a service — and for every reader who is not an administrator,
	 * since the exchange names the connection and the egress removes it. Absent
	 * is drawn as absent; nothing here reconstructs a request from the payload
	 * beside it.
	 */
	calls: WireCall[]
}

/** The exchanges on a node output: one call, a list of them, or none. */
function wireCalls(value: unknown): WireCall[] {
	const record = asRecord(value)
	if (!record) return []
	const many = Array.isArray(record.calls) ? record.calls : null
	const raw = many ?? [record]
	return raw
		.map((v) => asRecord(v))
		.filter((v): v is Record<string, any> => !!asRecord(v?.request))
		.map((v) => {
			const request = asRecord(v.request)!
			const response = asRecord(v.response) ?? {}
			return {
				url: String(request.url ?? ""),
				method: String(request.method ?? ""),
				body: pretty(request.body),
				status:
					typeof response.status === "number"
						? response.status
						: null,
				raw: typeof response.raw === "string" ? response.raw : "",
				streamed: response.streamed === true,
				chunks:
					typeof response.chunks === "number"
						? response.chunks
						: null,
				durationMs:
					typeof response.durationMs === "number"
						? response.durationMs
						: null,
				truncated: response.truncated === true,
				redacted: asArray(v.redacted).map((r) => String(r))
			}
		})
}

/** A body as a reader can read it, whatever it turned out to be. */
function pretty(value: unknown): string {
	if (typeof value === "string") return value
	try {
		return JSON.stringify(value, null, 2) ?? String(value)
	} catch {
		return String(value)
	}
}

const stopRows = (v: unknown): StopRow[] =>
	asArray(v).map((s) => ({
		value: String(s?.value ?? ""),
		kind: String(s?.kind ?? "unknown"),
		why: asString(s?.why)
	}))

/**
 * What this node put on the wire, and what the wire rule held back.
 *
 * A held-back stop is the half that makes a truncation debuggable: on a chat
 * wire the roles carry the structure, so a template's delimiters are dropped,
 * while a transcript's speaker labels ride the wire only when the turns inline
 * them, and a reader asking why a reply ran on needs to see that decision
 * rather than infer it. Each entry carries the sentence that decided it.
 */
export function wireView(
	node: ReceiptNode | null | undefined
): WireView | null {
	const output = asRecord(node?.output)
	if (!output) return null
	const stops = asRecord(output.stops)
	const structured = asRecord(output.structured)
	const wire = asString(stops?.wire) ?? asString(output.wire)
	const calls = wireCalls(output.wire)
	if (!stops && !structured && !wire && !calls.length) return null
	return {
		wire,
		sent: stopRows(stops?.sent),
		dropped: stopRows(stops?.dropped),
		structured,
		calls
	}
}

/* ── the prompt ─────────────────────────────────────────────────────── */

export interface BlockRow {
	source: string
	name: string
	tokens: number
	included: boolean
	/** Each stage's line about this block, in order. */
	why: string[]
}

/** One row per allocated block, whether or not it made it in. */
export function blockRows(compiled: unknown): BlockRow[] {
	const blocks = asArray(asRecord(compiled)?.blocks)
	return blocks.map((b) => ({
		source: String(b?.source ?? b?.sourceKey ?? "unknown"),
		name:
			asString(b?.name) ??
			`${String(b?.source ?? b?.sourceKey ?? "block")} #${b?.id ?? "?"}`,
		tokens: Number(b?.tokens ?? 0),
		included: b?.included === true,
		why: asArray(b?.why).map((w) => String(w))
	}))
}

/**
 * Where the payload on screen came from, which decides how it is labelled.
 *
 * `wire` is the strongest: the turns as the ADAPTER rendered them, off the
 * exchange it recorded. Everything else is what the pipeline built, which is
 * the same content one rendering earlier.
 */
export type PromptSource = "wire" | "sent" | "prepared" | "assembled"

export interface PromptView {
	source: PromptSource
	messages: { role: string; content: string }[]
	blocks: BlockRow[]
	totalTokens: number | null
	promptFormat: string | null
	budget: Record<string, any> | null
}

/**
 * A compiled prompt is an object carrying rendered messages and at least one
 * of the things only an assembler produces. Checked rather than assumed,
 * because a transcript node also publishes a `messages` array and it is not a
 * prompt.
 */
function asCompiledPrompt(v: unknown): Record<string, any> | null {
	const o = asRecord(v)
	if (!o || !Array.isArray(o.messages)) return null
	const assembled =
		Array.isArray(o.blocks) ||
		typeof o.promptFormat === "string" ||
		typeof o.totalTokens === "number"
	return assembled ? o : null
}

/**
 * The turns on a recorded request, whichever shape that request takes.
 *
 * A chat body carries `messages`; a completion body carries one `prompt`
 * string, which is one turn however long it is. A body with neither is a
 * request this cannot draw as a prompt, and it answers with nothing rather
 * than an empty transcript.
 */
function wireMessages(
	node: ReceiptNode
): { role: string; content: string }[] | null {
	const exchange = asRecord(asRecord(node.output)?.wire)
	// The first call, whichever shape the node recorded: the turns are the
	// same question for a node that called once and for one that called
	// several times.
	const first = Array.isArray(exchange?.calls)
		? asRecord(exchange!.calls[0])
		: exchange
	const record = asRecord(asRecord(first?.request)?.body)
	if (Array.isArray(record?.messages))
		return record!.messages.map((m: any) => ({
			role: String(m?.role ?? ""),
			content:
				typeof m?.content === "string" ? m.content : pretty(m?.content)
		}))
	if (typeof record?.prompt === "string")
		return [{ role: "prompt", content: record.prompt }]
	return null
}

/**
 * The payload this node built or sent.
 *
 * Five places hold one, and the order is the order of authority: what the
 * adapter recorded putting on the wire, what the provider recorded sending,
 * what an assemble node rendered, what a provider was handed before it halted,
 * and the preview report's own copy. A reader asking "what actually went to the
 * model" must be shown the wire wherever it exists.
 *
 * The allocation stays on screen either way: the blocks and the token count
 * belong to the same request, and dropping them because the messages came from
 * one rendering later would answer a narrower question than the tab is for.
 */
export function promptView(
	node: ReceiptNode | null | undefined,
	receipt: unknown
): PromptView | null {
	if (!node) return null
	const output = asRecord(node.output)
	const preview = asRecord(asRecord(receipt)?.preview)

	const candidates: [PromptSource, unknown][] = [
		["sent", asRecord(node.request)?.compiledPrompt],
		["assembled", output?.context],
		["assembled", output?.main],
		["prepared", asRecord(node.input)?.context],
		[
			"prepared",
			preview?.atNode === node.nodeKey
				? asRecord(preview?.context)?.rendered
				: null
		]
	]

	const sent = wireMessages(node)

	for (const [source, candidate] of candidates) {
		const compiled = asCompiledPrompt(candidate)
		if (!compiled) continue
		return {
			source: sent ? "wire" : source,
			messages:
				sent ??
				asArray(compiled.messages).map((m) => ({
					role: String(m?.role ?? ""),
					content: String(m?.content ?? "")
				})),
			blocks: blockRows(compiled),
			totalTokens:
				typeof compiled.totalTokens === "number"
					? compiled.totalTokens
					: null,
			promptFormat: asString(compiled.promptFormat),
			budget: asRecord(compiled.budget)
		}
	}
	// A node whose only payload is the one the adapter sent — a receipt whose
	// assembled copy was never stored, and a reader who is still owed the
	// request.
	if (sent)
		return {
			source: "wire",
			messages: sent,
			blocks: [],
			totalTokens: null,
			promptFormat: null,
			budget: null
		}
	return null
}

/* ── the post-history reminder ──────────────────────── */

export interface PostHistoryView {
	/**
	 * Which copy this is. `decision` is the assemble node's verdict; `carried`
	 * is the context builder's ungated input to it, which says nothing about
	 * whether the reminder went out.
	 */
	source: "decision" | "carried"
	included: boolean
	/** The one line the pane draws. */
	line: string
	/** What the block carries besides the config's own reminder, when it
	 *  carries any of it. */
	notes: string[]
}

/**
 * The other two parts of the block.
 *
 * The trigger governs the whole block, so these are facts about its contents
 * and they follow the verdict: an included block carries them, a suppressed one
 * holds them back with the rest.
 */
function blockParts(record: Record<string, any>, included: boolean): string[] {
	const notes: string[] = []
	if (record.hasCharInstructions === true)
		notes.push(
			included
				? "Includes the character reminder"
				: "Character reminder suppressed with it"
		)
	if (record.hasExampleDialogue === true)
		notes.push(
			included
				? "Includes the example dialogue"
				: "Example dialogue suppressed with it"
		)
	return notes
}

/**
 * Whether the post-history reminder went out, and why.
 *
 * A suppressed reminder leaves NO trace in the prompt: "the trigger held it
 * back" and "nobody wrote one" look identical on screen, and both look like the
 * model ignoring an instruction. The assemble node records which it was, and
 * this reads that record rather than inferring one from the payload.
 *
 * Null for a node that made no such decision, and for a receipt recorded before
 * the decision was kept. The context builder's copy is labelled as carried
 * rather than read as a verdict: it is ungated by construction, so reporting it
 * as one would say the opposite of what the prompt shows.
 */
export function postHistoryView(
	node: ReceiptNode | null | undefined
): PostHistoryView | null {
	const output = asRecord(node?.output)
	if (!output) return null

	const decision = asRecord(output.postHistory)
	if (decision) {
		const included = decision.included === true
		const reason = asString(decision.reason)
		const line = included
			? `included at message ${Number(decision.targetIndex ?? 0)}`
			: reason === "below_token_trigger"
				? `suppressed, ${Number(decision.historyTokens ?? 0)} tokens ` +
					`is below the ${Number(decision.trigger ?? 0)} trigger`
				: "none in this configuration"
		return {
			source: "decision",
			included,
			line: `Post-history reminder: ${line}`,
			notes: blockParts(decision, included)
		}
	}

	const carried = asRecord(asRecord(output.templateContext)?.postHistory)
	const gatedBy = asString(carried?.gatedBy)
	if (!carried || !gatedBy) return null
	return {
		source: "carried",
		included: carried.hasContent === true,
		line: `Post-history reminder: carried, gated at ${gatedBy}`,
		notes: []
	}
}

/* ── the output ─────────────────────────────────────────────────────── */

export interface OutputView {
	/**
	 * Fields worth reading as prose, in the order the output holds them.
	 *
	 * `note` is the one line drawn above the text, for a field that carries its
	 * own measurements. Absent when there is nothing to say.
	 */
	texts: { key: string; value: string; note?: string }[]
	/** Everything else, for the JSON half. Null when there is nothing left. */
	rest: unknown
	empty: boolean
}

/**
 * A string long enough, or shaped enough, that escaped JSON destroys it.
 *
 * A generated reply, a rendered prompt and a system block are the fields a
 * reader opens this tab for, and `"...\n\n\"By the gods...` is not readable.
 */
const isProse = (v: unknown): v is string =>
	typeof v === "string" && (v.length > 160 || v.includes("\n"))

/**
 * What the service said ended a reply, in the reader's words.
 *
 * A word this does not know is shown as the service said it: a mapping that
 * guessed would name a stop the service never reported.
 */
const FINISH_REASONS: Record<string, string> = {
	stop: "stopped on the model's end token",
	length: "hit the response token limit"
}

/** The fields the line above the reply says, so the JSON half does not. */
const REPLY_REPORTED = [
	"finishReason",
	"tokensPrompt",
	"tokensCompletion",
	"tokensReasoning"
]

/** The measurements beside a reply, as the one line above it. */
function replyNote(reply: Record<string, any>): string | undefined {
	const parts: string[] = []
	const finish = asString(reply.finishReason)
	if (finish) parts.push(FINISH_REASONS[finish] ?? finish)
	if (typeof reply.tokensPrompt === "number")
		parts.push(`${reply.tokensPrompt} prompt`)
	if (typeof reply.tokensCompletion === "number")
		parts.push(`${reply.tokensCompletion} completion`)
	// Said AFTER the completion count and never instead of it: this is a
	// breakdown of that number, so a reader who sees "412 reasoning" beside
	// "480 completion" is reading one cost two ways rather than two costs.
	if (typeof reply.tokensReasoning === "number")
		parts.push(`${reply.tokensReasoning} reasoning`)
	return parts.length ? parts.join(" · ") : undefined
}

/**
 * Split an output into the part to read and the part to inspect.
 *
 * ⚠ **`reply` is the stage's text whatever its length.** It is a record rather
 * than a string — the reply the adapter sent, beside what the service said
 * about it — so the prose test above answers no for the one field the tab is
 * most often opened for, and a one-word answer is still the answer.
 */
export function outputView(output: unknown): OutputView {
	if (output === null || output === undefined)
		return { texts: [], rest: null, empty: true }
	// A whole output that is a string is text whatever its length: there is no
	// key beside it to make a quoted scalar mean anything.
	if (typeof output === "string")
		return {
			texts: [{ key: "output", value: output }],
			rest: null,
			empty: false
		}

	const record = asRecord(output)
	if (!record) return { texts: [], rest: output, empty: false }

	const texts: { key: string; value: string; note?: string }[] = []
	const rest: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(record)) {
		const reply = key === "reply" ? asRecord(value) : null
		if (reply && typeof reply.text === "string") {
			const note = replyNote(reply)
			texts.push(
				note
					? { key, value: reply.text, note }
					: { key, value: reply.text }
			)
			const left = Object.fromEntries(
				Object.entries(reply).filter(
					([k]) => k !== "text" && !REPLY_REPORTED.includes(k)
				)
			)
			if (Object.keys(left).length) rest[key] = left
			continue
		}
		if (isProse(value)) texts.push({ key, value })
		else rest[key] = value
	}
	const hasRest = Object.keys(rest).length > 0
	return {
		texts,
		rest: hasRest ? rest : null,
		empty: !texts.length && !hasRest
	}
}
