<script lang="ts">
	/** Context debugging — the prompt inspector and the diagnostics behind it. */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import SettingSwitch from "./SettingSwitch.svelte"
	import { requireAdmin } from "./requireAdmin"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	function onCheckedChange(event: { checked: boolean }) {
		if (!requireAdmin(userCtx.user)) return
		socket?.emit("systemSettings:updateContextDebuggingEnabled", {
			enabled: event.checked
		})
	}
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="context-debugging-heading">
	<h2 id="context-debugging-heading" class="text-sm font-medium">
		Context debugging
	</h2>
	<p class="text-surface-600-400 text-sm">
		When on, shows the prompt inspector tab in the session UI, computes
		full retrieval diagnostics (RAG included), and saves compiled prompt
		metadata alongside each generated message for later inspection.
	</p>
	<SettingSwitch
		name="enable-context-debugging"
		label="Context debugging"
		checked={!!systemSettingsCtx.settings?.contextDebuggingEnabled}
		{onCheckedChange}
	/>
</section>
