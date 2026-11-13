import { describe, expect, test } from "vitest"
import {
	SessionZones,
	rovingStep,
	rovingStop,
	switchOn
} from "./sessionZones.svelte"

const base = {
	narrow: false,
	bodyPx: 1400,
	leftPx: 300,
	rightPx: 300,
	gapPx: 16
}

describe("switchOn", () => {
	test("narrow is always on", () => {
		expect(switchOn({ ...base, narrow: true, bodyPx: 0 })).toBe(true)
	})
	test("wide enough is off", () => {
		expect(switchOn(base)).toBe(false)
	})
	test("too narrow is on", () => {
		expect(switchOn({ ...base, bodyPx: 900 })).toBe(true)
	})
	test("unmeasured on a desktop is off", () => {
		expect(switchOn({ ...base, bodyPx: 0 })).toBe(false)
	})
	test("no sides is off on a desktop", () => {
		expect(switchOn({ ...base, bodyPx: 300, leftPx: 0, rightPx: 0 })).toBe(
			false
		)
	})
})

describe("SessionZones", () => {
	const all = ["left", "middle", "right"] as const
	test("on opens at opening", () => {
		const z = new SessionZones()
		z.publish({ switchOn: true, available: all, opening: "middle" })
		expect(z.shown).toBe("middle")
		expect(z.available).toEqual(["left", "middle", "right"])
	})
	test("a choice survives a re-publish", () => {
		const z = new SessionZones()
		z.publish({ switchOn: true, available: all, opening: "middle" })
		z.show("right")
		z.publish({ switchOn: true, available: all, opening: "middle" })
		expect(z.shown).toBe("right")
	})
	test("shown removed from available falls to opening", () => {
		const z = new SessionZones()
		z.publish({ switchOn: true, available: all, opening: "middle" })
		z.show("right")
		z.publish({
			switchOn: true,
			available: ["left", "middle"],
			opening: "middle"
		})
		expect(z.shown).toBe("middle")
	})
	test("opening unavailable falls to the first available", () => {
		const z = new SessionZones()
		z.publish({
			switchOn: true,
			available: ["left", "right"],
			opening: "middle"
		})
		expect(z.shown).toBe("left")
	})
	test("off clears shown", () => {
		const z = new SessionZones()
		z.publish({ switchOn: true, available: all, opening: "middle" })
		z.publish({ switchOn: false, available: all, opening: "middle" })
		expect(z.shown).toBeNull()
		expect(z.switchOn).toBe(false)
	})
	test("show ignored when off or unavailable", () => {
		const z = new SessionZones()
		z.publish({ switchOn: false, available: all, opening: "middle" })
		z.show("left")
		expect(z.shown).toBeNull()
		z.publish({
			switchOn: true,
			available: ["middle", "right"],
			opening: "middle"
		})
		z.show("left")
		expect(z.shown).toBe("middle")
	})
	test("one available zone: the switch is off", () => {
		const z = new SessionZones()
		z.publish({ switchOn: true, available: ["middle"], opening: "middle" })
		expect(z.switchOn).toBe(false)
		expect(z.shown).toBeNull()
	})
	test("reset", () => {
		const z = new SessionZones()
		z.publish({ switchOn: true, available: all, opening: "middle" })
		z.reset()
		expect([z.switchOn, z.available.length, z.shown]).toEqual([
			false,
			0,
			null
		])
	})
})

describe("roving", () => {
	test("rovingStep wraps and jumps", () => {
		expect(rovingStep("ArrowRight", 2, 3)).toBe(0)
		expect(rovingStep("ArrowLeft", 0, 3)).toBe(2)
		expect(rovingStep("ArrowDown", 0, 3)).toBe(1)
		expect(rovingStep("ArrowUp", 1, 3)).toBe(0)
		expect(rovingStep("Home", 2, 3)).toBe(0)
		expect(rovingStep("End", 0, 3)).toBe(2)
		expect(rovingStep("Tab", 0, 3)).toBeNull()
		expect(rovingStep("ArrowRight", 0, 0)).toBeNull()
	})
	test("rovingStop clamps", () => {
		expect(rovingStop(undefined, 3)).toBe(0)
		expect(rovingStop(5, 3)).toBe(2)
		expect(rovingStop(-1, 3)).toBe(0)
		expect(rovingStop(1, 0)).toBe(0)
	})
})
