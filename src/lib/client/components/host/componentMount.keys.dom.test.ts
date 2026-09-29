/**
 * A person's key on a plain `input` whose `keys` names it (R80) counts as a
 * person pressing in the box, for the box's invoke gate — on the page, end to
 * end: the real `raiseKey` capture listener (`uiWorkers.ts`), the real voucher
 * the mount registers (`hostElements/activation.ts`), the real guarded
 * receiver and the real gate. Only the worker is stood in for. A synthetic
 * press opens nothing. The component harness judges the same way
 * (`@serene-pub/cli/testing`, `pressKey`).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { MUTATION_TYPE_INSERT_CHILD, ROOT_ID } from "@remote-dom/core"
import { FN } from "@serene-pub/sdk"
import ComponentMount from "./ComponentMount.svelte"

const worker = vi.hoisted(() => ({
	posted: [] as Array<Record<string, unknown>>,
	routes: new Map<string, (m: unknown) => void>()
}))
// The page's real event listeners (`listenForRemoteEvents`, `currentEvent`);
// only the worker itself is stood in for.
vi.mock("./uiWorkers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./uiWorkers")>()),
	acquireWorker: () => ({}),
	releaseWorker: () => {},
	routeMount: (id: string, handler: (m: unknown) => void) => {
		worker.routes.set(id, handler)
		return () => worker.routes.delete(id)
	},
	postToWorker: (_w: unknown, m: Record<string, unknown>) => worker.posted.push(m)
}))

const settle = () => new Promise((r) => setTimeout(r, 20))
const edit = { key: "edit", specSlug: "core", name: "Edit", venue: "message", origin: "core", canAct: true, enabled: true }
const invokeEdit = { t: "invoke", key: "edit", messageId: 2, payload: { content: "Hi, friend!" } }

async function open() {
	const edited: unknown[] = []
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(ComponentMount, {
		target,
		props: {
			owner: "acme",
			src: "/plugin-ui/acme/ui/w.js",
			title: "Box",
			actions: { message: { primary: [edit], overflow: [] } } as never,
			actionDispatch: { core: { edit: (args: unknown) => edited.push(args) }, fire: () => {} }
		}
	})
	flushSync()
	const mounted = worker.posted.find((m) => m.k === "mount") as { mountId: string }
	const route = (m: Record<string, unknown>) => worker.routes.get(mounted.mountId)!({ ...m, mountId: mounted.mountId })
	const relay = async (msg: unknown) => {
		route({ k: "wire", msg })
		await settle()
	}
	await relay({ t: "ready" })
	// The component places a stat field whose Enter is the widget's.
	route({
		k: "mutate",
		records: [
			[
				MUTATION_TYPE_INSERT_CHILD,
				ROOT_ID,
				{
					id: "n1",
					type: 1,
					element: "input",
					attributes: { type: "number", keys: "Enter", value: "3" },
					children: [],
					eventListeners: { key: { [FN]: 1 } }
				},
				0
			]
		]
	})
	flushSync()
	const field = target.querySelector("input")!
	return {
		field,
		edited,
		relay,
		/** The `fn` calls the component was sent, by type. */
		fired: () => worker.posted.filter((m) => m.k === "fn").map((m) => (m.detail as { type: string }).type),
		close: async () => {
			await unmount(app)
			target.remove()
		}
	}
}

const enter = (trusted: boolean) => {
	const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
	// The test DOM cannot make a person's press, so it says this one is.
	if (trusted) Object.defineProperty(e, "isTrusted", { value: true })
	return e
}

afterEach(() => {
	worker.posted.length = 0
	worker.routes.clear()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("a person's key on a keyed input, at the box's gate", () => {
	test("a trusted Enter the input's `keys` names opens the box's window: the edit it prompts goes through", async () => {
		// Past the gate, a plugin's edit is still put to the person; they say yes.
		const confirm = vi.fn(() => true)
		vi.stubGlobal("confirm", confirm)
		const box = await open()
		const press = enter(true)
		box.field.dispatchEvent(press)
		expect(press.defaultPrevented).toBe(true)
		expect(box.fired()).toEqual(["key"])
		await box.relay(invokeEdit)
		expect(confirm).toHaveBeenCalledTimes(1)
		expect(box.edited).toEqual([{ messageId: 2, payload: { content: "Hi, friend!" } }])
		await box.close()
	})

	test("a synthetic Enter reaches the component but opens nothing: the edit is refused", async () => {
		const confirm = vi.fn(() => true)
		vi.stubGlobal("confirm", confirm)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const box = await open()
		box.field.dispatchEvent(enter(false))
		expect(box.fired()).toEqual(["key"])
		await box.relay(invokeEdit)
		expect(box.edited).toEqual([])
		// Refused before the person is asked.
		expect(confirm).not.toHaveBeenCalled()
		expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toMatch(/core#edit.*needs a person behind it/)
		await box.close()
	})
})
