<script lang="ts" module>
	import { checkSchema, type FieldDecl, type SettingsSchema } from "@serene-pub/sdk"

	/**
	 * The types a session field may take here: the scalar half of the SDK's
	 * `FieldType` (settings.ts). The rest (secret, share, media, list,
	 * object…) are not session-form fields an admin declares by hand; a field
	 * of another type already in the schema is kept as it is, read-only.
	 */
	export const EDITABLE_TYPES = [
		{ value: "string", label: "Short text" },
		{ value: "text", label: "Long text" },
		{ value: "number", label: "Number" },
		{ value: "integer", label: "Whole number" },
		{ value: "boolean", label: "Yes or no" },
		{ value: "enum", label: "Choice" },
		{ value: "string[]", label: "List of words" }
	] as const
	export type EditableType = (typeof EDITABLE_TYPES)[number]["value"]
	const EDITABLE = new Set<string>(EDITABLE_TYPES.map((t) => t.value))

	/**
	 * One field as the editor holds it: every value as the text in its box,
	 * so a half-typed number is still the person's, not a NaN. `orig` is the
	 * declaration it was read from, so what the editor does not show (min,
	 * max, group, a translated label…) survives a save.
	 */
	export interface FieldRow {
		/** The editor's own bookkeeping; never saved. */
		uid: string
		key: string
		type: string
		label: string
		description: string
		required: boolean
		/** The default as typed: "" is none; booleans "true"/"false"; lists comma-separated. */
		defaultText: string
		/** An enum's options, comma-separated. */
		optionsText: string
		orig: FieldDecl | null
	}

	let seq = 0
	const nextUid = () => `field-${++seq}`

	const textOf = (v: unknown): string =>
		typeof v === "string" ? v : v && typeof v === "object" && "en" in v ? String((v as { en: unknown }).en) : ""
	const splitList = (s: string) =>
		s
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean)

	export function schemaToRows(schema: SettingsSchema | null | undefined): FieldRow[] {
		return Object.entries(schema ?? {}).map(([key, d]) => ({
			uid: nextUid(),
			key,
			type: d.type,
			label: textOf(d.label),
			description: textOf(d.description),
			required: !!d.required,
			defaultText:
				d.default === undefined || d.default === null
					? ""
					: Array.isArray(d.default)
						? d.default.join(", ")
						: String(d.default),
			optionsText: (
				Array.isArray((d as unknown as { members?: unknown }).members)
					? ((d as unknown as { members: Array<{ key?: string }> }).members ?? []).map((m) => m?.key ?? "").filter(Boolean)
					: ((d as { of?: string[] }).of ?? [])
			).join(", "),
			orig: d
		}))
	}

	function defaultOf(r: FieldRow): unknown {
		const t = r.defaultText.trim()
		if (!t || r.required) return undefined
		switch (r.type) {
			case "number":
			case "integer":
				return Number(t)
			case "boolean":
				return t === "true"
			case "string[]":
				return splitList(t)
			case "string":
			case "text":
				return r.defaultText
			default:
				return t
		}
	}

	/** The rows as the SDK's `SettingsSchema`, in their order. */
	export function rowsToSchema(rows: readonly FieldRow[]): SettingsSchema {
		const out: SettingsSchema = {}
		for (const r of rows) {
			const key = r.key.trim()
			if (!key || key in out) continue
			if (!EDITABLE.has(r.type) && r.orig) {
				out[key] = r.orig
				continue
			}
			const {
				type: _t,
				label: _l,
				description: _d,
				default: _df,
				of: _o,
				members: _m,
				required: _r,
				...rest
			} = (r.orig ?? {}) as FieldDecl & { members?: Array<{ key: string; label?: unknown }> }
			const decl: FieldDecl = { ...rest, type: r.type as FieldDecl["type"] }
			const label = r.label.trim()
			if (label) decl.label = r.orig && textOf(r.orig.label) === label ? r.orig.label : label
			const description = r.description.trim()
			if (description)
				decl.description =
					r.orig && textOf(r.orig.description) === description ? r.orig.description : description
			if (r.type === "enum") {
				// Core declares a choice's options as `members[{key, label}]`; a kept key keeps its label.
				const had = ((r.orig as { members?: Array<{ key: string; label?: unknown }> } | undefined)?.members ?? [])
				;(decl as { members?: unknown }).members = splitList(r.optionsText).map(
					(key) => had.find((m) => m.key === key) ?? { key, label: { en: key } }
				)
			}
			if (r.required) decl.required = true
			const d = defaultOf(r)
			if (d !== undefined) decl.default = d
			out[key] = decl
		}
		return out
	}

	const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

	/** What stops these rows saving, one sentence each, by row uid. */
	export function rowProblems(rows: readonly FieldRow[]): Map<string, string[]> {
		const out = new Map<string, string[]>()
		const add = (uid: string, msg: string) => out.set(uid, [...(out.get(uid) ?? []), msg])
		const seen = new Map<string, string>()
		for (const r of rows) {
			const key = r.key.trim()
			if (!key) add(r.uid, "A field needs a key.")
			else if (!KEY.test(key))
				add(r.uid, "A key starts with a letter and holds only letters, digits and underscores.")
			else if (seen.has(key)) add(r.uid, `Another field already uses the key “${key}”.`)
			else seen.set(key, r.uid)
			if (!EDITABLE.has(r.type)) continue
			const options = splitList(r.optionsText)
			if (r.type === "enum" && !options.length) add(r.uid, "A choice needs at least one option.")
			const t = r.defaultText.trim()
			if (!t || r.required) continue
			if ((r.type === "number" || r.type === "integer") && !Number.isFinite(Number(t)))
				add(r.uid, "The default is not a number.")
			else if (r.type === "integer" && !Number.isInteger(Number(t)))
				add(r.uid, "The default of a whole number cannot have a fraction.")
			else if (r.type === "enum" && !options.includes(t))
				add(r.uid, "The default is not one of the options.")
		}
		// Anything else the SDK would refuse, on the row it is about.
		for (const f of checkSchema(rowsToSchema(rows))) {
			if (f.severity !== "error" || !f.field) continue
			const uid = seen.get(f.field)
			// One voice per row: the sentences above say it better when they apply.
			if (uid && !out.has(uid)) add(uid, f.message)
		}
		return out
	}

	export function blankRow(): FieldRow {
		return {
			uid: nextUid(),
			key: "",
			type: "string",
			label: "",
			description: "",
			required: false,
			defaultText: "",
			optionsText: "",
			orig: null
		}
	}
</script>

<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * A `SettingsSchema` DEFINITION editor (PLAN-pipeline-canvas-and-genre-
	 * authoring §6.2): the fields a genre's new-session form asks for, each a
	 * key, a label, a type, a default, an enum's options and whether it is
	 * required; add, remove and move. Beside it, the form itself, drawn live
	 * by `SchemaForm` — the same renderer the session form uses — so what is
	 * declared is what people will fill in.
	 *
	 * The rows are the caller's draft (`rows` bindable); the caller saves
	 * `rowsToSchema(rows)` and refuses while `rowProblems(rows)` has any.
	 */
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import SchemaForm from "$lib/client/components/pipelines/SchemaForm.svelte"

	interface Props {
		rows: FieldRow[]
		readonly?: boolean
		/** Prefix for control ids. */
		idPrefix?: string
	}
	let { rows = $bindable(), readonly = false, idPrefix = "schema-field" }: Props = $props()

	const problems = $derived(rowProblems(rows))
	const preview = $derived(rowsToSchema(rows.filter((r) => !problems.has(r.uid))))
	let previewValues = $state<Record<string, unknown>>({})

	function add() {
		rows.push(blankRow())
	}
	function remove(uid: string) {
		rows = rows.filter((r) => r.uid !== uid)
	}
	function move(i: number, by: -1 | 1) {
		const j = i + by
		if (j < 0 || j >= rows.length) return
		const next = [...rows]
		;[next[i], next[j]] = [next[j]!, next[i]!]
		rows = next
	}
	function setType(row: FieldRow, type: string) {
		if (row.type === type) return
		row.type = type
		// A default typed for another type rarely means the same thing.
		row.defaultText = ""
	}
	function setRequired(row: FieldRow, on: boolean) {
		row.required = on
		// Required means the person must choose: a default would decide for them.
		if (on) row.defaultText = ""
	}
	const typeLabel = (t: string) => EDITABLE_TYPES.find((x) => x.value === t)?.label ?? t
</script>

<div class="flex flex-col gap-4 @min-[60rem]/content:grid @min-[60rem]/content:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
	<div class="flex flex-col gap-3">
		{#if !rows.length}
			<p class="text-surface-600-400 text-sm">
				No fields yet — people start a session without being asked anything.
			</p>
		{/if}
		{#each rows as row, i (row.uid)}
			{@const id = `${idPrefix}-${row.uid}`}
			{@const errs = problems.get(row.uid) ?? []}
			{@const editable = !readonly && EDITABLE.has(row.type)}
			<div
				class="bg-surface-50-950 flex flex-col gap-2 rounded-base p-3"
				role="group"
				aria-label="Field {row.key || i + 1}"
				data-field={row.key}
			>
				<div class="grid gap-2 @min-[36rem]/content:grid-cols-2">
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-surface-600-400">Key</span>
						<input
							id="{id}-key"
							class="input font-mono text-sm"
							type="text"
							placeholder="goal"
							autocomplete="off"
							spellcheck="false"
							disabled={readonly}
							aria-invalid={errs.length > 0}
							bind:value={row.key}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-surface-600-400">Label</span>
						<input
							id="{id}-label"
							class="input text-sm"
							type="text"
							placeholder="What people read"
							disabled={!editable}
							bind:value={row.label}
						/>
					</label>
					<div class="flex flex-col gap-1 text-xs">
						<span class="text-surface-600-400" aria-hidden="true">Type</span>
						{#if EDITABLE.has(row.type)}
							<Select
								label="Type of {row.key || 'the field'}"
								labelHidden
								disabled={readonly}
								options={EDITABLE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
								value={row.type}
								onValueChange={(v) => setType(row, v)}
							/>
						{:else}
							<span class="font-mono text-sm">{row.type}</span>
						{/if}
					</div>
					{#if editable}
						<div class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400" aria-hidden="true">Default</span>
							{#if row.required}
								<span class="text-surface-600-400 min-h-10 py-2 text-sm">
									None — a required field is the person's choice.
								</span>
							{:else if row.type === "boolean"}
								<Select
									label="Default of {row.key || 'the field'}"
									labelHidden
									options={[
										{ value: "", label: "None" },
										{ value: "true", label: "Yes" },
										{ value: "false", label: "No" }
									]}
									bind:value={row.defaultText}
								/>
							{:else if row.type === "enum"}
								<Select
									label="Default of {row.key || 'the field'}"
									labelHidden
									options={[
										{ value: "", label: "None" },
										...row.optionsText
											.split(",")
											.map((o) => o.trim())
											.filter(Boolean)
											.map((o) => ({ value: o, label: o }))
									]}
									bind:value={row.defaultText}
								/>
							{:else}
								<input
									id="{id}-default"
									class="input text-sm"
									type="text"
									inputmode={row.type === "number" || row.type === "integer" ? "decimal" : undefined}
									placeholder={row.type === "string[]" ? "one, two, three" : "None"}
									aria-label="Default of {row.key || 'the field'}"
									bind:value={row.defaultText}
								/>
							{/if}
						</div>
					{/if}
					{#if editable && row.type === "enum"}
						<label class="flex flex-col gap-1 text-xs @min-[36rem]/content:col-span-2">
							<span class="text-surface-600-400">Options</span>
							<input
								id="{id}-options"
								class="input text-sm"
								type="text"
								placeholder="quiet, lively, grim"
								bind:value={row.optionsText}
							/>
							<span class="text-surface-600-400">Separate them with commas.</span>
						</label>
					{/if}
					<label class="flex flex-col gap-1 text-xs @min-[36rem]/content:col-span-2">
						<span class="text-surface-600-400">Help text</span>
						<input
							id="{id}-description"
							class="input text-sm"
							type="text"
							disabled={!editable}
							bind:value={row.description}
						/>
					</label>
				</div>
				{#if !EDITABLE.has(row.type)}
					<FieldHelp>
						A {typeLabel(row.type)} field is kept as it was declared; only its key can change here.
					</FieldHelp>
				{/if}
				<div class="flex flex-wrap items-center gap-2">
					<label class="flex min-h-10 items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="checkbox"
							disabled={!editable}
							checked={row.required}
							onchange={(e) => setRequired(row, e.currentTarget.checked)}
						/>
						Required
					</label>
					{#if !readonly}
						<span class="ml-auto flex items-center gap-1">
							<button
								type="button"
								class="btn-icon btn-icon-sm hover:preset-tonal"
								aria-label="Move {row.key || 'field'} up"
								disabled={i === 0}
								onclick={() => move(i, -1)}
							>
								<Icons.ArrowUp size={16} aria-hidden="true" />
							</button>
							<button
								type="button"
								class="btn-icon btn-icon-sm hover:preset-tonal"
								aria-label="Move {row.key || 'field'} down"
								disabled={i === rows.length - 1}
								onclick={() => move(i, 1)}
							>
								<Icons.ArrowDown size={16} aria-hidden="true" />
							</button>
							<button
								type="button"
								class="btn-icon btn-icon-sm hover:preset-tonal-error"
								aria-label="Remove {row.key || 'field'}"
								onclick={() => remove(row.uid)}
							>
								<Icons.Trash2 size={16} aria-hidden="true" />
							</button>
						</span>
					{/if}
				</div>
				{#if errs.length}
					<ul class="text-error-600-400 flex flex-col gap-0.5 text-xs" role="alert">
						{#each errs as e (e)}<li>{e}</li>{/each}
					</ul>
				{/if}
			</div>
		{/each}
		{#if !readonly}
			<button type="button" class="btn btn-sm preset-tonal-surface self-start" onclick={add}>
				<Icons.Plus size={16} aria-hidden="true" /> Add a field
			</button>
		{/if}
	</div>

	<section
		class="border-surface-300-700 flex flex-col gap-2 self-start rounded-base border border-dashed p-3"
		aria-label="Preview of the new-session form"
	>
		<p class="text-surface-600-400 text-xs font-medium">Preview — what people fill in</p>
		{#if Object.keys(preview).length}
			<SchemaForm schema={preview as never} bind:values={previewValues} />
		{:else}
			<p class="text-surface-600-400 text-xs">Nothing to fill in.</p>
		{/if}
	</section>
</div>
