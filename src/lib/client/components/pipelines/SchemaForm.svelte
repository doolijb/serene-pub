<script lang="ts">
	/**
	 * A form, from a schema — the one renderer behind every generated form.
	 *
	 * The schema is the SDK's `SettingsSchema`: the field language extensions
	 * declare plugin settings in, the language `inferSchema` produces from a
	 * paused node's payload, and the language arbitrary extension forms will
	 * arrive in. One renderer for all three is the point (12 §6: "the same
	 * schema strategy — one renderer, three uses"): a control fixed here is
	 * fixed for review pauses, plugin settings and extension forms at once.
	 *
	 * No field list, no domain knowledge — this renders whatever arrives and
	 * binds edits into `values`. Submission, validation and folding values
	 * back into a payload belong to the host surface.
	 */

	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { enumOptions } from "$lib/shared/i18n/enumOptions"

	interface FieldDecl {
		type:
			| "string"
			| "text"
			| "number"
			| "integer"
			| "boolean"
			| "enum"
			| "string[]"
			| "secret"
		label?: string | ({ en: string } & Record<string, string>)
		description?: string | ({ en: string } & Record<string, string>)
		min?: number
		max?: number
		of?: readonly string[]
		/** An enum's option labels (`MemberDecl`): what each stored value reads as. */
		members?: readonly {
			key: string
			label?: string | ({ en: string } & Record<string, string>)
			description?: string | ({ en: string } & Record<string, string>)
		}[]
		group?: string
		showIf?: { field: string; equals: unknown }
		format?: "json"
		/** Shown while nothing is stored: the value a run reads (B16x). */
		default?: unknown
	}

	interface Props {
		schema: Record<string, FieldDecl>
		values: Record<string, unknown>
		/**
		 * Called after a control COMMITS a value into `values` — a checkbox or
		 * a box on its `change`, a choice list on its pick. For a host that
		 * writes as the person goes (a widget's settings) rather than on a
		 * Save. A choice list fires no DOM `change` event, so listening for
		 * one on a wrapper silently misses every pick.
		 */
		oncommit?: () => void
	}

	let { schema, values = $bindable(), oncommit }: Props = $props()

	/** Write one field and tell the host it was committed. */
	function commit(key: string, value: unknown) {
		values[key] = value
		oncommit?.()
	}

	const text = (v: FieldDecl["label"], fallback: string): string =>
		i18nTextIn(v) ?? fallback

	/** Declaration order within a group; group order is first appearance. */
	const groups = $derived.by(() => {
		const out: Array<{
			group: string
			fields: Array<{ key: string; decl: FieldDecl }>
		}> = []
		for (const [key, decl] of Object.entries(schema)) {
			const name = decl.group ?? ""
			let g = out.find((x) => x.group === name)
			if (!g) out.push((g = { group: name, fields: [] }))
			g.fields.push({ key, decl })
		}
		return out
	})

	/**
	 * What a field shows: its stored value, else its declared `default` —
	 * the value the server resolves for it (B16x). Display only; nothing is
	 * written until the person moves the control.
	 */
	const shown = (key: string): unknown =>
		values[key] !== undefined ? values[key] : schema[key]?.default

	/** One level of `showIf`, no rules engine — the SDK's own rule. */
	const visible = (decl: FieldDecl): boolean =>
		!decl.showIf || shown(decl.showIf.field) === decl.showIf.equals

	const asLines = (v: unknown): string =>
		Array.isArray(v) ? v.join("\n") : String(v ?? "")
</script>

<div class="flex flex-col gap-3">
	{#each groups as g (g.group)}
		{#if g.group}
			<p class="text-surface-600-400 mt-1 text-xs font-semibold">
				{g.group}
			</p>
		{/if}
		{#each g.fields as { key, decl } (key)}
			{#if visible(decl)}
				<div class="flex flex-col gap-1">
					{#if decl.type === "enum"}
						<!-- Select carries its own (visually hidden) label;
						     this is the same visible text, kept for the
						     column's rhythm. -->
						<span class="text-sm font-medium" aria-hidden="true">
							{text(decl.label, key)}
						</span>
					{:else}
						<label class="text-sm font-medium" for="sf-{key}">
							{text(decl.label, key)}
						</label>
					{/if}

					{#if decl.type === "text"}
						<textarea
							id="sf-{key}"
							class="textarea w-full {decl.format === 'json'
								? 'font-mono text-xs'
								: ''}"
							rows={decl.format === "json" ? 6 : 5}
							value={String(shown(key) ?? "")}
							oninput={(e) =>
								(values[key] = e.currentTarget.value)}
							onchange={() => oncommit?.()}
						></textarea>
					{:else if decl.type === "boolean"}
						<label class="flex items-center gap-2 text-sm">
							<input
								id="sf-{key}"
								type="checkbox"
								class="checkbox"
								checked={!!shown(key)}
								onchange={(e) =>
									commit(key, e.currentTarget.checked)}
							/>
							<span class="text-surface-600-400">
								{shown(key) ? "On" : "Off"}
							</span>
						</label>
					{:else if decl.type === "enum"}
						<Select
							label={text(decl.label, key)}
							labelHidden
							class="w-full"
							options={enumOptions(decl)}
							value={String(shown(key) ?? "")}
							onValueChange={(v) => commit(key, v)}
						/>
					{:else if decl.type === "number" || decl.type === "integer"}
						<input
							id="sf-{key}"
							type="number"
							class="input w-full"
							min={decl.min}
							max={decl.max}
							step={decl.type === "integer" ? 1 : "any"}
							value={shown(key) == null
								? ""
								: String(shown(key))}
							onchange={(e) => commit(key, e.currentTarget.value)}
						/>
					{:else if decl.type === "string[]"}
						<textarea
							id="sf-{key}"
							class="textarea w-full"
							rows="3"
							placeholder="One per line"
							value={asLines(shown(key))}
							onchange={(e) =>
								commit(
									key,
									e.currentTarget.value
										.split("\n")
										.map((l) => l.trim())
										.filter(Boolean)
								)}
						></textarea>
					{:else if decl.type === "secret"}
						<!-- Write-only by type (13 §6): never echoed back. -->
						<input
							id="sf-{key}"
							type="password"
							class="input w-full"
							placeholder="••••••••"
							onchange={(e) => commit(key, e.currentTarget.value)}
						/>
					{:else}
						<input
							id="sf-{key}"
							type="text"
							class="input w-full"
							value={String(shown(key) ?? "")}
							onchange={(e) => commit(key, e.currentTarget.value)}
						/>
					{/if}

					{#if decl.description}
						<p class="text-surface-600-400 text-xs">
							{text(decl.description, "")}
						</p>
					{/if}
				</div>
			{/if}
		{/each}
	{/each}
</div>
