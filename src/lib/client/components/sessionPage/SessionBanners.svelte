<!--
	@component
	Who else is typing, as one pill (a host view, `session-banners`): the
	Messages widget places it in its **turn line**'s right half, beside who
	is due next (PLAN-core-widgets §3.16).

	The stale-preset notice is the session header's, not this pill's
	(`openSessionCtx.headerNotice`, `presetNotice.ts`): a pipeline
	substitution is not a turn fact.
-->
<script lang="ts">
	interface Props {
		/** Other participants' personas typing now. */
		typing: { name: string }[]
		/** The composer is there to type into (not read-only, not a genre without one). */
		showTyping: boolean
	}

	let { typing, showTyping }: Props = $props()

	/** One sentence for everyone typing: *Ann is typing…*, *Ann and Bo are typing…*. */
	const sentence = $derived.by(() => {
		const names = typing.map((t) => t.name)
		if (!names.length) return ""
		if (names.length === 1) return `${names[0]} is typing…`
		const last = names[names.length - 1]
		return `${names.slice(0, -1).join(", ")} and ${last} are typing…`
	})
</script>

<!-- Who else is writing, beside the field they are writing into. It belongs
     to the composer, so it shows where the composer does: a selection
     toolbar, a read-only session and a genre with no field are three states
     in which nobody is typing into anything. -->
{#if showTyping && sentence}
	<span
		class="preset-tonal-surface text-surface-600-400 inline-flex max-w-full min-w-0 items-center rounded-full px-2.5 py-0.5 text-xs"
	>
		<span class="animate-pulse truncate motion-reduce:animate-none">
			{sentence}
		</span>
	</span>
{/if}
