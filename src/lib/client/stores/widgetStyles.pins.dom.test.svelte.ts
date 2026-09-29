/**
 * The pins round trip, driven the way the session page drives it: an EFFECT
 * reads the page's `layoutSettings` and pushes its `widgetStyles` into the
 * store (`setWidgetStylePins`), and the store's pin writer writes that same
 * `layoutSettings`.
 *
 * Seen live 2026-09-28: saving a NEW style from the settings modal left the
 * editor on "Saving…" for good, and from then on no style pick applied until
 * a reload. `setWidgetStylePins` asks the held save whether it landed, which
 * READ `pins`/`rows` inside the page's effect — the pins it had just written —
 * so the effect re-ran on its own write until Svelte killed it
 * (`effect_update_depth_exceeded`), and a dead effect never pushed a pin again.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"

type Listener = (payload: any) => void
function makeSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event)
			if (!arr) return
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		once() {},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}
const socket = makeSocket()

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))

import {
	resolveWidgetStyle,
	setWidgetStylePinWriter,
	setWidgetStylePins,
	widgetStylesStore,
	type WidgetStyleRow
} from "./widgetStyles.svelte"

function row(p: Partial<WidgetStyleRow> & { id: number }): WidgetStyleRow {
	return {
		slug: `messages:${p.id}`,
		widgetSlug: "messages",
		source: "user",
		ownerUserId: 1,
		visibility: "private",
		title: `Style ${p.id}`,
		css: `[data-widget-part~="messages.root"] { --n: ${p.id}; }`,
		vars: {},
		updatedAt: "2026-09-28T00:00:00.000Z",
		...p
	}
}

describe("a new style saved from the modal lands on the widget", () => {
	let stop: (() => void) | null = null
	afterEach(() => {
		stop?.()
		stop = null
		setWidgetStylePinWriter(null)
	})

	test("the page's pins effect survives the save hold", () => {
		const store = widgetStylesStore()
		const system = row({ id: 1, source: "system", visibility: "system" })
		socket.dispatch("widgetStyles:list", { styles: [system] })

		// The page: one `layoutSettings`, one effect pushing its pins.
		let layoutSettings = $state<Record<string, unknown>>({})
		stop = $effect.root(() => {
			$effect(() => {
				setWidgetStylePins(layoutSettings?.widgetStyles)
			})
		})
		setWidgetStylePinWriter((widgetStyles) => {
			layoutSettings = { ...layoutSettings, widgetStyles }
		})
		flushSync()

		// The editor: a draft on the widget, then Save as a new style.
		store.arm("messages")
		store.setPreview({ widgetId: "messages", css: ".x{}", vars: {} })
		store.create(
			{ widgetSlug: "messages", title: "Mine", css: ".x{}", vars: {} },
			"messages"
		)
		expect(store.saving).toBe("messages")

		// The server: the create reply (which pins), then the refreshed list.
		const mine = row({ id: 7 })
		expect(() => {
			socket.dispatch("widgetStyles:create", { style: mine })
			flushSync()
			socket.dispatch("widgetStyles:list", { styles: [system, mine] })
			flushSync()
		}).not.toThrow()

		expect(store.pins.messages?.id).toBe(7)
		expect(resolveWidgetStyle("messages")?.id).toBe(7)
		// The hold let go, so the editor closes and the preview comes down.
		expect(store.saving).toBeNull()
		expect(store.preview).toBeNull()

		// And the page's effect is still alive: a later pick still applies.
		store.pin("messages", { id: 1, slug: system.slug })
		flushSync()
		expect(resolveWidgetStyle("messages")?.id).toBe(1)
	})
})
