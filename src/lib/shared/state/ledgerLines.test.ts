/**
 * The ledger: anchored rows read back as what changed on a message.
 *
 * The rows are the truth and the line is a reading of them, so every assertion
 * here is about the reading — which row a change is measured against, and what
 * a change with nothing behind it is allowed to claim.
 */
import { describe, expect, test } from "vitest"
import { ledgerLineTextAs } from "@serene-pub/core-catalog/session-state"
import {
	describeProposal,
	groupLinesByOwner,
	ledgerHeadLines,
	ledgerLines,
	linesByMessage,
	listChangeWords,
	type LedgerRow
} from "./ledgerLines"

const value = (over: Partial<LedgerRow> = {}): LedgerRow => ({
	id: 1,
	kind: "value",
	messageId: 10,
	ownerKey: "verity",
	ownerLabel: "Verity",
	slotId: "core:slot/hp@1",
	slotLabel: "hp",
	value: 14,
	updatedBy: "user",
	...over
})

/** An inventory row (phase 3b: items are the `inventory` stat's values, not edges). */
const item = (over: Partial<LedgerRow> = {}): LedgerRow =>
	value({
		slotId: "core:slot/inventory@1",
		slotLabel: "Inventory",
		value: [{ entryId: 7, name: "rusty key" }],
		...over
	})

describe("value lines", () => {
	test("a change is measured against the row before it", () => {
		const lines = ledgerLines([
			value({ id: 1, messageId: 10, value: 20 }),
			value({ id: 2, messageId: 12, value: 14 })
		])
		expect(lines.map((l) => l.text)).toEqual(["hp → 20", "hp 20 → 14"])
		expect(lines[1]).toMatchObject({ before: 20, after: 14, messageId: 12 })
	})

	test("🚧 a table that keeps no numbers reads a number's move in words (P2-6); lists keep their words", () => {
		const lines = ledgerLines(
			[
				value({ id: 1, messageId: 10, value: 20 }),
				value({ id: 2, messageId: 12, value: 14 }),
				value({ id: 3, messageId: 13, value: 18 }),
				item({ id: 4, messageId: 14 })
			],
			[],
			undefined,
			{ words: true }
		)
		expect(lines.map((l) => l.text)).toEqual(["hp is set", "hp falls", "hp rises", "Inventory → rusty key"])
		expect(lines.map((l) => l.text).join(" ")).not.toMatch(/\d/)
	})

	test("the first change is measured against what the session inherited", () => {
		const lines = ledgerLines(
			[value({ value: 14 })],
			[{ ownerKey: "verity", slotId: "core:slot/hp@1", value: 20 }]
		)
		expect(lines[0].text).toBe("hp 20 → 14")
		expect(lines[0].before).toBe(20)
	})

	test("a baseline for another owner is not this owner's baseline", () => {
		const lines = ledgerLines(
			[value({ value: 14 })],
			[{ ownerKey: "marrow", slotId: "core:slot/hp@1", value: 20 }]
		)
		expect(lines[0].text).toBe("hp → 14")
		expect(lines[0].before).toBeUndefined()
	})

	test("a cleared value says so, with no arrow to nothing (R1-4)", () => {
		const lines = ledgerLines([
			value({ id: 1, value: "wary" }),
			value({ id: 2, messageId: 11, value: null }),
			value({ id: 3, messageId: 12, slotId: "crawl-death-saves", slotLabel: "Death saves", value: "2 passes, 2 failures" }),
			value({ id: 4, messageId: 13, slotId: "crawl-death-saves", slotLabel: "Death saves", value: "" })
		])
		expect(lines[1].text).toBe("hp cleared")
		expect(lines[3].text).toBe("Death saves cleared")
	})

	test("rows written again and again under one message are ONE line, where it stood to where it ended (R1-4)", () => {
		const lines = ledgerLines([
			value({ id: 2, value: 14 }),
			value({ id: 1, value: 18 })
		])
		expect(lines.map((l) => l.text)).toEqual(["hp → 14"])
		// Five casts in one turn: "Spell points 4 → 0", never four lines.
		const points = (id: number, v: number, messageId = 20) =>
			value({ id, messageId, slotId: "spell-points", slotLabel: "Spell points", value: v })
		const cast = ledgerLines([points(1, 4, 19), points(2, 3), points(3, 2), points(4, 1), points(5, 0), points(6, 0)])
		expect(cast.map((l) => l.text)).toEqual(["Spell points → 4", "Spell points 4 → 0"])
		// Another slot between them changes nothing: one line per field per message, where its first stood.
		const apart = ledgerLines([points(1, 4, 19), points(2, 3), value({ id: 3, messageId: 20, value: 9 }), points(4, 2)])
		expect(apart.map((l) => l.text)).toEqual(["Spell points → 4", "Spell points 4 → 2", "hp → 9"])
		// Another message keeps them apart.
		const later = ledgerLines([points(1, 4, 19), points(2, 3), points(3, 2, 21)])
		expect(later.map((l) => l.text)).toEqual(["Spell points → 4", "Spell points 4 → 3", "Spell points 3 → 2"])
	})

	test("death's door in words: fell to nothing and back up on 1, the seat's other changes between (R1-5)", () => {
		const words = [
			{ upTo: 0, label: "At death's door" },
			{ upTo: 0.5, label: "Badly hurt" },
			{ upTo: 1, label: "Unhurt" }
		]
		const health = { type: "number", words } as never
		const slotOf = (id: string) => (id === "core:slot/hp@1" ? health : undefined)
		const rows = [
			value({ id: 1, messageId: 9, slotLabel: "Health", value: 10 }),
			value({ id: 2, slotLabel: "Health", value: 0 }),
			value({ id: 3, slotId: "core:slot/fate@1", slotLabel: "Fate", value: "dying" }),
			value({ id: 4, slotLabel: "Health", value: 1 }),
			value({ id: 5, slotId: "core:slot/fate@1", slotLabel: "Fate", value: "alive" })
		]
		const at = ledgerLines(rows, [], slotOf).filter((l) => l.messageId === 10)
		expect(at.map((l) => l.text)).toEqual(["survives at death's door on 1 health", "Fate → alive"])
		expect(ledgerLines(rows, [], slotOf, { words: true }).filter((l) => l.messageId === 10)[0].text).toBe("survives at death's door")
		// A number with no words for nothing: each step said.
		expect(ledgerLines(rows).filter((l) => l.messageId === 10)[0].text).toBe("Health 10 → 0 → 1")
	})

	test("a new character's health over the declared default reads full — in numbers and in words (R1-4)", () => {
		const rows = [value({ value: 10, slotLabel: "Health", max: 10 })]
		const baselines = [{ ownerKey: "verity", slotId: "core:slot/hp@1", value: 20 }]
		expect(ledgerLines(rows, baselines)[0].text).toBe("Health 10 (full)")
		const words = [
			{ upTo: 0, label: "At death's door" },
			{ upTo: 0.5, label: "Badly hurt" },
			{ upTo: 0.999, label: "Hurt" },
			{ upTo: 1, label: "Unhurt" }
		]
		const slotOf = () => ({ type: "number", words }) as never
		expect(ledgerLines(rows, baselines, slotOf, { words: true })[0].text).toBe("Health Unhurt")
	})
})

describe("inventory lines", () => {
	test("an inventory reads as what moved in it, measured against the one before", () => {
		const lines = ledgerLines([
			item({ id: 1, messageId: 10 }),
			item({ id: 2, messageId: 11, value: [{ entryId: 7, name: "rusty key", count: 3 }] }),
			item({ id: 3, messageId: 12, value: [] })
		])
		expect(lines.map((l) => l.text)).toEqual([
			"Inventory → rusty key",
			"Inventory rusty key ×1 → ×3",
			"Inventory − rusty key ×3"
		])
	})

	// 🚧 DC walk 6: "Weapons Longsword → Longsword, Handaxe" repeated the list.
	test("a list change reads + and −, never the whole list before and after", () => {
		const piece = (pieceId: string, name: string, count?: number) => ({
			kind: "compendium",
			compendiumId: "core:rules/vis-itineris",
			pieceId,
			version: "1.0.0",
			name,
			...(count ? { count } : {})
		})
		const weapons = (id: number, messageId: number, value: unknown) =>
			item({ id, messageId, slotId: "core:slot/crawl-weapons@1", slotLabel: "Weapons", value: value as LedgerRow["value"] })
		const lines = ledgerLines([
			weapons(1, 10, [piece("longsword", "Longsword")]),
			weapons(2, 11, [piece("longsword", "Longsword"), piece("handaxe", "Handaxe")]),
			weapons(3, 12, [piece("handaxe", "Handaxe")]),
			// The same piece, renamed by a later read: nothing moved.
			weapons(4, 13, [piece("handaxe", "Hand axe")]),
			weapons(5, 14, [piece("handaxe", "Handaxe", 2), { kind: "inline", name: "Torch" }])
		])
		expect(lines.map((l) => l.text)).toEqual([
			"Weapons → Longsword",
			"Weapons + Handaxe",
			"Weapons − Longsword",
			"Weapons Handaxe ×1 → ×2, + Torch"
		])
	})

	test("listChangeWords: null when a side is not a list or nothing moved", () => {
		expect(listChangeWords("a" as any, [] as any)).toBeNull()
		expect(listChangeWords([{ kind: "inline", name: "Torch" }] as any, [{ kind: "inline", name: "Torch" }] as any)).toBeNull()
		expect(
			listChangeWords([{ kind: "inline", name: "Torch" }] as any, [{ kind: "inline", name: "Rope" }] as any)
		).toBe("+ Rope, − Torch")
	})

	test("one owner's inventory is never measured against another's", () => {
		const lines = ledgerLines([
			item({ id: 1, messageId: 10 }),
			item({ id: 2, messageId: 11, ownerKey: "marrow", ownerLabel: "Marrow" })
		])
		expect(lines.map((l) => l.text)).toEqual(["Inventory → rusty key", "Inventory → rusty key"])
	})
})

describe("reading a message's ledger", () => {
	test("lines are indexed by the message they are anchored to", () => {
		const byMessage = linesByMessage(
			ledgerLines([
				value({ id: 1, messageId: 10, value: 14 }),
				item({ id: 2, messageId: 10 }),
				value({ id: 3, messageId: 11, value: 12 })
			])
		)
		expect(byMessage.get(10)?.map((l) => l.text)).toEqual([
			"hp → 14",
			"Inventory → rusty key"
		])
		expect(byMessage.get(11)?.map((l) => l.text)).toEqual(["hp 14 → 12"])
	})

	test("a row anchored to no message is in no message's ledger", () => {
		const lines = ledgerLines([value({ messageId: null })])
		expect(lines).toHaveLength(1)
		expect(linesByMessage(lines).size).toBe(0)
	})

	test("a message's lines are grouped under the owner that changed", () => {
		const groups = groupLinesByOwner(
			ledgerLines([
				value({ id: 1, value: 14 }),
				item({ id: 2 }),
				value({
					id: 3,
					ownerKey: "world",
					ownerLabel: "World",
					slotLabel: "weather",
					slotId: "core:slot/weather@1",
					value: "storm"
				})
			])
		)
		expect(groups.map((g) => g.ownerLabel)).toEqual(["Verity", "World"])
		expect(groups[0].lines.map((l) => l.text)).toEqual([
			"hp → 14",
			"Inventory → rusty key"
		])
	})
})

describe("a held change", () => {
	const names = {
		ownerLabel: () => "Verity",
		slotLabel: () => "hp",
		itemName: () => "rusty key"
	}

	test("reads as what it would do, not as what it did", () => {
		expect(
			describeProposal(
				{
					kind: "value",
					payload: {
						owner: { kind: "session_cast", id: 11 },
						slotId: "core:slot/hp@1",
						value: 6
					}
				},
				names
			)
		).toBe("Verity hp → 6")
	})

	test("an item arriving and an item leaving are different sentences", () => {
		const inventory = (op: "add" | "remove", count: number) =>
			describeProposal(
				{
					kind: "value",
					payload: {
						owner: { kind: "session_cast", id: 11 },
						slotId: "core:slot/inventory@1",
						op,
						items: [{ entryId: 7, count }]
					}
				},
				{ ...names, slotLabel: () => "Inventory" }
			)
		expect(inventory("add", 2)).toBe("Verity Inventory +rusty key ×2")
		expect(inventory("remove", 1)).toBe("Verity Inventory -rusty key")
	})

	test("a place moved to reads by its title, never `entry N` (Lair W-GATE D4)", () => {
		const move = (value: unknown, itemName?: (id: number) => string | undefined) =>
			describeProposal(
				{ kind: "value", payload: { slotId: "core:slot/location@1", value } },
				{ slotLabel: () => "Location", itemName }
			)
		// The host named it on the way out…
		expect(move({ entryId: 2, name: "The Guard Room" })).toBe("Location → The Guard Room")
		// …or the surface can: the same names a list item reads by.
		expect(move({ entryId: 2 }, () => "The Guard Room")).toBe("Location → The Guard Room")
		expect(move([{ entryId: 2 }], () => "The Guard Room")).toBe("Location → The Guard Room")
	})

	test("a payload nothing can name still says something true", () => {
		expect(describeProposal({ kind: "value", payload: {} }, {})).toBe(
			"a change this session cannot describe"
		)
	})
})

describe("a held clock move (live scenes ★3)", () => {
	const clock = (by: unknown, unit: unknown) =>
		describeProposal({ kind: "clock", payload: { kind: "clock", by, unit } }, {})

	test("reads as the time that would pass, in the unit the keeper named", () => {
		expect(clock(3, "hours")).toBe("Time passes: 3 hours")
		expect(clock(1, "days")).toBe("Time passes: 1 day")
		expect(clock(1, "minutes")).toBe("Time passes: 1 minute")
	})

	test("a payload that is not a forward step says so rather than drawing a blank", () => {
		expect(clock(-2, "hours")).toBe("a clock move this session cannot describe")
		expect(clock(2, undefined)).toBe("a clock move this session cannot describe")
	})
})

describe("a clock move in the ledger (live scenes §15 G5)", () => {
	const move = (over: Partial<LedgerRow> = {}): LedgerRow => ({
		id: 3,
		kind: "clock",
		messageId: 10,
		ownerKey: "world",
		ownerLabel: "The run",
		updatedBy: "run:abc",
		clock: { by: 3, unit: "hours", cause: "action", fromLabel: "Day 4, 14:00", toLabel: "Day 4, 17:00" },
		...over
	})

	test("says how much time passed, and where the clock went", () => {
		const [line] = ledgerLines([move()])
		expect(line).toMatchObject({ key: "c3", kind: "clock", messageId: 10, ownerKey: "world" })
		expect(line.text).toBe("Time passes: 3 hours (Day 4, 14:00 → Day 4, 17:00)")
		expect(
			ledgerLines([move({ clock: { by: -1, unit: "days", fromLabel: "Day 4", toLabel: "Day 3" } })])[0].text
		).toBe("Time goes back: 1 day (Day 4 → Day 3)")
	})

	test("a skipped move says it is not on the clock, and why", () => {
		const [line] = ledgerLines([move({ clock: { by: 3, unit: "hours", skipped: "This story has no clock yet." } })])
		expect(line.text).toBe("Time passes: 3 hours, not on the clock. This story has no clock yet.")
	})

	test("sits after the message's values, whatever its id, and never feeds a value's trail", () => {
		const lines = ledgerLines([
			move({ id: 1 }),
			value({ id: 9, messageId: 10, ownerKey: "world", slotLabel: "Weather", value: "rain" })
		])
		expect(lines.map((l) => l.kind)).toEqual(["value", "clock"])
		expect(lines[0].text).toBe("Weather → rain")
		expect(groupLinesByOwner(lines)).toHaveLength(1)
	})

	test("🚧 a move made before any line is the ledger head (§15 G13): first, under no message; a value with no anchor is not", () => {
		const lines = ledgerLines([
			move({ id: 5, messageId: 10 }),
			move({ id: 6, messageId: null, clock: { by: 2, unit: "hours", skipped: "No clock." } }),
			value({ id: 9, messageId: null })
		])
		// Sorted before every anchored line: before anything was said.
		expect(lines.map((l) => l.key)).toEqual(["v9", "c6", "c5"])
		expect(ledgerHeadLines(lines).map((l) => l.text)).toEqual([
			"Time passes: 2 hours, not on the clock. No clock."
		])
		expect([...linesByMessage(lines).keys()]).toEqual([10])
	})
})

describe("a story-time slot's change line", () => {
	const clockSlot = { type: "text" as const, field: { type: "string" as const, format: "story-time" } }
	// Each its own message: rows in a row under one message are one line (R1-4).
	const crawlTime = (id: number, at: string): LedgerRow =>
		value({ id, messageId: 10 + id, ownerKey: "world", ownerLabel: "World", slotId: "core:slot/crawl-time@1", slotLabel: "Time", value: at })
	test("is spelled by its shape, never the stored clock", () => {
		const lines = ledgerLines([crawlTime(1, "1-01-01 08:00"), crawlTime(2, "1-01-01 16:30")], [], (id) =>
			id === "core:slot/crawl-time@1" ? (clockSlot as any) : undefined
		)
		expect(lines.map((l) => l.text)).toEqual([
			"Time → Year 1, Mo. 1, Day 1, 08:00",
			"Time Year 1, Mo. 1, Day 1, 08:00 → Year 1, Mo. 1, Day 1, 16:30"
		])
	})
	test("a slot whose shape is unknown reads as before", () => {
		expect(ledgerLines([crawlTime(1, "1-01-01 16:30")])[0].text).toBe("Time → 1-01-01 16:30")
	})
})

describe("🚧 a story-time line carries its parts beside its words (a copy's timeFormat)", () => {
	const clockSlot = { type: "text" as const, field: { type: "string" as const, format: "story-time" } }
	const slotOf = (id: string) => (id === "core:slot/crawl-time@1" ? (clockSlot as any) : undefined)
	// Each its own message: rows in a row under one message are one line (R1-4).
	const crawlTime = (id: number, at: string): LedgerRow =>
		value({ id, messageId: 10 + id, ownerKey: "world", ownerLabel: "World", slotId: "core:slot/crawl-time@1", slotLabel: "Time", value: at })

	test("a story-time stat's line: label and both ends as parts; the words unchanged", () => {
		const lines = ledgerLines([crawlTime(1, "1-01-01 08:00"), crawlTime(2, "1-01-01 08:30")], [], slotOf)
		expect(lines[1].text).toBe("Time Year 1, Mo. 1, Day 1, 08:00 → Year 1, Mo. 1, Day 1, 08:30")
		expect(lines[0].storyTime).toEqual({
			kind: "value",
			label: "Time",
			before: null,
			after: { year: 1, month: 1, day: 1, hour: 8, minute: 0 }
		})
		expect(lines[1].storyTime).toMatchObject({
			kind: "value",
			before: { hour: 8, minute: 0 },
			after: { hour: 8, minute: 30 }
		})
		expect(ledgerLineTextAs(lines[1], "Day {day}, {hh}:{mm}")).toBe("Time Day 1, 08:00 → Day 1, 08:30")
	})

	test("any other line carries none", () => {
		expect(ledgerLines([value()])[0].storyTime).toBeUndefined()
		expect(ledgerLines([crawlTime(1, "1-01-01 08:00")])[0].storyTime).toBeUndefined()
	})

	test("a clock move that landed carries the wire's parts; a skipped one, none", () => {
		const from = { year: 1, month: 1, day: 1, hour: 8, minute: 0 }
		const to = { year: 1, month: 1, day: 1, hour: 8, minute: 30 }
		const row = (clock: LedgerRow["clock"]): LedgerRow => ({
			id: 4,
			kind: "clock",
			messageId: 10,
			ownerKey: "world",
			ownerLabel: "World",
			updatedBy: "run:1",
			clock
		})
		const [line] = ledgerLines([
			row({ by: 30, unit: "minutes", fromLabel: "Year 1, Mo. 1, Day 1, 08:00", toLabel: "Year 1, Mo. 1, Day 1, 08:30", from, to })
		])
		expect(line.storyTime).toEqual({ kind: "clock", head: "Time passes: 30 minutes", from, to })
		expect(ledgerLineTextAs(line, "Day {day}, {hh}:{mm}")).toBe("Time passes: 30 minutes (Day 1, 08:00 → Day 1, 08:30)")
		expect(ledgerLineTextAs(line, "")).toBe(line.text)
		expect(ledgerLines([row({ by: 30, unit: "minutes", skipped: "No clock.", from, to })])[0].storyTime).toBeUndefined()
	})
})

describe("a write that changed nothing", () => {
	const place = (over: Partial<LedgerRow> = {}): LedgerRow =>
		value({ slotId: "core:slot/location@1", slotLabel: "Location", ...over })

	test("a place reference written again reads as nothing; its name never as its id", () => {
		const lines = ledgerLines([
			place({ id: 1, messageId: 10, value: { entryId: 1, name: "The Sunken Gate" } }),
			// The same room, named or not: no `The Sunken Gate → The Sunken Gate`.
			place({ id: 2, messageId: 12, value: { entryId: 1 } }),
			place({ id: 3, messageId: 14, value: { entryId: 2, name: "The Eel Pool" } })
		])
		expect(lines.map((l) => l.text)).toEqual([
			"Location → The Sunken Gate",
			"Location The Sunken Gate → The Eel Pool"
		])
	})

	test("a number written again is not a change either", () => {
		const lines = ledgerLines([value({ id: 1, value: 14 }), value({ id: 2, messageId: 11, value: 14 })])
		expect(lines.map((l) => l.text)).toEqual(["hp → 14"])
	})
})

describe("🚧 a piece changed in place, and a choice by its words (P4-7, 2026-10-18)", () => {
	test("a spell slot spent reads what is left, never − Level 1 + Level 1", () => {
		const before = [{ kind: "inline", name: "Level 1", level: 1, max: 2, used: 0 }]
		const after = [{ kind: "inline", name: "Level 1", level: 1, max: 2, used: 1 }]
		expect(listChangeWords(before as any, after as any)).toBe("Level 1: 2 → 1 left")
		const lines = ledgerLines([
			value({ id: 1, messageId: 10, slotId: "core:slot/crawl-spell-slots@1", slotLabel: "Spell slots", value: before as any }),
			value({ id: 2, messageId: 11, slotId: "core:slot/crawl-spell-slots@1", slotLabel: "Spell slots", value: after as any })
		])
		expect(lines[1]!.text).toBe("Spell slots Level 1: 2 → 1 left")
	})
	test("any other number that moved is named; a piece with nothing numeric moved stays a swap", () => {
		expect(
			listChangeWords([{ kind: "inline", name: "Lamp", uses: 3 }] as any, [{ kind: "inline", name: "Lamp", uses: 2 }] as any)
		).toBe("Lamp: uses 3 → 2")
		expect(
			listChangeWords([{ kind: "inline", name: "Lamp", description: "lit" }] as any, [{ kind: "inline", name: "Lamp", description: "out" }] as any)
		).toBe("+ Lamp, − Lamp")
	})
	test("a labelled choice reads by its label: Fate alive → Taken out", () => {
		const fate = {
			type: "string",
			field: { type: "enum", of: ["alive", "taken-out", "dead"], members: [{ key: "alive", label: "Alive" }, { key: "taken-out", label: "Taken out" }, { key: "dead", label: "Dead" }] }
		}
		const lines = ledgerLines(
			[
				value({ id: 1, messageId: 10, slotId: "core:slot/fate@1", slotLabel: "Fate", value: "alive" }),
				value({ id: 2, messageId: 11, slotId: "core:slot/fate@1", slotLabel: "Fate", value: "taken-out" })
			],
			[],
			() => fate as any
		)
		expect(lines.map((l) => l.text)).toEqual(["Fate → Alive", "Fate Alive → Taken out"])
	})
})

describe("🚧 change lines after walk #2 (PLAN-dc-after-walk2 Q3-1)", () => {
	const slots = (id: number, messageId: number, value: unknown) =>
		({ id, kind: "value", messageId, ownerKey: "player_seat:1", ownerLabel: "Ilse", updatedBy: "run", slotId: "core:slot/crawl-spell-slots@1", slotLabel: "Spell slots", value }) as any

	test("a piece taken out and put back changed under one message is ONE line: 'Level 1: 2 → 1 left'", () => {
		const full = [{ kind: "inline", name: "Level 1", level: 1, max: 2, used: 0 }]
		const out: unknown[] = []
		const spent = [{ kind: "inline", name: "Level 1", level: 1, max: 2, used: 1 }]
		const lines = ledgerLines([slots(1, 10, full), slots(2, 11, out), slots(3, 11, spent)])
		expect(lines.map((l) => l.text)).toEqual(["Spell slots → Level 1", "Spell slots Level 1: 2 → 1 left"])
	})

	test("a way that opens reads 'locked → open', and a place's first list of ways is no change", () => {
		const door = (state: string) => ({ kind: "inline", name: "Door to The Vault", way: "door", state })
		const at = (id: number, messageId: number, value: unknown) =>
			({ id, kind: "value", messageId, ownerKey: "location:the-sunken-gate", ownerLabel: "The Sunken Gate", updatedBy: "run", slotId: "core:slot/crawl-exits@1", slotLabel: "Ways out", value }) as any
		const lines = ledgerLines([at(1, 10, [door("locked")]), at(2, 12, []), at(3, 12, [door("open")])])
		expect(lines.map((l) => l.text)).toEqual(["Ways out Door to The Vault: locked → open"])
	})

	test("a new character's health filled to its maximum reads 'Health 10 (full)', never '20 → 10'", () => {
		const lines = ledgerLines(
			[{ id: 1, kind: "value", messageId: 10, ownerKey: "player_seat:1", ownerLabel: "Ilse", updatedBy: "run", slotId: "core:slot/hp@1", slotLabel: "Health", value: 10, max: 10 } as any],
			[{ ownerKey: "player_seat:1", slotId: "core:slot/hp@1", value: 20 }]
		)
		expect(lines.map((l) => l.text)).toEqual(["Health 10 (full)"])
		// Any later move reads as ever.
		const later = ledgerLines(
			[
				{ id: 1, kind: "value", messageId: 10, ownerKey: "player_seat:1", ownerLabel: "Ilse", updatedBy: "run", slotId: "core:slot/hp@1", slotLabel: "Health", value: 10, max: 10 } as any,
				{ id: 2, kind: "value", messageId: 11, ownerKey: "player_seat:1", ownerLabel: "Ilse", updatedBy: "run", slotId: "core:slot/hp@1", slotLabel: "Health", value: 7, max: 10 } as any
			],
			[{ ownerKey: "player_seat:1", slotId: "core:slot/hp@1", value: 20 }]
		)
		expect(later.map((l) => l.text)).toEqual(["Health 10 (full)", "Health 10 → 7"])
	})
})
