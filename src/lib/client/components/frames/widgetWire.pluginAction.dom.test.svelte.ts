/** A frame's `invoke` with a `requestId` hears the plugin action's answer (M0, P4b). */
import { describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"
import { invokePluginAction } from "./pluginActions"

vi.mock("./pluginActions", () => ({ invokePluginAction: vi.fn() }))

const settle = () => new Promise((r) => setTimeout(r, 20))
const base = (): WireInputs => ({
	stateKey: "k",
	session: { id: 1, name: null },
	messages: [],
	owner: "acme.worlds"
})

async function open() {
	let wire!: WidgetWire
	const target = document.createElement("div")
	const app = mount(Fixture, { target, props: { inputs: base, onWire: (w: WidgetWire) => (wire = w) } })
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

describe("invoke of a plugin action", () => {
	test("answers ok with the handler's result", async () => {
		vi.mocked(invokePluginAction).mockResolvedValue({ name: "Vila" })
		const w = await open()
		await w.send({ t: "invoke", key: "world.load", payload: { id: "a" }, requestId: "r1" })
		expect(w.got.find((m) => m.requestId === "r1")).toEqual({
			t: "response",
			requestId: "r1",
			ok: true,
			result: { name: "Vila" }
		})
		w.close()
	})

	test("answers not-ok with the refusal sentence", async () => {
		vi.mocked(invokePluginAction).mockRejectedValue(new Error("No such world."))
		const w = await open()
		await w.send({ t: "invoke", key: "world.load", requestId: "r2" })
		expect(w.got.find((m) => m.requestId === "r2")).toMatchObject({ ok: false, error: "No such world." })
		w.close()
	})

	test("posts nothing back without a requestId", async () => {
		vi.mocked(invokePluginAction).mockResolvedValue({})
		const w = await open()
		await w.send({ t: "invoke", key: "world.load" })
		expect(w.got.some((m) => m.t === "response")).toBe(false)
		w.close()
	})
})
