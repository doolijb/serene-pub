import { describe, expect, it } from "vitest"
import {
	collectedFire,
	collectReady,
	collectsNote,
	createNarrations,
	draftText,
	holdsOf,
	landNarration,
	narrateDirectly,
	nextDraftWrite,
	opensModal,
	reachSentence,
	reachText,
	routePress,
	draftHolds,
	draftToGiveBack,
	type ListedCollects,
	type NarrationPress,
	type NarratorRequest
} from "./collects"
import { NARRATE_ACTION, NARRATE_CHARACTER_ACTION } from "$lib/shared/actions/identity"

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

	it("a press spends only a draft holding what it sent", () => {
		expect(draftHolds("go north", " go north ")).toBe(true)
		expect(draftHolds("go north", "go north, then west")).toBe(false)
		expect(draftHolds("", "")).toBe(false)
	})

	it("a slash command whose argument was sent (S2) is spent, the name and all", () => {
		expect(draftHolds("go north", "/nudge go north")).toBe(true)
		expect(draftHolds("go north", "  /nudge   go north \n")).toBe(true)
		expect(draftHolds("go north", "/nudge go north, then west")).toBe(false)
	})

	// Note 31 (2026-10-02): the draft leaves at the press; the answer only
	// ever gives it back.
	it("a landed or parked run keeps it spent; a refusal, error or cancel gives it back", () => {
		expect(draftToGiveBack({ success: true }, "/nudge go north", "")).toBeNull()
		expect(draftToGiveBack({ success: false, parked: true }, "/nudge go north", "")).toBeNull()
		expect(draftToGiveBack({ success: false }, "/nudge go north", "")).toBe("/nudge go north")
		expect(draftToGiveBack({}, "/nudge go north", "  ")).toBe("/nudge go north")
	})

	it("never over what the person has typed since", () => {
		expect(draftToGiveBack({ success: false }, "/nudge go north", "and then")).toBeNull()
		expect(draftToGiveBack({ success: false }, "", "")).toBeNull()
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

/**
 * Chat's Narrate collects what should happen next (genre uplift C2,
 * 2026-09-29). Its press still opens the narrator modal, whose first step is
 * who speaks; a slash argument has already said it — the narrator — so
 * `/narrate the storm breaks` fires the narration directly with it.
 */
describe("C2 · /narrate <text> fires the narration directly", () => {
	const NARRATE_COLLECTS: ListedCollects = {
		text: {
			need: "optional",
			label: "What should happen next?",
			placeholder: "The storm breaks over the harbour.",
			ifEmpty: "The narrator decides."
		}
	}
	const NARRATE = { slash: "narrate", name: "Narrate", collects: NARRATE_COLLECTS }
	const SIDE = { slash: "narrate-character", name: "Side character" }

	it("with an argument: the press fires, and the argument is the direction", () => {
		const route = routePress(NARRATE, { text: "  the storm breaks  " })
		expect(route).toEqual({ route: "fire", collected: { text: "the storm breaks" } })
		expect(narrateDirectly(NARRATE_ACTION, route)).toBe("the storm breaks")
	})

	it("with none: the narrator modal opens, as the chip's press does", () => {
		expect(narrateDirectly(NARRATE_ACTION, routePress(NARRATE))).toBeNull()
		expect(narrateDirectly(NARRATE_ACTION, routePress(NARRATE, { text: "   " }))).toBeNull()
	})

	it("only Narrate: a side character still needs the modal to say who speaks", () => {
		// It collects no text, so its argument is refused before any divert.
		expect(routePress(SIDE, { text: "x" })).toEqual({
			route: "refuse",
			reason: "/narrate-character takes no text"
		})
		const fire = { route: "fire", collected: { text: "x" } } as const
		expect(narrateDirectly(NARRATE_CHARACTER_ACTION, fire)).toBeNull()
		expect(narrateDirectly(null, fire)).toBeNull()
	})

	it("the legend says it asks for text, if you have any", () => {
		expect(collectsNote(NARRATE_COLLECTS)).toBe("Asks for text, if you have any")
	})
})

/**
 * Each narration's answer matched to its press (C2 follow-up, 2026-09-29):
 * the server answers every press once, a refusal before the run included,
 * in the order pressed.
 */
describe("C2 · a narration's answer gives back or keeps what its press carried", () => {
	const request = { instructions: "The storm breaks.", speaker: { characterId: null, name: "The innkeeper" } }
	const S = 7
	const DRAFT = "/narrate the storm breaks"

	it("a draft press spent its draft when it fired: a run that ran keeps it spent; refused, it comes back", () => {
		const ran: NarrationPress[] = [{ sessionId: S, from: "draft", draft: DRAFT }]
		expect(landNarration(ran, { sessionId: S, success: true }, "")).toEqual({})
		expect(ran).toEqual([])
		const refused: NarrationPress[] = [{ sessionId: S, from: "draft", draft: DRAFT }]
		expect(landNarration(refused, { sessionId: S, success: false }, "")).toEqual({ giveBack: DRAFT })
		expect(refused).toEqual([])
		// Typed on since: the new line stays.
		expect(
			landNarration([{ sessionId: S, from: "draft", draft: DRAFT }], { sessionId: S, success: false }, "and then")
		).toEqual({})
	})

	it("a modal press that did not run keeps what the modal held; one that ran keeps nothing", () => {
		expect(landNarration([{ sessionId: S, from: "modal", request }], { sessionId: S, success: false }, "")).toEqual({
			unlandedPress: request
		})
		expect(landNarration([{ sessionId: S, from: "modal", request }], { sessionId: S, success: true }, "")).toEqual({})
	})

	it("answers are matched oldest first, so a modal narration's answer never touches an earlier draft's", () => {
		const pending: NarrationPress[] = [
			{ sessionId: S, from: "draft", draft: DRAFT },
			{ sessionId: S, from: "modal", request }
		]
		// The draft press was refused (over the cap); the modal's then ran.
		expect(landNarration(pending, { sessionId: S, success: false }, "")).toEqual({ giveBack: DRAFT })
		expect(landNarration(pending, { sessionId: S, success: true }, DRAFT)).toEqual({})
		expect(pending).toEqual([])
	})

	it("an answer is matched on its own session: a press left behind on another session is not this one", () => {
		const pending: NarrationPress[] = [
			{ sessionId: 3, from: "draft", draft: DRAFT },
			{ sessionId: S, from: "draft", draft: "/narrate the tide turns" }
		]
		expect(landNarration(pending, { sessionId: S, success: false }, "")).toEqual({ giveBack: "/narrate the tide turns" })
		expect(pending).toEqual([{ sessionId: 3, from: "draft", draft: DRAFT }])
	})

	it("an invoke's text was never the draft; an answer with nothing pending does nothing", () => {
		expect(landNarration([{ sessionId: S, from: "invoke" }], { sessionId: S, success: false }, "")).toEqual({})
		expect(landNarration([], { sessionId: S, success: false }, "")).toEqual({})
	})
})

/**
 * The page's narrations as `+page.svelte` wires them (C2 follow-up,
 * 2026-09-29): the bodies its two `useInterest` handlers and its two presses
 * run, over a page that is only its state.
 */
describe("C2 · createNarrations — the page's presses and answers", () => {
	const request = { instructions: "The storm breaks.", speaker: { characterId: 11, name: null } }

	function page(draft = "") {
		const state = {
			sessionId: 7,
			draft,
			unlanded: null as NarratorRequest | null,
			sent: [] as unknown[],
			said: [] as string[]
		}
		const narrations = createNarrations({
			sessionId: () => state.sessionId,
			draft: () => state.draft,
			writeDraft: (content) => (state.draft = content),
			keepUnlanded: (press) => (state.unlanded = press),
			say: (error) => state.said.push(error),
			send: (params) => state.sent.push(params)
		})
		return { state, narrations }
	}

	it("a modal press is sent as the modal held it, and an unlanded answer keeps it for the next opening", () => {
		const { state, narrations } = page()
		narrations.modal(request)
		expect(state.sent).toEqual([{ sessionId: 7, instructions: "The storm breaks.", speaker: request.speaker }])
		narrations.answered({ sessionId: 7, success: false })
		expect(state.unlanded).toEqual(request)
		expect(narrations.pending).toEqual([])
		// The next press is pending, so no longer unlanded; it lands.
		narrations.modal({ instructions: "" })
		expect(state.unlanded).toBeNull()
		expect(state.sent.at(-1)).toEqual({ sessionId: 7, instructions: undefined })
		narrations.answered({ sessionId: 7, success: true })
		expect(state.unlanded).toBeNull()
	})

	it("an answer for the session left behind is dequeued and does nothing to the page now showing another", () => {
		const { state, narrations } = page("/narrate the tide turns")
		narrations.modal(request)
		narrations.directed("the tide turns", true)
		expect(state.draft).toBe("")
		state.sessionId = 8
		narrations.answered({ sessionId: 7, success: false })
		narrations.answered({ sessionId: 7, success: false })
		expect(narrations.pending).toEqual([])
		expect(state.unlanded).toBeNull()
		// Session 8's composer is not given session 7's line.
		expect(state.draft).toBe("")
	})

	// Note 31 (2026-10-02): the draft leaves the composer at the press, not
	// when the run lands; a refusal gives it back.
	it("a draft press spends the draft at once; a landed answer leaves it spent", () => {
		const { state, narrations } = page("/narrate the storm breaks")
		narrations.directed("the storm breaks", true)
		expect(state.sent).toEqual([{ sessionId: 7, instructions: "the storm breaks" }])
		expect(state.draft).toBe("")
		narrations.answered({ sessionId: 7, success: true })
		expect(state.draft).toBe("")
	})

	it("a refused draft press gives the draft back, unless the person has typed since", () => {
		const { state, narrations } = page("/narrate the storm breaks")
		narrations.directed("the storm breaks", true)
		narrations.answered({ sessionId: 7, success: false })
		expect(state.draft).toBe("/narrate the storm breaks")
		narrations.directed("the storm breaks", true)
		state.draft = "Wait"
		narrations.answered({ sessionId: 7, success: false })
		expect(state.draft).toBe("Wait")
	})

	it("an invoke's text never was the draft: nothing spent, nothing given back", () => {
		const { state, narrations } = page("the storm breaks")
		narrations.directed("the storm breaks", false)
		expect(state.draft).toBe("the storm breaks")
		narrations.answered({ sessionId: 7, success: false })
		expect(state.draft).toBe("the storm breaks")
	})

	it("why a narration did not land is said on its own session's page, and a generic fallback anywhere", () => {
		const { state, narrations } = page()
		narrations.error({ sessionId: 8, error: "not this page's" })
		narrations.error({ sessionId: 7, error: "A response is already generating in this session." })
		narrations.error({ error: "Failed to fire the Narrator response." })
		expect(state.said).toEqual([
			"A response is already generating in this session.",
			"Failed to fire the Narrator response."
		])
	})
})
