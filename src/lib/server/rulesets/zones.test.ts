/**
 * 🚧 Zones (D5): a moment's zone asks planned against the zone types — who
 * may carry one, what it holds, its limit — applied in order; the carried
 * zone of a ruleset before sections read from its list slots in place.
 */
import { describe, expect, it } from "vitest"
import { defineRuleset } from "@serene-pub/sdk"
import { planZoneOps, zoneTypesOf } from "./zones"
import type { EngineInput, OwnerView, ZoneEntry } from "./types"

const R = "test:ruleset/zones-unit@1"
const ruleset = defineRuleset(R, {
	name: { en: "Zones" },
	attributes: [{ id: "grip", name: { en: "Grip" }, kind: "number", prose: "How much they can hold." }],
	entryTypes: [
		{ id: "card", name: { en: "Card" }, prose: "A card." },
		{ id: "memo", name: { en: "Memo" }, prose: "A memo." }
	],
	zoneTypes: [
		{ id: "hand", name: { en: "Hand" }, owners: ["cast"], holds: ["card"], limit: { attribute: "grip" }, visibility: "holder", prose: "Held cards." },
		{ id: "deck", name: { en: "Deck" }, owners: ["world"], holds: ["card"], ordered: true, prose: "The deck." },
		{ id: "inbox", name: { en: "Inbox" }, owners: ["location"], holds: "*", limit: 1, prose: "Mail." }
	]
})

const card = (name: string): ZoneEntry => ({ entryId: null, entryType: "card", name, fields: {} })
const ann = { key: "character:1", name: "Ann", owner: { kind: "session_cast", id: 1 }, stats: [{ slotId: "test.zones-unit:slot/grip@1", selector: "grip", type: "integer", value: 2, label: "Grip" }], repertoires: [], custom: [], bag: {} } as unknown as OwnerView
const world = { key: "world", name: "The world", owner: { kind: "session", id: 5 }, stats: [], repertoires: [], custom: [], bag: {} } as unknown as OwnerView
const office = { key: "location:3", name: "The office", owner: { kind: "session_location", id: 3 }, stats: [], repertoires: [], custom: [], bag: {} } as unknown as OwnerView
const input = (zones: EngineInput["zones"]): EngineInput =>
	({ ruleset, rigour: "mechanics", owners: [ann, world, office], actions: {}, deltas: [], elapsed: 0, ties: [], turn: 0, zones }) as unknown as EngineInput

describe("the zone types a session has", () => {
	it("the ruleset's own, and the host's carried", () => {
		expect(zoneTypesOf(ruleset).map((z) => z.id)).toEqual(["hand", "deck", "inbox", "carried"])
	})
})

describe("planning a moment's asks", () => {
	it("a draw moves from the world's deck to a hand; the limit is the holder's grip", () => {
		const plan = planZoneOps(input({ world: { deck: [card("Ace"), card("Two"), card("Three")] }, "character:1": { hand: [card("King")] } }), [
			{ op: "move", owner: "world", entry: "Ace", zone: "deck", to: "hand", toOwner: "character:1", key: "draw" },
			{ op: "move", owner: "world", entry: "Two", zone: "deck", to: "hand", toOwner: "character:1", key: "draw" }
		])
		expect(plan.writes.map((w) => [w.ownerKey, w.zoneType, w.entries.map((e) => e.name)])).toEqual([
			["world", "deck", ["Two", "Three"]],
			["character:1", "hand", ["King", "Ace"]]
		])
		expect(plan.refused.map((r) => r.why)).toEqual(["Ann's hand holds at most 2"])
		expect(plan.lines.map((l) => l.text)).toEqual(["The world passes Ace to Ann's hand"])
	})
	it("refuses a zone its owner does not carry, an entry it does not hold, a name it does not have", () => {
		const plan = planZoneOps(input({}), [
			{ op: "add", owner: "character:1", zone: "deck", entry: { name: "Joker", entryType: "card" }, key: "x" },
			{ op: "add", owner: "character:1", zone: "hand", entry: { name: "Note", entryType: "memo" }, key: "x" },
			{ op: "remove", owner: "character:1", zone: "hand", entry: "Ghost", key: "x" },
			{ op: "add", owner: "character:1", zone: "nowhere", entry: "x", key: "x" }
		])
		expect(plan.writes).toEqual([])
		expect(plan.refused.map((r) => r.why)).toEqual([
			"Ann carries no deck — it belongs to world",
			"a hand holds card, not memo",
			"Ann's hand holds nothing called \"Ghost\"",
			`${R} declares no zone 'nowhere'`
		])
	})
	it("reveal and hide set the exposed flag; a move leaves it behind; '*' holds any type up to its limit", () => {
		const plan = planZoneOps(input({ "character:1": { hand: [card("Queen")] } }), [
			{ op: "reveal", owner: "character:1", zone: "hand", entry: "Queen", key: "show" },
			{ op: "add", owner: "location:3", zone: "inbox", entry: { name: "Memo 1", entryType: "memo" }, key: "file" },
			{ op: "add", owner: "location:3", zone: "inbox", entry: { name: "Memo 2", entryType: "memo" }, key: "file" }
		])
		expect(plan.writes.find((w) => w.zoneType === "hand")!.entries).toEqual([{ ...card("Queen"), exposed: true }])
		expect(plan.writes.find((w) => w.zoneType === "inbox")!.entries.map((e) => e.name)).toEqual(["Memo 1"])
		expect(plan.refused.map((r) => r.why)).toEqual(["The office's inbox holds at most 1"])
		const moved = planZoneOps(input({ "character:1": { hand: [{ ...card("Queen"), exposed: true }] } }), [
			{ op: "move", owner: "character:1", zone: "hand", entry: "Queen", to: "carried", key: "pocket" }
		])
		expect(moved.writes.find((w) => w.zoneType === "carried")!.entries).toEqual([card("Queen")])
	})
})

describe("the carried zone of a ruleset before sections", () => {
	const legacy = defineRuleset("test:ruleset/zones-legacy@1", {
		name: { en: "Legacy" },
		voice: { prose: "Legacy." },
		stats: [],
		repertoires: [{ id: "gear", label: { en: "Gear" }, prose: "Gear." } as never],
		zoneTypes: [{ id: "shelf", name: { en: "Shelf" }, owners: ["cast"], holds: "*", prose: "A shelf." }]
	} as never)
	it("is its list slots, read in place: a move out is a list removal, a move in a list add", () => {
		const rope = { kind: "inline", name: "Rope", description: "Rope." }
		const bo = {
			...ann,
			key: "character:2",
			name: "Bo",
			repertoires: [{ slotId: "test:slot/gear@1", repertoire: { id: "gear" }, pieces: [{ key: "rope", props: { name: "Rope", description: "Rope." }, count: 1, form: "inline", item: rope }] }]
		} as unknown as OwnerView
		const plan = planZoneOps({ ruleset: legacy, owners: [bo], zones: { "character:2": { shelf: [{ entryId: null, entryType: "gear", name: "Lamp", fields: { description: "A lamp." } }] } } } as never, [
			{ op: "move", owner: "character:2", entry: "Rope", zone: "carried", to: "shelf", key: "store" },
			{ op: "move", owner: "character:2", entry: "Lamp", zone: "shelf", to: "carried", key: "take" }
		])
		expect(plan.changes).toEqual([
			{ owner: { kind: "session_cast", id: 1 }, slotId: "test:slot/gear@1", op: "remove", items: [rope], note: "Rope moved out; Lamp moved in" },
			{ owner: { kind: "session_cast", id: 1 }, slotId: "test:slot/gear@1", op: "add", items: [{ kind: "inline", name: "Lamp", description: "A lamp." }], note: "Rope moved out; Lamp moved in" }
		])
		expect(plan.writes.map((w) => [w.zoneType, w.entries.map((e) => e.name)])).toEqual([["shelf", ["Rope"]]])
	})
})
