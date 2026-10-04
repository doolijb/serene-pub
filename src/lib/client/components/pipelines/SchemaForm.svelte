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
			| "object"
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
		/**
		 * For `object`: its members, drawn as one fieldset under the field's
		 * label. A member's `group` is a fold inside it (closed until opened),
		 * so an object can keep its rarely-touched members out of the way.
		 */
		fields?: Record<string, FieldDecl>
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

	const isBag = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === "object" && !Array.isArray(v)

	/**
	 * An `object` field's members, as shown: the stored value's, else the
	 * field's declared `default`'s, else the member's own `default`.
	 */
	function memberShown(key: string, member: string): unknown {
		const stored = values[key]
		if (isBag(stored) && stored[member] !== undefined) return stored[member]
		const fallback = schema[key]?.default
		if (isBag(fallback) && fallback[member] !== undefined) return fallback[member]
		return schema[key]?.fields?.[member]?.default
	}

	/**
	 * Write one member of an `object` field. The object is written WHOLE —
	 * every declared member as shown, this one replaced — so a value is
	 * complete from its first edit, and replacing it (rather than mutating a
	 * nested proxy that may not exist yet) is what the host's `bind:values`
	 * sees. A number member's text is read as a number.
	 */
	function commitMember(key: string, member: string, value: unknown, committed = true) {
		const decl = schema[key]
		const next: Record<string, unknown> = {}
		for (const m of Object.keys(decl?.fields ?? {})) next[m] = memberShown(key, m)
		const memberDecl = decl?.fields?.[member]
		next[member] =
			(memberDecl?.type === "number" || memberDecl?.type === "integer") &&
			typeof value === "string"
				? value.trim() === ""
					? memberDecl.default
					: Number(value)
				: value
		values[key] = next
		if (committed) oncommit?.()
	}

	/** An object's members by fold: the ungrouped first, then each group. */
	const memberGroups = (decl: FieldDecl) => {
		const out: Array<{ group: string; members: Array<{ key: string; decl: FieldDecl }> }> = []
		for (const [key, m] of Object.entries(decl.fields ?? {})) {
			const name = m.group ?? ""
			let g = out.find((x) => x.group === name)
			if (!g) out.push((g = { group: name, members: [] }))
			g.members.push({ key, decl: m })
		}
		return out.sort((a, b) => (a.group ? 1 : 0) - (b.group ? 1 : 0))
	}
</script>

<!-- One control, for a top-level field or an object's member: `id` labels it,
     `value` is what it shows, `set` commits (`live` writes as it is typed). -->
{#snippet control(
	id: string,
	key: string,
	decl: FieldDecl,
	value: unknown,
	set: (v: unknown) => void,
	live: (v: unknown) => void
)}
	<div class="flex flex-col gap-1">
		{#if decl.type === "enum"}
			<span class="text-sm font-medium" aria-hidden="true">
				{text(decl.label, key)}
			</span>
		{:else}
			<label class="text-sm font-medium" for={id}>
				{text(decl.label, key)}
			</label>
		{/if}
		{#if decl.type === "text"}
			<textarea
				{id}
				class="textarea w-full {decl.format === 'json' ? 'font-mono text-xs' : ''}"
				rows={decl.format === "json" ? 6 : 5}
				value={String(value ?? "")}
				oninput={(e) => live(e.currentTarget.value)}
				onchange={(e) => set(e.currentTarget.value)}
			></textarea>
		{:else if decl.type === "boolean"}
			<label class="flex items-center gap-2 text-sm">
				<input
					{id}
					type="checkbox"
					class="checkbox"
					checked={!!value}
					onchange={(e) => set(e.currentTarget.checked)}
				/>
				<span class="text-surface-600-400">{value ? "On" : "Off"}</span>
			</label>
		{:else if decl.type === "enum"}
			<Select
				label={text(decl.label, key)}
				labelHidden
				class="w-full"
				options={enumOptions(decl)}
				value={String(value ?? "")}
				onValueChange={(v) => set(v)}
			/>
		{:else if decl.type === "number" || decl.type === "integer"}
			<input
				{id}
				type="number"
				class="input w-full"
				min={decl.min}
				max={decl.max}
				step={decl.type === "integer" ? 1 : "any"}
				value={value == null ? "" : String(value)}
				onchange={(e) => set(e.currentTarget.value)}
			/>
		{:else}
			<input
				{id}
				type="text"
				class="input w-full"
				value={String(value ?? "")}
				onchange={(e) => set(e.currentTarget.value)}
			/>
		{/if}
		{#if decl.description}
			<p class="text-surface-600-400 text-xs">{text(decl.description, "")}</p>
		{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-3">
	{#each groups as g (g.group)}
		{#if g.group}
			<p class="text-surface-600-400 mt-1 text-xs font-semibold">
				{g.group}
			</p>
		{/if}
		{#each g.fields as { key, decl } (key)}
			{#if visible(decl) && decl.type === "object"}
				<!-- A fixed-key record: its members under its label, a member
				     group as a fold. Written whole on each member's commit. -->
				<fieldset class="border-surface-200-800 rounded-base flex flex-col gap-3 border p-3">
					<legend class="px-1 text-sm font-medium">{text(decl.label, key)}</legend>
					{#if decl.description}
						<p class="text-surface-600-400 text-xs">{text(decl.description, "")}</p>
					{/if}
					{#each memberGroups(decl) as mg (mg.group)}
						{#if mg.group}
							<details class="flex flex-col gap-3">
								<summary class="text-surface-600-400 cursor-pointer text-xs font-semibold">
									{mg.group}
								</summary>
								<div class="mt-2 flex flex-col gap-3">
									{#each mg.members as m (m.key)}
										{@render control(
											`sf-${key}-${m.key}`,
											m.key,
											m.decl,
											memberShown(key, m.key),
											(v) => commitMember(key, m.key, v),
											(v) => commitMember(key, m.key, v, false)
										)}
									{/each}
								</div>
							</details>
						{:else}
							{#each mg.members as m (m.key)}
								{@render control(
									`sf-${key}-${m.key}`,
									m.key,
									m.decl,
									memberShown(key, m.key),
									(v) => commitMember(key, m.key, v),
									(v) => commitMember(key, m.key, v, false)
								)}
							{/each}
						{/if}
					{/each}
				</fieldset>
			{:else if visible(decl)}
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
