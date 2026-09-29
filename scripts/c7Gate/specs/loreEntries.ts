/**
 * Lore entries (R21, R58): the session's lorebook entry by entry, what this
 * session's rankings made of each, and the Off / Pin marks.
 *
 * Records: the first page is the server's own (`entries:sessionEntries`,
 * the widget's settled sort), five of the fixture's seven, each with its
 * keys and "Not read in this session yet" (the fixture's turn has not run);
 * the pager reads 1–5 of 7, the search says how many there are.
 * Flows: paging, sorting (the combobox), searching, filtering, the two marks
 * (persisted, and refreshed on a second socket through `lore:marked`), and
 * the fixture's one fake turn refreshing the rows on both sockets through
 * `lore:ranked` — no reload.
 */
import type { Locator, Page } from "playwright"
import { ask, open, booted, URL_BASE } from "../engine"
import { ENTRIES, LORE_PAGE_SIZE, takeTheTurn, type AdventureFixture } from "./adventure"
import { pushArrives, reloadOn, until, type WidgetCtx, type WidgetSpec } from "./kit"

type Row = { id: number; name: string; keys: string; read: string; pinned: boolean; off: boolean; struck: boolean }

/** The rows the widget shows, and its pager's words. */
const rowsOn = (page: Page, sel: string) =>
	page.evaluate((sel) => {
		const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
		const root = document.querySelector(sel)
		const rows = [...(root?.querySelectorAll("li[data-entry-id]") ?? [])].map((li) => {
			const lines = [...li.querySelectorAll(":scope > span:first-child > span")].map((s) => flat(s.textContent))
			const pin = li.querySelector('button[aria-label^="Pin "]')
			const off = li.querySelector('button[aria-label^="Turn "]')
			return {
				id: Number(li.getAttribute("data-entry-id")),
				name: lines[0] ?? "",
				keys: lines.length > 2 ? lines[1]! : "",
				read: lines.at(-1) ?? "",
				pinned: pin?.getAttribute("aria-pressed") === "true",
				off: off?.getAttribute("aria-pressed") === "true",
				// Drawn struck through, whatever the markup names it.
				struck: getComputedStyle(li.querySelector(":scope > span:first-child > span") ?? li).textDecorationLine.includes("line-through")
			}
		})
		const pager = [...(root?.querySelectorAll("div > span") ?? [])].map((s) => flat(s.textContent)).find((t) => /^\d+–\d+ of \d+$/.test(t)) ?? null
		const empty = flat(root?.querySelector("ul > li:not([data-entry-id])")?.textContent) || null
		const search = root?.querySelector('input[placeholder^="Search"]')?.getAttribute("placeholder") ?? null
		return { rows, pager, empty, search }
	}, sel) as Promise<{ rows: Row[]; pager: string | null; empty: string | null; search: string | null }>

/** The server's page for these asks — what the widget must show. */
async function serverPage(page: Page, f: AdventureFixture, o: { sort?: string; filter?: string; query?: string; offset?: number } = {}) {
	const got = await ask(
		page,
		"entries:sessionEntries",
		{ sessionId: f.sessionId, sort: o.sort ?? "lastRead", filter: o.filter ?? "all", offset: o.offset ?? 0, limit: LORE_PAGE_SIZE, ...(o.query ? { query: o.query } : {}), request: `gate-${Math.random()}` },
		{ where: { sessionId: f.sessionId } }
	)
	return got as { rows: Array<{ id: number; title: string; off: boolean; pinned: boolean; timesJudged: number }>; total: number }
}

const names = (rows: Array<{ name?: string; title?: string }>) => rows.map((r) => r.name ?? r.title).join(", ")

/** The widget shows exactly these entry names, in order. */
const showsNames = (ctx: WidgetCtx, page: Page, want: string[], what: string, timeout = 10_000) =>
	until(
		page,
		({ sel, want }) =>
			JSON.stringify(
				[...document.querySelectorAll(`${sel} li[data-entry-id]`)].map((li) =>
					(li.querySelector(":scope > span:first-child > span")?.textContent ?? "").replace(/\s+/g, " ").trim()
				)
			) === JSON.stringify(want),
		{ sel: ctx.sel, want },
		timeout,
		async () => `${what}: the rows read ${names((await rowsOn(page, ctx.sel)).rows) || "nothing"}, not ${want.join(", ") || "nothing"}`
	)

async function pickSort(ctx: WidgetCtx, label: string) {
	await ctx.page.locator(`${ctx.sel} sp-combobox`).locator("button").last().click()
	const option = ctx.page.getByRole("option", { name: label, exact: true })
	await option.waitFor({ timeout: 8_000 })
	await option.click()
}

const byName = [...ENTRIES].map((e) => e.name).sort((a, b) => a.localeCompare(b))

/* ── exhibits: the states the snapshot never draws ────────────────────── */

/** The pointer let go and parked in the page's corner (an earlier exhibit may have left it pressed). */
async function pointerAway(ctx: WidgetCtx) {
	await ctx.page.mouse.up()
	await ctx.page.mouse.move(0, 0)
}
/** Transitions run out (Skeleton's buttons ease over 150ms). */
const settle = (ctx: WidgetCtx) => ctx.page.waitForTimeout(700)
/** The first page's rows, top to bottom, as the widget draws them. */
const row = (ctx: WidgetCtx, n: number) => ctx.page.locator(`${ctx.sel} li[data-entry-id]`).nth(n)
const pinOf = (ctx: WidgetCtx, n: number) => row(ctx, n).locator('button[aria-label^="Pin "]')
const offOf = (ctx: WidgetCtx, n: number) => row(ctx, n).locator('button[aria-label^="Turn "]')
const pagerButton = (ctx: WidgetCtx, name: "Previous" | "Next") => ctx.page.locator(ctx.sel).getByRole("button", { name, exact: true })

/** Focus reached from the keyboard, so `:focus-visible` holds: focus the element before `target`, then Tab (or after it, then Shift+Tab). */
async function tabTo(ctx: WidgetCtx, from: Locator, back = false) {
	await pointerAway(ctx)
	await from.focus()
	await ctx.page.keyboard.press(back ? "Shift+Tab" : "Tab")
	await settle(ctx)
}

/** Old Mill pinned and Ferryman off, as the server holds them (the runner's reset clears both). */
async function marked(ctx: WidgetCtx) {
	const mill = ctx.f.entries.get("Old Mill")!
	const ferry = ctx.f.entries.get("Ferryman")!
	await ask(ctx.page, "entries:setMarks", { entryId: mill, pinned: true }, { where: { entryId: mill } })
	await ask(ctx.page, "entries:setMarks", { entryId: ferry, off: true }, { where: { entryId: ferry } })
	await until(
		ctx.page,
		({ sel, mill, ferry }) =>
			document.querySelector(`${sel} li[data-entry-id="${mill}"] button[aria-label^="Pin "]`)?.getAttribute("aria-pressed") === "true" &&
			document.querySelector(`${sel} li[data-entry-id="${ferry}"] button[aria-label^="Turn "]`)?.getAttribute("aria-pressed") === "true",
		{ sel: ctx.sel, mill, ferry },
		10_000,
		() => "the marks set for the exhibit never showed"
	)
	return { mill, ferry }
}

/**
 * Every state of the widget's own drawing the fixture's first page leaves
 * out: each hover, focus ring and press on each kind of control, the marks
 * pressed (and an Off entry struck through), a chosen filter with its empty
 * floor, and the last page (Previous offered, Next withheld).
 */
const LORE_EXHIBITS: NonNullable<WidgetSpec["exhibits"]> = [
	{
		// First: a press is held, and every later exhibit lets go before it starts.
		name: "Next pressed",
		show: async (ctx) => {
			await pointerAway(ctx)
			await pagerButton(ctx, "Next").hover()
			await ctx.page.mouse.down()
			await settle(ctx)
		}
	},
	{
		name: "Pin pressed",
		show: async (ctx) => {
			await pointerAway(ctx)
			await pinOf(ctx, 0).hover()
			await ctx.page.mouse.down()
			await settle(ctx)
		}
	},
	{
		name: "entry hovered",
		show: async (ctx) => {
			await pointerAway(ctx)
			await row(ctx, 0).locator(":scope > span").first().hover()
			await settle(ctx)
		}
	},
	{
		name: "Pin hovered",
		show: async (ctx) => {
			await pointerAway(ctx)
			await pinOf(ctx, 0).hover()
			await settle(ctx)
		}
	},
	{
		name: "Refresh hovered",
		show: async (ctx) => {
			await pointerAway(ctx)
			await ctx.page.locator(ctx.sel).getByRole("button", { name: "Refresh", exact: true }).hover()
			await settle(ctx)
		}
	},
	{
		name: "Next hovered",
		show: async (ctx) => {
			await pointerAway(ctx)
			await pagerButton(ctx, "Next").hover()
			await settle(ctx)
		}
	},
	{
		name: "a filter hovered",
		show: async (ctx) => {
			await pointerAway(ctx)
			await ctx.page.locator(ctx.sel).locator("label", { has: ctx.page.getByRole("radio", { name: "Pinned" }) }).hover()
			await settle(ctx)
		}
	},
	{
		name: "search focused",
		show: async (ctx) => {
			await pointerAway(ctx)
			await ctx.page.locator(`${ctx.sel} input[placeholder^="Search"]`).click()
			await pointerAway(ctx)
			await settle(ctx)
		}
	},
	{
		name: "Refresh focused",
		show: (ctx) => tabTo(ctx, ctx.page.locator(`${ctx.sel} input[placeholder^="Search"]`))
	},
	{
		name: "the filters focused",
		show: (ctx) => tabTo(ctx, ctx.page.locator(ctx.sel).getByRole("button", { name: "Refresh", exact: true }))
	},
	{
		name: "Pin focused",
		show: (ctx) => tabTo(ctx, offOf(ctx, 0), true)
	},
	{
		name: "Next focused",
		show: (ctx) => tabTo(ctx, offOf(ctx, LORE_PAGE_SIZE - 1))
	},
	{
		name: "marked",
		show: async (ctx) => {
			await pointerAway(ctx)
			await marked(ctx)
			await settle(ctx)
		}
	},
	{
		name: "marked, the pinned Pin hovered",
		show: async (ctx) => {
			await pointerAway(ctx)
			const { mill } = await marked(ctx)
			await ctx.page.locator(`${ctx.sel} li[data-entry-id="${mill}"] button[aria-label^="Pin "]`).hover()
			await settle(ctx)
		}
	},
	{
		name: "the Pinned filter, nothing pinned",
		show: async (ctx) => {
			await pointerAway(ctx)
			await ctx.page.locator(ctx.sel).getByRole("radio", { name: "Pinned" }).check()
			await until(ctx.page, (sel) => !!document.querySelector(`${sel} ul > li:not([data-entry-id])`), ctx.sel, 10_000, () => "the Pinned filter drew no empty floor")
			await pointerAway(ctx)
			await settle(ctx)
		}
	},
	{
		name: "the last page",
		show: async (ctx) => {
			await pointerAway(ctx)
			await pagerButton(ctx, "Next").click()
			await until(ctx.page, (sel) => document.querySelectorAll(`${sel} li[data-entry-id]`).length === 2, ctx.sel, 10_000, () => "Next drew no last page")
			await pointerAway(ctx)
			await settle(ctx)
		}
	}
]

export const loreEntriesSpec: WidgetSpec = {
	name: "lore-entries",
	title: "Lore entries",
	root: '[data-widget="lore-entries"]',
	drawn: async (ctx, page) => {
		await until(page, (sel) => !!document.querySelector(`${sel} li[data-entry-id]`), ctx.sel, 30_000, () => "Lore entries drew no entry")
	},
	records: async (ctx) => {
		const wrong: string[] = []
		const seen = await rowsOn(ctx.page, ctx.sel)
		const server = await serverPage(ctx.page, ctx.f)
		if (names(seen.rows) !== names(server.rows)) wrong.push(`the first page reads ${names(seen.rows)}; the server's is ${names(server.rows)}`)
		if (server.total !== ENTRIES.length) wrong.push(`the server counts ${server.total} entries in the fixture's book, not ${ENTRIES.length}`)
		for (const r of seen.rows) {
			const e = ENTRIES.find((x) => x.name === r.name)
			if (!e) wrong.push(`the row "${r.name}" is none of the fixture's entries`)
			else if (r.keys !== e.keys) wrong.push(`${r.name}'s keys read ${JSON.stringify(r.keys)}, not ${JSON.stringify(e.keys)}`)
			if (ctx.f.entries.get(r.name) !== r.id) wrong.push(`the row "${r.name}" carries entry ${r.id}, not ${ctx.f.entries.get(r.name)}`)
			if (r.read !== "Not read in this session yet") wrong.push(`${r.name} reads ${JSON.stringify(r.read)} before the session's first turn`)
			if (r.pinned || r.off) wrong.push(`${r.name} shows a mark the fixture never set`)
		}
		if (seen.pager !== `1–${LORE_PAGE_SIZE} of ${ENTRIES.length}`) wrong.push(`the pager reads ${JSON.stringify(seen.pager)}`)
		if (seen.search !== `Search ${ENTRIES.length} entries`) wrong.push(`the search reads ${JSON.stringify(seen.search)}`)
		return wrong
	},
	exhibits: LORE_EXHIBITS,
	flows: [
		{
			name: "paging",
			run: async (ctx) => {
				const first = await serverPage(ctx.page, ctx.f)
				const second = await serverPage(ctx.page, ctx.f, { offset: LORE_PAGE_SIZE })
				await ctx.page.locator(ctx.sel).getByRole("button", { name: "Next", exact: true }).click()
				await showsNames(ctx, ctx.page, second.rows.map((r) => r.title), "Next")
				const pager = (await rowsOn(ctx.page, ctx.sel)).pager
				if (pager !== `${LORE_PAGE_SIZE + 1}–${ENTRIES.length} of ${ENTRIES.length}`) throw new Error(`on the last page the pager reads ${JSON.stringify(pager)}`)
				if (!(await ctx.page.locator(ctx.sel).getByRole("button", { name: "Next", exact: true }).isDisabled())) throw new Error("Next is still offered on the last page")
				await ctx.page.locator(ctx.sel).getByRole("button", { name: "Previous", exact: true }).click()
				await showsNames(ctx, ctx.page, first.rows.map((r) => r.title), "Previous")
				return `Next shows the server's second page (${second.rows.length} entries, ${pager}) and is then withheld; Previous returns to the first`
			}
		},
		{
			name: "sort",
			run: async (ctx) => {
				await pickSort(ctx, "Name")
				await showsNames(ctx, ctx.page, byName.slice(0, LORE_PAGE_SIZE), "sorted by Name")
				await pickSort(ctx, "Last read")
				const back = await serverPage(ctx.page, ctx.f)
				await showsNames(ctx, ctx.page, back.rows.map((r) => r.title), "sorted by Last read again")
				return `the Sort combobox orders by Name (${byName.slice(0, LORE_PAGE_SIZE).join(", ")}) and back`
			}
		},
		{
			name: "search",
			run: async (ctx) => {
				const field = ctx.page.locator(`${ctx.sel} input[placeholder^="Search"]`)
				await field.fill("mill")
				await showsNames(ctx, ctx.page, ["Old Mill"], 'searching "mill"')
				await field.fill("zzz")
				await until(ctx.page, (sel) => (document.querySelector(`${sel} ul > li:not([data-entry-id])`)?.textContent ?? "").trim() === "Nothing matches.", ctx.sel, 10_000, () => 'searching "zzz" did not say "Nothing matches."')
				await field.fill("")
				await showsNames(ctx, ctx.page, (await serverPage(ctx.page, ctx.f)).rows.map((r) => r.title), "the search cleared")
				return 'a title or key finds its entry ("mill": Old Mill); no match says so; clearing it shows the first page again'
			}
		},
		{
			name: "marks",
			run: async (ctx) => {
				const mill = ctx.f.entries.get("Old Mill")!
				const ferry = ctx.f.entries.get("Ferryman")!
				// Both on the first page of both copies, so a second socket's copy has them to refresh.
				for (const p of [ctx.page, ctx.second])
					for (const n of ["Old Mill", "Ferryman"])
						if (!(await rowsOn(p, ctx.sel)).rows.some((r) => r.name === n)) throw new Error(`${n} is not on the first page${p === ctx.page ? "" : " of the second socket's copy"}`)
				const pressed = ({ sel, id, label, on }: { sel: string; id: number; label: string; on: boolean }) =>
					document.querySelector(`${sel} li[data-entry-id="${id}"] button[aria-label^="${label}"]`)?.getAttribute("aria-pressed") === String(on)
				let t0 = Date.now()
				await ctx.page.locator(`${ctx.sel} li[data-entry-id="${mill}"]`).getByRole("button", { name: "Pin Old Mill" }).click()
				await until(ctx.page, pressed, { sel: ctx.sel, id: mill, label: "Pin ", on: true }, 10_000, () => "Pin did not press")
				await pushArrives(ctx, "Pin (lore:marked)", t0, pressed, { sel: ctx.sel, id: mill, label: "Pin ", on: true })
				t0 = Date.now()
				await ctx.page.locator(`${ctx.sel} li[data-entry-id="${ferry}"]`).getByRole("button", { name: "Turn Ferryman off" }).click()
				await until(ctx.page, pressed, { sel: ctx.sel, id: ferry, label: "Turn ", on: true }, 10_000, () => "Off did not press")
				await pushArrives(ctx, "Off (lore:marked)", t0, pressed, { sel: ctx.sel, id: ferry, label: "Turn ", on: true })
				const struck = (await rowsOn(ctx.page, ctx.sel)).rows.find((r) => r.id === ferry)?.struck
				if (!struck) throw new Error("an entry turned off is not struck through")
				// The server's, and they survive a reload.
				const server = (await serverPage(ctx.page, ctx.f, { sort: "name" })).rows
				const all = [...server, ...(await serverPage(ctx.page, ctx.f, { sort: "name", offset: LORE_PAGE_SIZE })).rows]
				if (!all.find((r) => r.id === mill)?.pinned || !all.find((r) => r.id === ferry)?.off)
					throw new Error(`the server holds Old Mill pinned ${all.find((r) => r.id === mill)?.pinned}, Ferryman off ${all.find((r) => r.id === ferry)?.off}`)
				await reloadOn(ctx, loreEntriesSpec)
				const after = (await rowsOn(ctx.page, ctx.sel)).rows
				if (!after.find((r) => r.id === mill)?.pinned || !after.find((r) => r.id === ferry)?.off) throw new Error("after a reload the marks are gone")
				// The filters read the marks.
				await ctx.page.locator(ctx.sel).getByRole("radio", { name: "Pinned" }).check()
				await showsNames(ctx, ctx.page, ["Old Mill"], "the Pinned filter")
				await ctx.page.locator(ctx.sel).getByRole("radio", { name: "Off" }).check()
				await showsNames(ctx, ctx.page, ["Ferryman"], "the Off filter")
				await ctx.page.locator(ctx.sel).getByRole("radio", { name: "All" }).check()
				// Undone the same way.
				await ctx.page.locator(`${ctx.sel} li[data-entry-id="${mill}"]`).getByRole("button", { name: "Pin Old Mill" }).click()
				await until(ctx.page, pressed, { sel: ctx.sel, id: mill, label: "Pin ", on: false }, 10_000, () => "Pin did not release")
				await ctx.page.locator(`${ctx.sel} li[data-entry-id="${ferry}"]`).getByRole("button", { name: "Turn Ferryman off" }).click()
				await until(ctx.page, pressed, { sel: ctx.sel, id: ferry, label: "Turn ", on: false }, 10_000, () => "Off did not release")
				await until(ctx.second, pressed, { sel: ctx.sel, id: ferry, label: "Turn ", on: false }, 10_000, () => "the second socket's copy kept Ferryman off")
				return "Pin and Off press, are the server's, reach a second socket's copy (lore:marked), survive a reload and drive the Pinned and Off filters; pressed again they release"
			}
		},
		{
			name: "rankings",
			run: async (ctx) => {
				const judged = ["Lantern Bridge", "Old Mill"]
				const readOf = async (p: Page) => Object.fromEntries((await rowsOn(p, ctx.sel)).rows.map((r) => [r.name, r.read]))
				for (const p of [ctx.page, ctx.second]) {
					const read = await readOf(p)
					for (const n of judged)
						if (read[n] !== "Not read in this session yet") throw new Error(`before the turn ${n} reads ${JSON.stringify(read[n])}${p === ctx.page ? "" : " on the second socket"}`)
				}
				// The fixture's one turn, sent from this page's composer; its line names both entries' keys.
				await takeTheTurn(ctx.page, ctx.f)
				const read = ({ sel, names }: { sel: string; names: string[] }) => {
					const rows = [...document.querySelectorAll(`${sel} li[data-entry-id]`)].map((li) =>
						[...li.querySelectorAll(":scope > span:first-child > span")].map((s) => (s.textContent ?? "").replace(/\s+/g, " ").trim())
					)
					return names.every((n) => rows.some((r) => r[0] === n && /^read \d+ of \d+\b/.test(r.at(-1) ?? "")))
				}
				await until(ctx.page, read, { sel: ctx.sel, names: judged }, 20_000, async () => `after the turn the rows read ${JSON.stringify(await readOf(ctx.page))}`)
				// The rankings land when the run ends (after its last step, not its reply's last word):
				// timed from this page's refresh, the push is how far the second socket trails it.
				const t0 = Date.now()
				await pushArrives(ctx, "rankings (lore:ranked)", t0, read, { sel: ctx.sel, names: judged })
				const server = [...(await serverPage(ctx.page, ctx.f, { sort: "name" })).rows, ...(await serverPage(ctx.page, ctx.f, { sort: "name", offset: LORE_PAGE_SIZE })).rows]
				for (const n of judged)
					if (!server.find((r) => r.title === n)?.timesJudged) throw new Error(`the server has no judgement of ${n} for this session`)
				return "the fixture's turn judges the two entries its line names, and both copies show it without a reload (lore:ranked)"
			}
		}
	],
	reset: async (ctx) => {
		await open(ctx.page, URL_BASE)
		await booted(ctx.page)
		for (const id of ctx.f.entries.values())
			await ask(ctx.page, "entries:setMarks", { entryId: id, off: false, pinned: false }, { where: { entryId: id }, refusable: true })
	}
}
