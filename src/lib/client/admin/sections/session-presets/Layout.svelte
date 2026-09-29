<script lang="ts">
	/**
	 * Session presets (23 §9) — the bundles users pick to start a session:
	 * genre, its pipelines' configurations, actions — as a list beside the
	 * preset it opens (`[id]/+page.svelte`) or the creator (`new`).
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminSplit from "$lib/client/components/admin/AdminSplit.svelte"

	let { children } = $props()

	const userCtx: { user: SelectUser } = getContext("userCtx")
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// is a RESTRICTED interest family, and this context exists only inside the
	// admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()

	type Row = Sockets.SessionAdmin.PresetRow
	let rows: Row[] = $state([])
	let genres: Sockets.SessionAdmin.GenreRow[] = $state([])
	let loading = $state(true)

	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		rows = res.presets
		loading = false
	}
	const onGenres = (res: Sockets.SessionAdmin.Genres.Response) => {
		genres = res.genres
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * The two lists this list joins, each asked for and listened for in one.
	 * Both BARE — a preset and a genre are the instance's — and both
	 * STANDING, because the server re-emits each as a cascade after every
	 * write made in the detail.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.requestWithInterest("sessionPresets:list", {}, onPresets),
			interest.requestWithInterest("sessionGenres:list", {}, onGenres)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	const genreName = (slug: string) =>
		genres.find((t) => t.slug === slug)?.name ?? slug

	let selectedId = $derived(page.params.id)
	let hasDetail = $derived(!!selectedId || page.url.pathname.endsWith("/new"))

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "genre", label: "Genre", value: (r) => genreName(r.genreId) },
		{
			key: "status",
			label: "Status",
			// Stale first, then hidden, then healthy: the row that needs an
			// administrator is the row a sort on it should put at the top.
			value: (r) => (r.staleBindings?.length ? -1 : r.enabled ? 0 : 1)
		}
	]

	/**
	 * A slot whose pipeline has gone (ruled 2026-09-10) leads the line: it is
	 * a fact about whether this preset does what it says. Sessions on it keep
	 * running — this reports a substitution, never a stoppage.
	 */
	function meta(r: Row): string {
		const parts: string[] = []
		const stale = r.staleBindings?.length ?? 0
		if (stale)
			parts.push(
				stale === 1
					? "1 binding unavailable"
					: `${stale} bindings unavailable`
			)
		parts.push(genreName(r.genreId))
		if (r.isDefault) parts.push("default")
		if (!r.enabled) parts.push("hidden")
		return parts.join(" · ")
	}
</script>

<AdminPageHeader
	title="Presets"
	purpose="The bundles a person picks to start a session: a genre, its pipelines' configurations and which actions come along. People see enabled presets of available genres."
>
	{#snippet actions()}
		<a
			class="btn btn-sm preset-filled-primary-500"
			href="/admin/session-presets/new"
		>
			<Icons.Plus size={16} /> New preset
		</a>
	{/snippet}
</AdminPageHeader>

<AdminSplit {hasDetail} emptyMessage="Pick a preset to edit it.">
	{#snippet list()}
		<AdminList
			{rows}
			{columns}
			{loading}
			compact
			rowTitle={(r) => r.name}
			rowMeta={meta}
			rowBadge={(r) => (r.isImmutable ? "Built-in" : undefined)}
			isSelected={(r) => String(r.id) === selectedId}
			searchText={(r) =>
				`${r.name} ${genreName(r.genreId)} ${r.genreId} ` +
				(r.staleBindings ?? [])
					.map((b) => `${b.event} ${b.bound}`)
					.join(" ")}
			searchPlaceholder="Filter presets"
			defaultSort="status"
			emptyMessage="No presets — the Chat floor seeds at startup, so an empty list means the bootstrap failed."
			onRowClick={(r) => goto(`/admin/session-presets/${r.id}`)}
		>
			{#snippet cell(row)}{row.name}{/snippet}
		</AdminList>
	{/snippet}
	<!-- Keyed: SvelteKit reuses the page when only the id changes, and a
	     detail seeds its form once. -->
	{#key page.url.pathname}
		{@render children?.()}
	{/key}
</AdminSplit>
