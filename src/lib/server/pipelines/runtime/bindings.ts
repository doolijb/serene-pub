/**
 * Core's bindings — one per node definition (U5).
 *
 * Each is a **wrapper around code that already exists**, not a rewrite. That is
 * the whole shape of step 3 in docs-dev/INTEGRATING.md: the pipeline path runs
 * the same retrieval, the same prompt builder and the same adapters that the
 * current path does, so a difference in output is a bug in the wiring rather
 * than a difference in behaviour nobody can locate.
 *
 * A binding does no I/O of its own. It reads through `ctx.read` and describes
 * writes through `ctx.commit`, both of which land in `host.ts` — see the note
 * there for why the effect belongs to the substrate rather than to the handler.
 *
 * A definition with no handler is simply absent from this table — the executor
 * reports "no binding registered" and `bootstrap.ts` asserts the ones core
 * ships are complete. (A `notYet` halt helper stood here through the 0.6
 * migration and was deleted 2026-09-16 once nothing called it.)
 */

import { memberFormOn } from "$lib/server/state/memberForm"
import type { Bindings } from "@serene-pub/sdk"
import {
	ok,
	halt,
	reads,
	isBandIntent,
	splitCandidates,
	withBandIntents,
	// 🚧 D6: the rules-action inlet is bound once its contract is declared.
	getDefinition,
	type BandIntent
} from "@serene-pub/sdk"

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
	CoreQueryCtx,
	NodeInput,
	OracleCtx,
	SharedInput,
	TaskCtx
} from "./bindingTypes"
import { normaliseTfidf } from "$lib/server/pipelines/ranking/keywordQuery"
import {
	fuseRanks,
	disjointOrderings
} from "$lib/server/pipelines/ranking/strategy"
import { select } from "$lib/server/pipelines/ranking/select"
import { applyEligibility } from "$lib/server/pipelines/ranking/eligibility"
import { markShownElsewhere } from "$lib/server/pipelines/ranking/shownElsewhere"
// The relationship mechanism (ruling 2026-09-10, Q1), in its own module — see
// the header there for why it is not written inline.
import { relationshipSearchBindings } from "./bindings.relationships"
import { pluginStorageBindings } from "./bindings.pluginStorage"
// Stats and states, in their own module for the same reason — see its header
// for why the write does not go through a host seam.
import { stateBindings } from "./bindings.state"
import { cutOutBindings } from "./cutOut"
import { spriteFillBindings } from "./spriteFill"
import { portraitBindings } from "./portrait"
import { illustrateSceneBindings } from "./illustrateScene"
import { messageLineBindings } from "$lib/server/pipelines/speech/messageLine"
import { clockStepBindings } from "./clockStep"
import { roundWorthBindings } from "./roundWorth"
import { sceneBoundariesBindings } from "./sceneBoundaries"
import { describeImageBindings } from "./describeImage"
// Is a room name already described (lair pass R7) — its own module, same reason.
import { undescribedNameBindings } from "./undescribedName"
import {
	rankSemantic,
	mergeWindows
} from "$lib/server/pipelines/ranking/semantic"
import { queryWindows } from "$lib/server/pipelines/ranking/ragQuery"
import {
	BUDGET_GROUP_ALIASES,
	DEFAULT_SIGNAL_WEIGHTS,
	PRIORITY_SCORE_BONUS,
	bandsFromIntents,
	isShareNormalisation,
	withDefaults,
	type MechanismWeights,
	type SignalWeights,
	type RetrievalBand
} from "$lib/server/pipelines/ranking/weights"
import { type RenderRun } from "$lib/server/pipelines/prompt/renderers"
import {
	DEFAULT_CHANNEL,
	isAllChannels,
	parseChannel,
	resolveChannel
} from "$lib/server/messages/channels"
import { historyReadTokens } from "$lib/server/pipelines/prompt/transcriptFit"
import { contextBudgetFrom } from "$lib/server/pipelines/runtime/contextWindow"
import {
	seatRefLookupOfCast,
	standingTurnPlan,
	type CastRead,
	type RotationMessage
} from "$lib/server/pipelines/runtime/speakerRotation"
import { TURN_PLAN_WINDOW } from "$lib/server/sessions/turnPlan"
import {
	STATUS,
	bandIntentFrom,
	readsOfDescriptor,
	stepSlots
} from "./bindings.shared"
import { promptBindings } from "./bindings.prompt"
import { retrievalBindings, LORE_LANES } from "./bindings.retrieval"
import { turnOrderBindings, TURN_STRATEGIES } from "./bindings.turnOrder"
import { providerBindings } from "./bindings.providers"
import { outletBindings } from "./bindings.outlets"
import { summarizeBindings } from "./bindings.summarize"
export { renderToolResult, selectJsonPaths } from "./bindings.providers"
export { exclusionsFrom, SEMANTIC_SEARCH_SOURCES } from "./bindings.retrieval"
export { castEntityRefs } from "./bindings.shared"


/**
 * ⚠ **This file's `Unsupplied` population is ZERO** (R-12, 2026-09-16) — the
 * count `bindingTypes.ts` keeps by grep reads 0 here.
 *
 * The rule: a handler reads a name only where its definition declares it. The
 * sixteen reads swept to get here — `limit` and
 * `channel` on session-history (the declared spelling is `params.*`); the
 * top-level `limit` on the lore lanes, lorebook-triggers and entity-search
 * (nothing ever wrote it — the message window is the literal below);
 * `vector`/`sources` on vector-search; `lists`/`similarity` on rank-semantic;
 * `availableTokens` on rank-hybrid and `params.budget` on assemble (both
 * `budget.*`); `main`/`promptConfig`/`narratorName`/`characterLore` on the
 * context builder; `compiledPrompt`/`main`/`generatingMessageMetadata` on
 * generate-*; `main` on generate-image; the flat `topic`, `knownCast` and
 * `currentCharacterId` (all inside a declared port's payload). None had a
 * supplier: no spec, no migration and no host write ever formed the key, so
 * every one of them was a `??` fallback that could not fire.
 *
 * What replaced the exemptions is a DECLARATION per handler — `reads<…>()` on
 * every registration below — and the guard in `boot/declaredReads.ts`, which
 * fails on a declared name no handler reads as well as on a read no
 * definition supplies.
 */

/**
 * The declared signal fields, `signalKeyword` → `signals[source].keyword`.
 *
 * The descriptor declares the matrix transposed — nine `perMember` fields,
 * because a `parameters` schema's unit is the field and its control is a
 * per-source row — while `withDefaults` demands the untransposed shape with
 * one law attached: **naming a source means giving it a complete set** (no
 * deep merge, so a partial set cannot silently inherit weights the user
 * thought they had replaced). This transposes back and *constructs* that
 * completeness: any field the config did not carry falls back per-field to
 * the default, so the set handed over is total whichever fields arrived.
 */
const SIGNAL_FIELDS: Array<[param: string, signal: keyof SignalWeights]> = [
	["signalKeyword", "keyword"],
	["signalNameMatch", "nameMatch"],
	["signalEntityCooccurrence", "entityCooccurrence"],
	["signalTfidf", "tfidf"],
	["signalLastRefRecency", "lastRefRecency"],
	// ⚠ `signalRecency` and `signalSceneAffinity` were the two rows between
	// these — declared, transposed, scored, and weighing a signal no mechanism
	// has ever produced. Removed with their declarations; see `SignalWeights`.
	["signalDensity", "density"],
	["signalProximity", "proximity"],
	["signalSemantic", "semantic"],
	["signalEntityVector", "entityVector"],
	["signalPriorityBonus", "priorityBonus"]
]

function signalsFrom(
	params: any
): Partial<Record<RetrievalBand, SignalWeights>> | null {
	const carried = SIGNAL_FIELDS.filter(
		([param]) => params[param] && typeof params[param] === "object"
	)
	if (!carried.length) return null
	const signals: Partial<Record<RetrievalBand, SignalWeights>> = {}
	for (const source of Object.keys(
		DEFAULT_SIGNAL_WEIGHTS
	) as RetrievalBand[]) {
		const set = { ...DEFAULT_SIGNAL_WEIGHTS[source] }
		for (const [param, signal] of carried) {
			const v = params[param][source]
			if (typeof v === "number" && Number.isFinite(v)) set[signal] = v
		}
		signals[source] = set
	}
	return signals
}

/**
 * The three mechanism strengths, `mechanismWeights` → `RankingParams.mechanisms`.
 *
 * Read key by key rather than passed through, because the stored value is JSON
 * off a row and a missing or non-numeric member must fall back to 1 — neutral —
 * rather than to `undefined`, which the score would multiply into `NaN` and
 * silently zero every candidate. `withDefaults` merges what comes back over
 * `DEFAULT_MECHANISMS`, so an absent field is *not* the same as a zero.
 *
 * Negative is clamped for the reason `admitThreshold` and `trigramFolding` are:
 * a mechanism worth less than nothing would let a match *subtract* from a score,
 * and the plan's second governing rule is that adding a mechanism may only add
 * matches.
 */
function mechanismsFrom(params: any): Partial<MechanismWeights> | null {
	const raw = params?.mechanismWeights
	if (!raw || typeof raw !== "object") return null
	const out: Partial<MechanismWeights> = {}
	for (const key of ["keyword", "semantic", "name"] as const) {
		const v = raw[key]
		if (typeof v === "number" && Number.isFinite(v))
			out[key] = Math.max(0, v)
	}
	return Object.keys(out).length ? out : null
}

/**
 * The ranker's cross-source params — and ONLY those (R-7 P5, 2026-09-16).
 *
 * ⚠ `share`, `maxEntries` and `minEntries` were read here as five-band maps
 * and are not any more: the bands are resolved from the **band intents** the
 * sources publish at the head of their candidates (`bandsFromIntents`), and
 * a stored map at the ranker's old address is culled by `reconcileConfigs`
 * after migration 0135 has moved its members to the nodes that own them. Not
 * read "just in case" — a fallback read here would be the per-source table on
 * the ranker coming back through the side door, and `declaredReads` would
 * fail it as an undeclared read besides.
 */
function rankingParamsFrom(params: any) {
	if (!params || typeof params !== "object") return {}
	const out: Record<string, unknown> = {}
	const signals = signalsFrom(params)
	if (signals) out.signals = signals
	const mechanisms = mechanismsFrom(params)
	if (mechanisms) out.mechanisms = mechanisms
	return out
}

/**
 * The allocation precedence, read separately from everything above.
 *
 * Not part of `rankingParamsFrom` because it is not part of `RankingParams`,
 * deliberately: `select`'s own docblock argues that a switch between two
 * implementations of one function does not belong beside the weights it is
 * choosing between. This seam is where the declaration meets the call, which is
 * exactly what `retrievalParamsFrom` is for the lore lanes.
 *
 * `=== true` rather than truthiness. A config value is JSON that came off a
 * row, and every other reading of `"false"` or `0` in that position turns the
 * inversion **on** — which is the one direction a misread must not go, because
 * a default-off control that switches itself on during an upgrade changes what
 * reaches the model on an install that never asked.
 */
function scoreLedFrom(params: any): boolean {
	return params?.scoreLedAllocation === true
}

/** `core:task/query-windows@1`'s `searchByMeaning`, as the node read it. */
export type SearchByMeaningSetting = "auto" | "on" | "off"

/**
 * Whether the semantic mechanism searches this turn, and the sentence that
 * says why — `core:task/query-windows@1`'s one decision.
 *
 * `on` and `off` are what they say. `auto` searches whenever an embedding
 * model is **set up** — the embed step's connection resolved to one — and
 * skips only when none is (R5: an optional mechanism that is unavailable is
 * skipped). Anything that is not one of the three reads as `auto`, the
 * default.
 *
 * ⚠ **Where the model runs is not a question.** A local ONNX model, an
 * Ollama or KoboldCPP you run yourself and an embedding service billed per
 * request all search alike: a person sets an embedding service up to be
 * used for retrieval. For one day (2026-09-29) `auto` searched only with a
 * model "on this machine", read into ruling F1 (one expensive call per turn);
 * the owner, 2026-09-30: *"I never said to skip paid services for retrieval,
 * that's what they are there for. Don't do that."* So nothing about the
 * connection is read here but that there is one.
 *
 * The connection is this step's own embedding slot, held at the star
 * (`isHeldConnectionSlot`: no pick offered, a stored one dropped): the host
 * embeds through the star, so "set up" means the model the embed actually
 * uses. Whether that model is
 * *loaded* is the host's moment-to-moment fact, not this Task's: a star that
 * is not ready still searches here, `embed-text` makes no call, and
 * `vector-search` names the model — the thing to fix.
 *
 * ⚠ The reasons are sentences a person reads (`explainRetrieval` prints them
 * as "Vector search: …"), and the off ones say what to change. The on ones
 * are receipt-only: when the search runs, `vector-search` has its own line.
 */
export function searchByMeaningDecision(
	value: unknown,
	connection: unknown
): { setting: SearchByMeaningSetting; search: boolean; reason: string } {
	const setting: SearchByMeaningSetting =
		value === "on" || value === "off" ? value : "auto"
	if (setting === "off")
		return {
			setting,
			search: false,
			reason: "off — Search by meaning is off, so the search makes no embedding request"
		}
	if (setting === "on")
		return {
			setting,
			search: true,
			reason: "on — Search by meaning is on"
		}
	if (!connection)
		return {
			setting,
			search: false,
			reason: "off — Search by meaning is Automatic and no embedding model is set up, so the search makes no embedding request"
		}
	return {
		setting,
		search: true,
		reason: "on — Search by meaning is Automatic and an embedding model is set up"
	}
}

/**
 * Every candidate's `source`, in budget vocabulary (`BUDGET_GROUP_ALIASES`,
 * in `ranking/weights.ts` beside the bands it maps onto).
 *
 * Nothing to do for the keyword mechanism: its candidates already carry budget
 * vocabulary, and none of the three alias keys is a band spelling, so a
 * mixed pool off the merge passes through unchanged. The intents that ride
 * ahead of the candidates take the same aliasing inside `bandsFromIntents`,
 * so a source that publishes items as `message` and its intent as `message`
 * lands both on the `messages` band rather than one on each.
 */
function toBudgetGroups(candidates: any[]): any[] {
	return candidates.map((c: any) => {
		const group = BUDGET_GROUP_ALIASES[c?.source]
		return group === undefined ? c : { ...c, source: group }
	})
}

/**
 * One traversal, read by both relationship nodes.
 *
 * Each calls it separately, so the graph is walked twice per turn. That is the
 * same bargain the two lore queries make — they each run the whole keyword scan
 * — and it buys the thing the split is for: two nodes that can be switched off,
 * weighted and laid out independently. They sit in the same `async` block, so
 * the cost is concurrency rather than wall-clock.
 */
/** The two relationship nodes `readGraph` serves. See `LORE_LANES`. */
const RELATIONSHIP_NODES = [
	"core:query/relationships-perspectives@1",
	"core:query/relationships-known@1"
] as const

async function readGraph(
	// Both relationship nodes call it, so both are named — see `loreFor` for
	// why the intersection rather than one of them.
	input: SharedInput<
		[typeof C.relationshipsPerspectives, typeof C.relationshipsKnown]
	>,
	ctx: CoreQueryCtx
) {
	const summary = await ctx.read("graph_context", {
		sessionId: input?.scope?.sessionId,
		// The speaker travels inside the `scope` port; a flat
		// `input.currentCharacterId` is a name neither definition declares and
		// nothing supplies (R-12).
		currentCharacterId: input?.scope?.currentCharacterId ?? null
	})
	// Passed through as the structure it is. It used to be coerced to a string
	// here, which was harmless only because the host had already stringified it
	// — and which would now discard the shape the layout renders.
	return (summary ?? null) as {
		yourRelationships?: Record<string, unknown[]>
		howOthersRegardYou?: Record<string, unknown[]>
		legendaryFigures?: Record<string, unknown>
	} | null
}

/**
 * The node's ceiling, applied to a section keyed by the other character's name.
 *
 * Counted in *relationships*, not in names — one character the speaker has
 * three separate ties to is three, because three is what reaches the prompt.
 * Insertion order is the graph's own ordering, which `buildGraphContext`
 * already sorts by how recently the binding changed.
 */
function capRelationships(
	section: Record<string, unknown[]> | undefined,
	maxEntries: unknown
): Record<string, unknown[]> | null {
	if (!section || Object.keys(section).length === 0) return null
	const cap = typeof maxEntries === "number" ? maxEntries : undefined
	if (cap === undefined || cap < 0) return section
	if (cap === 0) return null

	// A `Map`, not `out[name] = …` on a `{}`: the key is a character's name,
	// and one called `__proto__` set this object's prototype and dropped out
	// of the section (review 2026-09-29; `groupByOther` has the full note).
	const out = new Map<string, unknown[]>()
	let left = cap
	for (const [name, rels] of Object.entries(section)) {
		if (left <= 0) break
		const take = rels.slice(0, left)
		if (take.length === 0) continue
		out.set(name, take)
		left -= take.length
	}
	return out.size ? Object.fromEntries(out) : null
}

/** `session-history@1`'s refusal of `unplayedOnly` on the story's own channel (R13). */
export const UNPLAYED_ON_MAIN_REFUSAL =
	"unplayedOnly reads a side channel's talk since the story's last line — it cannot read the 'main' channel, whose rows are that bound"

/**
 * @param run Which run these bindings are executing for.
 *
 * Only the two rendering nodes read it, and only so a template that names a
 * *plugin's* engine renders as a hook call cancelling the run can find (see
 * `RenderRun`). It is a parameter rather than something read off `ctx` because
 * the SDK's `TaskCtx` carries no run id — a Task is told its inputs and nothing
 * about the machine around it — so `runTurn` supplies it at the one place that
 * has both the run and the binding table. Absent for a caller with no run: the
 * parity harness, `boundTypeIds`, and a test poking one binding directly.
 */
export function coreBindings(run: RenderRun = {}): Bindings {
	const bindings: Bindings = {
		// ── Inputs ──────────────────────────────────────────────────────────
		// An Input node does not fetch; it names what the trigger already
		// carried. Core hands the trigger payload in as the run's input, so the
		// binding is the identity — and that is not a placeholder, it is what an
		// Input *is* (01 §2).
		//
		// Every registration below is wrapped in `reads<…>()` — the handler's
		// own declaration of what it takes off `input`, typed against the
		// definition it is bound to so a misspelt name fails to compile, and
		// read at boot by `bindingCompat.ts` and in the suite by
		// `boot/declaredReads.ts` (R-12). An inlet reads nothing by name: it
		// hands the trigger payload on whole.
		"core:inlet/user-message@1": reads<typeof C.userMessage>(
			async (input: NodeInput<typeof C.userMessage>) => ok(input),
			{ ports: [] }
		),
		"core:inlet/session-created@1": reads<typeof C.sessionCreated>(
			async (input: NodeInput<typeof C.sessionCreated>) => ok(input),
			{ ports: [] }
		),
		// A session event (PLAN-turn-order §4.1, §4.4). Identity like its
		// siblings: `emitSessionEvent` shaped the input — the event, its
		// payload, its cause and its instant — and the host put the settings
		// document and its cast on it at run start (A3).
		"core:inlet/session-event@1": reads<typeof C.sessionEvent>(
			async (input: NodeInput<typeof C.sessionEvent>) => ok(input),
			{ ports: [] }
		),
		// 🚧 A routine's firing (PLAN-layering D2, R9): the routine runtime
		// shapes the session, where the routine resides, what its moment
		// carried and the ruleset the session plays (`routines/run.ts`); the
		// identity hands it on.
		"core:inlet/routine@1": reads<typeof C.routine>(
			async (input: NodeInput<typeof C.routine>) => ok(input),
			{ ports: [] }
		),
		// The side-character turn (ruling 2026-09-07). Identity like its
		// siblings: the trigger already decided who speaks and whether the
		// lorebook knows them — `sideCharacterFact` in `sessions.ts` is what
		// resolved it, once, before the run started.
		"core:inlet/side-character-turn@1": reads<typeof C.sideCharacterTurn>(
			async (input: NodeInput<typeof C.sideCharacterTurn>) => ok(input),
			{ ports: [] }
		),
		// A built-in write's request (R-15): the venue's handler shaped it
		// after the permission checks; the identity hands it to the outlet.
		"core:inlet/built-in-request@1": reads<typeof C.builtInRequest>(
			async (input: NodeInput<typeof C.builtInRequest>) => ok(input),
			{ ports: [] }
		),
		// A form addressed to the AI (R-15 *Forms*; U5d): `runSpec` shaped it
		// from the block the message write collected, after the asking run's
		// receipt was saved; the identity hands it on.
		"core:inlet/form-addressed@1": reads<typeof C.formAddressed>(
			async (input: NodeInput<typeof C.formAddressed>) => ok(input),
			{ ports: [] }
		),
		// 🚧 A person's message (owner ruling 2026-10-15): the send handler
		// checked the door and shaped it from the person's Send; the identity
		// hands it to the save spec.
		"core:inlet/message-offered@1": reads<typeof C.messageOffered>(
			async (input: NodeInput<typeof C.messageOffered>) => ok(input),
			{ ports: [] }
		),
		// 🚧 A deletion asked (RF fix 5, owner ruling 2026-10-23): the delete
		// handler checked the door and shaped it from the person's press; the
		// identity hands it to the deletion pipeline the genre registered.
		"core:inlet/message-deletion-asked@1": reads<typeof C.messageDeletionAsked>(
			async (input: NodeInput<typeof C.messageDeletionAsked>) => ok(input),
			{ ports: [] }
		),

		// ── Queries ─────────────────────────────────────────────────────────
		/**
		 * The create pipeline's read (24 §12, T8): what the cast wants to say
		 * first. The host owns the implementation (interpolation, group
		 * greetings, the fallback line) — see sessions/greetings.ts.
		 */
		"core:query/session-greetings@1": reads<typeof C.sessionGreetings>(
			async (
				input: NodeInput<typeof C.sessionGreetings>,
				ctx: CoreQueryCtx
			) => {
				const greetings = await ctx.read("session_greetings", {
					sessionId: input?.scope?.sessionId
				})
				return ok({ main: greetings, greetings })
			},
			{ ports: ["scope"] }
		),

		/**
		 * The create pipeline's envoy greeting (lair re-plan R6): the
		 * seated envoy's declared line, interpolated. `text` is empty when
		 * the envoy is not seated or declares none, so the spec's junction
		 * on it skips the write. See sessions/greetings.ts.
		 */
		"core:query/envoy-greeting@1": reads<typeof C.envoyGreeting>(
			async (input: NodeInput<typeof C.envoyGreeting>, ctx: CoreQueryCtx) => {
				const greeting = (await ctx.read("envoy_greeting", {
					sessionId: input?.scope?.sessionId,
					envoy: input?.params?.envoy
				})) as { text: string } | undefined
				const text = greeting?.text ?? ""
				return ok({ main: text, text })
			},
			{ ports: ["scope"], params: ["envoy"] }
		),

		/**
		 * 🚧 The files a transcript's rows show (PLAN-composer-attachments
		 * §3.5): one read for every row on the port, keyed by message id. The
		 * host scopes it to the run's own session — see
		 * `attachments/history.ts`.
		 */
		"core:query/history-attachments@1": reads<typeof C.historyAttachments>(
			async (
				input: NodeInput<typeof C.historyAttachments>,
				ctx: CoreQueryCtx
			) => {
				const rows = (input?.messages ?? []) as Array<{ id?: unknown }>
				const messageIds = rows
					.map((r) => r?.id)
					.filter((id): id is number => typeof id === "number" && id > 0)
				const attachments = messageIds.length
					? ((await ctx.read("history_attachments", {
							messageIds,
							textFileBytes: input?.params?.textFileBytes
						})) ?? {})
					: {}
				return ok({ main: attachments, attachments })
			},
			{ ports: ["messages"], params: ["textFileBytes"] }
		),

		"core:query/session-history@1": reads<typeof C.sessionHistory>(
			async (
				input: NodeInput<typeof C.sessionHistory>,
				ctx: CoreQueryCtx
			) => {
				// The retrieval gather's word (R-19): the run has started
				// reading. Every read in the gather says the same thing, and
				// the executor folds them into one status.
				ctx.status?.(STATUS.thinking)
				/**
				 * Only the unplayed talk (lair re-plan R13): a side
				 * channel's rows since the story's last line. Refused on
				 * `main` (or every channel, which holds it): the story's own
				 * rows are the bound, never the talk.
				 */
				/**
				 * One channel lane, chosen at run time (2026-10-15): the
				 * `channelLane` in-port, wired, names the lane the turn is on
				 * and wins over the `channel` parameter. Written `slug:n` so a bare slug reads its
				 * lane 1, never every lane of it (`channelWhere`) — a lane
				 * is one private conversation.
				 */
				const laneIn =
					typeof input?.channelLane === "string" && input.channelLane.trim()
						? parseChannel(input.channelLane)
						: null
				const channel = laneIn
					? `${laneIn.slug}:${laneIn.lane}`
					: (input?.params?.channel ?? "main")
				const unplayedOnly = input?.params?.unplayedOnly === true
				if (unplayedOnly) {
					const selector = resolveChannel(channel)
					if (
						isAllChannels(selector) ||
						parseChannel(selector).slug === DEFAULT_CHANNEL
					)
						return halt(UNPLAYED_ON_MAIN_REFUSAL)
				}
				const readTokens = historyReadTokens(
					(input?.budget as { total?: unknown } | undefined)?.total
				)
				const messages = await ctx.read("session_messages", {
					sessionId: input?.scope?.sessionId,
					/**
					 * `topK`'s twin, closed on the same terms (ruling 2026-09-09).
					 *
					 * `limit` is a declared *parameter* of this node — "How many
					 * recent messages are considered for the context" — and it
					 * arrives at `input.params.limit`. This read the top level,
					 * which nothing sets, so every run took the literal 100 and
					 * the control did nothing.
					 *
					 * The declared default is **100** now, not 40: the number the
					 * declaration carried had never been the number a run used,
					 * and wiring the control while leaving it at 40 would have
					 * shrunk the transcript window on every install at defaults —
					 * a retrieval change wearing a typing fix. Today's effective
					 * value is declared first; moving it is a separate decision
					 * against the measure corpus.
					 *
					 * No top-level `input.limit` behind this (R-12): the
					 * definition declares no such name, no document names the
					 * key, and the fallback is the declared default.
					 */
					limit: input?.params?.limit ?? 100,
					/**
					 * **Sized by the window** (history window, 2026-10-03):
					 * with `budget` wired, the host reads the newest rows up to
					 * twice the budget by a generous estimate (never more than
					 * `HISTORY_READ_MAX_ROWS`) and `limit` is not read — so
					 * `assemble`'s transcript fit, not a row count, decides
					 * where the conversation starts. The talk (`unplayedOnly`)
					 * keeps its `limit`; the host says the same.
					 */
					...(readTokens && !unplayedOnly ? { readTokens } : {}),
					// Which lane builds this context (20 §7). 'main' is the chat
					// log and today's exact behaviour; another value is a mode's
					// declared channel, read on purpose by the pipeline that
					// wants it. No flat `input.channel` either, on the same terms.
					channel,
					...(unplayedOnly ? { unplayedOnly: true } : {}),
					/**
					 * Side channels as talk (lair re-plan R10's fold-in of the
					 * R9 follow-up): off `main`, only people's lines and the
					 * replies fired there — never a greeting or a turn's beats
					 * row. The host applies the rule (`sideTalkOnly`).
					 */
					...(input?.params?.talkOnly === true ? { talkOnly: true } : {}),
					/**
					 * 🚧 No table lines (2026-10-15): a spec that turns them
					 * off reads only what was said — never a roll line
					 * (`metadata.tableLine`) a model would take for its own
					 * speech. Absent or true reads every row, as always.
					 */
					...(input?.params?.tableLines === false ? { tableLines: false } : {}),
					/**
					 * One row, by id (lair re-plan R11): the message a press
					 * on a message's ⋮ was made on, when the spec wires the
					 * inlet's `messageId` here. The host reads exactly that
					 * row; the window above does not apply.
					 */
					...(typeof input?.messageId === "number"
						? { messageId: input.messageId }
						: {})
				})
				/**
				 * 🚧 What the speaking character was there for: invoked only when
				 * the `firsthandFor` port is wired — its key is present even when
				 * the value is null (a narrator turn, which reads everything).
				 * Unwired: the rows above, untouched, no receipt line. A one-row
				 * read (`messageId`: a person's press) is never filtered. A card-less
				 * seat's turn is named by the scope's `currentCastMemberId`. The
				 * decision is `sessions/firsthandFilter.ts`.
				 */
				let rows: any = messages
				if (
					input !== undefined &&
					input !== null &&
					"firsthandFor" in input &&
					typeof input.messageId !== "number" &&
					Array.isArray(messages)
				) {
					const sessionId = input?.scope?.sessionId
					const by =
						typeof input.firsthandBy === "string" && input.firsthandBy.trim()
							? input.firsthandBy.trim()
							: null
					const { loadFirsthandView, keptLineIds, linesReceipt, readsAllReceipt } =
						await import("$lib/server/sessions/firsthandFilter")
					const db = (await import("$lib/server/db")).db as never
					const read =
						typeof sessionId === "number"
							? await loadFirsthandView(db, {
									sessionId,
									characterId: input.firsthandFor,
									castMemberId: input?.scope?.currentCastMemberId,
									slotId: by,
									lineIds: messages.map((m: { id: number }) => m.id)
								})
							: ({ kind: "reads-all" } as const)
					if (read.kind === "reads-all") ctx.log("info", readsAllReceipt())
					else {
						const { keptIds, leftOut } = keptLineIds(
							read.view,
							messages.map((m: { id: number; castMemberId?: number | null }) => ({
								id: m.id,
								castMemberId: m.castMemberId ?? null
							}))
						)
						const kept = new Set(keptIds)
						rows = messages.filter((m: { id: number }) => kept.has(m.id))
						ctx.log("info", linesReceipt(read.view, leftOut))
					}
				}
				// `main` and `messages` carry the same value on purpose: `main`
				// is what an unrefined `$.history` resolves to, and having it be
				// the useful thing rather than a wrapper is what makes the scope
				// sugar read well.
				return ok({
					main: rows,
					messages: rows,
					/**
					 * The conversation's band intent, alone, on its own port
					 * (R-7 P5): a spec concatenates it in with the lore so the
					 * ranker reserves the transcript's slice of the window —
					 * `share` 0.5 is `MESSAGE_FILL_FRACTION`, the number the
					 * ranker's map held. Not on `main`, which carries rows for
					 * `process-messages`.
					 */
					band: [
						bandIntentFrom("messages", input?.params, { minimum: true })
					]
				})
			},
			{
				ports: ["scope", "messageId", "budget", "channelLane", "firsthandFor", "firsthandBy"],
				params: [
					"limit",
					"channel",
					"unplayedOnly",
					"talkOnly",
					"tableLines",
					// The band intent — `priority` read at last (R-7 P5).
					"share",
					"maxEntries",
					"minEntries",
					"priority"
				]
			}
		),

		/**
		 * 🚧 **The standing turn plan** a character turn plays from (Lair
		 * character turns, owner ruling 2026-09-30): the newest row carrying
		 * a turn plan, across every channel, unless a person's line on `main`
		 * is newer — `standingTurnPlan`, the reading the narrator strategy
		 * prepares the turns from, so the turn and the order never disagree.
		 * With `messageId` (a re-voice) only rows older than it count. No
		 * plan standing: every port absent, and the turn plays from the scene
		 * as it stands.
		 */
		"core:query/turn-plan@1": reads<typeof C.turnPlan>(
			async (input: NodeInput<typeof C.turnPlan>, ctx: CoreQueryCtx) => {
				const rows = (await ctx.read("session_messages", {
					sessionId: input?.scope?.sessionId,
					channel: "*",
					limit: TURN_PLAN_WINDOW
				})) as RotationMessage[]
				const before =
					typeof input?.messageId === "number" ? input.messageId : undefined
				// ⏳ A person's line is read as the seat the cast names (member
				// form once `state/memberForm.ts` is on); the cast is read only then.
				const refOfMember = memberFormOn()
					? seatRefLookupOfCast(
							(await ctx.read("session_cast", {
								sessionId: input?.scope?.sessionId
							})) as CastRead | null
						)
					: undefined
				const standing = standingTurnPlan(rows ?? [], before, refOfMember)
				const stored = (standing?.row.turnPlan ?? null) as {
					plan?: unknown
					locationPassage?: unknown
				} | null
				if (!stored) return ok({ main: null })
				const passage =
					typeof stored.locationPassage === "string" && stored.locationPassage
						? stored.locationPassage
						: undefined
				return ok({
					main: stored,
					...(stored.plan !== undefined ? { plan: stored.plan } : {}),
					...(passage ? { locationPassage: passage } : {})
				})
			},
			{ ports: ["scope", "messageId"] }
		),

		// Retrieval: the lore lanes, triggers, vector, entity and docs search.
		...retrievalBindings(),

		/**
		 * Who is in the session, and the config they speak under.
		 *
		 * A Query because it reads rows, and one Query rather than three because
		 * the cast is only useful assembled: a character row without its
		 * `sessionCharacters` join carries no `enabled`, and `enabled` is what
		 * decides whether that character is named and given a turn.
		 *
		 * It decides nothing. Every seat goes out, switched off or not, each
		 * with `enabled`; which rows are shown, named or trimmed is the
		 * context Task's business, and who may speak the turn pool's.
		 */
		/**
		 * The speaker's relationships, from the narrative graph.
		 *
		 * Empty is normal, not a halt: an install that never opened the graph
		 * has no relationships, and the shipped template's `{{#if}}` skips the
		 * block. Halting here would stop every session on every install without
		 * one — which is what makes "produces nothing" the right shape for a
		 * Query that is genuinely optional.
		 */
		"core:query/relationships-perspectives@1": reads<
			typeof C.relationshipsPerspectives
		>(
			async (
				input: NodeInput<typeof C.relationshipsPerspectives>,
				ctx: CoreQueryCtx
			) => {
				const graph = await readGraph(input, ctx)
				// Each node takes its own section of one traversal's result,
				// the same way the two lore queries each filter one scan.
				// Returning `null` rather than `{}` for an absent section keeps
				// the template's `{{#if}}` falsy without the layout having to
				// know.
				const mine = capRelationships(
					graph?.yourRelationships,
					input?.params?.maxEntries
				)
				return ok({ main: mine, relationshipsPerspectives: mine })
			},
			{ ports: ["scope"], params: ["maxEntries"] }
		),

		"core:query/relationships-known@1": reads<typeof C.relationshipsKnown>(
			async (
				input: NodeInput<typeof C.relationshipsKnown>,
				ctx: CoreQueryCtx
			) => {
				const graph = await readGraph(input, ctx)
				const known = capRelationships(
					graph?.howOthersRegardYou,
					input?.params?.maxEntries
				)
				// Two conditional sections, and absent means absent: an
				// install with no legendary figures has no key at all rather
				// than an empty object, which is what the shipped layout's
				// guards are written against.
				const out: Record<string, unknown> = {}
				if (known) out.howOthersRegardYou = known
				if (graph?.legendaryFigures)
					out.legendaryFigures = graph.legendaryFigures
				const value = Object.keys(out).length ? out : null
				return ok({ main: value, relationshipsKnown: value })
			},
			{ ports: ["scope"], params: ["maxEntries"] }
		),

		// The same graph, ranked and budgeted rather than dumped.
		...relationshipSearchBindings(),

		// 🚧 One file of the running plugin's own storage (M2a).
		...pluginStorageBindings(),

		// The session's stats and states: one node reads them,
		// one changes them.
		...stateBindings(run),

		// Each picture with its background removed (image generation I4).
		...cutOutBindings(),

		// 🚧 The Sprite set fill's card inlet and its series (I5).
		...spriteFillBindings(),
		// 🚧 Portrait's candidates and its gallery offer (I8).
		...portraitBindings(),
		// 🚧 The Scene action's likeness images, clean step and placement (I9).
		...illustrateSceneBindings(),
		// 🚧 Time passes… and the reply tick (live scenes §6).
		...clockStepBindings(),
		...roundWorthBindings(),
		...sceneBoundariesBindings(),
		// 🚧 Describe image — a picture read by the job that reads pictures (D1).
		...describeImageBindings(),
		// 🚧 One message as a line to speak — Read aloud / Say it as… (speech ★1).
		...messageLineBindings(),

		// Is a room name already described, by an entry or by recent prose.
		...undescribedNameBindings(),

		/**
		 * 🚧 **A person's channel lane** (owner ruling 2026-10-17;
		 * INTEGRATING §1h): the lane that is `person`'s on a channel the
		 * genre declares `lanes: 'personal'` — the session's lane register
		 * row, or a new one allocated under the `nextLane` lock
		 * (`channels/lanes.ts`). The same ask twice is the same lane; a
		 * shared channel, a person who is not `user:<id>` of a member, or a
		 * session that is gone halts with the sentence.
		 */
		"core:query/channel-lane@1": reads<typeof C.channelLane>(
			async (input: NodeInput<typeof C.channelLane>) => {
				const sessionId = Number(input?.scope?.sessionId)
				if (!Number.isInteger(sessionId))
					return halt("there is no session to find a lane in — the run is not scoped to one")
				const slug = typeof input?.channel === "string" ? input.channel.trim() : ""
				if (!slug) return halt("channel names the channel's slug — it was empty")
				const m = /^user:([1-9][0-9]*)$/.exec(String(input?.person ?? ""))
				if (!m)
					return halt(
						`person is a person's reference, 'user:<id>' — '${String(input?.person ?? "")}' is not one`
					)
				const { laneFor, LaneRefusal } = await import("$lib/server/channels/lanes")
				const { db } = await import("$lib/server/db")
				try {
					const out = await laneFor(db, sessionId, slug, Number(m[1]))
					return ok({ lane: out.channel, opened: out.opened })
				} catch (error) {
					if (error instanceof LaneRefusal) return halt(error.message)
					throw error
				}
			},
			{ ports: ["scope", "channel", "person"] }
		),
		"core:query/session-cast@1": reads<typeof C.sessionCast>(
			async (
				input: NodeInput<typeof C.sessionCast>,
				ctx: CoreQueryCtx
			) => {
				const cast = await ctx.read("session_cast", {
					sessionId: input?.scope?.sessionId
				})
				if (!cast)
					return halt(
						"there is no session to build a prompt for — the run is scoped to a " +
							"session that no longer exists"
					)
				// ⚠ The roster the host attaches for retrieval's gazetteer is
				// dropped here, and deliberately. `lorebookBindings` is every
				// character the *book* binds, most of whom are not in this scene;
				// this node's output is the prompt's cast, and a layout that
				// rendered a field it did not recognise would be putting the whole
				// book's dramatis personae into the context window. Retrieval reads
				// the same host row directly (`castEntityRefs`) and needs no help
				// from the prompt path.
				const { lorebookBindings: _roster, ...castForPrompt } =
					cast as {
						lorebookBindings?: unknown
					} & Record<string, unknown>
				// Whose turn it is travels *with* the cast rather than separately.
				// It is one fact about the session — who is in it and who is speaking —
				// and splitting it left the context Task unable to resolve the
				// speaker at all, which the first parity run showed as a missing
				// scenario and no post-history text.
				const withSpeaker = {
					...castForPrompt,
					// From the `scope` port alone: a flat `input.currentCharacterId`
					// is a name this definition does not declare (R-12).
					currentCharacterId: input?.scope?.currentCharacterId ?? null,
					// 🚧 A card-less seat's turn (S4): its member, from the scope
					// too — a spec that wires no `speaker` into the context still
					// names the speaker. Absent on every other turn.
					...(input?.scope?.currentCastMemberId != null
						? { currentCastMemberId: input.scope.currentCastMemberId }
						: {})
				}
				return ok({
					main: withSpeaker,
					cast: withSpeaker,
					// The seated envoys on their own port (PLAN-turn-order
					// §4.4): the same rows `main` carries under `envoys`.
					envoys: Array.isArray(castForPrompt.envoys)
						? castForPrompt.envoys
						: []
				})
			},
			{ ports: ["scope"] }
		),
		/**
		 * The settings document, re-read (PLAN-turn-order §4.12, way 2).
		 * The host owns the resolver (`sessions/settings.ts`); this is the
		 * declared node in front of it, for a spec that placed a write and
		 * wants what is stored now rather than what the inlet carried.
		 */
		/**
		 * One owner's annex document (§4.3). The host resolves whose — the
		 * running spec's namespace unless the params name another and
		 * `sharedAnnex` allows it — and answers `{}` for an owner that has
		 * written nothing, which is the ordinary state.
		 */
		"core:query/session-annex@1": reads<typeof C.sessionAnnex>(
			async (input: NodeInput<typeof C.sessionAnnex>, ctx: CoreQueryCtx) => {
				// `view: 'ai'` is the prompt-safe view (R57); `'template'` is
				// every declared key of every owner in scope, for a template's
				// `annex` port (typed templates P6, law T2); absent is
				// everything of one owner, as a pipeline reads it.
				const view = (input as { view?: unknown })?.view
				if (
					view !== undefined &&
					view !== null &&
					view !== "" &&
					view !== "ai" &&
					view !== "template"
				)
					return halt(
						`view is 'ai', 'template' or left out — '${String(view)}' is none of them`
					)
				// The owner the params name (`owner` + `sharedAnnex`), which the
				// host resolves — passed through, as the lorebook annex's are.
				const params = (input as { params?: unknown })?.params
				const doc = await ctx.read("session_annex", {
					sessionId: input?.scope?.sessionId,
					params,
					...(view === "ai"
						? { view: "ai", speaker: (input as { speaker?: unknown })?.speaker ?? null }
						: view === "template"
							? { view: "template" }
							: {})
				})
				if (doc === null)
					return halt(
						"there is no session to read an annex for — the run is scoped to a " +
							"session that no longer exists"
					)
				// 🚧 The owner's annex document version (M2a a8), for a
				// `set-session-annex`'s `base`; the template view is many
				// owners' and has none.
				if (view === "template") return ok({ main: doc })
				const version = await ctx.read("session_annex_version", {
					sessionId: input?.scope?.sessionId,
					params
				})
				return ok({ main: doc, ...(typeof version === "number" ? { version } : {}) })
			},
			{ ports: ["scope", "view", "speaker"], params: ["owner", "sharedAnnex"] }
		),
		/**
		 * 🚧 One owner's document in the **lorebook annex** (M0, SHAPES
		 * L9): the lorebook the session reads (its attached book overlaid by its
		 * own), or the book a book-level run is scoped to. The owner resolves as
		 * the session annex's does. No `view` — the query has none.
		 */
		"core:query/lorebook-annex@1": reads<typeof C.lorebookAnnex>(
			async (input: NodeInput<typeof C.lorebookAnnex>, ctx: CoreQueryCtx) => {
				const params = (input?.params ?? {}) as { owner?: unknown; sharedAnnex?: unknown }
				const doc = await ctx.read("lorebook_annex", {
					sessionId: input?.scope?.sessionId,
					owner: params.owner,
					sharedAnnex: params.sharedAnnex
				})
				if (doc === null)
					return halt(
						"there is no lorebook annex to read — the run is scoped to neither a session nor a lorebook"
					)
				// 🚧 (M2b) The owner's annex document version, for a `set-lorebook-annex`'s `base`.
				const version = await ctx.read("lorebook_annex_version", {
					sessionId: input?.scope?.sessionId,
					owner: params.owner,
					sharedAnnex: params.sharedAnnex
				})
				return ok({ main: doc, ...(typeof version === "number" ? { version } : {}) })
			},
			{ ports: ["scope"], params: ["owner", "sharedAnnex"] }
		),
		"core:query/session-settings@1": reads<typeof C.sessionSettings>(
			async (
				input: NodeInput<typeof C.sessionSettings>,
				ctx: CoreQueryCtx
			) => {
				const doc = await ctx.read("session_settings", {
					sessionId: input?.scope?.sessionId
				})
				if (!doc)
					return halt(
						"there is no session to read settings for — the run is scoped to a " +
							"session that no longer exists"
					)
				return ok({ main: doc })
			},
			{ ports: ["scope"] }
		),

		// ── Tasks ───────────────────────────────────────────────────────────
		// Turn order: the strategies, the pool and the orderers.
		...turnOrderBindings(),
		/**
		 * Fuse the two mechanisms into one ordering.
		 *
		 * Reciprocal-rank fusion, **not an average**: keyword scores are a
		 * weighted sum in roughly [0, 1.5] and vector scores are cosine in
		 * [-1, 1], so averaging would hand every turn to whichever mechanism happened
		 * to be more generous — and nobody could tell which (DECOMPOSITION §4).
		 *
		 * An entry both mechanisms found outranks one either found alone, which is what
		 * `both` is asking for: agreement between independent signals is evidence.
		 *
		 * ⚠ Which is also the precondition. Handed **disjoint** orderings there
		 * is no agreement to measure, the fused score is each entry's position
		 * in its own list, and the `presetScore` stamped below then overrides
		 * every signal weight in `select`. That is a wiring mistake rather than
		 * a data state, so it is named on the receipt — see the note on
		 * `disjoint` below, and `core:task/concat-candidates@1` for what such a
		 * pipeline meant.
		 */
		// ⚠ Test-only: no shipped spec or parity harness runs this node; kept because the SDK catalog declares it (`vector.int.test.ts`).
		"core:task/merge-candidates@1": reads<typeof C.mergeCandidates>(
			async (input: NodeInput<typeof C.mergeCandidates>) => {
				/**
				 * Band intents (R-7 P5) are lifted out before the fusion and
				 * put back ahead of it: an intent is not an ordering position,
				 * and a fused rank stamped on one would hand the ranker a
				 * "candidate" with no tokens and no id.
				 */
				const intents: BandIntent[] = []
				const bandsSeen = new Set<string>()
				const orderings: any[][] = (input?.sources ?? [])
					.filter(Array.isArray)
					.map((list: any[]) =>
						list.filter((c) => {
							if (!isBandIntent(c)) return true
							if (!bandsSeen.has(c.band)) {
								bandsSeen.add(c.band)
								intents.push(c)
							}
							return false
						})
					)
				const fused = fuseRanks(
					orderings.map((list) =>
						list.map((c: any) => ({
							...c,
							id: c.id,
							source: c.source
						}))
					)
				)

				const candidates = fused.map((f) => ({
					...(f.item as any),
					presetScore: f.score,
					payload: {
						...((f.item as any).payload ?? {}),
						foundBy: f.ranks
							.map((rank, arm) =>
								rank === undefined
									? null
									: `arm${arm}#${rank + 1}`
							)
							.filter(Boolean)
					}
				}))

				/**
				 * ⚠ Two or more mechanisms, and not one entry in common.
				 *
				 * Reported rather than refused, and the line between them is who
				 * would be punished. A halt here would take down a plugin or a
				 * user-authored spec mid-turn over a wiring choice that still
				 * produces candidates; the receipt is where a wiring question
				 * belongs, and this node's whole value is that it says how each
				 * candidate was found.
				 *
				 * It is not a stylistic complaint. Fusion's premise is that two
				 * mechanisms ranked the *same* pool, so agreement is evidence. With
				 * nothing in common every fused score is one list position, the
				 * `presetScore` above overrides the weighted signal sum in
				 * `select`, and the ordering that reaches the prompt is whatever
				 * order the producers happened to emit. That is exactly what the
				 * shipped reply pipeline did to its three lore lanes until spec
				 * 1.17.0, and `core:task/concat-candidates@1` is the node it
				 * wanted.
				 */
				const disjoint = disjointOrderings(orderings)
				const diagnostics = {
					orderings: orderings.length,
					fused: candidates.length,
					/**
					 * Entries more than one ordering produced — the fusion's whole
					 * subject, and the number that is zero when it had none.
					 */
					agreed: fused.filter(
						(f) => f.ranks.filter((r) => r !== undefined).length > 1
					).length,
					disjoint,
					...(disjoint
						? {
								warning:
									`${orderings.filter((o) => o.length > 0).length} orderings ` +
									`reached this merge and none of them share an entry. ` +
									`Rank fusion needs mechanisms that ranked the same pool; on ` +
									`disjoint lists it degrades to concatenation with a ` +
									`fabricated score, and the score it stamps overrides ` +
									`every signal weight downstream. Wire ` +
									`core:task/concat-candidates@1 instead.`
							}
						: {})
				}

				const published = withBandIntents(intents, candidates)
				return ok({ main: published, candidates: published, diagnostics })
			},
			{ ports: ["sources"] }
		),

		/**
		 * Several candidate lists, end to end.
		 *
		 * **Concatenation is not fusion**, and keeping them as two nodes is the
		 * whole point of this one. `core:task/merge-candidates@1` above stamps a
		 * reciprocal-rank `presetScore` on everything it passes through, which
		 * `select` prefers over the weighted signal sum — correct when two mechanisms
		 * ranked one pool and have to be reconciled, and wrong when several
		 * disjoint lanes are simply being handed on, because then the "fused"
		 * score is nothing but each entry's position in its own list.
		 *
		 * So this stamps no score. What arrives at `core:task/rank-hybrid@1`
		 * carries its signals and its source, which is what the ranker needs to
		 * score it and what the share bands need to budget between lanes.
		 *
		 * Repeats drop, first occurrence winning, keyed `source:id` — the three
		 * lore tables have independent identity sequences, so an id alone would
		 * let a world-lore row settle a history row.
		 *
		 * ## Repeats drop, but their **signals** do not
		 *
		 * First-occurrence-wins is right about the candidate and wrong about the
		 * measurements on it, and the difference is what makes several mechanisms into
		 * one score. The keyword scan and the semantic mechanism measure *different
		 * things* about the same entry: one says its keys fired, the other says
		 * it is about what is being discussed. Dropping the second copy whole
		 * would throw the second measurement away, and an entry two independent
		 * mechanisms found would score exactly as if only the first had — which
		 * is the opposite of what the retrieval plan asks for, where *"agreement
		 * across mechanisms compounds by addition and needs no fusion step"*.
		 *
		 * So a duplicate contributes any signal key the kept copy **does not
		 * already carry**, and nothing else. First-wins holds per key as well as
		 * per candidate, which is what keeps this additive rather than
		 * order-dependent:
		 *
		 *   · a keyed entry the semantic mechanism also found keeps every keyword
		 *     signal and gains `semantic`, because no other lane produces it;
		 *   · the entity mechanism's `entityCooccurrence` is **not** merged onto a
		 *     candidate the keyword scan already measured, because that mechanism
		 *     sizes it against its own weight (§13.10) and the keyword scan has
		 *     already answered the same question against the band's. Its lane
		 *     position said the same thing before this existed; now the rule
		 *     says it rather than the ordering implying it.
		 */
		/**
		 * Who is in the world, and when (plan E-2, R4) — the presences on the
		 * session's line and the moment it reads at. The host resolves the
		 * line; this hands both on as the two ports eligibility reads.
		 */
		"core:query/cast-presences@1": reads<typeof C.castPresences>(
			async (
				input: NodeInput<typeof C.castPresences>,
				ctx: CoreQueryCtx
			) => {
				const read = (await ctx.read("cast_presences", {
					sessionId: input?.scope?.sessionId,
					atHour: (input as { atHour?: unknown })?.atHour
				})) as { rows?: unknown[]; at?: unknown; placements?: unknown[] } | null
				const rows = Array.isArray(read?.rows) ? read!.rows : []
				return ok({
					main: rows,
					at: read?.at ?? null,
					placements: Array.isArray(read?.placements) ? read!.placements : [],
					diagnostics: { presences: rows.length }
				})
			},
			{ ports: ["scope", "atHour"] }
		),

		/**
		 * 🚧 One cast member as the session reads it (plan §32 §10): the
		 * member by seat ref or id, its card, follows and profile.
		 */
		"core:query/cast-member@1": reads<typeof C.castMember>(
			async (
				input: NodeInput<typeof C.castMember>,
				ctx: CoreQueryCtx
			) =>
				ok({
					main: await ctx.read("cast_member", {
						sessionId: input?.scope?.sessionId,
						member: input?.member
					})
				}),
			{ ports: ["scope", "member"] }
		),

		/**
		 * The hard gates between the mechanisms and the ranker (plan C2, R2/R4):
		 * exclusions, secrecy, presence. Marks `ineligible`, never deletes —
		 * `select` turns each into an `excluded_ineligible` decision with the
		 * sentence. Pure; see `ranking/eligibility.ts`.
		 */
		"core:task/eligibility@1": reads<typeof C.eligibility>(
			async (input: NodeInput<typeof C.eligibility>) => {
				const { candidates, diagnostics } = applyEligibility({
					candidates: Array.isArray(input?.candidates)
						? input.candidates
						: [],
					exclusions: input?.exclusions,
					speaker:
						typeof input?.speaker === "string" ? input.speaker : null,
					presences: Array.isArray(input?.presences)
						? input.presences
						: [],
					at: input?.at ?? null
				})
				return ok({ main: candidates, candidates, diagnostics })
			},
			{ ports: ["candidates", "exclusions", "speaker", "presences", "at"] }
		),

		/**
		 * A script step (PLAN-pipeline-canvas-and-genre-authoring P3): the step
		 * itself passes its input through unchanged, and the chain on its
		 * `out:main` seam — `core:script:data/transform@1` scripts, QuickJS, JSON
		 * in and out — is what transforms it. No host code runs a script here;
		 * the seam applier does, the same way it does for every other seam, so a
		 * script step is a task by construction: no storage, no network.
		 */
		"core:task/run-script@1": reads<typeof C.runScript>(
			async (input: NodeInput<typeof C.runScript>) =>
				ok({ main: input?.input ?? null }),
			{ ports: ["input"] }
		),
		/**
		 * 🚧 The ruleset handler (PLAN-rulesets §25, §32; BACKBONE §4):
		 * `resolve` reads a session's ruleset into labelled blocks, `apply`
		 * validates the model's deltas, decides each check by its 🚧 check
		 * method (2026-10-22: dice, a pool, cards, a comparison, a spend or a
		 * judgement — each with its outcome block), rolling from `ctx.random`
		 * (declared randomness, so a retake with the run's seed rolls the
		 * same dice), and writes through the state gate, `advance` passes
		 * story time.
		 * The work is `$lib/server/rulesets/resolve`; the database is a
		 * dynamic import on `set-state`'s stated terms (`bindings.state.ts`).
		 *
		 * The session is named by the `scope` in-port (W3-S); a spec that wires
		 * no scope names it by the world's own owner among `owners`
		 * (`session:<id>`), which every shipped spec's owners list carries.
		 * The session's stored ruleset settings and the ruleset's scripts —
		 * 🚧 every phase since 2026-10-22: effects, derived, pre-roll,
		 * post-roll, render — are read and run inside the handler. Its blocks carry `{ priority,
		 * depth }` and every depth's render; `rulesets/budget.ts` degrades
		 * before it drops.
		 */
		"core:task/ruleset-resolve@1": reads<typeof C.rulesetResolve>(
			async (input: NodeInput<typeof C.rulesetResolve>, ctx: TaskCtx) => {
				const { resolveRulesetTurn } = await import("$lib/server/rulesets/resolve")
				const { db } = await import("$lib/server/db")
				const result = await resolveRulesetTurn(
					db,
					{
						scope: input?.scope,
						owners: input?.owners,
						rigour: input?.rigour,
						mode: input?.mode,
						actions: input?.actions,
						deltas: input?.deltas,
						elapsed: input?.elapsed,
						// Whose eyes (2026-10-17): a participant reference or
						// `gm`. Unwired: everyone's view.
						viewer: input?.viewer,
						// 🚧 D3 (2026-10-23): the step's `emits` parameter — what the
						// ruleset's functions raise is emitted after the run's
						// receipt unless it says false. On by default.
						emits: input?.params?.emits,
						// 🚧 D3: the event that woke the step — the functions' `ctx.event`.
						event: input?.event
					},
					{
						random: ctx?.random,
						// The run's seed (A15), handed in on `RenderRun` by
						// `runTurn` / `cardAction`, labels the derive pass and
						// the scripts — a retake with the recorded seed derives
						// the same; each new turn, anew. A run with no seed on
						// it (a direct binding call) falls back to one draw of
						// the node's seeded randomness, else the handler's own
						// per-session constant.
						...(run.seed
							? { seed: `run:${run.seed}` }
							: ctx?.random
								? { seed: `run:${Math.floor(ctx.random() * 2 ** 32).toString(36)}` }
								: {}),
						runId: run.runId,
						// The run's live row, once it opened one: `apply`'s
						// writes anchor there, so a retake or swipe of the
						// turn takes them back with the row.
						turnMessageId: (
							await import("$lib/server/pipelines/runtime/runTurnMessage")
						).turnMessageOf(run.runId)
					}
				)
				if ("halt" in result) return halt(result.halt)
				// 🚧 D7: the schema a reply that carries changes answers against, on its own port.
				return ok({ ...result.ok, replySchema: result.ok.facts?.replySchema ?? null })
			},
			{ ports: ["scope", "owners", "rigour", "mode", "actions", "deltas", "elapsed", "viewer", "event"], params: ["emits"] }
		),
		/**
		 * 🚧 **A ruleset's action** (PLAN-rulesets-functions D6, 2026-10-23):
		 * the inlet of the one generic `core:spec/rules-action` pipeline —
		 * `{ session, actor, function, answer, aimedAt }`, handed on whole
		 * like its siblings. The spec wires it into `ruleset-resolve`'s
		 * `actions` port, which runs the invokable function with its answer
		 * (`rulesets/resolve.ts` `invokeOf`). Bound only once its contract is
		 * declared (lane A2's), so neither half lands without the other.
		 */
		...(getDefinition("core:inlet/rules-action@1")
			? { "core:inlet/rules-action@1": reads<unknown>(async (input: unknown) => ok(input as never), { ports: [] }) }
			: {}),
		"core:task/concat-candidates@1":reads<typeof C.concatCandidates>(
			async (input: NodeInput<typeof C.concatCandidates>) => {
				const orderings: any[][] = (input?.sources ?? []).filter(
					Array.isArray
				)
				const at = new Map<string, any>()
				const candidates: any[] = []
				let duplicates = 0
				/** Candidates a later lane added a measurement to. */
				let enriched = 0
				/**
				 * The sources' band intents (R-7 P5), lifted out ahead of the
				 * items and carried through — first per band wins, like a
				 * candidate. A list that is ONLY an intent (`session-history`'s
				 * `band` port) is a legitimate source here: it declares the
				 * conversation's slice and contributes nothing to rank.
				 */
				const intents: BandIntent[] = []
				const bandsSeen = new Set<string>()
				for (const list of orderings)
					for (const candidate of list) {
						if (isBandIntent(candidate)) {
							if (!bandsSeen.has(candidate.band)) {
								bandsSeen.add(candidate.band)
								intents.push(candidate)
							}
							continue
						}
						const key = `${candidate?.source}:${candidate?.id}`
						const kept = at.get(key)
						if (kept) {
							duplicates++
							let added = false
							for (const [signal, value] of Object.entries(
								candidate?.signals ?? {}
							)) {
								if (signal in kept.signals) continue
								kept.signals[signal] = value
								added = true
							}
							if (added) enriched++
							continue
						}
						// Copied, because the merge above writes into `signals` and
						// the mechanisms hand out objects they may still be holding — the
						// vector mechanism keeps its own `hits` array pointing at these.
						const own = {
							...candidate,
							signals: { ...candidate?.signals }
						}
						at.set(key, own)
						candidates.push(own)
					}

				const published = withBandIntents(intents, candidates)
				return ok({
					main: published,
					candidates: published,
					diagnostics: {
						// Items per source, intents not counted — a source that
						// only declared a band reads as 0 here and is listed
						// under `bands` instead.
						sources: orderings.map(
							(list) => list.filter((c) => !isBandIntent(c)).length
						),
						bands: intents.map((i) => i.band),
						duplicates,
						/**
						 * How many entries more than one mechanism found *and* measured
						 * differently. Zero with one lane wired, zero when the extra
						 * mechanisms are off, and the number that says the mechanisms are
						 * compounding when they are on.
						 */
						enriched,
						kept: candidates.length
					}
				})
			},
			{ ports: ["sources"] }
		),

		/**
		 * The strings the retrieval queries are embedded from.
		 *
		 * Pure. Reuses `formatMessageForQuery` rather than reimplementing it —
		 * two formattings of a query are two different sets of results with no
		 * way to tell which is which, and the speaker fallback reaches through
		 * participants who have left the session.
		 *
		 * ## This node carries the semantic mechanism's one switch
		 *
		 * `searchByMeaning` is `auto | on | off`, **`auto` by default**, on the
		 * chain's *first* node for `mention-spans.maxMentions`' reason: when it
		 * does not search, this cuts no probes, `embed-text` is handed no texts
		 * and makes no model call, and `vector-search` returns before its
		 * candidate reads.
		 *
		 *   · **on** — search, with whatever embedding model is set up.
		 *   · **off** — never search.
		 *   · **auto** — search whenever an embedding model is set up, and
		 *     not when none is (R5). Local or a service billed per request
		 *     alike — the owner, 2026-09-30: *"I never said to skip paid
		 *     services for retrieval, that's what they are there for."* "Set
		 *     up" is this step's own embedding connection — `slot.connection()`
		 *     in every shipped spec, a slot held at the star
		 *     (`isHeldConnectionSlot`: no pick offered, a stored one dropped)
		 *     because the host embeds through the star and a pipeline never
		 *     chooses its embedding connection (owner, 2026-10-05). A Task
		 *     reading data it was handed: the connection resolves before the
		 *     run, as `context-budget`'s does.
		 *
		 * A value that is none of the three — a boolean stored before the switch
		 * had three positions — reads as the default, `auto`. Nothing is carried
		 * across (no back-compat before distribution); it is simply not a value.
		 *
		 * Every branch says what it decided, on `diagnostics`: the setting
		 * (`searchByMeaning`), whether the probes were cut (`searchedByMeaning`)
		 * and why. `explainRetrieval` reads the pair to let the switch's reason
		 * win over the model's when nothing was searched.
		 *
		 * Until 2026-09-29 the switch was `vector-search.maxEntries = 0`, on the
		 * last node, and every turn with an embedding model ready — lorebook or
		 * not — embedded its probes and threw the vectors away: a provider call
		 * per turn in API mode (genre uplift C3). `maxEntries` is the ceiling
		 * now, and ships non-zero.
		 */
		"core:task/query-windows@1": reads<typeof C.queryWindows>(
			async (input: NodeInput<typeof C.queryWindows>) => {
				const decision = searchByMeaningDecision(
					input?.params?.searchByMeaning,
					input?.connection
				)
				const diagnostics = {
					searchByMeaning: decision.setting,
					searchedByMeaning: decision.search,
					reason: decision.reason
				}
				if (!decision.search)
					return ok({
						main: { current: [], recent: [] },
						current: [],
						recent: [],
						diagnostics
					})
				const params = withDefaults({ semantic: input?.params ?? {} })
				const windows = queryWindows(
					input?.messages ?? [],
					input?.cast ?? {},
					params.semantic
				)
				return ok({ main: windows, ...windows, diagnostics })
			},
			{
				ports: ["messages", "cast", "connection"],
				params: ["searchByMeaning", "currentWindow", "recentWindow"]
			}
		),

		/**
		 * The semantic mechanism's nine stages.
		 *
		 * Pure, and separate from `rank-hybrid` on purpose: this ranks *within* the
		 * vector mechanism — fusing its per-query lists, diversifying, capping each
		 * source — and hands one ordered list on. Combining the mechanisms is the
		 * merge's job, and selecting against a budget is the hybrid ranker's.
		 * Doing all three in one node would make each of them unswappable.
		 */
		// ⚠ Parity-harness-only: no shipped spec runs this node; kept for `parity/harness.ts`.
		"core:task/rank-semantic@1": reads<typeof C.rankSemantic>(
			async (input: NodeInput<typeof C.rankSemantic>) => {
				const params = withDefaults({ semantic: input?.params ?? {} })
				const messageOrder = (input?.messages ?? []).map(
					(m: any) => m.id
				)

				// One run of the whole stack **per window**, then concatenated —
				// not one fusion across both. The windows are ranked against each
				// other by construction (now beats a moment ago) and each has
				// already been thresholded against its own top result, so their
				// scores are not on a shared scale. See `mergeWindows`.
				//
				// From the declared `windows` port alone. No flat `{lists,
				// similarity}` fallback: those are two ports `vector-search`
				// publishes and this node does not declare, so no spec can wire
				// them and a branch reading them cannot fire (R-12).
				const windows: Array<{ lists: any[]; similarity?: any }> =
					input?.windows ?? []

				const ranked = windows.map((w) =>
					rankSemantic({
						lists: w.lists ?? [],
						similarity: w.similarity,
						messageOrder,
						params: params.semantic,
						// The same per-tier bonus the keyword mechanism applies, so an
						// author's High tier means one thing across both modes.
						priorityBonus: PRIORITY_SCORE_BONUS
					})
				)

				/**
				 * ⚠ The nine stages' answer is written back onto `presetScore`, and
				 * without this line every one of them was discarded.
				 *
				 * `core:query/vector-search@1` builds its candidates with
				 * `presetScore: hit.score` — the raw cosine — so the merge downstream
				 * has an ordering to fuse. This node then re-scores them: rrf across
				 * the per-message lists, normalise, recency, priority, threshold,
				 * MMR, per-source cap. All of that lands on `score`, and `select`'s
				 * `scoreOf` reads `presetScore` first and never looks at `score`. So
				 * a `vector-search → rank-semantic → rank-hybrid` chain — the shape
				 * the SDK documents as the canonical semantic mechanism — ran the whole
				 * stack and then re-sorted the survivors by raw cosine, silently.
				 *
				 * Written here rather than inside `rankSemantic`: `presetScore` is
				 * `select`'s vocabulary, not the ranking stages', and this binding is
				 * the seam between the two. `score` is left in place beside it so the
				 * receipt still shows what each stage computed.
				 */
				const candidates = mergeWindows(
					ranked.map((r) => r.candidates)
				).map((c) => ({ ...c, presetScore: c.score }))
				return ok({
					main: candidates,
					candidates,
					diagnostics: {
						windows: ranked.map((r) => r.diagnostics),
						kept: candidates.length
					}
				})
			},
			// `currentWindow`/`recentWindow` left this definition (R-12): they
			// size the windows `query-windows@1` cuts and declares; this node
			// receives them cut. `withDefaults` still fills the two for the
			// `SemanticParams` shape `rankSemantic()` takes and never consults.
			{
				ports: ["windows", "messages"],
				params: [
					"rrfK",
					"recencyBoost",
					"recencyDecay",
					"thresholdMin",
					"relativeThreshold",
					"mmrLambda",
					"sourceBudget",
					"defaultSourceBudget"
				]
			}
		),

		/**
		 * Rank and select, with the weights as config.
		 *
		 * Pure: everything it needs arrived on its input ports, which is what
		 * lets a user swap the ranker for a plugin's without the retrieval
		 * changing underneath them (16 §5c).
		 */
		/**
		 * The context budget, from the window the reply is sent against.
		 *
		 * A Task rather than a Query even though it reads configuration: the
		 * executor resolves a `sampling` slot to the config's *values*, so this
		 * is handed what it needs rather than looking anything up (F11).
		 */
		"core:task/context-budget@1": reads<typeof C.contextBudget>(
			async (input: NodeInput<typeof C.contextBudget>, ctx: TaskCtx) => {
				// Already the *values*, not a `sampling_configs` row: the
				// executor resolves a `sampling` slot through the world's config
				// values, so a key missing here is a parameter switched off. The
				// connection is the same resolved pair the request goes out on,
				// carrying the model's own window. ONE computation (R-8):
				// `contextBudgetFrom` is what the dispatch sizes the request
				// with and what the panel shows, so the budget describes the
				// window the prompt is actually sent against.
				const budget = contextBudgetFrom({
					sampling: input?.sampling ?? {},
					connection: input?.connection ?? null,
					safetyMargin: input?.params?.safetyMargin
				})
				// The `blocks` in-port (rulesets W3-S): labelled prompt blocks
				// fitted into what the window leaves, degrade depth before
				// drop (`rulesets/budget.ts`). Absent `blocks`, `fittedBlocks`
				// is absent.
				// 🚧 `reads` (O9): what the same pair reads, by kind — the
				// transcribe step asks it before placement, so it never
				// resolves the reply's pair a second time.
				const reads = readsOfDescriptor(
					input?.connection as
						| { metadata?: Record<string, unknown>; modelId?: unknown }
						| null
						| undefined
				)
				if (input?.blocks == null)
					return ok({ main: budget, available: budget, reads })
				const { fitContextBlocks } = await import("$lib/server/rulesets/budget")
				return ok({
					main: budget,
					available: budget,
					reads,
					// Counted in the run's own tokens, as the window is.
					fittedBlocks: fitContextBlocks(input.blocks, budget.available, ctx?.countTokens ? (t) => ctx.countTokens(t) : undefined)
				})
			},
			{ ports: ["sampling", "connection", "blocks"], params: ["safetyMargin"] }
		),

		"core:task/rank-hybrid@1": reads<typeof C.rankHybrid>(
			async (input: NodeInput<typeof C.rankHybrid>) => {
				/**
				 * The bands, from the sources (R-7 P5). Each retrieval node
				 * put its intent at the head of its list; the concat carried
				 * them; this is where they are read — and stripped, so the
				 * pool `select` ranks is candidates alone. A core band no
				 * source spoke for takes `DEFAULT_GROUPS`; a plugin band
				 * arrives with what it declared and nothing else.
				 */
				const { intents, items: arrived } = splitCandidates<any>(
					input?.candidates ?? []
				)
				// The room rule (`shownElsewhere`): an entry the prompt shows
				// in a slot of its own leaves before ranking, with its reason.
				const { items, marked: shownElsewhere } = markShownElsewhere(
					arrived,
					input?.shownElsewhere
				)
				const { groups, declared } = bandsFromIntents(intents)
				const params = withDefaults({
					...rankingParamsFrom(input?.params),
					groups
				})
				const candidates = normaliseTfidf(toBudgetGroups(items))
				const shareNormalisation = isShareNormalisation(
					input?.params?.shareNormalisation
				)
					? input.params.shareNormalisation
					: "relative"
				const selection = select(candidates, {
					// From the `budget` in-port, which `core:task/context-budget@1`
					// derives from the sampling config's window. There is no longer
					// a typed fallback: an absolute count on the node could not know
					// which model it was about to be sent to — and the flat
					// `input.availableTokens` from before the port carried a payload
					// is gone too (R-12).
					availableTokens: input?.budget?.remaining ?? 0,
					params,
					// Design §7's inversion, behind its declared switch. Passed
					// from here because this is the only runtime `select()` there
					// is — while nothing passed it, the option existed and no run
					// could reach it.
					scoreLedAllocation: scoreLedFrom(input?.params),
					shareNormalisation
				})

				return ok({
					main: selection.included.map((d) => d.candidate),
					candidates: selection.included.map((d) => d.candidate),
					// The `why` trail travels with the result rather than being
					// recomputed for the panel — the numbers that produced each
					// decision exist here and nowhere else once the loop has moved on
					// (16 §7c).
					//
					// Published whole, candidate included, rather than flattened to
					// id/score/reason. The flattened version read better in a receipt
					// and was unusable: Assemble allocates *from* these, and a
					// decision without its candidate has no content to put in a
					// block. The parity run found it as a crash, which was lucky —
					// one field further and it would have rendered empty instead.
					decisions: [...selection.included, ...selection.excluded],
					groups: selection.groups,
					/**
					 * The band table this run resolved, and where each row
					 * came from: `declared` names the bands an intent reached
					 * the ranker for; every other band ran on `DEFAULT_GROUPS`.
					 * A source whose `params` a spec forgot to wire shows
					 * here as a band on defaults — which is what makes "why is
					 * my share not taking" answerable from the receipt. No
					 * shipped spec does: the three lanes, `lorebook-triggers`
					 * (three intents from one node) and the graph all declare.
					 */
					diagnostics: {
						bands: params.groups,
						declared,
						defaulted: Object.keys(params.groups.share).filter(
							(band) => !declared.includes(band)
						),
						shareNormalisation,
						shownElsewhere
					}
				})
			},
			{
				ports: ["candidates", "budget", "shownElsewhere"],
				// The cross-source schema the ranker declares, read through
				// `rankingParamsFrom` / `scoreLedFrom` — every field of it. No
				// `share` / `maxEntries` / `minEntries`: those are the sources'
				// (R-7 P5) and arrive on the `candidates` port as band intents.
				params: [
					"mechanismWeights",
					"signalKeyword",
					"signalNameMatch",
					"signalEntityCooccurrence",
					"signalSemantic",
					"signalEntityVector",
					"signalTfidf",
					"signalLastRefRecency",
					"signalDensity",
					"signalProximity",
					"signalPriorityBonus",
					"shareNormalisation",
					"scoreLedAllocation"
				]
			}
		),

		// Prompt assembly: the template context, the context builders on it, and Assemble.
		...promptBindings(run),

		// Providers: embedding, generation, transcription, images, speech and the tool call.
		...providerBindings(),

		// Summarization, and the tool, form, pick and pair tasks beside it.
		...summarizeBindings(run),

		// ── Graph build ─────────────────────────────────────────────────────

		"core:query/graph-scenes@1": reads<typeof C.graphScenes>(
			async (
				input: NodeInput<typeof C.graphScenes>,
				ctx: CoreQueryCtx
			) => {
				const scenes = await ctx.read("graph_scenes", {
					sessionId: input?.scope?.sessionId
				})
				return ok({ main: scenes, scenes })
			},
			{ ports: ["scope"] }
		),

		...graphSteps(),

		// Outlets: the consumers, the scene queries, sprites and the built-in writes.
		...outletBindings(run),
	}

	return bindings
}

/**
 * The five graph steps, which differ only in which prompt field they read.
 *
 * Written as a loop because the difference between them genuinely is one
 * string: five near-identical bindings would be five places to fix the next
 * time the call shape changes, and the fifth is the one that gets missed.
 */
/**
 * The five graph steps one loop binds. Unlike the three groups above this one
 * is **derived** rather than restated — `GRAPH_STEPS` below is the same array
 * the loop iterates, so there is nothing here to drift.
 */
/**
 * The five graph steps, as `[definitionId, promptField, label]`.
 *
 * Hoisted out of `graphSteps()` so the group is readable as data. Unlike
 * `LORE_LANES` and its two siblings this one is **derived rather than
 * restated** — the loop below binds exactly these ids and `bindingCompat.ts`
 * reads exactly this array, so there is no second list to drift.
 */
const GRAPH_STEPS: Array<[string, string, string]> = [
	["core:oracle/graph-pre-filter@1", "preFilter", "graph:pre-filter"],
	[
		"core:oracle/graph-node-resolution@1",
		"nodeResolution",
		"graph:node-resolution"
	],
	["core:oracle/graph-perspective@1", "perspective", "graph:perspective"],
	[
		"core:oracle/graph-node-description@1",
		"nodeDescription",
		"graph:node-description"
	],
	[
		"core:oracle/graph-state-detection@1",
		"stateDetection",
		"graph:state-detection"
	]
]

function graphSteps(): Bindings {
	const steps = GRAPH_STEPS

	return Object.fromEntries(
		steps.map(([definitionId, field, label]) => [
			definitionId,
			// The five differ in one string, so one input type covers them —
			// and `SharedInput` is what says so in the type rather than in
			// this comment. Each declares `scenes` in and the
			// connection/sampling/prompts slots; the intersection is exactly
			// what the loop below reads, and the `reads` declaration is made
			// per step because each iteration is its own closure.
			reads<
				[
					typeof C.graphPreFilter,
					typeof C.graphNodeResolution,
					typeof C.graphPerspective,
					typeof C.graphNodeDescription,
					typeof C.graphStateDetection
				]
			>(
				async (
					input: SharedInput<
						[
							typeof C.graphPreFilter,
							typeof C.graphNodeResolution,
							typeof C.graphPerspective,
							typeof C.graphNodeDescription,
							typeof C.graphStateDetection
						]
					>,
					ctx: OracleCtx
				) => {
					// Which of the five this is (R-19): the label's own word,
					// past the `graph:` namespace.
					ctx.status?.({
						...STATUS.buildingGraph,
						vars: { step: label.replace(/^graph:/, "") }
					})
					const result: any = await ctx.call({
						systemPrompt: input?.prompts?.[field] ?? "",
						scenes: input?.scenes ?? [],
						...stepSlots(input),
						label
					})
					if (!result?.text)
						return halt(`the model returned nothing for ${label}`)
					return ok({
						main: result.json ?? result.text,
						result: result.json ?? result.text
					})
				},
				{ ports: ["scenes", "prompts", "connection", "sampling"] }
			)
		])
	) as Bindings
}

/** Which type ids core can actually run today, for the diagnostics screen. */
export const boundTypeIds = () => Object.keys(coreBindings())

/**
 * Every core handler that serves more than one node definition, and which types.
 *
 * The runtime shadow of the `SharedInput<[…]>` annotations — see `LORE_LANES`
 * for why the two lists are separate and how they are kept honest.
 *
 * ⚠ **A handler missing from this list is not caught by anything**, and the
 * limit is worth stating rather than discovering. `bindingCompat.ts` checks
 * that every group named here is whole and that its members still have
 * something in common; it cannot see a handler that serves two ids and says
 * so nowhere. That was the state of this file four times over — `loreFor`,
 * `readGraph`, `pickSpeaker` and `graphSteps`, the last of which even said
 * "one input type covers them" in a comment — each typed against one of its
 * types with the others assumed to match. Assumed correctly, as it happens;
 * assumed nonetheless. Adding a multi-type handler means adding it here, and
 * the `SharedInput<[…]>` on its `input` is the reminder.
 */
export const SHARED_CORE_HANDLERS: ReadonlyArray<{
	handler: string
	typeIds: readonly string[]
}> = [
	{ handler: "loreFor", typeIds: LORE_LANES },
	{ handler: "readGraph", typeIds: RELATIONSHIP_NODES },
	{ handler: "pickSpeaker", typeIds: TURN_STRATEGIES },
	{ handler: "graphSteps", typeIds: GRAPH_STEPS.map(([id]) => id) }
]
