import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The rail's registry against the sidebar's `{#if}` chain.
 *
 * Every rail item is declared as data in one place (`panelsCtx.leftNav` /
 * `rightNav`) and rendered in another (the `sidebarView` snippet). Nothing
 * connects the two: a view registered with no branch is a rail item that opens
 * an empty sidebar, and neither the compiler nor the typechecker has anything
 * to say about it — the key is a string on both sides.
 *
 * Read as text rather than imported. `Layout.svelte` is the shell: importing it
 * would need a DOM, a socket, a user and half the app's contexts, and this
 * assertion is about the SOURCE either way.
 */
const LAYOUT = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"../components/Layout.svelte"
)
const source = fs.readFileSync(LAYOUT, "utf8")

/**
 * Every key the shell registers as a view: the one-line entries in the
 * `leftNav` / `rightNav` literals, and the ones the settings effect assigns
 * when a role or a setting turns them on. `delete panelsCtx.leftNav.x` is not
 * an assignment and is left out, which is what the `=` in the pattern buys.
 */
function registeredViewKeys(): string[] {
	const assigned = [
		...source.matchAll(/panelsCtx\.(?:left|right)Nav\.(\w+)\s*=\s*\{/g)
	].map((m) => m[1])
	const declared = [
		...source.matchAll(/^\s*(\w+): \{ (?:icon|imgSrc): .*title: "/gm)
	].map((m) => m[1])
	return [...new Set([...assigned, ...declared])]
}

/** Every key the sidebar's `{#if}` chain has a branch for. */
function renderedViewKeys(): string[] {
	const chain = source.slice(source.indexOf("{#snippet sidebarView("))
	return [...chain.matchAll(/key === "(\w+)"/g)].map((m) => m[1])
}

describe("the shell's sidebar views", () => {
	const registered = registeredViewKeys()
	const rendered = renderedViewKeys()

	// A pattern that quietly stops matching turns every assertion below into a
	// no-op that still reports green.
	it("finds the registry and the chain", () => {
		expect(registered.length).toBeGreaterThan(10)
		expect(rendered.length).toBeGreaterThan(10)
	})

	it("renders every view the rail can open", () => {
		expect(registered.filter((key) => !rendered.includes(key))).toEqual([])
	})

	it("registers no branch for a view the rail never offers", () => {
		expect(rendered.filter((key) => !registered.includes(key))).toEqual([])
	})

	/**
	 * Help is everyone's (NOMENCLATURE §27): it is declared in the `leftNav`
	 * literal rather than inside the effect's `if (isAdmin)` block, and the
	 * rail pushes it after the Tune group's loop so it stays at that group's
	 * foot however many managers an instance has switched on.
	 */
	describe("Help", () => {
		it("is registered for every user", () => {
			expect(source).toContain(
				'help: { icon: Icons.BookOpen, title: "Help" }'
			)
			expect(registered).toContain("help")
		})

		it("has a sidebar view", () => {
			expect(rendered).toContain("help")
			expect(source).toContain("<HelpSidebar />")
		})

		it("is drawn at the foot of Tune", () => {
			// Excluded from the Tune loop, which would otherwise append it
			// among the managers rather than under them…
			expect(source).toMatch(
				/navOrdered\(\s*panelsCtx\.leftNav,\s*SYSTEM_ORDER,\s*\[[^\]]*"help"[^\]]*\]/
			)
			// …and pushed back into that same group afterwards.
			expect(source).toMatch(/\.\.\.help,[\s\S]{0,120}group: "system"/)
			const loopAt = source.indexOf("SYSTEM_ORDER,")
			const pushAt = source.search(/\.\.\.help,/)
			const footAt = source.indexOf('key: "activity",')
			expect(pushAt).toBeGreaterThan(loopAt)
			expect(footAt).toBeGreaterThan(pushAt)
		})
	})
})
