<script lang="ts">
	/** 🚧 The pub's lore write mode (plan A22): what everyone who has not chosen follows. */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import LoreWriteModePicker from "$lib/client/components/inputs/LoreWriteModePicker.svelte"
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

<section
	class="panel-card flex flex-col gap-3"
	aria-labelledby="lore-write-mode-heading"
>
	<h2 id="lore-write-mode-heading" class="text-sm font-medium">
		Lorebook writes from sessions
	</h2>
	<p id="lore-write-mode-note" class="text-surface-600-400 text-sm">
		What a session may change in the lorebooks it reads: the stats it
		records, a summary, a compiled history, a graph. Everyone who has not
		chosen for themselves in Settings › User follows this; anyone who has
		keeps their choice.
	</p>
	<LoreWriteModePicker
		legend="Lorebook writes from sessions"
		name="pub-lore-write-mode"
		value={current}
		describedBy="lore-write-mode-note"
		onValueChange={choose}
	/>
</section>
