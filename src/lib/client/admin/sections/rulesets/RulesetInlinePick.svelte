<script lang="ts">
	/**
	 * 🚧 An inline pick (lane A4, 2026-10-23): a word in a sentence or a cell
	 * of an attribute row that opens a small list to choose from — a
	 * function's binding (_Nerve_), who carries an attribute (_Each
	 * character_), who sees it. One choice, or several (`many`). A listbox of
	 * option buttons under the word; Escape or a click outside closes it and
	 * gives focus back to the word.
	 */
	interface Choice {
		value: string
		label: string
		hint?: string
	}
	interface Props {
		/** What is being picked, for assistive tech: _Who sees Affection_. */
		label: string
		choices: readonly Choice[]
		value: string | readonly string[]
		many?: boolean
		/** Shown when nothing is picked. */
		placeholder?: string
		/** The words the button shows; the picked labels when left out. */
		text?: string
		readonly?: boolean
		/** `inline` sits in a sentence; `field` fills a cell. */
		look?: "inline" | "field"
		onchange: (value: string | string[]) => void
		id?: string
		/**
		 * 🚧 Why some are not offered (RF fix 6, pickers explain why): said
		 * under the list, and in its place when nothing is offered.
		 */
		note?: string
	}
	let { label, choices, value, many = false, placeholder = "Pick…", text, readonly = false, look = "inline", onchange, id, note }: Props = $props()

	let open = $state(false)
	let root = $state<HTMLSpanElement | null>(null)
	let trigger = $state<HTMLButtonElement | null>(null)
	const picked = $derived(Array.isArray(value) ? (value as string[]) : value ? [value as string] : [])
	const shown = $derived(
		text ??
			(picked.length
				? picked.map((v) => choices.find((c) => c.value === v)?.label ?? v).join(", ")
				: (choices.find((c) => c.value === "")?.label ?? placeholder))
	)
	const listId = $derived(`${id ?? "pick"}-list`)

	function pick(v: string) {
		if (many) onchange(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v])
		else {
			onchange(v)
			close()
		}
	}
	function close() {
		open = false
		trigger?.focus()
	}
	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.stopPropagation()
			close()
		}
	}
</script>

<svelte:window onclick={onWindowClick} />

<span class="relative {look === 'field' ? 'flex w-full' : 'inline-block'}" bind:this={root} data-inline-pick={label}>
	{#if readonly}
		<span class={look === "field" ? "border-surface-200-800 bg-surface-100-900 flex min-h-10 w-full items-center rounded-base border px-3 text-sm" : "font-medium"}>
			{shown}
		</span>
	{:else}
		<button
			{id}
			type="button"
			bind:this={trigger}
			class={look === "field"
				? "border-surface-200-800 bg-surface-50-950 hover:border-primary-500 flex min-h-10 w-full items-center rounded-base border px-3 text-left text-sm"
				: "border-surface-200-800 bg-surface-50-950 hover:border-primary-500 mx-0.5 inline-flex min-h-8 items-center rounded-md border px-2 align-baseline"}
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-controls={open ? listId : undefined}
			aria-label="{label}: {shown}"
			onclick={() => (open = !open)}
		>
			{shown}
		</button>
	{/if}
	{#if open}
		<div
			id={listId}
			role="listbox"
			tabindex="-1"
			aria-label={label}
			aria-multiselectable={many || undefined}
			class="panel-card absolute top-full left-0 z-30 mt-1 flex max-h-72 min-w-56 flex-col gap-0.5 overflow-auto p-1 text-sm shadow-lg"
			onkeydown={onKey}
		>
			{#each choices as c (c.value)}
				{@const on = picked.includes(c.value) || (!picked.length && c.value === "" && !many)}
				<button
					type="button"
					role="option"
					aria-selected={on}
					class="hover:bg-surface-200-800 flex min-h-10 flex-col items-start rounded-md px-2 py-1 text-left {on ? 'bg-primary-500/10' : ''}"
					onclick={() => pick(c.value)}
					data-pick={c.value}
				>
					<span>{many ? (on ? "✓ " : "") : ""}{c.label}</span>
					{#if c.hint}<span class="text-surface-600-400 text-xs">{c.hint}</span>{/if}
				</button>
			{:else}
				{#if !note}<p class="text-surface-600-400 px-2 py-1 text-xs">Nothing to pick yet.</p>{/if}
			{/each}
			{#if note}
				<p class="text-surface-600-400 border-surface-200-800 max-w-72 px-2 py-1 text-xs {choices.length ? 'mt-0.5 border-t' : ''}" data-pick-note>{note}</p>
			{/if}
		</div>
	{/if}
</span>
