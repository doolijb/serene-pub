<script lang="ts">
	/**
	 * All user sessions (23 §9) — the instance-wide inventory. Read-only by
	 * design: sessions belong to their users; the admin lever here is
	 * visibility (which types/presets exist), exercised on the sibling pages.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

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
		socket.on("sessions:adminList", onList)
		socket.emit("sessions:adminList", {})
	})
	onDestroy(() => {
		socket.off("sessions:adminList", onList)
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
		{ key: "type", label: "Type", value: (r) => r.genreName },
		{ key: "preset", label: "Preset", value: (r) => r.presetName ?? "" },
		{ key: "size", label: "Contents", value: (r) => r.messageCount },
		{ key: "updated", label: "Updated", value: (r) => r.updatedAt ?? "" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.MessagesSquare size={20} /> User sessions
		</h2>
		<p class="text-surface-600-400 text-sm">
			Every session on this instance, whoever owns it. Read-only —
			sessions belong to their users.
		</p>
	</div>
</div>

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
					class="preset-tonal-surface ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					>group</span
				>
			{/if}
		{:else if col.key === "user"}
			<span class="text-surface-700-300 text-xs">{row.username}</span>
		{:else if col.key === "type"}
			<span class="text-surface-700-300 text-xs">{row.genreName}</span>
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
