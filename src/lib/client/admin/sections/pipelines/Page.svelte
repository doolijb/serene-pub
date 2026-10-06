<script lang="ts">
	/**
	 * Admin › Pipelines: the changelist (note 37, Django admin) of everything
	 * published on this instance — genre, role, source, status, version and
	 * the last five runs' outcomes — with the catalogue's facets (23 §4) as
	 * changelist filters: genre, role, source, status. Facets are declared
	 * metadata, never parsed from slugs (the source is the publisher's
	 * namespace, which the id carries by construction); unclassified is shown
	 * and labelled, never hidden. A row opens its workspace — the pipeline's
	 * change view — at `/admin/pipelines/<slug>`.
	 *
	 * No Add and no Delete: pipelines are published by core and extensions.
	 * Under the list, **Recent runs** (`#recent-runs`, `?runs=failed` for
	 * failures only — the Needs you link) answers "did that use the
	 * pipeline". Admin-only, checked here and again in every handler.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import { withGenre } from "$lib/client/utils/pipelineGenre"
	import {
		adminGoto as goto,
		adminPage,
		adminRouter
	} from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import type {
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const interest = getInterestContext()

	type Pipeline = Sockets.Pipelines.Namespace
	type Run = Sockets.Pipelines.Runs.Response["runs"][number]

	let list = $state<Pipeline[]>([])
	let runs = $state<Run[]>([])
	let loading = $state(true)
	/** genreId → display name (24 §3). */
	let genreNames = $state<Map<string, string>>(new Map())

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		// The browser's old `?spec=<slug>` preview: the workspace is the
		// change view now, so the deep link opens it.
		const spec = new URLSearchParams(adminPage.url.search).get("spec")
		if (spec) void goto(`/admin/pipelines/${encodeURIComponent(spec)}`, { replaceState: true })
	})

	/**
	 * `list`, `runs` and the genre names, each asked for and listened for in
	 * one. All BARE: none is about one session. The app-wide interest
	 * context: `pipelines:` and `sessions:` are mixed families; the admin
	 * check is the redirect above and every handler's own.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.requestWithInterest("pipelines:list", {}, (res) => {
				list = res.pipelinesList
				loading = false
			}),
			interest.requestWithInterest("pipelines:runs", { limit: 300 }, (res) => {
				runs = res.runs
			}),
			interest.requestWithInterest("sessions:genres", {}, (res) => {
				genreNames = new Map(res.genres.map((m) => [m.genreId, m.name]))
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	const ROLE_ORDER = ["create", "primary", "action", "maintenance", "unclassified"]
	const roleOf = (p: Pipeline) => p.taxonomy?.role ?? "unclassified"
	/** The genre a spec serves — a declared claim, never parsed (24 §3). */
	const genreOf = (p: Pipeline) => p.taxonomy?.genre ?? null
	/** The publisher's namespace — "core:…", "acme.plugin:…". */
	const sourceOf = (p: Pipeline) => p.slug.split(":")[0] || "unknown"
	const genreName = (id: string) => genreNames.get(id) ?? id
	/**
	 * "Reply · Adventure" — where a list names pipelines without the Genre
	 * column beside it (Recent runs): names carry no genre (NOMENCLATURE §2).
	 */
	const nameWithGenre = (p: Pipeline) => withGenre(p.name, genreOf(p) ? genreName(genreOf(p)!) : null)
	const roleWord = (r: string) => r.charAt(0).toUpperCase() + r.slice(1)

	/** The last N outcomes for a slug, newest first (runs arrive desc). */
	const healthFor = (slug: string, n = 5) => runs.filter((r) => r.specSlug === slug).slice(0, n)
	const failuresOf = (slug: string) => healthFor(slug).filter((r) => r.outcome !== "ok").length

	const columns: AdminChangelistColumn<Pipeline>[] = [
		{ key: "name", label: "Name", primary: true, text: (p) => p.name, sortValue: (p) => p.name },
		{
			key: "genre",
			label: "Genre",
			text: (p) => (genreOf(p) ? genreName(genreOf(p)!) : "—"),
			sortValue: (p) => (genreOf(p) ? genreName(genreOf(p)!) : null)
		},
		{
			key: "role",
			label: "Role",
			text: (p) => roleWord(roleOf(p)),
			sortValue: (p) => ROLE_ORDER.indexOf(roleOf(p))
		},
		{
			key: "status",
			label: "Status",
			text: (p) => (p.enabled ? "Enabled" : "Disabled"),
			sortValue: (p) => (p.enabled ? 0 : 1)
		},
		{
			key: "health",
			label: "Last runs",
			custom: true,
			sortValue: (p) => (healthFor(p.slug).length ? failuresOf(p.slug) : null)
		},
		{
			key: "slug",
			label: "Id",
			text: (p) => `${p.slug} · v${p.version}`,
			sortValue: (p) => p.slug,
			class: "font-mono text-xs",
			hideWhenStacked: true
		}
	]

	const filters: AdminChangelistFilter<Pipeline>[] = $derived([
		{ key: "genre", label: "Genre", values: genreOf, optionLabel: genreName },
		{ key: "role", label: "Role", values: roleOf, optionLabel: roleWord, order: ROLE_ORDER },
		{ key: "source", label: "Source", values: sourceOf },
		{
			key: "status",
			label: "Status",
			values: (p) => (p.enabled ? "enabled" : "disabled"),
			optionLabel: (v) => (v === "enabled" ? "Enabled" : "Disabled"),
			order: ["enabled", "disabled"]
		}
	])

	// ── recent runs ─────────────────────────────────────────────────────
	const failedOnly = $derived(new URLSearchParams(adminPage.url.search).get("runs") === "failed")
	function setFailedOnly(on: boolean) {
		const p = new URLSearchParams(adminPage.url.search)
		if (on) p.set("runs", "failed")
		else p.delete("runs")
		const q = p.toString()
		adminRouter.setQuery(q ? `?${q}` : "")
	}
	const shownRuns = $derived(
		failedOnly ? runs.filter((r) => r.outcome !== "ok").slice(0, 30) : runs.slice(0, 12)
	)
	const okCount = $derived(runs.filter((r) => r.outcome === "ok").length)
	const whenShort = (iso: string) =>
		new Date(iso).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		})
</script>

{#snippet healthDots(slug: string)}
	{@const h = healthFor(slug)}
	{#if h.length}
		<span
			class="inline-flex items-center gap-0.5"
			title={h.map((r) => `${r.outcome} · ${whenShort(r.startedAt)}`).join("\n")}
		>
			{#each h as r (r.runId)}
				<span
					class="size-1.5 rounded-full {r.outcome === 'ok' ? 'bg-success-500' : 'bg-warning-500'}"
				></span>
			{/each}
			<span class="sr-only">
				{h.length - failuresOf(slug)} of {h.length} recent runs ok
			</span>
		</span>
	{:else}
		<span class="text-surface-600-400 text-[11px]">no runs</span>
	{/if}
{/snippet}

<div class="flex min-w-0 flex-col gap-4">
	<AdminChangelist
		title="Pipelines"
		doc={docsHref("pipelines", "every-reply-is-one-run")}
		purpose="Everything published on this pub and how it is doing. Open one for its workspace: steps, configurations, versions."
		rows={list}
		rowKey={(p) => p.slug}
		{columns}
		{filters}
		{loading}
		noun={{ singular: "pipeline", plural: "pipelines" }}
		searchText={(p) => `${p.name} ${p.slug} ${p.event ?? ""} ${roleOf(p)} ${genreOf(p) ? genreName(genreOf(p)!) : ""}`}
		rowHref={(p) => `/admin/pipelines/${encodeURIComponent(p.slug)}`}
		defaultSort="role"
		keepQuery={["runs"]}
		emptyIcon={Icons.Workflow}
		emptyMessage="Nothing is published. Core publishes its own pipelines at startup, so an empty list usually means the type registry refused to sync — check the server log for a bootstrap warning."
	>
		{#snippet headerActions()}
			<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines/events">
				<Icons.Zap size={16} aria-hidden="true" /> Events
			</a>
			<a class="btn btn-sm preset-tonal-surface" href="/pipelines/library">
				<Icons.Library size={16} aria-hidden="true" /> Library
			</a>
		{/snippet}
		{#snippet cell(row, col)}
			{#if col.key === "health"}{@render healthDots(row.slug)}{/if}
		{/snippet}
	</AdminChangelist>

	<AdminFieldset
		id="recent-runs"
		title="Recent runs"
		description="A session with no rows here was answered by the prompt builder — there is no third possibility."
	>
		{#snippet aside()}
			<span class="text-surface-600-400 text-xs">{okCount} of {runs.length} ok</span>
			<button
				type="button"
				class="chip min-h-8 shrink-0 px-3 text-xs {failedOnly
					? 'preset-tonal-warning'
					: 'preset-tonal-surface'}"
				aria-pressed={failedOnly}
				onclick={() => setFailedOnly(!failedOnly)}
			>
				Failed only
			</button>
		{/snippet}
		<div>
			{#if failedOnly && !shownRuns.length}
				<p class="text-surface-600-400 text-sm">No failed runs among the recent ones.</p>
			{:else if shownRuns.length}
				<ul class="flex flex-col gap-1">
					{#each shownRuns as r (r.runId)}
						{@const p = list.find((x) => x.slug === r.specSlug)}
						<li>
							<a
								href="/admin/pipelines/{encodeURIComponent(r.specSlug)}"
								class="hover:bg-surface-200-800 flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left text-sm"
							>
								<span
									class="size-2 shrink-0 rounded-full {r.outcome === 'ok'
										? 'bg-success-500'
										: 'bg-warning-500'}"
									aria-hidden="true"
								></span>
								<span class="min-w-0 flex-1 truncate">{p ? nameWithGenre(p) : r.specSlug}</span>
								<span class="text-surface-600-400 shrink-0 text-xs whitespace-nowrap">
									{r.outcome === "ok" ? "" : `${r.outcome} · `}{whenShort(r.startedAt)}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 text-sm">No runs recorded yet.</p>
			{/if}
		</div>
	</AdminFieldset>
</div>
