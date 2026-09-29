<script lang="ts">
	/**
	 * One preset's change page — the admin's mirror of the modder's
	 * `preset()` (24 §7, admin IA 2026-08-28). A preset populates its genre's
	 * event slots: for each non-open slot, a pipeline whose input lock
	 * answers it, and optionally a named configuration of that pipeline.
	 * Required slots must be bound for the preset to be enabled — rendered
	 * live here, enforced again by the server with the same sentences.
	 *
	 * Everything is a draft behind an explicit Save (the standing rule);
	 * built-ins accept availability flags only — duplicate to change what
	 * they bind.
	 */
	import { getContext, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		getAdminInterestContext,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { eventDisplayName } from "$lib/client/utils/eventName"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const split = getContext<{ mode: "desk" | "compact" } | undefined>(
		ADMIN_SPLIT
	)
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b) for the restricted
	// `sessionGenres:` family; `pipelines:configsIndex` below is a MIXED
	// family and goes through the app-wide module functions.
	const interest = getAdminInterestContext()
	let id = $derived(Number(page.params.id))

	type Row = Sockets.SessionAdmin.PresetRow
	type Slot = Sockets.SessionAdmin.GenreDetail.Slot
	type ConfigRow = Sockets.Pipelines.ConfigsIndex.Row

	let presets: Row[] = $state([])
	let slots: Slot[] = $state([])
	let configs: ConfigRow[] = $state([])
	let loading = $state(true)
	let row = $derived(presets.find((p) => p.id === id))
	let readonly = $derived(!!row?.isImmutable)

	/* ── draft ──────────────────────────────────────────────────────── */

	let name = $state("")
	let description = $state("")
	let enabled = $state(true)
	let isDefault = $state(false)
	let bindings = $state<Record<string, { spec: string; config?: number }>>({})
	let detailRequested = $state(false)

	/* The creation pre-fill (23 §9) — the keys the new-session form reads. */
	let defName = $state("")
	let defScenario = $state("")
	let defTags = $state("")
	/**
	 * Everything else the blob holds, carried through untouched.
	 *
	 * `defaults` is loose JSON a genre or a plugin may put its own keys in
	 * (`genreFields`, `lorebookId`), and this form edits three of them. Saving
	 * the three alone would silently delete the rest, which is the one way a
	 * partial editor can do real damage.
	 */
	let defExtra = $state<Record<string, unknown>>({})

	/** `{}` and absent are the same fact; only one of them is stored. */
	const asDefaults = (d: Record<string, unknown> | null | undefined) =>
		d && Object.keys(d).length ? d : null

	/** What Save sends, and what the unsaved-edits compare reads. */
	type Draft = {
		name: string
		description: string
		enabled: boolean
		isDefault: boolean
		bindings: Record<string, { spec: string; config?: number }>
		defaults: Record<string, unknown> | null
	}
	const draftOf = (r: Row): Draft => ({
		name: r.name,
		description: r.description ?? "",
		enabled: r.enabled,
		isDefault: r.isDefault,
		bindings: structuredClone($state.snapshot(r.bindings) ?? {}),
		defaults: asDefaults(
			structuredClone($state.snapshot(r.defaults) ?? {}) as Record<
				string,
				unknown
			>
		)
	})
	function applyDraft(next: Draft) {
		name = next.name
		description = next.description
		enabled = next.enabled
		isDefault = next.isDefault
		bindings = structuredClone(next.bindings)
		const d = structuredClone(next.defaults ?? {}) as Record<string, unknown>
		defName = typeof d.name === "string" ? d.name : ""
		defScenario = typeof d.scenario === "string" ? d.scenario : ""
		defTags = Array.isArray(d.tags)
			? d.tags
					.filter((t): t is string => typeof t === "string")
					.join(", ")
			: ""
		const { name: _n, scenario: _s, tags: _t, ...rest } = d
		defExtra = rest
	}

	const defaults = $derived.by(() => {
		const out: Record<string, unknown> = { ...defExtra }
		const tags = defTags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean)
		if (defName.trim()) out.name = defName.trim()
		if (defScenario.trim()) out.scenario = defScenario.trim()
		if (tags.length) out.tags = tags
		return asDefaults(out)
	})

	// The genre's event surface arrives once the row names the genre.
	$effect(() => {
		if (!row || detailRequested) return
		detailRequested = true
		socket.emit("sessionGenres:detail", { genreId: row.genreId })
	})

	/**
	 * Deep and key-order blind (`sameFormValue`): the row comes back from the
	 * server with its JSON keys in the database's order, never the form's.
	 * Every push of the row moves the saved snapshot; only a clean form is
	 * overwritten by it.
	 */
	const edits = new UnsavedEdits(
		(): Draft => ({ name, description, enabled, isDefault, bindings, defaults }),
		{ unordered: ["defaults.tags"] }
	)
	$effect(() => {
		if (loading || !row) return
		const next = draftOf(row)
		untrack(() => edits.adoptSaved(next, applyDraft))
	})
	let dirty = $derived(edits.dirty)
	adminUnsavedEdits(() => edits.dirty)

	/**
	 * Slots the instance cannot honour (ruled 2026-09-10), from the boot
	 * reconcile's notices, keyed by event so a slot can wear its own mark.
	 *
	 * Read off the row rather than recomputed here: the reconcile and the run
	 * ask one predicate, and a third opinion on this screen is how the form
	 * comes to call healthy a slot the sessions are falling back on.
	 */
	const staleByEvent = $derived(
		new Map((row?.staleBindings ?? []).map((b) => [b.event, b]))
	)

	/** Non-open slots are the bindable ones; open slots are the action list. */
	const bindableSlots = $derived(slots.filter((s) => !s.open))
	const missingRequired = $derived(
		bindableSlots
			.filter((s) => s.required && !bindings[s.event]?.spec)
			.map((s) => s.event)
	)

	const configsOf = (specSlug: string) =>
		configs.filter((c) => c.specSlug === specSlug)

	function setSlotSpec(event: string, spec: string) {
		if (!spec) {
			const next = { ...bindings }
			delete next[event]
			bindings = next
			return
		}
		// A new pipeline means its configs — the old selection is meaningless.
		bindings = { ...bindings, [event]: { spec } }
	}

	function setSlotConfig(event: string, raw: string) {
		const b = bindings[event]
		if (!b) return
		bindings = {
			...bindings,
			[event]: raw
				? { spec: b.spec, config: Number(raw) }
				: { spec: b.spec }
		}
	}

	/* ── wiring ─────────────────────────────────────────────────────── */

	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		presets = res.presets
		loading = false
	}
	/**
	 * `sessionGenres:detail` is not scoped, and the genre hub's writes
	 * re-send it for whichever genre they touched (R66): only this
	 * preset's genre is this editor's.
	 */
	const onDetail = (res: Sockets.SessionAdmin.GenreDetail.Response) => {
		if (res.genre && row && res.genre.genreId !== row.genreId) return
		slots = res.slots
	}
	const onConfigs = (res: Sockets.Pipelines.ConfigsIndex.Response) => {
		configs = res.configs
	}
	const onError = (res: { error?: string }) => {
		if (res.error) toaster.error({ title: res.error })
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * The preset list this form picks its row out of, asked for and listened
	 * for in one, plus the genre's event surface and the two refusals a save
	 * or a delete can come back with. All BARE — neither event has a
	 * `SCOPED_EVENTS` entry, so a key naming the id or the genre would match
	 * no payload at all.
	 *
	 * `sessionPresets:list` is STANDING: the server re-emits it after every
	 * write, which is how this form shows what it just saved.
	 * `sessionGenres:detail` is requested by the `row` effect above — it can
	 * only ask once the row names a genre, which is a round trip after this
	 * key exists.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"sessionGenres:detail">(
				"sessionGenres:detail",
				onDetail
			),
			interest.declareInterest<"sessionPresets:update:error">(
				"sessionPresets:update:error",
				onError
			),
			interest.declareInterest<"sessionPresets:delete:error">(
				"sessionPresets:delete:error",
				onError
			),
			interest.requestWithInterest("sessionPresets:list", {}, onPresets)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * The configurations a binding may name, asked for and listened for in one.
	 * BARE — the index spans every pipeline.
	 *
	 * The app-wide registry, not `adminInterest`: `pipelines:` is a MIXED
	 * family — most of its handlers answer every user — so this is an ordinary
	 * key, and the admin check here is the same one the redirect above makes.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return requestWithInterest("pipelines:configsIndex", {}, onConfigs)
	})

	function save() {
		if (!row || !dirty) return
		socket.emit("sessionPresets:update", {
			id,
			name,
			description: description || null,
			enabled,
			isDefault,
			...(readonly ? {} : { bindings, defaults })
		})
		toaster.success({ title: "Preset saved" })
	}
	function duplicate() {
		if (!row) return
		socket.emit("sessionPresets:create", {
			name: `${row.name} copy`,
			genreId: row.genreId,
			description: row.description ?? undefined,
			fromPresetId: row.id
		})
		toaster.success({ title: "Preset duplicated" })
		goto("/admin/session-presets")
	}
	function remove() {
		if (!row || readonly) return
		if (
			!confirm(
				`Delete "${row.name}"? Sessions born from it keep running; they simply reference nothing.`
			)
		)
			return
		socket.emit("sessionPresets:delete", { id })
		edits.forget()
		goto("/admin/session-presets")
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
	class="text-surface-950-50 mb-4 flex flex-wrap items-center gap-2 [font-family:var(--typo-heading--font-family)] text-base font-semibold"
>
	{row?.name ?? "Preset"}
	{#if readonly}
		<span
			class="preset-tonal-surface rounded-full px-2 py-0.5 font-sans text-xs font-normal"
		>
			built-in · availability only
		</span>
	{/if}
</h2>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !row}
	<div class="panel-card text-surface-600-400 py-8 text-center text-sm">
		This preset no longer exists.
		<a class="underline" href="/admin/session-presets">Back to the list</a>
		.
	</div>
{:else}
	<div class="flex max-w-[820px] flex-col gap-4">
		<!-- A slot the instance cannot honour (ruled 2026-09-10). First on the
		     page because it is the one thing here that is currently untrue:
		     every session on this preset is running something else for that
		     event. It says so rather than blocking — nothing is stopped, and
		     the fix is a rebind, which is what the button goes to. -->
		{#if row.staleBindings?.length}
			<div
				class="preset-tonal-warning flex flex-wrap items-start gap-3 rounded-[12px] p-3"
				role="status"
			>
				<Icons.TriangleAlert size={18} class="mt-0.5 shrink-0" />
				<div class="flex min-w-0 flex-1 flex-col gap-1 text-sm">
					<p class="font-semibold">
						{row.staleBindings.length === 1
							? "One binding is not available on this instance."
							: `${row.staleBindings.length} bindings are not available on this instance.`}
					</p>
					<ul class="flex flex-col gap-0.5 text-xs">
						{#each row.staleBindings as b (b.event)}
							<li>
								<span class="font-medium" title={b.event}>
									{eventDisplayName(b.event)}
								</span>
								is bound to
								<code class="font-mono">{b.bound}</code>
								— {b.reason}
								{#if b.fallbackSpec}
									Sessions run
									<code class="font-mono">
										{b.fallbackSpec}
									</code>
									instead.
								{:else}
									Nothing else answers this event, so it does
									not run at all.
								{/if}
							</li>
						{/each}
					</ul>
				</div>
				<a
					class="btn btn-sm preset-tonal-surface shrink-0"
					href="#bindings"
				>
					<Icons.Link2 size={14} /> Rebind
				</a>
			</div>
		{/if}

		<div class="panel-card flex flex-col gap-3">
			<div class="field-row">
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Name</span>
					<input class="input" bind:value={name} {readonly} />
				</label>
				<div class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Genre</span>
					<a
						class="input flex items-center font-mono text-xs hover:underline"
						href="/admin/session-genres/{encodeURIComponent(
							row.genreId
						)}"
						title="Open the genre dashboard"
					>
						{row.genreId}
					</a>
				</div>
			</div>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Description</span>
				<textarea
					class="textarea w-full"
					rows={2}
					{readonly}
					bind:value={description}
				></textarea>
			</label>
			<div class="flex flex-wrap gap-4">
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox"
						bind:checked={enabled}
					/>
					Available to users
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox"
						bind:checked={isDefault}
					/>
					Default for its genre
				</label>
			</div>
		</div>

		<!-- ── the bindings: the genre's event slots, filled ─────────── -->
		<section id="bindings" class="panel-card flex flex-col gap-3">
			<div>
				<h3 class="text-sm font-semibold">Event bindings</h3>
				<p class="text-surface-600-400 text-xs">
					For each event the genre declares: which pipeline answers,
					with which configuration. Only pipelines whose declared lock
					matches the slot are offered — the same rule the authoring
					kit enforces.
				</p>
			</div>

			{#if !bindableSlots.length}
				<p class="text-surface-600-400 text-sm italic">
					Waiting for the genre's event surface…
				</p>
			{/if}

			{#each bindableSlots as slot (slot.event)}
				{@const bound = bindings[slot.event]}
				<div
					class="bg-surface-50-950 flex flex-col gap-2 rounded-[10px] p-3"
				>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-semibold" title={slot.event}>
							{eventDisplayName(slot.event)}
						</span>
						{#if slot.required}
							<span
								class="preset-tonal-primary rounded-full px-1.5 py-0.5 text-[11px]"
							>
								required
							</span>
						{:else}
							<span
								class="preset-tonal-surface rounded-full px-1.5 py-0.5 text-[11px]"
							>
								optional
							</span>
						{/if}
						{#if slot.required && !bound?.spec}
							<span class="text-warning-500 text-xs">
								<Icons.TriangleAlert
									size={12}
									class="mr-0.5 inline"
								/>unbound
							</span>
						{/if}
						<!-- The saved binding does not resolve on this
						     instance. Distinct from "unbound" above, which is a
						     slot nobody filled: this one IS filled, and what it
						     names is absent. -->
						{#if staleByEvent.get(slot.event)}
							<span
								class="text-warning-500 text-xs"
								title={staleByEvent.get(slot.event)!.reason}
							>
								<Icons.TriangleAlert
									size={12}
									class="mr-0.5 inline"
								/>{staleByEvent.get(slot.event)!.bound} is not available
							</span>
						{/if}
					</div>
					<div class="field-row">
						<div class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400" aria-hidden="true">Pipeline</span>
							<Select
								label="Pipeline"
								labelHidden
								disabled={readonly}
								placeholder={slot.required ? "— choose —" : undefined}
								options={[
									...(slot.required
										? []
										: [{ value: "", label: "— unbound —" }]),
									...slot.candidates.map((c) => ({
										value: c.slug,
										label: c.name
									}))
								]}
								value={bound?.spec ?? ""}
								onValueChange={(v) => setSlotSpec(slot.event, v)}
							/>
						</div>
						<div class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400" aria-hidden="true">
								Configuration
							</span>
							<Select
								label="Configuration"
								labelHidden
								disabled={readonly || !bound?.spec}
								options={[
									{ value: "", label: "shipped default" },
									...(bound?.spec
										? configsOf(bound.spec).map((c) => ({
												value: String(c.id),
												label: `${c.isDefault ? "★ " : ""}${c.name}`
											}))
										: [])
								]}
								value={bound?.config != null
									? String(bound.config)
									: ""}
								onValueChange={(v) => setSlotConfig(slot.event, v)}
							/>
						</div>
					</div>
					{#if bound?.spec}
						<a
							class="text-surface-600-400 self-start text-[11px] underline"
							href="/admin/pipelines/{encodeURIComponent(
								bound.spec
							)}{bound.config != null
								? `?config=${bound.config}`
								: ''}"
						>
							Open in workspace
						</a>
					{/if}
				</div>
			{/each}

			{#if readonly}
				<p class="text-surface-600-400 text-xs italic">
					This preset ships with Serene Pub or an extension, and
					updates replace it — its bindings are never edited in place.
					Duplicate it to change them.
				</p>
			{/if}
		</section>

		<!-- ── the creation pre-fill ────────────────────────────────── -->
		<section class="panel-card flex flex-col gap-3">
			<div>
				<h3 class="text-sm font-semibold">Creation defaults</h3>
				<p class="text-surface-600-400 text-xs">
					What the new-session form is pre-filled with when somebody
					starts from this preset. Every field is optional, and each
					is only a starting point — whoever creates the session can
					change it before creating.
				</p>
			</div>
			<div class="field-row">
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Session name</span>
					<input
						class="input"
						{readonly}
						placeholder="Left to the person creating it"
						bind:value={defName}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Tags</span>
					<input
						class="input"
						{readonly}
						placeholder="comma, separated"
						bind:value={defTags}
					/>
				</label>
			</div>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Scenario</span>
				<textarea
					class="textarea w-full"
					rows={3}
					{readonly}
					placeholder="Left to the person creating it"
					bind:value={defScenario}
				></textarea>
			</label>
			{#if Object.keys(defExtra).length}
				<p class="text-surface-600-400 text-xs italic">
					This preset also carries
					<span class="font-mono text-[11px]">
						{Object.keys(defExtra).join(", ")}
					</span>
					, which this screen does not edit and leaves untouched.
				</p>
			{/if}
		</section>

		{#if enabled && missingRequired.length}
			<div
				class="preset-tonal-warning flex items-start gap-2 rounded-[12px] p-3"
			>
				<Icons.TriangleAlert size={16} class="mt-0.5 shrink-0" />
				<p class="text-sm">
					An enabled preset must bind its required slots — missing:
					<span
						class="font-medium"
						title={missingRequired.join(", ")}
					>
						{missingRequired.map(eventDisplayName).join(", ")}
					</span>
					. The server will refuse this save.
				</p>
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				disabled={!dirty}
				onclick={save}
			>
				<Icons.Save size={14} /> Save
			</button>
			<div class="flex-1"></div>
			<button class="btn btn-sm preset-tonal-surface" onclick={duplicate}>
				<Icons.Copy size={14} /> Duplicate
			</button>
			{#if !readonly}
				<button class="btn btn-sm preset-tonal-error" onclick={remove}>
					<Icons.Trash2 size={14} /> Delete
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.field-row {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@container content (min-width: 640px) {
		.field-row {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
