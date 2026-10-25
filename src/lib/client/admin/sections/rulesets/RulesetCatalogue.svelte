<script lang="ts">
	/**
	 * 🚧 The **catalogue** drawer of Functions (PLAN-rulesets-functions D1,
	 * D8; lane A4, 2026-10-23): every function the ruleset may use — core's,
	 * packages', and the modules this pub's other rulesets carry — grouped by
	 * kind, filtered by a word. Picking one adds a reference to it (bound
	 * and set on its row); one from another ruleset is forked in, since
	 * nothing else registers it. A function already in use is marked.
	 */
	import { i18nText } from "@serene-pub/sdk"
	import { catalogueGroups } from "./rulesetWords"

	type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]

	interface Props {
		choices: readonly FunctionChoice[]
		/** The function ids the ruleset already references. */
		used: ReadonlySet<string>
		readonly?: boolean
		onAdd: (choice: FunctionChoice) => void
	}
	let { choices, used, readonly = false, onAdd }: Props = $props()

	let query = $state("")
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase()
		if (!q) return choices
		return choices.filter((c) => `${c.name} ${c.meaning} ${c.source} ${i18nText(c.decl.prose as never) ?? ""}`.toLowerCase().includes(q))
	})
	const groups = $derived(catalogueGroups(shown))
	const packages = $derived(new Set(choices.filter((c) => c.from === "package").map((c) => c.source)).size)
	const mine = $derived(new Set(choices.filter((c) => c.from === "ruleset").map((c) => c.source)).size)
	const summary = $derived(
		["core", packages ? `${packages} package${packages === 1 ? "" : "s"}` : "", mine ? `your ${mine} other ruleset${mine === 1 ? "" : "s"}` : ""]
			.filter(Boolean)
			.join(" · ")
	)
</script>

<aside aria-labelledby="catalogue-heading" class="panel-card flex min-w-0 flex-col gap-2.5" data-catalogue>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h2 id="catalogue-heading" class="text-sm font-medium">Catalogue</h2>
		<span class="text-surface-600-400 text-xs">{summary}</span>
	</div>
	<label class="text-surface-600-400 flex flex-col gap-1 text-xs">
		Find a function
		<input class="input" type="search" bind:value={query} placeholder="e.g. deadline, draw, level" data-catalogue-search />
	</label>
	{#each groups as g (g.group)}
		<div class="flex flex-col gap-1">
			<h3 class="text-surface-600-400 text-xs font-medium tracking-wide uppercase">{g.group}</h3>
			<ul class="flex flex-wrap gap-1.5">
				{#each g.choices as c (c.id)}
					{@const on = used.has(c.id)}
					<li>
						<button
							type="button"
							class="min-h-8 rounded-full border px-2.5 py-0.5 text-left text-sm {on
								? 'border-primary-500 text-primary-ink'
								: c.from === 'ruleset'
									? 'border-surface-300-700 border-dashed'
									: 'border-surface-200-800'} hover:bg-surface-200-800"
							title={c.meaning}
							disabled={readonly}
							aria-describedby="catalogue-meaning-{c.id.replace(/[^a-z0-9]/gi, '-')}"
							onclick={() => onAdd(c)}
							data-catalogue-choice={c.id}
						>
							{c.from === "ruleset" ? `${c.source} · ${c.name}` : c.name}{on ? " ✓" : ""}
						</button>
						<span id="catalogue-meaning-{c.id.replace(/[^a-z0-9]/gi, '-')}" class="sr-only">{c.meaning}{on ? " Already in use." : ""}</span>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="text-surface-600-400 text-sm">Nothing matches “{query}”.</p>
	{/each}
	<p class="border-surface-200-800 text-surface-600-400 border-t pt-2 text-xs">
		Pick one, bind it to your attributes, done. Open its body only if you want to change how it works. Every function here is a script you can read.
	</p>
</aside>
