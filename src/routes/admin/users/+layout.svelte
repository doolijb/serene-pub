<script lang="ts">
	/**
	 * The Users section exists only while accounts do. With accounts off the
	 * instance is single-user — the nav already hides this section, and this
	 * gate covers the direct URL: children never mount (so no users:* emits
	 * fire), and the server refuses those handlers regardless. The real
	 * enforcement is requireAccountsEnabled() in users.ts; this is the door.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"

	let { children } = $props()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let accountsOff = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled === false
	)
</script>

{#if accountsOff}
	<div class="mb-4">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Users size={20} /> Users
		</h2>
	</div>
	<div class="card preset-filled-surface-100-900 max-w-2xl p-6">
		<p class="flex items-center gap-2 font-medium">
			<Icons.UserX size={18} class="text-warning-500" />
			Accounts are turned off
		</p>
		<p class="text-surface-600-400 mt-1 text-sm">
			This instance runs in single-user mode, so there is no user roster
			to manage. Turn accounts on in
			<a href="/admin/settings" class="anchor">Settings</a> to invite
			people and manage their access here.
		</p>
	</div>
{:else}
	{@render children()}
{/if}
