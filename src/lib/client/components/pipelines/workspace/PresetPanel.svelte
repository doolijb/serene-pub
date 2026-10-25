<script lang="ts">
	/**
	 * **Where it runs** (admin IA 2026-08-28; 🚧 PLAN-layering §4, R2, R38,
	 * lane 7, 2026-10-21) — read-only, on purpose: the genres whose defaults
	 * register this pipeline, and the presets that add it, drop it or change
	 * it, each with what it runs on. Changing a registration happens on the
	 * preset's own page (or, for a genre's defaults, the genre's); this answers
	 * the reverse question — "who runs this pipeline, and when?" — with a link
	 * out along each edge. Named configurations are retired (R38).
	 */
	import * as Icons from "@lucide/svelte"
	import { eventDisplayName } from "$lib/client/utils/eventName"
	import { cadenceWords } from "$lib/shared/routines/cadenceWords"

	type Place = Sockets.Pipelines.RegisteredIn.Place

	interface Props {
		slug: string
		places: Place[]
	}

	let { places }: Props = $props()

	/** What a registration runs on, in words. */
	function triggerWords(p: Place): string {
		const t = p.trigger as { family?: string; event?: string; action?: string; cadence?: { id: string; options?: Record<string, unknown> } }
		if (t.family === "event" && t.event) return `On ${eventDisplayName(t.event).toLowerCase()}`
		if (t.family === "action" && t.action) return `Action ${t.action.slice(t.action.lastIndexOf("#") + 1)}`
		if (t.family === "routine" && t.cadence) return `Routine · ${cadenceWords(t.cadence, { eventName: eventDisplayName })}`
		return "Changed"
	}

	const genres = $derived(places.filter((p) => p.scope === "genre"))
	const presets = $derived(places.filter((p) => p.scope === "preset"))
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="where-it-runs-heading" data-testid="where-it-runs">
	<div>
		<h3 id="where-it-runs-heading" class="text-sm font-semibold">Where it runs</h3>
		<p class="text-surface-600-400 text-xs">
			The genres whose defaults register this pipeline, and the presets that add, drop or change it. Change one on the
			preset's own page.
		</p>
	</div>

	{#if !places.length}
		<p class="text-surface-600-400 text-sm italic">
			Nothing registers this pipeline yet.
			<a class="underline" href="/admin/session-presets">Manage presets</a>.
		</p>
	{:else}
		{#if genres.length}
			<div class="flex flex-col gap-1.5">
				<p class="text-surface-600-400 text-xs font-medium">The genre's defaults</p>
				<ul class="flex flex-col gap-1.5">
					{#each genres as g (g.genreId + g.key)}
						<li class="border-surface-200-800 flex flex-wrap items-center gap-2 rounded-md border p-2.5">
							<a class="min-w-0 font-semibold hover:underline" href="/admin/session-genres/{encodeURIComponent(g.genreId)}">
								{g.genreName}
							</a>
							<span class="flex-1"></span>
							<span class="preset-tonal-surface rounded px-1.5 py-0.5 text-meta" title={g.key}>{triggerWords(g)}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if presets.length}
			<div class="flex flex-col gap-1.5">
				<p class="text-surface-600-400 text-xs font-medium">Presets</p>
				<ul class="flex flex-col gap-1.5">
					{#each presets as p (String(p.presetId) + p.key)}
						<li class="border-surface-200-800 flex flex-wrap items-center gap-2 rounded-md border p-2.5">
							<a class="min-w-0 font-semibold hover:underline" href="/admin/session-presets/{p.presetId}">
								{p.presetName}
							</a>
							<span class="text-surface-600-400 text-xs">{p.genreName}</span>
							<span class="flex-1"></span>
							<span class="preset-tonal-surface rounded px-1.5 py-0.5 text-meta" title={p.key}>
								{p.dropped ? "Dropped" : triggerWords(p)}
							</span>
							<a class="btn btn-sm preset-tonal-surface" href="/admin/session-presets/{p.presetId}">
								<Icons.Pencil size={12} aria-hidden="true" /> Edit
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</section>
