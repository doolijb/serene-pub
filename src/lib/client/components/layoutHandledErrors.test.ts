/**
 * A refusal is said once, where the person acted (plan A24 leftover).
 *
 * `Layout.svelte`'s catch-all toasts every `*:error` not listed in its
 * `HANDLED_ERROR_EVENTS`. A surface that says a refusal itself — in place, or
 * as its own toast — must be listed, or the person reads the same sentence
 * twice: once where they acted, once in a corner under a generated title.
 */
import { describe, expect, test } from "vitest"
import fs from "fs"
import path from "path"

function handledErrorEvents(): Set<string> {
	const source = fs.readFileSync(
		path.resolve(process.cwd(), "src/lib/client/components/Layout.svelte"),
		"utf8"
	)
	const start = source.indexOf(
		"const HANDLED_ERROR_EVENTS = new Set<string>(["
	)
	expect(start).toBeGreaterThan(-1)
	const end = source.indexOf("])", start)
	const body = source
		.slice(start, end)
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n")
	return new Set([...body.matchAll(/"([^"]+:error)"/g)].map((m) => m[1]!))
}

function handledWhenAskedErrorEvents(): Set<string> {
	const source = fs.readFileSync(
		path.resolve(process.cwd(), "src/lib/client/components/Layout.svelte"),
		"utf8"
	)
	const start = source.indexOf(
		"const HANDLED_WHEN_ASKED_ERROR_EVENTS = new Set<string>(["
	)
	expect(start).toBeGreaterThan(-1)
	const end = source.indexOf("])", start)
	const body = source
		.slice(start, end)
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n")
	return new Set([...body.matchAll(/"([^"]+:error)"/g)].map((m) => m[1]!))
}

describe("the timeless copy's refusal is said in place only when it names its asker", () => {
	test("lorebooks:duplicate:error is handled when asked, never whole", () => {
		expect(
			handledWhenAskedErrorEvents().has("lorebooks:duplicate:error")
		).toBe(true)
		expect(handledErrorEvents().has("lorebooks:duplicate:error")).toBe(
			false
		)
	})
})

describe("an entry save's or delete's refusal is said in place only when it names its asker", () => {
	test("entries:update:error and entries:delete:error are handled when asked, never whole", () => {
		for (const event of ["entries:update:error", "entries:delete:error"]) {
			expect(handledWhenAskedErrorEvents().has(event)).toBe(true)
			expect(handledErrorEvents().has(event)).toBe(false)
		}
	})
})

describe("Layout's catch-all leaves these refusals to the surface that asked", () => {
	test("an entry create's refusal: the modal, the place field or the editor's own toast says it", () => {
		expect(handledErrorEvents().has("entries:create:error")).toBe(true)
	})

	test("the Edit history's refusals: the fold, the clear dialogs and the admin row say them in place", () => {
		for (const event of [
			"entries:redlines:error",
			"entries:restoreRedline:error",
			"entries:clearRedlines:error",
			"characterVersions:redlines:error",
			"characterVersions:restoreRedline:error",
			"characterVersions:clearRedlines:error",
			"entries:redlineCount:error",
			"admin:redlineSummary:error",
			"admin:clearRedlines:error"
		])
			expect(handledErrorEvents().has(event), event).toBe(true)
	})

	test("a refused turn: the session page says it once, in the server's words", () => {
		// Continue, Pick who speaks and the narrator's turn: `turnFlow` toasts
		// the refusal itself, so the catch-all must leave it alone.
		expect(handledErrorEvents().has("sessions:fireTurn:error")).toBe(true)
	})

	test("a library template write's refusal: the library page, the template form or the layout form says it", () => {
		const handled = handledErrorEvents()
		for (const verb of ["Create", "Clone", "Update", "Delete"])
			expect(
				handled.has(`pipelines:library${verb}Template:error`),
				verb
			).toBe(true)
	})

	test("a merge's refusal: the absorb window says it in place, the duplicates list as its own toast", () => {
		expect(handledErrorEvents().has("narrativeGraph:mergeNode:error")).toBe(
			true
		)
	})
})

describe("the catch-all is the loadouts' one toast (10-05: toasts are central)", () => {
	/**
	 * The Loadouts sheet and the Models view's *Use in…* only reset their own
	 * state on a refusal (the sheet drops its pending pick; *Use in…* speaks
	 * it to a screen reader) — neither shows it. So the central listener must
	 * toast every `loadouts:` refusal, and none may be listed as handled.
	 */
	test("no loadouts refusal is left to a view", () => {
		const handled = handledErrorEvents()
		for (const verb of [
			"create",
			"update",
			"delete",
			"setDefault",
			"merge",
			"makeIt"
		])
			expect(handled.has(`loadouts:${verb}:error`), verb).toBe(false)
		expect(handled.has("localModels:mattingRemove:error")).toBe(false)
	})
})
