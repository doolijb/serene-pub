<script lang="ts">
	/**
	 * Pub › Diagnostics — switches that make the instance explain
	 * itself, at a cost in speed or storage. Split out of the old one-page
	 * System settings (2026-09-27). The support report sits here too: the
	 * instance describing itself for a bug report.
	 */
	import { getContext } from "svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import ContextDebuggingCard from "$lib/client/components/admin/pub/ContextDebuggingCard.svelte"
	import SupportReportCard from "$lib/client/components/admin/pub/SupportReportCard.svelte"

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
</script>

<div class="mx-auto flex w-full max-w-[820px] flex-col">
	<AdminPageHeader
		title="Diagnostics"
		purpose="How this pub explains itself: a report to attach to a bug, and extra detail for working out why a reply came out the way it did."
	/>

	<div class="flex flex-col gap-4">
		<SupportReportCard />
		{#if systemSettingsCtx.settings}
			<ContextDebuggingCard />
		{:else}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{/if}
	</div>
</div>
