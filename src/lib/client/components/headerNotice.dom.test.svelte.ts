/**
 * The session header's notice slot (PLAN-core-widgets §3.16): the
 * stale-preset notice left the composer's area — a pipeline substitution is
 * not a turn fact — and is the header's one line now, dismissible for this
 * view. The page builds it (`presetHeaderNotice`) and hands it up through
 * `openSessionCtx.headerNotice`; the header draws it; the banners host view
 * keeps only who is typing.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Header from "./Header.svelte"
import SessionBanners from "./sessionPage/SessionBanners.svelte"
import { presetHeaderNotice } from "./sessionPage/presetNotice"

const stale = (n: number): Sockets.Sessions.PresetStatus.Response => ({
	sessionId: 1,
	presetId: 7,
	presetName: "Night Shift",
	stale: [
		{ event: "reply", bound: "acme:gone-reply" },
		{ event: "advance", bound: "acme:gone-advance" }
	].slice(0, n) as Sockets.Sessions.PresetStatus.Response["stale"]
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

describe("presetHeaderNotice: the banner's words, on one line", () => {
	test("a member is told which events run the default; nothing to fix", () => {
		const page = { presetStatus: stale(2), presetBannerDismissed: false }
		const notice = presetHeaderNotice(page, false)!
		expect(notice.text).toBe(
			"This session is running the default pipeline for reply, advance."
		)
		expect(notice.link).toBeNull()
	})

	test("an administrator is told which binding, and where to fix it", () => {
		const page = { presetStatus: stale(1), presetBannerDismissed: false }
		const notice = presetHeaderNotice(page, true)!
		expect(notice.text).toBe(
			"This session runs the default pipeline: preset Night Shift binds reply to acme:gone-reply — which is not available."
		)
		expect(notice.link).toEqual({
			href: "/admin/session-presets/7#bindings",
			label: "Fix the binding"
		})
	})

	test("nothing stale, or dismissed for this view: no notice; Dismiss sets the page's flag", () => {
		expect(
			presetHeaderNotice(
				{ presetStatus: undefined, presetBannerDismissed: false },
				true
			)
		).toBeNull()
		expect(
			presetHeaderNotice(
				{ presetStatus: stale(0), presetBannerDismissed: false },
				true
			)
		).toBeNull()
		const page = { presetStatus: stale(1), presetBannerDismissed: false }
		presetHeaderNotice(page, false)!.dismiss()
		expect(page.presetBannerDismissed).toBe(true)
		expect(presetHeaderNotice(page, false)).toBeNull()
	})
})

describe("the header's notice slot", () => {
	test("draws the notice under the bar, with its link and Dismiss, and goes when it does", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {}
		})
		const ctx = $state<Partial<OpenSessionCtx>>({
			sessionId: 1,
			sessionName: "The Lantern Inn",
			genreName: "Chat",
			cast: [],
			headerNotice: null
		})
		app = mount(Header, {
			target: document.body,
			props: {},
			context: new Map<string, unknown>([["openSessionCtx", ctx]])
		})
		flushSync()
		expect(document.querySelector("[data-header-notice]")).toBeNull()

		const dismiss = vi.fn(() => {
			ctx.headerNotice = null
		})
		ctx.headerNotice = {
			text: "This session runs the default pipeline: preset Night Shift binds reply to acme:gone-reply — which is not available.",
			link: {
				href: "/admin/session-presets/7#bindings",
				label: "Fix the binding"
			},
			dismiss
		}
		flushSync()
		const notice = document.querySelector<HTMLElement>(
			"header [data-header-notice]"
		)!
		expect(notice).not.toBeNull()
		expect(notice.getAttribute("role")).toBe("status")
		// One line: the whole sentence on hover.
		const line = notice.querySelector("p")!
		expect(line.getAttribute("title")).toContain(
			"binds reply to acme:gone-reply"
		)
		expect(notice.querySelector("a")?.getAttribute("href")).toBe(
			"/admin/session-presets/7#bindings"
		)

		notice
			.querySelector<HTMLButtonElement>(
				'button[aria-label="Dismiss this notice"]'
			)!
			.click()
		flushSync()
		expect(dismiss).toHaveBeenCalledOnce()
		expect(document.querySelector("[data-header-notice]")).toBeNull()
		vi.unstubAllGlobals()
	})
})

/**
 * 🚧 Back · Forward (RF fix 5) are the header's since polish parity L1
 * (2026-10-24): two icon buttons at the head of the trailing cluster, drawn
 * from `openSessionCtx.rewind` — none without it. Greyed, never disabled: a
 * grey press is `aria-disabled`, says why, and does nothing.
 */
describe("the header's Back · Forward", () => {
	const mountWith = (rewind: SessionHeaderRewind | null) => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {}
		})
		const ctx = $state<Partial<OpenSessionCtx>>({
			sessionId: 1,
			sessionName: "The Lantern Inn",
			genreName: "Chat",
			cast: [],
			rewind
		})
		app = mount(Header, {
			target: document.body,
			props: {},
			context: new Map<string, unknown>([["openSessionCtx", ctx]])
		})
		flushSync()
		return ctx
	}
	const press = (label: string) =>
		document.querySelector<HTMLButtonElement>(`header button[aria-label="${label}"]`)
	afterEach(() => vi.unstubAllGlobals())

	test("no state, no buttons", () => {
		mountWith(null)
		expect(press("Back one turn")).toBeNull()
		expect(press("Forward one turn")).toBeNull()
	})

	test("Back presses; Forward is grey with its reason and presses nothing", () => {
		const goBack = vi.fn()
		const goForward = vi.fn()
		mountWith({
			back: { disabled: false },
			forward: { disabled: true, reason: "There is nothing ahead to bring back." },
			ahead: 0,
			aheadText: "",
			goBack,
			goForward,
			regenerate: null
		})
		const back = press("Back one turn")!
		const forward = press("Forward one turn")!
		expect(back.getAttribute("title")).toBe("Back one turn")
		expect(back.getAttribute("aria-disabled")).toBe("false")
		expect(forward.getAttribute("aria-disabled")).toBe("true")
		expect(forward.getAttribute("title")).toBe(
			"Forward one turn — There is nothing ahead to bring back."
		)
		const note = document.getElementById(forward.getAttribute("aria-describedby")!)
		expect(note?.textContent?.trim()).toBe("There is nothing ahead to bring back.")
		forward.click()
		back.click()
		expect(goForward).not.toHaveBeenCalled()
		expect(goBack).toHaveBeenCalledOnce()
	})

	test("rewound: Forward says how many turns are ahead", () => {
		const goForward = vi.fn()
		mountWith({
			back: { disabled: true, reason: "There is nothing to go back to yet." },
			forward: { disabled: false },
			ahead: 2,
			aheadText: "2 turns ahead",
			goBack: vi.fn(),
			goForward,
			regenerate: null
		})
		const forward = press("Forward one turn")!
		expect(forward.getAttribute("title")).toBe("Forward one turn (2 turns ahead)")
		forward.click()
		expect(goForward).toHaveBeenCalledOnce()
		expect(press("Back one turn")!.getAttribute("aria-disabled")).toBe("true")
	})

	test("pr-6 D2: Regenerate sits third, grey with its reason; enabled, it presses", () => {
		const grey = vi.fn()
		mountWith({
			back: { disabled: false },
			forward: { disabled: false },
			ahead: 0,
			aheadText: "",
			goBack: vi.fn(),
			goForward: vi.fn(),
			regenerate: { disabled: true, reason: "Your line is the newest. Press Continue.", press: grey }
		})
		const regenerate = press("Regenerate the last turn")!
		expect(regenerate.getAttribute("data-header-rewind")).toBe("regenerate")
		expect(regenerate.getAttribute("aria-disabled")).toBe("true")
		expect(regenerate.getAttribute("title")).toBe(
			"Regenerate the last turn — Your line is the newest. Press Continue."
		)
		const note = document.getElementById(regenerate.getAttribute("aria-describedby")!)
		expect(note?.textContent?.trim()).toBe("Your line is the newest. Press Continue.")
		regenerate.click()
		expect(grey).not.toHaveBeenCalled()
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
		const go = vi.fn()
		mountWith({
			back: { disabled: false },
			forward: { disabled: false },
			ahead: 0,
			aheadText: "",
			goBack: vi.fn(),
			goForward: vi.fn(),
			regenerate: { disabled: false, press: go }
		})
		press("Regenerate the last turn")!.click()
		expect(go).toHaveBeenCalledOnce()
	})

	test("pr-6 D2: no Regenerate where the genre offers none", () => {
		mountWith({
			back: { disabled: false },
			forward: { disabled: false },
			ahead: 0,
			aheadText: "",
			goBack: vi.fn(),
			goForward: vi.fn(),
			regenerate: null
		})
		expect(press("Regenerate the last turn") === null).toBe(true)
	})
})

describe("the banners host view keeps only who is typing", () => {
	test("everyone typing as one pill (it takes no preset status: the header draws that notice)", () => {
		app = mount(SessionBanners, {
			target: document.body,
			props: {
				typing: [{ name: "Ann" }, { name: "Bo" }],
				showTyping: true
			}
		})
		flushSync()
		expect(document.body.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Ann and Bo are typing…"
		)
	})

	test("nobody typing, or no composer to type into: nothing", () => {
		app = mount(SessionBanners, {
			target: document.body,
			props: { typing: [{ name: "Ann" }], showTyping: false }
		})
		flushSync()
		expect(document.body.textContent?.trim()).toBe("")
	})
})

describe("pr-6 D4: the notice's action and the Archived mark", () => {
	const mountCtx = (extra: Partial<OpenSessionCtx>) => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {}
		})
		const ctx = $state<Partial<OpenSessionCtx>>({
			sessionId: 1,
			sessionName: "The Lantern Inn",
			genreName: "Chat",
			cast: [],
			...extra
		})
		app = mount(Header, {
			target: document.body,
			props: {},
			context: new Map<string, unknown>([["openSessionCtx", ctx]])
		})
		flushSync()
		return ctx
	}
	afterEach(() => vi.unstubAllGlobals())

	test("a notice with an action draws its button; pressing calls press once", () => {
		const press = vi.fn()
		mountCtx({
			headerNotice: {
				text: "Catch up?",
				link: null,
				dismiss: vi.fn(),
				action: { label: "Catch up on Inn", press }
			}
		})
		const button = document.querySelector<HTMLButtonElement>("[data-header-notice-action]")!
		expect(button.textContent?.trim()).toBe("Catch up on Inn")
		button.click()
		expect(press).toHaveBeenCalledOnce()
	})

	test("a notice without an action draws no such button", () => {
		mountCtx({ headerNotice: { text: "Plain", link: null, dismiss: vi.fn() } })
		expect(document.querySelector("[data-header-notice-action]") === null).toBe(true)
	})

	test("archived draws the mark; absent, none", () => {
		mountCtx({ archived: true })
		expect(document.querySelector("[data-archived]")?.textContent?.trim()).toBe("Archived")
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
		mountCtx({})
		expect(document.querySelector("[data-archived]") === null).toBe(true)
	})
})
