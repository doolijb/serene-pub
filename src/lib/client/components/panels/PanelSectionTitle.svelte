<script lang="ts">
	import type { Snippet } from "svelte"

	/**
	 * The active section's full name, shown directly above that section's
	 * content.
	 *
	 * This is what makes icon-only tabs viable: the tab strip gives up its
	 * labels to stay on one row, and the name reappears here in full, where
	 * there is room for it and where it can never be truncated.
	 *
	 * The `actions` slot exists so this row can absorb a section's own primary
	 * control (World Lore's "+ New", the list sort control, …) rather than
	 * adding a row beneath it — the whole point of this pass is to spend fewer
	 * rows on chrome, not more.
	 */
	interface Props {
		title: string
		/** Rendered right-aligned on the same line as the title. */
		actions?: Snippet
		class?: string
	}

	let { title, actions, class: className = "" }: Props = $props()
</script>

<div class="flex min-w-0 items-center justify-between gap-2 {className}">
	<h3 class="text-foreground min-w-0 flex-1 truncate font-semibold">
		{title}
	</h3>
	{#if actions}
		<div class="panel-actions shrink-0">
			{@render actions()}
		</div>
	{/if}
</div>
