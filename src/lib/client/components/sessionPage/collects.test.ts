import { describe, expect, it } from "vitest"
import {
	collectedFire,
	collectReady,
	collectsNote,
	draftText,
	holdsOf,
	nextDraftWrite,
	opensModal,
	reachSentence,
	reachText,
	routePress,
	shouldClearDraft,
	type ListedCollects
} from "./collects"

const NUDGE: ListedCollects = { text: { need: "required", label: "Direction the party should feel" } }
const TRAP: ListedCollects = {
	text: { need: "optional", label: "What is the trap?", ifEmpty: "The room decides." }
}
const WHISPER: ListedCollects = {
	recipients: { label: "Who hears it", min: 1 },
	text: { need: "required", label: "What do you whisper?" }
}

describe("R3 · a collecting press opens the modal", () => {
	it("a bare press of a collecting action opens it; a non-collecting one fires", () => {
		expect(opensModal({ collects: NUDGE })).toBe(true)
		expect(opensModal({ collects: TRAP })).toBe(true)
		expect(opensModal({})).toBe(false)
	})

	it("an argument (S2) supplies the text, unless the action also collects recipients", () => {
		expect(opensModal({ collects: NUDGE }, "go north")).toBe(false)
		expect(opensModal({ collects: NUDGE }, "   ")).toBe(true)
		expect(opensModal({ collects: WHISPER }, "hold the line")).toBe(true)
	})

	it("submit is ready once required text is written and recipients are within bounds", () => {
		expect(collectReady(NUDGE, {})).toBe(false)
		expect(collectReady(NUDGE, { text: "  " })).toBe(false)
		expect(collectReady(NUDGE, { text: "north" })).toBe(true)
		expect(collectReady(TRAP, {})).toBe(true)
		expect(collectReady(WHISPER, { text: "hold" })).toBe(false)
		expect(collectReady(WHISPER, { text: "hold", recipients: ["character:1"] })).toBe(true)
		const two: ListedCollects = { recipients: { label: "Who", min: 1, max: 1 } }
		expect(collectReady(two, { recipients: ["character:1", "character:2"] })).toBe(false)
	})

	it("the fire carries trimmed text when there is some, and recipients when collected", () => {
		expect(collectedFire(NUDGE, { text: "  north  " })).toEqual({ text: "north" })
		expect(collectedFire(TRAP, { text: "" })).toEqual({})
		expect(collectedFire(WHISPER, { text: "hold", recipients: ["character:1"] })).toEqual({
			text: "hold",
			recipients: ["character:1"]
		})
	})

	it("the legend note says what the action asks for", () => {
		expect(collectsNote(NUDGE)).toBe("Asks for text")
		expect(collectsNote(TRAP)).toBe("Asks for text, if you have any")
		expect(collectsNote(WHISPER)).toBe("Asks who hears it · Asks for text")
		expect(collectsNote(undefined)).toBeUndefined()
	})
})

describe("D1 · the composer draft a press spent (S2's slash argument)", () => {
	it("a slash query is how the action was named, not text", () => {
		expect(draftText("/nudge")).toBe("")
		expect(draftText("  go north ")).toBe("go north")
		expect(draftText("/nudge north")).toBe("/nudge north")
	})

	it("clears only a draft still holding what was sent", () => {
		const landed = { success: true }
		expect(shouldClearDraft(landed, "go north", " go north ")).toBe(true)
		expect(shouldClearDraft(landed, "go north", "go north, then west")).toBe(false)
		expect(shouldClearDraft(landed, "", "")).toBe(false)
	})

	it("clears a slash command whose argument was sent (S2), the name and all", () => {
		const landed = { success: true }
		expect(shouldClearDraft(landed, "go north", "/nudge go north")).toBe(true)
		expect(shouldClearDraft(landed, "go north", "  /nudge   go north \n")).toBe(true)
		expect(shouldClearDraft(landed, "go north", "/nudge go north, then west")).toBe(false)
		expect(shouldClearDraft({ success: false }, "go north", "/nudge go north")).toBe(false)
	})

	it("clears on a landed or parked run, keeps on an error or a cancel", () => {
		expect(shouldClearDraft({ success: true }, "go north", "go north")).toBe(true)
		expect(shouldClearDraft({ success: false, parked: true }, "go north", "go north")).toBe(true)
		expect(shouldClearDraft({ success: false }, "go north", "go north")).toBe(false)
		expect(shouldClearDraft({}, "go north", "go north")).toBe(false)
	})

	it("numbers each draft write, so the composer takes every one", () => {
		const opened = nextDraftWrite({ content: "", write: 0 }, "go north")
		expect(opened).toEqual({ content: "go north", write: 1 })
		expect(nextDraftWrite(opened, "")).toEqual({ content: "", write: 2 })
	})
})

/**
 * S2 · where a press goes once the page has it: the host's half of a slash
 * argument (`WidgetInvokeArgs.text`). The composer names the action and hands
 * over the argument; the page refuses text to an action that collects none,
 * opens the modal when the press still lacks something, and fires otherwise.
 */
describe("S2 · a press that supplies its text", () => {
	const NUDGE_ACTION = { slash: "nudge", name: "Nudge", collects: NUDGE }
	const WHISPER_ACTION = { slash: "whisper", name: "Whisper", collects: WHISPER }
	const ROOM_ACTION = {
		slash: "room",
		name: "Answer the door",
		collects: { text: { need: "optional", label: "Describe the room" } } as ListedCollects
	}
	const ADVANCE = { slash: "advance", name: "Continue" }
	const NARRATOR = { slash: "narrator", name: "Narrate" }

	it("fires a text-collecting action directly with the argument", () => {
		expect(routePress(NUDGE_ACTION, { text: "the ceiling drips" })).toEqual({
			route: "fire",
			collected: { text: "the ceiling drips" }
		})
	})

	it("/room <text> is the room's description: the answer fires with it (R9's path)", () => {
		expect(routePress(ROOM_ACTION, { text: "A mossy crypt, dripping." })).toEqual({
			route: "fire",
			collected: { text: "A mossy crypt, dripping." }
		})
	})

	it("with no argument, a collecting action opens the modal, empty", () => {
		expect(routePress(NUDGE_ACTION)).toEqual({ route: "modal", initialText: "" })
		expect(routePress(NUDGE_ACTION, { text: "   " })).toEqual({ route: "modal", initialText: "" })
	})

	it("an action that also collects recipients opens the modal, prefilled with the text", () => {
		expect(routePress(WHISPER_ACTION, { text: "hold" })).toEqual({ route: "modal", initialText: "hold" })
	})

	it("refuses an argument to an action that collects no text, and fires nothing", () => {
		expect(routePress(ADVANCE, { text: "x" })).toEqual({
			route: "refuse",
			reason: "/advance takes no text"
		})
	})

	it("refuses /narrator <text>: Narrate takes no text (R8/QA)", () => {
		expect(routePress(NARRATOR, { text: "the rain stops" })).toEqual({
			route: "refuse",
			reason: "/narrator takes no text"
		})
	})

	it("refuses text to an action the page cannot find, by the name it was pressed as", () => {
		expect(routePress(undefined, { text: "x" }, "roll")).toEqual({
			route: "refuse",
			reason: "'roll' takes no text"
		})
	})

	it("a non-collecting action pressed with no text fires as today", () => {
		expect(routePress(ADVANCE)).toEqual({ route: "plain" })
		expect(routePress(undefined)).toEqual({ route: "plain" })
	})
})

describe("R10 · who will and won't hear it", () => {
	const CAST = [
		{ ref: "character:1", name: "Brannoc" },
		{ ref: "character:2", name: "Vell" },
		{ ref: "character:3", name: "Isolde" }
	]
	it("names the picked, the rest and the own voice; the names are the strong runs", () => {
		const runs = reachSentence(CAST, ["character:1", "character:2"], "Castellan")
		expect(reachText(runs)).toBe(
			"Brannoc and Vell will hear this. Isolde will not, and nor will the Castellan."
		)
		expect(runs.filter((r) => r.name).map((r) => r.text)).toEqual(["Brannoc", "Vell", "Isolde"])
		expect(reachText(reachSentence(CAST, [], "Castellan"))).toBe(
			"Pick who hears it. Nobody else will, not even the Castellan."
		)
		expect(reachText(reachSentence(CAST, CAST.map((m) => m.ref)))).toBe(
			"Brannoc, Vell and Isolde will hear this. Nobody else will."
		)
	})

	it("holdsOf reads a member's value of the overwritten slot off the state, by character id", () => {
		const state = { cast: { byId: { "7": { whisper: "hold the line", hp: 3 }, "8": { whisper: "  " } } } }
		expect(holdsOf(state, "whisper", 7)).toBe("hold the line")
		expect(holdsOf(state, "whisper", 8)).toBeUndefined()
		expect(holdsOf(state, "hp", 7)).toBeUndefined()
		expect(holdsOf(state, undefined, 7)).toBeUndefined()
		expect(holdsOf(undefined, "whisper", 7)).toBeUndefined()
	})
})
