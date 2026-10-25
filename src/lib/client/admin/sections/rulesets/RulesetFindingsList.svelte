<script lang="ts">
	/**
	 * 🚧 What the server found in a ruleset's draft, as a list: each finding
	 * is `[reason] sentence` (the SDK's `finding()`), drawn as the sentence
	 * with its reason beside it in mono — the reason is what a search of the
	 * guide or the SDK finds. Status is a dot plus words (STYLE-GUIDE §6.11):
	 * none is green, any is the error role.
	 */
	import * as Icons from "@lucide/svelte"
	import { splitFinding } from "./rulesetDocument"

	interface Props {
		findings: readonly string[]
		/** The words when there is nothing to fix. */
		emptyText?: string
		/** Shown under each finding (what an upgrade finding means). */
		meaning?: (reason: string | null) => string
		/** `error` for problems, `warning` for what a publish changes. */
		tone?: "error" | "warning"
		id?: string
	}
	let { findings, emptyText = "No problems found.", meaning, tone = "error", id }: Props = $props()
</script>

{#if !findings.length}
	<p class="flex items-center gap-2 text-sm" {id}>
		<span class="bg-success-500 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
		{emptyText}
	</p>
{:else}
	<ul class="flex flex-col gap-2" {id}>
		{#each findings as f, i (i)}
			{@const part = splitFinding(f)}
			<li class="flex items-start gap-2 text-sm" data-finding={part.reason ?? ""}>
				{#if tone === "error"}
					<Icons.CircleAlert size={16} class="text-error-600-400 mt-0.5 shrink-0" aria-hidden="true" />
				{:else}
					<Icons.TriangleAlert size={16} class="text-warning-700-300 mt-0.5 shrink-0" aria-hidden="true" />
				{/if}
				<div class="min-w-0 flex-1">
					<p class="break-words">
						<span class="sr-only">{tone === "error" ? "Problem:" : "Changes:"}</span>
						{part.sentence}
					</p>
					{#if part.reason}
						<p class="text-surface-600-400 font-mono text-meta">{part.reason}</p>
					{/if}
					{#if meaning}
						<p class="text-surface-600-400 text-xs">{meaning(part.reason)}</p>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}
