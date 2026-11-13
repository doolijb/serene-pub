/**
 * 🚧 `seatMemberOf` — the cast-member door asks `lorebooks:memberOfSeat` with
 * the seat's own ref (s27 S3): `character:<card>` on today's data,
 * `seated-member:<id>` / `player-seat:<id>` on member-keyed data, and hears
 * only the reply that echoes that ref.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const handlers = new Map<string, (data: any) => void>()

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => handlers.delete(key)
	}
}))

import { seatMemberOf } from "./seatMemberOf"

beforeEach(() => handlers.clear())

function door() {
	const sent: { event: string; params: any }[] = []
	const socket = {
		emit: (event: string, params: any) => sent.push({ event, params })
	}
	return { sent, socket: socket as never }
}

const reply = (ref: string, member: unknown) => ({ sessionId: 7, ref, member })

describe("seatMemberOf", () => {
	test("asks with the ref it is given and answers the book address", async () => {
		const { sent, socket } = door()
		const pending = seatMemberOf(socket, 7, "character:12")
		expect(sent).toEqual([
			{
				event: "lorebooks:memberOfSeat",
				params: { sessionId: 7, ref: "character:12" }
			}
		])
		handlers.get("lorebooks:memberOfSeat")!(
			reply("character:12", {
				opensInBook: true,
				lorebookId: 4,
				castMemberId: 9
			})
		)
		await expect(pending).resolves.toEqual({ lorebookId: 4, castId: 9 })
	})

	test("member-keyed data: the seat's ref goes out, and another ref's reply is not heard", async () => {
		const { sent, socket } = door()
		const pending = seatMemberOf(socket, 7, "seated-member:31")
		expect(sent[0].params).toEqual({
			sessionId: 7,
			ref: "seated-member:31"
		})
		// Card 31 / member 7's reply is a different person's: not this answer.
		handlers.get("lorebooks:memberOfSeat")!(
			reply("character:31", {
				opensInBook: true,
				lorebookId: 4,
				castMemberId: 7
			})
		)
		handlers.get("lorebooks:memberOfSeat")!(
			reply("seated-member:31", {
				opensInBook: false,
				lorebookId: 4,
				castMemberId: 31
			})
		)
		await expect(pending).resolves.toBe("sheet")
	})

	test("a seat with no member yet answers null; a player seat's ref is sent as is", async () => {
		const { sent, socket } = door()
		const pending = seatMemberOf(socket, 7, "player-seat:4")
		expect(sent[0].params.ref).toBe("player-seat:4")
		handlers.get("lorebooks:memberOfSeat")!(reply("player-seat:4", null))
		await expect(pending).resolves.toBeNull()
	})

	test("no session, nothing asked", async () => {
		const { sent, socket } = door()
		await expect(
			seatMemberOf(socket, null, "character:1")
		).resolves.toBeNull()
		expect(sent).toEqual([])
	})
})
