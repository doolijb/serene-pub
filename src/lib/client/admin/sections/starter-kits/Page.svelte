<script lang="ts">
	/**
	 * 🚧 Admin › Starter lorebooks (PLAN-lorebook-kinds §B): the changelist (note
	 * 37, Django admin) of every kit people can start a lorebook or a session
	 * from. Kits that come with the pub (core's, a plugin's) stay as they
	 * are: **Clone** makes an admin kit of one. Admin kits are edited in place
	 * in Lorebooks, by the admin who made it (**Open in Lorebooks**), and any
	 * admin may **Clone** or **Delete** one. Delete is Django's "Are you
	 * sure?" step, naming the kit; Clone asks for the new kit's name.
	 *
	 * No change form: a kit's contents are a lorebook's, and the Lorebooks
	 * view is where a lorebook is edited (admin never nests another view,
	 * STYLE-GUIDE §6.11). `starterKits:` is a GATED family, so every list and
	 * answer here is heard through declared interest.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { openJumpHit } from "$lib/client/shell/openJumpHit"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import AdminDeleteConfirm from "$lib/client/components/admin/AdminDeleteConfirm.svelte"
	import NewNameModal from "$lib/client/components/modals/NewNameModal.svelte"
	import type {
		AdminChangelistColumn,
		AdminChangelistFilter,
		AdminDeletion
	} from "$lib/client/components/admin/changelist"
	import {
		kitBookId,
		kitHoldsLine,
		kitSourceLine
	} from "$lib/client/lorebooks/starterKitCards"

	type Row = Sockets.StarterKits.Card

	const userCtx: { user?: SelectUser | null } | undefined =
		getContext("userCtx")
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")
	const socket = useTypedSocket()
	const interest = getAdminInterestContext()

	let rows = $state<Row[]>([])
	let loading = $state(true)

	/** The kit being cloned, while its name is asked for. */
	let cloning = $state<Row | null>(null)
	let cloneError = $state("")
	/** This tab's clone in flight, by the card it copies. */
	let pendingClone: string | null = null
	/** The kit whose delete is being confirmed. */
	let deleting = $state<Row | null>(null)
	let pendingDelete: number | null = null

	$effect(() => {
		if (!userCtx?.user?.isAdmin) return
		const releases = [
			// BARE and STANDING: a save, clone or delete anywhere re-sends it.
			interest.requestWithInterest("starterKits:list", {}, (res) => {
				rows = res?.kits ?? []
				loading = false
			}),
			interest.declareInterest<"starterKits:clone">(
				"starterKits:clone",
				(res) => {
					if (pendingClone === null || !res?.kit) return
					pendingClone = null
					cloning = null
					toaster.success({
						title: "Starter lorebook cloned",
						description: `"${res.kit.name}" is ready. Open it in Lorebooks to make it your own.`
					})
				}
			),
			interest.declareInterest<"starterKits:clone:error">(
				"starterKits:clone:error",
				(res) => {
					if (pendingClone === null) return
					pendingClone = null
					cloneError =
						res?.error || "The starter lorebook could not be cloned. Try again."
				}
			),
			interest.declareInterest<"starterKits:delete">(
				"starterKits:delete",
				(res) => {
					if (
						pendingDelete === null ||
						res?.lorebookId !== pendingDelete
					)
						return
					pendingDelete = null
					toaster.success({ title: "Starter lorebook deleted" })
				}
			),
			interest.declareInterest<"starterKits:delete:error">(
				"starterKits:delete:error",
				() => {
					pendingDelete = null
				}
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	const SOURCE_WORD: Record<Row["source"], string> = {
		core: "Comes with Serene Pub",
		plugin: "Comes with a plugin",
		admin: "Made by an admin"
	}

	const columns: AdminChangelistColumn<Row>[] = [
		{
			key: "name",
			label: "Starter lorebook",
			primary: true,
			text: (r) => r.name,
			sortValue: (r) => r.name
		},
		{
			key: "rules",
			label: "Rules",
			text: (r) => r.rulesName,
			sortValue: (r) => r.rulesName
		},
		{
			key: "holds",
			label: "Holds",
			text: (r) => kitHoldsLine(r.counts).replace(/^Holds /, ""),
			sortValue: (r) =>
				r.counts.entries + r.counts.places + r.counts.cast,
			hideWhenStacked: true
		},
		{
			key: "source",
			label: "From",
			text: (r) => kitSourceLine(r),
			sortValue: (r) => (r.source === "admin" ? 1 : 0)
		},
		{
			key: "actions",
			label: "Actions",
			custom: true,
			class: "w-0 text-right"
		}
	]

	const filters: AdminChangelistFilter<Row>[] = [
		{
			key: "source",
			label: "Origin",
			values: (r) => r.source,
			optionLabel: (v) => SOURCE_WORD[v as Row["source"]] ?? v,
			order: ["core", "plugin", "admin"]
		},
		{ key: "rules", label: "Rules", values: (r) => r.rulesName || null }
	]

	function openInLorebooks(row: Row) {
		const id = kitBookId(row)
		if (id === null || !panelsCtx) return
		void openJumpHit(panelsCtx, { kind: "lorebook", id, title: row.name })
	}

	function startClone(row: Row) {
		cloneError = ""
		cloning = row
	}

	function confirmClone(name: string) {
		if (!cloning || pendingClone !== null) return
		cloneError = ""
		pendingClone = cloning.id
		socket.emit("starterKits:clone", {
			id: cloning.id,
			...(name.trim() ? { name: name.trim() } : {})
		})
	}

	const deletion = $derived<AdminDeletion | null>(
		deleting
			? {
					title: `Delete the starter lorebook "${deleting.name}"?`,
					summary:
						"People stop seeing it among the starter lorebooks. Lorebooks and sessions already started from it keep everything they copied. This cannot be undone.",
					objects: [{ label: deleting.name }],
					confirmLabel: "Delete starter lorebook"
				}
			: null
	)

	function confirmDelete() {
		const row = deleting
		deleting = null
		const lorebookId = row ? kitBookId(row) : null
		if (lorebookId === null) return
		pendingDelete = lorebookId
		socket.emit("starterKits:delete", { lorebookId })
	}
</script>

{#if deletion}
	<AdminDeleteConfirm
		{deletion}
		onConfirm={confirmDelete}
		onCancel={() => (deleting = null)}
	/>
{:else}
	<AdminChangelist
		title="Starter lorebooks"
		purpose="What people can start a lorebook or a session from: a world, its cast and its rules, copied whole into each new one. Clone one to make one you can edit in Lorebooks."
		{rows}
		rowKey={(r) => r.id}
		{columns}
		{filters}
		{loading}
		noun={{ singular: "starter lorebook", plural: "starter lorebooks" }}
		searchText={(r) =>
			`${r.name} ${r.rulesName} ${r.description} ${r.ownerName ?? ""}`}
		defaultSort="name"
		emptyIcon={Icons.Package}
		emptyMessage="No starter lorebooks yet. Open one of your lorebooks, then choose Save as starter lorebook in its Book settings."
	>
		{#snippet cell(row, col)}
			{#if col.key === "actions"}
				<span
					class="inline-flex justify-end gap-1"
					data-kit-actions={row.id}
				>
					{#if row.source === "admin" && row.mine}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface whitespace-nowrap"
							aria-label="Open {row.name} in Lorebooks"
							data-kit-open
							onclick={(e) => {
								e.stopPropagation()
								openInLorebooks(row)
							}}
						>
							<Icons.BookOpen size={14} aria-hidden="true" />
							Open in Lorebooks
						</button>
					{/if}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface whitespace-nowrap"
						aria-label="Clone {row.name}"
						data-kit-clone
						onclick={(e) => {
							e.stopPropagation()
							startClone(row)
						}}
					>
						<Icons.Copy size={14} aria-hidden="true" />
						Clone
					</button>
					{#if row.source === "admin"}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface text-error-600-400 whitespace-nowrap"
							aria-label="Delete {row.name}"
							data-kit-delete
							onclick={(e) => {
								e.stopPropagation()
								deleting = row
							}}
						>
							<Icons.Trash2 size={14} aria-hidden="true" />
							Delete
						</button>
					{/if}
				</span>
			{/if}
		{/snippet}
	</AdminChangelist>
{/if}

<NewNameModal
	open={cloning !== null}
	onOpenChange={(e) => {
		if (!e.open) cloning = null
	}}
	onConfirm={(name) => confirmClone(name)}
	onCancel={() => (cloning = null)}
	title={cloning ? `Clone ${cloning.name}` : "Clone starter lorebook"}
	description="A name for the new starter lorebook. You can edit it in Lorebooks once it is made."
	error={cloneError || undefined}
/>
