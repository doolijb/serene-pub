/**
 * Which shipped slots are **held connection slots** — measured off the
 * registry, so a contract that declares a new embedding connection arrives
 * here without an edit to the code under test (see `heldSlots.ts`).
 */

import { describe, expect, it } from "vitest"
import "@serene-pub/contracts"
import { allDefinitions, getDefinition, type SlotDecl } from "@serene-pub/sdk"
import { isHeldConnectionSlot } from "./heldSlots"

const held = () =>
	allDefinitions().flatMap((d) =>
		Object.entries((d.slots ?? {}) as Record<string, SlotDecl>)
			.filter(([, decl]) => isHeldConnectionSlot(decl))
			.map(([slot]) => `${d.id} ${slot}`)
	)

describe("held connection slots (owner ruling 2026-10-05, D-c)", () => {
	it("walked a registry that declares connection slots at all", () => {
		const connections = allDefinitions().flatMap((d) =>
			Object.values((d.slots ?? {}) as Record<string, SlotDecl>).filter(
				(decl) => decl.kind === "connection"
			)
		)
		expect(connections.length).toBeGreaterThan(1)
	})

	it("is query-windows' embedding connection, and nothing else core ships", () => {
		expect(held()).toEqual(["core:task/query-windows@1 connection"])
	})

	it("the embed step and the sprite picker declare no connection to hold", () => {
		for (const pin of [
			"core:oracle/embed-text@1",
			"core:oracle/pick-sprite@1"
		])
			expect(
				Object.keys(getDefinition(pin)?.slots ?? {}),
				`${pin} declares a connection slot — a pipeline never chooses its embedding connection`
			).not.toContain("connection")
	})

	it("holds only an embedding connection: a text model's pick stays a pick", () => {
		expect(
			isHeldConnectionSlot({
				kind: "connection",
				requires: ["text->text"]
			} as any)
		).toBe(false)
		expect(isHeldConnectionSlot({ kind: "connection" } as any)).toBe(false)
		expect(
			isHeldConnectionSlot({
				kind: "sampling",
				requires: ["text->embedding"]
			} as any)
		).toBe(false)
		expect(
			isHeldConnectionSlot({
				kind: "connection",
				requires: ["text->embedding"]
			} as any)
		).toBe(true)
	})
})
