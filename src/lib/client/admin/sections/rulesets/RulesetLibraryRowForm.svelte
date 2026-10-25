<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import InlineError from "$lib/client/components/InlineError.svelte"
	/**
	 * 🚧 One row of a ruleset's library, open for editing on Admin › Rulesets'
	 * change form. Ruling 6 (2026-10-21): a library row is edited **exactly
	 * as the same thing is edited as a lorebook entry** — the derived entry
	 * type's fields, through the lorebook's own piece helpers
	 * (`lorebooks/sections/derivedPiece.ts`: which fields are drawn, the
	 * form's draft, what is stored, the write gate's refusal under its field)
	 * and the same controls and layout as `DerivedEntryEditor`'s fields. What
	 * a lorebook entry adds around them (keywords, Part of, supply, priority)
	 * is not a row's; what a row has that an entry does not — its id, version,
	 * language and source — sits above.
	 *
	 * The form holds what is typed; `row.piece` holds it as stored, so the
	 * page's Save writes clean values and a row nobody touched is written back
	 * as it was read.
	 */
	import { untrack } from "svelte"
	import type { FieldDecl } from "@serene-pub/sdk"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { enumOptions } from "$lib/shared/i18n/enumOptions"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import {
		isWordList,
		pieceFields,
		pieceFormDraft,
		pieceProblem,
		pieceStorageValues,
		type PieceList
	} from "$lib/client/lorebooks/sections/derivedPiece"
	import { ROW_ID, type LibraryRow } from "./rulesetLibraryForm"

	interface Props {
		row: LibraryRow
		list: PieceList
		/** The library's own source, shown where a row says none. */
		librarySource: { document: string; licence: string }
		idPrefix: string
	}
	let { row = $bindable(), list, librarySource, idPrefix }: Props = $props()

	let fields = $derived(pieceFields(list))

	/** What the form holds, built again when another row is opened. */
	let form = $state<Record<string, unknown>>({})
	let formFor: string | null = null
	$effect.pre(() => {
		const uid = row.uid
		if (uid === formFor) return
		formFor = uid
		form = untrack(() => pieceFormDraft($state.snapshot(row.piece) as Record<string, unknown>, list))
	})

	/** Writes the form into the row's piece, as stored. */
	function commit() {
		row.piece = { ...row.piece, ...pieceStorageValues($state.snapshot(form), list) }
	}
	function setField(key: string, value: unknown) {
		form[key] = value
		commit()
	}
	function setMember(key: string, member: string, value: unknown) {
		const held = form[key]
		const next = held && typeof held === "object" && !Array.isArray(held) ? { ...(held as Record<string, unknown>) } : {}
		next[member] = value
		form[key] = next
		commit()
	}
	const memberOf = (key: string, member: string): unknown => {
		const held = form[key]
		return held && typeof held === "object" ? (held as Record<string, unknown>)[member] : undefined
	}

	let problem = $derived(pieceProblem(row.piece, list))
	const idIssue = $derived(
		!row.id.trim() ? "Give it an id." : !ROW_ID.test(row.id.trim()) ? "An id is lowercase words joined by “-”, like long-sword." : null
	)

	const labelOf = (decl: FieldDecl, key: string): string => i18nTextIn(decl.label as never) ?? key
	const hintOf = (decl: FieldDecl): string | undefined => i18nTextIn(decl.description as never)
	const fieldId = (key: string, member?: string) => `${idPrefix}-${key}${member ? `-${member}` : ""}`
	const name = $derived(typeof row.piece.name === "string" ? row.piece.name : "")
</script>

{#snippet control(id: string, decl: FieldDecl, label: string, value: unknown, set: (v: unknown) => void, describedBy: string | undefined)}
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
			<input {id} type="checkbox" class="checkbox" checked={!!value} aria-describedby={describedBy} onchange={(e) => set(e.currentTarget.checked)} />
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

<div class="flex flex-col gap-4" data-library-row-form={row.uid}>
	<div class="grid gap-3 @min-[36rem]/content:grid-cols-3">
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-surface-600-400">Id</span>
			<input
				id="{idPrefix}-row-id"
				class="input font-mono text-sm"
				type="text"
				placeholder="long-sword"
				autocomplete="off"
				spellcheck="false"
				aria-invalid={!!idIssue}
				aria-describedby={idIssue ? `${idPrefix}-row-id-issue` : undefined}
				bind:value={row.id}
			/>
			{#if idIssue}<span id="{idPrefix}-row-id-issue" class="text-error-600-400">{idIssue}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-surface-600-400">Version</span>
			<input id="{idPrefix}-row-version" class="input font-mono text-sm" type="text" placeholder="1.0.0" bind:value={row.version} />
		</label>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-surface-600-400">Language</span>
			<input id="{idPrefix}-row-lang" class="input text-sm" type="text" placeholder="en" bind:value={row.lang} />
		</label>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-surface-600-400">Comes from</span>
			<input
				id="{idPrefix}-row-source"
				class="input text-sm"
				type="text"
				placeholder={librarySource.document || "The document it is from"}
				bind:value={row.sourceDocument}
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-surface-600-400">Licence</span>
			<input
				id="{idPrefix}-row-licence"
				class="input text-sm"
				type="text"
				placeholder={librarySource.licence || "CC-BY-4.0"}
				bind:value={row.sourceLicence}
			/>
		</label>
		<p class="text-surface-600-400 self-end text-xs">Left empty, it comes from where the library says.</p>
	</div>

	<div class="flex flex-col gap-1">
		<label class="text-sm font-semibold" for="{idPrefix}-name">Name <span class="text-error-600-400">*</span></label>
		<input
			id="{idPrefix}-name"
			class="input preset-filled-surface-200-800 w-full rounded-lg"
			type="text"
			value={name}
			oninput={(e) => (row.piece = { ...row.piece, name: e.currentTarget.value })}
		/>
	</div>

	<div class="flex flex-col gap-4" data-rules-list-fields={list.typeId}>
		{#each fields as [key, decl] (key)}
			{@const id = fieldId(key)}
			{@const label = labelOf(decl, key)}
			{@const issue = problem?.field === key ? problem.message : null}
			{@const issueId = issue ? `${id}-problem` : undefined}
			{@const hint = hintOf(decl)}
			{@const hintId = hint ? `${id}-hint` : undefined}
			{#if decl.type === "object"}
				<fieldset class="border-surface-200-800 flex flex-col gap-3 rounded-lg border p-3" data-piece-field={key} aria-describedby={issueId ?? hintId}>
					<legend class="px-1 text-sm font-semibold">
						{label}
						{#if decl.required}<span class="text-error-600-400"> * </span>{/if}
					</legend>
					{#if hint}<FieldHelp id={hintId}>{hint}</FieldHelp>{/if}
					{#each Object.entries(decl.fields ?? {}) as [member, mdecl] (member)}
						{@const mid = fieldId(key, member)}
						{@const mlabel = labelOf(mdecl, member)}
						<div class="flex flex-col gap-1">
							{@render fieldLabel(mid, mdecl, mlabel)}
							{@render control(mid, mdecl, mlabel, memberOf(key, member), (v) => setMember(key, member, v), issueId)}
						</div>
					{/each}
					{#if issue}<InlineError id={issueId}>{issue}</InlineError>{/if}
				</fieldset>
			{:else}
				<div class="flex flex-col gap-1" data-piece-field={key}>
					{@render fieldLabel(id, decl, label)}
					{@render control(id, decl, label, form[key], (v) => setField(key, v), issueId ?? hintId)}
					{#if hint}<FieldHelp id={hintId}>{hint}</FieldHelp>{/if}
					{#if issue}<InlineError id={issueId}>{issue}</InlineError>{/if}
				</div>
			{/if}
		{/each}
		{#if problem && problem.field === null}
			<InlineError data-piece-problem>{problem.message}</InlineError>
		{/if}
	</div>
</div>
