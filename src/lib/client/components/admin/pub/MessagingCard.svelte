<script lang="ts">
	/**
	 * Messages between people — the pub-wide switch for private messages
	 * (PLAN-private-messages-2026-10-12 §4). Off hides the Messages rail item
	 * for everyone and the server refuses every `conversations:` request; the
	 * conversations themselves stay, and come back when it is switched on.
	 * Meaningful only with user accounts on: one person has nobody to message.
	 */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import SettingSwitch from "./SettingSwitch.svelte"
	import { requireAdmin } from "./requireAdmin"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	let enabled = $derived(
		systemSettingsCtx.settings?.messagingEnabled ?? true
	)
	let accountsOn = $derived(!!systemSettingsCtx.settings?.isAccountsEnabled)

	function onCheckedChange(event: { checked: boolean }) {
		if (!requireAdmin(userCtx.user)) return
		socket?.emit("systemSettings:updateMessagingEnabled", {
			enabled: event.checked
		})
	}
</script>

<section
	id="messaging"
	class="panel-card flex flex-col gap-3"
	aria-labelledby="messaging-heading"
>
	<h2 id="messaging-heading" class="text-sm font-medium">
		Messages between people
	</h2>
	<p class="text-surface-600-400 text-sm">
		People with accounts on this pub can write to each other privately,
		one to one or in a group, and attach sessions, characters, lorebooks
		and files. Off hides Messages for everyone; nothing already written is
		deleted.
	</p>
	<SettingSwitch
		name="messaging-enabled"
		label="Messages between people"
		checked={enabled}
		{onCheckedChange}
	/>
	<p class="text-surface-600-400 text-sm" aria-live="polite">
		{enabled ? "On — people with accounts can message each other" : "Off"}
	</p>
	{#if !accountsOn}
		<p class="text-surface-600-400 text-sm">
			User accounts are off, so there is nobody to message yet. Turn on
			User accounts above for this to apply.
		</p>
	{/if}
</section>
