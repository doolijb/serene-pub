<script lang="ts">
	/**
	 * Admin › Presets › Add preset (23 §9): the add form. Nothing exists until
	 * a Save — the explicit-save rule. Starting from an existing preset copies
	 * its selections server-side (`fromPresetId`); starting bare inherits
	 * every pipeline's default configuration. The bindings are set on the
	 * change form "Save and continue editing" lands on.
	 *
	 * `?genre=<id>` preselects the genre and `?from=<id>` the preset to copy
	 * (a genre's change form and a preset's Duplicate land here).
	 */
	import { getContext } from "svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		adminGoto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b).
	const interest = getAdminInterestContext()

	let genres = $state<Sockets.SessionAdmin.GenreRow[]>([])
	let presets = $state<Sockets.SessionAdmin.PresetRow[]>([])
	let loading = $state(true)

	let name = $state("")
	let description = $state("")
	let genreId = $state("")
	let fromPresetId = $state("")
	const dirty = $derived(!!name.trim() || !!description.trim())
	adminUnsavedEdits(() => dirty && !saving)

	const copyCandidates = $derived(presets.filter((p) => p.genreId === genreId))

	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])
	let nameError = $state<string | null>(null)

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"sessionPresets:create">("sessionPresets:create", (res) => {
				const intent = pendingIntent
				if (!intent) return
				pendingIntent = null
				saving = false
				if (!res.preset) return
				toaster.success({ title: `Added ${res.preset.name}` })
				name = ""
				description = ""
				if (intent === "save") void adminGoto("/admin/session-presets")
				else if (intent === "continue")
					void adminGoto(`/admin/session-presets/${res.preset.id}`, { replaceState: true })
			}),
			interest.declareInterest<"sessionPresets:create:error">(
				"sessionPresets:create:error",
				(res) => {
					if (!pendingIntent) return
					pendingIntent = null
					saving = false
					const error = res.error ?? "The preset was not added."
					if (/name/i.test(error)) nameError = error
					else formErrors = [error]
				}
			),
			interest.requestWithInterest("sessionGenres:list", {}, (res) => {
				genres = res.genres
				if (!genreId) {
					const want = adminPage.url.searchParams.get("genre")
					genreId =
						(want && res.genres.find((g) => g.slug === want)?.slug) ||
						res.genres[0]?.slug ||
						""
				}
				loading = false
			}),
			interest.requestWithInterest("sessionPresets:list", {}, (res) => {
				presets = res.presets
				const from = adminPage.url.searchParams.get("from")
				const src = from ? res.presets.find((p) => String(p.id) === from) : undefined
				if (src && !fromPresetId) {
					genreId = src.genreId
					fromPresetId = String(src.id)
				}
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function save(intent: AdminSaveIntent) {
		nameError = name.trim() ? null : "A preset needs a name."
		formErrors = []
		if (nameError || !genreId) return
		saving = true
		pendingIntent = intent
		socket.emit("sessionPresets:create", {
			name: name.trim(),
			genreId,
			description: description.trim() || undefined,
			...(fromPresetId ? { fromPresetId: Number(fromPresetId) } : {})
		})
	}
</script>

<AdminChangeForm
	mode="add"
	title="Add preset"
	purpose="A preset starts bare (every pipeline at its shipped configuration) or as a copy of another of its genre. You bind its events next."
	noun="preset"
	changelistHref="/admin/session-presets"
	changelistLabel="Presets"
	{dirty}
	{saving}
	canSave={!loading && !!genreId && !saving}
	errors={formErrors}
	fieldErrors={{ "preset-new-name": nameError }}
	onSave={save}
>
	<AdminFieldset title="Preset">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField id="preset-new-name" label="Name" required error={nameError}>
				<input
					id="preset-new-name"
					class="input"
					type="text"
					bind:value={name}
					aria-invalid={!!nameError}
					aria-describedby={describedBy("preset-new-name", !!nameError)}
				/>
			</AdminField>
			<AdminField
				id="preset-new-genre"
				label="Genre"
				required
				help="Decides which events the preset binds. Fixed once made."
			>
				<Select
					label="Genre"
					labelHidden
					options={genres.map((g) => ({ value: g.slug, label: g.name }))}
					value={genreId}
					onValueChange={(v) => {
						genreId = v
						fromPresetId = ""
					}}
					placeholder={loading ? "Loading genres…" : "Pick a genre"}
					describedBy={describedBy("preset-new-genre", false)}
				/>
			</AdminField>
			<AdminField
				id="preset-new-from"
				label="Start from"
				help="Copy another preset's bindings, configurations and actions."
			>
				<Select
					label="Start from"
					labelHidden
					options={[
						{ value: "", label: "Nothing — shipped configurations" },
						...copyCandidates.map((p) => ({ value: String(p.id), label: p.name }))
					]}
					bind:value={fromPresetId}
					describedBy={describedBy("preset-new-from", false)}
				/>
			</AdminField>
			<AdminField id="preset-new-description" label="Description" class="@min-[36rem]/content:col-span-2">
				<textarea
					id="preset-new-description"
					class="textarea"
					rows={2}
					bind:value={description}
				></textarea>
			</AdminField>
		</div>
	</AdminFieldset>
</AdminChangeForm>
