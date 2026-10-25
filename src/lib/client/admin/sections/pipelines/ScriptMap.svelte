<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The Scripts tab of the admin pipeline workspace (PLAN-script-placement
	 * D3, R-Q1 as amended): every place a script can run in this pipeline, in
	 * run order, grouped by step, with what is attached there — and, on a
	 * `text/stop` seam, the stop guards the configuration's connection adds.
	 * Chains whose seam is gone (D4) are listed last, under *Unplaced*.
	 *
	 * Read-only, and it describes the selected configuration, not a run. The
	 * data is the Configure tab's own view (`pipelines:get`, the panel payload
	 * `config/panel/read.ts` builds): the page hands down the view it already
	 * holds, and this tab holds the same standing key while it is mounted, so
	 * a configuration switch (which re-sends the view) lands here too. It asks
	 * only when the page has no view yet — a `?tab=scripts` landing.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import { optionsOf } from "$lib/client/components/pipelines/settingsGroups"
	import { connectionGuardsLine, groupSeams, seamHref } from "./scriptMap"

	type Option = Sockets.Pipelines.Option

	interface Props {
		slug: string
		/** The view the page already holds (the Configure tab's), or null. */
		detail: Sockets.Pipelines.NamespaceDetail | null
		/** A fresh view arrived — the page keeps it, as Configure's does. */
		onLoaded: (detail: Sockets.Pipelines.NamespaceDetail) => void
		/** Open a seam on the Configure tab, scrolled and lit. */
		onJump: (stepKey: string, optionId: string) => void
	}

	let { slug, detail, onLoaded, onJump }: Props = $props()

	const socket = useTypedSocket()

	// BARE key, the same standing interest the Configure panel holds: every
	// write and every configuration switch re-sends the view on it. The slug
	// and scope checks are the filter (see PipelineConfigOptions).
	const onGet = (res: Sockets.Pipelines.Get.Response) => {
		if (res.error || !res.pipeline) return
		if (res.pipeline.slug !== slug || res.pipeline.scope.kind === "session") return
		onLoaded(res.pipeline)
	}
	useInterest<"pipelines:get">("pipelines:get", onGet)

	onMount(() => {
		if (!detail) socket.emit("pipelines:get", { slug })
	})

	const map = $derived(detail ? groupSeams(optionsOf(detail.groups)) : null)
	// Named configurations are retired (R38; lane 7): a seam opens on the pipeline itself.
	const configId = null

	function open(e: MouseEvent, o: Option) {
		// A modified click is a new tab on the href; a plain one stays here.
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
		e.preventDefault()
		onJump(o.step.key, o.id)
	}
</script>

{#snippet seam(o: Option, stepHeading?: string)}
	{@const chain = o.scripts ?? []}
	{@const guards = connectionGuardsLine(o)}
	<li class="flex flex-col gap-1 py-2" data-seam={o.at}>
		<a
			href={seamHref(slug, configId, o)}
			class="text-surface-800-200 hover:text-primary-ink self-start text-sm font-semibold underline-offset-2 hover:underline focus-visible:underline"
			onclick={(e) => open(e, o)}
		>
			{o.label}
		</a>
		{#if stepHeading}
			<p class="text-surface-600-400 text-xs">On step {stepHeading}</p>
		{/if}
		{#if o.flows}
			<p class="text-surface-600-400 text-xs">{o.flows}</p>
		{/if}
		{#if o.acceptsLabels?.length}
			<div class="flex flex-wrap gap-1" aria-label="Script kinds accepted here">
				{#each o.acceptsLabels as kind (kind)}
					<Badge size="sm">
						{kind}
					</Badge>
				{/each}
			</div>
		{/if}
		{#if chain.length}
			<ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm" aria-label="Attached, in run order">
				{#each chain as entry, i (entry.id)}
					<li class="flex items-center gap-1.5">
						{#if i > 0}
							<Icons.ChevronRight size={12} class="text-surface-600-400" aria-hidden="true" />
						{/if}
						<span class={entry.enabled && !entry.missing ? "" : "opacity-50"} title={entry.typeLabel}>
							{entry.missing ? `Missing script (#${entry.id})` : entry.name}
						</span>
						{#if entry.missing}
							<Badge tone="error" size="sm">deleted</Badge>
						{:else if !entry.enabled}
							<span
								class="text-surface-600-400 text-meta"
								title="Disabled on the scripts page — keeps its place, does nothing."
							>
								off
							</span>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="text-surface-600-400 text-sm" aria-label="No scripts attached">—</p>
		{/if}
		{#if guards}
			<p class="text-surface-600-400 flex items-start gap-1 text-xs">
				<Icons.Plug size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
				<span>{guards}</span>
			</p>
		{/if}
	</li>
{/snippet}

{#if !map}
	<LoadingState />
{:else if !map.steps.length && !map.unplaced.length}
	<EmptyState icon={Icons.ScrollText} message="This pipeline has no place a script can run." />
{:else}
	<FieldHelp>
		Every place a script can run, in run order, as this pipeline's values have it. Open one to change its
		chain.
	</FieldHelp>
	{#each map.steps as step (step.stepKey)}
		<section class="panel-card flex flex-col" aria-labelledby="script-map-{step.stepKey}">
			<h3 id="script-map-{step.stepKey}" class="text-sm font-medium">{step.heading}</h3>
			<ul class="divide-surface-200-800 flex flex-col divide-y">
				{#each step.rows as o (o.id)}
					{@render seam(o)}
				{/each}
			</ul>
		</section>
	{/each}
	{#if map.unplaced.length}
		<section class="panel-card flex flex-col" aria-labelledby="script-map-unplaced">
			<h3 id="script-map-unplaced" class="flex items-center gap-1.5 text-sm font-medium">
				<Icons.Archive size={14} aria-hidden="true" /> Unplaced
			</h3>
			<FieldHelp>
				These steps no longer have the place these scripts were attached to. They are
				skipped; a stop script here stops the reply from running.
			</FieldHelp>
			<ul class="divide-surface-200-800 flex flex-col divide-y">
				{#each map.unplaced as o (o.id)}
					{@render seam(o, o.step.heading)}
				{/each}
			</ul>
		</section>
	{/if}
{/if}
