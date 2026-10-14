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
