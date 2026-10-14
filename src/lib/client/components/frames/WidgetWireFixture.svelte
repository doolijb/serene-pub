<script lang="ts">
	/**
	 * Test fixture: a widget wire under the page's contexts, handed back to
	 * the test — `createWidgetWire` reads Svelte context, so it lives in a
	 * component. Never mounted by the app.
	 */
	import { setContext } from "svelte"
	import {
		SESSION_ATTENDANCE_KEY,
		SESSION_TURN_ORDER_KEY,
		SESSION_VIEWER_KEY,
		WIDGET_REQUESTS_KEY
	} from "$lib/shared/widgets/context"
	import { createWidgetWire, type WidgetWire, type WireInputs, type WidgetWireOptions } from "./widgetWire.svelte"

	let {
		inputs,
		options = {},
		requests,
		attendance,
		onWire
	}: {
		inputs: () => WireInputs
		options?: Partial<WidgetWireOptions>
		requests?: unknown
		/** The page's `attendance.v1` reader; a fixed room when absent. */
		attendance?: { current: unknown }
		onWire: (wire: WidgetWire) => void
	} = $props()

	setContext("sessionAnnex", { current: { core: { mood: "calm" } } })
	setContext(SESSION_VIEWER_KEY, { current: { userId: 1, isAdmin: false, isGuest: false } })
	setContext(SESSION_TURN_ORDER_KEY, {
		current: { v: 1, order: [], candidates: [], basedOnAt: 0, computedAt: 0, runId: null, event: null, strategy: null }
	})
	// svelte-ignore state_referenced_locally
	setContext(
		SESSION_ATTENDANCE_KEY,
		attendance ?? {
			current: {
				v: 1,
				people: [{ userId: 1, name: "Mira", role: "owner", personaRefs: [], typing: false, lastSeenAt: 1, here: true }]
			}
		}
	)
	// svelte-ignore state_referenced_locally
	if (requests) setContext(WIDGET_REQUESTS_KEY, requests)

	// svelte-ignore state_referenced_locally
	onWire(
		createWidgetWire({
			inputs,
			label: () => "fixture",
			gate: () => ({ allowed: true }),
			...options
		})
	)
</script>
