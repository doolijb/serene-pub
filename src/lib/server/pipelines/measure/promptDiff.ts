/**
 * The A/B prompt diff — one real session, run twice, with the receipts.
 *
 * Retrieval plan **phase 6**, and design §10's first instrument: *"run the same
 * real sessions with a mechanism on and off, diff what reached the model with
 * the decision receipts attached, and judge whether the additions were things
 * you would have wanted there."*
 *
 * ## Why this exists at all
 *
 * Almost everything built in the last stretch ships **inert** — BM25, trigram
 * folding, title weighting, proximity, the admission gate, score-led
 * allocation, the semantic mechanism, entity search, the mechanism strengths. Every
 * one is default-off, because parity cannot validate any of them: it measures
 * 0.6 against legacy 0.5, so by construction it can only report when we have
 * stopped matching the thing we are trying to beat. Turning one of them on is a
 * judgement about *quality*, and nothing in this codebase produced evidence a
 * person could form a judgement from.
 *
 * `pipelines/measure/rankingCorpus.test.ts` closes the other half — it proves a
 * control *has* an effect, on worlds built to make the effect visible. This
 * answers the question a corpus cannot: **is the effect one you would want, on
 * your own lorebook, in your own conversation.** So it is not a gate, it
 * returns no verdict and it fails nothing. It prints two prompts and the reason
 * every entry is in or out of each.
 *
 * ## Shape, and why it is a script rather than a screen
 *
 * A script, run through `scripts/prompt-ab.js`, exactly as the deleted
 * legacy-versus-pipeline comparison was (`fd9aa3a`, whose `$app/environment`
 * shim and `scripts/tsconfig.script.json` are still here and were built for
 * this). Three reasons, in order of weight:
 *
 *   · **It is a decision tool, not a per-turn surface.** Somebody runs it once
 *     while deciding whether to enable a mechanism, over as many sessions as
 *     they have. That is a shape a terminal is good at and a settings panel is
 *     not — and the run receipt on `/admin/pipelines/[slug]` already answers
 *     the *single-turn* version of the question through `RetrievalPanel`.
 *   · **It has to be able to run over every session at once**, which is what
 *     `TurnRequest.skipReceipt`'s own docblock was written for: *"for the
 *     comparison tool, which runs a preview against every session on the
 *     instance and would otherwise fill the run history with rows nobody asked
 *     for."*
 *   · It touches no route and no socket, so it cannot collide with the surfaces
 *     other lanes own.
 *
 * ## Built on the preview path, not beside it
 *
 * Both sides run `runTurn(..., { preview: true, skipReceipt: true })` — the
 * same call `sessions:promptTokenCount` makes to count a prompt while somebody
 * types. `preview` halts at the pre-call substrate with the **real payload** in
 * the receipt, so what is being diffed is the compilation the next turn would
 * actually use rather than a reconstruction of it. Comparing against a
 * re-render would compare a reimplementation, and a tool that reports on a
 * reimplementation is evidence pointing the wrong way.
 *
 * ## It writes nothing
 *
 * `preview: true` stops before the provider, so no message row and no model
 * call. `skipReceipt: true` records no run. The overrides ride on the world in
 * memory (`runSpec.overrides`) and no configuration row is touched. The runner
 * script goes further and points the process at a **copy** of the database, so
 * even the migration `db/index.ts` performs at import cannot reach the real
 * one — see `scripts/prompt-ab.entry.ts`.
 */

import { createTwoFilesPatch } from "diff"
import { eq, desc, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { runTurn } from "$lib/server/pipelines/runtime/runTurn"

/** One node parameter, forced for a whole side of the comparison. */
export interface Override {
	nodeKey: string
	/** Defaults to `params`, where every retrieval and ranking control lives. */
	slot?: string
	path: string
	value: unknown
}

/** One side of the comparison: a name for the column, and what to force. */
export interface Variant {
	name: string
	/** Empty means "as this install is configured" — the usual baseline. */
	overrides: Override[]
}

export interface CompareRequest {
	db: Db
	sessionId: number
	/** Defaults to the session's own owner. */
	userId?: number
	/**
	 * Whose turn it is. Defaults to the session's first character, which is who
	 * the app would pick for a plain reply; `null` is narrator mode.
	 */
	currentCharacterId?: number | null
	/** The turn's trigger. Defaults to the session's last message. */
	text?: string
	specId?: string
	baseline: Variant
	variant: Variant
}

/**
 * Where one entry stood on one side, in the vocabulary a reader can act on.
 *
 * Four states and not two, because "it is not in the prompt" has four different
 * causes with four different fixes, and collapsing them is the failure
 * `keywordQuery.skipped` exists to prevent:
 *
 *   · `included` — it is in the prompt.
 *   · `excluded` — it competed and lost. The fix is a bigger window or a
 *     different share.
 *   · `skipped` — a mechanism declined it. The fix is a key, a threshold, or
 *     nothing, depending on `reason`.
 *   · `absent` — this side never saw it at all, which on a lore gather branch means the
 *     row was not returned to that mechanism.
 */
export type EntryState = "included" | "excluded" | "skipped" | "absent"

export interface EntryStanding {
	key: string
	source: string
	id: number | string
	title: string
	state: EntryState
	/** `select`'s reason code, or the mechanism's skip class. */
	reason: string
	/** The sentence the producing step wrote. */
	why: string
	score: number | null
	tokens: number | null
}

export interface GatherBranchReport {
	nodeKey: string
	matched: number | null
	considered: number | null
	admittedByEvidence: number | null
	admitThreshold: number | null
	vectorSearch: string | null
	skipped: number
}

export interface Side {
	name: string
	/** The assembled prompt, exactly as it would have been sent. */
	prompt: string
	/** Present when the run never reached the provider — the reason why. */
	stopped?: string
	standings: Map<string, EntryStanding>
	/** Included entry keys, in the order the ranker put them. */
	order: string[]
	branches: GatherBranchReport[]
	/** Rough, and the same estimate on both sides so the delta means something. */
	tokens: number
}

export interface Comparison {
	sessionId: number
	title: string
	messageCount: number
	baseline: Side
	variant: Side
	identical: boolean
	/** In the prompt on the variant side and not on the baseline's. */
	entered: Array<{ key: string; on: EntryStanding; off: EntryStanding }>
	/** The other direction. */
	left: Array<{ key: string; on: EntryStanding; off: EntryStanding }>
	/** In both, at a different rank. */
	moved: Array<{ key: string; title: string; from: number; to: number }>
	/** A unified patch of the two prompts, empty when they are identical. */
	patch: string
}

/**
 * A rough token count, used only for the two sides' delta.
 *
 * Four characters to a token, which is wrong in the way every estimate is wrong.
 * It is not the number the budget was computed with — that came from the run's
 * real tokenizer — and it is not presented as one; it exists so *"the prompt got
 * bigger by about this much"* has an answer that does not depend on which model
 * the session happens to point at.
 */
const roughTokens = (text: string): number => Math.ceil(text.length / 4)

const keyOf = (source: unknown, id: unknown) => `${String(source)}:${String(id)}`

const titleOf = (candidate: any): string => {
	const payload = candidate?.payload ?? {}
	const name = payload.name ?? payload.title ?? candidate?.name
	return typeof name === "string" && name.length
		? name
		: keyOf(candidate?.source, candidate?.id)
}

/** Every node whose output carries retrieval diagnostics, in spec order. */
function gatherBranchesOf(receipt: any): GatherBranchReport[] {
	const out: GatherBranchReport[] = []
	for (const node of receipt?.nodes ?? []) {
		const output: any = node?.output
		const diagnostics = output?.diagnostics
		const skipped = output?.skipped
		// Retrieval nodes only. The ranker publishes `groups` rather than
		// diagnostics and is reported through the standings instead.
		if (!diagnostics || typeof diagnostics !== "object") continue
		out.push({
			nodeKey: node.nodeKey,
			matched: numberOrNull(diagnostics.matched),
			considered: numberOrNull(diagnostics.considered),
			admittedByEvidence: numberOrNull(diagnostics.admittedByEvidence),
			admitThreshold: numberOrNull(diagnostics.admitThreshold),
			vectorSearch:
				typeof diagnostics.vectorSearch === "string"
					? diagnostics.vectorSearch
					: null,
			skipped: Array.isArray(skipped) ? skipped.length : 0
		})
	}
	return out
}

const numberOrNull = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null

/**
 * What every entry this run touched was decided to be, and why.
 *
 * Built from two places because the answer lives in two places and neither is
 * complete: `rank`'s `decisions` hold everything that became a candidate, and
 * each lore gather branch's `skipped` holds everything that did not. An entry missing
 * from both was never read, which is `absent`.
 *
 * ⚠ Read off the receipt rather than recomputed. The numbers that produced a
 * decision exist there and nowhere else once the loop has moved on, and a tool
 * that re-derived them would be diffing its own arithmetic against the
 * pipeline's.
 */
function standingsOf(receipt: any): Map<string, EntryStanding> {
	const out = new Map<string, EntryStanding>()

	for (const node of receipt?.nodes ?? []) {
		const skipped = (node?.output as any)?.skipped
		if (!Array.isArray(skipped)) continue
		for (const row of skipped) {
			const key = keyOf(row?.source, row?.id)
			if (out.has(key)) continue
			out.set(key, {
				key,
				source: String(row?.source ?? "?"),
				id: row?.id,
				// A skipped row carries no title — the mechanism declined it before
				// building a candidate. Named from the other side's decision
				// when there is one; see `pair` below.
				title: key,
				state: "skipped",
				reason: String(row?.kind ?? "missed"),
				why: String(row?.reason ?? ""),
				score: null,
				tokens: null
			})
		}
	}

	const rank = (receipt?.nodes ?? []).find(
		(n: any) => n.definitionId === "core:task/rank-hybrid@1"
	)
	for (const decision of ((rank?.output as any)?.decisions ?? []) as any[]) {
		const candidate = decision?.candidate ?? {}
		const key = keyOf(candidate.source, candidate.id)
		// A decision always wins over a skip: an entry one gather branch declined and
		// another found is in the prompt, and the skip is the less complete
		// half of that story.
		out.set(key, {
			key,
			source: String(candidate.source ?? "?"),
			id: candidate.id,
			title: titleOf(candidate),
			state: decision.included ? "included" : "excluded",
			reason: String(decision.reason ?? ""),
			why: String(decision.why ?? ""),
			score: numberOrNull(decision.score),
			tokens: numberOrNull(candidate.tokens)
		})
	}

	return out
}

/**
 * The order the included entries reached the prompt in.
 *
 * ⚠ Read off the ranker's own `decisions` and **not** off the standings map,
 * which cannot answer this: `Map.set` on an existing key keeps that key's
 * original insertion position, and the map is filled with the gather branches' `skipped`
 * rows before the decisions overwrite them. An entry one mechanism declined and
 * another found would therefore carry the *skip's* position, and the "moved"
 * table would report reorderings that never happened.
 */
function promptOrder(receipt: any): string[] {
	const rank = (receipt?.nodes ?? []).find(
		(n: any) => n.definitionId === "core:task/rank-hybrid@1"
	)
	return (((rank?.output as any)?.decisions ?? []) as any[])
		.filter((d) => d?.included)
		.map((d) => keyOf(d?.candidate?.source, d?.candidate?.id))
}

const ABSENT = (key: string): EntryStanding => ({
	key,
	source: key.split(":")[0] ?? "?",
	id: key.split(":")[1] ?? "?",
	title: key,
	state: "absent",
	reason: "",
	why: "this side never saw this entry",
	score: null,
	tokens: null
})

/** Compile one side of the comparison. */
async function runSide(
	request: CompareRequest,
	variant: Variant,
	scope: { userId: number; currentCharacterId: number | null; text: string }
): Promise<Side> {
	const receipt: any = await runTurn({
		db: request.db,
		sessionId: request.sessionId,
		userId: scope.userId,
		currentCharacterId: scope.currentCharacterId,
		text: scope.text,
		specId: request.specId,
		// One seed for both sides, derived from the session rather than fresh
		// per run. Anything seeded — the example-dialogue pick, a script's rolls
		// — would otherwise differ between the two sides and land in the diff as
		// a change the configuration did not cause.
		seed: `ab:${request.sessionId}`,
		overrides: variant.overrides,
		preview: true,
		skipReceipt: true
	})

	const rendered = receipt?.preview?.context?.rendered
	const prompt =
		typeof rendered === "string"
			? rendered
			: typeof rendered?.rendered === "string"
				? rendered.rendered
				: rendered
					? JSON.stringify(rendered, null, 2)
					: ""

	const stopped = receipt?.preview
		? undefined
		: `${receipt?.outcome}` +
			(receipt?.haltNodeKey ? ` at '${receipt.haltNodeKey}'` : "") +
			(receipt?.haltReason ? ` — ${receipt.haltReason}` : "")

	return {
		name: variant.name,
		prompt,
		...(stopped ? { stopped } : {}),
		standings: standingsOf(receipt),
		order: promptOrder(receipt),
		branches: gatherBranchesOf(receipt),
		tokens: roughTokens(prompt)
	}
}

/**
 * Run one session both ways and say what changed.
 *
 * The two sides run **sequentially**, not in parallel. They share a database
 * connection and a run registry, and a tool whose two halves interleave is a
 * tool whose diff can be caused by the interleaving.
 */
export async function comparePrompts(
	request: CompareRequest
): Promise<Comparison> {
	const { db, sessionId } = request

	const [session] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) throw new Error(`there is no session ${sessionId}`)

	const userId = request.userId ?? session.userId
	if (userId == null)
		throw new Error(`session ${sessionId} has no owner to run as`)

	// Whose turn it is. A comparison has to pick somebody, and the session's
	// first character is who the app would pick for a plain reply.
	let currentCharacterId: number | null = request.currentCharacterId ?? null
	if (request.currentCharacterId === undefined) {
		const [first] = await db
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
			.limit(1)
		currentCharacterId = first?.characterId ?? null
	}

	const [last] = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	const [{ count } = { count: 0 }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))

	const scope = {
		userId,
		currentCharacterId,
		text: request.text ?? last?.content ?? ""
	}

	const baseline = await runSide(request, request.baseline, scope)
	const variant = await runSide(request, request.variant, scope)

	const keys = new Set([
		...baseline.standings.keys(),
		...variant.standings.keys()
	])
	const pair = (key: string) => {
		const off = baseline.standings.get(key) ?? ABSENT(key)
		const on = variant.standings.get(key) ?? ABSENT(key)
		// A skipped row has no title of its own; borrow the other side's when
		// it has one, so a table of entries is a table of names.
		const title = [on.title, off.title].find((t) => t && t !== key) ?? key
		return { off: { ...off, title }, on: { ...on, title } }
	}

	const entered: Comparison["entered"] = []
	const left: Comparison["left"] = []
	for (const key of keys) {
		const { off, on } = pair(key)
		if (on.state === "included" && off.state !== "included")
			entered.push({ key, on, off })
		else if (off.state === "included" && on.state !== "included")
			left.push({ key, on, off })
	}

	const before = baseline.order
	const after = variant.order
	const moved: Comparison["moved"] = []
	for (const [to, key] of after.entries()) {
		const from = before.indexOf(key)
		if (from >= 0 && from !== to)
			moved.push({ key, title: pair(key).on.title, from, to })
	}

	const identical = baseline.prompt === variant.prompt
	// `A` and `B` as the patch's file names rather than the variants' own,
	// which are sentences: `createTwoFilesPatch` quotes and octal-escapes any
	// name with a non-ASCII character in it, so a preset described with an
	// em dash arrives in the header as `\342\200\224`. The names are printed
	// above the patch, where they are readable.
	const patch = identical
		? ""
		: createTwoFilesPatch(
				"A",
				"B",
				baseline.prompt,
				variant.prompt,
				undefined,
				undefined,
				{ context: 2 }
			)

	return {
		sessionId,
		// `sessions.name` is nullable — a one-on-one session is normally
		// unnamed — so the id stands in rather than a blank column.
		title: session.name || `session ${sessionId}`,
		messageCount: Number(count ?? 0),
		baseline,
		variant,
		identical,
		entered,
		left,
		moved,
		patch
	}
}

/** Every session with at least one message — the default set to compare over. */
export async function sessionsWithMessages(db: Db): Promise<number[]> {
	const rows = await db
		.select({ id: schema.sessions.id })
		.from(schema.sessions)
		.where(
			sql`exists (select 1 from session_messages m where m.session_id = ${schema.sessions.id})`
		)
		.orderBy(schema.sessions.id)
	return rows.map((r) => r.id)
}

// ─── The report ─────────────────────────────────────────────────────────────

const pad = (text: string, width: number) =>
	text.length >= width ? text : text + " ".repeat(width - text.length)

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** One entry's standing, in one line a person can act on. */
function standingLine(s: EntryStanding): string {
	switch (s.state) {
		case "included":
			return `in the prompt · ${s.reason}${s.score !== null ? ` · scored ${s.score.toFixed(3)}` : ""}`
		case "excluded":
			return `retrieved, not selected · ${s.reason}${s.why ? ` — ${s.why}` : ""}`
		case "skipped":
			return `not retrieved · ${s.why || s.reason}`
		default:
			return "never seen on this side"
	}
}

export interface RenderOptions {
	/** Print both prompts in full instead of a patch. */
	full?: boolean
	/** Suppress the patch entirely — for a sweep over many sessions. */
	summaryOnly?: boolean
}

/**
 * The comparison, as something a person reads and forms a judgement from.
 *
 * Deliberately not a pass/fail line. The question this answers is *"would I
 * have wanted that in the prompt"*, and the only honest output for that is the
 * entries that changed, the reason each side gave, and the text itself.
 */
export function renderComparison(
	c: Comparison,
	options: RenderOptions = {}
): string {
	const out: string[] = []
	const rule = "═".repeat(78)

	out.push(rule)
	const named = c.title === `session ${c.sessionId}` ? "" : ` · ${c.title}`
	out.push(
		`session ${c.sessionId}${named} · ${c.messageCount} message(s)`
	)
	out.push(`  A  ${c.baseline.name}`)
	out.push(`  B  ${c.variant.name}`)
	out.push(rule)

	for (const side of [c.baseline, c.variant])
		if (side.stopped)
			out.push(`⚠ ${side.name}: never reached the provider — ${side.stopped}`)

	if (c.identical) {
		out.push("")
		out.push(
			"IDENTICAL — the two configurations produced the same prompt, byte for byte."
		)
		// Worth saying out loud rather than leaving as an absence: a control
		// that changed nothing on this session may still change everything on
		// the next one, and it may also be reaching nothing at all.
		const moved = c.moved.length
		if (moved)
			out.push(
				`  (${moved} entr${moved === 1 ? "y" : "ies"} changed rank without changing the text)`
			)
		out.push("")
	} else {
		const delta = c.variant.tokens - c.baseline.tokens
		out.push("")
		out.push(
			`PROMPT     ~${c.baseline.tokens} → ~${c.variant.tokens} tokens (${signed(delta)})`
		)
	}

	const inA = [...c.baseline.standings.values()].filter(
		(s) => s.state === "included"
	).length
	const inB = [...c.variant.standings.values()].filter(
		(s) => s.state === "included"
	).length
	out.push(`RETRIEVAL  ${inA} entr${inA === 1 ? "y" : "ies"} in A, ${inB} in B`)

	const block = (
		label: string,
		rows: Array<{ key: string; on: EntryStanding; off: EntryStanding }>
	) => {
		out.push(`  ${label} (${rows.length})`)
		for (const row of rows) {
			const title = row.on.title || row.off.title
			out.push(`      ${pad(title, 28)} ${row.on.source}`)
			out.push(`        B: ${standingLine(row.on)}`)
			out.push(`        A: ${standingLine(row.off)}`)
		}
	}
	if (c.entered.length) block("+ entered", c.entered)
	if (c.left.length) block("− left", c.left)
	if (c.moved.length) {
		out.push(`  ~ reordered (${c.moved.length})`)
		for (const m of c.moved)
			out.push(`      ${pad(m.title, 28)} ${m.from + 1} → ${m.to + 1}`)
	}
	if (!c.entered.length && !c.left.length && !c.moved.length)
		out.push("  (no entry entered, left or changed rank)")

	// The gather branches, side by side, so "the gate admitted two" is visible without
	// reading a prompt. Only branches whose numbers differ, because a run has a
	// dozen of them and eleven are usually the same on both sides.
	const laneRows: string[] = []
	for (const a of c.baseline.branches) {
		const b = c.variant.branches.find((l) => l.nodeKey === a.nodeKey)
		if (!b) continue
		const parts: string[] = []
		const compare = (
			label: string,
			x: number | string | null,
			y: number | string | null
		) => {
			if (x === y || (x === null && y === null)) return
			parts.push(`${label} ${x ?? "–"} → ${y ?? "–"}`)
		}
		compare("matched", a.matched, b.matched)
		compare("considered", a.considered, b.considered)
		compare("by evidence", a.admittedByEvidence, b.admittedByEvidence)
		compare("threshold", a.admitThreshold, b.admitThreshold)
		compare("skipped", a.skipped, b.skipped)
		compare("vectors", a.vectorSearch, b.vectorSearch)
		if (parts.length)
			laneRows.push(`  ${pad(a.nodeKey, 30)} ${parts.join(" · ")}`)
	}
	if (laneRows.length) {
		out.push("GATHER BRANCHES")
		out.push(...laneRows)
		// ⚠ Said here because the number reads as a per-branch one and is not.
		// `admittedByEvidence` counts the whole shared scan, so all three lore
		// branches report the same figure and a reader would otherwise conclude
		// that character lore admitted something on a session with none.
		if (laneRows.some((row) => row.includes("by evidence")))
			out.push(
				"  (\"by evidence\" counts the shared scan, so every lore gather branch reports the same number)"
			)
	}

	if (!options.summaryOnly && !c.identical) {
		out.push("")
		if (options.full) {
			out.push(`───── A · ${c.baseline.name} ─────`)
			out.push(c.baseline.prompt)
			out.push(`───── B · ${c.variant.name} ─────`)
			out.push(c.variant.prompt)
		} else {
			out.push("PROMPT DIFF")
			out.push(c.patch.trimEnd())
		}
	}

	out.push("")
	return out.join("\n")
}

// ─── Named configurations ───────────────────────────────────────────────────

/** The three lore gather branches in the shipped reply document. */
const LORE_GATHER_BRANCHES = [
	"gather.worldLore.read",
	"gather.characterLore.read",
	"gather.historyEntries.read"
]

const onEveryLane = (path: string, value: unknown): Override[] =>
	LORE_GATHER_BRANCHES.map((nodeKey) => ({ nodeKey, path, value }))

/** A per-source map, for the ranker's transposed signal fields. */
const perLoreSource = (value: number) => ({
	messages: 0,
	worldLore: value,
	characterLore: value,
	history: value,
	relationships: 0
})

export interface Preset {
	/** What turning this on is supposed to buy, in one sentence. */
	about: string
	overrides: Override[]
}

/**
 * The things that ship off, each as one flag.
 *
 * ⚠ **Values, not recommendations.** Each is the number that mechanism's own
 * declaration describes as "on"; whether it is the *right* number is the
 * question this tool exists to help somebody answer, and the answer is
 * different for different lorebooks. Nothing here is a default in waiting.
 */
export const PRESETS: Record<string, Preset> = {
	admission: {
		about:
			"evidence admits an entry no key matched — a keyless book starts working",
		overrides: onEveryLane("admitThreshold", 0.3)
	},
	trigrams: {
		about:
			"fuzzy key matching: inflection and typos fire an exact key, weakly",
		overrides: onEveryLane("trigramFolding", 0.6)
	},
	balanced: {
		about:
			"BM25 instead of raw overlap: a long entry stops winning for being long",
		overrides: onEveryLane("lexicalScoring", "balanced")
	},
	title: {
		about: "a term in an entry's title outranks the same term in its keys",
		overrides: onEveryLane("titleWeight", 2)
	},
	recursion: {
		about: "one further pass, so an entry another entry names can be found",
		overrides: onEveryLane("maxRecursionDepth", 1)
	},
	proximity: {
		about: "keys that matched close together count for more than scattered ones",
		overrides: [
			{
				nodeKey: "rank",
				path: "signalProximity",
				value: perLoreSource(0.2)
			}
		]
	},
	semantic: {
		about: "the vector mechanism on: entries scored on meaning as well as words",
		overrides: [
			{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 20 }
		]
	},
	entities: {
		about: "the entity mechanism on: entries found by the names the scene is using",
		overrides: [
			{ nodeKey: "gather.entities.read", path: "maxEntries", value: 20 }
		]
	},
	descriptions: {
		about:
			"the entity-vector mechanism on: entries reached by a description the scene used rather than a name it said",
		// ⚠ **One override, because the mechanism has one switch.** `maxMentions`
		// sits on the *first* node of the chain, so off means nothing is read
		// and nothing is embedded; `entity-link.maxLinks` and
		// `signalEntityVector` both ship non-zero so that raising this alone
		// does something.
		overrides: [
			{ nodeKey: "names.arm.mentions", path: "maxMentions", value: 4 }
		]
	},
	"score-led": {
		about:
			"score allocates, floors guarantee, shares cap — design §7's inversion",
		overrides: [
			{ nodeKey: "rank", path: "scoreLedAllocation", value: true }
		]
	},
	"keyword-only": {
		about:
			"the name mechanism off entirely, so only literal matching contributes",
		overrides: [
			{
				nodeKey: "rank",
				path: "mechanismWeights",
				value: { keyword: 1, semantic: 1, name: 0 }
			}
		]
	}
}

/** The baseline every preset is measured against: this install, unchanged. */
export const SHIPPED: Variant = { name: "as configured", overrides: [] }

/** A named preset as a `Variant`, or `null` when the name is not one. */
export const presetVariant = (name: string): Variant | null => {
	const preset = PRESETS[name]
	return preset
		? { name: `${name} — ${preset.about}`, overrides: preset.overrides }
		: null
}
