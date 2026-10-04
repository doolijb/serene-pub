import { describe, expect, it } from "vitest"
import {
	defaultMarksWithEdits,
	liveModelEdits,
	modelEditCount,
	modelEditPlan,
	modelsWithEdits,
	noModelEdits,
	withDefaultEdit,
	withEnabledEdit,
	withoutSteps
} from "./modelEdits"

const CONN = 7
const nemo = { id: 1, name: "Nemo 12B", model: "nemo.gguf", enabled: true }
const qwen = { id: 2, name: null, model: "qwen3-8b", enabled: false }
const llama = { id: 3, name: "Llama 3", model: "llama3", enabled: null }
const models = [nemo, qwen, llama]
const word = (c: string) => ({ "text->text": "Chat", "text->image": "Image generation" })[c] ?? c
const saved = {
	"text->text": { connectionId: CONN, connectionModelId: 1 },
	"text->image": { connectionId: 99, connectionModelId: 50 }
}

describe("a model lever is a pending change", () => {
	it("hiding records the edit; showing it again drops it", () => {
		let edits = withEnabledEdit(noModelEdits(), nemo, false)
		expect(edits.enabled).toEqual({ 1: false })
		edits = withEnabledEdit(edits, nemo, true)
		expect(edits.enabled).toEqual({})
		expect(modelEditCount(edits)).toBe(0)
	})

	it("absent `enabled` reads as shown", () => {
		expect(withEnabledEdit(noModelEdits(), llama, true).enabled).toEqual({})
		expect(withEnabledEdit(noModelEdits(), llama, false).enabled).toEqual({ 3: false })
	})

	it("Use on the model that is already the default is no edit", () => {
		const edits = withDefaultEdit(noModelEdits(), "text->text", 1, saved, CONN)
		expect(edits.defaults).toEqual({})
		const moved = withDefaultEdit(noModelEdits(), "text->text", 3, saved, CONN)
		expect(moved.defaults).toEqual({ "text->text": 3 })
		// …and pressing Use back on the saved one undoes it.
		expect(withDefaultEdit(moved, "text->text", 1, saved, CONN).defaults).toEqual({})
	})
})

describe("pending means different from saved", () => {
	it("an edit a push caught up with stops counting", () => {
		const edits = withEnabledEdit(noModelEdits(), nemo, false)
		const pushed = [{ ...nemo, enabled: false }, qwen, llama]
		expect(modelEditCount(liveModelEdits(edits, pushed, saved, CONN))).toBe(0)
	})

	it("a model the host stopped listing drops its edits", () => {
		const edits = withDefaultEdit(
			withEnabledEdit(noModelEdits(), qwen, true),
			"text->text",
			2,
			saved,
			CONN
		)
		expect(modelEditCount(liveModelEdits(edits, [nemo, llama], saved, CONN))).toBe(0)
	})

	it("a default another tab already registered stops counting", () => {
		const edits = withDefaultEdit(noModelEdits(), "text->text", 3, saved, CONN)
		const after = { ...saved, "text->text": { connectionId: CONN, connectionModelId: 3 } }
		expect(liveModelEdits(edits, models, after, CONN).defaults).toEqual({})
	})
})

describe("what the table draws", () => {
	it("visibility comes from the draft", () => {
		const edits = withEnabledEdit(noModelEdits(), qwen, true)
		const drawn = modelsWithEdits(models, edits)
		expect(drawn.find((m) => m.id === 2)?.enabled).toBe(true)
		expect(drawn.find((m) => m.id === 1)).toBe(nemo)
	})

	it("a pending Use moves the mark off the model that had it", () => {
		const edits = withDefaultEdit(noModelEdits(), "text->text", 3, saved, CONN)
		expect(defaultMarksWithEdits(saved, noModelEdits(), CONN, word)).toEqual({ 1: ["Chat"] })
		expect(defaultMarksWithEdits(saved, edits, CONN, word)).toEqual({ 3: ["Chat"] })
	})

	it("another connection's default is never marked here, until a Use takes it", () => {
		const edits = withDefaultEdit(noModelEdits(), "text->image", 1, saved, CONN)
		expect(defaultMarksWithEdits(saved, edits, CONN, word)).toEqual({
			1: ["Chat", "Image generation"]
		})
	})
})

describe("what Save sends", () => {
	it("visibility first, then defaults, in the reader's words", () => {
		let edits = withDefaultEdit(noModelEdits(), "text->text", 3, saved, CONN)
		edits = withEnabledEdit(edits, nemo, false)
		const plan = modelEditPlan(edits, models, word)
		expect(plan.map((s) => s.label)).toEqual(["Hide Nemo 12B", "Use Llama 3 for chat"])
		expect(plan[1]).not.toHaveProperty("after")
	})

	it("a Use on a model this Save switches on waits for that write", () => {
		let edits = withEnabledEdit(noModelEdits(), qwen, true)
		edits = withDefaultEdit(edits, "text->text", 2, saved, CONN)
		const plan = modelEditPlan(edits, models, word)
		// A model with no name of its own is called what its row shows: the
		// identifier with the parameter count lifted out (`modelDisplay`).
		expect(plan.map((s) => s.label)).toEqual(["Show qwen3", "Use qwen3 for chat"])
		expect(plan[1]).toMatchObject({ kind: "default", after: ["Show qwen3"] })
	})

	it("what landed leaves the draft; what was refused stays pending", () => {
		let edits = withEnabledEdit(noModelEdits(), nemo, false)
		edits = withDefaultEdit(edits, "text->text", 3, saved, CONN)
		const plan = modelEditPlan(edits, models, word)
		const rest = withoutSteps(edits, plan, ["Hide Nemo 12B"])
		expect(rest).toEqual({ enabled: {}, defaults: { "text->text": 3 } })
	})
})
