/**
 * A remote widget is TOLD which of its scopes it holds (`grants`): on mount,
 * and again when an admin's review changes them. Without it, a scope that was
 * not granted and a section not yet posted are the same absence, and a
 * widget denied `session:state` shows "Loading…" forever. A plugin's widget
 * handed no grants holds none, and is told so; one revoked at runtime is told
 * that too, and its section withdrawn.
 *
 * The page's UI workers are stood in for; the widget wire is the real one.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import type { WidgetSectionScope } from "@serene-pub/sdk"
import { savedFrameState } from "$lib/client/components/frames/framePort"
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
const STATE = { sessionId: 42, loaded: true, error: null, resolved: { world: {}, cast: {} }, slots: [], owners: [] }

async function pluginWidget(grants?: WidgetSectionScope[]) {
	const props = $state({
		widget: { id: "acme.quiz:log", title: "Question log" },
		owner: "acme.quiz",
		src: "/plugin-ui/acme.quiz/log.js",
		session: { id: 42, name: "Real", sessionMessages: [] },
		eager: true,
		grants,
		scoped: grants?.includes("session:state") ? { session_state: STATE } : undefined
	} as Record<string, unknown>)
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(RemoteWidget, { target, props: props as never })
	flushSync()
	const mounted = posted.find((m) => m.k === "mount") as { port: MessagePort }
	const got: Array<Record<string, unknown>> = []
	mounted.port.onmessage = (e) => got.push(e.data)
	mounted.port.postMessage({ t: "ready" })
	await settle()
	return {
		props,
		got,
		/** Every `grants` the widget was told, in order — compared as plain lists. */
		told: () => got.filter((m) => m.t === "grants").map((m) => JSON.stringify(m.grants)),
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

describe("a remote widget's grants", () => {
	test("handed none, a plugin's widget is told it holds none — never left to wait", async () => {
		const w = await pluginWidget()
		expect(w.told()).toEqual(["[]"])
		expect(w.got.some((m) => m.t === "scoped")).toBe(false)
		await w.close()
	})

	test("granted a scope, it is told so — before the section it covers", async () => {
		const w = await pluginWidget(["session:state"])
		expect(w.told()).toEqual(['["session:state"]'])
		const kinds = w.got.map((m) => String(m.t))
		expect(kinds.indexOf("grants")).toBeLessThan(kinds.indexOf("scoped"))
		await w.close()
	})

	test("revoked at runtime, it is told again and the section withdrawn; granted back, told again", async () => {
		const w = await pluginWidget(["session:state"])
		w.props.grants = []
		w.props.scoped = undefined
		flushSync()
		await settle()
		expect(w.told()).toEqual(['["session:state"]', "[]"])
		expect(w.got.filter((m) => m.t === "scoped").map((m) => `${m.section}:${m.value === null ? "null" : "value"}`)).toEqual([
			"session_state:value",
			"session_state:null"
		])
		w.props.grants = ["session:state"]
		flushSync()
		await settle()
		expect(w.told()).toEqual(['["session:state"]', "[]", '["session:state"]'])
		await w.close()
	})

	test("an unchanged grant is not told twice", async () => {
		const w = await pluginWidget(["session:state"])
		w.props.settings = { any: 1 }
		flushSync()
		await settle()
		expect(w.told()).toEqual(['["session:state"]'])
		await w.close()
	})
})
