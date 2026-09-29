<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
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
		/**
		 * The line a NEW row will land on, so its picker never offers
		 * another line's own entry. Unused for a saved row, whose own line
		 * decides.
		 */
		newRowBranchId?: number | null
		/** Accepted for parity with the other entry fields; the picker names
		 *  itself through its own label, so no id is derived from it. */
		idPrefix?: string
	}

	let { draft = $bindable(), pool, newRowBranchId }: Props = $props()

	let subjectKey = $derived(
		typeof draft.id === "number" ? `entry#${draft.id}` : null
	)
	let current = $derived<number | null>(draft.anchorEntryId ?? null)
	let candidates = $derived(
		anchorCandidates(subjectKey, pool, newRowBranchId)
	)
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
	<Select
		label="Part of"
		class="w-full text-sm [&_input]:text-base"
		options={[
			{ value: "", label: "top level" },
			...(stray && current !== null
				? [{ value: String(current), label: parent?.name || `#${current}` }]
				: []),
			...candidates.map((candidate) => ({
				value: String(candidate.id),
				label: candidate.name
			}))
		]}
		value={current === null ? "" : String(current)}
		onValueChange={(v) => (draft.anchorEntryId = v === "" ? null : Number(v))}
	/>
	<p class="text-surface-700-300 text-xs">or drag this row onto another</p>
</div>
