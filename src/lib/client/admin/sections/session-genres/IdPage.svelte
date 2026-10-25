<script lang="ts">
	import InlineError from "$lib/client/components/InlineError.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * Admin › Genres › one genre: its change form (Django admin; admin IA
	 * 2026-08-28, grown by B4, R66) — one genre's whole world, and the place
	 * its pub-wide decisions are made:
	 *
	 * - **Availability**: the genre's switch (off stops new sessions only,
	 *   Q-B4a) and its default preset (`session_presets.is_default`, note 27);
	 * - **Presets**: an editable admin inline (Django's `TabularInline`) —
	 *   each preset's name and "Offered", a Delete tick, **Add another
	 *   preset**, Show all / Hide all (Q-B4d), and a Change link to the
	 *   preset's own change form for its bindings;
	 * - the **event surface** and the **coverage** matrix (events × presets,
	 *   read-only, Q-B4b), each linking where it is changed;
	 * - **Plugin swaps** — the admin's switch per contribution
	 *   (`plugins.disabled_swaps`, Q-B4c).
	 *
	 * A genre made on this pub (`editable`, PLAN-pipeline-canvas-and-genre-
	 * authoring §6.2) adds, above all of that, a **Readiness** checklist
	 * (`genreReadiness.ts`), an editable **About**, its **Session fields**
	 * (a `SettingsSchema` definition editor with a live preview) and an
	 * **Events** card that writes the default preset's bindings (ruling 5);
	 * with plugins on, **Export as plugin…** packages it. Shipped genres keep
	 * the read-only surface and shape.
	 *
	 * **Pipelines** opens Admin › Pipelines (the Pipelines rail view that
	 * opened at this genre was retired 2026-10-12).
	 *
	 * Every switch, tick and new row is an unsaved edit until **Save** (owner
	 * ruling 2026-10-02: "levers wait for Save"; STYLE-GUIDE §6.14). The
	 * server takes these one setting at a time, so Save sends the difference
	 * as single writes in order (`saveInSequence`), waits for each answer, and
	 * says which landed — never "saved" before the last one has.
	 */
	import { getContext, onMount, tick, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		adminGoto as goto,
		adminPage as page,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import AdminList, { type AdminColumn } from "$lib/client/components/admin/AdminList.svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField from "$lib/client/components/admin/AdminField.svelte"
	import AdminInline from "$lib/client/components/admin/AdminInline.svelte"
	import type { AdminChangelistColumn } from "$lib/client/components/admin/changelist"
	import {
		inlineChanges,
		newInlineKey,
		savedInlineRow,
		type InlineRow
	} from "$lib/client/components/admin/inlineRows"
	import {
		saveErrors,
		saveInSequence,
		saveSummary,
		type SaveStep
	} from "$lib/client/admin/sequentialSave"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import PresetBindingsRows, {
		type PresetBindings
	} from "$lib/client/components/admin/PresetBindingsRows.svelte"
	import SettingsSchemaEditor, {
		rowProblems,
		rowsToSchema,
		schemaToRows,
		type FieldRow
	} from "./SettingsSchemaEditor.svelte"
	import { genreReadiness, type ReadinessAction } from "./genreReadiness"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `sessionGenres:`
	// is a RESTRICTED interest family, and this context exists only inside the
	// admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()
	const genreId = $derived(decodeURIComponent(page.params.id ?? ""))

	type Detail = Sockets.SessionAdmin.GenreDetail.Response
	type Preset = Sockets.SessionAdmin.PresetRow
	type SwapRow = Sockets.SessionAdmin.GenreDetail.SwapRow

	let detail = $state<Detail | null>(null)
	let loading = $state(true)

	/* ── the unsaved edits ──────────────────────────────────────────── */

	type PresetValues = { name: string; enabled: boolean }
	type Draft = {
		enabled: boolean
		/** The default preset's row key; "" for none. */
		defaultKey: string
		presets: InlineRow<PresetValues>[]
		/** Swap contribution key → switched on. */
		swaps: Record<string, boolean>
		/** Name, description, family — editable on a genre made on this pub. */
		about: { name: string; description: string; family: string }
		/** The new-session form's fields, as the editor holds them. */
		fields: FieldRow[]
		/** The SAVED default preset's bindings — the Events card writes them. */
		bindings: PresetBindings
	}

	const swapKeyOf = (r: SwapRow) => `${r.pluginId}|${r.spec}|${r.node}|${r.definition}`
	const presetKey = (id: number) => `id-${id}`

	function draftOf(live: Detail): Draft {
		const d = $state.snapshot(live) as Detail
		const def = d.presets.find((p) => p.id === d.genre?.defaultPresetId)
		return {
			enabled: !!d.genre?.enabled,
			defaultKey: d.genre?.defaultPresetId != null ? presetKey(d.genre.defaultPresetId) : "",
			presets: d.presets.map((p) => savedInlineRow(p.id, { name: p.name, enabled: p.enabled })),
			swaps: Object.fromEntries((d.swaps ?? []).map((r) => [swapKeyOf(r), r.enabled])),
			about: {
				name: d.genre?.name ?? "",
				description: d.genre?.description ?? "",
				family: d.genre?.family ?? ""
			},
			fields: schemaToRows(d.genre?.fields),
			bindings: { ...(def?.bindings ?? {}) }
		}
	}

	let draft = $state<Draft>({
		enabled: true,
		defaultKey: "",
		presets: [],
		swaps: {},
		about: { name: "", description: "", family: "" },
		fields: [],
		bindings: {}
	})
	/**
	 * Presets are a set (the server's order is not the form's), and a row's
	 * key is the form's own bookkeeping — a row created by this Save keeps
	 * its "new-" key until the next push rebuilds it.
	 */
	const edits = new UnsavedEdits(() => draft, {
		unordered: ["presets"],
		// A field row's uid is the editor's bookkeeping, minted afresh per read.
		ignore: ["presets.key", "fields.uid"]
	})
	const dirty = $derived(edits.dirty)
	adminUnsavedEdits(() => edits.dirty)

	/**
	 * `sessionGenres:detail` is not scoped, and the writes re-send it to
	 * every open hub: a detail for another genre is not this page's. Every
	 * push moves the saved snapshot; only a clean form is overwritten.
	 */
	const onDetail = (res: Detail) => {
		if (res.genre && res.genre.genreId !== untrack(() => genreId)) return
		detail = res
		loading = false
		if (!res.genre) return
		const next = draftOf(res)
		untrack(() => edits.adoptSaved(next, (d) => (draft = structuredClone(d))))
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * This genre's detail, asked for and listened for in one, with its
	 * refusal on the same handler — the not-found body is what the page
	 * renders. BARE: not scoped. `genreId` is read untracked: asked once.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"sessionGenres:detail:error">(
				"sessionGenres:detail:error",
				onDetail
			),
			interest.requestWithInterest(
				"sessionGenres:detail",
				{ genreId: untrack(() => genreId) },
				onDetail
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/* ── authoring: a genre made on this pub ────────────────────────── */

	const editable = $derived(detail?.genre?.editable === true)
	/** The SAVED default preset — the one the Events card binds. */
	const defaultPreset = $derived(
		detail?.genre?.defaultPresetId != null
			? detail.presets.find((p) => p.id === detail!.genre!.defaultPresetId)
			: undefined
	)
	const eventsEditable = $derived(editable && !!defaultPreset && !defaultPreset.isImmutable)
	const readiness = $derived(detail?.genre && editable ? genreReadiness(detail) : null)
	const fieldProblems = $derived(rowProblems(draft.fields))

	/** Scroll to one of this form's cards and put focus in it. */
	async function goToSection(section: string) {
		await tick()
		const el = document.getElementById(section)
		if (!el) return
		if (el instanceof HTMLDetailsElement) el.open = true
		el.scrollIntoView({ behavior: "smooth", block: "start" })
		el.querySelector<HTMLElement>("input:not([disabled]), textarea, button:not([disabled])")?.focus({
			preventScroll: true
		})
	}
	function runAction(a: ReadinessAction) {
		if (a.kind === "section") void goToSection(a.section)
		else if (a.kind === "href") void goto(a.href)
		else openExport()
	}

	/* ── export as plugin ───────────────────────────────────────────── */

	const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
	let exportOpen = $state(false)
	let exportVersion = $state("1.0.0")
	/** With source: the package plus what builds it (`exportScaffold.ts`). */
	let exportSource = $state(false)
	let exporting = $state(false)
	let exportError = $state<string | null>(null)
	const canExport = $derived(editable && detail?.genre?.pluginsEnabled === true)

	function openExport() {
		exportError = null
		exportOpen = true
	}
	function confirmExport() {
		const version = exportVersion.trim()
		if (!SEMVER.test(version)) {
			exportError = "A version is three numbers with dots, like 1.0.0."
			return
		}
		exportError = null
		exporting = true
		socket.emit("plugins:exportPackage", {
			genreId,
			version,
			...(exportSource ? { scaffold: true } : {})
		})
	}

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"plugins:exportPackage">("plugins:exportPackage", (res) => {
				if (!untrack(() => exporting)) return
				exporting = false
				exportOpen = false
				downloadBlob(res)
			}),
			interest.declareInterest<"plugins:exportPackage:error">(
				"plugins:exportPackage:error",
				(res) => {
					if (!untrack(() => exporting)) return
					exporting = false
					exportError = res.error ?? "The genre was not exported."
				}
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/* ── editing the rows ───────────────────────────────────────────── */

	const savedPreset = (row: InlineRow<PresetValues>): Preset | undefined =>
		row.id == null ? undefined : detail?.presets.find((p) => p.id === row.id)

	function addPreset() {
		draft.presets.push({
			key: newInlineKey(),
			id: null,
			values: { name: "", enabled: true },
			delete: false
		})
	}
	function removeNew(row: InlineRow<PresetValues>) {
		draft.presets = draft.presets.filter((r) => r.key !== row.key)
		if (draft.defaultKey === row.key) draft.defaultKey = ""
	}
	function tickDelete(row: InlineRow<PresetValues>, on: boolean) {
		const r = draft.presets.find((x) => x.key === row.key)
		if (!r) return
		r.delete = on
		// A preset on its way out cannot stay the default.
		if (on && draft.defaultKey === row.key) draft.defaultKey = ""
	}
	function offerAll(on: boolean) {
		for (const r of draft.presets) if (!r.delete) r.values.enabled = on
	}

	const defaultOptions = $derived([
		{ value: "", label: "None" },
		...draft.presets
			.filter((r) => !r.delete)
			.map((r) => ({
				value: r.key,
				label: (r.values.name.trim() || "Unnamed preset") + (r.id == null ? " (new)" : "")
			}))
	])

	/* ── save: the difference, one write at a time ──────────────────── */

	let saving = $state(false)
	let formErrors = $state<string[]>([])

	function land(intent: AdminSaveIntent) {
		if (intent === "save") void goto("/admin/session-genres")
	}

	async function save(intent: AdminSaveIntent) {
		if (!detail?.genre || saving) return
		formErrors = []
		if (!dirty) return land(intent)
		const unnamed = draft.presets.filter((r) => !r.delete && !r.values.name.trim())
		if (unnamed.length) {
			formErrors = [
				unnamed.length === 1
					? "A preset needs a name — fill in the empty name, or remove that row."
					: `${unnamed.length} presets need a name — fill them in, or remove those rows.`
			]
			return
		}

		if (editable && !draft.about.name.trim()) {
			formErrors = ["A genre needs a name — fill in About's Name."]
			return
		}
		if (editable && fieldProblems.size) {
			formErrors = ["A session field needs fixing before it can be saved — see Session fields."]
			return
		}

		const slug = genreId
		const saved = draftOf(detail)
		const work = $state.snapshot(draft) as Draft
		const changes = inlineChanges(
			saved.presets.map((r) => ({ id: r.id!, values: r.values })),
			work.presets
		)
		const nameOf = (row: InlineRow<PresetValues>) => row.values.name.trim()
		/** Row key → the id it is saved under, including rows this Save creates. */
		const idOf = new Map<string, number>(
			work.presets.filter((r) => r.id != null).map((r) => [r.key, Number(r.id)])
		)
		const steps: SaveStep[] = []

		if (work.enabled !== saved.enabled)
			steps.push({
				label: work.enabled ? "Offer the genre" : "Stop offering the genre",
				run: () =>
					awaitReply({
						socket,
						event: "sessionGenres:update",
						errorEvent: "sessionGenres:update:error",
						params: { slug, enabled: work.enabled },
						match: (r) => r.slug === slug
					})
			})

		// A genre made on this pub: its create document's `genre` block, as one
		// write (each is a new published version of the create pipeline).
		if (editable) {
			const params: Sockets.SessionAdmin.UpdateGenre.Params = { slug }
			const about = {
				name: work.about.name.trim(),
				description: work.about.description.trim(),
				family: work.about.family.trim()
			}
			const aboutChanged =
				about.name !== saved.about.name ||
				about.description !== saved.about.description ||
				about.family !== saved.about.family
			if (aboutChanged) Object.assign(params, about)
			const fields = rowsToSchema(work.fields)
			const fieldsChanged = JSON.stringify(fields) !== JSON.stringify(rowsToSchema(saved.fields))
			if (fieldsChanged) params.fields = fields
			if (aboutChanged || fieldsChanged)
				steps.push({
					label:
						aboutChanged && fieldsChanged
							? "About and session fields"
							: aboutChanged
								? "About"
								: "Session fields",
					run: () =>
						awaitReply({
							socket,
							event: "sessionGenres:update",
							errorEvent: "sessionGenres:update:error",
							params,
							match: (r) => r.slug === slug
						})
				})
		}

		// The Events card: the saved default preset's bindings (ruling 5).
		if (eventsEditable && defaultPreset && !sameBindings(work.bindings, saved.bindings)) {
			const id = defaultPreset.id
			const bindings = work.bindings
			steps.push({
				label: `Events of ${defaultPreset.name}`,
				run: () =>
					awaitReply({
						socket,
						event: "sessionPresets:update",
						errorEvent: "sessionPresets:update:error",
						params: { id, bindings },
						match: (r) => r.preset?.id === id
					})
			})
		}

		for (const row of changes.deleted) {
			const id = Number(row.id)
			steps.push({
				label: `Delete ${nameOf(row)}`,
				run: () =>
					awaitReply({
						socket,
						event: "sessionPresets:delete",
						errorEvent: "sessionPresets:delete:error",
						params: { id },
						match: (r) => r.id === id,
						matchError: (e) => (e as { id?: number })?.id === id
					}).then(() => {
						// Gone from the server, so gone from the form: a row the
						// push does not carry would otherwise stay "unsaved".
						draft.presets = draft.presets.filter((r) => r.key !== row.key)
					})
			})
		}

		for (const row of changes.added) {
			const name = nameOf(row)
			steps.push({
				label: `Add ${name}`,
				run: async () => {
					const res = await awaitReply({
						socket,
						event: "sessionPresets:create",
						errorEvent: "sessionPresets:create:error",
						params: { name, genreId: slug },
						match: (r) => r.preset?.genreId === slug && r.preset?.name === name
					})
					const id = res.preset!.id
					idOf.set(row.key, id)
					// The form's row is the saved one now: a refusal further on
					// must not offer to create it twice.
					const live = draft.presets.find((r) => r.key === row.key)
					if (live) live.id = id
					if (!row.values.enabled)
						await awaitReply({
							socket,
							event: "sessionPresets:update",
							errorEvent: "sessionPresets:update:error",
							params: { id, enabled: false },
							match: (r) => r.preset?.id === id
						})
				}
			})
		}

		for (const { row, fields } of changes.changed) {
			const id = Number(row.id)
			const params: Sockets.SessionAdmin.UpdatePreset.Params = { id }
			if (fields.includes("name")) params.name = nameOf(row)
			if (fields.includes("enabled")) params.enabled = row.values.enabled
			steps.push({
				label: nameOf(row),
				run: () =>
					awaitReply({
						socket,
						event: "sessionPresets:update",
						errorEvent: "sessionPresets:update:error",
						params,
						match: (r) => r.preset?.id === id
					})
			})
		}

		if (work.defaultKey !== saved.defaultKey) {
			if (work.defaultKey) {
				const row = work.presets.find((r) => r.key === work.defaultKey)
				const isNew = row?.id == null
				steps.push({
					label: `Default preset: ${row ? nameOf(row) : "?"}`,
					after: isNew && row ? [`Add ${nameOf(row)}`] : undefined,
					run: () => {
						const id = idOf.get(work.defaultKey)
						if (id == null) return Promise.reject(new Error("That preset was not saved."))
						return awaitReply({
							socket,
							event: "sessionPresets:update",
							errorEvent: "sessionPresets:update:error",
							params: { id, isDefault: true },
							match: (r) => r.preset?.id === id
						})
					}
				})
			} else {
				const was = idOf.get(saved.defaultKey)
				const going = changes.deleted.some((r) => r.key === saved.defaultKey)
				if (was != null && !going)
					steps.push({
						label: "Default preset: none",
						run: () =>
							awaitReply({
								socket,
								event: "sessionPresets:update",
								errorEvent: "sessionPresets:update:error",
								params: { id: was, isDefault: false },
								match: (r) => r.preset?.id === was
							})
					})
			}
		}

		for (const r of detail.swaps ?? []) {
			const want = work.swaps[swapKeyOf(r)]
			if (want === undefined || want === r.enabled) continue
			steps.push({
				label: `${want ? "Offer" : "Stop offering"} ${r.name}`,
				run: () =>
					awaitReply({
						socket,
						event: "sessionGenres:setSwapEnabled",
						errorEvent: "sessionGenres:setSwapEnabled:error",
						params: {
							pluginId: r.pluginId,
							spec: r.spec,
							node: r.node,
							definition: r.definition,
							enabled: want,
							genreId: slug
						},
						match: (res) => !!res.ok
					})
			})
		}

		saving = true
		const outcome = await saveInSequence(steps)
		saving = false
		// Creates and deletes do not re-send the hub; ask for it, so the
		// saved snapshot is what the server now holds.
		socket.emit("sessionGenres:detail", { genreId: slug })
		const name = detail?.genre?.name ?? slug
		if (outcome.refused.length || outcome.skipped.length) {
			formErrors = saveErrors(outcome)
			toaster.warning({ title: saveSummary(outcome, name) })
			return
		}
		toaster.success({ title: saveSummary(outcome, name) })
		land(intent)
	}

	function sameBindings(a: PresetBindings, b: PresetBindings): boolean {
		const flat = (x: PresetBindings) =>
			JSON.stringify(
				Object.keys(x)
					.sort()
					.map((k) => [k, x[k]!.spec, x[k]!.config ?? null])
			)
		return flat(a) === flat(b)
	}

	/* ── the inline's columns ───────────────────────────────────────── */

	const presetColumns: AdminChangelistColumn<InlineRow<PresetValues>>[] = [
		{ key: "name", label: "Preset", primary: true, custom: true, text: (r) => r.values.name },
		{ key: "enabled", label: "Offered", custom: true },
		{ key: "bindings", label: "Bindings", custom: true }
	]

	/* ── the event surface ──────────────────────────────────────────── */

	type Slot = Sockets.SessionAdmin.GenreDetail.Slot
	const slotColumns: AdminColumn<Slot>[] = [
		{ key: "event", label: "Event", value: (s) => s.event },
		{
			key: "standing",
			label: "Standing",
			value: (s) => (s.required ? 0 : s.open ? 2 : 1)
		},
		{ key: "candidates", label: "Serving pipelines" }
	]
	const eventHref = (event: string) =>
		`/admin/pipelines/events/${encodeURIComponent(event)}?genre=${encodeURIComponent(genreId)}`

	/* ── the coverage matrix: events × presets (read-only, Q-B4b) ──── */

	/** Open slots take any number of pipelines, so no preset binds them. */
	const matrixSlots = $derived((detail?.slots ?? []).filter((s) => !s.open))
	const specName = (slug: string) => {
		for (const s of detail?.slots ?? [])
			for (const c of s.candidates) if (c.slug === slug) return c.name
		return slug
	}
	type Cell =
		| { kind: "bound"; spec: string; stale: boolean }
		| { kind: "missing" }
		| { kind: "unbound" }
	function cellOf(p: Preset, s: Slot): Cell {
		const b = p.bindings[s.event]
		if (b?.spec)
			return {
				kind: "bound",
				spec: b.spec,
				stale: !!p.staleBindings?.some((x) => x.event === s.event)
			}
		return s.required ? { kind: "missing" } : { kind: "unbound" }
	}
	function boundCount(p: Preset | undefined): string {
		if (!p) return "Filled from the event locks when saved"
		const bindable = matrixSlots.length
		const bound = matrixSlots.filter((s) => p.bindings[s.event]?.spec).length
		const missing = matrixSlots.filter((s) => s.required && !p.bindings[s.event]?.spec).length
		return `${bound} of ${bindable}${missing ? ` · ${missing} required unbound` : ""}`
	}

	/* ── swap contributions (Q-B4c) ─────────────────────────────────── */

	const swapGroups = $derived.by(() => {
		const groups = new Map<
			string,
			{ specName: string; spec: string; node: string; rows: SwapRow[] }
		>()
		for (const r of detail?.swaps ?? []) {
			const k = `${r.spec}#${r.node}`
			const g = groups.get(k) ?? { specName: r.specName, spec: r.spec, node: r.node, rows: [] }
			g.rows.push(r)
			groups.set(k, g)
		}
		return [...groups.values()]
	})

	const LEGEND = "text-surface-600-400 text-xs font-medium"
</script>

<svelte:head>
	<title>{detail?.genre?.name ?? "Genre"} · Admin · Serene Pub</title>
</svelte:head>

	{#snippet coverageCell(c: Cell)}
		{#if c.kind === "bound"}
			<a class="anchor" href="/admin/pipelines/{encodeURIComponent(c.spec)}" title={c.spec}>
				{specName(c.spec)}
			</a>
			{#if c.stale}
				<span class="text-warning-600-400">· not installed</span>
			{/if}
		{:else if c.kind === "missing"}
			<span class="text-error-600-400">required, unbound</span>
		{:else}
			<span class="text-surface-600-400">—</span>
		{/if}
	{/snippet}

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading genre…
	</div>
{:else if !detail?.genre}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">{detail?.error ?? "This genre no longer exists."}</p>
		<a href="/admin/session-genres" class="btn btn-sm preset-tonal-surface">All genres</a>
	</div>
{:else}
	{@const genre = detail.genre}
	<AdminChangeForm
		mode="change"
		title={genre.name}
		purpose={genre.description || undefined}
		noun="genre"
		changelistHref="/admin/session-genres"
		changelistLabel="Genres"
		{dirty}
		{saving}
		addAnother={false}
		errors={formErrors}
		onSave={save}
	>
		{#snippet headerActions()}
			<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines">
				<Icons.Workflow size={14} aria-hidden="true" /> Pipelines
			</a>
			<a
				class="btn btn-sm preset-tonal-surface"
				href="/admin/pipelines/events?genre={encodeURIComponent(genreId)}"
			>
				<Icons.Zap size={14} aria-hidden="true" /> Events
			</a>
			{#if genre.createSpecSlug}
				<a
					class="btn btn-sm preset-tonal-surface"
					href="/admin/pipelines/{encodeURIComponent(genre.createSpecSlug)}"
				>
					<Icons.Workflow size={14} aria-hidden="true" /> Create pipeline
				</a>
			{/if}
			<a class="btn btn-sm preset-tonal-surface" href="/admin/plugins">
				<Icons.Puzzle size={14} aria-hidden="true" /> Plugins
			</a>
			{#if canExport}
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={openExport}>
					<Icons.PackageOpen size={14} aria-hidden="true" /> Export as plugin…
				</button>
			{/if}
		{/snippet}
		{#snippet headerExtra()}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				{#if genre.family}
					<span class="border-surface-200-800 text-surface-600-400 rounded-full border px-2 py-0.5">
						{genre.family}
					</span>
				{/if}
				<span class="text-surface-600-400 font-mono">{genreId}</span>
			</div>
		{/snippet}

		{#if readiness}
			<section class="panel-card flex flex-col gap-3" aria-labelledby="genre-readiness-heading" id="readiness">
				<div class="flex items-center gap-2">
					<h2 id="genre-readiness-heading" class="text-sm font-medium">Readiness</h2>
					<span class="text-surface-600-400 text-meta">
						{readiness.lines.filter((l) => l.done).length} of {readiness.lines.length}
					</span>
				</div>
				<ul class="flex flex-col gap-3">
					{#each readiness.lines as line (line.id)}
						<li class="flex flex-wrap items-start gap-3" data-readiness={line.id} data-done={line.done}>
							<span
								class="mt-1.5 size-2 shrink-0 rounded-full {line.done
									? 'bg-success-500'
									: 'bg-primary-500'}"
								aria-hidden="true"
							></span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">
									<span class="sr-only">{line.done ? "Done:" : "To do:"}</span>
									{line.label}
									{#if line.optional}
										<span class="text-surface-600-400 text-xs font-normal">· optional</span>
									{/if}
								</p>
								<p class="text-surface-600-400 text-xs">{line.detail}</p>
							</div>
							{#if line.action}
								<button
									type="button"
									class="btn btn-sm preset-tonal-primary shrink-0"
									onclick={() => runAction(line.action!)}
								>
									{line.action.label}
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if editable}
			<AdminFieldset
				id="about"
				title="About"
				description="What people see when they pick the genre. Saving publishes a new version of its create pipeline."
			>
				<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
					<AdminField id="genre-about-name" label="Name" required>
						<input
							id="genre-about-name"
							class="input"
							type="text"
							bind:value={draft.about.name}
						/>
					</AdminField>
					<AdminField id="genre-about-family" label="Family" help="Groups genres in the picker.">
						<input
							id="genre-about-family"
							class="input"
							type="text"
							bind:value={draft.about.family}
							aria-describedby="genre-about-family-help"
						/>
					</AdminField>
					<AdminField
						id="genre-about-description"
						label="Description"
						class="@min-[36rem]/content:col-span-2"
					>
						<textarea
							id="genre-about-description"
							class="textarea"
							rows={2}
							bind:value={draft.about.description}
						></textarea>
					</AdminField>
				</div>
			</AdminFieldset>

			<AdminFieldset
				id="session-fields"
				title="Session fields"
				description="What the new-session form asks for. Each answer is stored with the session, where its pipelines read it."
			>
				<SettingsSchemaEditor bind:rows={draft.fields} idPrefix="genre-field" />
			</AdminFieldset>
		{/if}

		<AdminFieldset id="availability" title="Availability">
			<label class="flex min-h-10 items-center gap-2 text-sm">
				<input type="checkbox" class="checkbox" bind:checked={draft.enabled} />
				People can start {genre.name} sessions
			</label>
			<p class="text-surface-600-400 -mt-2 text-xs">
				{draft.enabled
					? "The genre is offered when someone starts a session."
					: "Hidden from the picker, and new sessions are refused. Existing sessions keep running."}
				{detail.sessionCount}
				{detail.sessionCount === 1 ? "session uses" : "sessions use"} it.
			</p>
			<AdminField
				id="genre-admin-default-preset"
				label="Default preset"
				help="New {genre.name} sessions start from it."
			>
				<Select
					label="Default preset"
					labelHidden
					class="w-full max-w-xs text-sm"
					options={defaultOptions}
					value={draft.defaultKey}
					onValueChange={(v) => (draft.defaultKey = v ?? "")}
				/>
			</AdminField>
		</AdminFieldset>

		<AdminInline
			id="presets"
			title="Presets"
			description="A preset carries its pipelines, events and configurations together, so hiding it takes all of them out of the picker.{draft.enabled
				? ''
				: ' While the genre is off, none of them is offered, whatever its tick says.'} Bindings are changed on each preset's own page."
			editable
			addNoun="preset"
			rows={draft.presets}
			rowKey={(r) => r.key}
			columns={presetColumns}
			emptyMessage="No presets for this genre yet."
			onAdd={addPreset}
			isNew={(r) => r.id == null}
			isDeleted={(r) => r.delete}
			onDeleteChange={tickDelete}
			onRemove={removeNew}
			canDelete={(r) => (savedPreset(r)?.isImmutable ? "Built-in" : true)}
			changeHref={(r) => (r.id != null ? `/admin/session-presets/${r.id}` : undefined)}
		>
			{#snippet actions()}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					disabled={!draft.presets.length}
					onclick={() => offerAll(true)}
				>
					Show all
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					disabled={!draft.presets.length}
					onclick={() => offerAll(false)}
				>
					Hide all
				</button>
			{/snippet}
			{#snippet cell(row, col)}
				{@const saved = savedPreset(row)}
				{#if col.key === "name"}
					{#if saved?.isImmutable}
						<span class="flex min-w-0 items-center gap-1.5">
							<span class="truncate font-medium">{row.values.name}</span>
							<Badge size="sm" class="shrink-0">built-in</Badge>
						</span>
					{:else}
						<input
							class="input min-w-[10rem] text-sm"
							type="text"
							aria-label="Preset name"
							placeholder="Name the preset"
							disabled={row.delete}
							bind:value={row.values.name}
						/>
					{/if}
				{:else if col.key === "enabled"}
					<label class="inline-flex min-h-8 items-center gap-2 text-xs">
						<input
							type="checkbox"
							class="checkbox"
							disabled={row.delete}
							bind:checked={row.values.enabled}
						/>
						{row.values.enabled ? "offered" : "hidden"}
						<span class="sr-only">— {row.values.name || "new preset"}</span>
					</label>
				{:else if col.key === "bindings"}
					<span class="text-surface-600-400 text-xs">{boundCount(saved)}</span>
				{/if}
			{/snippet}
		</AdminInline>

		{#if eventsEditable && defaultPreset}
			<AdminFieldset
				id="events"
				title="Events"
				description="Which pipeline answers each event in {defaultPreset.name}, the default preset. Only pipelines whose lock names this genre are offered; open events take any number and are not bound here."
			>
				<PresetBindingsRows
					slots={detail.slots}
					bind:bindings={draft.bindings}
					stale={defaultPreset.staleBindings ?? []}
				/>
			</AdminFieldset>
		{:else}
		<AdminFieldset
			id="events"
			title="Event surface"
			description="What this genre declares, and which published pipelines answer each event. A preset binds the events that are not open; required ones must be bound for a preset to be offered."
		>
			<AdminList
				rows={detail.slots}
				columns={slotColumns}
				searchText={(s) => s.event}
				searchPlaceholder="Search events…"
				defaultSort="standing"
				storageKey="serene-pub:adminView:genreSlots"
				emptyMessage="This genre declares no events — its declaration predates the event surface."
			>
				{#snippet cell(slot, col)}
					{#if col.key === "event"}
						<a class="anchor font-mono text-xs font-semibold" href={eventHref(slot.event)}>
							{slot.event}
						</a>
					{:else if col.key === "standing"}
						{#if slot.required}
							<Badge tone="primary" size="md">required</Badge>
						{:else if slot.open}
							<span class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs">open</span>
						{:else}
							<Badge size="md">optional</Badge>
						{/if}
					{:else if col.key === "candidates"}
						{#if slot.candidates.length}
							<span class="flex flex-wrap gap-1.5">
								{#each slot.candidates as c (c.slug)}
									<a
										class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs hover:underline"
										href="/admin/pipelines/{encodeURIComponent(c.slug)}"
										title={c.slug}
									>
										{c.name}
									</a>
								{/each}
							</span>
						{:else}
							<span class="text-surface-600-400 text-xs">nothing serves this yet</span>
						{/if}
					{/if}
				{/snippet}
			</AdminList>
		</AdminFieldset>
		{/if}

		{#if matrixSlots.length && detail.presets.length}
			<AdminFieldset
				title="Coverage"
				description="Which pipeline each saved preset runs for each event. To change one, open the preset."
			>
				<!-- The table needs ~700px of `content`; below that (the 400px
				     dock) each event reads as its own stacked block. -->
				<div class="hidden overflow-x-auto @min-[700px]/content:block">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-surface-200-800 border-b">
								<th scope="col" class="px-3 py-2 {LEGEND}">Event</th>
								{#each detail.presets as p (p.id)}
									<th scope="col" class="px-3 py-2 {LEGEND} whitespace-nowrap">
										<a class="anchor" href="/admin/session-presets/{p.id}">{p.name}</a>
										{#if !p.enabled}
											<span class="text-surface-600-400 font-normal">(hidden)</span>
										{/if}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each matrixSlots as s (s.event)}
								<tr class="border-surface-200-800 border-b last:border-0">
									<th scope="row" class="px-3 py-2 font-mono text-xs font-medium">
										<a class="anchor" href={eventHref(s.event)}>{s.event}</a>
									</th>
									{#each detail.presets as p (p.id)}
										<td class="px-3 py-2 text-xs whitespace-nowrap">
											{@render coverageCell(cellOf(p, s))}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<ul class="flex flex-col gap-3 @min-[700px]/content:hidden">
					{#each matrixSlots as s (s.event)}
						<li class="flex flex-col gap-2">
							<a class="anchor font-mono text-xs font-medium break-all" href={eventHref(s.event)}>
								{s.event}
							</a>
							<dl class="flex flex-col gap-1.5">
								{#each detail.presets as p (p.id)}
									<div class="flex flex-col">
										<dt class={LEGEND}>
											<a class="anchor" href="/admin/session-presets/{p.id}">{p.name}</a
											>{#if !p.enabled}<span class="font-normal"> (hidden)</span>{/if}
										</dt>
										<dd class="min-w-0 text-xs break-words">
											{@render coverageCell(cellOf(p, s))}
										</dd>
									</div>
								{/each}
							</dl>
						</li>
					{/each}
				</ul>
			</AdminFieldset>
		{/if}

		<AdminFieldset
			id="swaps"
			title="Plugin swaps"
			description="Steps a plugin offers as alternatives in this genre's pipelines. A contribution switched off is not offered to any session, and a plugin's reinstall keeps your choice."
		>
			{#if swapGroups.length}
				{#each swapGroups as g (`${g.spec}#${g.node}`)}
					<div class="flex flex-col gap-1.5">
						<p class="text-sm">
							<a class="anchor font-medium" href="/admin/pipelines/{encodeURIComponent(g.spec)}">
								{g.specName}
							</a>
							<span class="text-surface-600-400">· step</span>
							<span class="font-mono text-xs">{g.node}</span>
						</p>
						<ul class="flex flex-col gap-1">
							{#each g.rows as r (swapKeyOf(r))}
								<li>
									<label class="flex min-h-10 items-start gap-2 text-sm">
										<input
											type="checkbox"
											class="checkbox mt-0.5"
											bind:checked={draft.swaps[swapKeyOf(r)]}
										/>
										<span class="min-w-0">
											{r.name}
											<span class="text-surface-600-400 block text-xs">from {r.pluginName}</span>
										</span>
									</label>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			{:else}
				<p class="text-surface-600-400 text-sm">
					No installed plugin offers a swap for this genre's pipelines.
				</p>
			{/if}
		</AdminFieldset>

		{#if !editable}
			<AdminFieldset title="Shape" description="The genre's declared shape, as the server reads it." collapsible>
				<pre
					class="bg-surface-50-950 overflow-x-auto rounded-base p-2 font-mono text-meta">{JSON.stringify(
						genre.shape,
						null,
						2
					)}</pre>
			</AdminFieldset>
		{/if}
	</AdminChangeForm>

	<!-- ── export as plugin ─────────────────────────────────────────── -->
	<Dialog open={exportOpen} onOpenChange={(e) => (exportOpen = e.open)}>
		<Portal>
			<Dialog.Backdrop class="bg-surface-950/60 fixed inset-0 z-50" />
			<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
				<Dialog.Content
					class="bg-surface-100-900 border-surface-200-800 flex w-[30rem] max-w-full flex-col gap-3 rounded-container border p-4"
				>
					<Dialog.Title class="text-base font-semibold">Export {genre.name} as a plugin</Dialog.Title>
					<Dialog.Description class="text-surface-600-400 text-sm">
						A zip of its pipelines, preset, configurations and layout, under its owner slug — installable on another pub from Admin › Plugins.
					</Dialog.Description>
					<label class="flex flex-col gap-1 text-sm">
						<span class="font-medium">Version</span>
						<input
							class="input font-mono"
							placeholder="1.0.0"
							bind:value={exportVersion}
							aria-describedby="genre-export-hint"
							onkeydown={(e) => e.key === "Enter" && confirmExport()}
						/>
						<span id="genre-export-hint" class="text-surface-600-400 text-xs">
							Three numbers with dots. Raise it each time you share a changed copy.
						</span>
					</label>
					<label class="flex min-h-10 items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="checkbox"
							bind:checked={exportSource}
							aria-describedby="genre-export-source-hint"
						/>
						Include the source
					</label>
					<p id="genre-export-source-hint" class="text-surface-600-400 -mt-2 text-xs">
						Adds the files a developer edits and rebuilds it from with the Serene Pub SDK. Its README lists what is left to write.
					</p>
					{#if exportError}<InlineError>{exportError}</InlineError>{/if}
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500"
						disabled={exporting}
						onclick={confirmExport}
					>
						<Icons.Download size={14} aria-hidden="true" />
						{exporting ? "Exporting…" : "Export"}
					</button>
					<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (exportOpen = false)}>
						Cancel
					</button>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
