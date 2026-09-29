/**
 * A plugin frame is a widget minus the iframe (R75, K6): the base sections it
 * declares it reads are the only ones posted into its document, as for a
 * remote — so a frame that does not read the log is never posted it. The
 * document itself is stood in for: the test takes the port the frame's load
 * hands over and speaks for the frame on it.
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
			settings: { zoom: 2 },
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

describe("a plugin frame's reads (R75)", () => {
	test("only the sections it reads are posted into its document", async () => {
		const f = await open({ reads: ["settings"] })
		const kinds = f.got.map((m) => m.t)
		expect(kinds).toContain("settings")
		expect(kinds).not.toContain("messages")
		expect(kinds).not.toContain("session")
		expect(kinds).not.toContain("props")
		f.close()
	})

	test("absent reads every section, as a frame written before R75 does", async () => {
		const f = await open({})
		const kinds = f.got.map((m) => m.t)
		expect(kinds).toEqual(expect.arrayContaining(["session", "messages", "settings", "props"]))
		f.close()
	})
})
