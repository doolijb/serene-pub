<script lang="ts">
	/** Scripts — the fourth paradigm's kill switch (18 §10). */
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
		socket?.emit("systemSettings:updateScriptsEnabled", {
			enabled: event.checked
		})
	}
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="scripts-heading">
	<h2 id="scripts-heading" class="text-sm font-medium">Scripts</h2>
	<p class="text-surface-600-400 text-sm">
		User-authored scripts that transform pipeline runs — slop filters,
		stop guards, reminders at a depth. Off is a recovery lever, not a
		purge: every chain and attachment stays in place and simply does
		nothing until this is switched back on.
	</p>
	<SettingSwitch
		name="scripts-enabled"
		label="Run scripts"
		checked={systemSettingsCtx.settings?.scriptsEnabled ?? true}
		{onCheckedChange}
	/>
</section>
