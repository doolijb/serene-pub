<script lang="ts">
	import { docsHref } from "$lib/shared/utils/docsHref"
	/**
	 * Pub › Data and backups — the backup policies, then the backups
	 * themselves (Back up now, the list, Delete, databases set aside). The
	 * list is `DataSettingsTab`, the same component the Settings sidebar's
	 * Data tab shows; restore stays on `/recovery` and `npm run db:recover`,
	 * because a running app with live sockets cannot swap its own database.
	 */
	import { getContext } from "svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import BackupPolicyCard from "$lib/client/components/admin/pub/BackupPolicyCard.svelte"
	import DataSettingsTab from "$lib/client/components/settingsTabs/DataSettingsTab.svelte"

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
</script>

<div class="mx-auto flex w-full max-w-[820px] flex-col">
	<AdminPageHeader
		title="Data and backups"
		doc={docsHref("system-settings", "data-and-backups")}
		purpose="When the database is copied, what goes with it, and the copies kept so far."
	/>

	{#if systemSettingsCtx.settings}
		<div class="flex flex-col gap-4">
			<BackupPolicyCard />
			<DataSettingsTab />
		</div>
	{:else}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{/if}
</div>
