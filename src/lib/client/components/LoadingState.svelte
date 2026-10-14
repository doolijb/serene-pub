<script lang="ts">
	/**
	 * The one loading block (STYLE-GUIDE §6.7: a spinner in place, never a
	 * blank pane; PLAN-sidebar-nav-normalization §2.4). A centred 20px
	 * spinner in the muted tone, `py-8`, announced politely through
	 * `role="status"`. The words are for the screen reader unless
	 * `showMessage` — most panes only need the spinner to be seen.
	 */
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** What is loading, said as a status. Default "Loading…". */
		message?: string
		/** Show the words beside the spinner instead of only announcing them. */
		showMessage?: boolean
		class?: string
	}

	let {
		message = "Loading…",
		showMessage = false,
		class: className = ""
	}: Props = $props()
</script>

<div
	role="status"
	class="text-surface-600-400 flex items-center justify-center gap-2 py-8 {className}"
>
	<Icons.Loader2 size={20} class="shrink-0 animate-spin" aria-hidden="true" />
	<span class={showMessage ? "text-sm" : "sr-only"}>{message}</span>
</div>
