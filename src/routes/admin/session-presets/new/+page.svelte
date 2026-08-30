<script lang="ts">
	/**
	 * New-preset change page (23 §9). Nothing exists until Create — the
	 * explicit-save rule. Starting from an existing preset copies its
	 * selections server-side (fromPresetId); starting bare inherits every
	 * pipeline's default config.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	let types: Sockets.SessionAdmin.GenreRow[] = $state([])
	let presets: Sockets.SessionAdmin.PresetRow[] = $state([])
	let loading = $state(true)
	let creating = $state(false)

	let name = $state("")
	let description = $state("")
	let genreId = $state("")
	let fromPresetId: string = $state("")

	let copyCandidates = $derived(
		presets.filter((p) => p.genreId === genreId)
	)
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
			goto(`/admin/session-presets/${res.preset.id}`)
		}
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("sessionGenres:list", onTypes)
		socket.on("sessionPresets:list", onPresets)
		socket.on("sessionPresets:create", onCreated)
		socket.emit("sessionGenres:list", {})
		socket.emit("sessionPresets:list", {})
	})
	onDestroy(() => {
		socket.off("sessionGenres:list", onTypes)
		socket.off("sessionPresets:list", onPresets)
		socket.off("sessionPresets:create", onCreated)
	})

	// Changing type invalidates a copy-source from another type.
	$effect(() => {
		if (fromPresetId && !copyCandidates.some((p) => String(p.id) === fromPresetId))
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

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/session-presets" class="hover:underline">Presets</a>
			/ <strong>New</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Ticket size={20} /> New session preset
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/session-presets">
		<Icons.ArrowLeft size={16} /> Cancel
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else}
	<div class="form-max card preset-filled-surface-100-900 flex flex-col gap-3 p-4 shadow-sm">
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Name</span>
			<input
				class="input"
				bind:value={name}
				placeholder="e.g. Fast local chat"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Session genre</span>
			<select class="select" bind:value={genreId}>
				{#each types as t (t.slug)}
					<option value={t.slug}>{t.name} ({t.slug})</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Description</span>
			<textarea
				class="textarea w-full"
				rows={2}
				bind:value={description}
				placeholder="What this preset is for — shown on the picker card."
			></textarea>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Start from</span>
			<select class="select" bind:value={fromPresetId}>
				<option value="">Bare — every pipeline's default config</option>
				{#each copyCandidates as p (p.id)}
					<option value={String(p.id)}
						>Copy of "{p.name}"</option
					>
				{/each}
			</select>
		</label>

		<div class="flex items-center gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				disabled={!canCreate}
				onclick={create}
			>
				<Icons.Plus size={14} /> Create preset
			</button>
			<span class="text-surface-600-400 text-xs">
				Nothing is saved until you create it.
			</span>
		</div>
	</div>
{/if}

<style>
	.form-max {
		max-width: 48rem;
	}
</style>
