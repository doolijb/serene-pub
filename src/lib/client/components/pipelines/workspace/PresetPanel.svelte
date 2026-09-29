<script lang="ts">
	/**
	 * Where this pipeline is used (admin IA 2026-08-28) — read-only, on
	 * purpose. Session presets own the decisions that used to live here
	 * (which actions come along, whether a bundle may be chosen): a preset is
	 * the thing that binds a genre's event slots to pipelines and configs,
	 * and editing it happens on its own page. This tab answers the reverse
	 * question — "which presets reach for this pipeline?" — with a link out
	 * along each edge.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { eventDisplayName } from "$lib/client/utils/eventName"

	interface Props {
		slug: string
		detail: Sockets.Pipelines.NamespaceDetail | null
		selected: Sockets.Pipelines.NamedConfig | null
	}

	let { slug }: Props = $props()

	type Preset = Sockets.SessionAdmin.PresetRow
	let presets: Preset[] = $state([])
	let loading = $state(true)

	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		presets = res.presets
		loading = false
	}

	/**
	 * BARE — `sessionPresets:list` is not in `SCOPED_EVENTS`; this panel reads
	 * every preset and filters for the ones that reach this pipeline itself.
	 * Declare-then-emit in one call so the key is on the wire ahead of the
	 * request, and held for as long as the panel is open rather than released
	 * on the reply: the list is a cascade target, so a preset rebound
	 * elsewhere re-sends it and this "used by" answer stays true.
	 */
	onMount(() => requestWithInterest("sessionPresets:list", {}, onPresets))

	/** The presets whose bindings reach this pipeline, and through which slot. */
	const using = $derived(
		presets
			.map((p) => ({
				preset: p,
				events: Object.entries(p.bindings)
					.filter(([, b]) => b.spec === slug)
					.map(([event, b]) => ({ event, config: b.config }))
			}))
			.filter((u) => u.events.length > 0)
	)
</script>

<section class="panel-card flex flex-col gap-3" aria-label="Used by presets">
	<div>
		<h3 class="text-sm font-semibold">Used by presets</h3>
		<p class="text-surface-600-400 text-xs">
			Session presets bind a genre's event slots to pipelines and
			configurations — editing them happens on the preset's own page.
			These are the ones that reach for this pipeline.
		</p>
	</div>

	{#if loading}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{:else if !using.length}
		<p class="text-surface-600-400 text-sm italic">
			No preset binds this pipeline yet.
			<a class="underline" href="/admin/session-presets">
				Manage presets</a
			>.
		</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each using as u (u.preset.id)}
				<li
					class="border-surface-300-700 flex flex-wrap items-center gap-2 rounded-md border p-2.5"
				>
					<a
						class="min-w-0 font-semibold hover:underline"
						href="/admin/session-presets/{u.preset.id}"
					>
						{u.preset.name}
					</a>
					{#if u.preset.isDefault}
						<span
							class="preset-tonal-primary rounded-full px-1.5 py-0.5 text-[11px]"
							>default</span
						>
					{/if}
					{#if !u.preset.enabled}
						<span
							class="preset-tonal-surface rounded-full px-1.5 py-0.5 text-[11px]"
							>hidden</span
						>
					{/if}
					<span class="flex-1"></span>
					{#each u.events as e (e.event)}
						<span
							class="preset-tonal-surface rounded px-1.5 py-0.5 font-mono text-[11px]"
							title={e.config != null
								? `${e.event} @ config #${e.config}`
								: `${e.event} @ shipped default`}
						>
							{eventDisplayName(e.event)}
						</span>
					{/each}
					<a
						class="btn btn-sm preset-tonal-surface"
						href="/admin/session-presets/{u.preset.id}"
					>
						<Icons.Pencil size={12} /> Edit
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>
