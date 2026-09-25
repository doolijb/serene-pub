<script lang="ts">
	/**
	 * The one line at the top of the index: **can a session reply**.
	 *
	 * ## Why chat gets a strip and the others get tiles
	 *
	 * The readiness card gave all ten transforms the same shape — a row, a dot,
	 * a sentence, a button — and captioned the set *"3 of 10 ready"*. Both
	 * choices misread the situation. Nine of the ten are optional and cost
	 * nothing while off; one of them is the difference between an app that works
	 * and an app that does not. Ranking them as peers and then scoring them out
	 * of ten tells a beginner their fresh install is 70% broken, which is both
	 * untrue and the first thing they see.
	 *
	 * So chat is one strip, in the words of the thing the person came to do —
	 * *sessions can reply* — and the other nine are tiles below it. The fraction
	 * is gone. What replaces it is a sentence about the one capability that
	 * actually blocks play.
	 *
	 * ⚠ It names the MODEL, not the connection. "Claude Sonnet 4.5 · Anthropic"
	 * in that order, because the model is what answers and the connection is
	 * where it lives. A pair with no model half is *incomplete* and says so
	 * rather than naming the endpoint as though it were an answer (§10
	 * *(endpoint, model) pair*).
	 */
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** The registered chat model's name, or null while none is set. */
		modelName?: string | null
		/** The connection it lives on. */
		connectionName?: string | null
		/**
		 * Set but not usable — the model is missing from its host, or its files
		 * are not downloaded. Ready and unset are not the only two answers.
		 */
		problem?: string | null
		onChange: () => void
		onSetUp: () => void
	}
	let {
		modelName = null,
		connectionName = null,
		problem = null,
		onChange,
		onSetUp
	}: Props = $props()

	const ready = $derived(!!modelName && !problem)
</script>

<section
	class="panel-card flex items-center gap-3"
	aria-label="Whether sessions can reply"
>
	{#if ready}
		<span
			class="bg-success-500 ring-success-500/20 size-2.5 shrink-0 rounded-full ring-3"
			aria-hidden="true"
		></span>
	{:else}
		<Icons.CircleAlert
			size={18}
			class="text-primary-500 shrink-0"
			aria-hidden="true"
		/>
	{/if}

	<div class="min-w-0 flex-1">
		<p class="text-sm font-semibold">
			{ready ? "Sessions can reply" : "Sessions can't reply yet"}
		</p>
		<p class="text-surface-600-400 mt-0.5 truncate text-xs">
			{#if problem}
				{problem}
			{:else if modelName}
				{modelName}{connectionName ? ` · ${connectionName}` : ""}
			{:else}
				Pick a chat model to start
			{/if}
		</p>
	</div>

	{#if ready}
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
			onclick={onChange}
		>
			Change
		</button>
	{:else}
		<!-- The one gold button on the index. Chat is the only capability that
		     blocks play, so it is the only one that gets filled primary. -->
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 shrink-0 text-xs"
			onclick={onSetUp}
		>
			{modelName ? "Fix" : "Set up chat"}
		</button>
	{/if}
</section>
