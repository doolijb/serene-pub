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
	import * as Icons from "@lucide/svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import {
		UNPLACED_SCRIPTS_HREF,
		unplacedChainCount,
		unplacedChainsLine
	} from "./unplacedChains"

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	/**
	 * Script chains stored at a seam their step does not declare (PLAN-script-placement
	 * D4, *Surfacing*). Admin › Scripts' own read, held while this page is
	 * open — the server re-sends it to admins when a chain or script changes —
	 * so the line and the Scripts *Unplaced* filter count alike.
	 */
	let unplaced = $state(0)
	const unplacedLine = $derived(unplacedChainsLine(unplaced))
	const onScripts = (res: Sockets.Pipelines.Scripts.Response) => {
		unplaced = unplacedChainCount(res.scripts ?? [])
	}
	$effect(() => requestWithInterest("pipelines:scripts", {}, onScripts))
</script>

<div class="mx-auto flex w-full max-w-[820px] flex-col">
	<AdminPageHeader
		title="Diagnostics"
		purpose="How this pub explains itself: a report to attach to a bug, and extra detail for working out why a reply came out the way it did."
	/>

	<div class="flex flex-col gap-4">
		{#if unplacedLine}
			<p class="panel-card flex items-center gap-2 text-sm" role="status">
				<Icons.TriangleAlert size={16} class="text-warning-600-400 shrink-0" aria-hidden="true" />
				<a
					href={UNPLACED_SCRIPTS_HREF}
					class="hover:text-primary-ink underline-offset-2 hover:underline focus-visible:underline"
				>
					{unplacedLine}
				</a>
			</p>
		{/if}
		<SupportReportCard />
		{#if systemSettingsCtx.settings}
			<ContextDebuggingCard />
		{:else}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{/if}
	</div>
</div>
