<script lang="ts">
	/**
	 * The sampling parameter editor, driven entirely by the shape's declared
	 * vocabulary (SDK `SAMPLING_SCHEMAS`): a parameter that exists is a
	 * parameter you can set, and adding one is one declaration in one file.
	 *
	 * Two modes. By default it draws the SENT parameters and nothing else,
	 * because the form is read while tuning a number and a checkbox in front
	 * of every label is a checklist to scroll past. With `choose` on it draws
	 * EVERY parameter of the shape, each with a checkbox; one switched off is
	 * dimmed and reads "not sent" in place of its value. Switching one on
	 * materialises its declared default (`defaultOnEnable`). Either way the
	 * edits are the caller's draft: nothing is saved here.
	 *
	 * It is a sibling of `pipelines/SchemaForm.svelte`, not a use of it: same
	 * declaration language, different controls. A sampler wants a slider you can
	 * click to type into and a note when the chosen backend will not honour it —
	 * neither of which belongs in the renderer that draws plugin settings and
	 * review forms.
	 */

	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"
	import type { SettingsSchema, FieldDecl } from "@serene-pub/sdk"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import { getSupportedSamplers } from "$lib/shared/utils/samplerMappings"
	import {
		countEnabledByGroup,
		defaultOnEnable,
		groupSamplingFields,
		nextEnabled
	} from "./samplingFields"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import LogitBiasField from "./LogitBiasField.svelte"
	import { enumOptions } from "$lib/shared/i18n/enumOptions"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"

	interface Props {
		schema: SettingsSchema
		/** The row's `values`. Bound: edits land here directly. */
		values: Record<string, unknown>
		/**
		 * The row's `enabled`: which fields are drawn, and, while `choose` is
		 * on, what the checkboxes edit. Bind it where `choose` can be on.
		 */
		enabled: string[]
		/**
		 * Draw every parameter of the shape with a checkbox that decides
		 * whether it is sent (the Sampling view's Choose parameters).
		 */
		choose?: boolean
		/** Immutable rows are readable but not editable. */
		disabled?: boolean
		/**
		 * The connection type a reader is most likely to run this against, used
		 * only to note which parameters it will ignore. Advisory: a config
		 * outlives the connection it happens to be paired with, so an unhonoured
		 * parameter is worth saying and never worth blocking.
		 */
		connectionType?: string | null
		/**
		 * Keys the pair this config runs against drops — an image pair's
		 * drawing sheet (`samplingKeysSheetDrops`). Greyed and marked, never
		 * disabled, for the same reason as `connectionType`.
		 */
		unhonoured?: readonly string[] | null
		/**
		 * Draw each group's small heading. Off where the caller already
		 * frames every group itself (Admin → Sampling's one fieldset per
		 * group), so the group is not named twice.
		 */
		groupHeadings?: boolean
	}

	let {
		schema,
		values = $bindable(),
		enabled = $bindable(),
		choose = false,
		disabled = false,
		connectionType = null,
		unhonoured = null,
		groupHeadings = true
	}: Props = $props()

	const dropped = $derived(new Set(unhonoured ?? []))

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
		return i18nTextIn(decl.label) ?? key
	}
	const describe = (decl: FieldDecl): string => {
		return i18nTextIn(decl.description) ?? ""
	}

	/**
	 * Choosing: every field. Otherwise only the enabled fields, and only the
	 * groups that still have one — `groupSamplingFields` drops the empties, so
	 * the seeded "Disabled" config draws no bare headers.
	 */
	const groups = $derived(
		choose
			? groupSamplingFields(schema)
			: groupSamplingFields(schema, (key) => enabled.includes(key))
	)
	/** "4 of 6 sent" per group, for its label, in both modes. */
	const groupCounts = $derived(countEnabledByGroup(schema, enabled))

	function toggle(key: string, on: boolean) {
		if (disabled) return
		// Reassigned, never mutated: an in-place push/splice on the bound
		// array would not re-run the `$derived` that filters the fields.
		enabled = nextEnabled(enabled, key, on)
		if (on) {
			const seed = defaultOnEnable(schema, values, key)
			if (seed !== undefined) values[key] = seed
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
	{#if !groups.length}
		<!-- Not an error state. "Disabled" is a shipped config whose point is
		     that it sends nothing, so every request goes out with the
		     backend's own defaults. -->
		<p class="text-surface-600-400 py-6 text-center text-sm">
			{choose
				? "This configuration’s shape declares no parameters."
				: "No parameters are sent, so requests go out with the backend’s own defaults."}
		</p>
	{/if}

	{#each groups as g (g.group)}
		{@const count = groupCounts.get(g.group)}
		<section class="flex flex-col gap-2">
			{#if groupHeadings}
				<!-- The shared group label (STYLE-GUIDE §6.4), no rule, with
				     how many of the group's parameters are sent at its right
				     edge (11px, polish parity L5). Its row inset is dropped:
				     the fields under it are flush. -->
				<ListGroupLabel
					label={g.group}
					trailing={count
						? `${count.on} of ${count.total} sent`
						: undefined}
					class="justify-between px-0!"
				/>
			{/if}

			{#each g.fields as { key, decl } (key)}
				{@const ignored =
					(supported && !supported.has(key)) || dropped.has(key)}
				{@const on = enabled.includes(key)}
				{@const offered = choose && !on}
				<div
					class={[
						"flex flex-col gap-1",
						(offered || (on && dropped.has(key))) && "opacity-60"
					]}
					data-sampling-param={key}
				>
					<div class="flex min-w-0 items-center gap-2">
						{#if choose}
							<!-- Its own name, because the label below names the
							     value's control once the parameter is sent. -->
							<input
								id="sv-{key}-on"
								type="checkbox"
								class="accent-primary shrink-0"
								checked={on}
								{disabled}
								aria-label="Send {label(decl, key)}"
								onchange={(e) =>
									toggle(key, e.currentTarget.checked)}
							/>
						{/if}
						<!-- The "not sent to this backend" note sits on the
						     LABEL because it is a statement about the value
						     being sent, not about the control: the field is on
						     and edited normally, the chosen backend simply has
						     no mapping for it. -->
						<!-- No `for` on an enum: the Select labels its own
						     input. None on a logit bias list either: it is a
						     group of rows, named by this label's id. A parameter
						     that is not sent has no control, so its label is
						     its checkbox's. -->
						<!-- The parameter's hint is the label's title (polish
						     parity L5): one line per slider, not two; a screen
						     reader hears it through the control's describedby. -->
						<label
							id="sv-{key}-label"
							class="min-w-0 text-sm font-semibold"
							title={describe(decl) || undefined}
							for={offered
								? `sv-${key}-on`
								: decl.type === "enum" ||
									  decl.format === "logit-bias"
									? undefined
									: `sv-${key}`}
						>
							{label(decl, key)}
							{#if ignored && !offered}
								<span
									class="text-warning-600 dark:text-warning-400 ml-1 inline-flex items-center gap-1 text-xs font-normal"
									title={dropped.has(key)
										? "The model set for images ignores this parameter, so it will be left out of the request."
										: "This connection type has no mapping for this parameter, so it will be left out of the request."}
								>
									<Icons.TriangleAlert size={11} />
									not sent to this backend
								</span>
							{/if}
						</label>
					</div>

					{#if offered}
						<p class="text-surface-600-400 text-xs">not sent</p>
					{:else}
						<div>
							{#if decl.type === "number" || decl.type === "integer"}
								{@const max = maxFor(key, decl)}
								{@const min = decl.min ?? 0}
								<div class="flex flex-col gap-1">
									<input
										type="range"
										id="sv-{key}"
										aria-describedby={describe(decl)
											? `sv-${key}-hint`
											: undefined}
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
										class="text-surface-600-400 flex w-full items-center justify-between gap-1 text-xs"
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
											class="text-surface-600-400 mt-1 flex items-center gap-2 text-xs"
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
										aria-describedby={describe(decl)
											? `sv-${key}-hint`
											: undefined}
										class="accent-primary"
										{disabled}
										checked={!!values[key]}
										onchange={(e) =>
											(values[key] =
												e.currentTarget.checked)}
									/>
									<span class="text-surface-600-400">
										{values[key] ? "On" : "Off"}
									</span>
								</label>
							{:else if decl.type === "string[]"}
								<textarea
									id="sv-{key}"
									aria-describedby={describe(decl)
										? `sv-${key}-hint`
										: undefined}
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
							{:else if decl.format === "logit-bias"}
								<LogitBiasField
									bind:value={values[key]}
									declaredDefault={decl.default}
									labelledby="sv-{key}-label"
									{disabled}
								/>
							{:else if decl.type === "text" && decl.format === "json"}
								<textarea
									id="sv-{key}"
									aria-describedby={describe(decl)
										? `sv-${key}-hint`
										: undefined}
									class="textarea w-full font-mono text-xs"
									rows="4"
									{disabled}
									value={asJson(values[key] ?? decl.default)}
									onchange={(e) =>
										(values[key] = e.currentTarget.value)}
								></textarea>
							{:else if decl.type === "enum"}
								<!-- The visible label above names this field; the
							     combobox carries its own, visually hidden. -->
								<Select
									label={label(decl, key)}
									labelHidden
									class="w-full"
									{disabled}
									options={enumOptions(decl)}
									value={String(values[key] ?? "")}
									onValueChange={(v) => (values[key] = v)}
								/>
							{:else}
								<input
									id="sv-{key}"
									type="text"
									aria-describedby={describe(decl)
										? `sv-${key}-hint`
										: undefined}
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
								<p id="sv-{key}-hint" class="sr-only">
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
