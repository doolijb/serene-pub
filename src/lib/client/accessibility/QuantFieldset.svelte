<script lang="ts">
	/**
	 * The quant picker in plain markup (plan 2026-10-29 D2, document-view).
	 *
	 * The same rule as the finder's picker, read from `finder.ts` so the two
	 * never disagree: more than one file is a radio list inside a fieldset
	 * (the recommended one, else the largest that fits, checked first); exactly
	 * one shows its file name before Download; none says why (`note`) and, when
	 * the caller has a fallback, Download pulls that.
	 */
	import {
		quantChoice,
		preselectedQuantIndex,
		quantFit,
		type QuantFile
	} from "$lib/client/components/connections/finder"
	import { formatBytes } from "$lib/client/components/connections/modelManagement"
	import type { MemoryTier } from "$lib/client/components/connections/memoryTier"

	interface Props {
		/** The repo or model the files belong to; the fieldset's legend. */
		repo: string
		quants: QuantFile[]
		tier: MemoryTier
		/** Unique per fieldset on the page (radio group name, ids). */
		id: string
		disabled?: boolean
		/** Why there is no list, when there is none. */
		note?: string | null
		/** Download with no file chosen (Ollama: the yaml tag). */
		onFallback?: (() => void) | null
		onDownload: (quant: QuantFile) => void
	}
	let {
		repo,
		quants,
		tier,
		id,
		disabled = false,
		note = null,
		onFallback = null,
		onDownload
	}: Props = $props()

	const choice = $derived(quantChoice(quants))
	let picked = $state<number | null>(null)
	const checked = $derived(
		picked ?? Math.max(0, preselectedQuantIndex(quants, tier))
	)
	const sizeOf = (q: QuantFile) => (q.bytes ? formatBytes(q.bytes) : "")
</script>

{#if choice === "picker"}
	<fieldset>
		<legend>Files in {repo}</legend>
		{#each quants as q, i (i)}
			{@const fit = quantFit(q, tier)}
			<div class="a11y-field">
				<input
					type="radio"
					id="{id}-{i}"
					name={id}
					value={i}
					checked={checked === i}
					onchange={() => (picked = i)}
				/>
				<label for="{id}-{i}">
					{q.name}{#if sizeOf(q)}, {sizeOf(q)}{/if}{#if q.recommended},
						recommended{/if}{#if fit}. {fit.sentence}{/if}
				</label>
			</div>
		{/each}
		<button
			type="button"
			class="a11y-btn a11y-btn-small"
			{disabled}
			onclick={() => onDownload(quants[checked])}
		>
			Download {quants[checked]?.name}
		</button>
	</fieldset>
{:else if choice === "single"}
	{@const q = quants[0]}
	{@const fit = quantFit(q, tier)}
	<p>
		File: {q.filename ?? q.name}{#if sizeOf(q)}, {sizeOf(q)}{/if}{#if fit}.
			{fit.sentence}{/if}
	</p>
	<button
		type="button"
		class="a11y-btn a11y-btn-small"
		{disabled}
		onclick={() => onDownload(q)}
	>
		Download
	</button>
{:else}
	{#if note}<p class="a11y-hint">{note}</p>{/if}
	{#if onFallback}
		<button
			type="button"
			class="a11y-btn a11y-btn-small"
			{disabled}
			onclick={onFallback}
		>
			Download
		</button>
	{/if}
{/if}
