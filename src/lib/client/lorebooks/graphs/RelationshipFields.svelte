<script
	lang="ts"
	generics="T extends import('./linkDraft').RelationshipFieldsValue"
>
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		LINK_SUGGESTIONS,
		RELATIONSHIP_STATUSES,
		RELATIONSHIP_TEXT_LIMITS,
		RELATIONSHIP_VISIBILITIES,
		type LinkPairing
	} from "$lib/shared/lorebooks/linkVocabulary"
	import { pickSuggestion, setBothWays } from "./linkDraft"

	/**
	 * One set of fields for a relationship — the link form after a drag, the
	 * edit form beside the canvas, and (B5) a place's Links rows all mount this,
	 * so a relationship is asked about the same way wherever it is written.
	 *
	 * The relationship type is free text: the chips offer the pairing's
	 * vocabulary and the field takes anything, so a book whose roads are called
	 * "the old way" gets its own word rather than the nearest one on a list.
	 * Picking a chip also sets **Both ways** from what the suggestion says
	 * (`connects to` repeats itself, `is inside` reads back as `holds`).
	 *
	 * Controlled: it never writes to `value`, it hands `onChange` the next one.
	 */
	interface Props {
		value: T
		/** Which two kinds of thing it joins: the chips, and whether Both ways shows. */
		pairing: LinkPairing
		/**
		 * The When picker's options ("No date" + the book's history entries,
		 * spelled through its calendar). One or none hides the picker.
		 */
		whenOptions?: { value: string; label: string }[]
		/** The edit form also asks why it stands where it does. */
		withReason?: boolean
		onChange: (next: T) => void
	}

	let {
		value,
		pairing,
		whenOptions = [],
		withReason = false,
		onChange
	}: Props = $props()

	const uid = $props.id()

	let suggestions = $derived(LINK_SUGGESTIONS[pairing])
	/** A cast tie's other side is its own perspective row, never a reverse. */
	let offersBothWays = $derived(pairing !== "cast-cast")
	let bothWays = $derived(value.reverseRelationshipType !== null)

	const switchClass =
		"preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
</script>

<div class="flex flex-col gap-2" data-relationship-fields>
	<div class="flex flex-wrap gap-1" role="group" aria-label="Suggested types">
		{#each suggestions as suggestion (suggestion.type)}
			<button
				type="button"
				class="chip {value.relationshipType === suggestion.type
					? 'preset-tonal-primary'
					: 'preset-tonal-surface'}"
				aria-pressed={value.relationshipType === suggestion.type}
				onclick={() => onChange(pickSuggestion(value, suggestion, pairing))}
			>
				{suggestion.type}
			</button>
		{/each}
	</div>

	<label class="sr-only" for="{uid}-type">Relationship type</label>
	<input
		id="{uid}-type"
		class="input text-sm"
		type="text"
		placeholder="or type your own…"
		maxlength={RELATIONSHIP_TEXT_LIMITS.wording}
		value={value.relationshipType}
		oninput={(e) =>
			onChange({ ...value, relationshipType: e.currentTarget.value })}
	/>

	{#if offersBothWays}
		<Switch
			name="{uid}-both-ways"
			checked={bothWays}
			onCheckedChange={(e) => onChange(setBothWays(value, e.checked, pairing))}
			class="flex w-full items-center justify-between gap-2 text-sm"
		>
			<Switch.Label>Both ways</Switch.Label>
			<Switch.Control class={switchClass}>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
		</Switch>
		{#if bothWays}
			<label class="flex flex-col gap-1 text-xs" for="{uid}-reverse">
				<span class="text-surface-600-400">From there it…</span>
				<input
					id="{uid}-reverse"
					class="input text-sm"
					type="text"
					placeholder="leads back to"
					maxlength={RELATIONSHIP_TEXT_LIMITS.wording}
					value={value.reverseRelationshipType ?? ""}
					oninput={(e) =>
						onChange({
							...value,
							reverseRelationshipType: e.currentTarget.value
						})}
				/>
			</label>
		{/if}
	{/if}

	<label class="flex flex-col gap-1 text-xs" for="{uid}-name">
		<span class="text-surface-600-400">Name</span>
		<input
			id="{uid}-name"
			class="input text-sm"
			type="text"
			placeholder="the rusted iron door"
			maxlength={RELATIONSHIP_TEXT_LIMITS.name}
			value={value.name}
			oninput={(e) => onChange({ ...value, name: e.currentTarget.value })}
		/>
	</label>

	<label class="sr-only" for="{uid}-description">Description</label>
	<textarea
		id="{uid}-description"
		class="textarea min-h-10 text-xs"
		placeholder="Description…"
		maxlength={RELATIONSHIP_TEXT_LIMITS.description}
		value={value.description}
		oninput={(e) =>
			onChange({ ...value, description: e.currentTarget.value })}
	></textarea>

	<div class="grid grid-cols-2 gap-2">
		<Select
			label="Status"
			labelHidden
			class="min-w-0 text-xs"
			options={RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: s }))}
			value={value.status}
			onValueChange={(v) => {
				if (v) onChange({ ...value, status: v })
			}}
		/>
		<Select
			label="Visibility"
			labelHidden
			class="min-w-0 text-xs"
			options={RELATIONSHIP_VISIBILITIES.map((v) => ({ value: v, label: v }))}
			value={value.visibility}
			onValueChange={(v) => {
				if (v) onChange({ ...value, visibility: v })
			}}
		/>
	</div>

	{#if withReason}
		<label class="sr-only" for="{uid}-reason">Reason for this state</label>
		<input
			id="{uid}-reason"
			class="input text-xs"
			type="text"
			placeholder="Reason for this state…"
			maxlength={RELATIONSHIP_TEXT_LIMITS.reason}
			value={value.reason ?? ""}
			oninput={(e) => onChange({ ...value, reason: e.currentTarget.value })}
		/>
	{/if}

	{#if whenOptions.length > 1}
		<Select
			label="When"
			class="text-xs"
			options={whenOptions}
			value={value.historyEntryId == null ? "" : String(value.historyEntryId)}
			onValueChange={(v) =>
				onChange({ ...value, historyEntryId: v ? Number(v) : null })}
		/>
	{/if}
</div>
