<script lang="ts">
	import type { PoolItem } from "../poolFilter"
	import { anchorCandidates } from "./partOf"

	/**
	 * Where this entry is filed — one parent, and "top level" is the absence of
	 * one.
	 *
	 * ⚠ **The picker refuses what the server would refuse**: never the entry
	 * itself and never anything already inside it, because an anchor that leads
	 * back to its own row is a tree nothing can draw. A parent the pool does not
	 * hold is still named: the reader is being told where the row is, and a
	 * blank picker would read as "top level".
	 */
	interface Props {
		draft: Record<string, any>
		/** Every row in the book, which is where a parent is resolved. */
		pool: readonly PoolItem[]
		idPrefix: string
	}

	let { draft = $bindable(), pool, idPrefix }: Props = $props()

	let subjectKey = $derived(
		typeof draft.id === "number" ? `entry#${draft.id}` : null
	)
	let current = $derived<number | null>(draft.anchorEntryId ?? null)
	let candidates = $derived(anchorCandidates(subjectKey, pool))
	/** The parent, when the pool holds it. */
	let parent = $derived(
		current === null
			? null
			: (pool.find((item) => item.key === `entry#${current}`) ?? null)
	)
	/** A parent the picker's own list is missing, so the name still shows. */
	let stray = $derived(
		current !== null && !candidates.some((item) => item.id === current)
	)
</script>

<div class="flex flex-col gap-1">
	<label class="text-sm font-semibold" for="{idPrefix}PartOf">Part of</label>
	<select
		id="{idPrefix}PartOf"
		class="select preset-filled-surface-200-800 w-full rounded-lg"
		value={current === null ? "" : String(current)}
		onchange={(e) => {
			const v = e.currentTarget.value
			draft.anchorEntryId = v === "" ? null : Number(v)
		}}
	>
		<option value="">top level</option>
		{#if stray && current !== null}
			<option value={String(current)}>
				{parent?.name || `#${current}`}
			</option>
		{/if}
		{#each candidates as candidate (candidate.key)}
			<option value={String(candidate.id)}>{candidate.name}</option>
		{/each}
	</select>
	<p class="text-surface-700-300 text-xs">or drag this row onto another</p>
</div>
