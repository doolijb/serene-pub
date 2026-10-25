/**
 * 🚧 `core:task/ruleset-resolve@1` — the one handler every genre calls to
 * read and apply a session's ruleset (PLAN-rulesets §25, §30, §32; BACKBONE
 * §4). Bound in `coreBindings` (`pipelines/runtime/bindings.ts`); this module
 * is what the binding runs.
 *
 *  · `resolve` — before a model call: labelled blocks (`voice`, `sheet`,
 *    `pieces`, `ties`, `custom`) and the facts a step may need. No dice, no
 *    writes.
 *  · `apply` — after the model proposes: the engine validates the deltas,
 *    rolls (from the run's `ctx.random`), fires time triggers, and the
 *    changes it decided are written through the state gate
 *    (`applyChangeSet`, apply mode: the book owner's lore write mode holds a
 *    change to the book for review exactly as `set-state` does). A refused
 *    delta a reviewer could still accept is filed as a proposal
 *    (`state_proposals`, its reason on the payload); one nothing could
 *    accept (an unknown slot) is returned on `rejected` alone.
 *  · `advance` — `apply` with no deltas and an `elapsed`.
 *
 * Three steps (audit C1): `buildEngineInput` reads the session, the run is
 * the engine's (`runResolve` / `runApply`, with the ruleset's scripts at
 * every phase — 🚧 `effects`, `derived`, `pre-roll`, `post-roll`, `render`
 * since 2026-10-22), and `writeOutcome` files what `apply` decided (and
 * `writeDecks`, the `card-draw` decks it drew from).
 *
 * The outcomes and the explain trace are RETURNED, never written to a
 * channel: the genre's spec puts them where it wants (the table channel, the
 * post-history `outcomes` block, §30).
 *
 * 🚧 **Rulesets as functions** (PLAN-rulesets-functions D3–D7, 2026-10-23):
 * the moment runs in ONE rules sandbox (`sandbox.ts`) — the ruleset's
 * function modules at every phase beside its scripts (`functionRun.ts`), an
 * invoked function first when the step is a ruleset action (`invoke`, D6);
 * what they answer is this outlet's to apply or propose (R8) — their deltas
 * through the gate, their zone asks planned and written (`zones.ts`, D5),
 * their events queued for the run's host to emit after the receipt
 * (`emits.ts`). Visibility and `changedBy` (`scopes.ts`, D4) shape what the
 * blocks show and what the gate takes; a JSON reply's changes read through
 * the ruleset (`replies.ts`, D7).
 */

import { bridgesFor, getRuleset, i18nText, RIGOURS, type Rigour, type RulesetDecl, type RulesetTime, type SlotListItem } from "@serene-pub/sdk"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { stateFor } from "$lib/server/state/resolve"
import { coreAnnexIn, coreAnnexKeySql, coreAnnexSetSql, lockSessionAnnex } from "$lib/server/sessions/coreAnnex"
import { minutesPer } from "./common"
import { conventionsOf, earlyPhases, runApply, runApplyAsync, runResolve } from "./engine"
import { conventionsFor, presetOf, settingValues } from "./conventions"
import { ownerRefOf, ownerViews, rulesetSessionOf, sessionOfOwners, storyClockOf, tiesBetween, type OwnerRef } from "./read"
import { roundOf } from "./rounds"
import {
	checkScriptDriver,
	renderBlocks,
	runDerivedScripts,
	runEffectsScripts,
	sandboxScriptRunner,
	type RulesetScriptDeps,
	type ScriptExplain,
	type ScriptFailure
} from "./scripts"
import {
	deciderUses,
	functionUsesOf,
	modulesAt,
	newLedger,
	runCheckFunctions,
	runDecideFunction,
	runDerivedFunctions,
	runEffectsFunctions,
	runEntryFieldFunctions,
	entryFieldUses,
	runInvokeFunction,
	runRenderFunctions,
	sectionsOf,
	type FunctionLedger,
	type FunctionRunDeps
} from "./functionRun"
import { lazyRulesSandbox } from "./sandbox"
import { scopeMembers, visibleTo } from "./scopes"
import { CARRIED, farEndsOf, planZoneOps, writeZones, zonesAfter, zonesFor, zoneTypesOf, type ZonePlan } from "./zones"
import { emitsOn, queueRulesetEmits } from "./emits"
import { replyChangesAsDeltas, replySchemaOf } from "./replies"
import { estimateTokens } from "./engine"
import type {
	DeckState,
	EngineAsk,
	EngineChange,
	EngineInput,
	EngineOutput,
	OwnerView,
	PendingEmit,
	ProposedDelta,
	RejectedDelta,
	RulesetBlocks,
	RulesetMode,
	ZoneOp
} from "./types"

type Db = Parameters<typeof stateFor>[0]

/** The task's in-ports, as a spec wires them. */
export interface RulesetResolveRequest {
	owners?: unknown
	rigour?: unknown
	mode?: unknown
	actions?: unknown
	deltas?: unknown
	elapsed?: unknown
	/**
	 * The session (`scope` port, W3-S): `{ sessionId }` or a session id.
	 * Absent, the session is the world's own owner among `owners`.
	 */
	scope?: unknown
	/**
	 * 🚧 Whose view the blocks are built for (the `viewer` port, 2026-10-17):
	 * `'gm'` — the game master's view, which reads the `gmOnly` repertoires
	 * (the `gm` block) — or a participant reference / owner key, whose
	 * `earshot: 'holder'` pieces join the shared voice. Unwired: everyone's.
	 */
	viewer?: unknown
	/**
	 * The session's ruleset setting values, by setting name — overrides
	 * what the session stored (`sessions.ruleset_settings`) for a direct
	 * caller; a run reads the stored ones.
	 */
	settings?: Readonly<Record<string, string>>
	/**
	 * 🚧 D6 — run one of the ruleset's invokable functions as an action:
	 * `{ function, answer?, aimedAt?, actor? }` (the `core:inlet/rules-action@1`
	 * payload). Also read off `actions` when that is such an object — the
	 * rules-action pipeline wires its inlet there. With `mode` `apply` (Full)
	 * or `propose` (Review), the registration's.
	 */
	invoke?: unknown
	/**
	 * 🚧 The step's `emits` toggle (D3): `false` and what its functions raise
	 * is reported on its facts and never emitted. On by default.
	 */
	emits?: unknown
	/**
	 * 🚧 The event this moment answers, for the functions' `ctx.event` —
	 * `{ id, payload? }`, its id alone, or a routine's cause (`{ event,
	 * payload }`, what an event routine's inlet hands on).
	 */
	event?: unknown
	/**
	 * 🚧 D7 — ask for the reply schema (`facts.replySchema`, a resolve
	 * moment): what a JSON reply that carries changes answers against. Also
	 * read off `actions.replyShape`.
	 */
	replyShape?: unknown
}

export interface RulesetResolveDeps {
	/** The run's seeded randomness (`ctx.random`). Required for a check. */
	random?: () => number
	/**
	 * The run's seed — labels the derive pass's `roll` and each script's
	 * randomness, so a replay derives the same. Absent, `ruleset:<session>`:
	 * every turn derives alike, which only a direct caller should accept.
	 */
	seed?: string
	/** Provenance on every write: `run:<id>`. */
	runId?: string
	/**
	 * The run's live row (placeholder or claimed row), when it opened one
	 * (`pipelines/runtime/runTurnMessage.ts`). `apply`'s world-anchored writes —
	 * the session, its places, its card-less seats — file there rather than
	 * at the session's newest message, so retaking or swiping the turn
	 * retracts them with the row (as the notes' rows, `turnAnchorOf`). A cast
	 * member's change keeps that member's own open anchor (the turn lock).
	 */
	turnMessageId?: number
	/** The ruleset scripts' loader and runner (tests); absent, the seeded rows through QuickJS. */
	scripts?: Pick<RulesetScriptDeps, "loadSource" | "run">
}

/**
 * 🚧 A ruleset's `card-draw` decks live under annex owner `core`'s
 * `rulesetDecks` (a core runtime key, `sessions/coreAnnex.ts`):
 * `{ [methodKey]: DeckState }` — the scene each was shuffled for, its
 * shuffle count and how many cards are drawn.
 */

/** 🚧 The session's decks and open scene, for a ruleset with a `card-draw` method; nothing otherwise. */
async function decksFor(db: Db, sessionId: number, input: EngineInput): Promise<Pick<EngineInput, "decks" | "scene" | "deckSeed">> {
	const draws = Object.values(conventionsOf(input).methods).some((m) => m?.kind === "card-draw")
	if (!draws) return {}
	const [row] = await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1)
	const stored = coreAnnexIn(row?.annex).rulesetDecks
	const decks: Record<string, DeckState> = {}
	if (stored && typeof stored === "object" && !Array.isArray(stored))
		for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
			const d = v as Partial<DeckState> | null
			if (d && Number.isInteger(d.shuffle) && Number.isInteger(d.drawn))
				decks[k] = { scene: typeof d.scene === "number" ? d.scene : null, shuffle: d.shuffle!, drawn: d.drawn! }
		}
	const { openSceneIds } = await import("$lib/server/scenes/boundaryWatcher")
	const open = await openSceneIds(db as never, sessionId)
	return { decks, scene: open.length ? Math.max(...open) : null, deckSeed: `deck:${sessionId}` }
}

/** 🚧 Store the decks a moment drew from, key by key — the `core` annex document's other keys untouched. */
async function writeDecks(db: Db, sessionId: number, decks: Record<string, DeckState> | undefined): Promise<void> {
	if (!decks || !Object.keys(decks).length) return
	await db.transaction(async (tx: Db) => {
		await lockSessionAnnex(tx, sessionId)
		await tx.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("annex")} = ${coreAnnexSetSql(
				"rulesetDecks",
				sql`coalesce(${coreAnnexKeySql("rulesetDecks")}, '{}'::jsonb) || ${JSON.stringify(decks)}::jsonb`
			)}
			where ${schema.sessions.id} = ${sessionId}
		`)
	})
}

/** The task's out-ports. */
export interface RulesetResolveOut {
	blocks: RulesetBlocks
	facts: Record<string, unknown>
	outcomes: unknown[]
	explain: unknown[]
	rejected: RejectedDelta[]
}

export type RulesetResolveResult = { ok: RulesetResolveOut } | { halt: string }

const MODES: readonly RulesetMode[] = ["resolve", "apply", "advance", "propose"]

/** `actions`: one text for everybody, or texts by owner key. */
function actionsOf(raw: unknown, sessionId: number): Record<string, string> {
	if (typeof raw === "string") return raw.trim() ? { "*": raw } : {}
	if (Array.isArray(raw)) {
		const out: Record<string, string> = {}
		for (const a of raw) {
			if (typeof a === "string") out["*"] = `${out["*"] ?? ""} ${a}`.trim()
			else if (a && typeof a === "object") {
				const ref = ownerRefOf((a as { owner?: unknown }).owner, sessionId)
				const text = (a as { text?: unknown; action?: unknown }).text ?? (a as { action?: unknown }).action
				if (typeof text === "string") {
					const key = ref?.key ?? "*"
					out[key] = `${out[key] ?? ""} ${text}`.trim()
				}
			}
		}
		return out
	}
	if (raw && typeof raw === "object") {
		const out: Record<string, string> = {}
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof v !== "string") continue
			const key = k === "*" ? "*" : ownerRefOf(k, sessionId)?.key ?? k
			out[key] = v
		}
		return out
	}
	return {}
}

const asChange = (c: EngineChange) => ({
	owner: c.owner,
	slotId: c.slotId,
	...(c.op ? { op: c.op } : {}),
	...(c.value !== undefined ? { value: c.value } : {}),
	...(c.items ? { items: c.items as SlotListItem[] } : {}),
	...(c.note ? { note: c.note } : {})
})

/**
 * 🚧 The engine's expiry switches from the reckoning's duty modes (lane 2; read
 * off the session's reckoning routine since lane 6):
 * `timed-expiry` Off stops timed pieces counting down, Review files their
 * ending for review; `conditions` Off leaves the conditions repertoire alone.
 * Undefined when the genre declares neither, so its sessions run as before.
 */
export function expiryOf(modes: Readonly<Record<string, string>>): EngineInput["expiry"] | undefined {
	const timed = modes["timed-expiry"]
	const conditions = modes["conditions"]
	if (timed === undefined && conditions === undefined) return undefined
	return {
		...(timed !== undefined ? { pieces: timed !== "off", review: timed === "review" } : {}),
		...(conditions !== undefined ? { conditions: conditions !== "off" } : {})
	}
}

/** The session a `scope` names: `{ sessionId }`, `{ id }` or a bare id. */
function sessionOfScope(raw: unknown): number | null {
	const id =
		typeof raw === "number" || typeof raw === "string"
			? Number(raw)
			: raw && typeof raw === "object"
				? Number((raw as { sessionId?: unknown; id?: unknown }).sessionId ?? (raw as { id?: unknown }).id)
				: NaN
	return Number.isInteger(id) && id > 0 ? id : null
}

/** The spans an `elapsed` port may name. */
const SPANS = { minutes: "minute", rounds: "round", hours: "hour", days: "day" } as const

/**
 * The `elapsed` port, in the ruleset's own time unit (`conventions.time`).
 *
 * A bare number is already in that unit (a Vis Itineris round, a Story
 * minute). A span — `{ minutes }`, `{ rounds }`, `{ hours }` or `{ days }`
 * (the Crawler's Rest sends `{ minutes: 480 }`) — is converted through the
 * ruleset's conventions: a round is `roundSeconds` (6 when unsaid). A span a
 * clock-less unit (`scene`) cannot count passes no time, and says why
 * (`notCounted`); anything else, or nothing positive, is no time at all.
 */
export function elapsedInUnits(raw: unknown, time: RulesetTime | undefined): { units: number; notCounted?: string } {
	const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0
	if (positive(raw)) return { units: raw }
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { units: 0 }
	const span = raw as Record<string, unknown>
	const named = (Object.keys(SPANS) as (keyof typeof SPANS)[]).filter((k) => span[k] !== undefined)
	if (named.length !== 1 || !positive(span[named[0]!])) return { units: 0 }
	const key = named[0]!
	const amount = span[key] as number
	const unit = time?.unit
	if (SPANS[key] === unit) return { units: amount }
	const minutes = amount * minutesPer(SPANS[key], time?.roundSeconds)!
	const perUnit = minutesPer(unit, time?.roundSeconds)
	if (perUnit === null)
		return { units: 0, notCounted: `${amount} ${key} passed, but this ruleset keeps time in ${unit ?? "no unit"}s, which no clock counts` }
	return { units: minutes / perUnit }
}

/** What `buildEngineInput` read: the engine's input and what the facts report beside it. */
interface Built {
	sessionId: number
	mode: RulesetMode
	input: EngineInput
	settings: Record<string, string>
	unknownOwners: unknown[]
	notCounted?: string
	/** 🚧 D6: the invoked function, its answer, who acts (an owner key) and at whom. */
	invoke?: { function: string; answer: unknown; actor: string | null; aimedAt: string | null }
	/** 🚧 D3: the step's `emits` toggle. */
	emits: boolean
	event?: { id: string; payload?: unknown } | null
	/** 🚧 D7: a reply's entry changes, as asks of the owners' carried zones (a ruleset in sections). */
	zoneAsks: ZoneOp[]
	/** 🚧 D7: the reply's changes that named nothing the ruleset has. */
	refusedChanges: { change: unknown; why: string }[]
	replyShape: boolean
}

/** 🚧 D6: the invoke a request carries — on `invoke`, or the rules-action inlet's payload on `actions`. */
function invokeOf(req: RulesetResolveRequest): { function: string; answer: unknown; actor: unknown; aimedAt: unknown } | null {
	const raw = req.invoke ?? (req.actions && typeof req.actions === "object" && !Array.isArray(req.actions) && typeof (req.actions as { function?: unknown }).function === "string" ? req.actions : undefined)
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
	const o = raw as Record<string, unknown>
	const fn = typeof o.function === "string" ? o.function.trim() : ""
	return fn ? { function: fn, answer: o.answer ?? null, actor: o.actor ?? null, aimedAt: o.aimedAt ?? null } : null
}

/** Whether a ruleset keeps zones the store holds: one declaring zone types of its own, or one in sections (its carried entries). */
const keepsStoredZones = (ruleset: RulesetDecl): boolean =>
	zoneTypesOf(ruleset).some((z) => z.id !== CARRIED) || (ruleset as { entryTypes?: unknown }).entryTypes !== undefined

/**
 * Step 1 — read the session into the engine's input: its ruleset, rigour
 * and settings, the owners the turn names, the ties between them (resolve
 * only), the story clock and the round (apply and advance only). A halt
 * sentence, or a parked result for a ruleset that is not installed.
 */
async function buildEngineInput(
	db: Db,
	req: RulesetResolveRequest,
	deps: RulesetResolveDeps
): Promise<{ halt: string } | { parked: RulesetResolveOut } | { built: Built }> {
	const sessionId = sessionOfScope(req.scope) ?? sessionOfOwners(req.owners)
	if (sessionId === null)
		return {
			halt: "name the session among this node's owners — 'session:<id>' or { kind: 'session', id } (the world's own owner) — so the ruleset handler knows whose ruleset to read"
		}
	const session = await rulesetSessionOf(db, sessionId)
	if (!session) return { halt: `there is no session ${sessionId} to resolve a ruleset for` }
	const mode: RulesetMode = MODES.includes(req.mode as RulesetMode) ? (req.mode as RulesetMode) : "resolve"
	const rigour: Rigour = RIGOURS.includes(req.rigour as Rigour)
		? (req.rigour as Rigour)
		: RIGOURS.includes(session.rigour as Rigour)
			? (session.rigour as Rigour)
			: "prose"
	const ruleset: RulesetDecl | undefined = getRuleset(session.primaryRuleset)
	if (!ruleset)
		// A ruleset that is not installed parks: nothing renders, nothing is
		// refused, and the step says why.
		return {
			parked: {
				blocks: {},
				facts: {
					ruleset: session.primaryRuleset,
					rigour,
					mode,
					parked: `${session.primaryRuleset} is not installed, so nothing of it is read this turn`
				},
				outcomes: [],
				explain: [],
				rejected: []
			}
		}

	const refs: OwnerRef[] = []
	const unknownOwners: unknown[] = []
	const invoked = invokeOf(req)
	const ownersAsked = Array.isArray(req.owners) ? [...req.owners] : req.owners === undefined ? [] : [req.owners]
	// 🚧 D6: who invokes is among the owners the moment reads.
	if (invoked?.actor != null) ownersAsked.push(invoked.actor)
	for (const raw of ownersAsked) {
		const ref = ownerRefOf(raw, sessionId)
		if (!ref) unknownOwners.push(raw)
		else if (ref.owner.kind === "session" && ref.owner.id !== sessionId)
			return { halt: `owners name two sessions (${sessionId} and ${ref.owner.id}); a resolution reads one` }
		else if (!refs.some((r) => r.key === ref.key)) refs.push(ref)
	}
	const state = await stateFor(db, sessionId, { ...(deps.seed ? { seed: deps.seed } : {}) })
	const owners = await ownerViews(db, state, ruleset, refs)
	for (const ref of refs) if (!owners.some((o) => o.key === ref.key)) unknownOwners.push(ref.key)

	const writes = mode !== "resolve"
	const asked: Record<string, unknown>[] =
		(mode === "apply" || mode === "propose") && Array.isArray(req.deltas) ? (req.deltas.filter((d) => d && typeof d === "object") as Record<string, unknown>[]) : []
	// 🚧 D7: a JSON reply's changes name an attribute or an entry type — read through the ruleset.
	const isReplyChange = (d: Record<string, unknown>) => (typeof d.attribute === "string" && d.attribute !== "") || (typeof d.entryType === "string" && d.entryType !== "")
	// An entry type an owner keeps in a list slot takes its pieces there; any other, its carried zone.
	const listed = new Set(owners.flatMap((o) => o.repertoires.map((r) => r.repertoire.id)))
	const reply = replyChangesAsDeltas(ruleset, asked.filter(isReplyChange), listed)
	const deltas: ProposedDelta[] = [...(asked.filter((d) => !isReplyChange(d)) as unknown as ProposedDelta[]), ...reply.deltas]
	const settings = settingValues(ruleset, { values: req.settings ?? session.rulesetSettings[ruleset.id] ?? {} })
	const conventions = conventionsFor(ruleset, settings)
	const elapsed = elapsedInUnits(req.elapsed, conventions.time)
	const viewer = typeof req.viewer === "string" && req.viewer.trim() ? req.viewer.trim() : null
	// 🚧 *End what runs out* and *Track conditions* — the duties of the
	// session's reckoning routine (lane 6, PLAN-layering R37), at its mode —
	// decide whether timed pieces count down and leave. A session with no
	// reckoning routine keeps both running.
	const expiry = writes
		? expiryOf(
				(await (await import("$lib/server/pipelines/routines/sessionRoutines")).sessionDutiesOf(
					db as never,
					sessionId,
					(await import("@serene-pub/contracts")).reckoningDuties.id
				)) ?? {}
			)
		: undefined
	const input: EngineInput = {
		ruleset,
		rigour,
		owners,
		actions: invoked && req.invoke === undefined ? {} : actionsOf(req.actions, sessionId),
		deltas,
		elapsed: elapsed.units,
		ties: writes ? [] : await tiesBetween(db, session, owners),
		clock: writes ? await storyClockOf(db, session) : null,
		turn: writes ? await roundOf(db, sessionId) : 0,
		random: deps.random,
		conventions,
		settings,
		// Phase 4: every bridge registered onto this ruleset (`registerBridge`
		// where its field is declared), applied additively after its own.
		bridges: bridgesFor(ruleset.id),
		...(expiry ? { expiry } : {}),
		...(viewer ? { viewer: viewer === "gm" ? "gm" : (ownerRefOf(viewer, sessionId)?.key ?? viewer) } : {})
	}
	// 🚧 A `card-draw` method draws from the session's deck for the open scene (2026-10-22).
	if (writes) Object.assign(input, await decksFor(db, sessionId, input))
	// 🚧 D5: what the owners' zones hold, for a ruleset that keeps zones in the store.
	if (keepsStoredZones(ruleset)) input.zones = await zonesFor(db, sessionId, ruleset.id, owners)
	const keyOf = (raw: unknown): string | null => (raw == null ? null : (ownerRefOf(raw, sessionId)?.key ?? (typeof raw === "string" ? raw : null)))
	const event = eventOf(req.event)
	return {
		built: {
			sessionId,
			mode,
			input,
			settings,
			unknownOwners,
			...(elapsed.notCounted ? { notCounted: elapsed.notCounted } : {}),
			...(invoked ? { invoke: { function: invoked.function, answer: invoked.answer, actor: keyOf(invoked.actor), aimedAt: keyOf(invoked.aimedAt) } } : {}),
			emits: emitsOn(req.emits),
			event,
			zoneAsks: reply.zoneOps,
			refusedChanges: reply.refused,
			replyShape:
				req.replyShape === true || (!!req.actions && typeof req.actions === "object" && (req.actions as { replyShape?: unknown }).replyShape === true)
		}
	}
}

/** 🚧 The session's story-lane turn tally, as a ruleset script reads it (`session.turn` · `round` · `lastSpeaker` · `turnsBy`). */
async function sessionTurnFacts(db: Db, sessionId: number): Promise<Record<string, unknown> | undefined> {
	try {
		const [row] = await db
			.select({ annex: schema.sessions.annex })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row) return undefined
		const { publishedTurns } = await import("$lib/server/pipelines/routines/turnTally")
		return publishedTurns(coreAnnexIn(row.annex))
	} catch {
		return undefined
	}
}

/** What a moment ran to, beyond the engine's output: the functions' ledger and the zone asks planned. */
interface Moment {
	out: EngineOutput
	ledger: FunctionLedger
	zones: ZonePlan | null
	/** 🚧 ★7: the tie far ends the moment's asks reached that it does not read (named in its lines). */
	farEnds?: OwnerView[]
	/** D6: why an invoked function could not run — the step halts on it. */
	invokeRefused?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** An owner's values after phases 1–2 (and the derived scripts), as a function's bindings read them. */
const valuesOf = (r: { values: Map<string, unknown> } | undefined): Record<string, never> =>
	(r ? Object.fromEntries(r.values) : {}) as Record<string, never>

/**
 * 🚧 D4: what this view may not see — each owner's attributes whose
 * visibility is the game master's or a scope the viewer is not in (a
 * holder's own is earshot's, read as before). The view is the request's
 * `viewer`, else the one acting member of the cast, else the shared one.
 */
async function hiddenFor(input: EngineInput, members: (scope: string, subject: string | null) => Promise<string[]>): Promise<EngineInput["hidden"]> {
	const cast = input.owners.filter((o) => o.key !== "world" && !o.key.startsWith("location:"))
	const viewer = input.viewer ?? (cast.length === 1 ? cast[0]!.key : null)
	const out: Record<string, Set<string>> = {}
	for (const owner of input.owners)
		for (const stat of owner.stats) {
			const v = stat.visibility
			if (!v || v === "everyone" || v === "holder") continue
			if (!(await visibleTo(v, viewer, owner.key, { members }))) (out[owner.key] ??= new Set()).add(stat.slotId)
		}
	return Object.keys(out).length ? out : undefined
}

/** A block's text replaced, its depths with it — as a render script's replacement is laid. */
function withText(b: NonNullable<RulesetBlocks["voice"]>, text: string): NonNullable<RulesetBlocks["voice"]> {
	return { ...b, text, tokens: estimateTokens(text), depths: { [b.depth]: text } }
}

/** 🚧 D5: the stored zones as the model reads them — what this view may see of each, and how many it may not. */
async function zoneLines(input: EngineInput, members: (scope: string, subject: string | null) => Promise<string[]>): Promise<string[]> {
	if (!input.zones) return []
	const types = zoneTypesOf(input.ruleset)
	const cast = input.owners.filter((o) => o.key !== "world" && !o.key.startsWith("location:"))
	const viewer = input.viewer ?? (cast.length === 1 ? cast[0]!.key : null)
	const lines: string[] = []
	// 🚧 T5: a held tie side reads as the far end and the fields it shares — words on, the number off unless its field says.
	const { tieTypesOf, tieWordsFor } = await import("./ties")
	const ties = tieTypesOf(input.ruleset)
	for (const owner of [...input.owners].sort((a, b) => (a.key < b.key ? -1 : 1)))
		for (const z of types) {
			// The carried entries a list slot keeps are the pieces block's already.
			const listed = new Set(owner.repertoires.map((r) => r.repertoire.id))
			const held = (input.zones[owner.key]?.[z.id] ?? []).filter((e) => z.id !== CARRIED || !listed.has(e.entryType))
			if (!held.length) continue
			const seen: string[] = []
			let unseen = 0
			for (const e of held)
				if (await visibleTo(z.visibility, viewer, owner.key, { exposed: e.exposed === true, members })) {
					const tie = ties.get(e.entryType)
					seen.push(tie ? (tieWordsFor(tie, e, e.name) ?? e.name) : e.count && e.count > 1 ? `${e.name} ×${e.count}` : e.name)
				} else unseen++
			const name = (i18nText(z.name) ?? z.id).toLowerCase()
			const parts = [...seen, ...(unseen ? [`${unseen} ${seen.length ? "more " : ""}unseen`] : [])]
			lines.push(`${owner.name}'s ${name}: ${parts.join(", ")}`)
		}
	return lines
}

/** Two check answers merged: the scripts' first, the functions' after them (later wins; pools add, lists join). */
function mergeAnswers(a: Record<string, unknown> | null, b: Record<string, unknown> | null): Record<string, unknown> | null {
	if (!a) return b
	if (!b) return a
	const out: Record<string, unknown> = { ...a }
	for (const [k, v] of Object.entries(b)) {
		if ((k === "pool" || k === "shift") && typeof v === "number") out[k] = ((out[k] as number) ?? 0) + v
		else if ((k === "modifies" || k === "riders") && Array.isArray(v)) out[k] = [...((out[k] as unknown[]) ?? []), ...v]
		else if (k === "options" && isRecord(v)) out[k] = { ...((out[k] as object) ?? {}), ...v }
		else out[k] = v
	}
	return out
}

/**
 * Step 2 — run the moment, every phase in its place (🚧 2026-10-22, R4;
 * 🚧 functions D3, 2026-10-23), in ONE rules sandbox opened on first use:
 * an invoked function first (D6), then phases 1–2, the ruleset's `effects`
 * (its scripts, then its function modules), its `derived`, then the engine
 * (`runResolve`, or the apply moment — its checks asking the `pre-roll` /
 * `before` and `post-roll` / `after` handlers, and a deciding module its
 * `decide` — through `runApplyAsync`), and last `render`. What the
 * functions answered is the outlet's (R8): their deltas join the engine's
 * (a check handler's in one more pass), their zone asks are planned, their
 * lines and outcome words told, their events collected for the end. A
 * failure is never fatal.
 */
async function run(db: Db, built: Built, deps: RulesetResolveDeps, seed: string): Promise<Moment> {
	const { input, mode, settings } = built
	// 🚧 R51, R52: the scripts read the session's turn facts (`session.turn`, …).
	const session = await sessionTurnFacts(db, built.sessionId)
	const sb = lazyRulesSandbox()
	const ledger = newLedger()
	try {
		const scriptDeps: RulesetScriptDeps = { ...deps.scripts, run: deps.scripts?.run ?? sandboxScriptRunner(sb), seed, settings, session }
		const fdeps: FunctionRunDeps = { sandbox: sb, seed, ...(session ? { session } : {}), settings, event: built.event ?? null }
		const members = scopeMembers(input, fdeps, ledger)
		fdeps.members = members
		const writes = mode !== "resolve"
		const hidden = await hiddenFor(input, members)
		if (hidden) input.hidden = hidden
		if (built.invoke) {
			const actor = built.invoke.actor ? (input.owners.find((o) => o.key === built.invoke!.actor) ?? null) : null
			const r = await runInvokeFunction(input, built.invoke.function, { actor, answer: built.invoke.answer, aimedAt: built.invoke.aimedAt }, fdeps, ledger)
			// D6: an action whose function cannot run stops here — the step halts on why.
			if (!r.ok) return { out: { blocks: {}, facts: {}, outcomes: [], explain: [], rejected: [], changes: [], reviewable: [] }, ledger, zones: null, invokeRefused: r.why }
		}
		// D7: what a reply asked of the owners' zones joins the functions' asks.
		ledger.zoneOps.push(...built.zoneAsks)
		const effects = await runEffectsScripts(db, input, scriptDeps)
		if (Object.keys(effects).length) input.effects = effects
		const early = earlyPhases(input)
		await runEffectsFunctions(input, fdeps, ledger, (o) => valuesOf(early.get(o.key)))
		input.scripted = await runDerivedScripts(db, input, scriptDeps, early)
		const worked = await runDerivedFunctions(input, fdeps, ledger, (o) => ({ ...valuesOf(early.get(o.key)), ...((input.scripted?.[o.key]?.values ?? {}) as Record<string, never>) }))
		if (Object.keys(worked).length) {
			const scripted = { ...(input.scripted ?? {}) }
			for (const [k, values] of Object.entries(worked)) {
				const had = scripted[k] ?? { values: {}, modifies: [], explain: [], failed: [] }
				scripted[k] = { ...had, values: { ...had.values, ...values } }
			}
			input.scripted = scripted
		}
		// 🚧 An entry's field worked out (ties T3): in a reading, on the zones as stored; a write moment works it out after its asks.
		const fieldUses = entryFieldUses(input.ruleset).length > 0
		if (!writes && fieldUses) await runEntryFieldFunctions(input, fdeps, ledger)
		// The functions' deltas so far (effects, derived, an invoke): the outlet's to apply (R8).
		const asked = ledger.deltas.splice(0)
		if (writes && asked.length) input.deltas = [...input.deltas, ...asked]
		const explain: ScriptExplain[] = []
		const failed: ScriptFailure[] = []
		let out: EngineOutput
		if (mode === "resolve") out = runResolve(input, seed, early)
		else {
			const driver = await checkScriptDriver(db, input, scriptDeps)
			const deciding = deciderUses(input.ruleset).length > 0
			const fnPre = modulesAt(input.ruleset, "before").length > 0
			const fnPost = modulesAt(input.ruleset, "after").length > 0 || deciding
			const checkAsks = { preRoll: driver.checkAsks.preRoll || fnPre, postRoll: driver.checkAsks.postRoll || fnPost }
			let n = 0
			const answer = async (ask: EngineAsk): Promise<unknown> => {
				const legacy = (await driver.answer(ask)) as Record<string, unknown> | null
				const owner = input.owners.find((o) => o.key === ask.owner) ?? null
				const check = JSON.parse(JSON.stringify(ask.check)) as Record<string, unknown>
				// 🚧 Whom it is aimed at, by key where the moment reads them (a check may name them as the story does — ties T3).
				if (typeof check.aimedAt === "string") {
					const aimed = input.owners.find((o) => o.key === check.aimedAt) ?? input.owners.find((o) => o.name.toLowerCase() === String(check.aimedAt).trim().toLowerCase())
					if (aimed) check.aimedAt = aimed.key
				}
				const k = ++n
				let fn = await runCheckFunctions(input, ask.phase === "pre-roll" ? "before" : "after", owner, check, ask.values, k, fdeps, ledger)
				if (ask.phase === "post-roll" && deciding)
					fn = mergeAnswers(fn, await runDecideFunction(input, (ask.check.method?.key as string | null) ?? null, owner, check, ask.values, k, fdeps, ledger))
				return mergeAnswers(legacy, fn)
			}
			out = checkAsks.preRoll || checkAsks.postRoll ? await runApplyAsync({ ...input, checkAsks }, answer, seed, early) : runApply(input, seed, early)
			explain.push(...driver.explain)
			failed.push(...driver.failed)
			// What the check handlers asked: one more pass, nothing timed counting twice.
			const late = ledger.deltas.splice(0)
			if (late.length) {
				const more = runApply({ ...input, deltas: late, elapsed: 0, expiry: { pieces: false, conditions: false }, checkAsks: undefined }, `${seed}:functions`)
				out.changes.push(...more.changes)
				out.outcomes.push(...more.outcomes)
				out.explain.push(...more.explain.filter((e) => !out.explain.some((x) => x.target === e.target && x.text === e.text)))
				out.rejected.push(...more.rejected)
				out.reviewable.push(...more.reviewable)
			}
		}
		// D5: the zone asks, planned against the zone types (written by the outlet).
		// 🚧 ★7: a tie's far end the moment does not read is resolved by its key, its zones read beside the moment's.
		let farEnds: OwnerView[] = []
		if (writes && ledger.zoneOps.length) {
			const far = await farEndsOf(db, built.sessionId, input, ledger.zoneOps)
			if (far.owners.length) {
				farEnds = far.owners
				input.zones = { ...(input.zones ?? {}), ...far.zones }
			}
		}
		let zones = ledger.zoneOps.length ? planZoneOps(input, ledger.zoneOps, { farEnds }) : null
		// 🚧 An entry's field worked out on what the asks left (ties T3: Romance's standing after a confession moved affection).
		if (writes && fieldUses) {
			const asked = ledger.zoneOps.length
			await runEntryFieldFunctions({ ...input, owners: [...input.owners, ...farEnds], zones: zonesAfter(input.zones, zones) }, fdeps, ledger)
			if (ledger.zoneOps.length > asked) zones = planZoneOps(input, ledger.zoneOps, { farEnds })
		}
		if (zones && writes) out.changes.push(...zones.changes)
		const rendered = await renderBlocks(db, input, out.blocks, out.outcomes, scriptDeps)
		out.blocks = rendered.blocks
		explain.push(...rendered.explain)
		failed.push(...rendered.failed)
		// The functions' `render`, on the blocks as the scripts left them.
		if (modulesAt(input.ruleset, "render").length) {
			const texts = Object.fromEntries(Object.entries(out.blocks).filter(([k, b]) => k !== "holders" && b && typeof (b as { text?: unknown }).text === "string").map(([k, b]) => [k, (b as { text: string }).text]))
			const now = await runRenderFunctions(input, texts, out.outcomes.map((o) => o.text), fdeps, ledger)
			for (const [k, t] of Object.entries(now)) {
				const b = (out.blocks as Record<string, NonNullable<RulesetBlocks["voice"]>>)[k]
				if (b && b.text !== t) (out.blocks as Record<string, unknown>)[k] = withText(b, t)
			}
		}
		// What the functions told: outcome lines in a write moment, the model's reading before a reply.
		const told = [
			...ledger.lines.map((l) => ({ owner: l.owner, text: l.text })),
			...ledger.outcomes.map((o) => ({ owner: o.owner, text: o.owner ? `${input.owners.find((x) => x.key === o.owner)?.name ?? o.owner}: ${o.label}` : o.label })),
			...(zones && writes ? zones.lines : [])
		]
		if (writes) {
			for (const t of told) out.outcomes.push({ owner: t.owner ?? "world", kind: "effect", text: t.text })
			if (told.length) {
				const text = out.outcomes.map((o) => `- ${o.text}`).join("\n")
				out.blocks.outcomes = { text, tokens: estimateTokens(text), priority: 90, depth: "full", depths: { full: text } }
			}
		} else {
			const zoneText = await zoneLines(input, members)
			if (zoneText.length) {
				const text = [out.blocks.pieces?.text, ...zoneText].filter(Boolean).join("\n")
				out.blocks.pieces = { text, tokens: estimateTokens(text), priority: out.blocks.pieces?.priority ?? 60, depth: out.blocks.pieces?.depth ?? "full", depths: { [out.blocks.pieces?.depth ?? "full"]: text } }
			}
			if (told.length && out.blocks.voice) out.blocks.voice = withText(out.blocks.voice, [out.blocks.voice.text, ...told.map((t) => t.text)].join("\n"))
			else if (told.length) {
				const text = told.map((t) => t.text).join("\n")
				out.blocks.voice = { text, tokens: estimateTokens(text), priority: 100, depth: "full", depths: { full: text } }
			}
		}
		for (const e of explain) out.explain.push({ target: `${e.owner ?? "session"}.script`, total: 0, terms: [], text: `${e.seedKey}: ${e.text}` })
		for (const e of ledger.explain) out.explain.push({ target: `${e.owner ?? "session"}.function`, total: 0, terms: [], text: `${e.seedKey}: ${e.text}` })
		if (failed.length) out.facts.scriptsFailed = [...((out.facts.scriptsFailed as unknown[] | undefined) ?? []), ...failed]
		out.facts.mode = mode
		for (const r of built.refusedChanges)
			out.rejected.push({ delta: r.change as ProposedDelta, reason: "unknown-change", why: r.why })
		// D7: the reply schema, when the step asked for it.
		if (built.replyShape) out.facts.replySchema = replySchemaOf(input.ruleset, input.owners)
		if (built.unknownOwners.length) out.facts.unknownOwners = built.unknownOwners
		if (built.notCounted) out.facts.elapsedNotCounted = built.notCounted
		if (Object.keys(settings).length) {
			out.facts.settings = settings
			const preset = presetOf(input.ruleset, settings)
			if (preset) out.facts.preset = preset
		}
		// 🚧 What the functions did (D3): on the facts whenever any ran, failed or asked.
		// A ruleset that lists its functions (sections) is told which of them did not resolve.
		const unresolved =
			(input.ruleset as { functions?: unknown }).functions !== undefined
				? functionUsesOf(input.ruleset)
						.filter((u) => u.findings.length)
						.map((u) => ({ key: u.key, findings: u.findings }))
				: []
		if (ledger.ran.length || ledger.failed.length || ledger.asks.length || ledger.emits.length || zones || unresolved.length) {
			out.facts.functions = {
				ran: ledger.ran,
				...(unresolved.length ? { unresolved } : {}),
				...(ledger.failed.length ? { failed: ledger.failed } : {}),
				...(ledger.lines.length ? { lines: ledger.lines } : {}),
				...(ledger.outcomes.length ? { outcomes: ledger.outcomes } : {}),
				...(ledger.emits.length ? { emits: ledger.emits } : {}),
				...(ledger.asks.length ? { asks: ledger.asks } : {}),
				...(!writes && asked.length ? { heldDeltas: asked } : {}),
				...(zones ? { zones: { refused: zones.refused.map((r) => ({ op: r.op.op, entry: r.op.entry, why: r.why })) } } : {}),
				sandbox: sb.spent()
			}
		}
		return { out, ledger, zones, ...(farEnds.length ? { farEnds } : {}) }
	} finally {
		await sb.close()
	}
}

/**
 * Step 3 — file what `apply` decided through the state gate: the changes in
 * one gate pass per anchor, the reviewable refusals as proposals. A change
 * the gate refuses is a rejected delta with the gate's own sentence.
 */
async function writeOutcome(db: Db, sessionId: number, out: EngineOutput, deps: RulesetResolveDeps, mode: RulesetMode = "apply"): Promise<void> {
	if (!out.changes.length && !out.reviewable.length) return
	const { applyChangeSet, proposeChange, StateRefusal } = await import("$lib/server/state/write")
	const ctx = { sessionId, updatedBy: `run:${deps.runId ?? "unknown"}` }
	// The run's live row, checked to be this session's (`turnAnchorOf`):
	// world-anchored changes file there, the run's own row open to it for
	// the rest of its turn (`WriteContext.ownAnchor`).
	const turnRow =
		deps.turnMessageId != null
			? await (await import("$lib/server/lorebooks/ownBook")).turnAnchorOf(db, sessionId, deps.turnMessageId)
			: null
	const anchored = turnRow != null ? { ...ctx, messageId: turnRow, ownAnchor: true } : ctx
	const ctxFor = (c: EngineChange) => (c.owner.kind === "session_cast" ? ctx : anchored)
	if (out.changes.length) {
		const applied: unknown[] = []
		const proposed: unknown[] = []
		// One gate pass per anchor: a cast member's changes keep their own.
		// 🚧 And per gate mode (lane 2): `propose` files every change for
		// review, and a change a task on Review made (`held`) is filed so in
		// any mode.
		const held = (c: EngineChange) => mode === "propose" || c.held === true
		const sets: Array<{ at: typeof anchored; gate: "apply" | "propose"; set: EngineChange[] }> = []
		for (const gate of ["apply", "propose"] as const) {
			const ofGate = out.changes.filter((c) => (gate === "propose") === held(c))
			sets.push({ at: anchored, gate, set: ofGate.filter((c) => ctxFor(c) === anchored) })
			if (anchored !== ctx) sets.push({ at: ctx, gate, set: ofGate.filter((c) => ctxFor(c) === ctx) })
		}
		for (const { at, gate: gateMode, set } of sets) {
			if (!set.length) continue
			const gate = await applyChangeSet(db, at, set.map(asChange), { mode: gateMode, ...(deps.seed ? { seed: deps.seed } : {}) })
			applied.push(...gate.applied)
			proposed.push(...gate.proposed)
			// A change the gate refused is a rejected delta too — with the
			// gate's own sentence, never silently dropped.
			for (const r of gate.refused)
				out.rejected.push({ delta: { ...(r.change as object), op: r.change.op ?? "set" } as ProposedDelta, reason: "refused-by-gate", why: r.reason })
		}
		out.facts.applied = applied
		out.facts.proposed = proposed
	}
	for (const { change, rejected } of out.reviewable) {
		try {
			rejected.proposalId = await proposeChange(db, ctxFor(change), {
				...asChange(change),
				note: `${rejected.reason}: ${rejected.why}`,
				// The reason rides the payload, so the review card can say it.
				refused: { reason: rejected.reason, why: rejected.why, asked: rejected.delta }
			} as Parameters<typeof proposeChange>[2])
		} catch (e) {
			if (!(e instanceof StateRefusal)) throw e
			rejected.proposalId = null
			rejected.why = `${rejected.why} (not filed for review: ${e.message})`
		}
	}
}

/**
 * 🚧 The event a step answers, as the functions read it (`ctx.event`, D3):
 * `{ id, payload? }` from an event's own shape, its id alone, or a routine's
 * cause (`{ event, payload }`); anything else is no event.
 */
export function eventOf(raw: unknown): { id: string; payload?: unknown } | null {
	if (typeof raw === "string") return raw ? { id: raw } : null
	if (!raw || typeof raw !== "object") return null
	const r = raw as { id?: unknown; event?: unknown; payload?: unknown }
	const id = typeof r.id === "string" ? r.id : typeof r.event === "string" ? r.event : null
	if (!id) return null
	return { id, ...(r.payload !== undefined ? { payload: r.payload } : {}) }
}

export async function resolveRulesetTurn(
	db: Db,
	req: RulesetResolveRequest,
	deps: RulesetResolveDeps = {}
): Promise<RulesetResolveResult> {
	const read = await buildEngineInput(db, req, deps)
	if ("halt" in read) return read
	if ("parked" in read) return { ok: read.parked }
	const { built } = read
	const seed = deps.seed ?? `ruleset:${built.sessionId}`
	const { out, ledger, zones, invokeRefused, farEnds } = await run(db, built, deps, seed)
	// D6: an action whose function cannot run halts with why — nothing is written.
	if (invokeRefused) return { halt: invokeRefused }
	if (built.mode !== "resolve") {
		await writeOutcome(db, built.sessionId, out, deps, built.mode)
		await writeDecks(db, built.sessionId, out.decks)
		const turnRow =
			built.mode === "propose"
				? null
				: deps.turnMessageId != null
					? await (await import("$lib/server/lorebooks/ownBook")).turnAnchorOf(db, built.sessionId, deps.turnMessageId)
					: null
		const landed: import("./ties").LandingFact[] = []
		// D5: the zones the moment moved — written as the rest is, held on Review (nothing moves until accepted).
		if (zones?.writes.length) {
			if (built.mode === "propose")
				out.facts.zonesHeld = zones.writes.map((w) => ({ owner: w.ownerKey, zone: w.zoneType, note: w.note }))
			else {
				// 🚧 T2/T4: what the moment's writes land on the lorebook — a tie side's
				// row found, overlaid or made (its id stamped back as the side's edge
				// before the zone is written), a held thing's own entry.
				const { landingsOf, writeLandings } = await import("./ties")
				const landings = landingsOf(built.input, zones.writes)
				if (landings.length)
					landed.push(
						...(await writeLandings(db, { sessionId: built.sessionId, ruleset: built.input.ruleset, runId: deps.runId ?? null, messageId: turnRow ?? null }, landings, zones.writes))
					)
				await writeZones(db, { sessionId: built.sessionId, rulesetId: built.input.ruleset.id, messageId: turnRow ?? null, updatedBy: `run:${deps.runId ?? "unknown"}` }, zones.writes)
				out.facts.zonesWritten = zones.writes.map((w) => ({ owner: w.ownerKey, zone: w.zoneType }))
			}
		}
		// 🚧 T2: an attribute that reads onto the lorebook — the values the gate applied (set, not proposed).
		if (built.mode === "apply" && out.changes.length) {
			const refused = new Set(out.rejected.filter((r) => r.reason === "refused-by-gate").map((r) => JSON.stringify([(r.delta as { owner?: unknown }).owner, (r.delta as { slotId?: unknown }).slotId])))
			const set = out.changes.filter((c) => !c.held && (c.op === undefined || c.op === "set") && c.value !== undefined && !refused.has(JSON.stringify([c.owner, c.slotId])))
			if (set.length) {
				const { writeAttributeLandings } = await import("./ties")
				landed.push(...(await writeAttributeLandings(db, { sessionId: built.sessionId, ruleset: built.input.ruleset, runId: deps.runId ?? null, messageId: turnRow ?? null }, set)))
			}
		}
		if (landed.length) {
			out.facts.landings = landed
			// The rows that follow a tie, told under the outcome (screen 4's "follows the bond").
			const { landingLines } = await import("./ties")
			const nameOf = (key: string) => [...built.input.owners, ...(farEnds ?? [])].find((o) => o.key === key)?.name ?? key
			const lines = landingLines(landed, nameOf)
			for (const l of lines) out.outcomes.push({ owner: l.owner, kind: "effect", text: l.text, follows: l.follows })
			// Told under the moment's outcome block too, where it has one (screen 4: the row follows the tie).
			const decided = out.outcomes.find((o) => o.block)
			if (decided?.block && lines.length) decided.block = { ...decided.block, follows: lines.map((l) => l.text) }
			if (lines.length) {
				const text = out.outcomes.map((o) => `- ${o.text}`).join("\n")
				out.blocks.outcomes = { text, tokens: estimateTokens(text), priority: 90, depth: "full", depths: { full: text } }
			}
		}
		// D3: the events the functions raised — emitted after the run's receipt, never here.
		const emits: PendingEmit[] = ledger.emits.map((e) => ({ event: e.event, key: e.key, ...(e.payload !== undefined ? { payload: e.payload } : {}), ...(e.owner ? { owner: e.owner } : {}) }))
		if (emits.length) {
			const queued = built.emits && queueRulesetEmits(deps.runId, built.sessionId, emits)
			out.facts.emits = { events: emits.map((e) => e.event), queued: !!queued, ...(built.emits ? {} : { off: true }) }
		}
	}
	return {
		ok: {
			blocks: out.blocks,
			facts: out.facts,
			outcomes: out.outcomes,
			explain: out.explain,
			rejected: out.rejected
		}
	}
}

/** 🚧 One derived value on an owner's sheet, as the state read sends it (`SessionStateOwnerV1.derived`). */
export interface SheetDerived {
	key: string
	label: string
	value: number
}

/**
 * 🚧 Each owner's **derived values on the sheet** (2026-10-18,
 * `SessionStateOwnerV1.derived`): the session's ruleset's `onSheet` derived
 * selectors — Vis Itineris's _Armour class_ — that this owner has a number
 * for, in the ruleset's order. The same read and phases a `resolve` runs,
 * the `derived` scripts included (`buildEngineInput`, `run`), so the sheet
 * and the Planner's sheet line (`onSheetParts`) say one number. Keyed
 * `<kind>:<id>`. Empty when the ruleset puts nothing on the sheet, when the
 * table keeps no numbers (below `mechanics`, where nothing is worked out),
 * or when the read fails — a sheet without its derived rows, never a failed
 * state read.
 */
export async function sheetDerivedOf(
	db: Db,
	sessionId: number,
	owners: ReadonlyArray<{ kind: string; id: number }>
): Promise<Map<string, SheetDerived[]>> {
	const out = new Map<string, SheetDerived[]>()
	if (!owners.length) return out
	try {
		const session = await rulesetSessionOf(db, sessionId)
		if (!session || (session.rigour !== "mechanics" && session.rigour !== "scripts")) return out
		const ruleset = getRuleset(session.primaryRuleset)
		if (!ruleset) return out
		const { rulesetSelectors, i18nText } = await import("@serene-pub/sdk")
		const onSheet = [...rulesetSelectors(ruleset)].filter(
			([, decl]) => decl.kind === "derived" && (decl as { onSheet?: boolean }).onSheet === true
		)
		if (!onSheet.length) return out
		const read = await buildEngineInput(
			db,
			{ scope: sessionId, owners: owners.map((o) => ({ kind: o.kind, id: o.id })), mode: "resolve" },
			{}
		)
		if (!("built" in read)) return out
		const { out: result } = await run(db, read.built, {}, `ruleset:${sessionId}`)
		const values = (result.facts.values ?? {}) as Record<string, Record<string, unknown>>
		const { selectorLabel } = await import("./engine")
		for (const o of owners) {
			const ref = ownerRefOf({ kind: o.kind, id: o.id }, sessionId)
			if (!ref) continue
			const mine = values[ref.key]
			if (!mine) continue
			const view = read.built.input.owners.find((v) => v.key === ref.key) ?? null
			const rows: SheetDerived[] = []
			for (const [sel, decl] of onSheet) {
				const v = mine[sel]
				if (typeof v !== "number" || !Number.isFinite(v)) continue
				const label = i18nText((decl as { label?: Parameters<typeof i18nText>[0] }).label) || selectorLabel(read.built.input, view, sel)
				rows.push({ key: sel, label, value: v })
			}
			if (rows.length) out.set(`${o.kind}:${o.id}`, rows)
		}
	} catch (e) {
		console.warn(`[rulesets] the sheet's derived values for session ${sessionId} could not be worked out:`, e)
	}
	return out
}
