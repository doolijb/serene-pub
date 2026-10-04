<script lang="ts">
	/**
	 * Admin › Presets (23 §9): the changelist (note 37, Django admin) of the
	 * bundles people pick to start a session — genre, its pipelines'
	 * configurations, which actions come along. Filters by genre, status,
	 * origin and default; bulk Make available / Hide / Delete. A row opens
	 * its change form at `/admin/session-presets/<id>` — the address the
	 * Pipelines view's "Manage in Admin" link targets, kept stable.
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
	import {
		PRESET_NOUN,
		PRESET_STATUS_ORDER,
		presetDeletion,
		presetStatus,
		presetStatusWord
	} from "./presetsAdmin"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// and `sessionPresets:` are RESTRICTED interest families.
	const interest = getAdminInterestContext()

	type Row = Sockets.SessionAdmin.PresetRow
	let rows = $state<Row[]>([])
	let genres = $state<Sockets.SessionAdmin.GenreRow[]>([])
	let loading = $state(true)

	let deleting = $state(0)
	/**
	 * Both lists BARE and STANDING: the server re-emits each after every
	 * write, so a change made in a change form is already here.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.requestWithInterest("sessionPresets:list", {}, (res) => {
				rows = res.presets
				loading = false
			}),
			interest.requestWithInterest("sessionGenres:list", {}, (res) => {
				genres = res.genres
			}),
			interest.declareInterest<"sessionPresets:delete">("sessionPresets:delete", () => {
				if (deleting > 0 && --deleting === 0) toaster.success({ title: "Deleted" })
			}),
			interest.declareInterest<"sessionPresets:delete:error">(
				"sessionPresets:delete:error",
				(res) => {
					if (deleting > 0) deleting--
					if (res.error) toaster.error({ title: res.error })
				}
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	const genreName = (slug: string) => genres.find((t) => t.slug === slug)?.name ?? slug

	const columns: AdminChangelistColumn<Row>[] = [
		{ key: "name", label: "Name", primary: true, text: (r) => r.name, sortValue: (r) => r.name },
		{
			key: "genre",
			label: "Genre",
			text: (r) => genreName(r.genreId),
			sortValue: (r) => genreName(r.genreId)
		},
		{
			key: "status",
			label: "Status",
			custom: true,
			text: (r) => presetStatusWord(presetStatus(r)),
			sortValue: (r) => PRESET_STATUS_ORDER.indexOf(presetStatus(r))
		},
		{
			key: "default",
			label: "Default",
			text: (r) => (r.isDefault ? "Default" : ""),
			sortValue: (r) => (r.isDefault ? 0 : 1)
		},
		{
			key: "origin",
			label: "Origin",
			text: (r) => (r.isImmutable ? "Built-in" : "Custom"),
			sortValue: (r) => (r.isImmutable ? 0 : 1),
			hideWhenStacked: true
		}
	]

	const filters: AdminChangelistFilter<Row>[] = $derived([
		{ key: "genre", label: "Genre", values: (r) => r.genreId, optionLabel: genreName },
		{
			key: "status",
			label: "Status",
			values: presetStatus,
			optionLabel: presetStatusWord,
			order: [...PRESET_STATUS_ORDER]
		},
		{
			key: "origin",
			label: "Origin",
			values: (r) => (r.isImmutable ? "builtin" : "custom"),
			optionLabel: (v) => (v === "builtin" ? "Built-in" : "Custom"),
			order: ["builtin", "custom"]
		},
		{
			key: "default",
			label: "Default",
			values: (r) => (r.isDefault ? "yes" : "no"),
			optionLabel: (v) => (v === "yes" ? "Default for its genre" : "Not the default"),
			order: ["yes", "no"]
		}
	])

	const setEnabled = (selected: Row[], enabled: boolean) => {
		const ids = selected.filter((r) => r.enabled !== enabled).map((r) => r.id)
		for (const id of ids) socket.emit("sessionPresets:update", { id, enabled })
		toaster.success({
			title: `${ids.length} ${ids.length === 1 ? "preset" : "presets"} ${enabled ? "made available" : "hidden"}`
		})
	}

	const bulkActions: AdminBulkAction<Row>[] = [
		{
			key: "enable",
			label: "Make selected presets available",
			icon: Icons.Eye,
			run: (s) => setEnabled(s, true)
		},
		{
			key: "hide",
			label: "Hide selected presets from users",
			icon: Icons.EyeOff,
			run: (s) => setEnabled(s, false)
		},
		{
			key: "delete",
			label: "Delete selected presets…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (s) => presetDeletion(s, genreName),
			run: (s) => {
				const ids = s.filter((r) => !r.isImmutable).map((r) => r.id)
				deleting += ids.length
				for (const id of ids) socket.emit("sessionPresets:delete", { id })
			}
		}
	]
	const DOT: Record<string, string> = {
		stale: "bg-warning-500",
		hidden: "bg-surface-400-600",
		available: "bg-success-500"
	}
</script>

<AdminChangelist
	title="Presets"
	purpose="The bundles a person picks to start a session: a genre, its pipelines' configurations and which actions come along. People see available presets of available genres."
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	noun={PRESET_NOUN}
	searchText={(r) =>
		`${r.name} ${genreName(r.genreId)} ${r.genreId} ${r.description ?? ""} ` +
		(r.staleBindings ?? []).map((b) => `${b.event} ${b.bound}`).join(" ")}
	rowHref={(r) => `/admin/session-presets/${r.id}`}
	addHref="/admin/session-presets/new"
	defaultSort="status"
	emptyIcon={Icons.Ticket}
	emptyMessage="No presets — the Chat floor seeds at startup, so an empty list means the bootstrap failed."
>
	{#snippet cell(row, col)}
		{#if col.key === "status"}
			{@const s = presetStatus(row)}
			<span class="inline-flex items-center gap-1.5">
				<span class="size-2 shrink-0 rounded-full {DOT[s]}" aria-hidden="true"></span>
				{presetStatusWord(s)}
			</span>
		{/if}
	{/snippet}
</AdminChangelist>
