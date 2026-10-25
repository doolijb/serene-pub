<script lang="ts">
	import type { Snippet } from "svelte"

	/**
	 * One setting, one card (STYLE-GUIDE §6.4 "Setting cards", polish parity
	 * L5, 2026-10-24): the setting's name as the title, one sentence of help,
	 * the control. The title IS the control's label, so the control's own
	 * label is visually hidden wherever it would repeat the title.
	 *
	 * `layout`:
	 * - `field` — a select or input beside the words in a 280px column once
	 *   the view is 480px wide; under that it stacks below them.
	 * - `switch` — a switch beside the words at its own width, at every width.
	 * - `stack` — the control under the words, full width (a radio list, a
	 *   picker, a form of several fields).
	 *
	 * `children` is the control column (a readout that belongs to the control,
	 * such as the time zone's "Now:", goes in it, under the control); `below`
	 * is a full-width line under both, for help that says something new.
	 *
	 * Used by Settings › User, Themes and Media, and Admin › General. ⚠ Not a
	 * section card (`panel-card` with a 14px heading over several things);
	 * a setting card holds one decision.
	 */
	interface Props {
		/** The setting's name — the card's title (15px, medium). */
		title: string
		/** The title's id: the card's `aria-labelledby`, and what an admin
		 *  address or Jump may land on. */
		titleId: string
		/** 2 on an Admin page under its h1; 3 in a Settings section. */
		headingLevel?: 2 | 3
		/** One sentence. A snippet when it carries a link. */
		help?: string | Snippet
		/** The help line's id, for the control's `aria-describedby`. */
		helpId?: string
		layout?: "field" | "switch" | "stack"
		/** The card's own id (an admin address such as `#accounts`). */
		id?: string
		testid?: string
		class?: string
		children: Snippet
		below?: Snippet
	}

	let {
		title,
		titleId,
		headingLevel = 3,
		help,
		helpId,
		layout = "field",
		id,
		testid,
		class: className = "",
		children,
		below
	}: Props = $props()

	const tag = $derived(`h${headingLevel}` as "h2" | "h3")
</script>

<section
	{id}
	class={[
		"panel-card grid gap-x-4 gap-y-3",
		layout === "field" &&
			"grid-cols-1 @min-[480px]/view:grid-cols-[minmax(0,1fr)_280px] @min-[480px]/view:items-center",
		layout === "switch" && "grid-cols-[minmax(0,1fr)_auto] items-center",
		layout === "stack" && "grid-cols-1",
		className
	]}
	aria-labelledby={titleId}
	data-testid={testid}
>
	<div class="flex max-w-[760px] min-w-0 flex-col gap-1">
		<svelte:element this={tag} id={titleId} class="text-lead font-medium">
			{title}
		</svelte:element>
		{#if help}
			<p id={helpId} class="text-surface-600-400 text-chip">
				{#if typeof help === "string"}
					{help}
				{:else}
					{@render help()}
				{/if}
			</p>
		{/if}
	</div>
	<div class="flex min-w-0 flex-col gap-1.5">
		{@render children()}
	</div>
	{#if below}
		<div class="text-surface-600-400 col-span-full max-w-[760px] text-xs">
			{@render below()}
		</div>
	{/if}
</section>
