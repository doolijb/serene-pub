<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **When a registration runs** — its `when` (PLAN-layering A5, R31;
	 * lane 7, 2026-10-21). Absent, it always runs. A condition is built from
	 * one of the genre's **derived properties** (`sessions:conditionProps`:
	 * its slots and sheets, its settings, the common vocabulary, the host's
	 * facts), each with its type — so the comparison offered is the type's
	 * and an enum offers its members. No free-text paths anywhere: the path
	 * stored is the property's own.
	 *
	 * A stored condition this picker cannot draw (an `all`, an `any`) is shown
	 * as it stands, with Remove.
	 */
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		COMPARISONS_BY_TYPE,
		conditionOf,
		pickedOf,
		propWords,
		type Comparison,
		type Picked
	} from "./presetChanges"

	type Prop = Sockets.Sessions.ConditionProps.Prop

	interface Props {
		/** The registration's key, for the controls' ids. */
		id: string
		props: readonly Prop[]
		when: unknown
		readonly?: boolean
		onchange: (when: Record<string, unknown> | undefined) => void
	}

	let { id, props, when, readonly = false, onchange }: Props = $props()

	const picked = $derived(pickedOf(when, props))
	const unreadable = $derived(!!when && !picked)
	let editing = $state(false)
	const open = $derived(editing || !!picked)

	const domId = $derived(`when-${id.replace(/[^a-z0-9]+/gi, "-")}`)

	function commit(next: Picked) {
		const comparisons = COMPARISONS_BY_TYPE[next.prop.type]
		const comparison = comparisons.some((c) => c.key === next.comparison) ? next.comparison : comparisons[0]!.key
		const needsValue = comparison !== "on" && comparison !== "off"
		const value = needsValue
			? (next.value ?? (next.prop.type === "number" ? 0 : (next.prop.members?.[0] ?? "")))
			: undefined
		onchange(conditionOf({ prop: next.prop, comparison, ...(value !== undefined ? { value } : {}) }))
	}

	function pickProp(path: string) {
		const prop = props.find((p) => p.path === path)
		if (!prop) return
		commit({ prop, comparison: COMPARISONS_BY_TYPE[prop.type][0]!.key })
	}
</script>

<div class="flex flex-col gap-1.5" data-testid="condition-picker">
	{#if unreadable}
		<p class="text-xs">
			Runs when: <code class="font-mono text-meta">{JSON.stringify(when)}</code>
		</p>
		{#if !readonly}
			<button type="button" class="anchor self-start text-xs" onclick={() => onchange(undefined)}>Remove the condition</button>
		{/if}
	{:else if !open}
		{#if !readonly}
			<FieldHelp>
				Runs every time.
				{#if props.length}
					<button type="button" class="anchor" onclick={() => (editing = true)}>Only when…</button>
				{/if}
			</FieldHelp>
		{/if}
	{:else if readonly}
		<p class="text-xs">Only when {picked ? `${propWords(picked.prop.name)} ${COMPARISONS_BY_TYPE[picked.prop.type].find((c) => c.key === picked.comparison)?.label ?? ""} ${picked.value ?? ""}` : ""}</p>
	{:else}
		<div class="flex flex-wrap items-end gap-2">
			<div class="min-w-[12rem] flex-1">
				<Select
					label="Only when"
					options={props.map((p) => ({ value: p.path, label: `${propWords(p.name)} (${p.type})` }))}
					value={picked?.prop.path ?? ""}
					placeholder="Pick what it tests"
					onValueChange={pickProp}
				/>
			</div>
			{#if picked}
				<div class="w-40">
					<Select
						label="Compared"
						labelHidden
						options={COMPARISONS_BY_TYPE[picked.prop.type].map((c) => ({ value: c.key, label: c.label }))}
						value={picked.comparison}
						onValueChange={(v) => commit({ ...picked, comparison: v as Comparison })}
					/>
				</div>
				{#if picked.comparison !== "on" && picked.comparison !== "off"}
					{#if picked.prop.type === "enum" && picked.prop.members?.length}
						<div class="w-40">
							<Select
								label="Value"
								labelHidden
								options={picked.prop.members.map((m) => ({ value: m, label: m }))}
								value={typeof picked.value === "string" ? picked.value : ""}
								onValueChange={(v) => commit({ ...picked, value: v })}
							/>
						</div>
					{:else}
						<label class="flex flex-col gap-1 text-xs" for="{domId}-value">
							<span class="sr-only">Value</span>
							<input
								id="{domId}-value"
								class="input w-32 rounded-base"
								type={picked.prop.type === "number" ? "number" : "text"}
								value={picked.value ?? ""}
								onchange={(e) =>
									commit({
										...picked,
										value: picked.prop.type === "number" ? e.currentTarget.valueAsNumber : e.currentTarget.value
									})}
							/>
						</label>
					{/if}
				{/if}
			{/if}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => {
					editing = false
					onchange(undefined)
				}}
			>
				Always run
			</button>
		</div>
	{/if}
</div>
