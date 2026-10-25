/**
 * 0118 — **Rulesets made on the pub, onto check methods** (PLAN-rulesets-
 * authoring D6, lane M4, 2026-10-22). No shape change (the anchor migration
 * is drizzle's empty custom file); this rewrites the `rulesets` rows' stored
 * documents — the draft and the published one — written before the SDK
 * named its check methods (M1), so what the editor opens, what boots and
 * what a session plays read one shape:
 *
 * | from | to |
 * |---|---|
 * | `conventions.dice` `{ sides, modifierOf? }` | `conventions.methods.die` — a `die-target` method, keyed `die` (`LEGACY_DIE_METHOD`), the sole method and so the default |
 * | the top-level `difficultyBands` | that method's `bands`; the top-level key removed |
 * | a setting choice's `conventions.dice` | the same, under that choice's `conventions.methods` |
 * | a `harm` / `heal` saying `dice: 'piece.<field>'` | `amount: { selector: 'piece.<field>' }` (an amount expression) |
 * | no repertoire saying `tags` | each tagged from its id, once (`guessRepertoireTags`, the regexes fit read before) — one whose id says nothing stays untagged |
 * | a `casting` setting's `points` choice laying no pool (a Vis Itineris copy from before M3) | that choice lays the casting pool Vis Itineris declares: `itineris-spell-points` by `level` out of `spells`, filled by the `long` rest to `spell-points-max` where the document declares them — what the engine read by the choice's id until now |
 *
 * After it the engine reads a casting pool only as declared (the
 * `castingPoolOf` fallback is gone). Session rows keep their rigour ids and
 * pinned versions; draft findings are recomputed on the row's next save.
 * Raw SQL through `tx`; idempotent — a second run finds no old key.
 */
import { sql } from "drizzle-orm"
import { guessRepertoireTags } from "@serene-pub/sdk"
import { rawRows } from "../rawRows"
import type { DataUpgradeContext } from "./index"

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
/** `acme:slot/itineris-spell-points@1` → `itineris-spell-points`. */
const slotStem = (id: string): string => id.slice(id.indexOf("/") + 1, id.lastIndexOf("@"))

/** The key `conventions.dice` is read under (the SDK's `LEGACY_DIE_METHOD`, frozen here). */
const DIE = "die"
/** Vis Itineris's spell-point pool, as M3 declared it (`VIS_ITINERIS_SPELL_POINTS`), frozen here. */
const SPELL_POINTS = { pool: "itineris-spell-points", cost: "level", repertoire: "spells", refill: "long", max: "spell-points-max" }

/** What one document's upgrade did — for the log and the test. */
export interface RulesetDocumentUpgrade {
	doc: Json
	changes: string[]
}

/** `{ sides, modifierOf? }` as a die-target method, with bands when there are any. */
function dieMethod(dice: Json, bands: unknown): Json {
	return {
		kind: "die-target",
		sides: dice.sides,
		...(dice.modifierOf !== undefined ? { modifierOf: dice.modifierOf } : {}),
		...(Array.isArray(bands) && bands.length ? { bands } : {})
	}
}

/** One stored ruleset document, onto check methods (see the module note). Pure; idempotent. */
export function upgradeRulesetDocument(input: unknown): RulesetDocumentUpgrade {
	if (!isObject(input)) return { doc: input as Json, changes: [] }
	const doc = clone(input)
	const changes: string[] = []
	const conv: Json | null = isObject(doc.conventions) ? doc.conventions : null

	// The die and the top-level bands → one die-target method.
	if (conv && isObject(conv.dice) && conv.methods === undefined) {
		conv.methods = { [DIE]: dieMethod(conv.dice, doc.difficultyBands) }
		delete conv.dice
		if (conv.defaultMethod !== undefined && conv.defaultMethod !== DIE) delete conv.defaultMethod
		if (doc.difficultyBands !== undefined) {
			delete doc.difficultyBands
			changes.push("difficulty bands → the die method's")
		}
		changes.push("dice → methods.die")
	} else if (conv && doc.difficultyBands !== undefined && isObject(conv.methods)) {
		// Bands beside methods: the default (else first) method made against a target takes them.
		const methods = conv.methods as Record<string, Json>
		const key =
			(typeof conv.defaultMethod === "string" && isObject(methods[conv.defaultMethod]) ? conv.defaultMethod : undefined) ??
			Object.keys(methods).find((k) => ["die-target", "card-draw", "compare"].includes(String(methods[k]?.kind)))
		if (key && isObject(methods[key]) && methods[key]!.bands === undefined && Array.isArray(doc.difficultyBands) && doc.difficultyBands.length)
			methods[key] = { ...methods[key], bands: doc.difficultyBands }
		delete doc.difficultyBands
		changes.push("difficulty bands → under a method")
	}

	// A setting choice that lays the old die.
	if (isObject(doc.settings))
		for (const [name, setting] of Object.entries(doc.settings)) {
			if (!isObject(setting) || !Array.isArray(setting.choices)) continue
			for (const choice of setting.choices) {
				const patch = isObject(choice) && isObject(choice.conventions) ? choice.conventions : null
				if (!patch || !isObject(patch.dice) || patch.methods !== undefined) continue
				patch.methods = { [DIE]: dieMethod(patch.dice, undefined) }
				delete patch.dice
				changes.push(`${name}/${String((choice as Json).id)}: dice → methods.die`)
			}
		}

	// harm / heal: `dice: 'piece.x'` → an amount expression.
	const reps = Array.isArray(doc.repertoires) ? (doc.repertoires as unknown[]).filter(isObject) : []
	for (const rep of reps)
		if (Array.isArray(rep.mechanics))
			rep.mechanics = rep.mechanics.map((m) => {
				if (!isObject(m) || (m.verb !== "harm" && m.verb !== "heal") || typeof m.dice !== "string" || m.amount !== undefined) return m
				const { dice, ...rest } = m
				changes.push(`${String(rep.id)}: ${String(m.verb)} dice → amount`)
				return { ...rest, amount: { selector: dice } }
			})

	// Tags, once: only when no repertoire says any (else only what is said is read).
	if (reps.length && !reps.some((r) => r.tags !== undefined))
		for (const rep of reps) {
			const tags = guessRepertoireTags({ id: String(rep.id ?? "") })
			if (tags.length) {
				rep.tags = tags
				changes.push(`${String(rep.id)}: tagged ${tags.join(", ")}`)
			}
		}

	// The spell-point choice the engine read by its id.
	const casting = isObject(doc.settings) ? (doc.settings as Json).casting : undefined
	const points = isObject(casting) && Array.isArray(casting.choices) ? casting.choices.find((c) => isObject(c) && c.id === "points") : undefined
	if (isObject(points) && !(isObject(points.conventions) && points.conventions.casting !== undefined) && !(conv && conv.casting !== undefined)) {
		const stats = Array.isArray(doc.stats) ? (doc.stats as unknown[]).filter(isObject).map((s) => slotStem(String(s.id ?? ""))) : []
		const spells = reps.find((r) => r.id === SPELL_POINTS.repertoire)
		const fields = isObject(spells?.piece) && isObject((spells!.piece as Json).fields) ? ((spells!.piece as Json).fields as Json) : {}
		if (stats.includes(SPELL_POINTS.pool) && spells && SPELL_POINTS.cost in fields) {
			const rests = conv && Array.isArray(conv.rest) ? (conv.rest as unknown[]).filter(isObject).map((r) => r.id) : []
			const selectors = isObject(doc.selectors) ? Object.keys(doc.selectors) : []
			points.conventions = {
				...(isObject(points.conventions) ? points.conventions : {}),
				casting: {
					pool: SPELL_POINTS.pool,
					cost: SPELL_POINTS.cost,
					repertoire: SPELL_POINTS.repertoire,
					...(rests.includes(SPELL_POINTS.refill) ? { refill: SPELL_POINTS.refill } : {}),
					...(selectors.includes(SPELL_POINTS.max) || stats.includes(SPELL_POINTS.max) ? { max: SPELL_POINTS.max } : {})
				}
			}
			changes.push("casting/points: lays the spell-point pool")
		}
	}

	return { doc, changes }
}

/** What the upgrade did, row by row — for the log and the test. */
export interface RulesetsCheckMethodsReport {
	rows: number
	changed: { rulesetId: string; changes: string[] }[]
}

export async function rulesetsCheckMethodsUpgrade(tx: MigrationTx): Promise<RulesetsCheckMethodsReport> {
	const rows = rawRows<{ id: number; ruleset_id: string; draft: unknown; published: unknown }>(
		await tx.execute(sql`SELECT id, ruleset_id, draft, published FROM rulesets ORDER BY id`)
	)
	const report: RulesetsCheckMethodsReport = { rows: rows.length, changed: [] }
	for (const row of rows) {
		const draft = upgradeRulesetDocument(row.draft)
		const published = row.published == null ? null : upgradeRulesetDocument(row.published)
		const changes = [...draft.changes, ...(published?.changes ?? []).map((c) => `published: ${c}`)]
		if (!changes.length) continue
		await tx.execute(
			sql`UPDATE rulesets SET draft = ${JSON.stringify(draft.doc)}::jsonb, published = ${published ? JSON.stringify(published.doc) : null}::jsonb WHERE id = ${row.id}`
		)
		report.changed.push({ rulesetId: row.ruleset_id, changes })
	}
	return report
}

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	const report = await rulesetsCheckMethodsUpgrade(tx)
	for (const c of report.changed) console.log(`[0118] ${c.rulesetId}: ${c.changes.join("; ")}`)
}
