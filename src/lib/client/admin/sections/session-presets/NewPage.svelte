<script lang="ts">
	/**
	 * New-preset change page (23 §9). Nothing exists until Create — the
	 * explicit-save rule. Starting from an existing preset copies its
	 * selections server-side (fromPresetId); starting bare inherits every
	 * pipeline's default config.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const split = getContext<{ mode: "desk" | "compact" } | undefined>(
		ADMIN_SPLIT
	)
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// is a RESTRICTED interest family, and this context exists only inside the
	// admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()

	let types: Sockets.SessionAdmin.GenreRow[] = $state([])
	let presets: Sockets.SessionAdmin.PresetRow[] = $state([])
	let loading = $state(true)
	let creating = $state(false)

	let name = $state("")
	let description = $state("")
	let genreId = $state("")
	let fromPresetId: string = $state("")

	/**
	 * What is typed is what leaving would lose; the genre and copy-source
	 * pickers open on defaults and are one click to redo.
	 */
	const edits = new UnsavedEdits(() => ({
		name: name.trim(),
		description: description.trim()
	}))
	edits.markSaved({ name: "", description: "" })
	adminUnsavedEdits(() => edits.dirty)

	let copyCandidates = $derived(presets.filter((p) => p.genreId === genreId))
	let canCreate = $derived(!!name.trim() && !!genreId && !creating)

	const onTypes = (res: Sockets.SessionAdmin.Genres.Response) => {
		types = res.genres
		if (!genreId && res.genres.length) genreId = res.genres[0].slug
		loading = false
	}
	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		presets = res.presets
	}
	const onCreated = (res: Sockets.SessionAdmin.CreatePreset.Response) => {
		if (!creating) return
		creating = false
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}
		if (res.preset) {
			toaster.success({ title: `Created "${res.preset.name}"` })
			edits.forget()
			goto(`/admin/session-presets/${res.preset.id}`)
		}
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * The genres this form picks from and the presets it can copy, each asked
	 * for and listened for in one, plus the create's answer — a STANDING key,
	 * because it lands whenever the person presses Create rather than in reply
	 * to anything asked here. All BARE: a preset is the instance's.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"sessionPresets:create">(
				"sessionPresets:create",
				onCreated
			),
			interest.requestWithInterest("sessionGenres:list", {}, onTypes),
			interest.requestWithInterest("sessionPresets:list", {}, onPresets)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	// Changing type invalidates a copy-source from another type.
	$effect(() => {
		if (
			fromPresetId &&
			!copyCandidates.some((p) => String(p.id) === fromPresetId)
		)
			fromPresetId = ""
	})

	function create() {
		if (!canCreate) return
		creating = true
		socket.emit("sessionPresets:create", {
			name: name.trim(),
			genreId,
			description: description.trim() || undefined,
			fromPresetId: fromPresetId ? Number(fromPresetId) : undefined
		})
	}
</script>

{#if split?.mode !== "desk"}
	<a
		href="/admin/session-presets"
		class="text-surface-600-400 hover:text-surface-950-50 mb-3 inline-flex items-center gap-1 self-start text-[13px]"
	>
		<Icons.ChevronLeft size={14} /> Back to presets
	</a>
{/if}

<h2
	class="text-surface-950-50 mb-4 [font-family:var(--typo-heading--font-family)] text-base font-semibold"
>
	New session preset
</h2>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else}
	<div class="panel-card flex max-w-[820px] flex-col gap-3">
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Name</span>
			<input
				class="input"
				bind:value={name}
				placeholder="e.g. Fast local chat"
			/>
		</label>
		<Select
			class="text-sm"
			label="Session genre"
			options={types.map((t) => ({
				value: t.slug,
				label: `${t.name} (${t.slug})`
			}))}
			bind:value={genreId}
		/>
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Description</span>
			<textarea
				class="textarea w-full"
				rows={2}
				bind:value={description}
				placeholder="What this preset is for — shown on the picker card."
			></textarea>
		</label>
		<Select
			class="text-sm"
			label="Start from"
			options={[
				{ value: "", label: "Bare — every pipeline's default config" },
				...copyCandidates.map((p) => ({
					value: String(p.id),
					label: `Copy of "${p.name}"`
				}))
			]}
			bind:value={fromPresetId}
		/>

		<div class="flex flex-wrap items-center gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				disabled={!canCreate}
				onclick={create}
			>
				<Icons.Plus size={14} /> Create preset
			</button>
			<a
				class="btn btn-sm preset-tonal-surface"
				href="/admin/session-presets"
			>
				Cancel
			</a>
			<span class="text-surface-600-400 text-xs">
				Nothing is saved until you create it.
			</span>
		</div>
	</div>
{/if}
