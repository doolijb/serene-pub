/**
 * 🚧 Try it out (PLAN-ruleset-editor §6.6): a document runs through the
 * engine on a sample sheet without a session; blocks carry token counts; a
 * delta runs `apply` and comes back as an outcome, a change or a refusal; a
 * document with findings is refused before it runs.
 */
import { describe, expect, test } from "vitest"
import { rulesetDocumentOf, type RulesetDocument } from "@serene-pub/sdk"
import { CORE_SCRIPTS, RULESET_TEMPLATES, visItinerisRuleset, freeformRuleset, wherewithalRuleset } from "@serene-pub/core-catalog"
import { attributeSlotOf, functionReadsAs, MAX_REPEAT, playtestDocument, playtestPrompt, repeatDocument, tryFunction, tryOutDocument, TryOutRefusal } from "./tryOut"

describe("try it out", () => {
	test("resolve on Vis Itineris at prose and at mechanics hands back labelled blocks", () => {
		const doc = rulesetDocumentOf(visItinerisRuleset)
		const prose = tryOutDocument(doc, { rigour: "prose" })
		expect(prose.mode).toBe("resolve")
		expect(prose.blocks.some((b) => b.key === "voice" && b.tokens > 0)).toBe(true)
		expect(prose.blocks.some((b) => b.key === "sheet")).toBe(true)
		expect(prose.sample.stats.length).toBeGreaterThan(0)
		const mech = tryOutDocument(doc, { rigour: "mechanics", sample: { name: "Ann" } })
		expect(mech.sample.name).toBe("Ann")
		// 🚧 With the turn economy line (M2, 2026-10-22) where numbers show.
		expect(mech.blocks.find((b) => b.key === "voice")?.text).toBe(
			`${visItinerisRuleset.voice!.mechanics ?? visItinerisRuleset.voice!.prose}\nA turn holds 3 actions and a reaction.`
		)
	})

	test("pieces default to the first two rows per repertoire and can be chosen", () => {
		const doc = rulesetDocumentOf(visItinerisRuleset)
		// Its library (in the sections since 2026-10-23).
		const rep = Object.keys(doc.library?.rows ?? {})[0]!
		const rows = doc.library!.rows[rep]!
		const out = tryOutDocument(doc, { rigour: "prose" })
		expect(out.sample.pieces[rep]).toEqual(rows.slice(0, 2).map((r) => r.id))
		const one = tryOutDocument(doc, { rigour: "prose", sample: { pieces: { [rep]: [rows[0]!.id] } } })
		expect(one.sample.pieces[rep]).toEqual([rows[0]!.id])
	})

	test("a delta runs apply, seeded", () => {
		const doc = rulesetDocumentOf(visItinerisRuleset)
		// An attribute of its own, filed under its slot (in the sections since 2026-10-23).
		const slot = doc.attributes!.find((a) => !a.borrowed && a.slot)!.slot!
		const selector = slot.slice(slot.indexOf("/") + 1, slot.lastIndexOf("@"))
		const run = () =>
			tryOutDocument(doc, {
				rigour: "mechanics",
				seed: "fixed",
				deltas: [{ owner: "sample:1", slot: selector, op: "add", value: 1, reason: "a test" } as any]
			})
		const a = run()
		expect(a.mode).toBe("apply")
		expect(a.changes.length + a.rejected.length + a.outcomes.length).toBeGreaterThan(0)
		expect(JSON.stringify(run().outcomes)).toBe(JSON.stringify(a.outcomes))
	})

	test("a document with findings is refused before it runs", () => {
		const bad = { ...rulesetDocumentOf(freeformRuleset), voice: {} } as unknown as RulesetDocument
		expect(() => tryOutDocument(bad, { rigour: "prose" })).toThrow(TryOutRefusal)
	})

	test("🚧 M4: a party of two, a change by name, decided by the ruleset's own check method", () => {
		const t = RULESET_TEMPLATES.find((x) => x.id.endsWith("template-dice-pool@1"))!
		const doc = rulesetDocumentOf(t.ruleset)
		const out = tryOutDocument(doc, {
			rigour: "mechanics",
			seed: "pool",
			party: t.playtest.party.map((m) => ({ name: m.name, stats: { ...m.stats } as any, pieces: { ...m.pieces } as any })),
			deltas: [{ ...t.playtest.change } as any]
		})
		expect(out.party.map((m) => [m.key, m.name])).toEqual([
			["sample:1", "Wren"],
			["sample:2", "Oskar"]
		])
		expect(out.sample.name).toBe("Wren")
		expect(out.rejected).toEqual([])
		const check = out.outcomes.find((o) => o.check)!
		expect(check.block?.method).toBe("dice-pool")
		expect(check.block?.pool?.size).toBe(5)
	})

	test("🚧 M4: the scripts run as a turn runs them — Wherewithal's phases, no dice", async () => {
		const SOURCES = new Map(CORE_SCRIPTS.map((s) => [s.seedKey, s.source]))
		const doc = rulesetDocumentOf(wherewithalRuleset)
		const nerve = "core:slot/wherewithal-nerve@1"
		const out = await playtestDocument(
			null as any,
			doc,
			{
				rigour: "mechanics",
				seed: "ww",
				party: [{ name: "Ann", stats: { [nerve]: 2 } as any, pieces: { troubles: ["hurt", "hunted"] } }, { name: "Bo" }],
				deltas: [{ owner: "Ann", op: "use", check: "dare", value: 2 } as any]
			},
			{ loadSource: async (key: string) => SOURCES.get(key) ?? null }
		)
		expect(out.mode).toBe("apply")
		expect(out.scripts?.failed).toEqual([])
		expect(out.scripts?.explain.some((e) => e.phase === "effects")).toBe(true)
		expect(out.outcomes.find((o) => o.check)?.check).toMatchObject({ method: "bid", methodKey: "dare" })
		expect(out.blocks.find((b) => b.key === "voice")?.text).toMatch(/What a spend buys/)
	}, 60_000)

	test("🚧 M4: Ask a model hands it the blocks it reads, the situation and what the rules decided — never the reverse", () => {
		const t = RULESET_TEMPLATES.find((x) => x.id.endsWith("template-dice-pool@1"))!
		const out = tryOutDocument(rulesetDocumentOf(t.ruleset), {
			rigour: "mechanics",
			seed: "pool",
			party: t.playtest.party.map((m) => ({ name: m.name, stats: { ...m.stats } as any, pieces: { ...m.pieces } as any })),
			deltas: [{ ...t.playtest.change } as any]
		})
		const { systemPrompt, userPrompt } = playtestPrompt(out, "Wren works the lock.")
		expect(systemPrompt.startsWith("You narrate one moment")).toBe(true)
		expect(systemPrompt).toContain(t.ruleset.voice!.mechanics!)
		expect(systemPrompt).not.toContain("- Wren")
		expect(userPrompt).toContain("The situation: Wren works the lock.")
		expect(userPrompt).toContain(`- ${out.outcomes[0]!.text}`)
		expect(userPrompt.endsWith("Narrate what happens next in two or three sentences.")).toBe(true)
	})

	/* ── 🚧 A4 (2026-10-23): a ruleset in the seven sections ─────────── */

	const HEARTS = {
		id: "acme.lab:ruleset/hollow-hearts@1",
		version: "1.0.0",
		name: { en: "Hollow Hearts" },
		attributes: [
			{ id: "affection", name: { en: "Affection" }, kind: "number", bounds: { min: 0, max: 10 }, start: 5, prose: "How much someone likes you." },
			{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { min: 0, max: 3 }, prose: "Spent to do something brave." },
			{ id: "mood", name: { en: "Mood" }, kind: "label", of: ["shy", "warm", "guarded"], prose: "The mood they are in." }
		],
		functions: [{ ref: "core:function/compare@1", key: "confession", options: { modifierOf: "affection" } }],
		outcomes: [
			{ id: "awkward", label: { en: "awkward" } },
			{ id: "warmed", label: { en: "warmed" } }
		]
	} as unknown as RulesetDocument

	test("🚧 T2: the romance archetype's playtest seats its ties — a confession reads the other person's side of the bond", () => {
		const romance = RULESET_TEMPLATES.find((t) => t.id === "core:ruleset/template-romance@1")!
		const { template: _t, ...ruleset } = romance.ruleset as unknown as Record<string, unknown>
		const doc = { ...ruleset, id: "acme.lab:ruleset/romance-copy@1", version: "1.0.0" } as unknown as RulesetDocument
		const party = romance.playtest.party.map((m) => ({ name: m.name, stats: m.stats as never, pieces: m.pieces as never, ties: m.ties as never }))
		const out = tryOutDocument(doc, { rigour: "mechanics", party, deltas: [{ owner: "Wren", op: "use", check: "confess", aimedAt: "Mara", against: 7 } as never] })
		expect(out.findings).toEqual([])
		const check = out.outcomes.find((o) => o.check?.selector === "confess")
		// Mara's side towards Wren holds 8: the confession is weighed against how she feels.
		expect(check?.check?.total).toBe(8)
		// 🚧 T3: what the model reads names the tie's field in words — never its selector.
		const read = out.blocks.map((b) => b.text).join("\n")
		expect(read).toContain("Affection on a bond is read as the rung it has reached")
		expect(read).not.toContain("bond.affection")
	})

	test("🚧 A4: from scratch (a name and nothing else) runs and reads as nothing of its own", () => {
		const out = tryOutDocument({ id: "acme.lab:ruleset/blank@1", version: "1.0.0", name: { en: "Blank" } } as unknown as RulesetDocument, {
			rigour: "mechanics"
		})
		expect(out.findings).toEqual([])
		expect(out.blocks.find((b) => b.key === "voice")).toBeUndefined()
		expect(out.sample.stats).toEqual([])
	})

	test("🚧 A4: the party carries the attributes, keyed by the slot each is filed under; the stand-in block reads their sentences", () => {
		const affection = attributeSlotOf(HEARTS.id, (HEARTS as any).attributes[0])
		expect(affection).toBe("acme.lab.hollow-hearts:slot/affection@1")
		const out = tryOutDocument(HEARTS, { rigour: "mechanics", party: [{ name: "Wren", stats: { [affection]: 6 } as any }, { name: "Mara" }] })
		expect(out.party.map((m) => m.name)).toEqual(["Wren", "Mara"])
		expect(out.sample.stats.map((s) => [s.label, s.value])).toEqual([
			["Affection", 6],
			["Nerve", 3],
			["Mood", "shy"]
		])
		// Each sentence is read once, whichever block says it (the engine's derived voice, else the stand-in).
		const all = out.blocks.map((b) => b.text).join("\n")
		expect(all.split("How much someone likes you.").length - 1).toBe(1)
		expect(all.split("The mood they are in.").length - 1).toBe(1)
		expect(all).toContain("How it can go: awkward, warmed.")
		expect(out.blocks.every((b) => b.tokens > 0)).toBe(true)
		// Words only: no numbers anywhere in what is read of the rules.
		const words = tryOutDocument(HEARTS, { rigour: "prose" }).blocks.map((b) => b.text).join("\n")
		expect(words).not.toContain("0–10")
		expect(words.split("How much someone likes you.").length - 1).toBe(1)
	})

	test("🚧 A4: Try this function says what it reads as, and the rules decide it as a use by the first of the party", () => {
		const out = tryFunction(HEARTS, { rigour: "mechanics", party: [{ name: "Wren" }, { name: "Mara" }] }, "confession")
		expect(out.function).toMatchObject({ key: "confession", ref: "core:function/compare@1", ran: true })
		expect(out.outcomes.some((o) => o.check?.selector === "confession")).toBe(true)
		expect(() => tryFunction(HEARTS, { rigour: "mechanics" }, "nothing-here")).toThrow(TryOutRefusal)
		const reads = functionReadsAs(
			{ ref: "acme.lab:function/x@1", bindings: { what: "nerve" }, module: { id: "acme.lab:function/x@1", name: { en: "X" }, meaning: { en: "m" }, kind: "value", prose: "{{what}} comes back each morning" } } as any,
			(id) => (id === "nerve" ? "Nerve" : id)
		)
		expect(reads).toBe("Nerve comes back each morning.")
	})

	test("🚧 A4: Run it N times counts the outcomes by their words, seeded, capped", () => {
		const t = RULESET_TEMPLATES.find((x) => x.id.endsWith("template-dice-pool@1"))!
		const params = {
			rigour: "mechanics" as const,
			seed: "n",
			party: t.playtest.party.map((m) => ({ name: m.name, stats: { ...m.stats } as any, pieces: { ...m.pieces } as any })),
			deltas: [{ ...t.playtest.change } as any]
		}
		const out = repeatDocument(rulesetDocumentOf(t.ruleset), params, 12)
		expect(out.repeat!.runs).toBe(12)
		expect(out.repeat!.tally.reduce((n, x) => n + x.count, 0)).toBeGreaterThanOrEqual(12)
		expect(JSON.stringify(repeatDocument(rulesetDocumentOf(t.ruleset), params, 12).repeat)).toBe(JSON.stringify(out.repeat))
		expect(repeatDocument(rulesetDocumentOf(t.ruleset), params, 10_000).repeat!.runs).toBe(MAX_REPEAT)
	})
})
