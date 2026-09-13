<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { GraphNode } from "./graphModel"
	import {
		flipLink,
		linkFormTitle,
		suggestionsFor,
		type LinkDraft
	} from "./linkDraft"

	/**
	 * Naming what joins two nodes, straight after the drag that joined them.
	 *
	 * The picker offers the vocabulary for the pairing and the field takes
	 * anything: `relationship_type` is free text, so a book whose roads are
	 * called "the old way" gets its own word rather than the nearest one on a
	 * list.
	 */
	interface Props {
		draft: LinkDraft
		/** Every node on the canvas, so the far end can be corrected here. */
		nodes: GraphNode[]
		saving: boolean
		onChange: (draft: LinkDraft) => void
		onSubmit: () => void
		onCancel: () => void
	}

	let { draft, nodes, saving, onChange, onSubmit, onCancel }: Props = $props()

	let others = $derived(nodes.filter((n) => n.key !== draft.from.key))
	let suggestions = $derived(suggestionsFor(draft.from, draft.to))
	let note = $derived(
		suggestions.find((s) => s.type === draft.relationshipType)?.note ?? null
	)
</script>

<div
	class="bg-surface-200-800 border-border flex flex-col gap-2 rounded-lg border p-3 text-sm"
	data-graph-link-form
>
	<div class="flex items-center gap-2">
		<p class="min-w-0 flex-1 truncate font-semibold">
			{linkFormTitle(draft)}
		</p>
		<button
			class="btn btn-sm preset-tonal-surface shrink-0 p-1.5"
			type="button"
			title="Turn the direction round"
			aria-label="Turn the direction round"
			onclick={() => onChange(flipLink(draft))}
		>
			<Icons.ArrowLeftRight size={13} aria-hidden="true" />
		</button>
	</div>

	<label class="sr-only" for="linkTarget">The other end</label>
	<select
		id="linkTarget"
		class="select text-sm"
		value={draft.to.key}
		onchange={(e) => {
			const next = others.find((n) => n.key === e.currentTarget.value)
			if (next) onChange({ ...draft, to: next })
		}}
	>
		{#each others as other (other.key)}
			<option value={other.key}>{other.name}</option>
		{/each}
	</select>

	<div class="flex flex-wrap gap-1">
		{#each suggestions as suggestion (suggestion.type)}
			<button
				type="button"
				class="chip {draft.relationshipType === suggestion.type
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				aria-pressed={draft.relationshipType === suggestion.type}
				title={suggestion.note}
				onclick={() =>
					onChange({ ...draft, relationshipType: suggestion.type })}
			>
				{suggestion.type}
			</button>
		{/each}
	</div>

	<label class="sr-only" for="linkType">Relationship type</label>
	<input
		id="linkType"
		class="input text-sm"
		type="text"
		placeholder="or type your own…"
		value={draft.relationshipType}
		oninput={(e) =>
			onChange({
				...draft,
				relationshipType: e.currentTarget.value
			})}
	/>
	{#if note}
		<p class="text-warning-600-400 text-xs">{note}</p>
	{/if}

	<label class="sr-only" for="linkDescription">Description</label>
	<textarea
		id="linkDescription"
		class="textarea min-h-10 text-xs"
		placeholder="What passed between them…"
		value={draft.description}
		oninput={(e) =>
			onChange({ ...draft, description: e.currentTarget.value })}
	></textarea>

	<div class="flex justify-end gap-2">
		<button
			class="btn btn-sm preset-filled-surface-400-600"
			type="button"
			onclick={onCancel}
		>
			Cancel
		</button>
		<button
			class="btn btn-sm preset-filled-primary-500"
			type="button"
			disabled={saving || !draft.relationshipType.trim()}
			onclick={onSubmit}
		>
			<Icons.GitBranch size={13} aria-hidden="true" /> Name it
		</button>
	</div>
</div>
