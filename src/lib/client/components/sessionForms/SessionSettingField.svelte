<script lang="ts">
	/**
	 * 🚧 One setting of the session's derived form (PLAN-layering A10, R1;
	 * lane 7, 2026-10-21): the control its `control` names, written at once
	 * through `sessions:updateSetting` (the form above settles the reply), the
	 * refusal said under it, and — when the session set its own value —
	 * **Reset** back to what it inherits.
	 *
	 * Read-only (`editable: false`: locked by a layer above, fixed at start,
	 * an administrator's) is the value's name and the server's reason, never a
	 * disabled control (§6.17). A value whose control this form cannot draw —
	 * a genre's object field such as the Author's note — is drawn by the one
	 * schema renderer from the genre's own declaration when the caller hands
	 * it in (`decl`), committed whole.
	 */
	import Select from "$lib/client/components/inputs/Select.svelte"
	import SchemaForm from "$lib/client/components/pipelines/SchemaForm.svelte"
	import { fieldDomId, sourceWords, valueText } from "./sessionSettingsForm"

	type Field = Sockets.Sessions.SettingsForm.Field

	interface Props {
		field: Field
		viewer: "owner" | "admin"
		busy?: boolean
		refusal?: string | null
		/** The genre's own declaration of this field, for a control the form cannot draw. */
		decl?: Record<string, unknown> | null
		/** What the value reads as when the caller can say it better (a ruleset's name). */
		valueLabel?: string | null
		/** The choices to offer instead of the field's own (How strict narrowed to what the rules play). */
		members?: Field["members"]
		onwrite: (value: unknown | null) => void
	}

	let { field, viewer, busy = false, refusal = null, decl = null, valueLabel = null, members, onwrite }: Props = $props()

	const id = $derived(fieldDomId(field))
	const choices = $derived(members ?? field.members ?? [])
	const shown = $derived(valueLabel ?? valueText({ control: field.control, members: choices }, field.value))
	const inheritedText = $derived(valueText({ control: field.control, members: choices }, field.inherited))
	/** Set at this session's own layer: Reset clears it. */
	const own = $derived(field.editable && field.source === "session")
	/** The provenance line is an administrator's; an owner hears only about their own value. */
	const provenance = $derived(viewer === "admin" ? sourceWords(field.source) : null)

	const asLines = (v: unknown) => (Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : "")
	const ticked = $derived(new Set(Array.isArray(field.value) ? field.value.map(String) : []))

	function onNumber(input: HTMLInputElement) {
		const n = input.valueAsNumber
		// Emptied: back to what it inherits.
		onwrite(Number.isNaN(n) ? null : field.control === "integer" ? Math.round(n) : n)
	}

	function toggleTick(key: string, on: boolean) {
		const next = new Set(ticked)
		if (on) next.add(key)
		else next.delete(key)
		// In the declared order, so a write never reorders what the genre lists.
		onwrite(choices.map((m) => m.key).filter((k) => next.has(k)))
	}

	/** The schema renderer's one-field values, committed whole. */
	let schemaValues = $state<Record<string, unknown>>({})
	$effect(() => {
		schemaValues = { [field.address.kind === "genre" ? field.address.key : "value"]: structuredClone($state.snapshot(field.value) as unknown) }
	})
	const schemaKey = $derived(field.address.kind === "genre" ? field.address.key : "value")
	const schemaDecl = $derived(
		decl ? { [schemaKey]: { ...decl, label: field.label, description: field.description } } : null
	)
	/** Drawn by the schema renderer: a control only the declaration describes. */
	const drawnBySchema = $derived(
		!!schemaDecl && (field.control === "json" || (field.control === "list" && !(members ?? field.members)?.length))
	)
</script>

<div class="flex flex-col gap-1" data-setting={field.id} data-testid="session-setting">
	{#if !field.editable}
		<!-- Read-only: the value's name and why (§6.17), never a disabled control. -->
		<p class="text-surface-600-400 text-xs" id="{id}-label">{field.label}</p>
		<p class="text-sm" aria-labelledby="{id}-label">{shown}</p>
		{#if field.readOnlyReason}
			<p class="text-surface-600-400 text-xs" data-testid="session-setting-readonly">{field.readOnlyReason}</p>
		{/if}
	{:else if field.control === "boolean"}
		<label class="flex min-h-11 items-center gap-2 text-sm pointer-fine:min-h-0" for={id}>
			<input
				{id}
				type="checkbox"
				role="switch"
				class="checkbox"
				checked={field.value === true}
				disabled={busy}
				aria-describedby="{id}-help"
				onchange={(e) => onwrite(e.currentTarget.checked)}
			/>
			<span>{field.label}</span>
			<span class="text-surface-600-400 text-xs">{field.value === true ? "On" : "Off"}</span>
		</label>
	{:else if field.control === "enum"}
		<Select
			label={field.label}
			options={choices.map((m) => ({ value: m.key, label: m.label }))}
			value={typeof field.value === "string" ? field.value : ""}
			disabled={busy}
			describedBy="{id}-help"
			onValueChange={(v) => {
				if (v && v !== field.value) onwrite(v)
			}}
		/>
	{:else if field.control === "integer" || field.control === "number"}
		<label class="flex flex-col gap-1 text-xs" for={id}>
			<span class="text-surface-600-400">{field.label}</span>
			<input
				{id}
				class="input w-32 rounded-base"
				type="number"
				step={field.control === "integer" ? "1" : "any"}
				min={field.min}
				max={field.max}
				value={typeof field.value === "number" ? field.value : ""}
				placeholder={typeof field.inherited === "number" ? String(field.inherited) : undefined}
				disabled={busy}
				aria-describedby="{id}-help"
				onchange={(e) => onNumber(e.currentTarget)}
			/>
		</label>
	{:else if field.control === "string"}
		<label class="flex flex-col gap-1 text-xs" for={id}>
			<span class="text-surface-600-400">{field.label}</span>
			<input
				{id}
				class="input rounded-base"
				type="text"
				value={typeof field.value === "string" ? field.value : ""}
				disabled={busy}
				aria-describedby="{id}-help"
				onchange={(e) => onwrite(e.currentTarget.value === "" ? null : e.currentTarget.value)}
			/>
		</label>
	{:else if field.control === "text"}
		<label class="flex flex-col gap-1 text-xs" for={id}>
			<span class="text-surface-600-400">{field.label}</span>
			<textarea
				{id}
				class="textarea rounded-base"
				rows={3}
				value={typeof field.value === "string" ? field.value : ""}
				disabled={busy}
				aria-describedby="{id}-help"
				onchange={(e) => onwrite(e.currentTarget.value === "" ? null : e.currentTarget.value)}
			></textarea>
		</label>
	{:else if field.control === "list" && choices.length}
		<!-- A list that names its choices is ticked, one box a choice, never typed. -->
		<fieldset class="flex flex-col gap-1" disabled={busy} aria-describedby="{id}-help">
			<legend class="text-surface-600-400 mb-1 text-xs">{field.label}</legend>
			{#each choices as m (m.key)}
				<label class="flex min-h-11 items-center gap-2 text-sm pointer-fine:min-h-0">
					<input
						type="checkbox"
						class="checkbox"
						checked={ticked.has(m.key)}
						onchange={(e) => toggleTick(m.key, e.currentTarget.checked)}
					/>
					<span>{m.label}</span>
				</label>
			{/each}
		</fieldset>
	{:else if schemaDecl}
		<!-- A control only the genre's declaration describes (an object):
		     the one schema renderer, each commit written whole. -->
		<div aria-describedby="{id}-help">
			<SchemaForm
				schema={schemaDecl as never}
				bind:values={schemaValues}
				disabled={busy}
				oncommit={() => onwrite($state.snapshot(schemaValues[schemaKey]) as unknown)}
			/>
		</div>
	{:else if field.control === "list"}
		<label class="flex flex-col gap-1 text-xs" for={id}>
			<span class="text-surface-600-400">{field.label} · one a line</span>
			<textarea
				{id}
				class="textarea rounded-base"
				rows={3}
				value={asLines(field.value)}
				disabled={busy}
				aria-describedby="{id}-help"
				onchange={(e) =>
					onwrite(
						e.currentTarget.value
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean)
					)}
			></textarea>
		</label>
	{:else}
		<!-- Nothing this form can draw without the declaration: read, not edited here. -->
		<p class="text-surface-600-400 text-xs" id="{id}-label">{field.label}</p>
		<p class="text-sm" aria-labelledby="{id}-label">{shown}</p>
	{/if}

	{#if field.editable}
		<p id="{id}-help" class="text-surface-600-400 text-xs">
			<!-- The schema renderer says an object field's own description. -->
			{#if field.description && !drawnBySchema}{field.description}{/if}
			{#if own}
				<span data-testid="session-setting-own">
					Set for this session.
					<button
						type="button"
						class="anchor inline-flex min-h-11 items-center pointer-fine:min-h-0"
						disabled={busy}
						onclick={() => onwrite(null)}
					>
						Reset
					</button>
					to {inheritedText}.
				</span>
			{:else if provenance}
				<span data-testid="session-setting-source">{provenance}.</span>
			{/if}
		</p>
	{/if}
	{#if refusal}
		<p class="text-error-600-400 text-xs" role="alert">{refusal}</p>
	{/if}
</div>
