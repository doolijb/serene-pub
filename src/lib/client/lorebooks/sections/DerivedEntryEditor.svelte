<script lang="ts">
	import { untrack } from "svelte"
	import { SegmentedControl } from "@skeletonlabs/skeleton-svelte"
	import type { FieldDecl } from "@serene-pub/sdk"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { enumOptions } from "$lib/shared/i18n/enumOptions"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import type { EntryEditorProps } from "./types"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import EntryCoreFields from "./EntryCoreFields.svelte"
	import {
		isWordList,
		pieceFields,
		pieceFormDraft,
		pieceProblem,
		pieceStorageValues,
		rulesListOf
	} from "./derivedPiece"
	import {
		ITEM_SUPPLY_HINTS,
		ITEM_SUPPLY_LABELS,
		ITEM_SUPPLY_MODES,
		setSupplyMode,
		supplyModeOf,
		supplyProblem,
		type ItemSupplyMode
	} from "./itemSupply"

	/**
	 * 🚧 An entry of one of the book's rules lists — a Vis Itineris weapon, a
	 * Freeform condition (PLAN-lorebook-kinds §C, lane C1).
	 *
	 * Level one is what every entry asks for (name, content, keywords, Part
	 * of); then the list's own fields, drawn from its piece shape (damage,
	 * range, level…), each with the write gate's refusal under it when it has
	 * one (`checkPiece`, through `derivedPiece.ts`); then how many of it the
	 * world has — the supply every entry carries — and level two.
	 *
	 * The form holds what is typed; the draft holds it as the entry stores it,
	 * so a save writes clean values and a half-typed line of words is still
	 * the line on screen.
	 */
	let {
		draft = $bindable(),
		bindings = $bindable(),
		vectorizationEnabled
	}: EntryEditorProps = $props()

	let list = $derived(rulesListOf(draft.typeId ?? ""))
	let fields = $derived(list ? pieceFields(list) : [])

	/** What the form holds, built again whenever the editor is handed another draft. */
	let form = $state<Record<string, unknown>>({})
	let formFor: object | null = null
	$effect.pre(() => {
		const current = draft
		const of = list
		if (current === formFor || !of) return
		formFor = current
		form = untrack(() =>
			pieceFormDraft(
				$state.snapshot(current) as Record<string, unknown>,
				of
			)
		)
	})

	/** Writes the form into the draft, as stored. */
	function commit() {
		if (!list) return
		Object.assign(draft, pieceStorageValues($state.snapshot(form), list))
	}

	function setField(key: string, value: unknown) {
		form[key] = value
		commit()
	}

	function setMember(key: string, member: string, value: unknown) {
		const held = form[key]
		const next =
			held && typeof held === "object" && !Array.isArray(held)
				? { ...(held as Record<string, unknown>) }
				: {}
		next[member] = value
		form[key] = next
		commit()
	}

	const memberOf = (key: string, member: string): unknown => {
		const held = form[key]
		return held && typeof held === "object"
			? (held as Record<string, unknown>)[member]
			: undefined
	}

	let problem = $derived(list ? pieceProblem(draft, list) : null)

	const labelOf = (decl: FieldDecl, key: string): string =>
		i18nTextIn(decl.label as never) ?? key
	const hintOf = (decl: FieldDecl): string | undefined =>
		i18nTextIn(decl.description as never)
	const fieldId = (key: string, member?: string) =>
		`der-${key}${member ? `-${member}` : ""}`

	let mode = $derived(supplyModeOf(draft))
	let supplyIssue = $derived(supplyProblem(draft))

	function onModeChange(details: { value: string | null }) {
		if (
			details.value &&
			(ITEM_SUPPLY_MODES as readonly string[]).includes(details.value)
		)
			setSupplyMode(draft, details.value as ItemSupplyMode)
	}
</script>

{#snippet control(
	id: string,
	decl: FieldDecl,
	label: string,
	value: unknown,
	set: (v: unknown) => void,
	describedBy: string | undefined
)}
	{#if decl.type === "enum"}
		<Select
			{label}
			labelHidden
			class="w-full"
			options={enumOptions(decl as never)}
			value={value == null ? "" : String(value)}
			clearable={!decl.required}
			{describedBy}
			onValueChange={(v) => set(v)}
		/>
	{:else if decl.type === "boolean"}
		<label class="flex items-center gap-2 text-sm">
			<input
				{id}
				type="checkbox"
				class="checkbox"
				checked={!!value}
				aria-describedby={describedBy}
				onchange={(e) => set(e.currentTarget.checked)}
			/>
			<span>{label}</span>
		</label>
	{:else if decl.type === "text"}
		<textarea
			{id}
			class="textarea preset-filled-surface-200-800 w-full rounded-lg"
			rows="3"
			value={value == null ? "" : String(value)}
			aria-describedby={describedBy}
			oninput={(e) => set(e.currentTarget.value)}
		></textarea>
	{:else if decl.type === "integer" || decl.type === "number"}
		<input
			{id}
			type="number"
			class="input preset-filled-surface-200-800 w-32 rounded-lg"
			min={decl.min}
			max={decl.max}
			step={decl.type === "integer" ? 1 : "any"}
			value={value == null ? "" : String(value)}
			aria-describedby={describedBy}
			oninput={(e) => set(e.currentTarget.value)}
		/>
	{:else}
		<input
			{id}
			type="text"
			class="input preset-filled-surface-200-800 w-full rounded-lg"
			value={value == null ? "" : String(value)}
			placeholder={isWordList(decl) ? "Separate with commas" : ""}
			aria-describedby={describedBy}
			oninput={(e) => set(e.currentTarget.value)}
		/>
	{/if}
{/snippet}

{#snippet fieldLabel(id: string, decl: FieldDecl, label: string)}
	{#if decl.type === "enum"}
		<span class="text-sm font-semibold" aria-hidden="true">
			{label}
			{#if decl.required}<span class="text-error-600-400">*</span>{/if}
		</span>
	{:else if decl.type !== "boolean"}
		<label class="text-sm font-semibold" for={id}>
			{label}
			{#if decl.required}<span class="text-error-600-400">*</span>{/if}
		</label>
	{/if}
{/snippet}

<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="der"
	{vectorizationEnabled}
/>

{#if list}
	<div class="flex flex-col gap-4" data-rules-list-fields={list.typeId}>
		{#each fields as [key, decl] (key)}
			{@const id = fieldId(key)}
			{@const label = labelOf(decl, key)}
			{@const issue = problem?.field === key ? problem.message : null}
			{@const issueId = issue ? `${id}-problem` : undefined}
			{@const hint = hintOf(decl)}
			{@const hintId = hint ? `${id}-hint` : undefined}
			{#if decl.type === "object"}
				<fieldset
					class="border-surface-200-800 flex flex-col gap-3 rounded-lg border p-3"
					data-piece-field={key}
					aria-describedby={issueId ?? hintId}
				>
					<legend class="px-1 text-sm font-semibold">
						{label}
						{#if decl.required}<span class="text-error-600-400">
								*
							</span>{/if}
					</legend>
					{#if hint}
						<p class="text-surface-600-400 text-xs" id={hintId}>
							{hint}
						</p>
					{/if}
					{#each Object.entries(decl.fields ?? {}) as [member, mdecl] (member)}
						{@const mid = fieldId(key, member)}
						{@const mlabel = labelOf(mdecl, member)}
						<div class="flex flex-col gap-1">
							{@render fieldLabel(mid, mdecl, mlabel)}
							{@render control(
								mid,
								mdecl,
								mlabel,
								memberOf(key, member),
								(v) => setMember(key, member, v),
								issueId
							)}
						</div>
					{/each}
					{#if issue}
						<p
							class="text-error-600-400 text-xs"
							id={issueId}
							role="alert"
						>
							{issue}
						</p>
					{/if}
				</fieldset>
			{:else}
				<div class="flex flex-col gap-1" data-piece-field={key}>
					{@render fieldLabel(id, decl, label)}
					{@render control(
						id,
						decl,
						label,
						form[key],
						(v) => setField(key, v),
						issueId ?? hintId
					)}
					{#if hint}
						<p class="text-surface-600-400 text-xs" id={hintId}>
							{hint}
						</p>
					{/if}
					{#if issue}
						<p
							class="text-error-600-400 text-xs"
							id={issueId}
							role="alert"
						>
							{issue}
						</p>
					{/if}
				</div>
			{/if}
		{/each}
		{#if problem && problem.field === null}
			<p
				class="text-error-600-400 text-xs"
				role="alert"
				data-piece-problem
			>
				{problem.message}
			</p>
		{/if}
	</div>
{:else}
	<p class="text-surface-600-400 text-xs">
		This entry's own fields appear once the book's rules have loaded.
	</p>
{/if}

<div class="flex flex-col gap-2" data-item-supply={mode}>
	<SegmentedControl
		value={mode}
		onValueChange={onModeChange}
		class="items-start"
	>
		<SegmentedControl.Label class="text-sm font-semibold">
			Supply
		</SegmentedControl.Label>
		<SegmentedControl.Control>
			<SegmentedControl.Indicator />
			{#each ITEM_SUPPLY_MODES as option (option)}
				<SegmentedControl.Item value={option}>
					<SegmentedControl.ItemText>
						{ITEM_SUPPLY_LABELS[option]}
					</SegmentedControl.ItemText>
					<SegmentedControl.ItemHiddenInput />
				</SegmentedControl.Item>
			{/each}
		</SegmentedControl.Control>
	</SegmentedControl>
	<p class="text-surface-600-400 text-xs" id="derSupplyHint">
		{ITEM_SUPPLY_HINTS[mode]}
	</p>
	{#if mode === "limited"}
		<div class="flex flex-col gap-1">
			<label class="text-sm font-semibold" for="derSupplyLimit">
				How many exist <span class="text-error-600-400">*</span>
			</label>
			<input
				id="derSupplyLimit"
				class="input preset-filled-surface-200-800 w-32 rounded-lg"
				type="number"
				min="1"
				step="1"
				required
				aria-describedby={supplyIssue
					? "derSupplyProblem"
					: "derSupplyHint"}
				aria-invalid={supplyIssue ? "true" : undefined}
				bind:value={draft.supplyLimit}
			/>
			{#if supplyIssue}
				<p
					class="text-error-600-400 text-xs"
					id="derSupplyProblem"
					role="alert"
				>
					{supplyIssue}
				</p>
			{/if}
		</div>
	{/if}
</div>

<EntryAdvancedFields bind:draft idPrefix="der" {vectorizationEnabled} />
