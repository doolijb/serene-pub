<script lang="ts">
	/**
	 * Admin › Genres (24 §3): the changelist (note 37, Django admin) of the
	 * kinds of session people can start. Filters by family and availability;
	 * bulk Make available / Hide. A row opens the genre's change page
	 * (`/admin/session-genres/<id>`), where availability, the default preset
	 * and plugin swaps are set and its presets are listed inline. No Add and
	 * no Delete: genres arrive and leave with the code that declares them.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminBulkAction,
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// is a RESTRICTED interest family.
	const interest = getAdminInterestContext()

	type Row = Sockets.SessionAdmin.GenreRow
	let rows = $state<Row[]>([])
	let loading = $state(true)
	/**
	 * BARE and STANDING: a change page's switches answer through the
	 * cascaded list too, so a row's availability and preset count follow.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.requestWithInterest("sessionGenres:list", {}, (res) => {
			rows = res.genres
			loading = false
		})
	})

	const columns: AdminChangelistColumn<Row>[] = [
		{ key: "name", label: "Genre", primary: true, text: (r) => r.name, sortValue: (r) => r.name },
		{ key: "family", label: "Family", text: (r) => r.family, sortValue: (r) => r.family },
		{
			key: "presets",
			label: "Presets",
			numeric: true,
			text: (r) => String(r.presetCount),
			sortValue: (r) => r.presetCount
		},
		{
			key: "enabled",
			label: "Available",
			text: (r) => (r.enabled ? "Available" : "Hidden"),
			sortValue: (r) => (r.enabled ? 0 : 1)
		},
		{
			key: "slug",
			label: "Id",
			text: (r) => r.slug,
			sortValue: (r) => r.slug,
			class: "font-mono text-xs",
			hideWhenStacked: true
		}
	]

	const filters: AdminChangelistFilter<Row>[] = [
		{ key: "family", label: "Family", values: (r) => r.family || null },
		{
			key: "available",
			label: "Availability",
			values: (r) => (r.enabled ? "yes" : "no"),
			optionLabel: (v) => (v === "yes" ? "Available" : "Hidden"),
			order: ["yes", "no"]
		}
	]

	function setEnabled(selected: Row[], enabled: boolean) {
		const slugs = selected.filter((r) => r.enabled !== enabled).map((r) => r.slug)
		for (const slug of slugs) socket.emit("sessionGenres:update", { slug, enabled })
		toaster.success({
			title: `${slugs.length} ${slugs.length === 1 ? "genre" : "genres"} ${enabled ? "made available" : "hidden"}`
		})
	}
	const bulkActions: AdminBulkAction<Row>[] = [
		{ key: "enable", label: "Make selected genres available", icon: Icons.Eye, run: (s) => setEnabled(s, true) },
		{ key: "hide", label: "Hide selected genres", icon: Icons.EyeOff, run: (s) => setEnabled(s, false) }
	]
</script>

<AdminChangelist
	title="Genres"
	purpose="What kinds of session people can start. A genre declares its shape and events; new genres arrive with the code that declares them."
	{rows}
	rowKey={(r) => r.slug}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	noun={{ singular: "genre", plural: "genres" }}
	searchText={(r) => `${r.name} ${r.slug} ${r.family} ${r.description}`}
	rowHref={(r) => `/admin/session-genres/${encodeURIComponent(r.slug)}`}
	defaultSort="name"
	emptyIcon={Icons.Shapes}
	emptyMessage="No session genres — core registers Chat at startup, so an empty list means the bootstrap failed."
>
	{#snippet headerActions()}
		<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines">
			<Icons.Workflow size={16} aria-hidden="true" /> Pipelines
		</a>
	{/snippet}
</AdminChangelist>
