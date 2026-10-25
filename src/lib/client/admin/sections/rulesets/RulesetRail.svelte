<script lang="ts">
	/**
	 * 🚧 The editor's **rail** (PLAN-rulesets-functions D8, lane A4,
	 * 2026-10-23): the seven sections with what each holds — a count, or
	 * _defaults_ where the host's still hold — then the **Document**, then a
	 * note saying whether the draft is playable as it stands (R6: attributes
	 * with their sentences are a complete ruleset; everything else is
	 * optional). One section on screen at a time; its address is `?view=`.
	 */
	import { SECTION_VIEWS, type ViewId } from "./rulesetWords"

	interface Props {
		current: ViewId
		counts: Record<string, string>
		note: { tone: "success" | "muted" | "warning"; strong: string; text: string }
		onPick: (id: ViewId) => void
		/** 🚧 RF fix 2, item 8: where "N problems before publish" leads (Check and publish). */
		onProblems?: () => void
	}
	let { current, counts, note, onPick, onProblems }: Props = $props()
</script>

<nav aria-label="Sections" class="panel-card flex min-w-0 flex-col gap-1 p-2" data-rail>
	<ul class="flex flex-col gap-0.5">
		{#each SECTION_VIEWS as s (s.id)}
			{@const on = current === s.id}
			<li>
				<button
					type="button"
					class="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm {on
						? 'bg-primary-500/10 font-medium'
						: 'hover:bg-surface-200-800'}"
					aria-current={on ? "page" : undefined}
					onclick={() => onPick(s.id)}
					data-rail-item={s.id}
				>
					<span>{s.label}</span>
					<span class="text-xs tabular-nums {on ? 'text-primary-ink' : 'text-surface-600-400'}" data-rail-count={s.id}>{counts[s.id] ?? ""}</span>
				</button>
			</li>
		{/each}
	</ul>
	<div class="border-surface-200-800 mx-1 my-1 border-t"></div>
	<button
		type="button"
		class="flex min-h-10 items-center rounded-md px-3 text-left text-sm {current === 'document' ? 'bg-primary-500/10 font-medium' : 'text-surface-600-400 hover:bg-surface-200-800'}"
		aria-current={current === "document" ? "page" : undefined}
		onclick={() => onPick("document")}
		data-rail-item="document"
	>
		Document
	</button>
	<p
		class="mx-1 mt-1 rounded-md px-3 py-2 text-xs {note.tone === 'success'
			? 'bg-success-500/10 text-success-700-300'
			: note.tone === 'warning'
				? 'bg-warning-500/10 text-warning-700-300'
				: 'bg-surface-200-800 text-surface-950-50'}"
		data-playable={note.tone}
	>
		<strong>{note.strong}</strong>
		{note.text}
		{#if note.tone === "warning" && onProblems}
			<button type="button" class="mt-1 block min-h-8 font-medium underline underline-offset-2" onclick={() => onProblems?.()} data-rail-problems>See them all</button>
		{/if}
	</p>
</nav>
