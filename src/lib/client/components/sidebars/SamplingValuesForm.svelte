<script lang="ts">
	/**
	 * The sampling parameter editor, driven entirely by the shape's declared
	 * vocabulary (SDK `SAMPLING_SCHEMAS`).
	 *
	 * There used to be a `fieldMeta` literal in the sidebar naming nine samplers
	 * with hand-written labels and ranges. Everything outside it — mirostat, DRY,
	 * XTC, min-P, typical-P, dynamic temperature — had a database column, an
	 * adapter mapping, and no way for anyone to reach it. Reading the schema means
	 * a parameter that exists is a parameter you can set, and adding one is one
	 * declaration in one file rather than a column, a flag, a `fieldMeta` entry
	 * and a form branch.
	 *
	 * It is a sibling of `pipelines/SchemaForm.svelte`, not a use of it: same
	 * declaration language, different controls. A sampler wants a slider you can
	 * click to type into, an on/off switch of its own, and a note when the chosen
	 * backend will not honour it — none of which belong in the renderer that draws
	 * plugin settings and review forms.
	 */

	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"
	import type { SettingsSchema, FieldDecl } from "@serene-pub/sdk"
	import { getSupportedSamplers } from "$lib/shared/utils/samplerMappings"

	interface Props {
		schema: SettingsSchema
		/** The row's `values`. Bound: edits land here directly. */
		values: Record<string, unknown>
		/** The row's `enabled`. Bound: the per-key switches write here. */
		enabled: string[]
		/** Immutable rows are readable but not editable. */
		disabled?: boolean
		/**
		 * The connection type a reader is most likely to run this against, used
		 * only to note which parameters it will ignore. Advisory: a config
		 * outlives the connection it happens to be paired with, so an unhonoured
		 * parameter is worth saying and never worth blocking.
		 */
		connectionType?: string | null
	}

	let {
		schema,
		values = $bindable(),
		enabled = $bindable(),
		disabled = false,
		connectionType = null
	}: Props = $props()

	/**
	 * How wide the slider goes before "unlock max".
	 *
	 * The schema's `max` is the hard bound — what is valid at all, and what the
	 * write path clamps to. These are the comfortable ranges, which is a question
	 * about what a person is likely to want rather than about what the parameter
	 * permits, so it belongs here rather than in the shared vocabulary.
	 */
	const SOFT_MAX: Record<string, number> = {
		responseTokens: 4096,
		contextTokens: 32768
	}

	const supported = $derived(
		connectionType ? getSupportedSamplers(connectionType) : null
	)

	const label = (decl: FieldDecl, key: string): string => {
		const l = decl.label ?? decl.i18n
		return typeof l === "string" ? l : (l?.en ?? key)
	}
	const describe = (decl: FieldDecl): string => {
		const d = decl.description
		return typeof d === "string" ? d : (d?.en ?? "")
	}

	/** Declaration order within a group; group order is first appearance. */
	const groups = $derived.by(() => {
		const out: Array<{
			group: string
			fields: Array<{ key: string; decl: FieldDecl }>
		}> = []
		for (const [key, decl] of Object.entries(schema)) {
			const name = decl.group ?? "Other"
			let g = out.find((x) => x.group === name)
			if (!g) out.push((g = { group: name, fields: [] }))
			g.fields.push({ key, decl })
		}
		return out
	})

	const isOn = (key: string) => enabled.includes(key)

	function toggle(key: string, on: boolean) {
		if (disabled) return
		// Reassigned, not mutated: `enabled` is a plain array on a `$state` object
		// and in-place push/splice would not re-run the `$derived` that watches it.
		if (on) {
			if (!enabled.includes(key)) enabled = [...enabled, key]
			// Materialise the default on switch-on so the slider has something to
			// show. Resolution would supply it anyway; writing it means the form
			// and the eventual request agree about what the value is.
			if (values[key] === undefined && schema[key]?.default !== undefined)
				values[key] = schema[key].default
		} else {
			enabled = enabled.filter((k) => k !== key)
		}
	}

	/** The slider's ceiling: the soft range, or the hard bound once unlocked. */
	function maxFor(key: string, decl: FieldDecl): number {
		const soft = SOFT_MAX[key]
		if (soft === undefined) return decl.max ?? 100
		return values[key + "Unlocked"] ? (decl.max ?? soft) : soft
	}

	const step = (decl: FieldDecl): number | "any" =>
		decl.type === "integer" ? 1 : "any"

	/** Which fields offer an unlock toggle — the two budgets, and only those. */
	const unlockable = (key: string) => key in SOFT_MAX

	let editingField: string | null = $state(null)
	async function editValue(key: string) {
		if (disabled) return
		editingField = key
		await tick()
		document.getElementById(`sv-${key}-manual`)?.focus()
	}

	const asLines = (v: unknown): string =>
		Array.isArray(v) ? v.join("\n") : String(v ?? "")

	const asJson = (v: unknown): string =>
		typeof v === "string" ? v : JSON.stringify(v ?? {}, null, 2)

	const num = (v: unknown, decl: FieldDecl): number =>
		typeof v === "number" ? v : ((decl.default as number) ?? decl.min ?? 0)
</script>

<div class="flex flex-col gap-4">
	{#each groups as g (g.group)}
		<section class="flex flex-col gap-2">
			<p
				class="text-muted-foreground border-surface-500/20 border-b pb-1 text-xs font-semibold tracking-wide uppercase"
			>
				{g.group}
			</p>

			{#each g.fields as { key, decl } (key)}
				{@const on = isOn(key)}
				{@const ignored = on && supported && !supported.has(key)}
				<div class="flex flex-col gap-1">
					<div class="flex items-start gap-2">
						<input
							id="sv-{key}-on"
							type="checkbox"
							class="accent-primary mt-1 shrink-0"
							checked={on}
							{disabled}
							onchange={(e) =>
								toggle(key, e.currentTarget.checked)}
						/>
						<label
							class="min-w-0 flex-1 cursor-pointer text-sm font-semibold"
							for="sv-{key}-on"
						>
							{label(decl, key)}
							{#if ignored}
								<span
									class="text-warning-600 dark:text-warning-400 ml-1 inline-flex items-center gap-1 text-xs font-normal"
									title="This connection type has no mapping for this parameter, so it will be left out of the request."
								>
									<Icons.TriangleAlert size={11} />
									not sent to this backend
								</span>
							{/if}
						</label>
					</div>

					{#if on}
						<div class="pl-6">
							{#if decl.type === "number" || decl.type === "integer"}
								{@const max = maxFor(key, decl)}
								{@const min = decl.min ?? 0}
								<div class="flex flex-col gap-1">
									<input
										type="range"
										id="sv-{key}"
										{min}
										{max}
										step={step(decl)}
										{disabled}
										value={num(values[key], decl)}
										oninput={(e) =>
											(values[key] = parseFloat(
												e.currentTarget.value
											))}
										class="accent-primary w-full"
									/>
									<div
										class="text-muted-foreground flex w-full items-center justify-between gap-1 text-xs"
									>
										<span class="select-none">{min}</span>
										{#if editingField === key}
											<input
												id="sv-{key}-manual"
												type="number"
												{min}
												{max}
												step={step(decl)}
												{disabled}
												value={num(values[key], decl)}
												oninput={(e) =>
													(values[key] = parseFloat(
														e.currentTarget.value
													))}
												class="border-primary input w-24 rounded border py-0.5 text-center"
												onblur={() =>
													(editingField = null)}
												onkeydown={(e) => {
													if (
														e.key === "Enter" ||
														e.key === "Escape"
													)
														editingField = null
												}}
											/>
										{:else}
											<button
												type="button"
												class="hover:bg-muted cursor-pointer rounded px-1.5 py-0.5 font-medium"
												title="Click to type a value"
												onclick={() => editValue(key)}
											>
												{values[key] ?? decl.default}
											</button>
										{/if}
										<span class="select-none">{max}</span>
									</div>

									{#if unlockable(key)}
										<label
											class="text-muted-foreground mt-1 flex items-center gap-2 text-xs"
										>
											<input
												type="checkbox"
												class="accent-primary"
												{disabled}
												checked={!!values[
													key + "Unlocked"
												]}
												onchange={(e) =>
													(values[key + "Unlocked"] =
														e.currentTarget.checked)}
											/>
											Unlock max ({decl.max})
										</label>
									{/if}
								</div>
							{:else if decl.type === "boolean"}
								<label class="flex items-center gap-2 text-sm">
									<input
										id="sv-{key}"
										type="checkbox"
										class="accent-primary"
										{disabled}
										checked={!!values[key]}
										onchange={(e) =>
											(values[key] =
												e.currentTarget.checked)}
									/>
									<span class="text-muted-foreground">
										{values[key] ? "On" : "Off"}
									</span>
								</label>
							{:else if decl.type === "string[]"}
								<textarea
									id="sv-{key}"
									class="textarea w-full text-sm"
									rows="3"
									placeholder="One per line"
									{disabled}
									value={asLines(values[key] ?? decl.default)}
									onchange={(e) =>
										(values[key] = e.currentTarget.value
											.split("\n")
											.map((l) => l.trim())
											.filter(Boolean))}
								></textarea>
							{:else if decl.type === "text" && decl.format === "json"}
								<textarea
									id="sv-{key}"
									class="textarea w-full font-mono text-xs"
									rows="4"
									{disabled}
									value={asJson(values[key] ?? decl.default)}
									onchange={(e) =>
										(values[key] = e.currentTarget.value)}
								></textarea>
							{:else if decl.type === "enum"}
								<select
									id="sv-{key}"
									class="select w-full"
									{disabled}
									value={String(values[key] ?? "")}
									onchange={(e) =>
										(values[key] = e.currentTarget.value)}
								>
									{#each decl.of ?? [] as choice}
										<option value={choice}>{choice}</option>
									{/each}
								</select>
							{:else}
								<input
									id="sv-{key}"
									type="text"
									class="input w-full"
									{disabled}
									placeholder={decl.default === undefined
										? "Leave blank for the backend’s own default"
										: String(decl.default)}
									value={String(values[key] ?? "")}
									onchange={(e) =>
										(values[key] = e.currentTarget.value)}
								/>
							{/if}

							{#if describe(decl)}
								<p class="text-muted-foreground mt-1 text-xs">
									{describe(decl)}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</section>
	{/each}
</div>
