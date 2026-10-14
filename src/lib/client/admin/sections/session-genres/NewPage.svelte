<script lang="ts">
	/**
	 * Admin › Genres › Add genre (PLAN-pipeline-canvas-and-genre-authoring
	 * §6.2): a genre on this pub is made as a COPY of a listed one — its create
	 * pipeline always, and with **everything** its reply, turn order, answer
	 * form and action pipelines too — under an owner slug of the admin's own,
	 * with one preset bound like the source's default. Nothing exists until a
	 * Save (the explicit-save rule); the change form it lands on is where the
	 * copy is made the admin's own.
	 *
	 * `?from=<genre id>` preselects the genre to start from (Chat otherwise).
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
	import AdminChangeForm from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import {
		OWNER_SLUG,
		SPEC_NAME
	} from "$lib/client/components/pipelines/workspace/canvas/draft.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// is a RESTRICTED interest family.
	const interest = getAdminInterestContext()

	const CHAT = "core:genre/chat"

	let genres = $state<Sockets.SessionAdmin.GenreRow[]>([])
	let loading = $state(true)

	let ownerSlug = $state("")
	let name = $state("")
	let label = $state("")
	let description = $state("")
	let family = $state("")
	let from = $state("")
	let scope = $state<"all" | "create">("all")
	const dirty = $derived(
		!!ownerSlug.trim() || !!name.trim() || !!label.trim() || !!description.trim()
	)
	adminUnsavedEdits(() => dirty && !saving)

	const families = $derived(
		[...new Set(genres.map((g) => g.family).filter(Boolean))].sort()
	)
	const fromName = $derived(genres.find((g) => g.slug === from)?.name ?? "the genre")

	let saving = $state(false)
	let pending = false
	let formErrors = $state<string[]>([])
	let ownerError = $state<string | null>(null)
	let nameError = $state<string | null>(null)
	let labelError = $state<string | null>(null)

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"sessionGenres:create">("sessionGenres:create", (res) => {
				if (!pending || !res.genreId) return
				pending = false
				saving = false
				ownerSlug = name = label = description = ""
				void adminGoto(`/admin/session-genres/${encodeURIComponent(res.genreId)}`, {
					replaceState: true
				})
			}),
			interest.declareInterest<"sessionGenres:create:error">("sessionGenres:create:error", (res) => {
				if (!pending) return
				pending = false
				saving = false
				const error = res.error ?? "The genre was not added."
				// The server's refusals are sentences; each lands on the field it is about.
				if (/owner|slug/i.test(error)) ownerError = error
				else if (/name|already/i.test(error)) nameError = error
				else formErrors = [error]
			}),
			interest.requestWithInterest("sessionGenres:list", {}, (res) => {
				genres = res.genres
				if (!from) {
					const want = adminPage.url.searchParams.get("from")
					from =
						(want && res.genres.find((g) => g.slug === want)?.slug) ||
						res.genres.find((g) => g.slug === CHAT)?.slug ||
						res.genres[0]?.slug ||
						""
				}
				loading = false
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function check(): boolean {
		const owner = ownerSlug.trim()
		const n = name.trim()
		ownerError = !owner
			? "An owner slug is needed — every id you make lives under it."
			: owner === "core"
				? "“core” belongs to Serene Pub — pick a slug of your own."
				: OWNER_SLUG.test(owner)
					? null
					: "Use lower-case letters, digits, dots and dashes, starting and ending with a letter or digit."
		nameError = !n
			? "A genre needs a name."
			: SPEC_NAME.test(n)
				? null
				: "Use lower-case letters, digits and single dashes."
		labelError = label.trim() ? null : "A genre needs a label — it is what people pick."
		formErrors = []
		return !ownerError && !nameError && !labelError && !!from
	}

	function save() {
		if (saving || !check()) return
		saving = true
		pending = true
		socket.emit("sessionGenres:create", {
			ownerSlug: ownerSlug.trim(),
			name: name.trim(),
			label: label.trim(),
			description: description.trim() || undefined,
			family: family.trim() || undefined,
			from,
			scope
		})
	}
</script>

<AdminChangeForm
	mode="add"
	title="Add genre"
	purpose="A new genre starts as a copy of one you have — its pipelines and a preset bound like the original's — under an owner slug of your own."
	noun="genre"
	changelistHref="/admin/session-genres"
	changelistLabel="Genres"
	{dirty}
	{saving}
	addAnother={false}
	canSave={!loading && !!from && !saving}
	errors={formErrors}
	fieldErrors={{
		"genre-new-owner": ownerError,
		"genre-new-name": nameError,
		"genre-new-label": labelError
	}}
	onSave={save}
>
	<AdminFieldset title="Genre">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField
				id="genre-new-owner"
				label="Owner slug"
				required
				error={ownerError}
				help="Lower-case letters, digits, dots and dashes. Every id you make lives under it, and it never changes."
			>
				<input
					id="genre-new-owner"
					class="input font-mono"
					type="text"
					placeholder="acme.lab"
					autocomplete="off"
					spellcheck="false"
					bind:value={ownerSlug}
					aria-invalid={!!ownerError}
					aria-describedby={describedBy("genre-new-owner", !!ownerError)}
				/>
			</AdminField>
			<AdminField
				id="genre-new-name"
				label="Genre name"
				required
				error={nameError}
				help="Part of the genre's id, and of every pipeline copied for it."
			>
				<input
					id="genre-new-name"
					class="input font-mono"
					type="text"
					placeholder="quest"
					autocomplete="off"
					spellcheck="false"
					bind:value={name}
					aria-invalid={!!nameError}
					aria-describedby={describedBy("genre-new-name", !!nameError)}
				/>
			</AdminField>
			{#if ownerSlug.trim() && name.trim()}
				<p class="text-surface-600-400 font-mono text-xs @min-[36rem]/content:col-span-2">
					{ownerSlug.trim()}:genre/{name.trim()}
				</p>
			{/if}
			<AdminField
				id="genre-new-label"
				label="Label"
				required
				error={labelError}
				help="What people pick when they start a session."
			>
				<input
					id="genre-new-label"
					class="input"
					type="text"
					placeholder="Quest"
					bind:value={label}
					aria-invalid={!!labelError}
					aria-describedby={describedBy("genre-new-label", !!labelError)}
				/>
			</AdminField>
			<AdminField id="genre-new-family" label="Family" help="Groups genres in the picker.">
				<input
					id="genre-new-family"
					class="input"
					type="text"
					list="genre-new-families"
					bind:value={family}
					aria-describedby={describedBy("genre-new-family", false)}
				/>
				<datalist id="genre-new-families">
					{#each families as f (f)}<option value={f}></option>{/each}
				</datalist>
			</AdminField>
			<AdminField
				id="genre-new-description"
				label="Description"
				class="@min-[36rem]/content:col-span-2"
			>
				<textarea
					id="genre-new-description"
					class="textarea"
					rows={2}
					bind:value={description}
				></textarea>
			</AdminField>
		</div>
	</AdminFieldset>

	<AdminFieldset title="Copied from">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField
				id="genre-new-from"
				label="Start from"
				required
				help="Its pipelines, preset, stats and layout are the starting point."
			>
				<Select
					label="Start from"
					labelHidden
					options={genres.map((g) => ({ value: g.slug, label: g.name }))}
					bind:value={from}
					placeholder={loading ? "Loading genres…" : "Pick a genre"}
					describedBy={describedBy("genre-new-from", false)}
				/>
			</AdminField>
			<fieldset class="flex flex-col gap-1">
				<legend class="mb-1 text-sm font-medium">Copy</legend>
				<label class="flex min-h-10 items-start gap-2 text-sm">
					<input
						type="radio"
						class="radio mt-0.5"
						name="genre-new-scope"
						value="all"
						bind:group={scope}
					/>
					<span>
						Everything
						<span class="text-surface-600-400 block text-xs">
							{fromName}'s create, reply, turn order, answer form and action pipelines.
						</span>
					</span>
				</label>
				<label class="flex min-h-10 items-start gap-2 text-sm">
					<input
						type="radio"
						class="radio mt-0.5"
						name="genre-new-scope"
						value="create"
						bind:group={scope}
					/>
					<span>
						The create pipeline only
						<span class="text-surface-600-400 block text-xs">
							Every other event is yours to bind.
						</span>
					</span>
				</label>
			</fieldset>
		</div>
	</AdminFieldset>
</AdminChangeForm>
