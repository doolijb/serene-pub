<!--
	@component
	Who else is typing, and whose lines are being spoken, as one pill (a host
	view, `session-banners`): the Messages widget places it in its **turn
	line**'s right half, beside who is due next (PLAN-core-widgets §3.16).

	The stale-preset notice is the session header's, not this pill's
	(`openSessionCtx.headerNotice`, `presetNotice.ts`): a pipeline
	substitution is not a turn fact.
-->
<script lang="ts">
	import { bannerSentence } from "./speakingLines"

	interface Props {
		/** Other participants' personas typing now. */
		typing: { name: string }[]
		/** The composer is there to type into (not read-only, not a genre without one). */
		showTyping: boolean
		/**
		 * 🚧 Whose lines are being read aloud now, one name each (owner
		 * 2026-10-29): *Mira is speaking…*. Said wherever the pill is, composer
		 * or not — a line is spoken whether or not anyone can type.
		 */
		speaking?: string[]
	}

	let { typing, showTyping, speaking = [] }: Props = $props()

	/** One sentence: *Ann is typing…*, *Mira is speaking…*, or both — *Ann is typing… · Mira is speaking…*. */
	const sentence = $derived(
		bannerSentence(showTyping ? typing.map((t) => t.name) : [], speaking)
	)
</script>

<!-- Who else is writing, beside the field they are writing into: it belongs
     to the composer, so typing shows where the composer does (a selection
     toolbar, a read-only session and a genre with no field are three states
     in which nobody is typing into anything). Who is speaking shows always. -->
{#if sentence}
	<span
		class="preset-tonal-surface text-surface-600-400 inline-flex max-w-full min-w-0 items-center rounded-full px-2.5 py-0.5 text-xs"
	>
		<span class="animate-pulse truncate motion-reduce:animate-none" title={sentence}>
			{sentence}
		</span>
	</span>
{/if}
