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
 * the engine's (`runResolve` / `runApply`, with the ruleset's scripts
 * between phases 2 and 3), and `writeOutcome` files what `apply` decided.
 *
 * The outcomes and the explain trace are RETURNED, never written to a
 * channel: the genre's spec puts them where it wants (the table channel, the
 * post-history `outcomes` block, §30).
 */

import { bridgesFor, getRuleset, RIGOURS, type Rigour, type RulesetDecl, type RulesetTime, type SlotListItem } from "@serene-pub/sdk"
import { stateFor } from "$lib/server/state/resolve"
import { minutesPer } from "./common"
import { earlyPhases, runApply, runResolve } from "./engine"
import { conventionsFor, presetOf, settingValues } from "./conventions"
import { ownerRefOf, ownerViews, rulesetSessionOf, sessionOfOwners, storyClockOf, tiesBetween, type OwnerRef } from "./read"
import { roundOf } from "./rounds"
import { runDerivedScripts, scriptsNotRun, type RulesetScriptDeps } from "./scripts"
import type { EngineChange, EngineInput, EngineOutput, ProposedDelta, RejectedDelta, RulesetBlocks, RulesetMode } from "./types"

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
 * 🚧 The engine's expiry switches from the session's task modes (lane 2):
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
}

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
	for (const raw of Array.isArray(req.owners) ? req.owners : [req.owners]) {
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
	const deltas: ProposedDelta[] =
		(mode === "apply" || mode === "propose") && Array.isArray(req.deltas)
			? (req.deltas.filter((d) => d && typeof d === "object") as ProposedDelta[])
			: []
	const settings = settingValues(ruleset, { values: req.settings ?? session.rulesetSettings[ruleset.id] ?? {} })
	const conventions = conventionsFor(ruleset, settings)
	const elapsed = elapsedInUnits(req.elapsed, conventions.time)
	const viewer = typeof req.viewer === "string" && req.viewer.trim() ? req.viewer.trim() : null
	// 🚧 The session's tasks (lane 2, 2026-10-19): *End what runs out* and
	// *Track conditions* decide whether timed pieces count down and leave.
	// A genre that declares neither keeps both running.
	const expiry = writes ? expiryOf(await (await import("$lib/server/sessions/tasks")).sessionTaskModes(db as never, sessionId)) : undefined
	const input: EngineInput = {
		ruleset,
		rigour,
		owners,
		actions: actionsOf(req.actions, sessionId),
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
	return { built: { sessionId, mode, input, settings, unknownOwners, ...(elapsed.notCounted ? { notCounted: elapsed.notCounted } : {}) } }
}

/**
 * Step 2 — run the moment: phases 1–2 once, the ruleset's `derived` scripts
 * on what they left, then the engine on from there (`runResolve`, or
 * `runApply` — with no deltas for `advance`).
 */
async function run(db: Db, built: Built, deps: RulesetResolveDeps, seed: string): Promise<EngineOutput> {
	const { input, mode, settings } = built
	const early = earlyPhases(input)
	input.scripted = await runDerivedScripts(db, input, { ...deps.scripts, seed, settings }, early)
	const out = mode === "resolve" ? runResolve(input, seed, early) : runApply(input, seed, early)
	out.facts.mode = mode
	const notRun = scriptsNotRun(input.ruleset)
	if (notRun.length && input.rigour !== "prose") out.facts.scriptsNotRun = notRun
	if (built.unknownOwners.length) out.facts.unknownOwners = built.unknownOwners
	if (built.notCounted) out.facts.elapsedNotCounted = built.notCounted
	if (Object.keys(settings).length) {
		out.facts.settings = settings
		const preset = presetOf(input.ruleset, settings)
		if (preset) out.facts.preset = preset
	}
	return out
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
			? await (await import("$lib/server/lorebooks/phantom")).turnAnchorOf(db, sessionId, deps.turnMessageId)
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
	const out = await run(db, built, deps, seed)
	if (built.mode !== "resolve") await writeOutcome(db, built.sessionId, out, deps, built.mode)
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
		const result = await run(db, read.built, {}, `ruleset:${sessionId}`)
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
