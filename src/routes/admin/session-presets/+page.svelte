<script lang="ts">
	/**
	 * Session presets (23 §9) — the bundles users pick to start a session:
	 * type, primary variant, config selections, actions. Changelist here;
	 * New and Edit go to dedicated change pages.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// is a RESTRICTED interest family, and this context exists only inside the
	// admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()

	type Row = Sockets.SessionAdmin.PresetRow
	let rows: Row[] = $state([])
	let types: Sockets.SessionAdmin.GenreRow[] = $state([])
	let loading = $state(true)

	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		rows = res.presets
		loading = false
	}
	const onTypes = (res: Sockets.SessionAdmin.Genres.Response) => {
		types = res.genres
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * The two lists this changelist joins, each asked for and listened for in
	 * one. Both BARE — a preset and a genre are the instance's — and both
	 * STANDING, because the server re-emits each as a cascade after every
	 * write on this page and on the change pages.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.requestWithInterest("sessionPresets:list", {}, onPresets),
			interest.requestWithInterest("sessionGenres:list", {}, onTypes)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	const typeName = (slug: string) =>
		types.find((t) => t.slug === slug)?.name ?? slug

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "type", label: "Type", value: (r) => typeName(r.genreId) },
		{
			key: "primary",
			label: "Primary",
			value: (r) => r.primarySlug ?? ""
		},
		{
			key: "enabled",
			label: "Status",
			// Stale first, then hidden, then healthy: the column exists to be
			// scanned, and the row that needs an administrator is the row a
			// sort on it should put at the top.
			value: (r) => (r.staleBindings?.length ? -1 : r.enabled ? 0 : 1)
		},
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Ticket size={20} /> Session presets
		</h2>
		<p class="text-surface-600-400 text-sm">
			The bundles a person picks to start a session — a type, its
			pipelines' configurations, and which actions come along. Users see
			enabled presets of available types.
		</p>
	</div>
	<a
		class="btn btn-sm preset-filled-primary-500"
		href="/admin/session-presets/new"
	>
		<Icons.Plus size={16} /> New preset
	</a>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) =>
		`${r.name} ${typeName(r.genreId)} ${r.genreId} ` +
		(r.staleBindings ?? []).map((b) => `${b.event} ${b.bound}`).join(" ")}
	searchPlaceholder="Search presets…"
	defaultSort="name"
	storageKey="serene-pub:adminView:sessionPresets"
	emptyMessage="No presets — the Chat floor seeds at startup, so an empty list means the bootstrap failed."
	onRowClick={(r) => goto(`/admin/session-presets/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
			{#if row.isDefault}
				<span
					class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold"
					>default</span
				>
			{/if}
			{#if row.isImmutable}
				<span
					class="preset-tonal-surface ml-1 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					>built-in</span
				>
			{/if}
		{:else if col.key === "type"}
			<span class="text-surface-700-300 text-xs">
				{typeName(row.genreId)}
			</span>
		{:else if col.key === "primary"}
			<span class="text-surface-600-400 font-mono text-xs">
				{row.primarySlug ?? "type default"}
			</span>
		{:else if col.key === "enabled"}
			<!-- A slot whose pipeline has gone (ruled 2026-09-10). Beside the
			     availability badge rather than in a column of its own: it is a
			     fact about whether this preset does what it says, which is the
			     same question "enabled" answers. Sessions on it keep running —
			     the badge reports a substitution, never a stoppage. -->
			{#if row.staleBindings?.length}
				<a
					class="preset-tonal-warning mr-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
					href="/admin/session-presets/{row.id}#bindings"
					onclick={(e) => e.stopPropagation()}
					title={row.staleBindings
						.map((b) => `${b.event} → ${b.bound}: ${b.reason}`)
						.join("\n")}
				>
					<Icons.TriangleAlert size={12} />
					{row.staleBindings.length === 1
						? "1 binding unavailable"
						: `${row.staleBindings.length} bindings unavailable`}
				</a>
			{/if}
			{#if row.enabled}
				<span
					class="preset-tonal-success rounded-full px-2 py-0.5 text-xs"
					>enabled</span
				>
			{:else}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
					>hidden</span
				>
			{/if}
		{:else if col.key === "actions"}
			<a
				class="btn btn-sm preset-tonal-surface"
				href="/admin/session-presets/{row.id}"
				onclick={(e) => e.stopPropagation()}
			>
				<Icons.Pencil size={13} /> Edit
			</a>
		{/if}
	{/snippet}
</AdminList>
