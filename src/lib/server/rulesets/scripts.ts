/**
 * 🚧 A ruleset's declared scripts, run by the handler (PLAN-rulesets §25;
 * W3-A 2026-10-16; 🚧 every phase since 2026-10-22, PLAN-rulesets-authoring
 * D2, ruling R4).
 *
 * A ruleset declares `scripts: [{ phase, priority, seedKey }]`; each names a
 * `pipeline_scripts` row by seed key (seeded at boot by `seedCoreScripts`
 * from `CORE_SCRIPTS`, never by id). Each phase runs its scripts in priority
 * order (ties by seed key) — 🚧 since 2026-10-23 (D3) in the moment's ONE
 * rules sandbox (`sandbox.ts`, `sandboxScriptRunner`: each script loaded
 * once, 250 ms a call at most, one budget for the whole moment; a direct
 * caller with no moment's sandbox still runs each through the pipeline's
 * host, `runScriptSource`) — at `mechanics` or stricter, never at `prose`,
 * where nothing is computed. ⏳ A ruleset in sections carries them as
 * function modules whose body is the seeded row (`legacyScriptsOf`):
 *
 *  · `effects` — once per owner, before anything is derived, on the values
 *    phases 1–2 left: the events in play and the pieces held; answers lay
 *    bonuses, degree steps and riders beside the pieces' own
 *    (`EngineInput.effects`, folded in by the engine's `effectsPhase`).
 *  · `derived` — once per owner, between the engine's phases 2 and 3, on
 *    the values phases 1–2 (and the `effects` scripts) left: values and
 *    bonuses the engine lays over in phase 3 (`EngineInput.scripted`).
 *  · `pre-roll` — once per check, before it resolves: may change its
 *    target, edge, pool, check method or the method's options.
 *  · `post-roll` — once per check, after: may move or set its degree and
 *    add riders. Both answer the engine's check asks (`EngineAsk`, `checkScriptDriver`).
 *  · `render` — once per moment, on the blocks the model reads: may replace
 *    a block's text (`renderBlocks`).
 *
 * ## The envelope (what a script is handed as `value`)
 *
 * Every phase: `{ phase, ruleset, rigour, settings, session: { turn, round,
 * lastSpeaker, turnsBy } }` — 🚧 `session` is the story lane's turn tally
 * (R51, R52; lane F1: absent outside a session, read-only). Then, by phase:
 *
 *  · `effects` — `owner: { key, name }`, `values` (selector → value),
 *    `pieces` (repertoire id → [props + count]), `events` (in play).
 *  · `derived` — `owner`, `values` (with what earlier scripts returned),
 *    `pieces`.
 *  · `pre-roll` — `owner`, `values`, `pieces`, `check`
 *    (`CheckAskContext`: op, by, selector, label, method { key, kind,
 *    options }, against?, base?, terms, edge, piece?, aimedAt?).
 *  · `post-roll` — the same, `check` with how it came out
 *    (`CheckResultContext`: rolled?, natural?, faces?, pool?, cards?,
 *    versus?, margin?, degree { id, label, five } | null).
 *  · `render` — `viewer`, `blocks` (block key → text), `outcomes` (texts).
 *
 * ## The answers
 *
 *  · `effects` — `{ modifies?: [{ target, value, label?, bonusType? }],
 *    adjust?: [{ target, by }], riders?: [text], explain? }`.
 *  · `derived` — `{ values?: { selector: value }, modifies?, explain? }`.
 *  · `pre-roll` — `{ against?, edge?: -1|0|1, pool?, method?, options?,
 *    modifies?: [{ value, label }], explain? }`; later scripts' parts win,
 *    pools and modifies add up.
 *  · `post-roll` — `{ shift?, degree?, riders?: [text], explain? }`; shifts
 *    add up, the last `degree` wins.
 *  · `render` — `{ blocks?: { key: text }, explain? }`.
 *
 * Only selectors the ruleset knows are taken (`rulesetSelectors`); anything
 * else, a failure or a missing row is a `failed` line with its phase and
 * reason — on the receipt (`facts.scriptsFailed`), never silent, never a
 * halt (a script that misbehaves degrades like an optional step).
 */

import { eq, and } from "drizzle-orm"
import { rulesetSelectors, type RulesetDecl, type SlotValue } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { byString } from "./common"
import { conventionsOf, earlyPhases, estimateTokens, ownerEvents, type Resolved } from "./engine"
import type { EngineAsk, EngineInput, OwnerView, PostRollAnswer, PreRollAnswer, RulesetBlocks, ScriptedEffects, ScriptedValues } from "./types"
import { legacyScriptsOf } from "./functionRun"
import type { RulesSandbox } from "./sandbox"

type Db = any

export interface RulesetScriptRun {
	source: string
	value: unknown
	seedLabel: string
}
export type RulesetScriptResult = { ok: true; value: unknown } | { ok: false; reason: string }

export interface RulesetScriptDeps {
	/** A seeded script's source by its seed key; default: the `pipeline_scripts` row. */
	loadSource?: (seedKey: string) => Promise<string | null>
	/** Run one script; default: the pipeline's QuickJS host (`runScriptSource`). */
	run?: (req: RulesetScriptRun) => Promise<RulesetScriptResult>
	/** The run's seed — labels each script's randomness so a replay derives the same. */
	seed?: string
	/** The ruleset settings in play, handed to the scripts. */
	settings?: Readonly<Record<string, string>>
	/** 🚧 The session's turn facts (R51, R52) — `{ turn, round, lastSpeaker, turnsBy }`. */
	session?: Readonly<Record<string, unknown>>
}

/** 🚧 A script that failed, or was not found, at one phase — what the receipt says (`facts.scriptsFailed`). */
export interface ScriptFailure {
	phase: string
	seedKey: string
	why: string
	owner?: string
}

/** 🚧 A script's own explain sentence, at one phase. */
export interface ScriptExplain {
	phase: string
	seedKey: string
	text: string
	owner?: string
}

/**
 * The declared scripts at one phase, in priority order (ties by seed key) —
 * ⏳ a ruleset's `scripts`, or, for a ruleset in sections, the function
 * modules whose body is a seeded row (`legacyScriptsOf`).
 */
export function scriptsAt(ruleset: RulesetDecl, phase: string) {
	return [...(ruleset.scripts ?? legacyScriptsOf(ruleset))]
		.filter((s) => s.phase === phase)
		.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.seedKey < b.seedKey ? -1 : a.seedKey > b.seedKey ? 1 : 0))
}

function defaultLoader(db: Db) {
	return async (seedKey: string): Promise<string | null> => {
		const [row] = await db
			.select({ source: schema.pipelineScripts.source })
			.from(schema.pipelineScripts)
			.where(and(eq(schema.pipelineScripts.seedKey, seedKey), eq(schema.pipelineScripts.enabled, true)))
			.limit(1)
		return row?.source ?? null
	}
}

/**
 * 🚧 The runner a moment's scripts share (D3, 2026-10-23): each seeded
 * script loaded once into the moment's one rules sandbox (`sandbox.ts`)
 * and called there, spending the turn's one budget.
 */
export function sandboxScriptRunner(sb: RulesSandbox): (req: RulesetScriptRun) => Promise<RulesetScriptResult> {
	return async (req) => {
		const l = await sb.load("legacy", req.source)
		if (!l.ok) return { ok: false, reason: l.reason }
		const r = await sb.call(l.key, "legacy", req.value, req.seedLabel)
		return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason }
	}
}

/** A direct caller's runner (no moment's sandbox): one script, one evaluation — the pipeline's host. */
async function defaultRun(req: RulesetScriptRun): Promise<RulesetScriptResult> {
	const { runScriptSource } = await import("$lib/server/pipelines/scripts/host")
	const res = await runScriptSource({
		source: req.source,
		vars: { value: req.value },
		extras: {},
		seedLabel: req.seedLabel,
		// The handler's scripts are pure: no wall clock reaches them.
		nowMs: 0,
		timeoutMs: 250
	})
	return res.ok ? { ok: true, value: res.value } : { ok: false, reason: res.reason }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/**
 * One phase's scripts for one moment: their sources loaded once, and each
 * run with its seed label. `sources` maps a seed key to its source, or null
 * when no enabled row answers to it.
 */
async function phaseScripts(db: Db, input: EngineInput, phase: string, deps: RulesetScriptDeps) {
	const declared = scriptsAt(input.ruleset, phase)
	const load = deps.loadSource ?? defaultLoader(db)
	const sources = new Map<string, string | null>()
	for (const s of declared) if (!sources.has(s.seedKey)) sources.set(s.seedKey, await load(s.seedKey))
	return { declared, sources, run: deps.run ?? defaultRun, seed: deps.seed ?? `ruleset:${input.ruleset.id}` }
}

/** What every phase's envelope says. */
function envelopeBase(phase: string, input: EngineInput, deps: RulesetScriptDeps): Record<string, unknown> {
	return {
		phase,
		ruleset: input.ruleset.id,
		rigour: input.rigour,
		settings: { ...(deps.settings ?? {}) },
		...(deps.session ? { session: JSON.parse(JSON.stringify(deps.session)) } : {})
	}
}

/** An owner's pieces by repertoire id, each its props and count. */
function piecesOf(owner: OwnerView): Record<string, unknown[]> {
	const pieces: Record<string, unknown[]> = {}
	for (const rep of owner.repertoires) (pieces[rep.repertoire.id] ??= []).push(...rep.pieces.map((p) => ({ ...p.props, count: p.count })))
	return pieces
}

const NOT_INSTALLED = "no script with this seed key is installed (or it is switched off)"

/** Does the ruleset declare any script at this phase — and is the rigour one that runs them? */
export const runsPhase = (input: EngineInput, phase: string): boolean => input.rigour !== "prose" && scriptsAt(input.ruleset, phase).length > 0

/**
 * 🚧 Run the ruleset's `effects` scripts for every owner (2026-10-22):
 * handed the values phases 1–2 left, the pieces held and the events in play;
 * what they lay on is returned by owner key for `EngineInput.effects`.
 * Empty when the ruleset declares none, or at `prose`.
 */
export async function runEffectsScripts(
	db: Db,
	input: EngineInput,
	deps: RulesetScriptDeps = {},
	early?: ReadonlyMap<string, Resolved>
): Promise<Record<string, ScriptedEffects>> {
	if (!runsPhase(input, "effects")) return {}
	const { declared, sources, run, seed } = await phaseScripts(db, input, "effects", deps)
	const known = rulesetSelectors(input.ruleset)
	const phased = early ?? earlyPhases({ ...input, effects: undefined })
	const out: Record<string, ScriptedEffects> = {}
	for (const owner of [...input.owners].sort((a, b) => byString(a.key, b.key))) {
		const values: Record<string, SlotValue> = Object.fromEntries(phased.get(owner.key)?.values ?? [])
		const got: ScriptedEffects = { modifies: [], adjust: [], riders: [], explain: [], failed: [] }
		const envelope = { ...envelopeBase("effects", input, deps), owner: { key: owner.key, name: owner.name }, values, pieces: piecesOf(owner), events: ownerEvents(input, owner) }
		for (const s of declared) {
			const source = sources.get(s.seedKey)
			if (!source) {
				got.failed.push({ seedKey: s.seedKey, why: NOT_INSTALLED })
				continue
			}
			const res = await run({ source, value: envelope, seedLabel: `${seed}:ruleset:${owner.key}:${s.seedKey}` })
			if (!res.ok) {
				got.failed.push({ seedKey: s.seedKey, why: res.reason })
				continue
			}
			if (res.value === undefined || res.value === null) continue
			if (!isRecord(res.value)) {
				got.failed.push({ seedKey: s.seedKey, why: "an effects script returns { modifies, adjust, riders, explain }, or nothing" })
				continue
			}
			const a = res.value
			if (Array.isArray(a.modifies))
				for (const m of a.modifies) {
					if (!isRecord(m) || typeof m.target !== "string" || !isNumber(m.value)) continue
					if (!known.has(m.target)) {
						got.failed.push({ seedKey: s.seedKey, why: `modifies '${m.target}', which ${input.ruleset.id} does not name — dropped` })
						continue
					}
					got.modifies.push({
						target: m.target,
						value: m.value,
						label: typeof m.label === "string" && m.label ? m.label : s.seedKey,
						...(typeof m.bonusType === "string" ? { bonusType: m.bonusType } : {}),
						seedKey: s.seedKey
					})
				}
			if (Array.isArray(a.adjust))
				for (const x of a.adjust) {
					if (!isRecord(x) || typeof x.target !== "string" || (x.by !== 1 && x.by !== -1)) continue
					if (!known.has(x.target)) {
						got.failed.push({ seedKey: s.seedKey, why: `adjusts '${x.target}', which ${input.ruleset.id} does not name — dropped` })
						continue
					}
					got.adjust.push({ target: x.target, by: x.by, seedKey: s.seedKey })
				}
			if (Array.isArray(a.riders))
				for (const t of a.riders) if (typeof t === "string" && t.trim()) got.riders.push({ text: t.trim(), seedKey: s.seedKey })
			if (typeof a.explain === "string" && a.explain.trim()) got.explain.push({ seedKey: s.seedKey, text: a.explain.trim() })
		}
		if (got.modifies.length || got.adjust.length || got.riders.length || got.explain.length || got.failed.length) out[owner.key] = got
	}
	return out
}

/**
 * Run the ruleset's `derived` scripts for every owner at `mechanics` or
 * stricter. Returns what each owner's scripts computed, by owner key —
 * empty when the ruleset declares none (or at `prose`, where nothing is
 * computed).
 */
export async function runDerivedScripts(
	db: Db,
	input: EngineInput,
	deps: RulesetScriptDeps = {},
	/** Phases 1–2, as the engine will pick them up; computed here when not handed in. */
	early?: ReadonlyMap<string, Resolved>
): Promise<Record<string, ScriptedValues>> {
	if (!runsPhase(input, "derived")) return {}
	const { declared, sources, run, seed } = await phaseScripts(db, input, "derived", deps)
	const known = rulesetSelectors(input.ruleset)
	const phased = early ?? earlyPhases(input)
	const out: Record<string, ScriptedValues> = {}
	for (const owner of [...input.owners].sort((a, b) => byString(a.key, b.key))) {
		const values: Record<string, SlotValue> = Object.fromEntries(phased.get(owner.key)?.values ?? [])
		const pieces = piecesOf(owner)
		const got: ScriptedValues = { values: {}, modifies: [], explain: [], failed: [] }
		for (const s of declared) {
			const source = sources.get(s.seedKey)
			if (!source) {
				got.failed.push({ seedKey: s.seedKey, why: NOT_INSTALLED })
				continue
			}
			const envelope = {
				...envelopeBase("derived", input, deps),
				owner: { key: owner.key, name: owner.name },
				values: { ...values, ...got.values },
				pieces
			}
			const res = await run({ source, value: envelope, seedLabel: `${seed}:ruleset:${owner.key}:${s.seedKey}` })
			if (!res.ok) {
				got.failed.push({ seedKey: s.seedKey, why: res.reason })
				continue
			}
			if (res.value === undefined || res.value === null) continue
			if (!isRecord(res.value)) {
				got.failed.push({ seedKey: s.seedKey, why: "a ruleset script returns { values, modifies, explain }, or nothing" })
				continue
			}
			const answer = res.value
			if (isRecord(answer.values))
				for (const [sel, v] of Object.entries(answer.values)) {
					if (!known.has(sel)) {
						got.failed.push({ seedKey: s.seedKey, why: `returned '${sel}', which ${input.ruleset.id} does not name — dropped` })
						continue
					}
					if (v === null || v === undefined) continue
					got.values[sel] = v as SlotValue
				}
			if (Array.isArray(answer.modifies))
				for (const m of answer.modifies) {
					if (!isRecord(m) || typeof m.target !== "string" || typeof m.value !== "number" || !Number.isFinite(m.value)) continue
					if (!known.has(m.target)) {
						got.failed.push({ seedKey: s.seedKey, why: `modifies '${m.target}', which ${input.ruleset.id} does not name — dropped` })
						continue
					}
					got.modifies.push({
						target: m.target,
						value: m.value,
						label: typeof m.label === "string" && m.label ? m.label : s.seedKey,
						...(typeof m.bonusType === "string" ? { bonusType: m.bonusType } : {}),
						seedKey: s.seedKey
					})
				}
			if (typeof answer.explain === "string" && answer.explain.trim())
				got.explain.push({ seedKey: s.seedKey, text: answer.explain.trim() })
		}
		if (Object.keys(got.values).length || got.modifies.length || got.explain.length || got.failed.length) out[owner.key] = got
	}
	return out
}

/**
 * 🚧 A driver for the engine's check asks (2026-10-22): the `pre-roll` and
 * `post-roll` scripts, loaded once a moment, run per check on the check's
 * envelope; their answers merged in priority order (`PreRollAnswer`,
 * `PostRollAnswer`). `checkAsks` is what the engine should ask
 * (`EngineInput.checkAsks`); `explain` and `failed` gather what the scripts said.
 */
export async function checkScriptDriver(db: Db, input: EngineInput, deps: RulesetScriptDeps = {}) {
	const pre = runsPhase(input, "pre-roll") ? await phaseScripts(db, input, "pre-roll", deps) : null
	const post = runsPhase(input, "post-roll") ? await phaseScripts(db, input, "post-roll", deps) : null
	const explain: ScriptExplain[] = []
	const failed: ScriptFailure[] = []
	let asked = 0
	const answer = async (ask: EngineAsk): Promise<PreRollAnswer | PostRollAnswer | null> => {
		const phased = ask.phase === "pre-roll" ? pre : post
		if (!phased) return null
		const n = ++asked
		const owner = input.owners.find((o) => o.key === ask.owner)
		const envelope = {
			...envelopeBase(ask.phase, input, deps),
			owner: { key: ask.owner, name: owner?.name ?? ask.owner },
			values: ask.values,
			pieces: owner ? piecesOf(owner) : {},
			check: JSON.parse(JSON.stringify(ask.check))
		}
		const merged: Record<string, unknown> = {}
		for (const s of phased.declared) {
			const source = phased.sources.get(s.seedKey)
			if (!source) {
				failed.push({ phase: ask.phase, seedKey: s.seedKey, owner: ask.owner, why: NOT_INSTALLED })
				continue
			}
			const res = await phased.run({ source, value: envelope, seedLabel: `${phased.seed}:ruleset:${ask.owner}:${ask.phase}:${n}:${s.seedKey}` })
			if (!res.ok) {
				failed.push({ phase: ask.phase, seedKey: s.seedKey, owner: ask.owner, why: res.reason })
				continue
			}
			if (res.value === undefined || res.value === null) continue
			if (!isRecord(res.value)) {
				failed.push({ phase: ask.phase, seedKey: s.seedKey, owner: ask.owner, why: `a ${ask.phase} script returns an object of what it changes, or nothing` })
				continue
			}
			const a = res.value
			if (typeof a.explain === "string" && a.explain.trim()) explain.push({ phase: ask.phase, seedKey: s.seedKey, owner: ask.owner, text: a.explain.trim() })
			if (ask.phase === "pre-roll") {
				for (const k of ["against", "edge", "method"] as const) if (a[k] !== undefined) merged[k] = a[k]
				if (isRecord(a.options)) merged.options = { ...((merged.options as object) ?? {}), ...a.options }
				if (isNumber(a.pool)) merged.pool = ((merged.pool as number) ?? 0) + a.pool
				if (Array.isArray(a.modifies)) merged.modifies = [...((merged.modifies as unknown[]) ?? []), ...a.modifies]
				if (typeof a.method === "string" && !Object.prototype.hasOwnProperty.call(conventionsOf(input).methods, a.method))
					failed.push({ phase: ask.phase, seedKey: s.seedKey, owner: ask.owner, why: `names the check method '${a.method}', which ${input.ruleset.id} does not declare — ignored` })
			} else {
				if (isNumber(a.shift)) merged.shift = ((merged.shift as number) ?? 0) + Math.trunc(a.shift)
				if (typeof a.degree === "string") merged.degree = a.degree
				if (Array.isArray(a.riders)) merged.riders = [...((merged.riders as unknown[]) ?? []), ...a.riders]
			}
		}
		return Object.keys(merged).length ? (merged as PreRollAnswer | PostRollAnswer) : null
	}
	return { checkAsks: { preRoll: !!pre, postRoll: !!post }, answer, explain, failed }
}

/** The block keys a `render` script may replace — the labelled blocks a context template places. */
const RENDERED = ["voice", "sheet", "pieces", "ties", "custom", "outcomes", "gm"] as const

/**
 * 🚧 Run the ruleset's `render` scripts on the blocks a model call reads
 * (2026-10-22): each may replace a block's text (`{ blocks: { sheet:
 * '…' } }`), which then renders at every depth as that text — a budget
 * drops it rather than stepping it back to words the script replaced. A key
 * naming no block is a failure line. Returns the blocks, changed or not.
 */
export async function renderBlocks(
	db: Db,
	input: EngineInput,
	blocks: RulesetBlocks,
	outcomes: readonly { text: string }[],
	deps: RulesetScriptDeps = {}
): Promise<{ blocks: RulesetBlocks; explain: ScriptExplain[]; failed: ScriptFailure[] }> {
	const explain: ScriptExplain[] = []
	const failed: ScriptFailure[] = []
	if (!runsPhase(input, "render")) return { blocks, explain, failed }
	const { declared, sources, run, seed } = await phaseScripts(db, input, "render", deps)
	let now: RulesetBlocks = { ...blocks }
	for (const s of declared) {
		const source = sources.get(s.seedKey)
		if (!source) {
			failed.push({ phase: "render", seedKey: s.seedKey, why: NOT_INSTALLED })
			continue
		}
		const texts = Object.fromEntries(RENDERED.filter((k) => now[k]).map((k) => [k, now[k]!.text]))
		const envelope = { ...envelopeBase("render", input, deps), viewer: input.viewer ?? null, blocks: texts, outcomes: outcomes.map((o) => o.text) }
		const res = await run({ source, value: envelope, seedLabel: `${seed}:ruleset:render:${s.seedKey}` })
		if (!res.ok) {
			failed.push({ phase: "render", seedKey: s.seedKey, why: res.reason })
			continue
		}
		if (res.value === undefined || res.value === null) continue
		if (!isRecord(res.value)) {
			failed.push({ phase: "render", seedKey: s.seedKey, why: "a render script returns { blocks, explain }, or nothing" })
			continue
		}
		const a = res.value
		if (isRecord(a.blocks))
			for (const [key, text] of Object.entries(a.blocks)) {
				const b = (RENDERED as readonly string[]).includes(key) ? now[key as (typeof RENDERED)[number]] : undefined
				if (!b) {
					failed.push({ phase: "render", seedKey: s.seedKey, why: `replaces '${key}', which is no block this moment renders — dropped` })
					continue
				}
				if (typeof text !== "string") continue
				now = { ...now, [key]: { ...b, text, tokens: estimateTokens(text), depths: { [b.depth]: text } } }
			}
		if (typeof a.explain === "string" && a.explain.trim()) explain.push({ phase: "render", seedKey: s.seedKey, text: a.explain.trim() })
	}
	return { blocks: now, explain, failed }
}
