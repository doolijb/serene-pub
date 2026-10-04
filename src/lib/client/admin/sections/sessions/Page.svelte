<script lang="ts">
	/**
	 * Admin › Sessions (23 §9): the changelist (note 37, Django admin) of every
	 * session on the instance, whoever owns it — filters by owner, genre,
	 * preset and kind. **Read-only by design**: sessions belong to the people
	 * who made them, so there is no Add, no change form and no bulk action
	 * (Django's view-only permission). The admin levers are which genres and
	 * presets exist, on their own pages; the preset column links there.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	/**
	 * The app-wide context, not `adminInterest`: `sessions:adminList` is an
	 * admin-only HANDLER but `sessions:` is not a restricted interest family,
	 * so the key is ordinary and the guard below keeps the request to admins.
	 */
	const interest = getInterestContext()

	type Row = Sockets.SessionAdmin.SessionsList.Row
	let rows = $state<Row[]>([])
	let loading = $state(true)

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})
	/** BARE: the list spans every session. */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.requestWithInterest("sessions:adminList", {}, (res) => {
			rows = res.sessions
			loading = false
		})
	})

	const fmtDate = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString(undefined, {
					year: "numeric",
					month: "short",
					day: "numeric"
				})
			: "—"

	const columns: AdminChangelistColumn<Row>[] = [
		{
			key: "name",
			label: "Session",
			primary: true,
			text: (r) => (r.name ?? "Untitled") + (r.isGroup ? " (group)" : ""),
			sortValue: (r) => r.name
		},
		{ key: "user", label: "Owner", text: (r) => r.username, sortValue: (r) => r.username },
		{ key: "genre", label: "Genre", text: (r) => r.genreName, sortValue: (r) => r.genreName },
		{ key: "preset", label: "Preset", custom: true, sortValue: (r) => r.presetName },
		{
			key: "size",
			label: "Messages",
			numeric: true,
			text: (r) => String(r.messageCount),
			sortValue: (r) => r.messageCount
		},
		{
			key: "members",
			label: "Members",
			numeric: true,
			text: (r) => String(r.characterCount + r.personaCount),
			sortValue: (r) => r.characterCount + r.personaCount,
			hideWhenStacked: true
		},
		{
			key: "updated",
			label: "Updated",
			text: (r) => fmtDate(r.updatedAt),
			sortValue: (r) => (r.updatedAt ? new Date(r.updatedAt).getTime() : null)
		}
	]

	const filters: AdminChangelistFilter<Row>[] = $derived([
		{ key: "owner", label: "Owner", values: (r) => r.username },
		{
			key: "genre",
			label: "Genre",
			values: (r) => r.genreId,
			optionLabel: (v) => rows.find((r) => r.genreId === v)?.genreName ?? v
		},
		{
			key: "preset",
			label: "Preset",
			values: (r) => (r.presetId != null ? String(r.presetId) : "none"),
			optionLabel: (v) =>
				v === "none" ? "No preset" : (rows.find((r) => String(r.presetId) === v)?.presetName ?? v)
		},
		{
			key: "kind",
			label: "Kind",
			values: (r) => (r.isGroup ? "group" : "single"),
			optionLabel: (v) => (v === "group" ? "Group" : "One character"),
			order: ["single", "group"]
		}
	])
</script>

<AdminChangelist
	title="Sessions"
	purpose="Every session on this pub, whoever owns it. Read-only: sessions belong to the people who made them."
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{loading}
	noun={{ singular: "session", plural: "sessions" }}
	searchText={(r) => `${r.name ?? ""} ${r.username} ${r.genreName} ${r.presetName ?? ""}`}
	defaultSort="updated"
	defaultSortDir="desc"
	emptyIcon={Icons.MessagesSquare}
	emptyMessage="No sessions yet."
>
	{#snippet cell(row, col)}
		{#if col.key === "preset"}
			{#if row.presetId != null}
				<a
					class="hover:underline"
					href="/admin/session-presets/{row.presetId}"
					onclick={(e) => e.stopPropagation()}
				>
					{row.presetName ?? `Preset ${row.presetId}`}
				</a>
			{:else}
				<span class="text-surface-600-400">—</span>
			{/if}
		{/if}
	{/snippet}
</AdminChangelist>
