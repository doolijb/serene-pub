<script lang="ts">
	/**
	 * Session genres (24 §3) — genres with their own ids, plus transitional
	 * input-type genres, as a list beside the genre hub it opens
	 * (`[id]/+page.svelte`). Availability and the default preset are the
	 * admin levers, set on the hub; a genre's create pipeline is edited in its
	 * pipeline workspace. No create: new genres arrive with new create
	 * pipelines.
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

	type Row = Sockets.SessionAdmin.GenreRow
	let rows: Row[] = $state([])
	let loading = $state(true)

	const onGenres = (res: Sockets.SessionAdmin.Genres.Response) => {
		rows = res.genres
		loading = false
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * The genres, asked for and listened for in one. BARE — a genre is the
	 * instance's — and STANDING: the hub's switches answer through the
	 * cascaded list too, so a row's "hidden" and preset count follow them.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.requestWithInterest("sessionGenres:list", {}, onGenres)
	})

	let selectedId = $derived(
		page.params.id ? decodeURIComponent(page.params.id) : undefined
	)

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Genre", value: (r) => r.name },
		{ key: "slug", label: "Spec", value: (r) => r.slug },
		{ key: "presets", label: "Presets", value: (r) => r.presetCount },
		{
			key: "enabled",
			label: "Available",
			value: (r) => (r.enabled ? 0 : 1)
		}
	]

	function meta(r: Row): string {
		const parts = [
			`${r.presetCount} preset${r.presetCount === 1 ? "" : "s"}`
		]
		if (r.family) parts.push(r.family)
		if (!r.createSpecSlug) parts.push("input-type")
		return parts.join(" · ")
	}
</script>

<AdminPageHeader
	title="Genres"
	purpose="What kinds of session people can start. A genre declares its shape and events; new genres arrive with new create pipelines."
>
	{#snippet actions()}
		<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines">
			<Icons.Workflow size={16} /> Pipelines
		</a>
	{/snippet}
</AdminPageHeader>

<AdminSplit
	hasDetail={!!selectedId}
	emptyMessage="Pick a genre to set whether it is offered, its default preset and its plugins' swaps."
>
	{#snippet list()}
		<AdminList
			{rows}
			{columns}
			{loading}
			compact
			rowTitle={(r) => r.name}
			rowMeta={meta}
			rowBadge={(r) => (r.enabled ? undefined : "Hidden")}
			isSelected={(r) => r.slug === selectedId}
			searchText={(r) => `${r.name} ${r.slug} ${r.family}`}
			searchPlaceholder="Filter genres"
			defaultSort="name"
			emptyMessage="No session genres — core registers Chat at startup, so an empty list means the bootstrap failed."
			onRowClick={(r) =>
				goto(`/admin/session-genres/${encodeURIComponent(r.slug)}`)}
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
