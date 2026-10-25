/**
 * 🚧 The session's Attributes card, **Who carries what** (attribute carries,
 * RF fix 2 item 3, 2026-10-23): each holder of the rules' OPTIONAL attributes
 * with a **Carries ‹attribute›** switch — the one the caller may change is a
 * switch, one they may not is said in words — and a switch sends
 * `state:setCarry` for that holder. 🚧 RF fix 8: attributes are the rules'
 * alone — one they require is no one's to switch, so not listed; rules that
 * declare none (Freeform, From scratch) say so.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

const { emitted, socket, listeners, listen } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	const listen = (key: string, handler: (msg: any) => void) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	}
	return { emitted, listeners, listen, socket: { emit: (event: string, payload: unknown) => emitted.push([event, payload]), on: () => {}, off: () => {} } }
})
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({ declareInterest: listen }))

import SessionAttributes from "./SessionAttributes.svelte"

const feed = (key: string, msg: unknown) => {
	for (const h of [...(listeners.get(key) ?? [])]) h(msg)
	flushSync()
}

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
})

const VIEW = {
	sessionId: 7,
	declaresAttributes: true,
	canEdit: false,
	rulesets: ["acme:ruleset/hearts@1"],
	carries: [
		{
			slotId: "acme.hearts:slot/nerve@1",
			label: "Nerve",
			required: false,
			holders: [
				{ owner: { kind: "session_cast", id: 3 }, name: "Wren", carries: true, mayChange: true },
				{ owner: { kind: "session_cast", id: 4 }, name: "Mara", carries: false, mayChange: false }
			]
		}
	]
}

const text = (selector: string) => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? ""

describe("🚧 who carries what", () => {
	test("each holder, a switch each where the caller may change it; words where not; a required one always", () => {
		app = mount(SessionAttributes, { target: document.body, props: { sessionId: 7, cardClass: "" } })
		flushSync()
		feed("state:attributes", VIEW)
		expect(text("[data-carries]").length > 0).toBe(true)
		expect(text('[data-carry-holder="Wren"] [data-carry="acme.hearts:slot/nerve@1"]')).toBe("Carries Nerve")
		const sw = document.querySelector<HTMLInputElement>('[data-carry-holder="Wren"] [data-carry="acme.hearts:slot/nerve@1"] input[type="checkbox"]')
		expect(!!sw).toBe(true)
		// Labelled by its own words.
		expect(document.getElementById(sw!.getAttribute("aria-labelledby") ?? "")?.textContent?.trim()).toBe("Carries Nerve")
		expect(text('[data-carry-holder="Mara"] [data-carry="acme.hearts:slot/nerve@1"]')).toBe("Carries Nerve No")
		// A required one is no one's to switch: never listed.
		expect(text('[data-carry="acme.hearts:slot/heart@1"]')).toBe("")
		expect(sw!.checked).toBe(true)
		sw!.click()
		flushSync()
		const sent = emitted.filter(([e]) => e === "state:setCarry").map(([, p]) => p)
		expect(sent).toEqual([{ sessionId: 7, owner: { kind: "session_cast", id: 3 }, slotId: "acme.hearts:slot/nerve@1", carries: false }])
	})

	test("rules that declare no attributes say so, in words with no machinery in them", () => {
		app = mount(SessionAttributes, { target: document.body, props: { sessionId: 7, cardClass: "" } })
		flushSync()
		feed("state:attributes", { sessionId: 7, declaresAttributes: false, canEdit: true, rulesets: ["core:ruleset/freeform@1"] })
		expect(text("[data-declares-none]")).toBe("This session's rules declare no attributes.")
		expect(text("[data-carries]")).toBe("")
		expect(/ruleset|rigour|repertoire|slot|config/i.test(document.body.textContent ?? "")).toBe(false)
	})

	test("rules whose attributes everyone carries say that instead of switches", () => {
		app = mount(SessionAttributes, { target: document.body, props: { sessionId: 7, cardClass: "" } })
		flushSync()
		feed("state:attributes", { sessionId: 7, declaresAttributes: true, canEdit: true, rulesets: ["acme:ruleset/hearts@1"] })
		expect(document.body.textContent).toContain("Everyone the rules name carries every attribute they keep.")
	})

	test("a refused switch is said in the card", () => {
		app = mount(SessionAttributes, { target: document.body, props: { sessionId: 7, cardClass: "" } })
		flushSync()
		feed("state:attributes", VIEW)
		feed("state:setCarry:error", { error: "Everyone carries Heart: the rules require it.", sessionId: 7 })
		expect(text("[role=alert]")).toBe("Everyone carries Heart: the rules require it.")
	})
})
