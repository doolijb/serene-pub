/**
 * `session_state.v1` (R72) off the page's state store: the one resolved read,
 * detached, with nothing the model reads and no write's refusal in it.
 */
import { describe, expect, test } from "vitest"
import { projectSessionState, type SessionStateSource } from "./sessionState"

const slot = {
	slotId: "core:slot/hp@1",
	key: "hp",
	qualifiedKey: "core.hp",
	label: "HP",
	type: "integer" as const,
	appliesTo: ["cast" as const],
	retired: true
}
const owner = { key: "ada", kind: "session_cast" as const, id: 3, label: "Ada", configs: { "core:slot/hp@1": { max: 20 } } }

/**
 * Ada as the resolver's cast index holds her (`stateFor`, resolve.ts): one
 * object under `byId` and under her slug, her identity beside her values.
 */
const ada = { id: 3, key: "ada", name: "Ada", "core.hp": 12, hp: 12 }

const source = (over: Partial<SessionStateSource> = {}): SessionStateSource => ({
	sessionId: 7,
	loaded: true,
	readError: null,
	state: {
		world: { "core.weather": "rain" },
		cast: { byId: { "3": ada }, ada } as never,
		version: 4
	},
	slots: [slot],
	owners: [owner],
	...over
})

describe("projectSessionState", () => {
	test("is the store's one read: resolved values, slots, owners, the version", () => {
		expect(projectSessionState(source(), 7)).toEqual({
			sessionId: 7,
			loaded: true,
			error: null,
			resolved: { world: { "core.weather": "rain" }, cast: { ada: { "core.hp": 12, hp: 12 } }, version: 4 },
			slots: [slot],
			owners: [owner]
		})
	})

	test("is detached — a widget cannot reach into the store's copy", () => {
		const s = source()
		const v = projectSessionState(s, 7)
		v.resolved.cast.ada["core.hp"] = 0
		v.owners[0].configs["core:slot/hp@1"].max = 1
		expect(ada["core.hp"]).toBe(12)
		expect(owner.configs["core:slot/hp@1"].max).toBe(20)
	})

	test("carries a slot field by field — a model-facing descriptor never rides through", () => {
		const leaky = { ...slot, descriptor: "The character's hit points; the MODEL reads this." }
		const v = projectSessionState(source({ slots: [leaky as never] }), 7)
		expect(v.slots[0]).not.toHaveProperty("descriptor")
	})

	test("carries a slot's stat shape and field (phase 2), detached", () => {
		const shaped = {
			...slot,
			retired: undefined,
			type: "list" as const,
			shape: "core:stat-shape/list@1",
			field: { type: "list" as const, item: { type: "string" as const } }
		}
		const v = projectSessionState(source({ slots: [shaped as never] }), 7)
		expect(v.slots[0].shape).toBe("core:stat-shape/list@1")
		expect(v.slots[0].field).toEqual({ type: "list", item: { type: "string" } })
		v.slots[0].field!.type = "text"
		expect(shaped.field.type).toBe("list")
		// A host that predates shapes sends neither, and the section carries neither.
		expect(projectSessionState(source(), 7).slots[0]).not.toHaveProperty("field")
	})

	test("…nor where a per-world deviation carries it, in an owner's slot config", () => {
		const configured = {
			...owner,
			configs: { "core:slot/hp@1": { min: 0, max: 20, descriptor: "MODEL-FACING: how hurt they are, in this world." } }
		}
		const v = projectSessionState(source({ owners: [configured] }), 7)
		expect(v.owners[0].configs["core:slot/hp@1"]).toEqual({ min: 0, max: 20 })
	})

	test("the cast is each member's values by owner key — no `byId`, no identity keys", () => {
		const v = projectSessionState(source(), 7)
		expect(Object.keys(v.resolved.cast)).toEqual(["ada"])
		expect(v.resolved.cast.ada).toEqual({ "core.hp": 12, hp: 12 })
	})

	test("a cast member with no values yet is an empty bag, never absent", () => {
		const v = projectSessionState(
			source({ state: { world: {}, cast: { byId: { "3": { id: 3, key: "ada", name: "Ada" } }, ada: { id: 3, key: "ada", name: "Ada" } } as never } }),
			7
		)
		expect(v.resolved.cast).toEqual({ ada: {} })
	})

	test("says why the last READ failed, and nothing else", () => {
		expect(projectSessionState(source({ readError: "You cannot see this session." }), 7).error).toBe(
			"You cannot see this session."
		)
	})

	test("while the store still answers for another session, it is 'not yet' — never that session's state", () => {
		expect(projectSessionState(source({ sessionId: 9 }), 7)).toEqual({
			sessionId: 7,
			loaded: false,
			error: null,
			resolved: { world: {}, cast: {} },
			slots: [],
			owners: []
		})
	})
	test("a place's values ride under its owner key, out of the locations index by entry id (phase 4)", () => {
		const bag = { id: 41, key: "the_crypt", name: "The Crypt", "core.inventory": ["lantern"], inventory: ["lantern"] }
		const crypt = { key: "location:the_crypt", kind: "session_location" as const, id: 41, label: "The Crypt", configs: {} }
		const inv = { ...slot, retired: undefined, slotId: "core:slot/inventory@1", key: "inventory", qualifiedKey: "core.inventory" }
		const v = projectSessionState(
			source({
				state: { world: {}, cast: { byId: {} } as never, locations: { byId: { "41": bag }, the_crypt: bag } },
				slots: [inv as never],
				owners: [crypt]
			}),
			7
		)
		expect(v.resolved.locations).toEqual({ "location:the_crypt": { "core.inventory": ["lantern"], inventory: ["lantern"] } })
		// No place among the owners: no `locations` key at all, as before phase 4.
		expect(projectSessionState(source(), 7).resolved).not.toHaveProperty("locations")
	})

	test("🚧 a seated member's values are read off its own entry, not a card's that shares its id (s27 S3)", () => {
		// Cast member 7 is Bea; card 7 is Cal. `byId` is member-keyed; the card-keyed entry beside it is a different person.
		const bea = { id: 7, key: "bea", name: "Bea", ref: "seated-member:7", castMemberId: 7, cardId: 31, "core.hp": 5, hp: 5 }
		const cal = { id: 7, key: "cal", name: "Cal", ref: "seated-member:9", castMemberId: 9, cardId: 7, "core.hp": 99, hp: 99 }
		const member = { key: "member:7", kind: "seated_member", id: 7, label: "Bea", configs: {} }
		const v = projectSessionState(
			source({
				state: { world: {}, cast: { byId: { "7": cal, "12": bea } } as never },
				owners: [member as never, owner]
			}),
			7
		)
		expect(v.resolved.cast["member:7"]).toEqual({ "core.hp": 5, hp: 5 })
		// Today's owner: untouched, absent from the index it reads by key.
		expect(v.resolved.cast.ada).toEqual({})
		// A member the index also files under its owner key reads that first.
		const keyed = projectSessionState(
			source({
				state: { world: {}, cast: { byId: { "12": bea }, "member:7": bea } as never },
				owners: [member as never]
			}),
			7
		)
		expect(keyed.resolved.cast["member:7"]).toEqual({ "core.hp": 5, hp: 5 })
	})

	test("member form (the flip): each seat reads its own entry — a seated_member, a carded player seat keyed player_seat:<id>, a K-2 member in both seats with one slug", () => {
		const entry = (over: Record<string, unknown>) => ({ key: "bea", name: "Bea", ...over })
		const charEntry = entry({ id: 7, ref: "seated-member:7", castMemberId: 7, "core.hp": 5, hp: 5 })
		const seatEntry = entry({ id: 4, ref: "player-seat:4", castMemberId: 7, "core.hp": 40, hp: 40 })
		// card 7 is a different person from member 7
		const cardSeven = entry({ id: 7, key: "cal", name: "Cal", ref: "seated-member:9", castMemberId: 9, "core.hp": 99, hp: 99 })
		const rows = [
			{ key: "bea", kind: "seated_member", id: 7, label: "Bea", ref: "seated-member:7", castMemberId: 7, configs: {} },
			{ key: "player_seat:4", kind: "player_seat", id: 4, label: "Bea", ref: "player-seat:4", castMemberId: 7, configs: {} }
		]
		const v = projectSessionState(
			source({
				state: {
					world: {},
					// both seats share the slug "bea"; the slug entry is whichever filled last
					cast: { byId: { "seated_member:9": cardSeven, "seated_member:7": charEntry, "player_seat:4": seatEntry }, bea: seatEntry } as never
				},
				owners: rows as never
			}),
			7
		)
		expect(v.resolved.cast.bea).toEqual({ "core.hp": 5, hp: 5 })
		expect(v.resolved.cast["player_seat:4"]).toEqual({ "core.hp": 40, hp: 40 })
		expect(v.owners.map((o) => o.ref)).toEqual(["seated-member:7", "player-seat:4"])
	})
})
