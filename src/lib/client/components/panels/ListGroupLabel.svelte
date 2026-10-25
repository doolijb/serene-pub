<script lang="ts">
	/**
	 * The one group label a sidebar list uses (PLAN-sidebar-nav-normalization
	 * §2.4, Q6): 12px muted words over the group, sentence case, no rule, no
	 * count unless the caller puts one in `trailing`. Six recipes became this
	 * one — the session list's _Your turn_ / _Recent_, the Admin and section
	 * lists' groups, Connections' "where the compute is" headers (the trade
	 * rides `trailing`; the hairline that sat between them is gone, §11).
	 *
	 * Muted (`surface-600-400`), never quiet: a label is text a reader uses,
	 * and quiet measured 3.45:1 at this size (STYLE-GUIDE §6.4).
	 */
	interface Props {
		label: string
		/**
		 * Muted words after the label — a trade line ("private · free"), a
		 * count. Truncates before the label does.
		 */
		trailing?: string
		/** For the list it heads to point `aria-labelledby` at. */
		id?: string
		/** 3 under a view's own h2; 4 when the list already sits under an h3. */
		headingLevel?: 3 | 4
		class?: string
	}

	let {
		label,
		trailing,
		id,
		headingLevel = 3,
		class: className = ""
	}: Props = $props()

	const tag = $derived(`h${headingLevel}` as "h3" | "h4")
</script>

<svelte:element
	this={tag}
	{id}
	class={[
		"text-surface-600-400 flex min-w-0 items-baseline gap-2 px-3 pt-4 pb-1 text-xs",
		className
	]}
>
	<span class="max-w-full min-w-0 shrink-0 truncate">{label}</span>
	{#if trailing}
		<span class="min-w-0 truncate text-meta">{trailing}</span>
	{/if}
</svelte:element>
