/**
 * 🚧 Replies carry changes (D7, R7): the schema from a ruleset's sections,
 * the `message` read out of a reply still streaming, the changes read as
 * the handler's deltas.
 */
import { describe, expect, it } from "vitest"
import { defineRuleset, rulesetAttributeSlotId } from "@serene-pub/sdk"
import { messageOfPartial, MessageStreamer, replyChangesAsDeltas, replySchemaOf, splitReply } from "./replies"
import { jsonSchemaToGbnf, type JsonSchemaNode } from "$lib/server/connectionAdapters/jsonSchemaToGbnf"
import { freeformRuleset, romanceTemplate, visItinerisRuleset, wherewithalRuleset } from "@serene-pub/core-catalog"

/** 🚧 The romance archetype's ruleset, as a copy of it runs (ties T3). */
const { template: _template, ...romanceDecl } = romanceTemplate.ruleset as unknown as Record<string, unknown>
const romanceRuleset = defineRuleset("test:ruleset/replies-romance@1", romanceDecl as never)

const R = "test:ruleset/replies-unit@1"
const ruleset = defineRuleset(R, {
	name: { en: "Replies" },
	attributes: [
		{ id: "affection", name: { en: "Affection" }, kind: "number", bounds: { min: 0, max: 10 }, prose: "How fond." },
		{ id: "mood", name: { en: "Mood" }, kind: "label", of: ["calm", "giddy"], prose: "How they feel." }
	],
	entryTypes: [{ id: "keepsake", name: { en: "Keepsake" }, prose: "Something kept." }]
})
const scratch = defineRuleset("test:ruleset/replies-scratch@1", { name: { en: "Scratch" } })
/** 🚧 A tie (ties T3): a reply may set a field of a side, under the relational entry type. */
const T = "test:ruleset/replies-ties@1"
const tied = defineRuleset(T, {
	name: { en: "Tied" },
	attributes: [{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { max: 5 }, prose: "Courage held back." }],
	entryTypes: [
		{
			id: "bond",
			name: { en: "Bond" },
			relational: true,
			farEnd: "person",
			prose: "What two people are to each other.",
			fields: {
				affection: { type: "integer", min: 0, max: 10, default: 3, label: { en: "Affection" } },
				standing: { type: "enum", of: ["cold", "wary", "warm", "close"], default: "wary", label: { en: "Standing" } }
			}
		},
		{ id: "keepsake", name: { en: "Keepsake" }, prose: "Something kept." }
	],
	zoneTypes: [{ id: "bonds", name: { en: "Bonds" }, owners: ["cast"], holds: ["bond"], prose: "Each person's own side." }]
})

describe("the reply schema", () => {
	it("is strict, carries the message and the deltas the ruleset's sections allow", () => {
		const s = replySchemaOf(ruleset, [{ key: "character:1", name: "Ann" }]) as any
		expect(s).toMatchObject({ type: "object", required: ["message", "changes"], additionalProperties: false })
		const item = s.properties.changes.items
		expect(item.additionalProperties).toBe(false)
		expect(item.required).toEqual(Object.keys(item.properties))
		expect(item.properties.owner.enum).toEqual(["Ann"])
		// No null, no type unions (G1 ★4): empty text is none, so every backend's grammar compiles it.
		expect(item.properties.attribute).toMatchObject({ type: "string", enum: ["affection", "mood", ""] })
		expect(item.properties.entryType).toMatchObject({ type: "string", enum: ["keepsake", ""] })
		expect(item.properties.value.type).toBe("string")
		expect(item.properties.name.type).toBe("string")
		expect(item.properties.op.enum).toEqual(["add", "set", "remove"])
		expect(item.properties.attribute.description).toContain("affection (number, 0–10): add or set")
		expect(item.properties.attribute.description).toContain("mood (label: calm | giddy): set")
	})
	it("🚧 carries a tie's fields under its entry type: `field`, its own enum with empty text, and `set` (ties T3)", () => {
		const s = replySchemaOf(tied, [{ key: "character:1", name: "Wren" }, { key: "character:2", name: "Mara" }]) as any
		const item = s.properties.changes.items
		expect(item.required).toEqual(Object.keys(item.properties))
		expect(item.properties.field).toMatchObject({ type: "string", enum: ["affection", "standing", ""] })
		expect(item.properties.op.enum).toContain("set")
		expect(item.properties.entryType.description).toContain("bond (Bond; each person's own side, named for whom it is towards — set affection (0–10), standing (cold | wary | warm | close))")
		expect(item.properties.entryType.description).toContain("keepsake (Keepsake)")
		// A ruleset with no tie asks for no `field`: its grammar is as it was.
		expect((replySchemaOf(ruleset, []) as any).properties.changes.items.properties.field).toBeUndefined()
	})
	it("compiles to a llama.cpp grammar (GBNF) for every shipped ruleset that keeps something (G1 ★4)", () => {
		const owners = [{ key: "session:1", name: "The world" }, { key: "character:1", name: "Ann" }]
		for (const r of [ruleset, scratch, tied, romanceRuleset, visItinerisRuleset, wherewithalRuleset, freeformRuleset]) {
			const schema = replySchemaOf(r as never, owners) as JsonSchemaNode
			expect(() => jsonSchemaToGbnf(schema), (r as { id: string }).id).not.toThrow()
			const nulls: string[] = []
			const walk = (n: unknown, at: string): void => {
				if (n === null) nulls.push(at)
				else if (Array.isArray(n)) n.forEach((x, i) => walk(x, `${at}[${i}]`))
				else if (n && typeof n === "object") for (const [k, x] of Object.entries(n)) walk(x, `${at}.${k}`)
			}
			walk(schema, "schema")
			expect(nulls, (r as { id: string }).id).toEqual([])
		}
	})
	it("a ruleset from scratch asks for the message alone (R9)", () => {
		expect(replySchemaOf(scratch, [])).toEqual({
			type: "object",
			properties: { message: { type: "string", description: "The reply, as the story tells it." } },
			required: ["message"],
			additionalProperties: false
		})
	})
})

describe("the message, while the reply streams", () => {
	it("reads the top-level message as far as it has come, escapes decoded", () => {
		expect(messageOfPartial(`{"mess`)).toEqual({ message: "", closed: false })
		expect(messageOfPartial(`{"message": "She smi`)).toEqual({ message: "She smi", closed: false })
		expect(messageOfPartial(`{"changes": [{"message": "no"}], "message": "Hi \\"you\\"\\n", "x": 1}`)).toEqual({ message: 'Hi "you"\n', closed: true })
		// A half-written escape is held back until it completes.
		expect(messageOfPartial(`{"message": "a\\`)).toEqual({ message: "a", closed: false })
		expect(messageOfPartial(`{"message": "caf\\u00e9`)).toEqual({ message: "café", closed: false })
	})
	it("hands the live row only what is new, chunk by chunk; the changes never show", () => {
		const s = new MessageStreamer()
		const whole = `{"message": "Ann laughs. \\"Again?\\"", "changes": [{"owner": "Ann", "attribute": "affection", "op": "add", "value": 1}]}`
		const seen: string[] = []
		for (let i = 0; i < whole.length; i += 7) seen.push(s.push(whole.slice(i, i + 7)))
		expect(seen.join("")).toBe('Ann laughs. "Again?"')
		expect(s.text()).toBe('Ann laughs. "Again?"')
		expect(splitReply(JSON.parse(s.raw())).changes).toHaveLength(1)
	})
})

describe("the changes, as the handler's deltas", () => {
	it("an attribute's by its slot; an entry's as an ask of the carried zone; what names nothing is refused", () => {
		const out = replyChangesAsDeltas(ruleset, [
			// As the grammar answers: empty text is none, an amount is text.
			{ owner: "Ann", changes: "attribute", attribute: "affection", entryType: "", op: "add", value: "2", name: "", reason: "a kind word" },
			{ owner: "Ann", changes: "entry", attribute: "", entryType: "keepsake", op: "add", value: "", name: "A ribbon", reason: "a gift" },
			// A label's words stay words; null (a backend outside the grammar) still reads as none.
			{ owner: "Ann", changes: "attribute", attribute: "mood", entryType: null, op: "set", value: "giddy", name: null, reason: "" },
			{ owner: "Ann", attribute: "charm", op: "add", value: 1 },
			{ op: "add" }
		])
		expect(out.deltas).toEqual([
			{ owner: "Ann", slot: rulesetAttributeSlotId(R, "affection"), op: "add", value: 2, reason: "a kind word" },
			{ owner: "Ann", slot: rulesetAttributeSlotId(R, "mood"), op: "set", value: "giddy" }
		])
		expect(out.zoneOps).toEqual([{ op: "add", owner: "Ann", entry: { name: "A ribbon", entryType: "keepsake" }, zone: "carried", key: "reply" }])
		expect(out.refused.map((r) => r.why)).toEqual([`${R} has no attribute 'charm'`, "a change names its owner and its op"])
	})
	it("🚧 a tie's field set: the side the owner holds, named for whom it is towards — a zone ask `set` (ties T3)", () => {
		const out = replyChangesAsDeltas(tied, [
			{ owner: "Mara", changes: "entry", attribute: "", entryType: "bond", op: "set", field: "affection", value: "9", name: "Wren", reason: "she was moved" },
			{ owner: "Mara", changes: "entry", attribute: "", entryType: "bond", op: "set", field: "standing", value: "close", name: "Wren", reason: "" },
			{ owner: "Mara", changes: "entry", attribute: "", entryType: "bond", op: "set", field: "towards", value: "character:9", name: "Wren", reason: "" },
			{ owner: "Mara", changes: "entry", attribute: "", entryType: "keepsake", op: "set", field: "affection", value: "1", name: "A ribbon", reason: "" },
			{ owner: "Mara", changes: "entry", attribute: "", entryType: "bond", op: "set", field: "affection", value: "", name: "Wren", reason: "" }
		])
		expect(out.zoneOps).toEqual([
			{ op: "set", owner: "Mara", entry: { entryType: "bond", name: "Wren" }, field: "affection", value: 9, key: "reply" },
			{ op: "set", owner: "Mara", entry: { entryType: "bond", name: "Wren" }, field: "standing", value: "close", key: "reply" }
		])
		expect(out.refused.map((r) => r.why)).toEqual([
			`${T}'s 'bond' has no field 'towards' a reply may set`,
			`${T}'s 'keepsake' has no field 'affection' a reply may set`,
			"a tie's affection is set to something"
		])
	})
})
