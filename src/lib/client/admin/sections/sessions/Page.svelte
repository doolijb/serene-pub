<script lang="ts">
	/**
	 * All user sessions (23 §9) — the instance-wide inventory. Read-only by
	 * design: sessions belong to their users; the admin lever here is
	 * visibility (which types/presets exist), exercised on the sibling pages.
	 */
	import { getContext, onMount } from "svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	/**
	 * The app-wide context, not `adminInterest`: `sessions:adminList` is an
	 * admin-only HANDLER but `sessions:` is not a restricted interest family
	 * (a non-admin reads their own sessions on it), so the key is an ordinary
	 * one and the guard below is what keeps this page's request to admins.
	 */
	const interest = getInterestContext()

	type Row = Sockets.SessionAdmin.SessionsList.Row
	let rows: Row[] = $state([])
	let loading = $state(true)

	const onList = (res: Sockets.SessionAdmin.SessionsList.Response) => {
		rows = res.sessions
		loading = false
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
	})

	/**
	 * The inventory, asked for and listened for in one — BARE, since the list
	 * spans every session and has none to be scoped to. Behind the same admin
	 * check as the redirect above, so a non-admin declares nothing and sends
	 * nothing while the redirect is in flight.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.requestWithInterest("sessions:adminList", {}, onList)
	})

	const fmtDate = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString(undefined, {
					year: "numeric",
					month: "short",
					day: "numeric"
				})
			: "—"

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Session", value: (r) => r.name ?? "" },
		{ key: "user", label: "User", value: (r) => r.username },
		{ key: "type", label: "Genre", value: (r) => r.genreName },
		{ key: "preset", label: "Preset", value: (r) => r.presetName ?? "" },
		{ key: "size", label: "Contents", value: (r) => r.messageCount },
		{ key: "updated", label: "Updated", value: (r) => r.updatedAt ?? "" }
	]
</script>

<div class="mx-auto w-full max-w-[1120px]">
	<AdminPageHeader
		title="Sessions"
		purpose="Every session on this instance, whoever owns it. Read-only: sessions belong to the people who made them."
	/>

	<AdminList
		{rows}
		{columns}
		{loading}
		searchText={(r) =>
			`${r.name ?? ""} ${r.username} ${r.genreName} ${r.presetName ?? ""}`}
		searchPlaceholder="Search sessions…"
		defaultSort="updated"
		defaultSortDir="desc"
		storageKey="serene-pub:adminView:adminSessions"
		emptyMessage="No sessions yet."
	>
		{#snippet cell(row, col)}
			{#if col.key === "name"}
				<span class="font-semibold">{row.name ?? "Untitled"}</span>
				{#if row.isGroup}
					<span
						class="preset-tonal-surface ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]"
					>
						group
					</span>
				{/if}
			{:else if col.key === "user"}
				<span class="text-surface-700-300 text-xs">{row.username}</span>
			{:else if col.key === "type"}
				<span class="text-surface-700-300 text-xs">
					{row.genreName}
				</span>
			{:else if col.key === "preset"}
				<span class="text-surface-600-400 text-xs">
					{row.presetName ?? "—"}
				</span>
			{:else if col.key === "size"}
				<span
					class="text-surface-600-400 text-xs"
					title="{row.characterCount} characters · {row.personaCount} personas · {row.messageCount} messages"
				>
					{row.messageCount} msgs · {row.characterCount +
						row.personaCount} members
				</span>
			{:else if col.key === "updated"}
				<span class="text-surface-600-400 text-xs">
					{fmtDate(row.updatedAt)}
				</span>
			{/if}
		{/snippet}
	</AdminList>
</div>
