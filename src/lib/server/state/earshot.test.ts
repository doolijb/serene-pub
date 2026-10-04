/**
 * `earshotSlots` — which slots a value computed from a holder-only one lands
 * in, and how it is heard there (plan A28). The whisper is core's
 * `core:slot/whisper@1` (`earshot: 'holder'`); every other slot here is
 * everybody's by declaration, and is heard as what it reads.
 */

import { describe, expect, test } from "vitest"
import { defineAttributeSlot, derivations } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { earshotSlots, heardOnly, valueHeard } from "./earshot"

const WHISPER = "core:slot/whisper@1"

let n = 0
/** A fresh everybody-slot on the cast, computed by `props`. */
const slot = (props: Record<string, unknown>): string => {
	const id = `earshot-unit:slot/computed-${++n}@1`
	defineAttributeSlot(id, {
		type: "derived",
		descriptor: "Computed for the earshot test.",
		appliesTo: ["cast"],
		...props
	} as any)
	return id
}

describe("earshotSlots — a value computed from a whisper", () => {
	test("read through its own member is holder-only", () => {
		const dot = slot({ derive: "owner.whisper | upcase" })
		const bracket = slot({ derive: `owner["core_whisper"]` })
		const filter = slot({ derive: `"${WHISPER}" | slot` })
		const named = slot({ config: { derivation: derivations.age.id, from: WHISPER } })
		const { holder, ownerOnly } = earshotSlots()
		for (const id of [WHISPER, dot, bracket, filter, named]) {
			expect(holder.has(id)).toBe(true)
			expect(ownerOnly.has(id)).toBe(false)
		}
	})

	test("read any other way is the session's owner's alone", () => {
		const role = slot({ derive: "who.speaker.whisper" })
		const across = slot({ derive: `state.cast.byId["7"].core_whisper` })
		const quotedKey = slot({ derive: `owner.mood | default: "whisper"` })
		const { holder, ownerOnly } = earshotSlots()
		for (const id of [role, across, quotedKey]) {
			expect(ownerOnly.has(id)).toBe(true)
			expect(holder.has(id)).toBe(false)
		}
	})

	test("follows a derivation that reads a derivation", () => {
		const first = slot({ derive: "owner.whisper" })
		const second = slot({ derive: `owner.${first.replace(/^.*\/|@\d+$/g, "")} | size` })
		const leak = slot({ derive: `who.speaker.${first.replace(/^.*\/|@\d+$/g, "")}` })
		const onward = slot({ derive: `owner.${leak.replace(/^.*\/|@\d+$/g, "")}` })
		const { holder, ownerOnly } = earshotSlots()
		expect(holder.has(second)).toBe(true)
		expect(ownerOnly.has(leak)).toBe(true)
		// Anything computed from an owner-only value is owner-only too.
		expect(ownerOnly.has(onward)).toBe(true)
	})

	test("a longer name that contains the key is not a read of it", () => {
		defineAttributeSlot("earshot-unit:slot/whispers-heard@1", {
			type: "integer",
			descriptor: "How many whispers they have had.",
			appliesTo: ["cast"]
		} as any)
		const plain = slot({ derive: "owner.whispers-heard | plus: 1" })
		const { holder, ownerOnly } = earshotSlots()
		expect(holder.has(plain)).toBe(false)
		expect(ownerOnly.has(plain)).toBe(false)
	})

	test("a rule reading the whisper makes its own slot heard as the whisper is", () => {
		const id = `earshot-unit:slot/stored-${++n}@1`
		defineAttributeSlot(id, {
			type: "text",
			descriptor: "Set by a rule.",
			appliesTo: ["cast"],
			rules: [{ when: "owner.whisper", set: "owner.whisper" }]
		} as any)
		expect(earshotSlots().holder.has(id)).toBe(true)
	})
})

describe("heardOnly — an owner-only value leaves every owner", () => {
	test("the world, the places and every member lose it; the holder keeps their own whisper", () => {
		const rumour = slot({ derive: "who.speaker.whisper" })
		const key = rumour.replace(/^.*\/|@\d+$/g, "")
		const ash = { id: 1, whisper: "east door", [key]: "lamp" }
		const bram = { id: 2, whisper: "lamp", [key]: "lamp" }
		const place = { id: 9, [key]: "lamp" }
		const state = {
			world: { [key]: "lamp", weather: "fog" },
			cast: { byId: { "1": ash, "2": bram }, ash, bram },
			locations: { byId: { "9": place }, "location:gate": place },
			who: { speaker: bram }
		}
		const heard = heardOnly(state, (id) => id === "1")
		expect(JSON.stringify(heard)).not.toContain("lamp")
		expect(heard.cast.ash.whisper).toBe("east door")
		expect(heard.world.weather).toBe("fog")
		// One object per member still, and the state handed in is untouched.
		expect(heard.cast.byId["2"]).toBe(heard.cast.bram)
		expect(heard.who.speaker).toBe(heard.cast.bram)
		expect(state.world[key]).toBe("lamp")
	})

	test("valueHeard withholds an owner-only row from everyone but the owner", () => {
		const rumour = slot({ derive: "who.speaker.whisper" })
		const slots = earshotSlots()
		const row = { owner: { kind: "session_cast" as const, id: 1 }, slotId: rumour }
		expect(valueHeard({ all: false, characterIds: new Set(["1"]) }, slots, row)).toBe(false)
		expect(valueHeard({ all: true }, slots, row)).toBe(true)
	})
})
