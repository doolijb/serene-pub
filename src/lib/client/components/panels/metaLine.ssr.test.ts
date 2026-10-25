/**
 * The meta line (PLAN-0-5-polish-parity L6 and §5.3, 2026-10-24; STYLE-GUIDE
 * §6.4) and the session row built on it: one muted line, a 13px lead that
 * gives way first, 12px facts joined by " · ", empty facts dropped; the row
 * upright (never italic), no "your turn" dot, an ember dot only while a reply
 * is being written.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"
import { createRawSnippet } from "svelte"

vi.mock("$app/environment", () => ({ dev: false, building: false }))

import MetaLine from "./MetaLine.svelte"
import { metaLineItems } from "./metaLine"
import SessionListItem from "../listItems/SessionListItem.svelte"

const text = (html: string) =>
	html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim()

describe("metaLineItems", () => {
	test("drops empty facts and keeps order", () => {
		expect(metaLineItems(["Story", null, "", false, undefined, 3, " Oct 1 "])).toEqual([
			"Story",
			"3",
			"Oct 1"
		])
	})
})

describe("MetaLine", () => {
	test("facts alone: joined by one separator each, muted, 12px", () => {
		const html = render(MetaLine, {
			props: { items: ["Story", null, "Oct 1", "your turn"] }
		}).body
		expect(text(html)).toBe("Story · Oct 1 · your turn")
		expect(html).toContain("data-meta-line")
		expect(html).toContain("text-surface-600-400")
		expect(html).not.toContain("text-surface-500")
		expect(html).toContain("text-xs")
	})

	test("a lead: 13px and truncating, the facts after it never cut", () => {
		const html = render(MetaLine, {
			props: {
				items: ["Oct 1"],
				children: createRawSnippet(() => ({
					render: () => "<span>Corb: One fifty-one.</span>"
				}))
			}
		}).body
		expect(text(html)).toBe("Corb: One fifty-one. · Oct 1")
		expect(html).toMatch(/class="min-w-0 truncate text-chip/)
		expect(html).toMatch(/class="text-xs whitespace-nowrap shrink-0"/)
	})

	test("a lead and nothing else draws no separator", () => {
		const html = render(MetaLine, {
			props: {
				children: createRawSnippet(() => ({
					render: () => "<span>@bramble</span>"
				}))
			}
		}).body
		expect(text(html)).toBe("@bramble")
	})
})

describe("SessionListItem", () => {
	const base = {
		id: 9,
		name: "Hull Breach, Deck 4",
		canEdit: true,
		isOwner: true,
		updatedAt: new Date("2026-10-01T12:00:00Z").toISOString(),
		sessionCharacters: [
			{ character: { id: 1, name: "Corb" } },
			{ character: { id: 2, name: "Aris" } },
			{ character: { id: 3, name: "Kiran" } },
			{ character: { id: 4, name: "Brix" } }
		],
		lastMessage: {
			isUser: false,
			speakerName: "Corb",
			excerpt: "One fifty-one."
		}
	} as any

	test("one anatomy: stacked faces with +n, the name, one upright meta line", () => {
		const html = render(SessionListItem, {
			props: { session: base, showGenre: true }
		}).body
		expect(html).toContain("data-avatar-stack")
		expect(html).toMatch(/data-avatar-stack-more[^>]*>\s*\+1\s*</)
		expect(html).toContain("text-lead")
		const line = html.slice(
			html.lastIndexOf("<", html.indexOf('id="session-line-9"'))
		)
		expect(line).toContain("data-meta-line")
		expect(text(line)).toMatch(/^Corb: One fifty-one\. · /)
		expect(html).not.toContain("italic")
		// The group label says "Your turn"; the row draws no dot for it.
		expect(html).not.toContain("bg-primary-500")
		expect(html).not.toContain("Your turn")
	})

	test("while a reply is being written: the status leads, after an ember dot", () => {
		const html = render(SessionListItem, {
			props: {
				session: base,
				runStatus: { i18n: { en: "Corb is typing" } }
			}
		}).body
		expect(html).toContain("data-session-run-status")
		expect(text(html)).toContain("Corb is typing")
		expect(html).toContain("bg-warning-500")
		expect(html).not.toContain("bg-primary-500")
	})
})
