/**
 * 🚧 A ruleset's declared scripts, run by the handler (PLAN-rulesets §25;
 * W3-A 2026-10-16).
 *
 * A ruleset declares `scripts: [{ phase, priority, seedKey }]`; each names a
 * `pipeline_scripts` row by seed key (seeded at boot by `seedCoreScripts`
 * from `CORE_SCRIPTS`, never by id). This runs the `derived`-phase ones,
 * in priority order, through the same QuickJS host the pipeline's script
 * chains use (`runScriptSource`), once per owner — between the engine's
 * phases 2 and 3, on the values phases 1–2 left (`earlyPhases`, run once and
 * handed on to the engine, never twice) — and hands the engine what they
 * computed (`EngineInput.scripted`), which lays it over in phase 3.
 *
 * ## The envelope (what a script is handed as `value`)
 *
 * `{ phase, ruleset, rigour, settings, owner: { key, name }, values: {
 * selector: value }, pieces: { repertoireId: [props + count] } }` — the
 * owner's values as the ruleset names them (`itineris-strength`, `level`) and
 * every piece it holds. A later script in the phase sees the values the
 * earlier ones returned.
 *
 * ## The answer
 *
 * `{ values?: { selector: value }, modifies?: [{ target, value, label?,
 * bonusType? }], explain?: string }`. Only selectors the ruleset knows are
 * taken (`rulesetSelectors`); anything else, a failure or a missing row is
 * a `failed` line with its reason — never silent, never a halt (a script
 * that misbehaves degrades like an optional step).
 *
 * The other phases (`effects`, `pre-roll`, `post-roll`, `render`) run on
 * events this pass does not fire yet; they are reported, not run
 * (`scriptsNotRun`).
 */

import { eq, and } from "drizzle-orm"
import { rulesetSelectors, type RulesetDecl, type SlotValue } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { byString } from "./common"
import { earlyPhases, type Resolved } from "./engine"
import type { EngineInput, ScriptedValues } from "./types"

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
}

/** The declared scripts at one phase, in priority order (ties by seed key). */
export function scriptsAt(ruleset: RulesetDecl, phase: string) {
	return [...(ruleset.scripts ?? [])]
		.filter((s) => s.phase === phase)
		.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.seedKey < b.seedKey ? -1 : a.seedKey > b.seedKey ? 1 : 0))
}

/** The scripts a ruleset declares at phases this pass does not run, for the facts. */
export function scriptsNotRun(ruleset: RulesetDecl): { seedKey: string; phase: string; why: string }[] {
	return (ruleset.scripts ?? [])
		.filter((s) => s.phase !== "derived")
		.map((s) => ({ seedKey: s.seedKey, phase: s.phase, why: `runs at '${s.phase}', on an event this handler does not fire yet` }))
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

async function defaultRun(req: RulesetScriptRun): Promise<RulesetScriptResult> {
	const { runScriptSource } = await import("$lib/server/pipelines/scripts/host")
	const res = await runScriptSource({
		source: req.source,
		vars: { value: req.value },
		extras: {},
		seedLabel: req.seedLabel,
		// The derive pass is pure: no wall clock reaches it.
		nowMs: 0,
		timeoutMs: 250
	})
	return res.ok ? { ok: true, value: res.value } : { ok: false, reason: res.reason }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

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
	const declared = scriptsAt(input.ruleset, "derived")
	if (!declared.length || input.rigour === "prose") return {}
	const load = deps.loadSource ?? defaultLoader(db)
	const run = deps.run ?? defaultRun
	const known = rulesetSelectors(input.ruleset)
	const sources = new Map<string, string | null>()
	for (const s of declared) if (!sources.has(s.seedKey)) sources.set(s.seedKey, await load(s.seedKey))
	const seed = deps.seed ?? `ruleset:${input.ruleset.id}`
	const phased = early ?? earlyPhases(input)
	const out: Record<string, ScriptedValues> = {}
	for (const owner of [...input.owners].sort((a, b) => byString(a.key, b.key))) {
		const values: Record<string, SlotValue> = Object.fromEntries(phased.get(owner.key)?.values ?? [])
		const pieces: Record<string, unknown[]> = {}
		for (const rep of owner.repertoires)
			(pieces[rep.repertoire.id] ??= []).push(...rep.pieces.map((p) => ({ ...p.props, count: p.count })))
		const got: ScriptedValues = { values: {}, modifies: [], explain: [], failed: [] }
		for (const s of declared) {
			const source = sources.get(s.seedKey)
			if (!source) {
				got.failed.push({ seedKey: s.seedKey, why: "no script with this seed key is installed (or it is switched off)" })
				continue
			}
			const envelope = {
				phase: "derived",
				ruleset: input.ruleset.id,
				rigour: input.rigour,
				settings: { ...(deps.settings ?? {}) },
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
