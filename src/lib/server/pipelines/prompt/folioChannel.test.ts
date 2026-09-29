/**
 * Per-channel prompt roles (R-C, ruled 2026-09-17) — the partition, as a unit.
 *
 * A channel a genre declared `role: 'folio'` is not a run of turns. Its
 * messages are one text — the manuscript the conversation is about — so they
 * are folded into a single block and placed in front of the conversation,
 * rather than rendered as `Name: …` lines a model reads as dialogue and
 * continues.
 *
 * The load-bearing claim is the **negative** one, and it is asserted first: a
 * genre that declares no channel role produces byte-identical output, because
 * the host puts `channelRole` on a row only when the genre shapes channels at
 * all. Nothing here is conditional on a flag somebody could forget to set;
 * the key is simply absent.
 */

import { describe, expect, it } from "vitest"
import {
	processMessages,
	FOLIO_MESSAGE_ID,
	SEED_MESSAGE_ID
} from "./messages"

// Verity is seated so her line is claimed — a line nobody claims renders under
// the unclaimed name (ruled 2026-09-26), which is not this file's subject.
const cast = {
	sessionCharacters: [{ characterId: 1, character: { id: 1, name: "Verity" } }]
}
const base = { cast, charName: "Verity", personaName: "Reader" }

/** A row as the host's `session_messages` read hands it over. */
const row = (
	id: number,
	role: "user" | "assistant",
	content: string,
	extra: Record<string, unknown> = {}
) => ({ id, role, content, channel: "main", ...extra })

describe("a genre that declares no channel role", () => {
	it("is assembled by exactly the code it always was", () => {
		const out = processMessages({
			...base,
			messages: [
				row(1, "user", "Where are we?"),
				row(2, "assistant", "At the gate.", { characterId: 1 })
			],
			seedName: "Verity"
		})
		expect(out.messages).toEqual([
			{ id: 1, role: "user", name: "Reader", message: "Where are we?" },
			{ id: 2, role: "assistant", name: "Verity", message: "At the gate." },
			{
				id: SEED_MESSAGE_ID,
				role: "assistant",
				name: "Verity",
				message: ""
			}
		])
		expect(out.includedIds).toEqual([1, 2])
	})
})

describe("a channel whose role is folio", () => {
	const manuscript = (id: number, content: string) =>
		row(id, "assistant", content, {
			channel: "manuscript",
			channelRole: "folio"
		})

	it("folds into ONE block, in time order, in front of the conversation", () => {
		const out = processMessages({
			...base,
			messages: [
				manuscript(1, "The gate was old."),
				row(2, "user", "Make it colder.", { channelRole: "conversation" }),
				manuscript(3, "The gate was old, and cold."),
				row(4, "assistant", "Done.", { channelRole: "conversation" })
			],
			seedName: "Verity"
		})
		expect(out.messages.map((m) => m.id)).toEqual([
			FOLIO_MESSAGE_ID,
			2,
			4,
			SEED_MESSAGE_ID
		])
		expect(out.messages[0]).toEqual({
			id: FOLIO_MESSAGE_ID,
			role: "user",
			// Labelled by the channel, never by a speaker: dropping the
			// speakers is what makes it a folio.
			name: "manuscript",
			message: "The gate was old.\n\nThe gate was old, and cold."
		})
	})

	it("counts the rows it folded, one by one — the block is a rendering, not a row", () => {
		const out = processMessages({
			...base,
			messages: [
				manuscript(1, "One."),
				manuscript(3, "Two."),
				row(4, "user", "Go on.", { channelRole: "conversation" })
			],
			seedName: "Verity"
		})
		expect(out.includedIds).toEqual([1, 3, 4])
	})

	it("keeps one block per folio channel when a genre declares two", () => {
		const out = processMessages({
			...base,
			messages: [
				manuscript(1, "The gate."),
				row(2, "assistant", "A note.", {
					channel: "notes",
					channelRole: "folio"
				}),
				manuscript(3, "The gate, again.")
			],
			seed: false
		})
		expect(out.messages.map((m) => m.name)).toEqual([
			"manuscript",
			"notes"
		])
		expect(out.messages[0]!.message).toBe("The gate.\n\nThe gate, again.")
	})

	it("reads a lane as its channel — the slug is the reference", () => {
		const out = processMessages({
			...base,
			messages: [
				row(1, "assistant", "Page one.", {
					channel: "manuscript:2",
					channelRole: "folio"
				})
			],
			seed: false
		})
		expect(out.messages[0]!.name).toBe("manuscript")
	})
})

describe("a channel whose voice is none", () => {
	it("writes no seed row for a turn triggered on it", () => {
		const out = processMessages({
			...base,
			messages: [
				row(1, "user", "Where are we?"),
				row(2, "assistant", "Page one.", {
					channel: "manuscript",
					channelRole: "folio",
					channelVoice: "none"
				})
			],
			seedName: "Verity"
		})
		expect(out.messages.some((m) => m.id === SEED_MESSAGE_ID)).toBe(false)
	})

	it("still writes one when the trigger is on a channel that has a voice", () => {
		const out = processMessages({
			...base,
			messages: [
				row(1, "assistant", "Page one.", {
					channel: "manuscript",
					channelRole: "folio",
					channelVoice: "none"
				}),
				row(2, "user", "Make it colder.", {
					channelRole: "conversation",
					channelVoice: "character"
				})
			],
			seedName: "Verity"
		})
		expect(out.messages.at(-1)!.id).toBe(SEED_MESSAGE_ID)
	})

	it("an explicit seed: false still wins — a step that is asking, not answering", () => {
		const out = processMessages({
			...base,
			messages: [row(1, "user", "Hello.")],
			seed: false
		})
		expect(out.messages.some((m) => m.id === SEED_MESSAGE_ID)).toBe(false)
	})
})
