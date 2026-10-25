<script lang="ts">
	/** 🚧 The pub's lore write mode (plan A22): what everyone who has not chosen follows. */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import LoreWriteModePicker from "$lib/client/components/inputs/LoreWriteModePicker.svelte"
	import SettingCard from "$lib/client/components/settingsTabs/SettingCard.svelte"
	import {
		effectiveLoreWriteMode,
		type LoreWriteMode
	} from "$lib/shared/lorebooks/loreWriteMode"
	import { requireAdmin } from "./requireAdmin"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	const current = $derived(
		effectiveLoreWriteMode(null, systemSettingsCtx.settings?.loreWriteModeDefault)
	)

	function choose(mode: LoreWriteMode | null) {
		if (!mode || !requireAdmin(userCtx.user)) return
		socket?.emit("systemSettings:updateLoreWriteModeDefault", { mode })
	}
</script>

<SettingCard
	title="Lorebook writes from sessions"
	titleId="lore-write-mode-heading"
	headingLevel={2}
	helpId="lore-write-mode-note"
	help="What a session may change in the lorebooks it reads, for everyone who has not chosen in Settings › User."
	layout="stack"
>
	<LoreWriteModePicker
		legend="Lorebook writes from sessions"
		name="pub-lore-write-mode"
		value={current}
		describedBy="lore-write-mode-note"
		onValueChange={choose}
	/>
</SettingCard>
