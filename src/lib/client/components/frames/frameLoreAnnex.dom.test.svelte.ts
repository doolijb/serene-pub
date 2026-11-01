/**
 * `lore.v1.annex` (🚧 M0, L8/L9): a wire whose inputs carry the `lore`
 * section and the grant posts it after `ready`, posts it again when the
 * viewer's annex view changes, and the supplier falls back to the frozen
 * marker with no view.
 */
import { describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Fixture from "./WidgetWireFixture.svelte"
import type { WidgetWire, WireInputs } from "./widgetWire.svelte"
import { LORE_GRANTED, projectScopedSections } from "$lib/shared/widgets/context"

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
		lore: () => got.filter((m) => m.t === "scoped" && m.section === "lore"),
		close: () => {
			wire.detach()
			unmount(app)
		}
	}
}

describe("lore.v1.annex", () => {
	test("posts the section after ready, and again when the annex changes", async () => {
		const live = $state({ annex: { "plugin:demo": { day: 1 } } as Record<string, Record<string, unknown>> })
		const w = await open(() => ({
			stateKey: "k",
			session: { id: 1, name: null },
			messages: [],
			owner: "acme",
			widgetId: "acme:lore",
			grants: ["lore"],
			scoped: { lore: { granted: true, annex: live.annex } }
		}))
		expect(w.lore().at(-1)).toEqual({
			t: "scoped",
			section: "lore",
			value: { granted: true, annex: { "plugin:demo": { day: 1 } } }
		})
		live.annex = { "plugin:demo": { day: 2 } }
		flushSync()
		await settle()
		expect(w.lore().at(-1)).toEqual({
			t: "scoped",
			section: "lore",
			value: { granted: true, annex: { "plugin:demo": { day: 2 } } }
		})
		w.close()
	})

	test("with no view yet the supplier gives the frozen marker", () => {
		expect(projectScopedSections(["lore"], () => undefined)?.lore).toBe(LORE_GRANTED)
	})
})
