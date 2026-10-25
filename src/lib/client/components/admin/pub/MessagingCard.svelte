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
	import SettingCard from "$lib/client/components/settingsTabs/SettingCard.svelte"
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

{#snippet accountsOffNote()}
	User accounts are off, so there is nobody to message yet; turn them on
	above for this to apply.
{/snippet}

<!-- The switch says on or off itself, so no status line repeats it. -->
<SettingCard
	id="messaging"
	title="Messages between people"
	titleId="messaging-heading"
	headingLevel={2}
	help="People with accounts write to each other privately and attach sessions, characters, lorebooks and files; off hides Messages and deletes nothing."
	layout="switch"
	below={accountsOn ? undefined : accountsOffNote}
>
	<SettingSwitch
		name="messaging-enabled"
		label="Messages between people"
		labelHidden
		checked={enabled}
		{onCheckedChange}
	/>
</SettingCard>
