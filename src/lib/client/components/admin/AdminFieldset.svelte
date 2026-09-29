<script lang="ts">
	/**
	 * One titled group of a change form (Django's `fieldsets`): a
	 * `panel-card` with a 14px heading, an optional sentence under it, then
	 * its fields 16px apart. `collapsible` makes it a disclosure — Django's
	 * `classes: ("collapse",)` — closed by default, for "Advanced".
	 *
	 * A `<section>` named by its heading rather than a `<fieldset>`: a
	 * group here holds whole components (a model table, a runtime's
	 * settings), not only inputs, and a legend cannot carry the `aside`.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		title: string
		/** One sentence under the title, in the reader's words. */
		description?: string
		/** A disclosure, closed unless `open`. */
		collapsible?: boolean
		open?: boolean
		/** Anchor for "jump to" links and the error summary. */
		id?: string
		/** Right of the title: a Refresh, a count. */
		aside?: Snippet
		children: Snippet
	}
	let {
		title,
		description,
		collapsible = false,
		open = false,
		id,
		aside,
		children
	}: Props = $props()

	const uid = $props.id()
</script>

{#if collapsible}
	<details class="panel-card group flex flex-col" {id} {open}>
		<summary
			class="-m-1 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] p-1 focus-visible:outline-2 focus-visible:outline-primary-500"
		>
			<Icons.ChevronRight
				size={16}
				class="text-surface-500 shrink-0 transition-transform group-open:rotate-90"
				aria-hidden="true"
			/>
			<span class="min-w-0 flex-1">
				<span class="text-surface-950-50 block text-sm font-medium">
					{title}
				</span>
				{#if description}
					<span class="text-surface-600-400 block text-xs">
						{description}
					</span>
				{/if}
			</span>
			{@render aside?.()}
		</summary>
		<div class="mt-4 flex flex-col gap-4">
			{@render children()}
		</div>
	</details>
{:else}
	<section
		class="panel-card flex min-w-0 flex-col gap-4"
		{id}
		aria-labelledby="{uid}-title"
	>
		<div class="flex min-w-0 items-start gap-2">
			<div class="min-w-0 flex-1">
				<h2 id="{uid}-title" class="text-surface-950-50 text-sm font-medium">
					{title}
				</h2>
				{#if description}
					<p class="text-surface-600-400 mt-0.5 text-xs">
						{description}
					</p>
				{/if}
			</div>
			{@render aside?.()}
		</div>
		{@render children()}
	</section>
{/if}
