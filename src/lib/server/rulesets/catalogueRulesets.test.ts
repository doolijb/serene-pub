/**
 * 🚧 The catalogue's new rulesets through the real handler (PLAN-rulesets-
 * authoring D3, lane M3, 2026-10-22):
 *
 *  · **Wherewithal** (`core:ruleset/wherewithal@1`), core's diceless ruleset,
 *    end to end in QuickJS the way `resolve.ts` runs a moment: its `effects`
 *    script wears a troubled character thin, its `derived` script computes
 *    mettle, the engine decides a spend (`bid`), a contest (`compare`) and a
 *    boon used, and its `render` script lays the price list after the voice.
 *  · **The three ruleset templates**: each one's preloaded playtest scene
 *    — its party, its one change — decided by its own check method, so an
 *    archetype is a working ruleset before anyone copies it.
 */

import { describe, expect, test } from "vitest"
import { declaresSections, getAttributeSlot, i18nText, rulesetAttributeSlotId, rulesetSections, type RulesetDecl, type SlotValue } from "@serene-pub/sdk"
import { CORE_SCRIPTS, d20StyleTemplate, dicelessPoolsTemplate, dicePoolTemplate, wherewithalRuleset } from "@serene-pub/core-catalog"
import { sectionsOwner, type TryOutSample } from "./tryOut"
import { slotKey } from "$lib/server/state/keys"
import { runApply, runResolve } from "./engine"
import { renderBlocks, runDerivedScripts, runEffectsScripts } from "./scripts"
import type { EngineInput, HeldPiece, HeldRepertoire, OwnerStat, OwnerView, ProposedDelta } from "./types"

/** The seeded sources by key, run in the real QuickJS host. */
const SOURCES = new Map(CORE_SCRIPTS.map((s) => [s.seedKey, s.source]))
const deps = { loadSource: async (key: string) => SOURCES.get(key) ?? null, seed: "catalogue-test" }

interface Member {
	name: string
	stats?: Readonly<Record<string, SlotValue>>
	pieces?: Readonly<Record<string, readonly string[]>>
}

/** A seat on the sheet: the ruleset's stats (given, else their defaults) and the compendium rows held. */
function ownerOf(decl: RulesetDecl, m: Member, i: number): OwnerView {
	// 🚧 A template in the sections (2026-10-23): its attributes by id, its slots derived — the seat Playtest builds.
	if (declaresSections(decl) && (decl as { template?: true }).template === true)
		return { ...sectionsOwner(decl, rulesetSections(decl), m as unknown as TryOutSample, i), key: `character:${i + 1}`, owner: { kind: "session_cast", id: i + 1 } } as OwnerView
	const stats: OwnerStat[] = []
	for (const entry of decl.stats) {
		const slot = getAttributeSlot(entry.id)
		if (!slot) continue
		const given = m.stats?.[entry.id]
		const max = (entry.config as { max?: unknown } | undefined)?.max ?? (slot.config as { max?: unknown } | undefined)?.max
		stats.push({
			slotId: entry.id,
			selector: slotKey(entry.id),
			type: String(slot.type ?? ""),
			value: (given !== undefined ? given : (entry.default ?? slot.default)) as SlotValue,
			label: i18nText(slot.label) ?? slotKey(entry.id),
			...(typeof max === "number" ? { max } : {})
		})
	}
	const repertoires: HeldRepertoire[] = decl.repertoires.map((rep) => {
		const rows = decl.compendium?.rows?.[rep.id] ?? []
		const pieces: HeldPiece[] = (m.pieces?.[rep.id] ?? []).map((id) => {
			const r = rows.find((x) => x.id === id)!
			return { key: r.id, props: { ...r.piece }, count: 1, form: "compendium", item: { kind: "compendium", compendiumId: decl.id, pieceId: r.id, version: r.version } } as HeldPiece
		})
		return { slotId: `test:${rep.id}`, repertoire: rep, pieces }
	})
	return {
		key: `character:${i + 1}`,
		owner: { kind: "session_cast", id: i + 1 },
		name: m.name,
		stats,
		repertoires,
		custom: [],
		bag: Object.fromEntries(stats.map((s) => [s.slotId, s.value as SlotValue]))
	} as OwnerView
}

const engineInput = (decl: RulesetDecl, party: readonly Member[], deltas: ProposedDelta[], over: Partial<EngineInput> = {}): EngineInput => ({
	ruleset: decl,
	rigour: "mechanics",
	owners: party.map((m, i) => ownerOf(decl, m, i)),
	actions: {},
	deltas,
	elapsed: 0,
	ties: [],
	turn: 1,
	...over
})

const W = wherewithalRuleset
const NERVE = "core:slot/wherewithal-nerve@1"
const FAVOUR = "core:slot/wherewithal-favour@1"
const PROVISIONS = "core:slot/wherewithal-provisions@1"
const ANN: Member = {
	name: "Ann",
	stats: { [NERVE]: 2, [FAVOUR]: 3, [PROVISIONS]: 0 },
	pieces: { bonds: ["sworn-friend"], troubles: ["hurt", "hunted"], boons: ["strong-drink"] }
}
const BO: Member = { name: "Bo", stats: { [NERVE]: 3, [FAVOUR]: 1, [PROVISIONS]: 2 } }

describe("Wherewithal — every phase it declares runs, and it decides without dice", () => {
	test("effects wear Ann thin; derived computes mettle; a spend, a contest and a boon are decided; render lays the price list", async () => {
		const deltas: ProposedDelta[] = [
			{ owner: "character:1", op: "use", check: "dare", value: 2, reason: "Ann walks the ledge" },
			{ owner: "character:1", op: "use", check: "contest", aimedAt: "character:2", reason: "Ann stares Bo down" },
			{ owner: "character:1", op: "use", repertoire: "boons", piece: "strong-drink" }
		]
		const input = engineInput(W, [ANN, BO], deltas)
		// effects — two troubles: every contest a step down, and the riders.
		const effects = await runEffectsScripts(null, input, deps)
		expect(effects["character:1"]!.adjust).toEqual([{ target: "contest", by: -1, seedKey: "core:script/wherewithal-strain" }])
		expect(effects["character:1"]!.riders.map((r) => r.text)).toEqual([
			"Ann is worn thin: 2 troubles weigh on every contest.",
			"Ann is out of provisions: none can be spent until it is restored."
		])
		expect([effects["character:2"]?.adjust, effects["character:2"]?.riders]).toEqual([[], []])
		expect(effects["character:2"]?.explain.map((e) => e.text)).toEqual(["0 troubles held"])
		// derived — mettle: the best pool, and one for Ann's steady bond.
		const scripted = await runDerivedScripts(null, { ...input, effects }, deps)
		expect(scripted["character:1"]!.values).toEqual({ mettle: 4, reserve: 5 })
		expect(scripted["character:2"]!.values).toEqual({ mettle: 3, reserve: 6 })
		expect(scripted["character:1"]!.failed).toEqual([])
		// The engine decides: nothing is rolled.
		const out = runApply({ ...input, effects, scripted, random: () => { throw new Error("Wherewithal rolls nothing") } }, "catalogue-test")
		expect(out.rejected).toEqual([])
		const [dare, contest] = out.outcomes.filter((o) => o.check)
		expect(dare!.check).toMatchObject({ method: "bid", methodKey: "dare", band: "carried" })
		expect(dare!.block).toMatchObject({ method: "bid", rolled: 2 })
		// Mettle 4, less a heavy trouble's 1, against Bo's 3: level — at a cost — then worn thin, a step down.
		expect(contest!.check).toMatchObject({ method: "compare", methodKey: "contest", total: 3, against: 3, band: "short" })
		// The spend and the boon move Ann's nerve: 2 − 2 + 1, and the flask is used up.
		const nerve = out.changes.filter((c) => c.slotId === NERVE)
		expect(nerve.length).toBeGreaterThan(0)
		expect(out.changes.some((c) => c.slotId === "test:boons" && c.op === "remove")).toBe(true)
		// render — the price list after the voice the model reads.
		const read = runResolve({ ...input, deltas: [], effects, scripted })
		const rendered = await renderBlocks(null, input, read.blocks, read.outcomes, deps)
		expect(rendered.failed).toEqual([])
		expect(rendered.blocks.voice!.text).toMatch(/What a spend buys: 1, it holds, at a cost; 2, it carries; 3, it carries clean\.$/)
	})

	test("at prose nothing is computed: no script runs, and the voice is the prose one", async () => {
		const input = engineInput(W, [ANN], [], { rigour: "prose" })
		expect(await runEffectsScripts(null, input, deps)).toEqual({})
		expect(await runDerivedScripts(null, input, deps)).toEqual({})
		const read = runResolve(input)
		expect(read.blocks.voice!.text).toContain("Wherewithal keeps no dice.")
	})
})

describe("the ruleset templates — each playtest scene is decided by its own check method", () => {
	const scene = (i: number, random: () => number) => {
		// d20-style, a dice pool, diceless pools (the four of `archetypes/` lead `RULESET_TEMPLATES` since 2026-10-23).
		const t = [d20StyleTemplate, dicePoolTemplate, dicelessPoolsTemplate][i]!
		const party = t.playtest.party
		const key = (name: unknown) => `character:${party.findIndex((m) => m.name === name) + 1}`
		const c = t.playtest.change
		const delta: ProposedDelta = { ...c, owner: key(c.owner), ...(c.aimedAt ? { aimedAt: key(c.aimedAt) } : {}) } as ProposedDelta
		return runApply(engineInput(t.ruleset, party, [delta], { random }), `playtest:${t.id}`)
	}

	test("d20-style: Bryn's longsword against 13 — a d20 and might, a hit, the bandit's health down", () => {
		const out = scene(0, () => 0.6)
		expect(out.rejected).toEqual([])
		const hit = out.outcomes.find((o) => o.check)!
		expect(hit.check).toMatchObject({ method: "die-target", methodKey: "d20", natural: 13, total: 16, against: 13, band: "hit" })
		const health = out.changes.find((c) => c.slotId === "core:slot/hp@1")
		expect(health).toBeDefined()
	})

	test("dice pool: Wren picks the lock — mind 3, the scholar's die and the lockpicks' — five dice, counted", () => {
		const out = scene(1, () => 0.9)
		expect(out.rejected).toEqual([])
		const check = out.outcomes.find((o) => o.check)!
		expect(check.block).toMatchObject({ method: "dice-pool", pool: { size: 5, successes: 5, successOn: 5 } })
		expect(check.check).toMatchObject({ band: "triumph" })
	})

	test("diceless pools: Mara spends two pull on the ferryman — done, and the pull is gone", () => {
		const out = scene(2, () => {
			throw new Error("nothing is rolled")
		})
		expect(out.rejected).toEqual([])
		expect(out.outcomes.find((o) => o.check)!.check).toMatchObject({ method: "bid", methodKey: "lean", band: "done" })
		// Its own attribute, under the slot a copy derives (2026-10-23; `core:slot/diceless-pull@1` before).
		expect(out.changes.some((c) => c.slotId === rulesetAttributeSlotId(dicelessPoolsTemplate.id, "pull"))).toBe(true)
	})
})
