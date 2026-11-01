<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import {
		acppApplyLine,
		acppBuildLine,
		acppLoadedLine,
		acppProcessLine,
		type StatusDot
	} from "$lib/client/components/connections/managedConnectionView"

	interface Props {
		status: Sockets.AudioCpp.StatusView | null
		install: Sockets.AudioCpp.InstallState.Response | null
		offline: boolean
		busy: "start" | "stop" | "restart" | null
		onStart: () => void
		onStop: () => void
		onRestart: () => void
	}

	let { status, install, offline, busy, onStart, onStop, onRestart }: Props =
		$props()

	const DOT: Record<StatusDot, string> = {
		ok: "bg-success-500",
		pending: "bg-warning-500 animate-pulse",
		warning: "bg-warning-500",
		error: "bg-error-500",
		quiet: "bg-surface-400-600"
	}

	let line = $derived(acppProcessLine(status))
	let build = $derived(
		acppBuildLine({
			version: status?.version ?? install?.version,
			backend: status?.backend ?? install?.backend,
			releaseTag: install?.releaseTag,
			verified: install?.verified
		})
	)
	let loaded = $derived(acppLoadedLine(status))
	let applyLine = $derived(acppApplyLine(status))
	let isUp = $derived(
		!offline && (status?.status === "running" || status?.status === "starting")
	)
	let stopBlocked = $derived(!!status?.isExternal)
	let anyBusy = $derived(busy !== null)
</script>

{#snippet statusDot(dot: StatusDot)}
	<span class="size-2 shrink-0 rounded-full {DOT[dot]}" aria-hidden="true"
	></span>
{/snippet}

{#snippet spin(on: boolean)}
	{#if on}<Icons.Loader2 size={14} class="animate-spin" />{/if}
{/snippet}

<div class="flex flex-col gap-4 p-3">
	<div class="flex flex-col gap-1">
		{#if offline}
			<p class="text-sm">audio.cpp is switched off.</p>
		{:else if line}
			<p class="flex items-center gap-2 text-sm font-medium">
				{@render statusDot(line.dot)}
				<span>{line.label}</span>
				{#if line.meta}
					<span class="text-surface-600-400 text-xs font-normal">
						{line.meta}
					</span>
				{/if}
			</p>
		{:else}
			<p class="flex items-center gap-2 text-sm font-medium">
				{@render statusDot("quiet")}
				<span>Not checked yet</span>
			</p>
		{/if}
		{#if build}
			<p class="text-surface-600-400 text-xs">{build}</p>
		{/if}
		{#if applyLine}
			<p class="text-surface-700-300 flex items-center gap-2 text-xs">
				{@render statusDot("pending")}
				{applyLine}
			</p>
		{/if}
		{#if install?.verified === false}
			<p class="text-surface-600-400 text-xs">
				This build was installed without a published checksum
				(unverified).
			</p>
		{/if}
	</div>

	{#if !offline && status?.status === "running"}
		<div>
			<p class="text-surface-600-400 mb-1 text-xs">Models in memory</p>
			{#if loaded.loaded}
				<ul class="flex flex-col gap-0.5 text-xs">
					{#each status.loaded as m (m.id)}
						<li>
							{m.id}
							{#if m.device}
								<span class="text-surface-600-400">· {m.device}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-700-300 text-xs">{loaded.text}</p>
			{/if}
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-2">
		{#if isUp}
			<button
				class="btn preset-tonal-surface"
				disabled={anyBusy}
				onclick={onRestart}
			>
				{@render spin(busy === "restart")}
				Restart
			</button>
			<button
				class="btn preset-tonal-surface"
				disabled={anyBusy || stopBlocked}
				onclick={onStop}
			>
				{@render spin(busy === "stop")}
				Stop
			</button>
		{:else}
			<button
				class="btn preset-filled-primary-500"
				disabled={anyBusy || status?.status === "stopping"}
				onclick={onStart}
			>
				{@render spin(busy === "start")}
				Start
			</button>
		{/if}
	</div>
	{#if isUp && stopBlocked}
		<p class="text-surface-600-400 text-xs">
			Serene Pub did not start this audio.cpp, so it cannot stop it.
		</p>
	{/if}
</div>
