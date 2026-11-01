<script lang="ts">
	/**
	 * The controls for one plugin's declared settings (12 §6), drawn from its
	 * `SettingsSchema`. Shared by the two surfaces that write settings: the
	 * admin plugins page (the instance's values, every field) and a person's
	 * own settings card (their values, user-scoped fields only). The caller
	 * owns the draft and the save; this only renders what a field shows and
	 * reports each edit.
	 *
	 * A secret is never shown: the view carries `{$secretSet}` only, and an
	 * edit is the plaintext typed now (absent = unchanged, null = clear).
	 *
	 * 🚧 A `json` field (M2a a5, one field language) is JSON text in a code
	 * field (STYLE-GUIDE §6.12). Text that parses is the edit, parsed; text
	 * that does not is no edit at all (the draft goes back to the saved
	 * value), and the parser's words show under the field once it is left.
	 * Its byte cap and schema are the server's to judge on Save.
	 */
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { enumOptions } from "$lib/shared/i18n/enumOptions"
	import CodeField from "$lib/client/components/codeField/CodeField.svelte"
	import { SvelteMap } from "svelte/reactivity"
	import { untrack } from "svelte"

	interface Props {
		/** The (possibly narrowed) schema to draw, in declaration order. */
		schema: Record<string, any>
		/** Stored values as the view carries them — secrets masked. */
		values: Record<string, unknown>
		/** Unsaved edits; a key present here wins over `values`. */
		draft?: Record<string, unknown>
		onEdit: (key: string, value: unknown) => void
		/** Makes control ids unique when several plugins' fields are on one page. */
		idPrefix: string
		/** An extra line under a field's description, or null for none. */
		note?: (key: string, decl: any) => string | null
	}

	let {
		schema,
		values,
		draft = {},
		onEdit,
		idPrefix,
		note
	}: Props = $props()

	function valueOf(key: string): unknown {
		return key in draft ? draft[key] : values?.[key]
	}
	const label = (key: string, decl: any): string =>
		i18nTextIn(decl?.label) ?? key
	const description = (decl: any): string | null =>
		i18nTextIn(decl?.description) ?? null
	const idOf = (key: string) => `${idPrefix}-${key}`

	// A json field's text as typed, and why it does not parse — by key.
	const jsonTexts = new SvelteMap<string, string>()
	const jsonErrors = new SvelteMap<string, string>()
	let jsonFocused = $state<string | null>(null)
	const pretty = (v: unknown) => (v === undefined || v === null ? "" : JSON.stringify(v, null, 2))
	const jsonTextOf = (key: string) => jsonTexts.get(key) ?? pretty(valueOf(key))
	function onJsonInput(key: string, text: string) {
		jsonTexts.set(key, text)
		// Emptied: cleared, as every other field here.
		if (!text.trim()) {
			jsonErrors.delete(key)
			onEdit(key, null)
			return
		}
		try {
			const parsed = JSON.parse(text)
			jsonErrors.delete(key)
			onEdit(key, parsed)
		} catch (e) {
			jsonErrors.set(key, e instanceof Error ? e.message : String(e))
			onEdit(key, values?.[key])
		}
	}
	// A fresh view (a save landed, a reload): the text of a key with no edit pending is the view's again.
	$effect(() => {
		void values
		untrack(() => {
			for (const k of [...jsonTexts.keys()])
				if (!(k in draft)) {
					jsonTexts.delete(k)
					jsonErrors.delete(k)
				}
		})
	})
</script>

{#each Object.entries(schema) as [key, decl] (key)}
	{@const hint = description(decl)}
	{@const extra = note?.(key, decl) ?? null}
	<div class="flex flex-col gap-1 text-sm">
		<label for={idOf(key)} class="font-medium">
			{label(key, decl)}
			{#if decl.required}
				<span class="text-warning-600-400" aria-label="required">*</span>
			{/if}
		</label>
		{#if hint}
			<span class="text-surface-600-400 text-xs">{hint}</span>
		{/if}
		{#if extra}
			<span class="text-surface-600-400 text-xs">{extra}</span>
		{/if}
		{#if decl.type === "secret"}
			{@const set = (values?.[key] as any)?.$secretSet}
			<div class="flex items-center gap-2">
				<input
					id={idOf(key)}
					type="password"
					class="input input-sm max-w-xs"
					placeholder={set ? "•••••• (set — type to replace)" : "not set"}
					value={typeof valueOf(key) === "string"
						? (valueOf(key) as string)
						: ""}
					oninput={(e) => onEdit(key, e.currentTarget.value)}
				/>
				{#if set}
					<button
						type="button"
						class="btn btn-sm preset-tonal"
						onclick={() => onEdit(key, null)}
					>
						Clear
					</button>
				{/if}
			</div>
		{:else if decl.type === "boolean"}
			<input
				id={idOf(key)}
				type="checkbox"
				class="checkbox"
				checked={!!valueOf(key)}
				onchange={(e) => onEdit(key, e.currentTarget.checked)}
			/>
		{:else if decl.type === "enum"}
			<!-- The label above names the field; the Select carries its own,
			     visually hidden, since it cannot take that label's `for`. -->
			<Select
				label={label(key, decl)}
				labelHidden
				class="max-w-xs text-sm"
				options={enumOptions(decl)}
				value={String(valueOf(key) ?? "")}
				onValueChange={(v) => onEdit(key, v)}
			/>
		{:else if decl.type === "number" || decl.type === "integer"}
			<input
				id={idOf(key)}
				type="number"
				class="input input-sm max-w-xs"
				step={decl.type === "integer" ? "1" : "any"}
				min={decl.min}
				max={decl.max}
				value={valueOf(key) ?? ""}
				oninput={(e) => {
					const raw = e.currentTarget.value
					const n = Number(raw)
					onEdit(key, raw !== "" && Number.isFinite(n) ? n : undefined)
				}}
			/>
		{:else if decl.type === "string[]"}
			<input
				id={idOf(key)}
				type="text"
				class="input input-sm"
				placeholder="comma-separated"
				value={Array.isArray(valueOf(key))
					? (valueOf(key) as string[]).join(", ")
					: ""}
				oninput={(e) =>
					onEdit(
						key,
						e.currentTarget.value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					)}
			/>
		{:else if decl.type === "json"}
			{@const issue = jsonFocused === key ? null : (jsonErrors.get(key) ?? null)}
			<CodeField
				id={idOf(key)}
				value={jsonTextOf(key)}
				oninput={(t) => onJsonInput(key, t)}
				rows={6}
				describedBy={issue ? `${idOf(key)}-issue` : undefined}
				invalid={!!issue}
				onfocuschange={(f) => (jsonFocused = f ? key : jsonFocused === key ? null : jsonFocused)}
			/>
			{#if issue}
				<p id="{idOf(key)}-issue" class="text-error-600-400 text-xs" data-testid="plugin-setting-json-issue">
					<span class="font-medium">Error:</span> this is not valid JSON ({issue}), so it is not saved until it is.
				</p>
			{/if}
		{:else if decl.type === "text"}
			<textarea
				id={idOf(key)}
				class="textarea text-sm"
				rows="3"
				value={String(valueOf(key) ?? "")}
				oninput={(e) => onEdit(key, e.currentTarget.value)}
			></textarea>
		{:else}
			<input
				id={idOf(key)}
				type="text"
				class="input input-sm"
				value={String(valueOf(key) ?? "")}
				oninput={(e) => onEdit(key, e.currentTarget.value)}
			/>
		{/if}
	</div>
{/each}
