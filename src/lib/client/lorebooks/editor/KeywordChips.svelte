<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"

	/**
	 * The entry's keywords, as the things they are: one chip each.
	 *
	 * Stored comma-delimited, which is what the column holds and what the
	 * server re-joins on the way back, so this splits on the way in and joins
	 * on the way out rather than inventing a second shape for the same field.
	 */
	interface Props {
		/** Comma-delimited, as authored. */
		keys: string
		idPrefix: string
		/**
		 * Whether the instance matches on meaning as well as on these words.
		 * The hint is a claim about the mechanism, so it is only made where the
		 * mechanism is actually running.
		 */
		semantic: boolean
	}

	let { keys = $bindable(), idPrefix, semantic }: Props = $props()

	// Deduplicated, because the chips are keyed on the word: a column holding
	// the same keyword twice is one chip, not a crash.
	let list = $derived(
		(keys ?? "")
			.split(",")
			.map((k) => k.trim())
			.filter((k, i, all) => !!k && all.indexOf(k) === i)
	)
	let adding = $state(false)
	let typed = $state("")
	let input = $state<HTMLInputElement | null>(null)

	function commit() {
		const value = typed.trim().replace(/,+$/, "")
		typed = ""
		adding = false
		if (!value || list.includes(value)) return
		keys = [...list, value].join(", ")
	}

	function remove(keyword: string) {
		keys = list.filter((k) => k !== keyword).join(", ")
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Enter" || event.key === ",") {
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
	<span class="text-sm font-semibold" id="{idPrefix}KeysLabel">Keywords</span>
	<div
		class="flex flex-wrap items-center gap-1"
		role="group"
		aria-labelledby="{idPrefix}KeysLabel"
	>
		{#each list as keyword (keyword)}
			<span class="chip preset-tonal-surface gap-1">
				<span>{keyword}</span>
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
				id="{idPrefix}Keys"
				class="input preset-filled-surface-200-800 w-40 rounded-lg"
				type="text"
				aria-label="New keyword"
				placeholder="umber"
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
	{#if semantic}
		<p class="text-surface-700-300 text-xs">
			Also matched semantically, no need to list every phrasing.
		</p>
	{/if}
</div>
