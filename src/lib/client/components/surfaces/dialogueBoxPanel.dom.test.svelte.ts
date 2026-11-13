/**
 * The Dialogue box, mounted through `Panel` from core's real declaration
 * (`coreDefaultWidgets`), is posted the session dossier its `session:full`
 * grant names, and asks for core's own module. The page's UI workers are
 * stood in for; the host, the wire and the panel are real.
 */
import { afterEach, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { normalizeLayout, type PanelInstance } from "$lib/client/surfaces/types"
import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"
import Fixture from "./PanelFixture.svelte"

const posted = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("$lib/client/components/host/uiWorkers", () => ({
	acquireWorker: () => ({}),
	releaseWorker: () => {},
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: () => () => {},
	postToWorker: (_worker: unknown, m: Record<string, unknown>) =>
		posted.push(m)
}))

const settle = () => new Promise((r) => setTimeout(r, 20))

afterEach(() => {
	posted.length = 0
})

test("the declared Dialogue box is mounted from /core-ui/dialogue-box and posted the dossier", async () => {
	const p = coreDefaultWidgets(true).find((w) => w.id === "dialogue-box")!
	const instance: PanelInstance = {
		id: p.id,
		widgetId: p.id,
		title: p.title,
		icon: p.icon,
		role: "secondary",
		surface: p.surface,
		src: p.src,
		...(p.grants?.length ? { grants: p.grants } : {}),
		...(p.reads ? { reads: p.reads } : {}),
		channels: p.channels ?? [],
		layout: normalizeLayout(p.layout, "secondary"),
		active: true,
		collapsed: false,
		drawered: false,
		order: 0
	}
	const dossier = { dossier: 1, lines: ["Hel"] }
	const session = {
		id: 7,
		name: "S",
		sessionMessages: [{ id: 1, content: "Hel" }]
	}
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(Fixture, {
		target,
		props: { instance, session, supplies: { dossier } }
	})
	flushSync()
	const mounted = posted.find((m) => m.k === "mount") as {
		entry: string
		port: MessagePort
	}
	expect(mounted.entry).toBe("/core-ui/dialogue-box")
	const got: Array<Record<string, unknown>> = []
	mounted.port.onmessage = (e) => got.push(e.data)
	mounted.port.postMessage({ t: "ready" })
	await settle()
	expect(
		got.find((m) => m.t === "scoped" && m.section === "session_full")
	).toEqual({
		t: "scoped",
		section: "session_full",
		value: dossier
	})
	mounted.port.close()
	unmount(app)
	target.remove()
})
