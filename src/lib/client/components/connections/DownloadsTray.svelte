<script lang="ts">
	/**
	 * What is arriving, pinned at the foot of the index while anything is.
	 *
	 * One tray across every destination (concept ruling R4). Before it, a
	 * download was only visible on the screen that started it — a GGUF pulled
	 * from the KoboldCPP manager left no trace on the Connections index, so
	 * "why is nothing happening" and "it is downloading" were two screens
	 * apart.
	 *
	 * ⚠ Rendered ONLY while something is in flight. A permanent footer saying
	 * "0 downloads" is a row of chrome that is wrong about the interesting case
	 * and useless in every other.
	 *
	 * ⚠ Bytes, never a time estimate (R7). The bar is overall bytes and is
	 * simply absent when any in-flight item has no total — see `aggregate`.
	 */
	import * as Icons from "@lucide/svelte"

	interface Props {
		count: number
		/** 0–100 over every in-flight item's bytes, or null when unknown. */
		percent: number | null
		onView: () => void
	}
	let { count, percent, onView }: Props = $props()
</script>

<div
	class="border-surface-300-700 bg-surface-100-900 mt-2 flex shrink-0 items-center gap-2 rounded-[10px] border px-2.5 py-2"
	role="status"
	aria-label={`${count} ${count === 1 ? "download" : "downloads"} in progress`}
>
	<Icons.Download
		size={16}
		class="text-warning-500 shrink-0"
		aria-hidden="true"
	/>
	<span class="min-w-0 flex-1 truncate text-xs">
		{count}
		{count === 1 ? "download" : "downloads"}
	</span>
	{#if percent != null}
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
	<button
		type="button"
		class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0 text-xs"
		onclick={onView}
	>
		View
	</button>
</div>
