import { describe, expect, test } from "vitest"
import {
	blankSlotForm,
	cardStatChanges,
	cardStatGroups,
	limitKeys,
	sheetsMoved,
	sheetSlotLabels,
	slotPropsFrom
} from "./cardStats"

const NERVE = "u:slot/nerve@1"
const MOOD = "u:slot/mood@1"
const SCARS = "u:slot/scars@1"
const GRIT = "u:sheet/grit@1"

const slot = (slotId: string, label: string, type: any, sheetId?: string): Sockets.State.SlotDescriptor => ({
	slotId,
	key: label.toLowerCase(),
	qualifiedKey: slotId,
	label,
	type,
	appliesTo: ["cast"],
	...(sheetId ? { sheetId } : {})
})

const read: Sockets.CardState.Get.Response = {
	characterId: 7,
	sheets: [GRIT],
	vocabulary: [slot(NERVE, "Nerve", "integer", GRIT), slot(MOOD, "Mood", "enum", GRIT), slot(SCARS, "Scars", "list")],
	values: { [NERVE]: 4 },
	configs: { [NERVE]: { min: 0, max: 10 }, [MOOD]: { of: ["calm", "wary"] }, [SCARS]: {} },
	ownConfigs: { [NERVE]: { max: 10 } },
	defaults: { [MOOD]: "calm" },
	available: {
		sheets: [
			{ id: GRIT, label: "Grit", origin: "stored", retired: false, slotIds: [NERVE, MOOD], editable: true }
		],
		slots: [
			{ id: NERVE, label: "Nerve", type: "integer", origin: "stored", retired: false, appliesTo: ["cast"], editable: true },
			{ id: MOOD, label: "Mood", type: "enum", origin: "stored", retired: false, appliesTo: ["cast"], editable: true }
		]
	}
}

describe("card stats", () => {
	test("groups under the sheet that named them, loose last", () => {
		const groups = cardStatGroups(read)
		expect(groups.map((g) => [g.sheetId, g.label, g.rows.map((r) => r.slot.slotId)])).toEqual([
			[GRIT, "Grit", [NERVE, MOOD]],
			[null, "This character's own", [SCARS]]
		])
		const [nerve, mood] = groups[0].rows
		expect(nerve).toMatchObject({ kind: "number", value: 4, ownConfig: { max: 10 }, writable: true })
		expect(mood).toMatchObject({ kind: "choice", value: undefined, fallback: "calm" })
		expect(groups[1].rows[0].kind).toBe("list")
	})

	test("limit fields by kind", () => {
		expect(limitKeys("number")).toEqual(["min", "max"])
		expect(limitKeys("list")).toEqual(["maxItems", "maxLength"])
		expect(limitKeys("choice")).toEqual([])
	})

	test("one change set: limits and values per slot, a reset is null", () => {
		expect(
			cardStatChanges({ [NERVE]: 6, [MOOD]: null }, { [NERVE]: { max: 8, min: "" }, [SCARS]: null })
		).toEqual([
			{ slotId: NERVE, config: { max: 8 }, value: 6 },
			{ slotId: SCARS, config: null },
			{ slotId: MOOD, value: null }
		])
		expect(cardStatChanges({}, { [NERVE]: {} })).toEqual([{ slotId: NERVE, config: null }])
	})

	test("sheet order and labels", () => {
		expect(sheetsMoved(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"])
		expect(sheetsMoved(["a", "b"], 0, -1)).toEqual(["a", "b"])
		expect(sheetSlotLabels(read.available.sheets[0], read)).toBe("Nerve, Mood")
	})

	test("a new slot's declaration, or why not", () => {
		const f = { ...blankSlotForm(), label: "Nerve", descriptor: "How steady.", min: 0, max: 10, defaultText: "5" }
		expect(slotPropsFrom(f)).toEqual({
			props: {
				type: "integer",
				label: "Nerve",
				descriptor: "How steady.",
				appliesTo: ["cast"],
				config: { min: 0, max: 10 },
				default: 5
			},
			refusal: null
		})
		expect(slotPropsFrom({ ...f, descriptor: " " }).refusal).toMatch(/descriptor is required/)
		expect(slotPropsFrom({ ...f, min: 11 }).refusal).toMatch(/above the highest/)
		const choice = { ...blankSlotForm(), label: "Mood", descriptor: "d", type: "enum" as const, values: "calm, wary", defaultText: "angry" }
		expect(slotPropsFrom(choice).refusal).toMatch(/one of: calm, wary/)
		const list = { ...blankSlotForm(), label: "Scars", descriptor: "d", type: "list" as const, unique: false, defaultText: "a, b" }
		expect(slotPropsFrom(list).props).toMatchObject({ config: { unique: false }, default: ["a", "b"] })
	})
})
