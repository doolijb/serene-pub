/** `declaredIconOf`: curated names at once, others lazily behind a same-size placeholder. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { Anchor, Square } from "@lucide/svelte"
import DeclaredIconFixture from "./DeclaredIconFixture.svelte"

const hoisted = vi.hoisted(() => ({
	calls: [] as string[],
	pending: new Map<string, (v: unknown) => void>()
}))

vi.mock("./lucideIconModules", () => ({
	loadLucideIcon: (name: string) => {
		hoisted.calls.push(name)
		return new Promise((resolve) => hoisted.pending.set(name, resolve))
	}
}))

let apps: ReturnType<typeof mount>[] = []
beforeEach(() => {
	hoisted.calls.length = 0
	hoisted.pending.clear()
})
afterEach(() => {
	for (const a of apps) unmount(a)
	apps = []
	document.body.innerHTML = ""
})

function draw(name: string | null) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	apps.push(
		mount(DeclaredIconFixture, {
			target,
			props: { name, fallback: Square }
		})
	)
	flushSync()
	return target
}

async function settle(name: string, value: unknown) {
	await vi.waitFor(() => expect(hoisted.pending.has(name)).toBe(true))
	hoisted.pending.get(name)!(value)
	await tick()
	await tick()
	flushSync()
}

const classOf = (t: Element) =>
	t.querySelector("svg")?.getAttribute("class") ?? ""

describe("declaredIconOf", () => {
	test("a curated name draws the icon at once, with no load", () => {
		const t = draw("BookOpenText")
		const svg = t.querySelector("svg")!
		expect(classOf(t)).toContain("lucide-book-open-text")
		expect(svg.getAttribute("aria-label")).toBe("drawn")
		expect(hoisted.calls).toEqual([])
	})

	test("a lazy name draws a 16px empty hidden svg, then the icon", async () => {
		const t = draw("Anchor")
		const svg = t.querySelector("svg")!
		expect(svg.getAttribute("width")).toBe("16")
		expect(svg.getAttribute("height")).toBe("16")
		expect(svg.getAttribute("aria-hidden")).toBe("true")
		expect(svg.hasAttribute("aria-label")).toBe(false)
		expect(svg.childElementCount).toBe(0)
		await settle("Anchor", Anchor)
		expect(classOf(t)).toContain("lucide-anchor")
		expect(t.querySelector("svg")!.getAttribute("aria-label")).toBe("drawn")
	})

	test("an unknown name ends on the fallback", async () => {
		const t = draw("NoSuchIconAtAll")
		expect(t.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true")
		await settle("NoSuchIconAtAll", null)
		expect(classOf(t)).toContain("lucide-square")
	})

	test("a falsy name draws the fallback at once", () => {
		const t = draw(null)
		expect(classOf(t)).toContain("lucide-square")
		expect(hoisted.calls).toEqual([])
	})

	test("two mounts of one lazy name load it once", async () => {
		const a = draw("Telescope")
		const b = draw("Telescope")
		await vi.waitFor(() =>
			expect(hoisted.pending.has("Telescope")).toBe(true)
		)
		expect(hoisted.calls).toEqual(["Telescope"])
		const Telescope = (await import("@lucide/svelte")).Telescope
		await settle("Telescope", Telescope)
		expect(classOf(a)).toContain("lucide-telescope")
		expect(classOf(b)).toContain("lucide-telescope")
		expect(hoisted.calls).toEqual(["Telescope"])
	})
})
