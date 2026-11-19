<script lang="ts">
	/**
	 * The diagnostic switch for step time limits (lane dbg-1, owner 2026-11-15).
	 * While on, runs that start apply no step time limit and no ceiling; Stop
	 * still ends every run, and the limits inside a call (script and plugin
	 * sandboxes, tool hooks, the connection's ten-minute idle watchdog) stay
	 * on. Administrators see a standing notification, a *Needs you* item and
	 * *Time limits off* on the Turn line while it is on.
	 */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import SettingSwitch from "./SettingSwitch.svelte"
	import SettingCard from "$lib/client/components/settingsTabs/SettingCard.svelte"
	import { requireAdmin } from "./requireAdmin"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	function onCheckedChange(event: { checked: boolean }) {
		if (!requireAdmin(userCtx.user)) return
		socket?.emit("systemSettings:updateStepTimeLimitsOff", {
			enabled: event.checked
		})
	}
</script>

<!-- The switch says on or off itself, so no status line repeats it. -->
<SettingCard
	id="step-time-limits"
	title="Turn off step time limits"
	titleId="step-time-limits-heading"
	headingLevel={2}
	help="For finding out whether a time limit is what stops a step; a stuck step then waits until someone stops it."
	layout="switch"
>
	<SettingSwitch
		name="step-time-limits-off"
		label="Turn off step time limits"
		labelHidden
		checked={!!systemSettingsCtx.settings?.stepTimeLimitsOff}
		{onCheckedChange}
	/>
</SettingCard>
