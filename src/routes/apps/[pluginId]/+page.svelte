<script lang="ts">
	/**
	 * 🚧 M2c: an applet's launcher. `/apps/<pluginId>` mounts the plugin's session-view frame with no session,
	 * full screen over the shell (Layout hides the rail and header for `/apps/`). The frame holds the front-end
	 * APIs `ui` and `applet`; what it may do is what the plugin's effective `applet:*` permissions say.
	 * One corner control, "Leave" (`AppletLeave`, asleep like Exit full screen), returns to the Sessions view; Esc does too.
	 */
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { getContext, setContext } from "svelte"
	import AppletLeave from "$lib/client/components/AppletLeave.svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import { WIDGET_REQUESTS_KEY, type WidgetRequestHandler } from "$lib/shared/widgets/context"
	import { guardWidgetRequests } from "$lib/client/components/sessionPage/requests/askers"
	import { answerNotify } from "$lib/client/components/sessionPage/requests/notify"
	import {
		WIDGET_REQUEST_ANSWERS,
		type WidgetRequestDeps
	} from "$lib/client/components/sessionPage/requests/index"
	import { WIDGET_REQUEST_APIS } from "@serene-pub/sdk"
	import { viewAddress } from "$lib/client/shell/viewRoutes"

	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const userCtx: UserCtx = getContext("userCtx")

	// The launcher covers the shell, so a request that opens the Sessions view (the start form, the filtered list,
	// the delete confirm) leaves it first. The answerers validate before they open anything: a refusal stays here.
	// A view opens on its own address (`/sessions`); `/` would land on the home page under a closed view.
	const openAfterLeaving = (args: { key: string; toggle?: boolean }) => {
		void goto(viewAddress(args.key) ?? "/").then(() => panelsCtx.openView(args.key, { toggle: false }))
	}
	const launcherPanels = new Proxy(panelsCtx, {
		get: (t, k) => (k === "openPanel" ? openAfterLeaving : Reflect.get(t, k)),
		set: (t, k, v) => Reflect.set(t, k, v)
	})

	// The launcher answers what a mount without a session may ask — the `ui` and `applet` kinds — from the session
	// page's own table, so one row answers both mounts (a row S switches from "not available yet" reaches here too).
	// Its deps hold only what those rows read: no session, the viewer, and the Sessions view behind the launcher.
	const launcherDeps = {
		sessionId: () => null,
		panelsCtx: () => launcherPanels,
		viewerId: () => userCtx.user?.id ?? null
	} as unknown as WidgetRequestDeps
	type Row = (params: unknown, from: unknown, deps: WidgetRequestDeps) => unknown
	setContext<WidgetRequestHandler>(
		WIDGET_REQUESTS_KEY,
		guardWidgetRequests((async (kind: string, params: unknown, from: { widgetId: string; owner: string }) => {
			const api = (WIDGET_REQUEST_APIS as Record<string, string>)[kind]
			if ((api !== "ui" && api !== "applet") || !Object.hasOwn(WIDGET_REQUEST_ANSWERS, kind))
				throw new Error(`'${String(kind)}' is not something this page answers`)
			// No session to put in full screen: the launcher already is. Notices carry no session.
			if (kind === "session-fullscreen") return undefined
			if (kind === "notify") return answerNotify(params as never, from as never, null)
			const row = (WIDGET_REQUEST_ANSWERS as unknown as Record<string, Row>)[kind]
			return row(params, from, launcherDeps)
		}) as never)
	)

	const data = $derived(
		page.data as { src?: string; title?: string; grants?: string[] }
	)

	function leave() {
		// The Sessions view is where an applet is entered from.
		openAfterLeaving({ key: "sessions" })
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return
		e.preventDefault()
		leave()
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if data.src}
	<div class="bg-surface-100-900 fixed inset-0 z-40">
		<PluginFrame
			src={data.src}
			title={data.title ?? "App"}
			surface="session-view"
			apis={["ui", "applet"]}
			grants={(data.grants ?? []) as never}
		/>
		<AppletLeave title={data.title ?? "this app"} onLeave={leave} />
	</div>
{:else}
	<div class="flex h-screen w-screen flex-col items-center justify-center gap-2 text-center">
		<p class="text-lg font-semibold">Not available</p>
		<p class="text-surface-600-400 text-sm">
			This plugin may be disabled, or offers nothing here.
		</p>
	</div>
{/if}
