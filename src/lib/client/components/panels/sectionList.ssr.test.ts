/**
 * The section list and the primitives that came with it, rendered
 * (PLAN-sidebar-nav-normalization §2, phase 1).
 *
 * `render` from `svelte/server`, like the connections ssr suites: the repo
 * has no browser environment for these, and what they promise IS markup —
 * a nav with an accessible name, rows that are links or buttons, the one
 * selected treatment with `aria-current`, labels tied to their lists.
 *
 * ⚠ Not a design assertion beyond the classes that carry meaning: the
 * selected-row class, the 240px flush column and its edge, the disabled dim.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"
import { createRawSnippet } from "svelte"
import * as Icons from "@lucide/svelte"

vi.mock("$app/environment", () => ({ dev: false, building: false }))

import SectionList from "./SectionList.svelte"
import ListGroupLabel from "./ListGroupLabel.svelte"
import SectionSplitFixture from "./SectionSplitFixture.svelte"
import LoadingState from "../LoadingState.svelte"
import { dotLabelFor, type SectionGroup } from "./sectionList"

const groups: SectionGroup[] = [
	{
		items: [
			{
				key: "overview",
				label: "Overview",
				icon: Icons.House,
				href: "/admin"
			}
		]
	},
	{
		label: "People",
		items: [
			{
				key: "users",
				label: "Users",
				icon: Icons.Users,
				href: "/admin/users",
				count: 4
			},
			{
				key: "invites",
				label: "Invites",
				href: "/admin/invites",
				dot: "error"
			},
			{
				key: "access",
				label: "Access",
				href: "/admin/access",
				dot: "primary",
				dotLabel: "(2 waiting)"
			}
		]
	},
	{
		label: "Prompts",
		items: [
			{
				key: "chat",
				label: "Chat",
				description: "Replies in a session"
			},
			{ key: "off", label: "Unavailable", disabled: true },
			{
				key: "gone",
				label: "Gone link",
				href: "/admin/gone",
				disabled: true
			}
		]
	}
]

function html(props: Record<string, unknown>) {
	return render(SectionList, {
		props: {
			groups,
			value: null,
			ariaLabel: "Admin sections",
			...props
		} as any
	}).body
}

/** The opening tag of the first element carrying `marker`. */
function tagWith(markup: string, marker: string): string {
	const at = markup.indexOf(marker)
	expect(at, `no element with ${marker}`).toBeGreaterThan(-1)
	const open = markup.lastIndexOf("<", at)
	return markup.slice(open, markup.indexOf(">", at) + 1)
}

describe("SectionList", () => {
	test("is a named nav, never a tablist", () => {
		const out = html({})
		expect(out).toContain('<nav aria-label="Admin sections"')
		expect(out).not.toContain('role="tablist"')
		expect(out).not.toContain('role="tab"')
	})

	test("a row with href is a link; without, a button", () => {
		const out = html({})
		expect(out).toMatch(/<a href="\/admin\/users"[^>]*>/)
		expect(tagWith(out, ">Chat<").length).toBeGreaterThan(0)
		const chatRow = out.slice(
			out.lastIndexOf("<button", out.indexOf(">Chat<"))
		)
		expect(chatRow.startsWith('<button type="button"')).toBe(true)
	})

	test("the selected row: the row treatment and aria-current, neutral text", () => {
		const out = html({ value: "users" })
		const row = tagWith(out, 'href="/admin/users"')
		expect(row).toContain('aria-current="page"')
		expect(row).toContain("sidebar-row-active")
		expect(row).not.toMatch(/text-primary|preset-filled-primary/)
		// Only one row is current.
		expect(out.match(/aria-current="page"/g)).toHaveLength(1)
		// Idle rows hover neutral.
		expect(tagWith(out, 'href="/admin/invites"')).toContain(
			"hover:bg-surface-200-800"
		)
	})

	test("a selected button row is current too", () => {
		const out = html({ value: "chat" })
		const at = out.indexOf(">Chat<")
		const row = out.slice(
			out.lastIndexOf("<button", at),
			out.indexOf(">", out.lastIndexOf("<button", at)) + 1
		)
		expect(row).toContain('aria-current="page"')
		expect(row).toContain("sidebar-row-active")
	})

	test("group labels are muted h3s tied to their lists; unlabelled groups have none", () => {
		const out = html({})
		const h3 = tagWith(out, ">People<")
		expect(out).toMatch(
			/<h3 id="([^"]+)"[^>]*class="text-surface-600-400[^"]*px-3 pt-4 pb-1 text-xs/
		)
		const id = /<h3 id="([^"]+)"[^>]*>\s*<span[^>]*>People</.exec(out)?.[1]
		expect(id, h3).toBeTruthy()
		expect(out).toContain(`aria-labelledby="${id}"`)
		expect(out.match(/<h3/g)).toHaveLength(2)
		expect(out).not.toMatch(/<hr|border-t/)
	})

	test("description, count and dots", () => {
		const out = html({})
		expect(out).toContain("Replies in a session")
		expect(out).toMatch(
			/class="badge[^"]*preset-tonal-surface[^"]*"[^>]*>\s*4\s*</
		)
		expect(out).toContain("bg-error-500")
		expect(out).toContain("bg-primary-500")
		expect(out).toContain(
			`<span class="sr-only">${dotLabelFor("error")}</span>`
		)
		expect(out).toContain('<span class="sr-only">(2 waiting)</span>')
	})

	test("the badge steps off the selected row's ground", () => {
		const out = html({ value: "users" })
		expect(out).toMatch(
			/class="badge[^"]*bg-surface-300-700[^"]*"[^>]*>\s*4\s*</
		)
	})

	test("disabled rows are dimmed and inert", () => {
		const out = html({ value: "off" })
		const button = out.slice(
			out.lastIndexOf("<button", out.indexOf(">Unavailable<"))
		)
		const tag = button.slice(0, button.indexOf(">") + 1)
		expect(tag).toContain("disabled")
		expect(tag).toContain("opacity-60")
		expect(tag).not.toContain("aria-current")
		// A disabled link loses its href rather than going anywhere.
		expect(out).not.toContain('href="/admin/gone"')
		const link = out.slice(
			out.lastIndexOf("<a", out.indexOf(">Gone link<"))
		)
		expect(link.slice(0, link.indexOf(">") + 1)).toContain(
			'aria-disabled="true"'
		)
	})

	test("flush by default: 240px, the panel edge, its own scroller", () => {
		const nav = tagWith(html({}), "<nav")
		expect(nav).toContain("w-60")
		expect(nav).toContain("panel-edge")
		expect(nav).toContain("border-r")
		expect(nav).toContain("overflow-y-auto")
	})

	test("flush={false}: no width, edge or scroller", () => {
		const nav = tagWith(html({ flush: false, class: "extra-x" }), "<nav")
		expect(nav).not.toContain("w-60")
		expect(nav).not.toContain("border-r")
		expect(nav).not.toContain("overflow-y-auto")
		expect(nav).toContain("extra-x")
	})

	test("head and foot render around the groups", () => {
		const head = createRawSnippet(() => ({
			render: () => "<p>HEAD-SLOT</p>"
		}))
		const foot = createRawSnippet(() => ({
			render: () => "<p>FOOT-SLOT</p>"
		}))
		const out = html({ head, foot })
		const h = out.indexOf("HEAD-SLOT")
		const f = out.indexOf("FOOT-SLOT")
		expect(h).toBeGreaterThan(-1)
		expect(h).toBeLessThan(out.indexOf(">Overview<"))
		expect(f).toBeGreaterThan(out.indexOf(">Gone link<"))
		expect(tagWith(out, "FOOT-SLOT")).toBeTruthy()
	})
})

describe("ListGroupLabel", () => {
	test("muted h3, no rule, trailing words after the label", () => {
		const out = render(ListGroupLabel, {
			props: {
				label: "On this machine",
				trailing: "private · free",
				id: "g1"
			}
		}).body.replace(/<!--[^]*?-->/g, "")
		expect(out).toMatch(/^<h3 id="g1" class="text-surface-600-400 flex/)
		expect(out).toContain("px-3 pt-4 pb-1 text-xs")
		expect(out.indexOf("On this machine")).toBeLessThan(
			out.indexOf("private · free")
		)
		expect(out).not.toMatch(/h-px|<hr|border/)
	})

	test("heading level 4", () => {
		const out = render(ListGroupLabel, {
			props: { label: "Older", headingLevel: 4 }
		}).body.replace(/<!--[^]*?-->/g, "")
		expect(out.startsWith("<h4")).toBe(true)
		expect(out).not.toContain("truncate text-meta")
	})
})

describe("LoadingState", () => {
	test("a status with a spinner; the words are for the screen reader", () => {
		const out = render(LoadingState, { props: {} }).body
		expect(out).toContain('role="status"')
		expect(out).toContain("animate-spin")
		expect(out).toContain('<span class="sr-only">Loading…</span>')
		expect(out).toContain("py-8")
	})

	test("showMessage draws the words", () => {
		const out = render(LoadingState, {
			props: { message: "Fetching models…", showMessage: true }
		}).body
		expect(out).toContain("Fetching models…")
		expect(out).not.toContain("sr-only")
	})
})

describe("PanelSplit kind=sections with a SectionList", () => {
	const fixtureGroups: SectionGroup[] = [
		{
			items: [
				{ key: "a", label: "Alpha" },
				{ key: "b", label: "Beta" }
			]
		}
	]

	test("desk: a 240px column, unpadded; the list is flush and draws the edge", () => {
		const out = render(SectionSplitFixture, {
			props: {
				mode: "desk",
				groups: fixtureGroups,
				value: "a",
				hasDetail: true
			}
		}).body
		expect(out).toContain("grid-template-columns: 15rem minmax(0, 1fr)")
		const cell = tagWith(out, "data-panel-split-sections")
		expect(cell).not.toContain("p-4")
		expect(cell).not.toContain("border-r")
		const nav = tagWith(out, "<nav")
		expect(nav).toContain("w-60")
		expect(nav).toContain("border-r")
		expect(out).toContain("Section body")
	})

	test("compact: the list fills the pane — no 240px column, no edge", () => {
		const out = render(SectionSplitFixture, {
			props: { mode: "compact", groups: fixtureGroups }
		}).body
		const nav = tagWith(out, "<nav")
		expect(nav).not.toContain("w-60")
		expect(nav).not.toContain("border-r")
		expect(nav).toContain("flex-1")
		expect(nav).toContain("overflow-y-auto")
		expect(out).not.toContain("Section body")
	})

	test("compact with a section open: the section alone, inset by a margin", () => {
		const out = render(SectionSplitFixture, {
			props: { mode: "compact", groups: fixtureGroups, hasDetail: true }
		}).body
		expect(out).not.toContain("<nav")
		expect(tagWith(out, "@container/detail")).not.toMatch(/\bp-4\b/)
		expect(out).toContain("m-4 flex min-h-0 flex-1 flex-col")
		expect(out).toContain("Section body")
	})
})
