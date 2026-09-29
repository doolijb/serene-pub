/**
 * `lore:ranked` (R81) through the page's one fan-out and the shared widget
 * wire, over a real MessageChannel: the session page hands the server's
 * push to the `SurfaceManager`, and the wire tells a widget only when it may
 * read the lore — core's, or a plugin's granted `lore`, as of the moment
 * the event arrives. Other events are unaffected.
 */
import { describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"

const settle = () => new Promise((r) => setTimeout(r, 20))

async function open(inputs: () => WireInputs) {
	let wire!: WidgetWire
	const target = document.createElement("div")
	const app = mount(Fixture, { target, props: { inputs, onWire: (w: WidgetWire) => (wire = w) } })
	const channel = new MessageChannel()
	const got: Array<Record<string, unknown>> = []
	channel.port2.onmessage = (e) => got.push(e.data)
	wire.attach(channel.port1)
	channel.port2.postMessage({ t: "ready" })
	await settle()
	flushSync()
	return {
		/** The event kinds the widget was told, in order. */
		heard: () =>
			got.filter((m) => m.t === "event").map((m) => (m.event as { kind: string }).kind),
		close: () => {
			wire.detach()
			unmount(app)
		}
	}
}

const base = (source: SurfaceManager): WireInputs => ({
	stateKey: "k",
	session: { id: 1, name: null },
	messages: [],
	source
})

describe("lore:ranked reaches only the widgets that may read the lore", () => {
	test("core's widget and a plugin's granted 'lore' hear it; a plugin's without the grant does not", async () => {
		const manager = new SurfaceManager()
		const core = await open(() => ({ ...base(manager), owner: "core", widgetId: "core:lore-entries" }))
		const granted = await open(() => ({ ...base(manager), owner: "acme", widgetId: "acme:lore", grants: ["lore"] }))
		const other = await open(() => ({
			...base(manager),
			owner: "acme",
			widgetId: "acme:dice",
			grants: ["characters"]
		}))
		const bare = await open(() => ({ ...base(manager), owner: "acme", widgetId: "acme:clock" }))
		manager.announceLoreRanked()
		// An event every widget hears still reaches all four.
		manager.announceRecordedEvent({ event: "acme:event/rolled@1", payload: null, at: 1 })
		await settle()
		expect(core.heard()).toEqual(["lore:ranked", "event:recorded"])
		expect(granted.heard()).toEqual(["lore:ranked", "event:recorded"])
		expect(other.heard()).toEqual(["event:recorded"])
		expect(bare.heard()).toEqual(["event:recorded"])
		for (const w of [core, granted, other, bare]) w.close()
	})

	test("a grant is read as the event arrives: taken away, the widget is told no more", async () => {
		const manager = new SurfaceManager()
		const live = $state({ grants: ["lore"] as ("lore" | "characters")[] })
		const w = await open(() => ({ ...base(manager), owner: "acme", widgetId: "acme:lore", grants: live.grants }))
		manager.announceLoreRanked()
		await settle()
		live.grants = []
		flushSync()
		manager.announceLoreRanked()
		await settle()
		expect(w.heard()).toEqual(["lore:ranked"])
		w.close()
	})
})
