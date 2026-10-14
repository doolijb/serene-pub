<script lang="ts">
	/**
	 * The one line at the top of the index: **can a session reply**.
	 *
	 * ## Why chat gets a strip and the others get tiles
	 *
	 * Nine of the ten jobs are optional and cost nothing while off; one of them
	 * is the difference between an app that works and an app that does not.
	 * Giving all ten the same shape — a row, a dot, a sentence, a button — and
	 * scoring them *"3 of 10 ready"* tells a beginner their fresh install is
	 * 70% broken, which is both untrue and the first thing they see.
	 *
	 * So chat is one strip, in the words of the thing the person came to do —
	 * *sessions can reply* — and the other nine are tiles below it, with no
	 * fraction: a sentence about the one job that actually blocks play. Once
	 * it can, the strip is one line saying what replies, *Replies: ‹model› ·
	 * ‹connection›*, beside **Change** (less-confusing I3, 2026-10-11).
	 *
	 * ## The dot and the headline are the connection state
	 *
	 * `state` is the one scale (`connectionRowStatus.ts`) and the strip wears
	 * it like a row does: `CONNECTION_STATE_DOT` for the dot, and a headline
	 * per state. The buttons keep their own words — **Change**, **Fix**,
	 * **Fill the Reply loadout**, **Set up chat** — because each names its consequence.
	 *
	 * ⚠ It names the MODEL, not the connection. "Claude Sonnet 4.5 · Anthropic"
	 * in that order, because the model is what answers and the connection is
	 * where it lives. A pair with no model half is *incomplete* and says so
	 * rather than naming the endpoint as though it were an answer (§10
	 * *(endpoint, model) pair*).
	 */
	import {
		CONNECTION_STATE_DOT,
		CONNECTION_STATE_LABEL,
		type ConnectionState
	} from "./connectionRowStatus"

	interface Props {
		/**
		 * Chat's state on the one scale (`chatFacts`). Absent, it is read off
		 * the props below: a problem is `broken`, a model with none `ready`,
		 * nothing `unfinished`.
		 */
		state?: ConnectionState
		/** The registered chat model's name, or null while none is set. */
		modelName?: string | null
		/** The connection it lives on. */
		connectionName?: string | null
		/**
		 * Set but not usable — the model is missing from its host, or its files
		 * are not downloaded. Ready and unset are not the only two answers.
		 */
		problem?: string | null
		/**
		 * Unset, and a connection here already lists chat models: the button
		 * is **Fill the Reply loadout** rather than **Set up chat**, whose flow installs
		 * KoboldCPP. The view sends either press where it belongs (`chatChoice`).
		 */
		choose?: boolean
		/** The line under it then — "OpenRouter lists 503 models · pick one". */
		choiceSentence?: string | null
		onChange: () => void
		onSetUp: () => void
	}
	let {
		state: givenState,
		modelName = null,
		connectionName = null,
		problem = null,
		choose = false,
		choiceSentence = null,
		onChange,
		onSetUp
	}: Props = $props()

	const state = $derived<ConnectionState>(
		givenState ??
			(problem ? "broken" : modelName ? "ready" : "unfinished")
	)
	const ready = $derived(state === "ready")
	/** What replies, model first: "Claude Sonnet 4.5 · Anthropic". */
	const pairWords = $derived(
		[modelName, connectionName].filter(Boolean).join(" · ")
	)

	/** The halo around the dot, in the dot's own role. */
	const RING: Record<ConnectionState, string> = {
		ready: "ring-success-500/20",
		idle: "ring-surface-500/20",
		unfinished: "ring-primary-500/20",
		busy: "ring-warning-500/20",
		broken: "ring-error-500/20"
	}
	/**
	 * The headline per state. `ready` leads the one line that names the pair.
	 * `broken` drops the "yet": the pair was set and it fails, so nothing is
	 * merely still to come.
	 */
	const HEADLINE: Record<ConnectionState, string> = {
		ready: "Replies:",
		idle: "Sessions can't reply yet",
		unfinished: "Sessions can't reply yet",
		busy: "Sessions can't reply yet",
		broken: "Sessions can't reply"
	}
</script>

<section
	class="panel-card flex items-center gap-3"
	aria-label="Whether sessions can reply"
	data-state={state}
>
	<span
		class="size-2.5 shrink-0 rounded-full ring-3 {CONNECTION_STATE_DOT[
			state
		]} {RING[state]}"
		title={CONNECTION_STATE_LABEL[state]}
		aria-hidden="true"
	></span>

	<div class="min-w-0 flex-1">
		{#if ready}
			<!-- Ready is one line in words: what replies, then where it
			     lives. Its title holds the whole line for a long name. -->
			<p
				class="truncate text-sm"
				title={`${HEADLINE.ready} ${pairWords}`}
			>
				<span class="font-semibold">{HEADLINE.ready}</span>
				{modelName ?? (pairWords || "the Reply loadout")}
				{#if modelName && connectionName}
					<span class="text-surface-600-400">· {connectionName}</span>
				{/if}
			</p>
		{:else}
			<p class="text-sm font-semibold">
				{HEADLINE[state]}
			</p>
			<p class="text-surface-600-400 mt-0.5 truncate text-xs">
				{#if problem}
					{problem}
				{:else if modelName}
					{pairWords}
				{:else if choiceSentence}
					{choiceSentence}
				{:else}
					Fill the Reply loadout to start
				{/if}
			</p>
		{/if}
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
		<!-- The one gold button on the index. Chat is the only job that
		     blocks play, so it is the only one that gets filled primary. -->
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 shrink-0 text-xs"
			onclick={onSetUp}
		>
			{modelName ? "Fix" : choose ? "Fill the Reply loadout" : "Set up chat"}
		</button>
	{/if}
</section>
