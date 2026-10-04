/**
 * No frame is a widget (the `surface` shortcut retired 2026-10-02): a frame is
 * posted what its host passes — session, messages, props — and never the
 * widget data a component's wire carries (`settings`, `layout`, `scoped`,
 * `grants`). The document itself is stood in for: the test takes the port the
 * frame's load hands over and speaks for the frame on it.
 */
import { describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import PluginFrame from "./PluginFrame.svelte"

const settle = () => new Promise((r) => setTimeout(r, 20))

async function open(props: Record<string, unknown>) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(PluginFrame, {
		target,
		props: {
			// A document the test DOM does not go and fetch: the frame is stood in for.
			src: "about:blank",
			title: "Map",
			surface: "panel",
			session: { id: 1, name: "S" },
			messages: [{ id: 1, content: "Hi" }],
			props: { panelId: "acme:map" },
			...props
		}
	})
	flushSync()
	// Past the test DOM's own load of the blank document, so the load below
	// is the last one and its port the one the host speaks on.
	await settle()
	// The frame's window, as the host reaches it: the port rides the init post.
	const iframe = target.querySelector("iframe")!
	let handed: MessagePort | undefined
	Object.defineProperty(iframe, "contentWindow", {
		configurable: true,
		value: { postMessage: (_msg: unknown, _origin: string, transfer: MessagePort[]) => (handed = transfer[0]) }
	})
	iframe.dispatchEvent(new Event("load"))
	const got: Array<Record<string, unknown>> = []
	handed!.onmessage = (e) => got.push(e.data)
	handed!.postMessage({ t: "ready" })
	await settle()
	return {
		got,
		close: () => {
			handed?.close()
			unmount(app)
			target.remove()
		}
	}
}

describe("what a plugin frame is posted", () => {
	test("what its host passes, and never a widget's data", async () => {
		const f = await open({})
		const kinds = f.got.map((m) => m.t)
		expect(kinds).toEqual(expect.arrayContaining(["session", "messages", "props", "theme"]))
		for (const widgetOnly of ["settings", "style", "layout", "scoped", "grants"])
			expect(kinds).not.toContain(widgetOnly)
		f.close()
	})
})
