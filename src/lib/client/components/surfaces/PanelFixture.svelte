<script lang="ts">
	/**
	 * Test fixture: a `Panel` under the page contexts that supply scoped
	 * sections (the dossier, the session's state) and, when given, the
	 * page's request handler — with a stub manager.
	 * Never mounted by the app.
	 */
	import { setContext } from "svelte"
	import { SESSION_DOSSIER_KEY, SESSION_STATE_KEY, WIDGET_REQUESTS_KEY } from "$lib/shared/widgets/context"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import Panel from "./Panel.svelte"

	let {
		instance,
		session,
		supplies,
		requests
	}: {
		instance: PanelInstance
		session: { id: number; name?: string | null; sessionMessages: unknown[] }
		supplies: { state?: unknown; dossier?: unknown }
		/** The page's answer to a widget's request (`WIDGET_REQUESTS_KEY`), when a test gives one. */
		requests?: unknown
	} = $props()

	// svelte-ignore state_referenced_locally
	if (requests) setContext(WIDGET_REQUESTS_KEY, requests)

	setContext(SESSION_STATE_KEY, {
		get current() {
			return supplies.state
		}
	})
	setContext(SESSION_DOSSIER_KEY, {
		get current() {
			return supplies.dossier
		}
	})
	const manager = {
		drawerOpenId: null,
		subscribe: () => () => {},
		toggleCollapse: () => {},
		close: () => {}
	}
</script>

<Panel {instance} manager={manager as never} sessionId={session.id} {session} chrome="zone" />
