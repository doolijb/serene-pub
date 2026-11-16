/** Header's Back says what it takes (playtest item 6): the words in its title and its sr-only description. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Header from "./Header.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	vi.unstubAllGlobals()
})

const TAKES = "your line and 3 replies (Ash, Birch, Narrator)"

function mountWith(
	back: { disabled: boolean; reason?: string; takes?: string },
	step?: "message" | "turn"
) {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} })
	const rewind = {
		back,
		forward: { disabled: true },
		ahead: 0,
		aheadText: "",
		...(step ? { step } : {}),
		goBack: () => {},
		goForward: () => {}
	}
	const ctx = $state<Record<string, unknown>>({
		sessionId: 1,
		sessionName: "The Lantern Inn",
		genreName: "Chat",
		cast: [],
		rewind: rewind as never
	})
	app = mount(Header, {
		target: document.body,
		props: {},
		context: new Map<string, unknown>([["openSessionCtx", ctx]])
	})
	flushSync()
	return document.querySelector<HTMLButtonElement>(
		`header button[aria-label="${step === "message" ? "Back one message" : "Back one turn"}"]`
	)!
}

describe("the header's Back, in words", () => {
	test("an enabled Back with takes: title and description say what it takes", () => {
		const b = mountWith({ disabled: false, takes: TAKES })
		expect(b.getAttribute("title")).toBe(`Back: ${TAKES}`)
		const id = b.getAttribute("aria-describedby")
		expect(id === null).toBe(false)
		expect(document.getElementById(id!)?.textContent?.trim()).toBe(`Back: ${TAKES}`)
	})

	test("a greyed Back keeps its reason", () => {
		const b = mountWith({ disabled: true, reason: "Wait for the reply to finish." })
		expect(b.getAttribute("title")).toBe("Back one turn — Wait for the reply to finish.")
		expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent?.trim()).toBe(
			"Wait for the reply to finish."
		)
	})

	test("where one press takes a message, the button says so", () => {
		// Story steps by message; a genre that takes a whole turn, and a host
		// that says nothing, keep "turn" (the cases around this one).
		const plain = mountWith({ disabled: false }, "message")
		expect(plain.getAttribute("aria-label")).toBe("Back one message")
		expect(plain.getAttribute("title")).toBe("Back one message")
		expect(
			document.querySelector('header button[aria-label="Forward one message"]') === null
		).toBe(false)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		const grey = mountWith({ disabled: true, reason: "Wait for the reply to finish." }, "message")
		expect(grey.getAttribute("title")).toBe("Back one message — Wait for the reply to finish.")
	})

	test("neither: plain title, nothing described", () => {
		const b = mountWith({ disabled: false })
		expect(b.getAttribute("title")).toBe("Back one turn")
		expect(b.hasAttribute("aria-describedby")).toBe(false)
	})
})
