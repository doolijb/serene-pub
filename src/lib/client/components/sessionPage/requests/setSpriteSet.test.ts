/**
 * `set-sprite-set` is judged against the cast the widget was shown (R77): a
 * member the viewer may not switch is refused in words before anything is
 * sent, and the server's refusal is this request's own rejection — never a
 * page-wide toast.
 */
import { describe, expect, test } from "vitest"
import type { SessionCharacterV1, SessionCharactersV1 } from "@serene-pub/sdk"
import { createPendingAsks } from "./pendingAsks"
import {
	answerSetSpriteSet,
	settleSpriteSetReply,
	spriteSetReplyKey,
	spriteSetWrite,
	type SpriteSetWrite
} from "./setSpriteSet"

const base: SessionCharacterV1 = {
	ref: "character:3",
	characterId: 3,
	isPersona: false,
	mine: false,
	name: "Ada",
	face: null,
	sprite: null,
	spriteSets: ["Casual", "Armor"],
	spriteSet: "Casual",
	canChangeSpriteSet: true
}
const cast = (...members: Partial<SessionCharacterV1>[]): SessionCharactersV1 => ({
	members: members.map((m) => ({ ...base, ...m }) as SessionCharacterV1),
	sceneImages: { left: null, right: null }
})
const shown = cast(
	{},
	{ ref: "character:4", characterId: 4, name: "Bo", canChangeSpriteSet: false },
	{ ref: "character:9", characterId: 9, name: "Wren", isPersona: true, mine: true, canChangeSpriteSet: false }
)

function writer() {
	const writes: unknown[] = []
	const write: SpriteSetWrite = async (ask) => {
		writes.push(ask)
	}
	return { writes, write }
}

describe("answerSetSpriteSet", () => {
	test("writes the switch for the page's own session, and back to the card's own with null", async () => {
		const { writes, write } = writer()
		await answerSetSpriteSet({ characterId: 3, set: "Armor" }, shown, 7, write)
		await answerSetSpriteSet({ characterId: 3, set: null }, shown, 7, write)
		expect(writes).toEqual([
			{ sessionId: 7, characterId: 3, set: "Armor" },
			{ sessionId: 7, characterId: 3, set: null }
		])
	})

	test("refuses, in words, a member the viewer may not switch — before anything is sent", async () => {
		const { writes, write } = writer()
		await expect(answerSetSpriteSet({ characterId: 4, set: "Casual" }, shown, 7, write)).rejects.toThrow(
			"only the session's owner or Bo's owner can change Bo's sprite set"
		)
		await expect(answerSetSpriteSet({ characterId: 9, set: null }, shown, 7, write)).rejects.toThrow(
			/Wren is a persona/
		)
		expect(writes).toEqual([])
	})

	test("refuses a set the card lacks, someone not in the session, and a malformed ask", async () => {
		const { writes, write } = writer()
		await expect(answerSetSpriteSet({ characterId: 3, set: "Gala" }, shown, 7, write)).rejects.toThrow(
			'Ada has no sprite set named "Gala"'
		)
		await expect(answerSetSpriteSet({ characterId: 5, set: null }, shown, 7, write)).rejects.toThrow(
			"that character is not in this session"
		)
		await expect(answerSetSpriteSet({ set: "Armor" }, shown, 7, write)).rejects.toThrow(/needs a characterId/)
		await expect(answerSetSpriteSet({ characterId: 3 }, shown, 7, write)).rejects.toThrow(/or null for the card's own/)
		await expect(answerSetSpriteSet({ characterId: 3, set: "Armor" }, undefined, 7, write)).rejects.toThrow(
			/has not loaded yet/
		)
		expect(writes).toEqual([])
	})

	test("the server's refusal is this request's rejection, through the page's pending asks", async () => {
		const sent: unknown[] = []
		const asks = createPendingAsks<Sockets.Sessions.SetSpriteSet.Params, Sockets.Sessions.SetSpriteSet.Response>({
			emit: (p) => sent.push(p),
			keyOf: spriteSetReplyKey,
			timeout: "no answer"
		})
		const write: SpriteSetWrite = spriteSetWrite(asks)
		const refused = answerSetSpriteSet({ characterId: 3, set: "Armor" }, shown, 7, write)
		await Promise.resolve()
		expect(sent).toEqual([{ sessionId: 7, characterId: 3, set: "Armor" }])
		// Another session's reply for the same character is nobody's here.
		expect(asks.deliver({ sessionId: 8, characterId: 3, set: null, error: "no" })).toBe(false)
		expect(asks.deliver({ sessionId: 7, characterId: 3, set: null, error: "The server says no." })).toBe(true)
		await expect(refused).rejects.toThrow("The server says no.")

		const done = answerSetSpriteSet({ characterId: 3, set: "Armor" }, shown, 7, write)
		await Promise.resolve()
		asks.deliver({ sessionId: 7, characterId: 3, set: "Armor" })
		await expect(done).resolves.toBeUndefined()
	})

	test("the page's listener: a reply a widget waits on is never also a toast; an unasked refusal here is", async () => {
		const asks = createPendingAsks<Sockets.Sessions.SetSpriteSet.Params, Sockets.Sessions.SetSpriteSet.Response>({
			emit: () => {},
			keyOf: spriteSetReplyKey,
			timeout: "no answer"
		})
		const toasts: string[] = []
		const hear = (reply: Sockets.Sessions.SetSpriteSet.Response) =>
			settleSpriteSetReply(reply, asks, 7, (e) => toasts.push(e))

		const refused = answerSetSpriteSet({ characterId: 3, set: "Armor" }, shown, 7, spriteSetWrite(asks))
		await Promise.resolve()
		hear({ sessionId: 7, characterId: 3, set: null, error: "The server says no." })
		await expect(refused).rejects.toThrow("The server says no.")
		expect(toasts).toEqual([])

		// Nobody here asked: this session's refusal is toasted, another's and a success are not.
		hear({ sessionId: 7, characterId: 3, set: null, error: "Not yours." })
		hear({ sessionId: 8, characterId: 3, set: null, error: "Elsewhere." })
		hear({ sessionId: 7, characterId: 3, set: "Armor" })
		expect(toasts).toEqual(["Not yours."])
	})
})
