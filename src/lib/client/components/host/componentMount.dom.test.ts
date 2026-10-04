/**
 * A remote's box and whose trust it runs under (C7): core's own component is
 * core's by owner AND module — never by an owner string a manifest could
 * carry — and what a component sends on the worker channel (`{ k: "wire" }`,
 * the ordered outbox) is answered as if it came on its port. The page's UI
 * workers are stood in for; the receiver and the widget wire are real.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { MUTATION_TYPE_INSERT_CHILD, ROOT_ID } from "@remote-dom/core"
import ComponentMount from "./ComponentMount.svelte"

const worker = vi.hoisted(() => ({
	posted: [] as Array<Record<string, unknown>>,
	routes: new Map<string, (m: unknown) => void>(),
	released: [] as string[],
	/** Whose worker each mount took. */
	acquired: [] as string[],
	/** How many times a box's receiver was disposed. */
	disposed: 0
}))
vi.mock("./uiWorkers", () => ({
	acquireWorker: (owner: string) => (worker.acquired.push(owner), {}),
	releaseWorker: (owner: string) => worker.released.push(owner),
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: (id: string, handler: (m: unknown) => void) => {
		worker.routes.set(id, handler)
		return () => worker.routes.delete(id)
	},
	postToWorker: (_w: unknown, m: Record<string, unknown>) => worker.posted.push(m)
}))
// The real receiver and guard; only its disposal is counted.
vi.mock("./receiverPolicy", async (importOriginal) => {
	const real = await importOriginal<typeof import("./receiverPolicy")>()
	return {
		...real,
		createGuardedReceiver: (...args: Parameters<typeof real.createGuardedReceiver>) => {
			const made = real.createGuardedReceiver(...args)
			return {
				...made,
				dispose: () => {
					worker.disposed++
					made.dispose()
				}
			}
		}
	}
})

const settle = () => new Promise((r) => setTimeout(r, 20))
const edit = { key: "edit", specSlug: "core", name: "Edit", venue: "message", origin: "core", canAct: true, enabled: true }

async function open(owner: string, src: string, extra: { pageIds?: boolean } = {}) {
	const edited: unknown[] = []
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(ComponentMount, {
		target,
		props: {
			owner,
			src,
			title: "Box",
			...extra,
			actions: { message: { primary: [edit], overflow: [] } } as never,
			actionDispatch: { core: { edit: (args: unknown) => edited.push(args) }, fire: () => {} }
		}
	})
	flushSync()
	const mounted = worker.posted.find((m) => m.k === "mount") as { mountId: string; port: MessagePort } | undefined
	/** The component, speaking on the worker channel rather than its port. */
	const relay = async (msg: unknown) => {
		worker.routes.get(mounted!.mountId)!({ k: "wire", mountId: mounted!.mountId, msg })
		await settle()
	}
	if (mounted) await relay({ t: "ready" })
	return {
		target,
		mounted,
		edited,
		relay,
		close: async () => {
			await unmount(app)
			target.remove()
		}
	}
}

const press = { t: "invoke", key: "edit", messageId: 2, payload: { content: "Hi, friend!" } }

afterEach(() => {
	worker.posted.length = 0
	worker.routes.clear()
	worker.released.length = 0
	worker.acquired.length = 0
	worker.disposed = 0
	vi.unstubAllGlobals()
})

describe("a remote's box", () => {
	test("core's own module edits unasked, its press relayed off the worker channel", async () => {
		const confirm = vi.fn(() => false)
		vi.stubGlobal("confirm", confirm)
		const box = await open("core", "/core-ui/messages")
		await box.relay(press)
		expect(confirm).not.toHaveBeenCalled()
		expect(box.edited).toEqual([{ messageId: 2, payload: { content: "Hi, friend!" } }])
		await box.close()
	})

	test("a plugin's press is judged by its gate — no person behind it, no edit", async () => {
		// Even a person who would say yes is not asked: the gate refuses first.
		const confirm = vi.fn(() => true)
		vi.stubGlobal("confirm", confirm)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const box = await open("acme", "/plugin-ui/acme/ui/w.js")
		await box.relay(press)
		expect(box.edited).toEqual([])
		expect(confirm).not.toHaveBeenCalled()
		warn.mockRestore()
		await box.close()
	})

	test("the conversation told `pageIds` keeps the ids the page navigates by; a plugin's are its box's", async () => {
		const place = (box: Awaited<ReturnType<typeof open>>) =>
			worker.routes.get(box.mounted!.mountId)!({
				k: "mutate",
				mountId: box.mounted!.mountId,
				records: [
					[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, { id: "n1", type: 1, element: "div", attributes: { id: "message-5" }, children: [] }, 0]
				]
			})
		const core = await open("core", "/core-ui/messages", { pageIds: true })
		place(core)
		expect(core.target.querySelector("#message-5")).not.toBeNull()
		await core.close()
		worker.posted.length = 0
		// A plugin told it anyway never gets the page's ids.
		const plugin = await open("acme", "/plugin-ui/acme/ui/w.js", { pageIds: true })
		place(plugin)
		expect(plugin.target.querySelector("#message-5")).toBeNull()
		expect(plugin.target.querySelector('[id$="-message-5"]')).not.toBeNull()
		await plugin.close()
	})

	/**
	 * More than one Messages widget (brief 7b, plan §M.3.8 as amended): a mount
	 * of the conversation holds the page's ids only when the layout names it
	 * `pageIds` — the story's log, and each copy showing channels no earlier one
	 * shows (`channelClaims` `pageIdsHolders`); a second view of one channel is
	 * not named and takes its box's prefix, as every other core widget does (F8).
	 * Two copies showing the same row then put one `#message-<id>` on the page.
	 */
	test("two Messages mounts showing one row: exactly one #message-5 on the page", async () => {
		const place = (box: Awaited<ReturnType<typeof open>>) =>
			worker.routes.get(box.mounted!.mountId)!({
				k: "mutate",
				mountId: box.mounted!.mountId,
				records: [
					[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, { id: "n1", type: 1, element: "div", attributes: { id: "message-5" }, children: [] }, 0]
				]
			})
		const story = await open("core", "/core-ui/messages", { pageIds: true })
		place(story)
		worker.posted.length = 0
		const view = await open("core", "/core-ui/messages")
		place(view)
		expect(document.querySelectorAll("#message-5").length).toBe(1)
		expect(story.target.querySelector("#message-5")).not.toBeNull()
		expect(view.target.querySelector('[id$="-message-5"]')).not.toBeNull()
		// The prefixed copy is still j/k's blind spot: nothing it draws starts `message-`.
		expect(view.target.querySelector('[id^="message-"]')).toBeNull()
		await story.close()
		await view.close()
	})

	test("core's other modules are widgets: their ids are their box's and they paint inside it, as a plugin's (F8)", async () => {
		const place = (box: Awaited<ReturnType<typeof open>>) =>
			worker.routes.get(box.mounted!.mountId)!({
				k: "mutate",
				mountId: box.mounted!.mountId,
				records: [
					[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, { id: "n1", type: 1, element: "input", attributes: { id: "weather", name: "weather" }, children: [] }, 0]
				]
			})
		const first = await open("core", "/core-ui/stats")
		place(first)
		worker.posted.length = 0
		const second = await open("core", "/core-ui/stats")
		place(second)
		// Two mounts of one core widget (a rail and its flyout) share no id.
		expect(first.target.querySelector("#weather")).toBeNull()
		const ids = [first, second].map((b) => b.target.querySelector('[id$="-weather"]')?.id)
		expect(ids.every(Boolean)).toBe(true)
		expect(ids[0]).not.toBe(ids[1])
		expect((first.target.querySelector(".sp-remote-box") as HTMLElement).style.contain).toBe("paint")
		await first.close()
		await second.close()
		// The conversation, every copy of it, paints unheld.
		worker.posted.length = 0
		const conversation = await open("core", "/core-ui/messages")
		expect((conversation.target.querySelector(".sp-remote-box") as HTMLElement).style.contain).toBe("")
		await conversation.close()
	})

	test("every box is its widget's whole cell and the widget's size container (2026-09-27)", async () => {
		// The box fills the cell both ways and carries the `sp-widget` query
		// container (ComponentMount's <style>) — a plugin's and core's alike,
		// the conversation included. jsdom computes no container styles, so
		// the seam asserted is the box's marker and its fill; the container
		// itself is verified in a browser (widgetsize walk).
		for (const [owner, src] of [
			["core", "/core-ui/stats"],
			["core", "/core-ui/messages"],
			["acme", "/plugin-ui/acme/ui/w.js"]
		] as const) {
			worker.posted.length = 0
			const box = await open(owner, src)
			const el = box.target.querySelector(".sp-remote-box") as HTMLElement
			expect(el.hasAttribute("data-sp-widget-box")).toBe(true)
			expect(el.classList.contains("h-full")).toBe(true)
			expect(el.classList.contains("w-full")).toBe(true)
			expect(el.parentElement!.classList.contains("h-full")).toBe(true)
			await box.close()
		}
	})

	test("a component naming core from anywhere but core's modules is not mounted", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const box = await open("core", "/plugin-ui/core/ui/w.js")
		expect(box.mounted).toBeUndefined()
		expect(box.target.querySelector('[role="alert"]')).not.toBeNull()
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
		await box.close()
	})

	test("leaving takes the mount down: unrouted, disposed, unmounted in its worker, the worker released", async () => {
		const box = await open("acme", "/plugin-ui/acme/ui/w.js")
		const { mountId } = box.mounted!
		expect(worker.released).toEqual([])
		await box.close()
		expect(worker.routes.has(mountId)).toBe(false)
		expect(worker.disposed).toBe(1)
		expect(worker.posted.filter((m) => m.k === "unmount")).toEqual([{ k: "unmount", mountId }])
		expect(worker.released).toEqual(["acme"])
	})

	test("a refused batch takes the mount down there and then, once — and leaving repeats none of it", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const box = await open("acme", "/plugin-ui/acme/ui/w.js")
		const { mountId } = box.mounted!
		const route = worker.routes.get(mountId)!
		const insert = (element: string) => ({
			k: "mutate",
			mountId,
			records: [[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, { id: "n1", type: 1, element, attributes: {}, children: [] }, 0]]
		})
		route(insert("div"))
		expect(worker.released).toEqual([])
		// The same id re-addressed as another node: the guard refuses the batch.
		route(insert("span"))
		flushSync()
		expect(box.target.querySelector('[role="alert"]')).not.toBeNull()
		expect(worker.routes.has(mountId)).toBe(false)
		expect(worker.disposed).toBe(1)
		expect(worker.posted.filter((m) => m.k === "unmount")).toEqual([{ k: "unmount", mountId }])
		expect(worker.released).toEqual(["acme"])
		// A batch still in flight changes nothing; nor does leaving.
		route(insert("span"))
		await box.close()
		expect(worker.disposed).toBe(1)
		expect(worker.posted.filter((m) => m.k === "unmount")).toHaveLength(1)
		expect(worker.released).toEqual(["acme"])
		warn.mockRestore()
	})

	test("a component that failed to mount lets its worker go there and then (unit M) — leaving repeats nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const box = await open("acme", "/plugin-ui/acme/ui/w.js")
		const { mountId } = box.mounted!
		worker.routes.get(mountId)!({ k: "failed", mountId, message: "boom" })
		flushSync()
		expect(box.target.querySelector('[role="alert"]') !== null).toBe(true)
		expect(worker.routes.has(mountId)).toBe(false)
		expect(worker.posted.filter((m) => m.k === "unmount")).toEqual([{ k: "unmount", mountId }])
		expect(worker.released).toEqual(["acme"])
		await box.close()
		expect(worker.disposed).toBe(1)
		expect(worker.released).toEqual(["acme"])
		warn.mockRestore()
	})

	test("an authored component (C6) is never core's: its own worker, its presses gated, its ids its box's — whatever module it names", async () => {
		const owner = "authored.k3x9q2m7p1"
		const confirm = vi.fn(() => true)
		vi.stubGlobal("confirm", confirm)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const place = (box: Awaited<ReturnType<typeof open>>) =>
			worker.routes.get(box.mounted!.mountId)!({
				k: "mutate",
				mountId: box.mounted!.mountId,
				records: [
					[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, { id: "n1", type: 1, element: "div", attributes: { id: "message-5" }, children: [] }, 0]
				]
			})
		// Its own served module, and — the hostile case — core's conversation
		// module under its owner: an owner that is not `core` never earns
		// core's trust, whatever `src` says.
		for (const src of [`/authored-ui/${owner}/${"a".repeat(64)}.js`, "/core-ui/messages"]) {
			const box = await open(owner, src)
			expect(box.mounted).toBeDefined()
			expect(worker.acquired).toEqual([owner])
			await box.relay(press)
			expect(box.edited).toEqual([])
			place(box)
			expect(box.target.querySelector("#message-5")).toBeNull()
			expect(box.target.querySelector('[id$="-message-5"]')).not.toBeNull()
			await box.close()
			expect(worker.released).toEqual([owner])
			worker.posted.length = 0
			worker.acquired.length = 0
			worker.released.length = 0
		}
		expect(confirm).not.toHaveBeenCalled()
		warn.mockRestore()
	})
})
