<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
	import * as Icons from "@lucide/svelte"
	import NewPlaceField from "../places/NewPlaceField.svelte"
	import { pairingOf, type GraphNode } from "./graphModel"
	import {
		flipLink,
		linkDraftProblem,
		linkFormTitle,
		NEW_PLACE_OPTION,
		otherEndOptions,
		retargetLink,
		type LinkDraft
	} from "./linkDraft"
	import RelationshipFields from "./RelationshipFields.svelte"

	/**
	 * Naming what joins two nodes, straight after the drag that joined them —
	 * or after **Link to…** picked the far end.
	 *
	 * Which two things, and which way round, are this form's; what joins them
	 * is `RelationshipFields`, the one set of fields every relationship form
	 * mounts. The far end is a searchable picker over every place on the line
	 * and everything on the canvas (plan places-graph B4), plus **New place…**,
	 * which makes the place on the spot and points the link at it.
	 */
	interface Props {
		draft: LinkDraft
		/**
		 * What the far end may be: the canvas's nodes and every place on the
		 * line being read. The draft's own `from` is left out here.
		 */
		candidates: GraphNode[]
		saving: boolean
		/**
		 * The When picker's options ("No date" + the book's history entries,
		 * spelled through its calendar). Empty hides the picker.
		 */
		whenOptions?: { value: string; label: string }[]
		/** What went wrong with the last Name it, said here; null when nothing. */
		error?: string | null
		/**
		 * Make a place and hand back its node; absent offers no New place….
		 * Rejects with why not, which the field says.
		 */
		onNewPlace?: (name: string) => Promise<GraphNode>
		/** Open on New place… (the node panel's picker asked for it). */
		startWithNewPlace?: boolean
		/** What New place… opens holding, when a name was being typed. */
		newPlaceName?: string
		onChange: (draft: LinkDraft) => void
		onSubmit: () => void
		onCancel: () => void
	}

	let {
		draft,
		candidates,
		saving,
		whenOptions = [],
		error = null,
		onNewPlace,
		startWithNewPlace = false,
		newPlaceName = "",
		onChange,
		onSubmit,
		onCancel
	}: Props = $props()

	// Seeded once, from how the form was opened; the picker moves it after.
	let creatingPlace = $state(false)
	let pendingName = $state("")
	$effect.pre(() => {
		creatingPlace = startWithNewPlace
		pendingName = newPlaceName
	})

	let others = $derived(candidates.filter((n) => n.key !== draft.from.key))
	/** A draft opened for New place… points at itself until the place exists. */
	let pointsAtItself = $derived(draft.to.key === draft.from.key)
	let problem = $derived(linkDraftProblem(draft))

	let options = $derived(
		otherEndOptions(candidates, draft.from.key, !!onNewPlace)
	)

	async function makePlace(name: string) {
		if (!onNewPlace) return
		const node = await onNewPlace(name)
		creatingPlace = false
		// The draft as it stands now: the fields may have moved meanwhile.
		onChange(retargetLink(draft, node))
	}
</script>

<div
	class="bg-surface-200-800 panel-edge flex flex-col gap-2 rounded-lg border p-3 text-sm"
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
			disabled={pointsAtItself}
			onclick={() => onChange(flipLink(draft))}
		>
			<Icons.ArrowLeftRight size={13} aria-hidden="true" />
		</button>
	</div>

	{#if creatingPlace && onNewPlace}
		<NewPlaceField
			initialName={pendingName}
			onCreate={makePlace}
			onCancel={() => (creatingPlace = false)}
		/>
	{:else}
		<Select
			label="The other end"
			labelHidden
			class="text-sm"
			placeholder="Pick the other end…"
			emptyMessage="No place or node by that name."
			{options}
			value={pointsAtItself ? "" : draft.to.key}
			onValueChange={(v, typed) => {
				if (v === NEW_PLACE_OPTION) {
					pendingName = typed
					creatingPlace = true
					return
				}
				const next = others.find((n) => n.key === v)
				if (next) onChange(retargetLink(draft, next))
			}}
		/>
	{/if}

	<RelationshipFields
		value={draft}
		pairing={pairingOf(draft.from, draft.to)}
		{whenOptions}
		{onChange}
	/>

	{#if error}
		<p class="text-error-500 text-xs" role="alert" data-link-form-error>
			{error}
		</p>
	{/if}

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
			disabled={saving || problem !== null}
			title={problem ?? undefined}
			onclick={onSubmit}
		>
			<Icons.GitBranch size={13} aria-hidden="true" /> Name it
		</button>
	</div>
</div>
