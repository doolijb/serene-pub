/**
 * s22-L (owner 2026-11-05, §24.8): the book row's rules-fit line is always the
 * row's third line — after the description, the share line or the session-notes
 * line — and draws nothing when no genre rates the book's rules.
 *
 * ⚠ No DOM node is ever handed to `expect`: every check compares a boolean or a string.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$app/navigation", () => ({
	replaceState: vi.fn(),
	goto: vi.fn(),
	pushState: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn()
}))
vi.mock("$app/state", () => ({
	page: { url: new URL("http://localhost/"), state: {}, params: {} }
}))

import LorebookListItem from "./LorebookListItem.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const FITS = [
	{
		genreId: "story",
		genreName: "Story",
		rating: "great",
		reason: "everything is here"
	},
	{
		genreId: "lair",
		genreName: "Lair",
		rating: "good",
		reason: "a number told in words"
	}
]

const render = (
	lorebook: Record<string, unknown>,
	props: Record<string, unknown> = {}
) => {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(LorebookListItem, {
		target: host,
		props: {
			lorebook: { id: 1, name: "Saltmarsh", ...lorebook },
			showControls: false,
			...props
		}
	})
	flushSync()
	return host
}
const text = (host: Element, sel: string) =>
	host.querySelector(sel)?.textContent?.trim() ?? null
const FIT = "Story: Great · Lair: Good"

describe("the lorebook row's fit line is always its third line", () => {
	test("a row with a description shows the description and the fit line", () => {
		const host = render({
			description: "A salt town",
			primaryRuleset: "rule-based",
			rulesetFitByGenre: FITS
		})
		expect(host.textContent).toContain("Saltmarsh")
		expect(host.textContent).toContain("A salt town")
		expect(text(host, "[data-rules-fit]")).toBe(FIT)
		// The fit line follows the description, never replaces it.
		const html = host.innerHTML
		expect(html.indexOf("A salt town")).toBeLessThan(
			html.indexOf("data-rules-fit")
		)
	})

	test("a shared row shows its share line and the fit line", () => {
		const host = render({
			isSharedWithMe: true,
			ownerName: "Ada",
			description: "never shown here",
			primaryRuleset: "rule-based",
			rulesetFitByGenre: FITS
		})
		expect(host.textContent).toContain("From Ada")
		expect(host.textContent).not.toContain("never shown here")
		expect(text(host, "[data-rules-fit]")).toBe(FIT)
	})

	test("a session-notes row shows its notes line and the fit line", () => {
		const host = render(
			{ primaryRuleset: "rule-based", rulesetFitByGenre: FITS },
			{ sessionNotesOf: { attached: { id: 2, name: "Wreck Cove" } } }
		)
		expect(host.textContent).toContain("Kept on top of Wreck Cove")
		expect(text(host, "[data-rules-fit]")).toBe(FIT)
	})

	test("a Freeform row shows the Freeform sentence, with a description too", () => {
		const host = render({ description: "A salt town" })
		expect(host.textContent).toContain("A salt town")
		expect(
			host
				.querySelector("[data-rules-fit]")
				?.getAttribute("data-rules-fit")
		).toBe("freeform")
	})

	test("a row no genre rates, and not on Freeform, draws no fit line", () => {
		const host = render({
			description: "A salt town",
			primaryRuleset: "rule-based"
		})
		expect(host.querySelector("[data-rules-fit]") === null).toBe(true)
		expect(host.textContent).toContain("A salt town")
	})
})
