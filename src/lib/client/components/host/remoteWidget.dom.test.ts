/**
 * Core's conversation mounts as every session widget does (R79): through
 * `RemoteWidget`, fed only the base sections it declares it reads (K12). It
 * is told where it sits — a phone-width box is `compact` (Enter keeps its
 * newline) — and a mount no zone placed is told `UNPLACED`, never nothing.
 * Whose conversation it is comes from the page: it does not read `session`,
 * yet its saved state is filed under the page's session, not under one key
 * for every session. The page's UI workers are stood in for; the widget wire
 * is the real one.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { UNPLACED, type PlacementInput } from "$lib/shared/widgets/context"
import { savedFrameState } from "$lib/client/components/frames/framePort"
import { CORE_CONVERSATION } from "$lib/client/components/sessionPage/coreWidgets"
import RemoteWidget from "./RemoteWidget.svelte"

const posted = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("$lib/client/components/host/uiWorkers", () => ({
	acquireWorker: () => ({}),
	releaseWorker: () => {},
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: () => () => {},
	postToWorker: (_worker: unknown, m: Record<string, unknown>) => posted.push(m)
}))

const settle = () => new Promise((r) => setTimeout(r, 20))

/** A phone-width box, placed and measured by its zone. */
const placement: PlacementInput = {
	zone: { columns: 1, column: 1, rows: 1, row: 1 },
	box: {
		cols: 1,
		rows: null,
		edges: { top: true, right: true, bottom: true, left: true },
		px: { width: 360, height: 640 }
	},
	tier: "compact",
	pinned: true,
	collapsed: false,
	drawered: false
}

async function conversation(placed?: PlacementInput) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(RemoteWidget, {
		target,
		props: {
			widget: { id: "messages", title: "Messages" },
			owner: "core",
			src: CORE_CONVERSATION.src,
			session: { id: 42, name: "Real", sessionMessages: [{ id: 1, content: "Hello" }] },
			channels: [],
			reads: CORE_CONVERSATION.reads,
			...(placed ? { placement: placed } : {})
		}
	})
	flushSync()
	const mounted = posted.find((m) => m.k === "mount") as { entry: string; port: MessagePort }
	const got: Array<Record<string, unknown>> = []
	mounted.port.onmessage = (e) => got.push(e.data)
	mounted.port.postMessage({ t: "ready" })
	await settle()
	return {
		mounted,
		got,
		close: async () => {
			mounted.port.close()
			await unmount(app)
			target.remove()
		}
	}
}

afterEach(() => {
	posted.length = 0
	savedFrameState.clear()
})

describe("core's conversation, mounted as a remote widget", () => {
	test("is core's own module, told where it sits", async () => {
		const c = await conversation(placement)
		expect(c.mounted.entry).toBe("/core-ui/messages")
		const layout = c.got.find((m) => m.t === "layout")?.layout
		expect(layout).toMatchObject({ tier: "compact", box: { px: { width: 360, height: 640 } } })
		await c.close()
	})

	test("placed by no zone, it is told UNPLACED — never nothing", async () => {
		const c = await conversation()
		expect(c.got.find((m) => m.t === "layout")?.layout).toMatchObject({ tier: UNPLACED.tier })
		await c.close()
	})

	test("is posted only what it reads (K12): the log, never the session", async () => {
		const c = await conversation(placement)
		expect(CORE_CONVERSATION.reads).toContain("messages")
		expect(c.got.find((m) => m.t === "messages")?.messages).toEqual([{ id: 1, content: "Hello" }])
		expect(c.got.some((m) => m.t === "session")).toBe(false)
		await c.close()
	})

	test("files its saved state under the page's session, though it does not read it", async () => {
		const c = await conversation(placement)
		c.mounted.port.postMessage({ t: "save-state", state: { scrolledTo: 7 } })
		await settle()
		expect(savedFrameState.get("42:messages")).toEqual({ scrolledTo: 7 })
		expect(savedFrameState.get("0:messages")).toBeUndefined()
		await c.close()
	})
})
