/**
 * The boot gate over core's own bindings (ruling 2026-09-10).
 *
 * ⚠ The green tick here is worth exactly what `checkCoreBindings`'s own header
 * says it is, and no more. The compile-time derivation is what stops a core
 * handler reading an undeclared name; this catches the three failures a
 * compiler structurally cannot see, and the first of them is the one with
 * teeth: **a binding key is a string literal nothing checks**, because
 * `bindings.ts` imports the contracts with `import type` on purpose.
 */

import { describe, it, expect } from "vitest"
import "@serene-pub/contracts"
import "@serene-pub/core-catalog"
import { getDefinition, describeTaskDefinition, S } from "@serene-pub/sdk"
import {
	assertCoreBindingsCompatible,
	assertCoreDefinitionsBound,
	checkCoreBindings,
	checkUnboundDefinitions
} from "./bindingCompat"
import {
	boundTypeIds,
	SHARED_CORE_HANDLERS
} from "$lib/server/pipelines/runtime/bindings"
import {
	requiresOf,
	structuralCompat
} from "$lib/server/pipelines/runtime/structuralCompat"

describe("core bindings fit the types this build declares", () => {
	it("finds nothing, and does not refuse the boot", () => {
		// Printed rather than counted, so a failure names what broke instead of
		// saying a number moved.
		expect(checkCoreBindings()).toEqual([])
		expect(() => assertCoreBindingsCompatible()).not.toThrow()
	})

	it("asked something — a walk that visited nothing would also be green", () => {
		// The guard this file would be worthless without. An empty binding
		// table, a contracts import dropped, a `getDefinition` answering nothing:
		// each reports zero findings by having asked zero questions.
		expect(boundTypeIds().length).toBeGreaterThan(40)
		expect(SHARED_CORE_HANDLERS.length).toBeGreaterThan(0)
		for (const id of boundTypeIds()) expect(getDefinition(id)).toBeTruthy()
	})

	it("every shared handler's group is whole and bound", () => {
		const bound = new Set(boundTypeIds())
		for (const { handler, typeIds } of SHARED_CORE_HANDLERS) {
			expect(typeIds.length, handler).toBeGreaterThan(1)
			for (const id of typeIds) {
				expect(bound.has(id), `${handler} → ${id}`).toBe(true)
				expect(getDefinition(id), `${handler} → ${id}`).toBeTruthy()
			}
		}
	})

	it("every shared handler may read something on every type it serves", () => {
		// The intersection is what its `SharedInput<[…]>` says it may read. An
		// empty one means the group has diverged into types with nothing in
		// common — a handler bound to all of them could read nothing at all.
		for (const { handler, typeIds } of SHARED_CORE_HANDLERS) {
			const contracts = typeIds.map((id) => getDefinition(id))
			const requires = requiresOf(...contracts)
			expect(requires.ports.length, handler).toBeGreaterThan(0)
			for (const c of contracts)
				expect(structuralCompat(requires, c, handler)).toEqual({
					ok: true
				})
		}
	})
})

/**
 * The other direction (plans/29 R-2): every core definition this build
 * publishes has a handler, or says it is provisional. Fifteen had neither on
 * 2026-09-17 — ten were culled, two bound, three flagged — and the count this
 * asserts is the count that must stay at zero.
 */
describe("core publishes nothing it cannot run", () => {
	it("finds no unbound, unflagged core definition", () => {
		expect(checkUnboundDefinitions()).toEqual([])
		expect(assertCoreDefinitionsBound("dev")).toEqual([])
	})

	it("asked something — the three provisional ones are published and unbound", () => {
		// The guard this test would be worthless without: a walk over an empty
		// registry, or one whose `provisional` flags were dropped, must not be
		// green by having asked nothing. The three plans 14/28 own are the
		// control — declared, unbound, and excused by the flag alone.
		const bound = new Set(boundTypeIds())
		for (const id of [
			"core:oracle/speak@1",
			"core:oracle/mcp-tool@1",
			"core:oracle/mcp-resource@1"
		]) {
			expect(getDefinition(id)?.provisional, id).toBe(true)
			expect(bound.has(id), id).toBe(false)
		}
		// And the two bound that day are bound.
		expect(bound.has("core:outlet/attach-image@1")).toBe(true)
		expect(bound.has("core:outlet/attach-audio@1")).toBe(true)
	})

	it("an unbound core definition without the flag refuses a dev boot and is said once in production", () => {
		// Declared here, in this file's own process: vitest isolates test files,
		// so the registration reaches no other suite. Undone by the flag rather
		// than by unregistering, which the SDK offers no door for.
		const stray = describeTaskDefinition({
			id: "core:task/stray-unbound@1",
			timeoutMs: 100,
			ports: { in: { text: S.text }, out: { main: S.json } }
		})
		expect(checkUnboundDefinitions()).toEqual(["core:task/stray-unbound@1"])
		// The line is `core:verdict/provisional`'s own sentence and fix (01 §13).
		expect(() => assertCoreDefinitionsBound("dev")).toThrow(
			/core:task\/stray-unbound@1 is published with no handler behind it[\s\S]*\(R-2\)[\s\S]*provisional: true/
		)
		const said: string[] = []
		const orig = console.error
		console.error = (m: unknown) => {
			said.push(String(m))
		}
		try {
			expect(assertCoreDefinitionsBound("prod")).toEqual([
				"core:task/stray-unbound@1"
			])
		} finally {
			console.error = orig
		}
		expect(said).toHaveLength(1)
		expect(said[0]).toMatch(/stray-unbound/)
		// The flag is the whole excuse.
		;(stray as { provisional?: true }).provisional = true
		expect(checkUnboundDefinitions()).toEqual([])
	})
})
