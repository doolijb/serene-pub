/**
 * 🚧 `create-message`'s `kind` (2026-10-17): one word stored as
 * `metadata.kind` when the port is wired; nothing when it is not; a refusal
 * (the row unwritten) for anything that is not one word.
 */
import { describe, expect, test } from "vitest"
import { messageKindOf } from "./messageKind"
import { readsOf } from "@serene-pub/sdk"
import { coreBindings } from "./bindings"

describe("messageKindOf", () => {
	test("one word is the kind, lower-cased", () => {
		expect(messageKindOf("did")).toBe("did")
		expect(messageKindOf(" Found ")).toBe("found")
		expect(messageKindOf("side-quest")).toBe("side-quest")
	})
	test("unwired or blank writes no kind", () => {
		expect(messageKindOf(undefined)).toBeNull()
		expect(messageKindOf(null)).toBeNull()
		expect(messageKindOf("   ")).toBeNull()
	})
	test("anything but one word is refused, in words", () => {
		for (const bad of ["two words", "did!", 7, { kind: "did" }, "x".repeat(40)])
			expect(messageKindOf(bad)).toMatchObject({ refused: expect.stringMatching(/one word/) })
	})
})

describe("the bindings read the new ports", () => {
	test("create-message declares `kind`; ruleset-resolve declares `viewer`", () => {
		const bindings = coreBindings()
		expect(readsOf(bindings["core:outlet/create-message@1"]!)?.ports).toContain("kind")
		expect(readsOf(bindings["core:task/ruleset-resolve@1"]!)?.ports).toContain("viewer")
	})
})
