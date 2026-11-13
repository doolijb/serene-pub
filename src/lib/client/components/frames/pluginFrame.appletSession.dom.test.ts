/**
 * 🚧 m3-core (plan §9): an applet genre's in-session frame is mounted `applet` — `init` says so and a plugin
 * action it invokes names the applet and the session; an ordinary session view stays `widget`.
 */
import { describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import PluginFrame from "./PluginFrame.svelte"
import { invokePluginAction } from "./pluginActions"
import { sessionViewMount } from "$lib/shared/plugins/sessionViewMount"

vi.mock("./pluginActions", () => ({ invokePluginAction: vi.fn() }))

const settle = () => new Promise((r) => setTimeout(r, 20))
const owner = "acme.worlds"

async function open(applet: boolean) {
	const m = sessionViewMount({
		applet,
		sessionGrants: [],
		appletGrants: applet ? ["applet:sessions"] : undefined
	})
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(PluginFrame, {
		target,
		props: {
			src: `/plugin-ui/${owner}/ui/view.html`,
			title: "View",
			surface: "session-view",
			session: { id: 7, name: "S" },
			messages: [],
			apis: m.apis,
			grants: m.grants as never
		}
	})
	flushSync()
	await settle()
	const iframe = target.querySelector("iframe")!
	let handed: MessagePort | undefined
	let init: Record<string, unknown> | undefined
	Object.defineProperty(iframe, "contentWindow", {
		configurable: true,
		value: {
			postMessage: (
				msg: Record<string, unknown>,
				_o: string,
				transfer: MessagePort[]
			) => {
				init = msg
				handed = transfer[0]
			}
		}
	})
	iframe.dispatchEvent(new Event("load"))
	handed!.onmessage = () => {}
	handed!.postMessage({ t: "ready" })
	await settle()
	handed!.postMessage({
		t: "invoke",
		key: "world.load",
		payload: { id: "a" },
		requestId: "r1"
	})
	await settle()
	return {
		init: init!,
		close: () => {
			handed?.close()
			unmount(app)
			target.remove()
		}
	}
}

describe("an applet genre's session view", () => {
	test("is mounted applet: init says so and the action names the applet and session", async () => {
		vi.mocked(invokePluginAction).mockResolvedValue({})
		const f = await open(true)
		expect(f.init.mount).toBe("applet")
		expect(invokePluginAction).toHaveBeenCalledWith(
			owner,
			"world.load",
			{ id: "a" },
			{ pluginId: owner, sessionId: 7 }
		)
		f.close()
	})

	test("an ordinary session view is a widget and sends no applet", async () => {
		vi.mocked(invokePluginAction).mockClear()
		vi.mocked(invokePluginAction).mockResolvedValue({})
		const f = await open(false)
		expect(f.init.mount).toBe("widget")
		expect(invokePluginAction).toHaveBeenCalledWith(
			owner,
			"world.load",
			{ id: "a" },
			undefined
		)
		f.close()
	})
})
