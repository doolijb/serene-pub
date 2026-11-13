<script lang="ts">
	/**
	 * 🚧 (s22-V, ruling ★§22-3) How each enabled genre rates a set of rules —
	 * "Story: Great · Lair: Good" — with every rating's one-line why on hover
	 * (`line`, fit for a row) or unfolded (`details`, fit for a form). A book
	 * on Freeform says the session chooses. Rules no genre rates draw nothing.
	 */
	import {
		FREEFORM_BOOK_FIT,
		fitWords,
		rulesFitLine,
		rulesFitTitle,
		type RulesetGenreFit
	} from "./rulesFitWords"

	interface Props {
		fits?: readonly RulesetGenreFit[] | null
		/** A book on Freeform: it brings no rules, the session chooses. */
		freeform?: boolean
		mode?: "line" | "details"
		class?: string
	}

	let {
		fits = null,
		freeform = false,
		mode = "line",
		class: className = ""
	}: Props = $props()

	const line = $derived(rulesFitLine(fits))
	const upper = (s: string) => `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`
</script>

{#if freeform}
	<span
		class="text-surface-600-400 block text-xs {className}"
		data-rules-fit="freeform"
	>
		{FREEFORM_BOOK_FIT}
	</span>
{:else if line && mode === "line"}
	<span
		class="text-surface-600-400 block truncate text-xs {className}"
		title={rulesFitTitle(fits)}
		data-rules-fit
	>
		{line}
	</span>
{:else if line}
	<details class={className} data-rules-fit>
		<summary class="text-surface-600-400 cursor-pointer text-xs">
			{line}
		</summary>
		<ul
			class="text-surface-600-400 mt-1 flex flex-col gap-0.5 text-xs"
			data-rules-fit-why
		>
			{#each fits ?? [] as f (f.genreId)}
				<li data-rules-fit-genre={f.genreId}>
					<span class="font-medium">{fitWords(f)}</span>
					({f.reason})
					{#if f.inWords?.length}
						<ul class="ml-4 list-disc">
							{#each f.inWords as w (w.label)}
								<li>
									<span class="font-medium">
										{upper(w.label)}:
									</span>
									{w.why}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	</details>
{/if}
