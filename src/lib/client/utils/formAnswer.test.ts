/**
 * The form affordance (plans/30 U5d review, W7) — the client's reading of
 * "the addressee is the audience", branch for branch with the server's
 * resolver, so a person who cannot answer is shown no button.
 */
import { describe, expect, test } from "vitest"
import {
	answeredChoiceLabel,
	answeredOf,
	canAnswerForm,
	channelHeadOf,
	staleOf,
	stalenessHeadOf
} from "./formAnswer"

const owner = { userId: 1, isOwner: true }
const guest = { userId: 2, isOwner: false }
const other = { userId: 3, isOwner: false }

/** Tom (12) is in the cast; Elara (7) is the guest's presence; 99 is nobody's and not seated. */
const session = {
	sessionCharacters: [{ characterId: 12 }],
	sessionPersonas: [{ personaId: 7, persona: { userId: 2 } }]
}

describe("canAnswerForm", () => {
	test("an unaddressed block shows its buttons to anyone — the action's audience decides", () => {
		expect(canAnswerForm(undefined, guest, session)).toBe(true)
		expect(canAnswerForm(null, other, session)).toBe(true)
	})

	test("a form put to a member's presence is theirs alone — not the owner's, not another guest's", () => {
		expect(canAnswerForm("character:7", guest, session)).toBe(true)
		expect(canAnswerForm("character:7", owner, session)).toBe(false)
		expect(canAnswerForm("character:7", other, session)).toBe(false)
	})

	test("a form put to a seated character nobody portrays is the AI's — nobody clicks", () => {
		expect(canAnswerForm("character:12", owner, session)).toBe(false)
		expect(canAnswerForm("character:12", guest, session)).toBe(false)
	})

	test("a form put to nobody here — a removed cast member, a bogus id — is the owner's to answer (W4)", () => {
		expect(canAnswerForm("character:99", owner, session)).toBe(true)
		expect(canAnswerForm("character:99", guest, session)).toBe(false)
		expect(canAnswerForm("character:not-a-row", owner, session)).toBe(true)
		expect(canAnswerForm("character:not-a-row", guest, session)).toBe(false)
	})

	test("an envoy is the AI's; a user, the owner and an admin are who they are; a member is any viewer", () => {
		expect(canAnswerForm("envoy:mascot", owner, session)).toBe(false)
		expect(canAnswerForm("user:2", guest, session)).toBe(true)
		expect(canAnswerForm("user:2", owner, session)).toBe(false)
		expect(canAnswerForm("owner", owner, session)).toBe(true)
		expect(canAnswerForm("owner", guest, session)).toBe(false)
		expect(canAnswerForm("admin", { ...guest, isAdmin: true }, session)).toBe(true)
		expect(canAnswerForm("admin", guest, session)).toBe(false)
		expect(canAnswerForm("participant", other, session)).toBe(true)
		expect(canAnswerForm("run-owner", other, session)).toBe(true)
		expect(canAnswerForm("item", owner, session)).toBe(false)
	})

	test("a viewer nobody knows answers nothing addressed", () => {
		expect(canAnswerForm("owner", { userId: null, isOwner: false }, session)).toBe(false)
		expect(canAnswerForm("character:7", { userId: undefined, isOwner: true }, session)).toBe(false)
	})
})

describe("the answered mark", () => {
	const block = {
		kind: "choices",
		actions: [
			{ choice: "yes", label: "Yes" },
			{ choice: "maybe", label: "Maybe" }
		]
	}

	test("reads the host's stamp and nothing looser", () => {
		expect(answeredOf({ answered: { by: "character:12", at: "2026-09-17T00:00:00Z", choice: "maybe" } })).toEqual({
			by: "character:12",
			at: "2026-09-17T00:00:00Z",
			choice: "maybe"
		})
		expect(answeredOf({ answered: { by: "user:2", at: "now" } })).toEqual({ by: "user:2", at: "now" })
		expect(answeredOf({})).toBeNull()
		expect(answeredOf({ answered: "maybe" })).toBeNull()
		expect(answeredOf({ answered: { by: "user:2" } })).toBeNull()
	})

	test("shows the chosen option's label; a form block shows the fact alone", () => {
		expect(answeredChoiceLabel(block, { by: "character:12", at: "t", choice: "maybe" })).toBe("Maybe")
		expect(answeredChoiceLabel(block, { by: "character:12", at: "t", choice: "gone" })).toBe("gone")
		expect(answeredChoiceLabel({ kind: "form" }, { by: "user:2", at: "t" })).toBeNull()
	})
})

/**
 * Staleness (plans/29 R-15 *Staleness and order*; plans/30 U5f) — the
 * server's rule computed from the list the client holds: the newest message
 * on the block's row's channel vs the `head` the block was issued at.
 */
describe("staleOf", () => {
	const messages = [
		{ id: 40, channel: "main" },
		{ id: 47, channel: "main" },
		{ id: 48, channel: "main:2" },
		{ id: 50, channel: "phone" },
		{ id: 52, channel: null },
		null
	]
	const answered = { by: "character:12", at: "2026-09-17T00:00:00Z" }

	test("the channel head is the newest row on exactly that channel — lane-scoped, a null channel is main", () => {
		expect(channelHeadOf(messages, "main")).toBe(52)
		expect(channelHeadOf(messages, "main:2")).toBe(48)
		expect(channelHeadOf(messages, "phone")).toBe(50)
		expect(channelHeadOf(messages, "radio")).toBeNull()
		expect(channelHeadOf([], "main")).toBeNull()
	})

	test("stale is unanswered, a head, and the channel past it", () => {
		const row = { id: 47, channel: "main" }
		expect(staleOf({ head: 47 }, row, messages)).toBe(true)
		expect(staleOf({ head: 52 }, { id: 52, channel: "main" }, messages)).toBe(false)
		expect(staleOf({ head: 48 }, { id: 48, channel: "main:2" }, messages)).toBe(false)
		// Another lane's line stales nothing here.
		expect(staleOf({ head: 50 }, { id: 50, channel: "phone" }, messages)).toBe(false)
		// Answered beats stale.
		expect(staleOf({ head: 47, answered }, row, messages)).toBe(false)
		// No head (a pre-U5f row), or a malformed one, is never stale.
		expect(staleOf({}, row, messages)).toBe(false)
		expect(staleOf({ head: "47" }, row, messages)).toBe(false)
		expect(staleOf({ head: 0 }, row, messages)).toBe(false)
		// Nothing held on the channel: not stale.
		expect(staleOf({ head: 47 }, { id: 47, channel: "radio" }, messages)).toBe(false)
		expect(staleOf({ head: 47 }, row, [])).toBe(false)
	})

	test("an answer to a form on the row does not move on from the row; any other line does", () => {
		const row = { id: 47, channel: "main" }
		const answered = [
			{ id: 40, channel: "main" },
			{ id: 47, channel: "main" },
			// Tom's and Ann's answers to the two questions on row 47.
			{ id: 48, channel: "main", metadata: { answersForm: { messageId: 47, blockId: "q1" } } },
			{ id: 49, channel: "main", metadata: { answersForm: { messageId: 47, blockId: "q2" } } }
		]
		expect(channelHeadOf(answered, "main")).toBe(49)
		expect(stalenessHeadOf(answered, "main", 47)).toBe(47)
		expect(staleOf({ head: 47 }, row, answered)).toBe(false)
		// An answer to a form on ANOTHER row is an ordinary line here.
		const other = [...answered, { id: 50, channel: "main", metadata: { answersForm: { messageId: 12, blockId: "x" } } }]
		expect(stalenessHeadOf(other, "main", 47)).toBe(50)
		expect(staleOf({ head: 47 }, row, other)).toBe(true)
		// And so is a plain line.
		const moved = [...answered, { id: 51, channel: "main", metadata: {} }]
		expect(stalenessHeadOf(moved, "main", 47)).toBe(51)
		expect(staleOf({ head: 47 }, row, moved)).toBe(true)
	})
})
