/**
 * 🚧 The Admin view keeps its section through a change of width (RF fix 2,
 * item 5, 2026-10-23): Escape out of Focus narrowed the view from desk to
 * dock, the section was drawn in another branch and mounted afresh, and the
 * ruleset editor's unsaved edits were gone with no question asked. Now the
 * section has one place at every width; and Escape, with edits unsaved, asks
 * **Stay** · **Discard** before the shell steps the view down.
 *
 * 🚧 RF fix 3 (owner, 2026-10-23: "only ask if unsaved changes"): the question
 * is asked ONLY while something is unsaved — Escape, closing the view, the
 * section list and browser Back alike. A clean section, or an edit typed and
 * typed back, goes on without a word.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$app/navigation", () => ({ goto: vi.fn(), pushState: vi.fn(), replaceState: vi.fn() }))
vi.mock("$app/state", () => ({ page: { data: {}, state: {}, url: new URL("http://localhost/admin/probe") } }))
vi.mock("$lib/client/shell/viewMode.svelte", async () => {
	const kit = await import("./adminViewFixture.svelte")
	return {
		DESK_MIN_PX: 900,
		ViewModeTracker: class {
			get mode() {
				return kit.viewMode.value
			}
			get width() {
				return kit.viewMode.value === "desk" ? 1200 : 400
			}
			observe = () => ({ destroy() {} })
		}
	}
})
vi.mock("./adminHealth.svelte", () => ({
	adminHealth: { connect: () => () => {}, refresh: () => {}, attention: [], worst: null, levelFor: () => null }
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	ADMIN_INTEREST_CONTEXT: Symbol("admin-interest"),
	interestContextValue: () => ({})
}))
// The probe section is imported when the route asks for it, never in the factory: the probe
// imports the router, which imports this very module (a factory awaiting it would never settle).
vi.mock("./adminRoutes", () => ({
	resolveAdminAlias: (href: string) => href,
	matchAdminRoute: (path: string) =>
		path === "/admin"
			? { route: null, params: {}, pattern: "/admin" }
			: path === "/admin/gone"
				? // 🚧 A section whose file is gone (a tab on the build before an update; RF fix 6).
					{ route: { page: () => Promise.reject(new Error("Failed to fetch dynamically imported module")) }, params: {}, pattern: path }
				: { route: { page: () => import("./AdminViewProbeFixture.svelte") }, params: {}, pattern: path },
	sectionHrefFor: () => "/admin/probe"
}))

import AdminView from "./AdminView.svelte"
import { adminRouter } from "./adminRouter.svelte"
import { probe, viewMode } from "./adminViewFixture.svelte"

const ctx = () =>
	new Map<string, unknown>([
		["userCtx", { user: { id: 1, isAdmin: true } }],
		["systemSettingsCtx", { settings: { isAccountsEnabled: true } }]
	])
const settle = async () => {
	for (let i = 0; i < 4; i++) {
		await tick()
		await Promise.resolve()
	}
	flushSync()
}

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	probe.mounts = 0
	viewMode.value = "desk"
})

async function openProbe(props: Record<string, unknown> = {}) {
	adminRouter.adopt("/admin/probe")
	app = mount(AdminView, { target: document.body, context: ctx(), props })
	// The section loads as a route does (a dynamic import): wait for it.
	for (let i = 0; i < 100 && !document.getElementById("probe-field"); i++) {
		await new Promise((r) => setTimeout(r, 20))
		flushSync()
	}
	await settle()
}
const field = () => document.getElementById("probe-field") as HTMLInputElement | null
const typeInto = (value: string) => {
	const el = field()!
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
/** Whether the unsaved-changes question is open (the dialog's content stays mounted, hidden, while closed). */
const asking = () => {
	const el = document.querySelector("[data-unsaved-changes]") as HTMLElement | null
	return !!el && !el.hidden && el.getAttribute("data-state") !== "closed"
}
/** A view prop the shell binds (`onescape`, `onclose`), held where the test can call it. */
function gates() {
	const held: { onescape?: () => Promise<boolean> | undefined; onclose?: () => Promise<boolean> | undefined } = {}
	const props = {
		get onescape() {
			return held.onescape
		},
		set onescape(v: (() => Promise<boolean> | undefined) | undefined) {
			held.onescape = v
		},
		get onclose() {
			return held.onclose
		},
		set onclose(v: (() => Promise<boolean> | undefined) | undefined) {
			held.onclose = v
		}
	}
	return { held, props }
}
async function waitForField() {
	for (let i = 0; i < 100 && !field(); i++) {
		await new Promise((r) => setTimeout(r, 20))
		flushSync()
	}
	await settle()
}

describe("🚧 the Admin view through a change of width", () => {
	test("desk → dock → desk keeps the section mounted, and its unsaved edits with it", async () => {
		await openProbe()
		expect(probe.mounts).toBe(1)
		typeInto("half a ruleset")
		expect(adminRouter.hasUnsavedEdits).toBe(true)
		viewMode.value = "compact"
		await settle()
		expect(probe.mounts).toBe(1)
		expect(field()?.value).toBe("half a ruleset")
		viewMode.value = "desk"
		await settle()
		expect(probe.mounts).toBe(1)
		expect(field()?.value).toBe("half a ruleset")
	})

	test("Escape with unsaved edits asks first: Stay keeps everything; Discard mounts the section afresh, then the view steps down", async () => {
		const gate: { onescape?: () => Promise<boolean> | undefined } = {}
		await openProbe({
			get onescape() {
				return gate.onescape
			},
			set onescape(v: (() => Promise<boolean> | undefined) | undefined) {
				gate.onescape = v
			}
		})
		expect(typeof gate.onescape).toBe("function")
		// Nothing unsaved: Escape goes on without a word.
		expect(await gate.onescape!()).toBe(true)
		typeInto("a vow")
		const stay = gate.onescape!()!
		await settle()
		expect(!!document.querySelector("[data-unsaved-changes]")).toBe(true)
		expect(document.querySelector("[data-unsaved-changes] h2, [data-unsaved-changes] [id$=title]")?.textContent?.trim()).toBe("You have unsaved changes")
		// The probe registers no Save of its own: Stay · Discard only.
		expect(!!document.querySelector("[data-unsaved-save]")).toBe(false)
		button("Stay")!.click()
		expect(await stay).toBe(false)
		expect(field()?.value).toBe("a vow")
		const discard = gate.onescape!()!
		await settle()
		button("Discard")!.click()
		expect(await discard).toBe(true)
		await settle()
		expect(probe.mounts).toBe(2)
		expect(field()?.value).toBe("")
		expect(adminRouter.hasUnsavedEdits).toBe(false)
	})
})

describe("🚧 the question, only while something is unsaved (RF fix 3)", () => {
	test("Escape and closing the view ask nothing of a clean section — nor of an edit typed and typed back", async () => {
		const { held, props } = gates()
		await openProbe(props)
		expect(await held.onescape!()).toBe(true)
		expect(await held.onclose!()).toBe(true)
		await settle()
		expect(asking()).toBe(false)
		typeInto("a vow")
		typeInto("")
		expect(adminRouter.hasUnsavedEdits).toBe(false)
		expect(await held.onescape!()).toBe(true)
		expect(await held.onclose!()).toBe(true)
		await settle()
		expect(asking()).toBe(false)
		expect(probe.mounts).toBe(1)
	})

	test("closing the view with an edit unsaved asks; Stay keeps the edit", async () => {
		const { held, props } = gates()
		await openProbe(props)
		typeInto("half a vow")
		const closing = held.onclose!()!
		await settle()
		expect(asking()).toBe(true)
		button("Stay")!.click()
		expect(await closing).toBe(false)
		expect(field()?.value).toBe("half a vow")
	})

	test("browser Back to another section follows a clean section at once, and asks first while an edit is unsaved", async () => {
		await openProbe()
		history.pushState({}, "", "/admin/other")
		window.dispatchEvent(new PopStateEvent("popstate"))
		await settle()
		expect(asking()).toBe(false)
		expect(adminRouter.path).toBe("/admin/other")
		await waitForField()
		typeInto("kept")
		history.pushState({}, "", "/admin/third")
		window.dispatchEvent(new PopStateEvent("popstate"))
		await settle()
		expect(asking()).toBe(true)
		button("Stay")!.click()
		await settle()
		expect(adminRouter.path).toBe("/admin/other")
		expect(field()?.value).toBe("kept")
	})
})

describe("🚧 a section that does not load (RF fix 6, 2026-10-23)", () => {
	test("the section before it is not left live under the new address: the view says the page did not load", async () => {
		await openProbe()
		expect(!!field()?.closest("[inert]")).toBe(false)
		await adminRouter.go("/admin/gone")
		flushSync()
		// While the next section loads, the one on screen takes no input.
		expect(!!document.getElementById("probe-field")?.closest("[inert]") || !document.getElementById("probe-field")).toBe(true)
		await settle()
		expect(!!document.querySelector("[data-admin-load-failed]")).toBe(true)
		expect(text("[data-admin-load-failed]")).toContain("This page did not load.")
		expect(!!field()).toBe(false)
	})
})

function text(selector: string): string {
	return document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
}
