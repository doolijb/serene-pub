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
import { getDefinition } from "@serene-pub/sdk"
import {
	assertCoreBindingsCompatible,
	checkCoreBindings
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
