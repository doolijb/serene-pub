<script lang="ts">
	/**
	 * 🚧 One setting the start form asks under the chosen preset (R32, A10;
	 * lane 7, 2026-10-21): a genre field the preset — or the genre's
	 * defaults — marks `askAtStart`, or one fixed at start and open to the
	 * owner. A fixed one says so: it cannot change once the session exists.
	 * The answer is held in the flow's genre fields and sent with Start.
	 */
	type StartAsk = Sockets.SessionAdmin.StartAsk

	interface Props {
		ask: StartAsk
		value: unknown
		onchange: (value: unknown) => void
	}

	let { ask, value, onchange }: Props = $props()

	const id = $derived(`start-ask-${ask.key.replace(/[^a-z0-9]+/gi, "-")}`)
	const shown = $derived(value === undefined ? ask.value : value)
	const ticked = $derived(new Set(Array.isArray(shown) ? shown.map(String) : []))

	function toggle(key: string, on: boolean) {
		const next = new Set(ticked)
		if (on) next.add(key)
		else next.delete(key)
		onchange((ask.members ?? []).map((m) => m.key).filter((k) => next.has(k)))
	}
</script>

<div class="flex flex-col gap-1" data-start-ask={ask.key}>
	{#if ask.control === "boolean"}
		<label class="flex min-h-11 items-center gap-2 text-sm pointer-fine:min-h-0" for={id}>
			<input
				{id}
				type="checkbox"
				role="switch"
				class="checkbox"
				checked={shown === true}
				aria-describedby="{id}-help"
				onchange={(e) => onchange(e.currentTarget.checked)}
			/>
			<span>{ask.label}</span>
		</label>
	{:else if ask.control === "enum"}
		<fieldset class="flex flex-col gap-1" aria-describedby="{id}-help">
			<legend class="text-surface-600-400 mb-1 text-xs">{ask.label}</legend>
			<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={ask.label}>
				{#each ask.members ?? [] as m (m.key)}
					{@const selected = shown === m.key}
					<button
						type="button"
						role="radio"
						aria-checked={selected}
						title={m.description}
						class="btn btn-sm min-h-11 {selected ? 'preset-pressed' : 'preset-tonal-surface'}"
						onclick={() => onchange(m.key)}
					>
						{m.label}
					</button>
				{/each}
			</div>
		</fieldset>
	{:else if ask.control === "integer" || ask.control === "number"}
		<label class="flex flex-col gap-1 text-xs" for={id}>
			<span class="text-surface-600-400">{ask.label}</span>
			<input
				{id}
				class="input w-32 rounded-base"
				type="number"
				step={ask.control === "integer" ? "1" : "any"}
				min={ask.min}
				max={ask.max}
				value={typeof shown === "number" ? shown : ""}
				aria-describedby="{id}-help"
				onchange={(e) => {
					const n = e.currentTarget.valueAsNumber
					onchange(Number.isNaN(n) ? ask.value : n)
				}}
			/>
		</label>
	{:else if ask.control === "list" && ask.members?.length}
		<fieldset class="flex flex-col gap-1" aria-describedby="{id}-help">
			<legend class="text-surface-600-400 mb-1 text-xs">{ask.label}</legend>
			{#each ask.members as m (m.key)}
				<label class="flex min-h-11 items-center gap-2 text-sm pointer-fine:min-h-0">
					<input
						type="checkbox"
						class="checkbox"
						checked={ticked.has(m.key)}
						onchange={(e) => toggle(m.key, e.currentTarget.checked)}
					/>
					<span>{m.label}</span>
				</label>
			{/each}
		</fieldset>
	{:else}
		<label class="flex flex-col gap-1 text-xs" for={id}>
			<span class="text-surface-600-400">{ask.label}</span>
			{#if ask.control === "text"}
				<textarea
					{id}
					class="textarea rounded-base"
					rows={3}
					value={typeof shown === "string" ? shown : ""}
					aria-describedby="{id}-help"
					onchange={(e) => onchange(e.currentTarget.value)}
				></textarea>
			{:else}
				<input
					{id}
					class="input rounded-base"
					type="text"
					value={typeof shown === "string" ? shown : ""}
					aria-describedby="{id}-help"
					onchange={(e) => onchange(e.currentTarget.value)}
				/>
			{/if}
		</label>
	{/if}
	<p id="{id}-help" class="text-surface-600-400 text-xs">
		{#if ask.description}{ask.description}{/if}
		{#if ask.fixed}
			<span data-testid="start-ask-fixed">Can't be changed after the session starts.</span>
		{/if}
	</p>
</div>
