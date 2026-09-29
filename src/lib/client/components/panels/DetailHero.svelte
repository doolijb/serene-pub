<script lang="ts">
	/**
	 * The one header a detail view draws for the thing it shows (STYLE-GUIDE
	 * §6.4): a 72px media tile, the name in 18px Display, a 13px muted line
	 * under it, then chips and actions.
	 *
	 * The tile is the thing's picture when it has one, its initial when it is
	 * a person without one, and an icon when it is a thing that never has a
	 * picture (a connection, a model, a tag). Navigation is NOT here: the
	 * back/title row above it stays `PanelNavHeader`, where one exists.
	 *
	 * The name is a `<p>` in the heading face by default, because the
	 * `PanelNavHeader` above already owns the panel's heading and a second
	 * heading saying the same name would put two outline entries on one
	 * thing. A page with no nav header passes `headingLevel` to make it one.
	 */
	import type { Component, Snippet } from "svelte"

	interface Props {
		title: string
		/** The 13px muted line under the name. */
		subtitle?: string
		/** A second, 12px muted line: meta such as counts and times. */
		meta?: string
		/** The thing's picture. */
		image?: string | null
		/** Shown in the tile when there is no image, eg. a user's initial. */
		letter?: string
		/** Shown in the tile when there is neither image nor letter. */
		icon?: Component<any>
		/** Replaces the whole tile (a composite cover). Draw it at 72px. */
		media?: Snippet
		/** Laid over the tile's bottom-right corner, eg. a second cast member. */
		badge?: Snippet
		/** Chips row under the text. */
		chips?: Snippet
		/** Actions row under the chips. */
		actions?: Snippet
		/** Render the name as a real heading (pages without a PanelNavHeader). */
		headingLevel?: 2 | 3
		class?: string
	}

	let {
		title,
		subtitle,
		meta,
		image,
		letter,
		icon: TileIcon,
		media,
		badge,
		chips,
		actions,
		headingLevel,
		class: className = ""
	}: Props = $props()

	/** One shape for every tile — people, pictures and things alike. */
	const radius = "rounded-[14px]"
	const titleTag = $derived(headingLevel ? `h${headingLevel}` : "p")
</script>

<div class="flex min-w-0 shrink-0 items-start gap-3 {className}">
	<span class="relative block size-[72px] shrink-0">
		{#if media}
			{@render media()}
		{:else if image}
			<img
				src={image}
				alt=""
				class="size-[72px] {radius} object-cover object-top"
			/>
		{:else if letter}
			<span
				class="bg-surface-200-800 text-surface-800-200 grid size-[72px] place-items-center {radius} [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
				aria-hidden="true"
			>
				{letter.charAt(0).toUpperCase()}
			</span>
		{:else}
			<span
				class="bg-surface-200-800 grid size-[72px] place-items-center {radius}"
			>
				{#if TileIcon}
					<TileIcon
						size={32}
						class="text-surface-600-400"
						aria-hidden="true"
					/>
				{/if}
			</span>
		{/if}
		{#if badge}
			<span class="absolute -right-1 -bottom-1">
				{@render badge()}
			</span>
		{/if}
	</span>
	<div class="min-w-0 flex-1">
		<svelte:element
			this={titleTag}
			class="truncate [font-family:var(--typo-heading--font-family)] text-[18px] leading-[1.3] font-semibold"
		>
			{title}
		</svelte:element>
		{#if subtitle}
			<p class="text-surface-600-400 truncate text-[13px]">
				{subtitle}
			</p>
		{/if}
		{#if meta}
			<p class="text-surface-600-400 truncate text-xs">{meta}</p>
		{/if}
		{#if chips}
			<div class="mt-1.5 flex flex-wrap items-center gap-1">
				{@render chips()}
			</div>
		{/if}
		{#if actions}
			<div class="mt-2 flex flex-wrap items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
</div>
