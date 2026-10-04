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
import { isStatusText, type StatusText } from "@serene-pub/sdk"

/** The run row `pipelines:run` answers with, as this projection needs it. */
export interface InspectedRun {
	runId: string
	specSlug: string
	specVersion: string
	specHash: string | null
	specHashIsCurrent: boolean
	specHashRenamedAt: string | null
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
	/** Who portrayed whom, named by the server — see `portrayalsLine`. */
	portrayals?: PortrayalLine[]
}

/** One entry of the run's pinned portrayals, as `pipelines:run` names it. */
export interface PortrayalLine {
	ref: string
	name: string
	by: "person" | "ai" | "none"
	person?: { name: string; you: boolean }
}

/** One node's entry in `receipt.nodes`, read structurally. */
export type ReceiptNode = Record<string, any>

/** The four tones a result reads as. The word itself stays on the row. */
export type ResultBadge = "ok" | "halt" | "skip" | "error"

export interface NodeRow {
	seq: number
	nodeKey: string
	/** The key, carrying its each-iteration when the node ran inside one. */
	label: string
	/**
	 * The node definition the step ran, as the receipt pinned it. A receipt
	 * from before the 2026-09-16 rename says `typeId` and `core:input/…`; it is
	 * read as written — a receipt is never rewritten — so the old spelling is
	 * accepted here and shown as it was.
	 */
	definitionId: string
	kind: string
	/** The executor's own word, whatever it was. */
	result: string
	badge: ResultBadge
	elapsedMs: number
	tokens: number | null
	reason: string | null
	notes: string[]
	isOracle: boolean
	/** The model the receipt recorded for this call, when it recorded one. */
	model: string | null
	cacheHit: boolean
	/** The node failed, its type declares `optional`, and the run continued. */
	recoveredAsEmpty: boolean
	/**
	 * The node's clock ran out (`NodeReceipt.timedOut`). With
	 * `recoveredAsEmpty` it means what the step would have added — lore, most
	 * often — is missing from the run, which `timedOutNotice` says at run level.
	 */
	timedOut: boolean
	hasWire: boolean
	hasPrompt: boolean
	/**
	 * The layer each resolved config value won at (`NodeReceipt.configLayers`),
	 * in the chain's order. Empty on a receipt from before 2026-09-26.
	 */
	layers: ValueLayerRow[]
	/** The swap that ran here (`NodeReceipt.swap`), or null. */
	swap: { pin: string; by: string } | null
	/** The receipt says outright that the pin ran (`swap: null`). */
	pinned: boolean
	/**
	 * What the node refused and still finished `ok` over (`refusedOf`): a
	 * refusal is a result, not a failure, so the row carries it beside the
	 * outcome rather than in it. Empty for nearly every node.
	 */
	refused: string[]
	/** The node as the receipt holds it, for the detail pane's own readers. */
	raw: ReceiptNode
}

/** One config value's layer, as the detail pane lists it. */
export interface ValueLayerRow {
	slot: string
	path: string
	/** The SDK `ScopeKind`, or the raw word when this build does not know it. */
	layer: string
	label: string
}

/**
 * The four layers, in the SDK's `SCOPE_ORDER`, as a person reads them. Spelled
 * out here rather than imported: a receipt is stored JSON and the reader must
 * say something sensible about a word this build has never heard of.
 */
const LAYER_LABEL: Record<string, string> = {
	session: "session override",
	config: "selected config",
	defaults: "pub defaults",
	author: "node default"
}
const LAYER_ORDER = Object.keys(LAYER_LABEL)

/**
 * `NodeReceipt.configLayers`, flattened. `preset` is the pre-2026-09-26
 * spelling of `config` — no receipt was written with it, but a stored blob is
 * nobody's guarantee, so it reads as what it meant.
 */
function layersOf(node: ReceiptNode): ValueLayerRow[] {
	const out: ValueLayerRow[] = []
	for (const [slot, paths] of Object.entries(asRecord(node.configLayers) ?? {}))
		for (const [path, raw] of Object.entries(asRecord(paths) ?? {})) {
			if (typeof raw !== "string") continue
			const layer = raw === "preset" ? "config" : raw
			out.push({ slot, path, layer, label: LAYER_LABEL[layer] ?? layer })
		}
	const rank = (l: string) => {
		const i = LAYER_ORDER.indexOf(l)
		return i < 0 ? LAYER_ORDER.length : i
	}
	return out
		.map((r, i) => ({ r, i }))
		.sort((a, b) => rank(a.r.layer) - rank(b.r.layer) || a.i - b.i)
		.map(({ r }) => r)
}

/** `NodeReceipt.swap`, checked rather than cast. */
function swapOf(node: ReceiptNode): { pin: string; by: string } | null {
	const swap = asRecord(node.swap)
	const pin = asString(swap?.pin)
	const by = asString(swap?.by)
	return pin && by ? { pin, by } : null
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
				definitionId: String(raw?.definitionId ?? raw?.typeId ?? ""),
				kind: String(raw?.kind ?? ""),
				result,
				badge: badgeOf(result),
				elapsedMs: Number(raw?.elapsedMs ?? 0),
				tokens: typeof raw?.tokens === "number" ? raw.tokens : null,
				reason: asString(raw?.reason),
				notes: asArray(raw?.notes).map((n) => String(n)),
				// `provider` is the pre-rename spelling on receipts written before
				// 2026-09-16; both read as the oracle kind.
				isOracle: raw?.kind === "oracle" || raw?.kind === "provider",
				model: modelOf(raw ?? {}),
				cacheHit: raw?.cacheHit === true,
				recoveredAsEmpty: raw?.recoveredAsEmpty === true,
				timedOut: raw?.timedOut === true,
				hasWire: wireView(raw) !== null,
				hasPrompt: promptView(raw, receipt) !== null,
				layers: layersOf(raw ?? {}),
				swap: swapOf(raw ?? {}),
				pinned: raw?.swap === null,
				refused: refusedOf(raw?.output),
				raw: raw ?? {}
			}
		})
		.sort((a, b) => a.seq - b.seq)
}

/**
 * The run-level sentence for steps that ran out of time, or `null` when none
 * did.
 *
 * A timed-out step that its type lets fail is recovered as empty and the run
 * carries on, so its absence is otherwise only visible by opening that step —
 * and a lore read that ran out of time is exactly how lore went missing from a
 * reply without a word (2026-10-03). The steps are named with the limit each
 * one had, from the receipt's own `timeoutMsApplied`.
 */
export function timedOutNotice(rows: readonly NodeRow[]): string | null {
	const late = rows.filter((r) => r.timedOut)
	if (!late.length) return null
	const named = late
		.map((r) => {
			const limit = Number(r.raw?.timeoutMsApplied)
			return Number.isFinite(limit) && limit > 0
				? `${r.label} (${limit >= 1000 ? `${limit / 1000} s` : `${limit} ms`})`
				: r.label
		})
		.join(", ")
	const recovered = late.every((r) => r.recoveredAsEmpty)
	const steps = late.length === 1 ? "1 step" : `${late.length} steps`
	return recovered
		? `${steps} ran out of time and added nothing to this run: ${named}.`
		: `${steps} ran out of time: ${named}.`
}

/**
 * The sentences a node's output says it refused, on any node type.
 *
 * A node that refuses part of its input and carries on — `core:task/set-state`
 * turning down one change of five (`bindings.state.ts`) — finishes `ok`,
 * because the refusal is a result: the other four were legitimate. That leaves
 * the outcome silent about it, so the inspector reads the convention instead:
 * a `refused` list of sentences on the output, or on its `main` port. Anything
 * that is not a non-blank string is not a sentence and is not counted.
 */
export function refusedOf(output: unknown): string[] {
	const record = asRecord(output)
	if (!record) return []
	const list = Array.isArray(record.refused)
		? record.refused
		: asArray(asRecord(record.main)?.refused)
	return list.filter(
		(s: unknown): s is string => typeof s === "string" && s.trim() !== ""
	)
}

/** How many refusals `refusedOf` finds — the number the step row shows. */
export const refusedCount = (output: unknown): number =>
	refusedOf(output).length

/**
 * The node a reply adapter sent for, where the receipt says one.
 *
 * Receipts from before the one road (09-B B4): every node ran, and the last of
 * them handed its payload to the connection adapter rather than sending it.
 * The node's own reason is where that was recorded. A receipt written since
 * carries no such node — its oracle ran — and reads as an ordinary run.
 */
function sentByAdapter(receipt: Record<string, unknown> | null): string | null {
	const node = asArray(receipt?.nodes).find(
		(n: ReceiptNode) => asString(n?.reason) === REPLY_SENT_BY_ADAPTER
	)
	return node ? (asString(node.nodeKey) ?? null) : null
}

/**
 * The receipt's one status (R-19, R-21): what the run was doing when it ended
 * badly, as the node set it with `{speaker}` filled — `{ nodeKey, text }` —
 * or null on a run that finished, a preview, or a receipt from before
 * statuses existed. The component resolves the locale; this reads the shape.
 */
export function lastStatusOf(
	run: InspectedRun
): { nodeKey: string; text: StatusText } | null {
	const last = asRecord(asRecord(run.receipt)?.lastStatus)
	const text = asRecord(last?.text)
	// The SDK's own shape check (R-20): `i18n` a string or a map with `en`.
	if (!last || !text || !isStatusText(text)) return null
	return { nodeKey: String(last.nodeKey ?? ""), text }
}

/**
 * What happened, in one sentence.
 *
 * The first thing a reader needs and the one thing the receipt states in
 * pieces: an outcome, a node key and a reason phrased for a log. A preview
 * halt gets its own sentence because "halted" reads as a fault and a preview
 * is the pipeline doing exactly what it was asked — stopping at the
 * pre-call substrate so the adapter makes the call.
 *
 * `status` is the receipt's last status already resolved in the reader's
 * language (`lastStatusOf` + `statusText`) — *Jasmine is typing* — and it
 * joins the sentence of a run that died: _Stopped at generate on request
 * while Jasmine is typing._ Absent, the sentence reads as before.
 */
export function verdict(
	run: InspectedRun,
	opts: { status?: string | null } = {}
): string {
	const receipt = asRecord(run.receipt)
	const node = run.haltNodeKey ?? asString(receipt?.haltNodeKey)
	const reason = run.haltReason ?? asString(receipt?.haltReason)
	const at = node ? ` at ${node}` : ""
	const whileDoing = opts.status ? ` while ${opts.status}` : ""

	if (run.outcome === "ok") {
		const count = asArray(receipt?.nodes).length
		const ran = `Ran all ${count} ${count === 1 ? "node" : "nodes"}`
		const sent = sentByAdapter(receipt)
		return sent
			? `${ran}; the reply adapter sent ${sent}'s prompt and wrote the message.`
			: `${ran}.`
	}
	if (run.outcome === "cancelled")
		return `Stopped${at} on request${whileDoing}.`
	if (run.outcome === "err")
		return reason
			? `Failed${at}${whileDoing}: ${reason}.`
			: `Failed${at}${whileDoing}.`

	const isPreview =
		asRecord(receipt?.preview) !== null || !!reason?.startsWith("preview:")
	if (isPreview)
		return `Halted${at} as a preview: the adapter sent this prompt.`
	return reason
		? `Halted${at}${whileDoing}: ${reason}.`
		: `Halted${at}${whileDoing}.`
}

/* ── who portrayed whom ─────────────────────────────────────────────── */

/** One chip of the Portrayed-by line: the participant and who portrayed them. */
export interface PortrayalChip {
	ref: string
	name: string
	/**
	 * "AI", "you", "nobody", or — the one case that is not a word of the
	 * app's — another member's name. `you` says which, so the component can
	 * pass the words through `t()` and leave a name alone.
	 */
	portrayedBy: string
	by: PortrayalLine["by"]
	you: boolean
}

/**
 * The run's pinned portrayals (R-21 (4)) as the header's one line — "Tom ·
 * AI", "Elara · you" — in the order the receipt pinned them.
 *
 * Only the participants a reader recognises as people or characters are
 * shown: `character:` and `envoy:` and `user:` references. The roles
 * (`owner`, `run-owner`, …) are pinned on the receipt too and stay in the
 * raw receipt; on the line they would say "owner · you" on every run, which
 * is noise wearing a fact. An empty list means no line.
 */
export function portrayalsLine(run: InspectedRun): PortrayalChip[] {
	const lines = Array.isArray(run.portrayals) ? run.portrayals : []
	return lines
		.filter(
			(v) =>
				typeof v?.ref === "string" &&
				/^(character|envoy|user):/.test(v.ref)
		)
		.map((v) => ({
			ref: v.ref,
			name: v.name,
			by: v.by,
			you: v.by === "person" && v.person?.you === true,
			portrayedBy:
				v.by === "ai"
					? "AI"
					: v.by === "person"
						? v.person?.you
							? "you"
							: (v.person?.name ?? "a member")
						: "nobody"
		}))
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
	/** Each step's line about this block, in order. */
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

/* ── the author's note ──────────────────────────────── */

/** 🚧 The author's note decision (AN1), as one line beside the reminder's. */
export interface AuthorsNoteView {
	included: boolean
	/** The one line the pane draws. */
	line: string
}

/**
 * Whether the session's author's note went into this prompt, where, and why
 * not — the assemble node's own record (`output.authorsNote`), read rather
 * than inferred: a skipped note leaves no trace in the prompt. Null for a node
 * that made no such decision (no note in scope) and for older receipts.
 */
export function authorsNoteView(
	node: ReceiptNode | null | undefined
): AuthorsNoteView | null {
	const decision = asRecord(asRecord(node?.output)?.authorsNote)
	if (!decision || typeof decision.included !== "boolean") return null
	const included = decision.included === true
	const reason = asString(decision.reason)
	const depth = Number(decision.depth ?? 0)
	const line = included
		? `included at message ${Number(decision.targetIndex ?? 0)} ` +
			`(${depth} from the end, as ${asString(decision.role) ?? "system"})`
		: reason === "interval"
			? `skipped, reply ${Number(decision.replyCount ?? 0) + 1} is not one of every ` +
				`${Number(decision.interval ?? 1)}`
			: "empty, nothing to add"
	return { included, line: `Author's note: ${line}` }
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
 * ⚠ **`reply` is the step's text whatever its length.** It is a record rather
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
