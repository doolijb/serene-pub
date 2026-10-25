<script lang="ts">
	/** Scripts — the fourth paradigm's kill switch (18 §10). */
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
		socket?.emit("systemSettings:updateScriptsEnabled", {
			enabled: event.checked
		})
	}
</script>

<!-- Titled by the switch's own words: the card IS the switch (§6.4). Off
     is a recovery lever, not a purge — chains and attachments stay. -->
<SettingCard
	title="Run scripts"
	titleId="scripts-heading"
	headingLevel={2}
	help="Scripts people write into pipelines; off stops every one and deletes nothing."
	layout="switch"
>
	<SettingSwitch
		name="scripts-enabled"
		label="Run scripts"
		labelHidden
		checked={systemSettingsCtx.settings?.scriptsEnabled ?? true}
		{onCheckedChange}
	/>
</SettingCard>
