<script lang="ts">
	/**
	 * 🚧 What the saved draft still lacks, on the row it is about (RF fix 2,
	 * items 1 and 8, 2026-10-23): each finding's sentence with its reason
	 * under it, in the warning's tone — never a wall above the form, never
	 * for a row that is still being typed (it is said after a Save). A draft
	 * with these saves; Publish waits for them.
	 */
	import * as Icons from "@lucide/svelte"
	import type { RowFinding } from "./rulesetSectionsForm"

	let { findings, label }: { findings: readonly RowFinding[]; label?: string } = $props()
</script>

{#if findings.length}
	<div class="border-warning-500/40 bg-warning-500/5 flex flex-col gap-1 rounded-md border px-3 py-2 text-sm" role="note" aria-label={label ? `${label}: before publish` : "Before publish"} data-row-findings>
		<p class="text-warning-700-300 flex items-center gap-1.5 text-xs font-medium">
			<Icons.CircleAlert size={14} aria-hidden="true" />
			{findings.length === 1 ? "One thing to fix before publish" : `${findings.length} things to fix before publish`}
		</p>
		<ul class="flex flex-col gap-1">
			{#each findings as f, i (i)}
				<li>
					<span>{f.sentence}</span>
					{#if f.reason}<span class="text-surface-600-400 ml-1 font-mono text-xs">{f.reason}</span>{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}
