<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"
	import {
		commaStaysInKey,
		keyList,
		keysFromTyping,
		withKeys,
		withoutKey
	} from "$lib/shared/entries/keyList"
	import { runawayPatternOf } from "$lib/shared/entries/runawayPattern"

	/**
	 * A key list, as the things it holds: one chip per key.
	 *
	 * ⚠ **A list in, a list out** (finding #146). The column is `text[]` and the
	 * wire carries the list, so one chip is one element and nothing here joins
	 * the keys into a string or splits one back — a regex key such as
	 * `\w{2,4}` or a literal "Smith, John" is a single chip. A legacy comma
	 * string (an amendment stored before keys were a list) is read as a list
	 * once, on the way in.
	 *
	 * A comma ends a key in a literal entry and is part of the key in a regex
	 * one (`commaStaysInKey`); Enter always ends it.
	 */
	interface Props {
		/** One element per key. */
		keys: string[]
		idPrefix: string
		/** Whether the entry matches its keys as regular expressions. */
		regex?: boolean
		/**
		 * Whether the instance matches on meaning as well as on these words.
		 * The hint is a claim about the mechanism, so it is only made where the
		 * mechanism is actually running.
		 */
		semantic?: boolean
		/** The field's visible name. */
		label?: string
		/** Distinguishes two lists in one editor (keywords, condition keywords). */
		idSuffix?: string
		placeholder?: string
	}

	let {
		keys = $bindable(),
		idPrefix,
		regex = false,
		semantic = false,
		label = "Keywords",
		idSuffix = "Keys",
		placeholder = "umber"
	}: Props = $props()

	// Deduplicated, because the chips are keyed on the word: a column holding
	// the same keyword twice is one chip, not a crash.
	let list = $derived(keyList(keys))
	/**
	 * The patterns Save would refuse (plan S3), said here first — the same
	 * judgement the server makes (`runawayPatternOf`), so the chip and the
	 * refusal cannot disagree. Only for a regex entry: in the other modes the
	 * key is text and cannot run away.
	 */
	let runaway = $derived(
		regex
			? list.flatMap((key) => {
					const found = runawayPatternOf(key)
					return found ? [{ key, why: found.why }] : []
				})
			: []
	)
	let adding = $state(false)
	let typed = $state("")
	let input = $state<HTMLInputElement | null>(null)

	function commit() {
		const added = keysFromTyping(typed, regex)
		typed = ""
		adding = false
		const next = withKeys(list, added)
		if (next.length !== list.length) keys = next
	}

	function remove(keyword: string) {
		keys = withoutKey(list, keyword)
	}

	function onKeydown(event: KeyboardEvent) {
		const endsKey =
			event.key === "Enter" ||
			(event.key === "," && !commaStaysInKey(typed, regex))
		if (endsKey) {
			event.preventDefault()
			commit()
			// One after another is how a list gets typed, so the box stays
			// open for the next word.
			adding = true
			void tick().then(() => input?.focus())
			return
		}
		if (event.key === "Escape") {
			typed = ""
			adding = false
		}
	}
</script>

<div class="flex flex-col gap-1">
	<span class="text-sm font-semibold" id="{idPrefix}{idSuffix}Label">{label}</span>
	<div
		class="flex flex-wrap items-center gap-1"
		role="group"
		aria-labelledby="{idPrefix}{idSuffix}Label"
	>
		{#each list as keyword (keyword)}
			<span class="chip preset-tonal-surface gap-1">
				<span
					class="{regex ? 'font-mono' : ''} {runaway.some((r) => r.key === keyword)
						? 'decoration-error-500 underline decoration-wavy'
						: ''}">{keyword}</span
				>
				<button
					type="button"
					class="opacity-70 hover:opacity-100"
					aria-label="Remove {keyword}"
					onclick={() => remove(keyword)}
				>
					<Icons.X size={12} aria-hidden="true" />
				</button>
			</span>
		{/each}
		{#if adding}
			<input
				bind:this={input}
				bind:value={typed}
				id="{idPrefix}{idSuffix}"
				class="input preset-filled-surface-200-800 w-40 rounded-lg"
				type="text"
				aria-label="New keyword"
				{placeholder}
				onkeydown={onKeydown}
				onblur={commit}
			/>
		{:else}
			<button
				type="button"
				class="chip preset-tonal-surface"
				onclick={() => {
					adding = true
					void tick().then(() => input?.focus())
				}}
			>
				Add…
			</button>
		{/if}
	</div>
	{#if runaway.length}
		<ul class="flex flex-col gap-0.5 text-xs">
			{#each runaway as r (r.key)}
				<li class="text-error-600-400 flex items-baseline gap-x-2">
					<Icons.CircleX size={12} class="shrink-0 self-center" aria-hidden="true" />
					<span
						><span class="font-medium">Error</span>
						<span class="font-mono">{r.key}</span> can't be saved: {r.why}.</span
					>
				</li>
			{/each}
		</ul>
	{/if}
	{#if regex}
		<p class="text-surface-700-300 text-xs">
			Each pattern is one keyword: press Enter to add it, and commas stay
			inside it.
		</p>
	{/if}
	{#if semantic}
		<p class="text-surface-700-300 text-xs">
			Also matched semantically, no need to list every phrasing.
		</p>
	{/if}
</div>
