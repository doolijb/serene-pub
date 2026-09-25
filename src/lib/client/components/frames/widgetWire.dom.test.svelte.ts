/**
 * The widget wire's C5 rules, over a real MessageChannel: a document nested
 * in a component is handed only what its component forwards and its presses
 * are raised unresolved (with the document's own live check), a scoped
 * section is posted when it changes and withdrawn when its grant goes, and a
 * widget's message pages stay inside its lanes.
 */
import { describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"
import { registerVoucher, vouchFor } from "$lib/client/components/hostElements/activation"

const settle = () => new Promise((r) => setTimeout(r, 20))

async function open(inputs: () => WireInputs, extra: Record<string, unknown> = {}) {
	let wire!: WidgetWire
	const target = document.createElement("div")
	const app = mount(Fixture, { target, props: { inputs, onWire: (w: WidgetWire) => (wire = w), ...extra } })
	const channel = new MessageChannel()
	const got: Array<Record<string, unknown>> = []
	channel.port2.onmessage = (e) => got.push(e.data)
	wire.attach(channel.port1)
	channel.port2.postMessage({ t: "ready" })
	await settle()
	flushSync()
	return {
		got,
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

const base = (): WireInputs => ({ stateKey: "k", session: { id: 1, name: null }, messages: [] })

describe("a document nested in a component (sp-frame)", () => {
	test("is posted none of the page's own sections, and its requests are declined", async () => {
		const w = await open(() => ({ ...base(), props: { answers: [] }, onInvoke: () => {} }))
		const kinds = w.got.map((m) => m.t)
		expect(kinds).toContain("props")
		expect(kinds).not.toContain("annex")
		expect(kinds).not.toContain("viewer")
		expect(kinds).not.toContain("turn-order")
		// `messages` declines silently (the frame protocol's rule); anything else answers no.
		await w.send({ t: "request", requestId: "r1", what: "messages" })
		expect(w.got.some((m) => m.requestId === "r1")).toBe(false)
		await w.send({ t: "request", requestId: "r2", what: "pick-turn", params: {} })
		expect(w.got.find((m) => m.requestId === "r2")).toMatchObject({ t: "response", ok: false })
		w.close()
	})

	test("raises its invoke unresolved, with the document's own live check", async () => {
		const seen: unknown[] = []
		let pressing = false
		const w = await open(
			() => ({ ...base(), onInvoke: (key, args, personBehind) => seen.push([key, args.blockId, personBehind]) }),
			{ options: { personBehind: () => pressing } }
		)
		await w.send({ t: "invoke", key: "core#hide", blockId: "b" })
		pressing = true
		await w.send({ t: "invoke", key: "core#hide" })
		expect(seen).toEqual([
			["core#hide", "b", false],
			["core#hide", undefined, true]
		])
		w.close()
	})

	test("a vouched press reaches only the mount box the element sits in", () => {
		const box = document.createElement("div")
		box.setAttribute("data-sp-owner", "acme")
		const inside = document.createElement("span")
		box.append(inside)
		let vouched = 0
		const off = registerVoucher(box, () => vouched++)
		vouchFor(inside)
		vouchFor(document.createElement("span"))
		off()
		vouchFor(inside)
		expect(vouched).toBe(1)
	})
})

describe("a page widget", () => {
	test("gets the page's sections, and a scoped section once per change — withdrawn when the grant goes", async () => {
		let scoped: WireInputs["scoped"] = { session_full: { n: 1 } }
		let session = { id: 1, name: "a" as string | null }
		const w = await open(() => ({ ...base(), session, scoped }))
		expect(w.got.map((m) => m.t)).toEqual(expect.arrayContaining(["annex", "viewer", "turn-order", "scoped"]))
		const scopedPosts = () => w.got.filter((m) => m.t === "scoped")
		expect(scopedPosts()).toHaveLength(1)
		// Another section changes (a streamed token): the unchanged dossier is not re-sent.
		session = { id: 1, name: "b" }
		await w.send({ t: "ready" })
		expect(scopedPosts()).toHaveLength(1)
		scoped = undefined
		await w.send({ t: "ready" })
		expect(scopedPosts().at(-1)).toEqual({ t: "scoped", section: "session_full", value: null })
		w.close()
	})

	test("a page of older messages holds only this widget's lanes", async () => {
		const requests = async () => ({
			rows: [
				{ id: 1, channel: "main" },
				{ id: 2, channel: "board" },
				{ id: 3 }
			]
		})
		const w = await open(() => ({ ...base(), channels: ["main"] }), { requests })
		await w.send({ t: "request", requestId: "r2", what: "messages" })
		const page = w.got.find((m) => m.t === "page" && m.requestId === "r2") as { rows: Array<{ id: number }> }
		expect(page.rows.map((r) => r.id)).toEqual([1, 3])
		w.close()
	})
})
