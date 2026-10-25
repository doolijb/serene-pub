<script lang="ts" module>
	export { metaLineItems, type MetaLineItem } from "./metaLine"
</script>

<script lang="ts">
	import { metaLineItems, type MetaLineItem } from "./metaLine"
	/**
	 * The **meta line** 🚧 (PLAN-0-5-polish-parity L6 and §5.3, 2026-10-24;
	 * STYLE-GUIDE §6.4; NOMENCLATURE §25): the one muted line of small facts
	 * under a name — a row's last line and its date, a continue card's
	 * _Story · Oct 1 · your turn_, a character's summary. Before it, dates,
	 * genre names and counts appeared in three weights and two sizes, and a
	 * row's preview was italic beside a name it competed with.
	 *
	 * Two parts, both optional:
	 *
	 * - the **lead** (`children`): the phrase that gives way first — a
	 *   session's last line, a character's summary, a handle. 13px, upright,
	 *   one line, truncated with an ellipsis so the facts after it always
	 *   show;
	 * - the **facts** (`items`): 12px, never truncated, joined by ` · `
	 *   (and after the lead by one more). Empty items are dropped, so a caller
	 *   passes `[showGenre && genre, when]` and never writes a separator.
	 *
	 * Muted (`surface-600-400`), never quiet: these are facts a reader came
	 * for, and quiet text fails AA at this size (STYLE-GUIDE §6.4, "Quiet is
	 * for icons, not text"). A `span` that lays out as a flex row, so it is
	 * valid inside the row's `<button>` (phrasing content only).
	 */
	import type { Snippet } from "svelte"

	interface Props {
		/** The facts after the lead, in order. */
		items?: readonly MetaLineItem[]
		/** The lead: the part that truncates. */
		children?: Snippet
		/** For a row to point `aria-describedby` at. */
		id?: string
		class?: string
	}

	let { items = [], children, id, class: className = "" }: Props = $props()

	const facts = $derived(metaLineItems(items))
</script>

<span
	{id}
	class="text-surface-600-400 flex min-w-0 items-baseline text-left {className}"
	data-meta-line
>
	{#if children}
		<!-- 13px (STYLE-GUIDE §3.2 "secondary body"; `text-chip` once L13's
		     type utilities land). -->
		<span class="min-w-0 truncate text-chip leading-[1.45]">
			{@render children()}
		</span>
	{/if}
	{#each facts as fact, i (i)}
		{#if children || i > 0}
			<!-- The separator's spaces collapse at a flex item's edge, so the
			     room is padding; the text keeps them, as a joined string would. -->
			<span class="shrink-0 px-1 text-xs">{" · "}</span>
		{/if}
		<span
			class="text-xs whitespace-nowrap {children
				? 'shrink-0'
				: 'min-w-0 truncate'}"
		>
			{fact}
		</span>
	{/each}
</span>
