import { describe, expect, it } from "vitest"
import { useInGroups, useInSentence, useInState } from "./useInMenu"

function loadout(over: Partial<Sockets.Loadouts.Summary> & { id: number }) {
	return {
		name: `Loadout ${over.id}`,
		transform: "text->text",
		defaultFor: null,
		filled: false,
		fallbackName: "Reply",
		connectionId: null,
		connectionModelId: null,
		connectionName: null,
		modelName: null,
		mergedInto: null,
		...over
	}
}

const reply = loadout({
	id: 1,
	name: "Reply",
	defaultFor: "text->text",
	filled: true,
	connectionId: 5,
	connectionModelId: 50,
	connectionName: "Work key",
	modelName: "Mistral Small",
	fallbackName: null
})
const tools = loadout({ id: 2, name: "Tool calling" })
const extraction = loadout({
	id: 3,
	name: "Extraction",
	filled: true,
	connectionId: 7,
	connectionModelId: 70,
	connectionName: "Home",
	modelName: "Qwen"
})
const merged = loadout({ id: 4, name: "Merged one", mergedInto: 1 })
const images = loadout({
	id: 5,
	name: "Images",
	transform: "text->image",
	defaultFor: "text->image"
})
const transforms = [
	{ id: "text->image", label: "Images" },
	{ id: "text->text", label: "Reply" }
]

describe("useInGroups", () => {
	it("lists the default first, then the rest by name; merged ones left out", () => {
		const groups = useInGroups(
			{ connectionId: 9, modelId: 90, capabilities: ["text->text"] },
			[tools, merged, extraction, reply],
			transforms
		)
		expect(groups).toHaveLength(1)
		expect(groups[0].label).toBe("Reply")
		expect(groups[0].items.map((i) => i.name)).toEqual([
			"Reply",
			"Extraction",
			"Tool calling"
		])
		expect(groups[0].items[0].isDefault).toBe(true)
		expect(groups[0].items.slice(1).every((i) => !i.isDefault)).toBe(true)
	})

	it("only the jobs the model can do, chat first", () => {
		const groups = useInGroups(
			{
				connectionId: 9,
				modelId: 90,
				capabilities: ["text->image", "text->text"]
			},
			[images, reply],
			transforms
		)
		expect(groups.map((g) => g.transform)).toEqual([
			"text->text",
			"text->image"
		])
		expect(
			useInGroups(
				{ connectionId: 9, modelId: 90, capabilities: ["text->image"] },
				[reply, tools],
				transforms
			)
		).toEqual([])
	})

	it("marks the loadouts already running this model", () => {
		const [group] = useInGroups(
			{ connectionId: 5, modelId: 50, capabilities: ["text->text"] },
			[reply, tools],
			transforms
		)
		expect(group.items[0]).toMatchObject({
			current: true,
			state: "Runs this model"
		})
		expect(group.items[1].current).toBe(false)
	})
})

describe("useInState", () => {
	const elsewhere = { connectionId: 1, modelId: 1 }
	it("says the pair a filled loadout runs", () => {
		expect(useInState(extraction, elsewhere)).toBe("Qwen · Home")
	})
	it("says what an unfilled loadout falls back to", () => {
		expect(useInState(tools, elsewhere)).toBe(
			"Unfilled — falls back to Reply"
		)
	})
	it("an unfilled default falls back to nothing", () => {
		expect(useInState(images, elsewhere)).toBe("Unfilled")
	})
})

it("announces the pick", () => {
	expect(useInSentence("Qwen", "Tool calling")).toBe(
		"Qwen now runs Tool calling"
	)
})
