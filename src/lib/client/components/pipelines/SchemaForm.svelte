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
		group?: string
		showIf?: { field: string; equals: unknown }
		format?: "json"
	}

	interface Props {
		schema: Record<string, FieldDecl>
		values: Record<string, unknown>
	}

	let { schema, values = $bindable() }: Props = $props()

	const text = (v: FieldDecl["label"], fallback: string): string =>
		typeof v === "string" ? v : (v?.en ?? fallback)

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

	/** One level of `showIf`, no rules engine — the SDK's own rule. */
	const visible = (decl: FieldDecl): boolean =>
		!decl.showIf || values[decl.showIf.field] === decl.showIf.equals

	const asLines = (v: unknown): string =>
		Array.isArray(v) ? v.join("\n") : String(v ?? "")
</script>

<div class="flex flex-col gap-3">
	{#each groups as g (g.group)}
		{#if g.group}
			<p class="text-muted mt-1 text-xs font-semibold uppercase">
				{g.group}
			</p>
		{/if}
		{#each g.fields as { key, decl } (key)}
			{#if visible(decl)}
				<div class="flex flex-col gap-1">
					<label class="text-sm font-medium" for="sf-{key}">
						{text(decl.label, key)}
					</label>

					{#if decl.type === "text"}
						<textarea
							id="sf-{key}"
							class="textarea w-full {decl.format === 'json'
								? 'font-mono text-xs'
								: ''}"
							rows={decl.format === "json" ? 6 : 5}
							value={String(values[key] ?? "")}
							oninput={(e) =>
								(values[key] = e.currentTarget.value)}
						></textarea>
					{:else if decl.type === "boolean"}
						<label class="flex items-center gap-2 text-sm">
							<input
								id="sf-{key}"
								type="checkbox"
								class="checkbox"
								checked={!!values[key]}
								onchange={(e) =>
									(values[key] = e.currentTarget.checked)}
							/>
							<span class="text-muted">
								{values[key] ? "On" : "Off"}
							</span>
						</label>
					{:else if decl.type === "enum"}
						<select
							id="sf-{key}"
							class="select w-full"
							value={String(values[key] ?? "")}
							onchange={(e) =>
								(values[key] = e.currentTarget.value)}
						>
							{#each decl.of ?? [] as choice}
								<option value={choice}>{choice}</option>
							{/each}
						</select>
					{:else if decl.type === "number" || decl.type === "integer"}
						<input
							id="sf-{key}"
							type="number"
							class="input w-full"
							min={decl.min}
							max={decl.max}
							step={decl.type === "integer" ? 1 : "any"}
							value={values[key] == null
								? ""
								: String(values[key])}
							onchange={(e) =>
								(values[key] = e.currentTarget.value)}
						/>
					{:else if decl.type === "string[]"}
						<textarea
							id="sf-{key}"
							class="textarea w-full"
							rows="3"
							placeholder="One per line"
							value={asLines(values[key])}
							onchange={(e) =>
								(values[key] = e.currentTarget.value
									.split("\n")
									.map((l) => l.trim())
									.filter(Boolean))}
						></textarea>
					{:else if decl.type === "secret"}
						<!-- Write-only by type (13 §6): never echoed back. -->
						<input
							id="sf-{key}"
							type="password"
							class="input w-full"
							placeholder="••••••••"
							onchange={(e) =>
								(values[key] = e.currentTarget.value)}
						/>
					{:else}
						<input
							id="sf-{key}"
							type="text"
							class="input w-full"
							value={String(values[key] ?? "")}
							onchange={(e) =>
								(values[key] = e.currentTarget.value)}
						/>
					{/if}

					{#if decl.description}
						<p class="text-muted text-xs">
							{text(decl.description, "")}
						</p>
					{/if}
				</div>
			{/if}
		{/each}
	{/each}
</div>
