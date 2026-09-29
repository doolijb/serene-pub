/**
 * `set-attribute-value` writes at the session layer only, for an owner of
 * this session that carries the slot — and its refusal is the asking
 * widget's own (R77): the write owns its error.
 */
import { describe, expect, test } from "vitest"
import { answerSetAttributeValue, type AttributeWriter } from "./setAttributeValue"

const world = { key: "world", kind: "session" as const, id: 7, label: "World", configs: { "core:slot/weather@1": {} } }
const ada = { key: "ada", kind: "session_cast" as const, id: 3, label: "Ada", configs: { "core:slot/hp@1": { max: 20 } } }

function writer(over: Partial<AttributeWriter> & { fail?: string } = {}) {
	const writes: unknown[][] = []
	const store: AttributeWriter = {
		sessionId: 7,
		loaded: true,
		owners: new Map<string, Sockets.State.StateOwnerRow>([
			[world.key, world],
			[ada.key, ada]
		]),
		set: async (...args) => {
			writes.push(args)
			if (over.fail) throw new Error(over.fail)
		},
		...over
	}
	return { store, writes }
}

describe("answerSetAttributeValue", () => {
	test("writes one owner's value through the store, owning its error", async () => {
		const { store, writes } = writer()
		await answerSetAttributeValue({ owner: { kind: "session_cast", id: 3 }, slotId: "core:slot/hp@1", value: 12 }, store, 7)
		await answerSetAttributeValue({ owner: { kind: "session", id: 7 }, slotId: "core:slot/weather@1", value: null }, store, 7)
		expect(writes).toEqual([
			[{ kind: "session_cast", id: 3 }, "core:slot/hp@1", 12, { ownError: true }],
			[{ kind: "session", id: 7 }, "core:slot/weather@1", null, { ownError: true }]
		])
	})

	test("a place is a session layer too (phase 4): its values are written like the world's", async () => {
		const crypt = { key: "location:crypt", kind: "session_location" as const, id: 41, label: "Crypt", configs: { "core:slot/inventory@1": {} } }
		const { store, writes } = writer({
			owners: new Map<string, Sockets.State.StateOwnerRow>([[crypt.key, crypt]])
		})
		await answerSetAttributeValue(
			{ owner: { kind: "session_location", id: 41 }, slotId: "core:slot/inventory@1", value: ["lantern"] },
			store,
			7
		)
		expect(writes).toEqual([[{ kind: "session_location", id: 41 }, "core:slot/inventory@1", ["lantern"], { ownError: true }]])
	})

	test.each(["card", "cast_member", "lorebook", "location"])("refuses a '%s' owner: the session layers only", async (kind) => {
		const { store, writes } = writer()
		await expect(
			answerSetAttributeValue({ owner: { kind, id: 3 }, slotId: "core:slot/hp@1", value: 1 }, store, 7)
		).rejects.toThrow(/session layer only/)
		expect(writes).toEqual([])
	})

	test("refuses an owner of another session, a slot the owner does not carry, and a value no slot holds", async () => {
		const { store, writes } = writer()
		await expect(
			answerSetAttributeValue({ owner: { kind: "session", id: 8 }, slotId: "core:slot/weather@1", value: "x" }, store, 7)
		).rejects.toThrow("that owner is not in this session")
		await expect(
			answerSetAttributeValue({ owner: { kind: "session", id: 7 }, slotId: "core:slot/hp@1", value: 1 }, store, 7)
		).rejects.toThrow("'core:slot/hp@1' is not a slot World carries")
		await expect(
			answerSetAttributeValue({ owner: { kind: "session", id: 7 }, slotId: "core:slot/weather@1", value: { a: 1 } }, store, 7)
		).rejects.toThrow(/takes a number, text/)
		expect(writes).toEqual([])
	})

	test("a list is written whole — words and lore references — and a list of anything else is refused", async () => {
		const { store, writes } = writer()
		const bag = ["rope", { entryId: 9 }, "lamp"]
		await answerSetAttributeValue({ owner: { kind: "session", id: 7 }, slotId: "core:slot/weather@1", value: bag }, store, 7)
		expect(writes).toEqual([[{ kind: "session", id: 7 }, "core:slot/weather@1", bag, { ownError: true }]])
		await expect(
			answerSetAttributeValue({ owner: { kind: "session", id: 7 }, slotId: "core:slot/weather@1", value: [{ a: 1 }] }, store, 7)
		).rejects.toThrow(/a list of items/)
		await expect(
			answerSetAttributeValue({ owner: { kind: "session", id: 7 }, slotId: "core:slot/weather@1", value: [["nested"]] }, store, 7)
		).rejects.toThrow(/a list of items/)
		expect(writes).toHaveLength(1)
	})

	test("refuses while the store answers for another session, or has not loaded", async () => {
		const params = { owner: { kind: "session", id: 7 }, slotId: "core:slot/weather@1", value: "rain" }
		await expect(answerSetAttributeValue(params, writer({ sessionId: 9 }).store, 7)).rejects.toThrow(/not loaded yet/)
		await expect(answerSetAttributeValue(params, writer({ loaded: false }).store, 7)).rejects.toThrow(/not loaded yet/)
	})

	test("the server's refusal is this request's rejection", async () => {
		const { store } = writer({ fail: "hp does not go above 20" })
		await expect(
			answerSetAttributeValue({ owner: { kind: "session_cast", id: 3 }, slotId: "core:slot/hp@1", value: 99 }, store, 7)
		).rejects.toThrow("hp does not go above 20")
	})
})
