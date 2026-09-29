/**
 * What a side-widget spec is, and the helpers every one of them uses —
 * apart from `widgets.ts`, which runs them, so a spec never imports its
 * runner.
 */
import type { Page } from "playwright"
import { REMOTE_BOX, booted, open, reopen } from "../engine"
import type { AdventureFixture } from "./adventure"

/** How long a change may take to reach a second socket's copy of the widget. */
export const PUSH_BOUND_MS = 5_000

export type WidgetCtx = {
	page: Page
	/** A second page on the same session: its own socket, its own copy of the widget. */
	second: Page
	f: AdventureFixture
	/** The widget's root, inside its remote box: prefix every selector with it. */
	sel: string
	/** Says how long a push took, for the run's log. */
	pushed: (what: string, ms: number) => void
}

export type WidgetSpec = {
	/** The widget id (`world-state`), and the golden's name (`widget-<name>`). */
	name: string
	/** The remote box's accessible name: the widget's title. */
	title: string
	/** The widget's root element, as its component draws it. */
	root: string
	/** Resolves once the widget has drawn the fixture's data (not merely mounted). */
	drawn: (ctx: WidgetCtx, page: Page) => Promise<void>
	/** What the widget must show of the fixture, outright: each string a failure. */
	records: (ctx: WidgetCtx) => Promise<string[]>
	/**
	 * States the snapshot never shows, each read and judged exactly as the
	 * snapshot is (structure, attributes, text, computed styles, axe, Tab
	 * order) and recorded beside it (`exhibits` in the golden): a menu opened, the
	 * other source's layout, a control under the pointer. The runner puts the
	 * fixture back (`reset`) and opens the widget before each; `show` then
	 * brings the state about and resolves once it has settled.
	 */
	exhibits?: Array<{ name: string; show: (ctx: WidgetCtx) => Promise<void> }>
	/** The flows, in order; each returns its sentence or throws why. */
	flows: Array<{ name: string; run: (ctx: WidgetCtx) => Promise<string> }>
	/** Put back what the flows changed. */
	reset: (ctx: WidgetCtx) => Promise<void>
}

/** The widget's root inside a core remote box. */
export const inBox = (root: string) => `${REMOTE_BOX} ${root}`

/**
 * Open a session page with the whole window for the session. The shell keeps
 * a docked view (a sidebar) open across pages, per browser context — visiting
 * /admin leaves the Admin view docked — and a docked view narrows the
 * session's box; below the layout's threshold its sides TUCK to their rails
 * (sessionLayout/tuckedSides.ts), and a widget in a tucked side is not
 * mounted until its flyout is opened (mount on first show). A spec that
 * judges a seated side widget closes the view first, as a person would.
 */
export async function openSession(page: Page, url: string) {
	await open(page, url)
	await booted(page)
	const view = page.locator("[data-shell-sidebar]")
	if (!(await view.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false))) return
	await view.locator('button[aria-label^="Close "]:visible').first().click()
	await view.waitFor({ state: "hidden", timeout: 10_000 })
}

/** The Admin view in the shell: every admin section renders inside it. */
export const ADMIN_VIEW = '[data-sidebar-view="admin"]'

/**
 * Open an admin address cold. `/admin/**` renders an empty page: the shell
 * opens the Admin view in Focus at that section, over `<main>` (hidden,
 * never unmounted). Resolves once the view is showing in Focus, and returns
 * it — scope every admin selector under it.
 */
export async function openAdmin(page: Page, url: string) {
	await open(page, url)
	await booted(page)
	const view = page.locator(ADMIN_VIEW)
	await view.waitFor({ state: "visible", timeout: 60_000 })
	await page.locator("main[hidden]").waitFor({ state: "attached", timeout: 30_000 })
	return view
}

/** Open the session and wait for the widget to have drawn the fixture. */
export async function openOn(ctx: WidgetCtx, spec: WidgetSpec, page: Page = ctx.page) {
	await open(page, ctx.f.url)
	await page.waitForSelector(ctx.sel, { timeout: 60_000 })
	await spec.drawn(ctx, page)
}

/** Reload, and wait for the widget again. */
export async function reloadOn(ctx: WidgetCtx, spec: WidgetSpec, page: Page = ctx.page) {
	if (page === ctx.page) await reopen(page)
	else await page.reload({ waitUntil: "load" })
	await page.waitForSelector(ctx.sel, { timeout: 60_000 })
	await spec.drawn(ctx, page)
}

/**
 * Wait until `fn(arg)` holds on `page`, or throw `why()` — a page function
 * asked again every animation frame, so the moment it first holds is the
 * moment it is seen.
 */
export async function until<A>(page: Page, fn: (arg: A) => boolean, arg: A, timeout: number, why: () => Promise<string> | string) {
	const ok = await page.waitForFunction(fn as (arg: unknown) => boolean, arg as unknown, { timeout, polling: "raf" }).then(
		() => true,
		() => false
	)
	if (!ok) throw new Error(await why())
}

/**
 * A change reaching the second socket: from `t0` (just before the press that
 * made it) until the second page's copy shows it. Over PUSH_BOUND_MS fails.
 */
export async function pushArrives<A>(ctx: WidgetCtx, what: string, t0: number, fn: (arg: A) => boolean, arg: A) {
	await until(ctx.second, fn, arg, PUSH_BOUND_MS + 10_000, () => `${what} never reached the second socket's copy`)
	const ms = Date.now() - t0
	ctx.pushed(what, ms)
	if (ms > PUSH_BOUND_MS) throw new Error(`${what} took ${ms}ms to reach the second socket's copy (allowed ${PUSH_BOUND_MS}ms)`)
}

/** Text of the first element `sel` names, flattened; null when there is none. */
export const textOf = (page: Page, sel: string) =>
	page.evaluate((sel) => {
		const el = document.querySelector(sel)
		return el ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : null
	}, sel)
