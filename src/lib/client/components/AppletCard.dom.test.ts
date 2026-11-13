/**
 * 🚧 M2d: the applet card — a link to the launcher with a poster (or the app
 * glyph on a ground), an optional logo, the title, and the blurb and genre
 * names as its meta line.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

const goto = vi.hoisted(() => vi.fn())
vi.mock("$app/navigation", () => ({ goto }))
vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import AppletCard from "./AppletCard.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function draw(props: Record<string, unknown>) {
	app = mount(AppletCard, {
		target: document.body,
		props: {
			pluginId: "acme.cards",
			title: "Card Table",
			genres: ["Solitaire", "Rummy"],
			from: "apps",
			...props
		}
	})
	flushSync()
	return document.body.querySelector("a")!
}

describe("AppletCard", () => {
	test("a link to the launcher, named by the title", () => {
		const a = draw({})
		expect(a.getAttribute("href")).toBe("/apps/acme.cards")
		expect(a.getAttribute("aria-label")).toBe("Card Table")
	})

	test("a poster fills the top and the glyph is absent", () => {
		const a = draw({ poster: "/media/p.png" })
		expect(a.querySelector("img")?.getAttribute("src")).toBe("/media/p.png")
		expect(a.querySelector("[data-applet-card-ground]")).toBeNull()
		expect(a.querySelector("svg")).toBeNull()
	})

	test("without a poster the ground carries the glyph", () => {
		const a = draw({})
		expect(a.querySelector("img")).toBeNull()
		expect(a.querySelector("[data-applet-card-ground] svg")).not.toBeNull()
	})

	test("the logo renders only when given", () => {
		expect(
			draw({ poster: "/p.png" }).querySelector("[data-applet-card-logo]")
		).toBeNull()
		unmount(app!)
		document.body.innerHTML = ""
		const a = draw({ poster: "/p.png", logo: "/l.png" })
		expect(
			a.querySelector("[data-applet-card-logo]")?.getAttribute("src")
		).toBe("/l.png")
	})

	test("the meta line carries the blurb, then the genre names, and describes the link", () => {
		const a = draw({ blurb: "Cards for one." })
		const meta = a.querySelector("[data-meta-line]")!
		expect(a.getAttribute("aria-describedby")).toBe(meta.id)
		expect(meta.textContent!.replace(/\s+/g, " ").trim()).toBe(
			"Cards for one. Solitaire · Rummy"
		)
		expect(meta.querySelector(".line-clamp-2")?.textContent?.trim()).toBe(
			"Cards for one."
		)
	})

	test("without a blurb only the genre names show", () => {
		const meta = draw({}).querySelector("[data-meta-line]")!
		expect(meta.querySelector(".line-clamp-2")).toBeNull()
		expect(meta.textContent!.replace(/\s+/g, " ").trim()).toBe(
			"Solitaire · Rummy"
		)
	})

	test("a plain click remembers where the card was drawn; a modified click is the link's own", () => {
		goto.mockClear()
		const a = draw({ from: "home" })
		a.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true })
		)
		expect(goto).toHaveBeenCalledWith("/apps/acme.cards", {
			state: { appletFrom: "home" }
		})
		goto.mockClear()
		a.dispatchEvent(
			new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true
			})
		)
		expect(goto).not.toHaveBeenCalled()
	})
})
