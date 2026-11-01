/**
 * 🚧 M2b: the three front-end APIs (`ui` · `session` · `applet`) in the widget wire. A widget placed in a session's
 * layout holds ui + session: an applet's library request is refused in words, before any page code runs. A mount
 * holding ui + applet (an applet not mounted in a session) is posted none of the session's sections, cannot press the
 * session's verbs, and may ask a ui request; the page refuses the library requests "not available yet" until M2c.
 */
import { describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"
import { buildWidgetRequestAnswerer } from "$lib/client/components/sessionPage/requests"

const settle = () => new Promise((r) => setTimeout(r, 20))

async function open(inputs: () => WireInputs, requests?: unknown) {
	let wire!: WidgetWire
	const target = document.createElement("div")
	const asked: string[] = []
	const handler = requests ?? (async (kind: string) => {
		asked.push(kind)
		return undefined
	})
	const app = mount(Fixture, { target, props: { inputs, requests: handler, onWire: (w: WidgetWire) => (wire = w) } })
	const channel = new MessageChannel()
	const got: Array<Record<string, unknown>> = []
	channel.port2.onmessage = (e) => got.push(e.data)
	wire.attach(channel.port1)
	channel.port2.postMessage({ t: "ready" })
	await settle()
	flushSync()
	return {
		got,
		asked,
		send: async (m: unknown) => {
			channel.port2.postMessage(m)
			await settle()
		},
		close: () => {
			wire.detach()
			unmount(app)
		}
	}
}

const session = () => ({ stateKey: "k", session: { id: 7, name: null }, messages: [{ id: 1, role: "user", content: "hi" }], owner: "acme" }) as WireInputs

describe("a widget placed in a session (ui + session)", () => {
	test("an applet's library request is refused in words and never reaches the page; a ui request does", async () => {
		const w = await open(session)
		await w.send({ t: "request", requestId: "r1", what: "library-characters", params: {} })
		expect(w.got.find((m) => m.requestId === "r1")).toMatchObject({
			ok: false,
			error: "'library-characters' is an applet request: a widget placed in a session cannot ask it"
		})
		await w.send({ t: "request", requestId: "r2", what: "notify", params: { kind: "info", text: "Saved." } })
		expect(w.asked).toEqual(["notify"])
		// ruled 2026-10-31: creating and deleting a session are session management — the applet API's
		await w.send({ t: "request", requestId: "r2b", what: "create-session", params: { genre: "acme:genre/walk" } })
		expect(w.got.find((m) => m.requestId === "r2b")).toMatchObject({
			ok: false,
			error: "'create-session' is an applet request: a widget placed in a session cannot ask it"
		})
		await w.send({ t: "request", requestId: "r2c", what: "open-sessions", params: {} })
		expect(w.asked).toEqual(["notify", "open-sessions"])   // opening the list is chrome
		expect(w.got.some((m) => m.t === "messages")).toBe(true)   // the session's sections, as ever
		w.close()
	})
})

describe("an applet not mounted in a session (ui + applet)", () => {
	test("no session sections, no session press; a session request refused; a ui request passes", async () => {
		const w = await open(() => ({ ...session(), apis: ["ui", "applet"], grants: ["applet:characters:read", "applet:sessions:acme:genre/walk"] }))
		expect(w.got.some((m) => m.t === "messages" || m.t === "session" || m.t === "annex")).toBe(false)
		await w.send({ t: "invoke", key: "core#extend", requestId: "r3" })   // a session verb (a plugin's own action would go on: M2c)
		expect(w.got.find((m) => m.requestId === "r3")).toMatchObject({ ok: false })
		expect(String(w.got.find((m) => m.requestId === "r3")?.error)).toContain("not mounted in a session")
		await w.send({ t: "request", requestId: "r4", what: "session-entries", params: {} })
		expect(w.got.find((m) => m.requestId === "r4")).toMatchObject({
			ok: false,
			error: "'session-entries' is a session request, and this frame is not mounted in a session"
		})
		await w.send({ t: "request", requestId: "r5", what: "library-characters", params: {} })
		expect(w.asked).toEqual(["library-characters"])   // the applet's own, granted: it reaches the page
		await w.send({ t: "request", requestId: "r6", what: "create-session", params: { genre: "acme:genre/walk" } })
		expect(w.asked).toEqual(["library-characters", "create-session"])   // its granted genre
		// the grant is read as the manifest compiles it, end to end
		await w.send({ t: "request", requestId: "r7", what: "create-session", params: { genre: "acme:genre/other" } })
		expect(w.got.find((m) => m.requestId === "r7")).toMatchObject({
			ok: false,
			error: "'create-session' works with the person's 'acme:genre/other' sessions, and this applet was not granted 'applet:sessions:acme:genre/other'"
		})
		await w.send({ t: "request", requestId: "r8", what: "library-lorebooks", params: {} })
		expect(w.got.find((m) => m.requestId === "r8")).toMatchObject({
			ok: false,
			error: "'library-lorebooks' reads the person's lorebooks, and this applet was not granted 'applet:lorebooks:read'"
		})
		await w.send({ t: "request", requestId: "r9", what: "user-annex", params: { op: "list" } })
		expect(String(w.got.find((m) => m.requestId === "r9")?.error)).toContain("'applet:annex:user'")
		w.close()
	})

	test("only plugin-storage is still 'not available yet' (M2c: the library rows answer over S's handlers)", async () => {
		const answerer = buildWidgetRequestAnswerer({} as never)
		await expect(answerer("plugin-storage", {} as never, { widgetId: "w", owner: "acme" })).rejects.toThrow(
			"'plugin-storage' is not available yet: Serene Pub answers it in a later update"
		)
		// 2026-10-31 (M2c): open-session / open-sessions / create-session / delete-session are answered
		// (navigation.test.ts); the library kinds go to S's plugins:* sockets (requests/library.ts).
	})
})

describe("a plugin page (/x/…, ui only) — M2c wording", () => {
	test("an applet request and a session request are refused as a page's, not a widget's", async () => {
		const w = await open(() => ({ stateKey: "k", messages: [], owner: "acme", apis: ["ui"], mount: "page" }))
		await w.send({ t: "request", requestId: "p1", what: "library-characters", params: {} })
		expect(w.got.find((m) => m.requestId === "p1")).toMatchObject({ ok: false, error: "'library-characters' is an applet request: a plugin page is not an applet" })
		await w.send({ t: "request", requestId: "p2", what: "session-entries", params: {} })
		expect(w.got.find((m) => m.requestId === "p2")).toMatchObject({ ok: false, error: "'session-entries' is a session request, and a plugin page is not mounted in a session" })
		w.close()
	})
})
