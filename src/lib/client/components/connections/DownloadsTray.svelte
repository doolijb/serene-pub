<script lang="ts">
	/**
	 * What is arriving, pinned at the foot of the index while anything is — and
	 * the whole downloads list, expanded from it in place.
	 *
	 * One tray across every destination (concept ruling R4). Before it, a
	 * download was only visible on the screen that started it — a GGUF pulled
	 * from the KoboldCPP manager left no trace on the Connections index, so
	 * "why is nothing happening" and "it is downloading" were two screens
	 * apart.
	 *
	 * **View** opens the list (`DownloadsView`) in a popover anchored to the
	 * tray: Cancel on each arriving file, **Clear finished** at its head. A list
	 * of what is in flight is a status surface, not a place, so nothing
	 * navigates (design 2026-10-09 C.1).
	 *
	 * ⚠ Drawn ONLY while something is in flight, or while its list is open —
	 * the caller keeps it for as long as `open` is bound true, so the last file
	 * finishing does not pull the list out from under the person reading it. A
	 * permanent footer saying "0 downloads" is a row of chrome that is wrong
	 * about the interesting case and useless in every other.
	 *
	 * ⚠ Bytes, never a time estimate (R7). The bar is overall bytes and is
	 * simply absent when any in-flight item has no total — see `aggregate`.
	 */
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import DownloadsView from "./DownloadsView.svelte"
	import { downloads } from "./downloads.svelte"

	interface Props {
		count: number
		/** 0–100 over every in-flight item's bytes, or null when unknown. */
		percent: number | null
		/** The list is open over the tray. */
		open?: boolean
	}
	let { count, percent, open = $bindable(false) }: Props = $props()

	const clearable = $derived(
		downloads.finished.length +
			downloads.failed.length +
			downloads.cancelled.length >
			0
	)
	const countWords = $derived(
		count > 0
			? `${count} ${count === 1 ? "download" : "downloads"}`
			: "Downloads"
	)
</script>

<div
	class="panel-edge bg-surface-100-900 mt-2 flex shrink-0 items-center gap-2 rounded-base border px-2.5 py-2"
	role="status"
	aria-label={count > 0
		? `${count} ${count === 1 ? "download" : "downloads"} in progress`
		: "Nothing downloading"}
>
	<Icons.Download
		size={16}
		class="{count > 0 ? 'text-warning-500' : 'text-surface-500'} shrink-0"
		aria-hidden="true"
	/>
	<span class="min-w-0 flex-1 truncate text-xs">{countWords}</span>
	{#if percent != null && count > 0}
		<span
			class="bg-surface-300-700 h-1.5 w-[90px] shrink-0 overflow-hidden rounded-full"
			aria-hidden="true"
		>
			<span
				class="bg-warning-500 block h-full rounded-full"
				style={`width: ${Math.round(percent)}%`}
			></span>
		</span>
	{/if}
	<Popover
		{open}
		onOpenChange={(e) => (open = e.open)}
		positioning={{ placement: "top-end" }}
	>
		<Popover.Trigger
			class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0 text-xs"
			aria-label={open ? "Hide downloads" : "View downloads"}
		>
			{open ? "Hide" : "View"}
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-50-950 border-surface-200-800 flex max-h-[min(70vh,480px)] w-[min(90vw,420px)] flex-col gap-2 border p-3 shadow-xl"
				>
					{#if open}
						<div class="flex shrink-0 items-center gap-2">
							<h3 class="min-w-0 flex-1 text-sm font-semibold">
								Downloads
							</h3>
							<button
								type="button"
								class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0 text-xs"
								disabled={!clearable}
								onclick={() => downloads.clearFinished()}
							>
								<Icons.Eraser size={14} aria-hidden="true" />
								Clear finished
							</button>
						</div>
						<div class="flex min-h-0 flex-1 flex-col">
							<DownloadsView embedded />
						</div>
					{/if}
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
</div>
