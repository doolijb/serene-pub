<script lang="ts">
	/**
	 * The shell while it waits to know who you are (less-confusing B3,
	 * 2026-10-11). `Layout.svelte` mounts pages only once the settings and the
	 * user have arrived (`shouldShowApp`), because a page that asks for a
	 * restricted key before the user is known gets no answer; that gate stays.
	 * Until then a deep link to `/admin` or a session drew an empty dark page
	 * for seconds. This draws the rail's outline in its own ground and, after
	 * a short wait, "Loading your pub…" in the middle. The grounds are the
	 * shell's own (STYLE-GUIDE §5.1): the wrapper is the page's
	 * `surface-100-900`, the rail paints `--sp-rail-bg`.
	 *
	 * The words wait `WORDS_DELAY_MS` so a warm reload, where the user arrives
	 * in a few milliseconds, never flashes them. The outline needs no wait: it
	 * is the shell's own grounds and edge, so the real rail draws over the
	 * same pixels.
	 *
	 * Below `lg` the rail is the bottom bar, so the outline is a bar there.
	 * Everything but the status line is `aria-hidden`: the shapes name nothing.
	 */
	import { onMount } from "svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"

	interface Props {
		/** The rail's remembered form, so the outline is the width it will be. */
		railWide?: boolean
	}

	let { railWide = false }: Props = $props()

	const WORDS_DELAY_MS = 400

	/** Rail groups as the real rail draws them: Home, Play, Tune, then the foot. */
	const GROUPS: { name?: string; count: number }[] = [
		{ count: 1 },
		{ name: "Play", count: 4 },
		{ name: "Tune", count: 2 }
	]

	let showWords = $state(false)

	onMount(() => {
		const timer = setTimeout(() => (showWords = true), WORDS_DELAY_MS)
		return () => clearTimeout(timer)
	})
</script>

{#snippet itemShape()}
	{#if railWide}
		<span class="flex h-10 w-full shrink-0 items-center gap-3 px-3">
			<span class="bg-surface-200-800 size-5 shrink-0 rounded-md"></span>
			<span class="bg-surface-200-800 h-2.5 w-20 rounded-full"></span>
		</span>
	{:else}
		<span class="flex size-11 shrink-0 items-center justify-center">
			<span class="bg-surface-200-800 size-5 rounded-md"></span>
		</span>
	{/if}
{/snippet}

<div
	class="bg-surface-100-900 relative flex h-svh w-full flex-col overflow-clip lg:flex-row"
	data-shell-loading
>
	<div
		class="panel-edge hidden shrink-0 flex-col border-r py-3 lg:flex {railWide
			? 'w-52 items-stretch gap-0.5 px-2.5'
			: 'w-16 items-center gap-1'}"
		style="background: var(--sp-rail-bg);"
		aria-hidden="true"
		data-shell-loading-rail
	>
		<div
			class="flex shrink-0 items-center {railWide
				? 'mb-3.5 gap-2.5 px-1.5'
				: 'mb-2 justify-center'}"
		>
			<img
				src="/icon-x48.png"
				srcset="/icon-x48.png 1x, /icon-x256.png 2x"
				alt=""
				class="block h-10 w-auto shrink-0"
			/>
			{#if railWide}
				<span
					class="text-foreground truncate [font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					Serene Pub
				</span>
			{/if}
		</div>
		{#each GROUPS as group, g}
			{#if g > 0}
				{#if railWide && group.name}
					<div class="text-surface-500 shrink-0 px-3 pt-3.5 pb-1 text-meta">
						{group.name}
					</div>
				{:else}
					<div class="bg-surface-300-700 my-2 h-px w-7 shrink-0"></div>
				{/if}
			{/if}
			{#each { length: group.count }}
				{@render itemShape()}
			{/each}
		{/each}
		<div class="flex-1"></div>
		{@render itemShape()}
		<span
			class="bg-surface-200-800 mt-1.5 size-8 shrink-0 rounded-full {railWide
				? 'ml-2'
				: ''}"
		></span>
	</div>

	<div class="flex min-h-0 min-w-0 flex-1 items-center justify-center">
		{#if showWords}
			<LoadingState message="Loading your pub…" showMessage />
		{/if}
	</div>

	<div
		class="bg-surface-50-950 panel-edge flex h-[68px] shrink-0 items-center justify-around border-t px-1 lg:hidden"
		aria-hidden="true"
		data-shell-loading-bar
	>
		{#each { length: 5 }}
			<span class="bg-surface-200-800 size-5 rounded-md"></span>
		{/each}
	</div>
</div>
