/** 🚧 `parseSeatRef` (`sessions/seats.ts`): the three seat-ref forms, parsed locally. */
import { describe, expect, test } from "vitest"
import { parseSeatRef } from "./seats"

describe("parseSeatRef", () => {
	test("the three forms", () => {
		expect(parseSeatRef("character:7")).toEqual({
			form: "character",
			id: 7
		})
		expect(parseSeatRef("seated-member:12")).toEqual({
			form: "seated-member",
			id: 12
		})
		expect(parseSeatRef("player-seat:3")).toEqual({
			form: "player-seat",
			id: 3
		})
	})

	test("surrounding spaces are trimmed", () => {
		expect(parseSeatRef("  character:7 ")).toEqual({
			form: "character",
			id: 7
		})
		expect(parseSeatRef("\tplayer-seat:3\n")).toEqual({
			form: "player-seat",
			id: 3
		})
	})

	test("zero, negative, fractional and signed ids are not ids", () => {
		for (const ref of [
			"character:0",
			"character:-1",
			"character:+1",
			"character:1.5",
			"character:1e3",
			"seated-member:00" // zero in any spelling
		])
			expect(parseSeatRef(ref), ref).toBeNull()
	})

	test("an id beyond the safe integers is not an id", () => {
		expect(parseSeatRef("character:9007199254740993")).toBeNull()
		expect(parseSeatRef("character:9007199254740991")).toEqual({
			form: "character",
			id: 9007199254740991
		})
	})

	test("junk is null", () => {
		for (const ref of [
			"",
			"   ",
			"character",
			"character:",
			"character:abc",
			"character: 7",
			"character:7:8",
			"persona:7",
			"seatedmember:7",
			"seated-member",
			"narrator",
			"player-seat:x",
			"Character:7",
			"user:7"
		])
			expect(parseSeatRef(ref), ref).toBeNull()
	})
})
