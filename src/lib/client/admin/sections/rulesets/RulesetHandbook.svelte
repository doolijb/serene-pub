<script lang="ts">
	/**
	 * 🚧 The **Handbook** (PLAN-rulesets-functions D8, lane A4, 2026-10-23): a
	 * page players read, built from the draft's own sentences
	 * (`handbookPages`, the same pages the handbook generator makes), with the
	 * author's pages beside them (`handbook: [{ title, body }]` in the draft).
	 * Editing a generated page makes it the author's own (same title, so it
	 * takes the generated page's place); **Add a page** writes a new one.
	 * **Open as players see it** reads the pages without the editing.
	 *
	 * Every edit waits for the page's Save.
	 */
	import * as Icons from "@lucide/svelte"
	import { newRowUid, type SectionsForm } from "./rulesetSectionsForm"
	import { handbookPages } from "./rulesetWords"

	type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]
	type SlotChoice = Sockets.Rulesets.DetailRow["slotChoices"][number]

	interface Props {
		form: SectionsForm
		slotChoices: readonly SlotChoice[]
		choices: readonly FunctionChoice[]
		readonly?: boolean
	}
	let { form = $bindable(), slotChoices, choices, readonly = false }: Props = $props()

	const pages = $derived(handbookPages(form, { slots: slotChoices, choices }))
	let current = $state<string | null>(null)
	let reading = $state(false)
	const page = $derived(pages.find((p) => p.id === current) ?? pages[0] ?? null)
	const own = $derived(page ? form.handbook.find((h) => h.title.trim() === page.title) : undefined)

	/** Make the page on screen the author's own (a generated one copied), then edit it. */
	function edit() {
		if (!page || own) return
		form.handbook = [...form.handbook, { uid: newRowUid(), title: page.title, body: page.body }]
	}
	function addPage() {
		const title = freeTitle("A note from the author")
		form.handbook = [...form.handbook, { uid: newRowUid(), title, body: "" }]
		current = slugOf(title)
	}
	const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
	function freeTitle(base: string) {
		const taken = new Set(pages.map((p) => p.title))
		if (!taken.has(base)) return base
		for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`
	}
	function removeOwn() {
		if (!own) return
		form.handbook = form.handbook.filter((h) => h.uid !== own.uid)
	}
	/** **Bold** and paragraphs, as the generated pages are written. */
	const paragraphs = (body: string) => body.split(/\n{2,}/).map((p) => p.split(/(\*\*[^*]+\*\*)/g))
</script>

<section class="flex min-w-0 flex-col gap-3" aria-labelledby="handbook-heading" id="handbook" data-handbook>
	<div class="flex flex-wrap items-baseline gap-x-4 gap-y-2">
		<h2 id="handbook-heading" class="text-base font-medium">Handbook</h2>
		<p class="text-surface-600-400 flex-1 text-sm">A page players read. Built from your sentences; add pages of your own beside it.</p>
		<div class="flex flex-wrap gap-2">
			{#if !readonly && !reading}
				<button type="button" class="btn btn-sm preset-tonal-primary" onclick={addPage} data-add-page>
					<Icons.Plus size={14} aria-hidden="true" /> Add a page
				</button>
			{/if}
			<button type="button" class="btn btn-sm preset-tonal-surface" aria-pressed={reading} onclick={() => (reading = !reading)} data-handbook-read>
				<Icons.BookOpen size={14} aria-hidden="true" /> {reading ? "Back to editing" : "Open as players see it"}
			</button>
		</div>
	</div>
	{#if !pages.length}
		<p class="panel-card text-surface-600-400 text-sm">Nothing to say yet: the handbook is written from your attributes, functions and entry types.</p>
	{:else}
		<div class="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
			<nav aria-label="Handbook pages" class="panel-card flex flex-col gap-0.5 p-2">
				{#each pages as p (p.id)}
					<button
						type="button"
						class="flex min-h-10 items-center justify-between gap-2 rounded-md px-3 text-left text-sm {page?.id === p.id ? 'bg-primary-500/10 font-medium' : 'hover:bg-surface-200-800'}"
						aria-current={page?.id === p.id ? "page" : undefined}
						onclick={() => (current = p.id)}
						data-handbook-page={p.id}
					>
						<span>{p.title}</span>
						{#if !reading}<span class="text-surface-600-400 text-xs">{p.source === "generated" ? "generated" : "yours"}</span>{/if}
					</button>
				{/each}
			</nav>
			{#if page}
				<article class="panel-card flex min-w-0 flex-col gap-2" data-handbook-article={page.id}>
					{#if own && !readonly && !reading}
						<label class="text-surface-600-400 flex flex-col gap-1 text-xs">
							Title
							<input
								class="input"
								type="text"
								value={own.title}
								oninput={(e) => {
									own.title = e.currentTarget.value
									current = slugOf(e.currentTarget.value)
								}}
							/>
						</label>
						<label class="text-surface-600-400 flex flex-col gap-1 text-xs">
							The page
							<textarea class="textarea" rows={10} bind:value={own.body} placeholder="What players should know, in your words."></textarea>
						</label>
						<button type="button" class="btn btn-sm preset-tonal-error self-start" onclick={removeOwn}>
							<Icons.Trash2 size={14} aria-hidden="true" /> Remove your page
						</button>
					{:else}
						<h3 class="text-lg font-medium">{page.title}</h3>
						{#each paragraphs(page.body) as para, i (i)}
							<p class="text-sm leading-relaxed">
								{#each para as bit, j (j)}{#if bit.startsWith("**") && bit.endsWith("**")}<strong>{bit.slice(2, -2)}</strong>{:else}{bit}{/if}{/each}
							</p>
						{/each}
						{#if !reading && !readonly}
							<p class="text-surface-600-400 flex flex-wrap items-center gap-2 text-xs">
								Generated from your attributes and functions; edits here become your own page.
								<button type="button" class="btn btn-sm preset-tonal-surface" onclick={edit} data-handbook-edit>
									<Icons.Pencil size={14} aria-hidden="true" /> Edit this page
								</button>
							</p>
						{/if}
					{/if}
				</article>
			{/if}
		</div>
	{/if}
</section>
