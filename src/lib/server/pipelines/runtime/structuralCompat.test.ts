/**
 * Structural compatibility, at run time (ruling 2026-09-10).
 *
 * The compile-time half is `bindingInput.typetest.ts` here and
 * `nodeInput.assert.ts` in the SDK; neither can help the two cases this file
 * exists for — a plugin binding another plugin's public handler, and the
 * admin-side orchestrator composing nodes in a form. Both meet across a
 * compile boundary, so both need the rule as data.
 *
 * What is asserted is the **report**, not just the verdict. "Incompatible" with
 * nothing named is the kind of refusal people work around; the sentence naming
 * the handler and the missing name is the whole product.
 */

import { describe, it, expect } from "vitest"
import * as C from "@serene-pub/contracts"
import {
	normaliseSupplies,
	requiresOf,
	structuralCompat
} from "./structuralCompat"

describe("structuralCompat", () => {
	it("accepts a handler that reads only what the type declares", () => {
		expect(
			structuralCompat(
				{ ports: ["vectors", "scope"], params: ["topK"] },
				C.vectorSearch
			)
		).toEqual({ ok: true })
	})

	it("accepts a type that supplies MORE than the handler reads", () => {
		// The direction that makes one handler serve several types: nothing is
		// said about what the contract offers and the handler ignores.
		expect(
			structuralCompat({ ports: [], params: [] }, C.vectorSearch).ok
		).toBe(true)
	})

	it("names the port the type does not declare — the defect that shipped", () => {
		// `topK` is a PARAMETER of vector-search. The binding read it off the
		// top level for the life of the mechanism, and the host ran on a
		// literal 40 while a validated, saved 12 reached nothing.
		const v = structuralCompat(
			{ ports: ["topK"], params: [] },
			C.vectorSearch,
			"semanticSearch"
		)
		expect(v.ok).toBe(false)
		if (v.ok) return
		expect(v.missingPorts).toEqual(["topK"])
		expect(v.missingParams).toEqual([])
		expect(v.handler).toBe("semanticSearch")
		expect(v.definitionId).toBe("core:query/vector-search@1")
		expect(v.message).toContain("semanticSearch")
		expect(v.message).toContain("'topK'")
		expect(v.message).toContain("core:query/vector-search@1")
	})

	it("names a parameter the schema does not carry", () => {
		// `minScore` was declared, never read, and then deleted outright — a
		// threshold is not portable across embedding models. A read of it must
		// come back as a finding, not as `undefined`.
		const v = structuralCompat(
			{ ports: [], params: ["minScore"] },
			C.vectorSearch
		)
		expect(v.ok).toBe(false)
		if (v.ok) return
		expect(v.missingParams).toEqual(["minScore"])
		expect(v.message).toContain("input.params")
	})

	it("reports every missing name at once, in both categories", () => {
		const v = structuralCompat(
			{ ports: ["topK", "somethingElse"], params: ["minScore"] },
			C.vectorSearch,
			"aHandler"
		)
		expect(v.ok).toBe(false)
		if (v.ok) return
		expect(v.missingPorts.sort()).toEqual(["somethingElse", "topK"])
		expect(v.missingParams).toEqual(["minScore"])
		// One refusal, all of it. A reader who has to re-run to find the second
		// missing name learns to distrust the first.
		expect(v.message).toContain("'somethingElse'")
		expect(v.message).toContain("'minScore'")
	})

	it("reports a declared parameter of the wrong field type", () => {
		const v = structuralCompat(
			{ ports: [], params: ["topK"], paramTypes: { topK: "string" } },
			C.vectorSearch
		)
		expect(v.ok).toBe(false)
		if (v.ok) return
		expect(v.missingParams).toEqual([])
		expect(v.typeMismatches).toEqual([
			{ param: "topK", required: "string", declared: "integer" }
		])
		expect(v.message).toContain("declares it as a integer")
	})

	it("does not report a missing name twice, as missing and as mismatched", () => {
		const v = structuralCompat(
			{ ports: [], params: ["nope"], paramTypes: { nope: "string" } },
			C.vectorSearch
		)
		expect(v.ok).toBe(false)
		if (v.ok) return
		expect(v.missingParams).toEqual(["nope"])
		expect(v.typeMismatches).toEqual([])
	})

	it("treats a slot name as a port, because the input is flat", () => {
		// `resolveInput` builds one object out of config, wired edges and
		// resolved slot refs alike — a handler cannot tell them apart.
		expect(
			structuralCompat({ ports: ["params"], params: [] }, C.vectorSearch)
				.ok
		).toBe(true)
	})
})

describe("normaliseSupplies", () => {
	it("reads a pinned contract", () => {
		const s = normaliseSupplies(C.sessionHistory)
		expect(s.id).toBe("core:query/session-history@1")
		// `share`, `maxEntries`, `minEntries` joined `priority` on 2026-09-16
		// (R-7 P5): the conversation's band intent, declared on the source.
		// `unplayedOnly` 2026-09-28 (lair re-plan R13): a side channel's talk
		// since the story's last line. `talkOnly` 2026-09-28 (lair re-plan
		// R10's fold-in): off `main`, only the talk — never a beats row.
		expect(s.params.sort()).toEqual([
			"channel",
			"limit",
			"maxEntries",
			"minEntries",
			"priority",
			"share",
			"talkOnly",
			"unplayedOnly"
		])
	})

	it("reads a pipeline_definition_registry row — the only source a plugin type has", () => {
		// F6: core reads a plugin's contract from the row it stored at install
		// and never loads the plugin to ask. A `transport: 'process'` type has
		// no in-process descriptor to read even if that rule allowed it.
		const s = normaliseSupplies({
			definitionId: "acme:query/thing",
			version: 2,
			ports: { in: { text: "core:shape/text@1" }, out: {} },
			slots: {
				params: { schema: { depth: { type: "integer" } } }
			}
		})
		expect(s.id).toBe("acme:query/thing@2")
		expect(s.ports.sort()).toEqual(["params", "text"])
		expect(s.params).toEqual(["depth"])
		expect(s.paramTypes.depth).toBe("integer")
	})

	it("a row and its contract answer alike", () => {
		const fromContract = normaliseSupplies(C.vectorSearch)
		const d: any = (C.vectorSearch as any).descriptor
		const fromRow = normaliseSupplies({
			definitionId: "core:query/vector-search",
			version: 1,
			ports: d.ports,
			slots: d.slots
		})
		expect(fromRow.ports.sort()).toEqual(fromContract.ports.sort())
		expect(fromRow.params.sort()).toEqual(fromContract.params.sort())
	})
})

describe("requiresOf — the runtime twin of SharedInput", () => {
	it("one contract gives that contract's whole surface", () => {
		const r = requiresOf(C.vectorSearch)
		expect([...r.params].sort()).toEqual([
			"maxEntries",
			"similarityFalloff",
			"topK"
		])
	})

	it("several give the INTERSECTION, which is the flexibility rule", () => {
		// The three lore lanes come from one `loreSlots()` helper, so the
		// intersection is the whole of it — and that is the fact `loreFor`
		// being bound to all three rests on.
		const r = requiresOf(C.worldLore, C.characterLore, C.historyEntries)
		// `scope` and the params slot: the lanes declare no `text` in-port
		// (culled 2026-09-16, R-12 — nothing filled it and nothing read it).
		expect([...r.ports].sort()).toEqual(["params", "scope"])
		expect(r.params).toContain("scanDepth")
	})

	it("two unlike types intersect down to what they share", () => {
		const r = requiresOf(C.worldLore, C.sessionHistory)
		// `scope` and the `params` slot are common; `text` is world-lore's
		// alone and `budget` is session-history's.
		expect([...r.ports].sort()).toEqual(["params", "scope"])
		// Their schemas share only the band intent both declare (R-7 P5):
		// the scan knobs are world-lore's, `limit`/`channel`/`minEntries`
		// are session-history's.
		expect([...r.params].sort()).toEqual(["maxEntries", "priority", "share"])
	})

	it("a handler typed against a group is compatible with every member", () => {
		const group = [C.worldLore, C.characterLore, C.historyEntries]
		const requires = requiresOf(...group)
		for (const c of group)
			expect(structuralCompat(requires, c, "loreFor")).toEqual({
				ok: true
			})
	})

	it("no contracts reads NOTHING, not everything", () => {
		// The silent failure of every intersection written as a fold: an empty
		// group that passes every check it is put to.
		expect(requiresOf()).toEqual({ ports: [], params: [] })
	})
})
