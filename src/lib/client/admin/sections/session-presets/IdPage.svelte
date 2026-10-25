<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * Admin › Presets › one preset: the change form (note 37, Django admin).
	 *
	 * 🚧 Since the layering restructure (PLAN-layering §4, P4, R2, R3; lane 7,
	 * 2026-10-21) a preset is **one set of changes on its genre's defaults**
	 * — never a copy, never a preset of a preset:
	 *
	 *  · **The genre's defaults**, read-only: what every preset of the genre
	 *    starts from — its registrations (what runs on each event, each action,
	 *    each routine) and its settings.
	 *  · **This preset's changes**: what a session on it runs, each row marked
	 *    as the genre's, changed here, or added here. A routine's mode, when it
	 *    runs (its cadence's options), Allow stacking and the cron caps; any
	 *    registration's condition (`when`, built only from the genre's derived
	 *    properties — A5); drop one, restore it; **Add** one — what it runs on,
	 *    then a pipeline from the list filtered by fit, each that does not fit
	 *    saying why (R4).
	 *  · **Settings**: each of the genre's settings — the genre's value, and
	 *    this preset's own with **Lock** (nothing below may change it) and
	 *    **Ask at start** (the start form asks it, A10).
	 *  · **Clone** with a title and a description: a new one-level preset with
	 *    these changes (R2).
	 *
	 * Everything is a draft behind an explicit Save (the standing rule); the
	 * server re-derives every key and runs the registration door, refusing in
	 * a sentence. Built-in presets accept availability only — clone one to
	 * change it. Named pipeline configurations and the per-preset bindings
	 * are retired (R38): a pipeline's values come from its registrations.
	 */
	import { getContext, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { eventDisplayName } from "$lib/client/utils/eventName"
	import AdminChangeForm, { type AdminSaveIntent } from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import { cadenceWords } from "$lib/shared/routines/cadenceWords"
	import { presetDeletion } from "./presetsAdmin"
	import RegistrationPicker from "./RegistrationPicker.svelte"
	import ConditionPicker from "./ConditionPicker.svelte"
	import {
		addRegistration,
		dropKey,
		droppedOf,
		effectiveOf,
		forSave,
		restoreKey,
		setCadenceOptions,
		setField,
		tidy,
		type Changes,
		type Reg
	} from "./presetChanges"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b) for the restricted
	// `sessionGenres:` family.
	const interest = getAdminInterestContext()
	let id = $derived(Number(page.params.id))

	type Row = Sockets.SessionAdmin.PresetRow
	type Editor = Sockets.SessionAdmin.PresetEditor.Response
	type Setting = Sockets.SessionAdmin.PresetEditor.Setting
	type Prop = Sockets.Sessions.ConditionProps.Prop
	type Candidate = Sockets.SessionAdmin.RegistrationCandidates.Candidate

	let presets: Row[] = $state([])
	let editor = $state<Editor | null>(null)
	let props = $state<Prop[]>([])
	let loading = $state(true)
	let row = $derived(presets.find((p) => p.id === id))
	let readonly = $derived(!!row?.isImmutable)

	/* ── draft ──────────────────────────────────────────────────────── */

	let name = $state("")
	let description = $state("")
	let enabled = $state(true)
	let isDefault = $state(false)
	let changes = $state<Changes>({})
	/** The preset's settings layer: a value each, or `{ value, lock?, askAtStart? }`. */
	let settings = $state<Record<string, unknown>>({})

	/* The creation pre-fill (23 §9) — the keys the new-session form reads. */
	let defName = $state("")
	let defScenario = $state("")
	let defTags = $state("")
	/** Everything else the pre-fill holds, carried through untouched. */
	let defExtra = $state<Record<string, unknown>>({})

	const asDefaults = (d: Record<string, unknown> | null | undefined) => (d && Object.keys(d).length ? d : null)

	type Draft = {
		name: string
		description: string
		enabled: boolean
		isDefault: boolean
		changes: Changes
		settings: Record<string, unknown>
		defaults: Record<string, unknown> | null
	}
	const draftOf = (r: Row, e: Editor | null): Draft => ({
		name: r.name,
		description: r.description ?? "",
		enabled: r.enabled,
		isDefault: r.isDefault,
		changes: tidy(structuredClone($state.snapshot(e?.changes ?? r.registrations ?? {})) as Changes),
		settings: structuredClone($state.snapshot(r.settings ?? {})) as Record<string, unknown>,
		defaults: asDefaults(structuredClone($state.snapshot(r.defaults) ?? {}) as Record<string, unknown>)
	})
	function applyDraft(next: Draft) {
		name = next.name
		description = next.description
		enabled = next.enabled
		isDefault = next.isDefault
		changes = structuredClone(next.changes)
		settings = structuredClone(next.settings)
		const d = structuredClone(next.defaults ?? {}) as Record<string, unknown>
		defName = typeof d.name === "string" ? d.name : ""
		defScenario = typeof d.scenario === "string" ? d.scenario : ""
		defTags = Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string").join(", ") : ""
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

	const edits = new UnsavedEdits((): Draft => ({ name, description, enabled, isDefault, changes, settings, defaults }), {
		unordered: ["defaults.tags"]
	})
	$effect(() => {
		if (loading || !row || !editor) return
		const next = draftOf(row, editor)
		untrack(() => edits.adoptSaved(next, applyDraft))
	})
	let dirty = $derived(edits.dirty)
	adminUnsavedEdits(() => edits.dirty)

	/* ── what the editor reads ──────────────────────────────────────── */

	const genreDefaults = $derived((editor?.defaults ?? []) as Reg[])
	const effective = $derived(effectiveOf(genreDefaults, changes))
	const dropped = $derived(droppedOf(genreDefaults, changes))
	const catalogue = $derived(editor?.catalogue ?? { events: [], actions: [], cadences: [] })
	/** 🚧 R56: each pipeline that needs a model nothing here serves, with the sentence that says what. */
	const unavailableOf = $derived(
		new Map(
			[...(editor?.defaults ?? []), ...(editor?.effective ?? [])]
				.filter((r) => !!r.unavailable)
				.map((r) => [r.pipeline, r.unavailable!] as const)
		)
	)

	const familyOf = (r: { trigger: Record<string, unknown> }) => String(r.trigger.family ?? "")
	const cadenceOf = (r: { trigger: Record<string, unknown> }) =>
		(r.trigger.cadence ?? { id: "", options: {} }) as { id: string; options?: Record<string, unknown> }
	const cadenceDecl = (cadenceId: string) => catalogue.cadences.find((c) => c.id === cadenceId)

	/** What a registration runs on, in words. */
	function triggerWords(r: { trigger: Record<string, unknown> }): string {
		const t = r.trigger
		if (t.family === "event") return eventDisplayName(String(t.event))
		if (t.family === "action") {
			const identity = String(t.action)
			return catalogue.actions.find((a) => a.identity === identity)?.name ?? identity
		}
		if (t.family === "routine") {
			const c = cadenceOf(r)
			return cadenceWords({ ...c, name: cadenceDecl(c.id)?.name }, { eventName: eventDisplayName })
		}
		return String(t.family)
	}

	const groups = <T extends Reg>(list: readonly T[]) => [
		{ id: "event", title: "On events", rows: list.filter((r) => familyOf(r) === "event") },
		{ id: "action", title: "Actions", rows: list.filter((r) => familyOf(r) === "action") },
		{ id: "routine", title: "Routines", rows: list.filter((r) => familyOf(r) === "routine") }
	]

	const MODES = [
		{ value: "off", label: "Off" },
		{ value: "review", label: "Review" },
		{ value: "full", label: "Full" }
	]
	const STANDING = { genre: "The genre's", changed: "Changed here", preset: "Added here" } as const

	/* ── edits ──────────────────────────────────────────────────────── */

	function edit(next: Changes) {
		changes = next
	}

	/**
	 * Set a routine's mode or Allow stacking: as a change of a genre default
	 * only where it differs from the default's own (equal, the change is
	 * cleared, so the genre's later edits still reach this preset).
	 */
	function setOwn(r: Reg, field: "mode" | "allowStacking", v: unknown, fallback: unknown) {
		const base = genreDefaults.find((d) => d.key === r.key)
		const own = (changes.register ?? []).some((x) => (x as { key?: unknown }).key === r.key)
		const baseValue = base ? (base[field] ?? fallback) : fallback
		edit(setField(changes, r.key, field, !own && JSON.stringify(v) === JSON.stringify(baseValue) ? undefined : v))
	}

	function setCap(r: Reg, key: "idleTimeoutMinutes" | "maxRunsInRow", input: HTMLInputElement) {
		const n = input.valueAsNumber
		const caps = { ...(r.caps ?? {}) } as Record<string, number>
		if (Number.isNaN(n)) delete caps[key]
		else caps[key] = Math.round(n)
		edit(setField(changes, r.key, "caps", Object.keys(caps).length ? caps : undefined))
	}

	function setOption(r: Reg, opt: string, value: unknown) {
		const c = cadenceOf(r)
		edit(setCadenceOptions(changes, genreDefaults, r.key, { ...(c.options ?? {}), [opt]: value }))
	}

	/* ── add a registration ─────────────────────────────────────────── */

	let adding = $state(false)
	let addFamily = $state<"event" | "action" | "routine">("event")
	let addEvent = $state("")
	let addAction = $state("")
	let addCadence = $state("")
	let addOptions = $state<Record<string, unknown>>({})
	let addMode = $state<"off" | "review" | "full">("full")
	let addPick = $state<Candidate | null>(null)

	const addTrigger = $derived.by((): Record<string, unknown> | null => {
		if (addFamily === "event") return addEvent ? { family: "event", event: addEvent } : null
		if (addFamily === "action") return addAction ? { family: "action", action: addAction } : null
		if (!addCadence) return null
		return { family: "routine", cadence: { id: addCadence, options: $state.snapshot(addOptions) } }
	})
	/** An action is usually run by the pipeline that declares it. */
	const suggested = $derived(
		addFamily === "action" ? (catalogue.actions.find((a) => a.identity === addAction)?.specSlug ?? null) : null
	)
	$effect(() => {
		void addTrigger
		addPick = null
	})
	$effect(() => {
		const decl = cadenceDecl(addCadence)
		untrack(() => {
			addOptions = Object.fromEntries(
				Object.entries(decl?.options ?? {})
					.filter(([, o]) => o.default !== undefined && o.control !== "json")
					.map(([k, o]) => [k, o.default])
			)
		})
	})

	function commitAdd() {
		if (!addTrigger || !addPick?.fits) return
		const { changes: next } = addRegistration(changes, addTrigger, addPick.slug, {
			...(addFamily === "routine" ? { mode: addMode } : {}),
			pipelineName: addPick.name
		})
		edit(next)
		adding = false
		addEvent = addAction = addCadence = ""
		addPick = null
	}

	/* ── settings ───────────────────────────────────────────────────── */

	const settingRows = $derived((editor?.settings ?? []) as Setting[])
	type Decision = { value: unknown; lock?: true; askAtStart?: true }
	const decisionOf = (key: string): Decision | null => {
		if (!(key in settings)) return null
		const v = settings[key] as unknown
		if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object) && Object.keys(v as object).every((k) => ["value", "lock", "askAtStart"].includes(k)))
			return v as Decision
		return { value: v }
	}
	function setDecision(key: string, d: Decision | null) {
		const next = { ...settings }
		if (!d) delete next[key]
		else next[key] = d.lock || d.askAtStart ? { value: d.value, ...(d.lock ? { lock: true } : {}), ...(d.askAtStart ? { askAtStart: true } : {}) } : d.value
		settings = next
	}
	const valueWords = (s: Setting, v: unknown): string => {
		if (v === undefined || v === null || v === "") return "Not set"
		if (s.control === "boolean") return v === true ? "On" : "Off"
		if (s.control === "enum") return s.members?.find((m) => m.key === v)?.label ?? String(v)
		if (s.control === "list" && Array.isArray(v))
			return v.length ? v.map((k) => s.members?.find((m) => m.key === k)?.label ?? String(k)).join(", ") : "None"
		// An object (the Author's note) is a set of values, not a line to read here.
		if (typeof v === "object") return "Its own set of values"
		return String(v)
	}
	const genreValue = (s: Setting) => (s.genre ? s.genre.value : s.declared)

	/* ── wiring ─────────────────────────────────────────────────────── */

	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		presets = res.presets
		loading = false
	}
	const onEditor = (res: Editor) => {
		if (res.presetId !== id) return
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}
		editor = res
	}
	const onError = (res: { error?: string }) => {
		if (res.error) toaster.error({ title: res.error })
	}
	let genres = $state<Sockets.SessionAdmin.GenreRow[]>([])
	const genreName = (slug: string) => genres.find((g) => g.slug === slug)?.name ?? slug

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"sessionPresets:update">("sessionPresets:update", onUpdated),
			interest.declareInterest<"sessionPresets:update:error">("sessionPresets:update:error", onUpdateError),
			interest.declareInterest<"sessionPresets:delete">("sessionPresets:delete", onDeleted),
			interest.declareInterest<"sessionPresets:delete:error">("sessionPresets:delete:error", onDeleteError),
			interest.declareInterest<"sessionPresets:create">("sessionPresets:create", onCloned),
			interest.declareInterest<"sessionPresets:create:error">("sessionPresets:create:error", onCloneError),
			interest.requestWithInterest("sessionPresets:list", {}, onPresets),
			interest.requestWithInterest("sessionGenres:list", {}, (res) => {
				genres = res.genres
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})
	/** The preset's own view: its genre's defaults, its changes, the catalogue. */
	$effect(() => {
		if (!userCtx.user?.isAdmin || !Number.isFinite(id)) return
		return requestWithInterest("sessionPresets:editor", { presetId: id }, onEditor)
	})
	/** What a condition may test — the genre's derived properties (A5). */
	$effect(() => {
		const genreId = row?.genreId
		if (!userCtx.user?.isAdmin || !genreId) return
		return requestWithInterest("sessions:conditionProps", { genreId }, (res) => {
			if (res.genreId === genreId) props = res.props ?? []
		})
	})

	// ── save ────────────────────────────────────────────────────────────
	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])
	let nameError = $state<string | null>(null)

	function save(intent: AdminSaveIntent) {
		if (!row) return
		nameError = name.trim() ? null : "A preset needs a name."
		formErrors = []
		if (nameError) return
		if (!dirty) return land(intent)
		saving = true
		pendingIntent = intent
		socket.emit("sessionPresets:update", {
			id,
			name: name.trim(),
			description: description || null,
			enabled,
			isDefault,
			...(readonly
				? {}
				: {
						registrations: forSave($state.snapshot(changes) as Changes),
						settings: Object.keys(settings).length ? ($state.snapshot(settings) as Record<string, unknown>) : null,
						defaults
					})
		})
	}
	function land(intent: AdminSaveIntent) {
		if (intent === "save") void goto("/admin/session-presets")
		else if (intent === "another") void goto(`/admin/session-presets/new?genre=${encodeURIComponent(row?.genreId ?? "")}`)
	}
	function onUpdated(res: Sockets.SessionAdmin.UpdatePreset.Response) {
		if (!res.preset || res.preset.id !== id) return
		const intent = pendingIntent
		if (!intent) return
		pendingIntent = null
		saving = false
		edits.markSaved()
		socket.emit("sessionPresets:editor", { presetId: id })
		toaster.success({ title: `Saved ${res.preset.name}` })
		land(intent)
	}
	function onUpdateError(res: { error?: string }) {
		if (!pendingIntent) {
			onError(res)
			return
		}
		pendingIntent = null
		saving = false
		formErrors = [res.error ?? "The preset was not saved."]
	}

	// ── clone and delete ────────────────────────────────────────────────
	let cloning = $state<{ name: string; description: string } | null>(null)
	let cloneSent = false
	function startClone() {
		if (!row) return
		cloning = { name: `${row.name} copy`, description: row.description ?? "" }
	}
	function commitClone() {
		if (!row || !cloning?.name.trim()) return
		cloneSent = true
		socket.emit("sessionPresets:create", {
			name: cloning.name.trim(),
			genreId: row.genreId,
			...(cloning.description.trim() ? { description: cloning.description.trim() } : {}),
			fromPresetId: row.id
		})
	}
	function onCloned(res: Sockets.SessionAdmin.CreatePreset.Response) {
		if (!cloneSent || !res.preset) return
		cloneSent = false
		cloning = null
		toaster.success({ title: `Cloned as ${res.preset.name}` })
		void goto(`/admin/session-presets/${res.preset.id}`)
	}
	function onCloneError(res: { error?: string }) {
		if (!cloneSent) return onError(res)
		cloneSent = false
		formErrors = [res.error ?? "The clone was not made."]
	}
	let deleting = false
	function remove() {
		if (!row || readonly) return
		deleting = true
		socket.emit("sessionPresets:delete", { id })
	}
	function onDeleted(res: Sockets.SessionAdmin.DeletePreset.Response) {
		if (!deleting || res.id !== id) return
		deleting = false
		edits.forget()
		toaster.success({ title: "Preset deleted" })
		void goto("/admin/session-presets", { replaceState: true })
	}
	function onDeleteError(res: { error?: string }) {
		if (!deleting) return onError(res)
		deleting = false
		formErrors = [res.error ?? "The preset was not deleted."]
	}
</script>

{#snippet regLine(r: Reg & { standing?: "genre" | "changed" | "preset" })}
	<span class="min-w-0 flex-1">
		<span class="block text-sm">
			<span class="font-medium">{triggerWords(r)}</span>
			<span class="text-surface-600-400"> → </span>
			<span title={r.pipeline}>{r.pipelineName}</span>
		</span>
		{#if familyOf(r) === "routine"}
			<span class="text-surface-600-400 block text-xs">
				{MODES.find((m) => m.value === (r.mode ?? "full"))?.label}{r.allowStacking ? " · Allow stacking" : ""}
			</span>
		{/if}
		{#if (familyOf(r) === "routine" || familyOf(r) === "action") && unavailableOf.get(r.pipeline)}
			<!-- 🚧 R56: disabled until a model is set for it. -->
			<span class="text-warning-700-300 block text-xs" data-unavailable>{unavailableOf.get(r.pipeline)}</span>
		{/if}
	</span>
{/snippet}

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading preset…
	</div>
{:else if !row}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no preset {id}.</p>
		<a href="/admin/session-presets" class="btn btn-sm preset-tonal-surface">All presets</a>
	</div>
{:else}
	<AdminChangeForm
		mode="change"
		title={name.trim() || row.name}
		purpose={readonly
			? "A built-in preset: only its availability can change here. Clone it to change what it runs."
			: "Changes on the genre's defaults: what a session started from this preset runs, and its settings."}
		noun="preset"
		changelistHref="/admin/session-presets"
		changelistLabel="Presets"
		{dirty}
		{saving}
		errors={formErrors}
		fieldErrors={{ "preset-admin-name": nameError }}
		deletion={readonly ? undefined : () => presetDeletion([row!], genreName)}
		onDelete={readonly ? undefined : remove}
		onSave={save}
	>
		{#snippet headerActions()}
			<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines">
				<Icons.Workflow size={16} aria-hidden="true" /> Pipelines
			</a>
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={startClone}>
				<Icons.Copy size={16} aria-hidden="true" /> Clone
			</button>
		{/snippet}
		{#snippet headerExtra()}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<a
					class="border-surface-200-800 text-surface-600-400 rounded-full border px-2 py-0.5 hover:underline"
					href="/admin/session-genres/{encodeURIComponent(row!.genreId)}"
				>
					{genreName(row!.genreId)}
				</a>
				{#if row!.isDefault}
					<span class="preset-tonal-primary rounded-full px-2 py-0.5">Default for its genre</span>
				{/if}
				{#if readonly}
					<span class="border-surface-200-800 text-surface-600-400 rounded-full border px-2 py-0.5">
						Built-in · availability only
					</span>
				{/if}
			</div>
		{/snippet}

		{#if cloning}
			<!-- Clone (R2): a new preset of the same genre carrying these
			     changes — one level, never a preset of a preset. -->
			<section class="panel-card flex flex-col gap-3" aria-labelledby="preset-clone-heading" data-testid="preset-clone">
				<h2 id="preset-clone-heading" class="text-sm font-medium">Clone this preset</h2>
				<FieldHelp>
					The clone starts with this preset's changes and settings, on the same genre's defaults.
				</FieldHelp>
				<div class="grid gap-3 @min-[36rem]/content:grid-cols-2">
					<label class="flex flex-col gap-1 text-sm">
						<span class="font-medium">Title</span>
						<input class="input" bind:value={cloning.name} />
					</label>
					<label class="flex flex-col gap-1 text-sm @min-[36rem]/content:col-span-2">
						<span class="font-medium">Description</span>
						<textarea class="textarea" rows={2} bind:value={cloning.description}></textarea>
					</label>
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500"
						disabled={!cloning.name.trim()}
						onclick={commitClone}
					>
						Create clone
					</button>
					<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (cloning = null)}>Cancel</button>
				</div>
			</section>
		{/if}

		{#if row.staleBindings?.length}
			<div class="preset-tonal-warning flex flex-wrap items-start gap-3 rounded-container p-3" role="status">
				<Icons.TriangleAlert size={18} class="mt-0.5 shrink-0" />
				<div class="flex min-w-0 flex-1 flex-col gap-1 text-sm">
					<p class="font-semibold">Something this preset runs is not available on this pub.</p>
					<ul class="flex flex-col gap-0.5 text-xs">
						{#each row.staleBindings as b (b.event)}
							<li>
								<span class="font-medium" title={b.event}>{eventDisplayName(b.event)}</span>
								runs <code class="font-mono">{b.bound}</code> — {b.reason}
							</li>
						{/each}
					</ul>
				</div>
				<a class="btn btn-sm preset-tonal-surface shrink-0" href="#changes">
					<Icons.ListChecks size={14} /> Review the changes
				</a>
			</div>
		{/if}

		<AdminFieldset title="Preset">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				{#if readonly}
					<AdminField id="preset-admin-name" label="Name" value={name} />
				{:else}
					<AdminField id="preset-admin-name" label="Name" required error={nameError}>
						<input
							id="preset-admin-name"
							class="input"
							type="text"
							bind:value={name}
							aria-invalid={!!nameError}
							aria-describedby={describedBy("preset-admin-name", !!nameError)}
						/>
					</AdminField>
				{/if}
				<AdminField id="preset-admin-genre" label="Genre" value={`${genreName(row.genreId)} (${row.genreId})`} />
				<AdminField id="preset-admin-description" label="Description" class="@min-[36rem]/content:col-span-2">
					<textarea id="preset-admin-description" class="textarea w-full" rows={2} {readonly} bind:value={description}></textarea>
				</AdminField>
			</div>
			<div class="flex flex-wrap gap-4">
				<label class="flex min-h-10 items-center gap-2 text-sm">
					<input type="checkbox" class="checkbox" bind:checked={enabled} />
					Available to users
				</label>
				<label class="flex min-h-10 items-center gap-2 text-sm">
					<input type="checkbox" class="checkbox" bind:checked={isDefault} />
					Default for its genre
				</label>
			</div>
		</AdminFieldset>

		{#if editor}
			<!-- ── the genre's defaults, read-only ─────────────────────── -->
			<AdminFieldset
				id="genre-defaults"
				title="The genre's defaults"
				description={`What every preset of ${editor.genreName ?? row.genreId} starts from. A preset changes these; it never edits them.`}
				collapsible
			>
				{#each groups(genreDefaults) as g (g.id)}
					{#if g.rows.length}
						<div class="flex flex-col gap-1" data-defaults-group={g.id}>
							<p class="text-surface-600-400 text-xs font-medium">{g.title}</p>
							<ul class="flex flex-col gap-1">
								{#each g.rows as r (r.key)}
									<li class="bg-surface-50-950 flex items-start gap-2 rounded-base px-3 py-2" data-default-registration={r.key}>
										{@render regLine(r)}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				{/each}
				{#if settingRows.some((s) => s.genre)}
					<div class="flex flex-col gap-1">
						<p class="text-surface-600-400 text-xs font-medium">Settings</p>
						<ul class="flex flex-col gap-0.5 text-sm">
							{#each settingRows.filter((s) => s.genre) as s (s.key)}
								<li>
									{s.label}: <span class="font-medium">{valueWords(s, s.genre!.value)}</span>
									{#if s.genre!.lock}<span class="text-surface-600-400 text-xs"> · locked</span>{/if}
									{#if s.genre!.askAtStart}<span class="text-surface-600-400 text-xs"> · asked at start</span>{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</AdminFieldset>

			<!-- ── this preset's changes ───────────────────────────────── -->
			<AdminFieldset
				id="changes"
				title="What this preset runs"
				description="The genre's defaults with this preset's changes. Change a routine, put a condition on anything, drop what this preset does not want, or add a pipeline."
			>
				{#if editor?.recommendations?.words}
					<!-- 🚧 R56: what it needs, and what would make it better. -->
					<p class="text-surface-600-400 text-xs" data-preset-recommendations>{editor.recommendations.words}</p>
				{/if}
				{#each groups(effective) as g (g.id)}
					{#if g.rows.length}
						<div class="flex flex-col gap-2" data-changes-group={g.id}>
							<p class="text-surface-600-400 text-xs font-medium">{g.title}</p>
							{#each g.rows as r (r.key)}
								{@const c = cadenceOf(r)}
								{@const decl = familyOf(r) === "routine" ? cadenceDecl(c.id) : undefined}
								<div class="bg-surface-50-950 flex flex-col gap-2 rounded-base p-3" data-registration={r.key} data-standing={r.standing}>
									<div class="flex flex-wrap items-start gap-2">
										{@render regLine(r)}
										<span
											class="shrink-0 rounded-full px-2 py-0.5 text-meta {r.standing === 'genre'
												? 'border-surface-300-700 text-surface-600-400 border'
												: 'preset-tonal-primary'}"
										>
											{STANDING[r.standing ?? "genre"]}
										</span>
										{#if !readonly}
											<button
												type="button"
												class="btn btn-sm preset-tonal-surface shrink-0"
												onclick={() => edit(dropKey(changes, genreDefaults, r.key))}
											>
												{r.standing === "preset" && !genreDefaults.some((d) => d.key === r.key) ? "Remove" : "Drop"}
											</button>
										{/if}
									</div>
									{#if familyOf(r) === "routine" && !readonly}
										<div class="flex flex-wrap items-end gap-3">
											<div class="w-36">
												<Select
													label="Mode"
													options={MODES}
													value={r.mode ?? "full"}
													onValueChange={(v) => setOwn(r, "mode", v, "full")}
												/>
											</div>
											{#each Object.entries(decl?.options ?? {}).filter(([, o]) => o.control !== "json") as [opt, o] (opt)}
												{#if o.control === "enum"}
													<div class="w-36">
														<Select
															label={o.label}
															options={(o.members ?? []).map((m) => ({ value: m.key, label: m.label }))}
															value={String(c.options?.[opt] ?? o.default ?? "")}
															onValueChange={(v) => setOption(r, opt, v)}
														/>
													</div>
												{:else if o.control === "boolean"}
													<label class="flex min-h-10 items-center gap-2 text-xs">
														<input
															type="checkbox"
															class="checkbox"
															checked={(c.options?.[opt] ?? o.default) === true}
															onchange={(e) => setOption(r, opt, e.currentTarget.checked)}
														/>
														{o.label}
													</label>
												{:else}
													<label class="flex flex-col gap-1 text-xs">
														<span class="text-surface-600-400">{o.label}</span>
														<input
															class="input w-28 rounded-base"
															type={o.control === "integer" || o.control === "number" ? "number" : "text"}
															min={o.min}
															max={o.max}
															value={c.options?.[opt] ?? o.default ?? ""}
															onchange={(e) =>
																setOption(
																	r,
																	opt,
																	o.control === "integer" || o.control === "number"
																		? e.currentTarget.valueAsNumber
																		: e.currentTarget.value
																)}
														/>
													</label>
												{/if}
											{/each}
											<label class="flex min-h-10 items-center gap-2 text-xs">
												<input
													type="checkbox"
													class="checkbox"
													checked={r.allowStacking === true}
													onchange={(e) => setOwn(r, "allowStacking", e.currentTarget.checked, false)}
												/>
												Allow stacking
											</label>
											{#if decl?.clock === "system"}
												<label class="flex flex-col gap-1 text-xs">
													<span class="text-surface-600-400">Idle cron timeout (minutes)</span>
													<input
														class="input w-28 rounded-base"
														type="number"
														min="5"
														value={r.caps?.idleTimeoutMinutes ?? ""}
														onchange={(e) => setCap(r, "idleTimeoutMinutes", e.currentTarget)}
													/>
												</label>
												<label class="flex flex-col gap-1 text-xs">
													<span class="text-surface-600-400">Most cron runs in a row</span>
													<input
														class="input w-28 rounded-base"
														type="number"
														min="1"
														value={r.caps?.maxRunsInRow ?? ""}
														onchange={(e) => setCap(r, "maxRunsInRow", e.currentTarget)}
													/>
												</label>
											{/if}
										</div>
									{/if}
									<ConditionPicker
										id={r.key}
										{props}
										when={r.when}
										{readonly}
										onchange={(w) => edit(setField(changes, r.key, "when", w))}
									/>
									{#if r.values && Object.keys(r.values).length}
										<p class="text-surface-600-400 text-xs">
											Changes {Object.keys(r.values).length === 1 ? "one step's" : `${Object.keys(r.values).length} steps'`} settings.
										</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/each}

				{#if dropped.length}
					<div class="flex flex-col gap-1">
						<p class="text-surface-600-400 text-xs font-medium">Dropped from the genre's defaults</p>
						{#each dropped as r (r.key)}
							<div class="flex items-center gap-2 rounded-base px-3 py-1.5 opacity-80" data-dropped={r.key}>
								{@render regLine(r)}
								{#if !readonly}
									<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => edit(restoreKey(changes, r.key))}>
										Restore
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				{#if !readonly}
					{#if !adding}
						<button type="button" class="btn btn-sm preset-tonal-primary self-start" onclick={() => (adding = true)}>
							<Icons.Plus size={16} aria-hidden="true" /> Add a pipeline
						</button>
					{:else}
						<section class="border-surface-200-800 flex flex-col gap-3 rounded-base border p-3" aria-labelledby="add-registration-heading">
							<h3 id="add-registration-heading" class="text-sm font-medium">Add a pipeline</h3>
							<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="What it runs on">
								{#each [{ k: "event", l: "An event" }, { k: "action", l: "An action" }, { k: "routine", l: "A routine" }] as f (f.k)}
									<button
										type="button"
										role="radio"
										aria-checked={addFamily === f.k}
										class="btn btn-sm min-h-11 {addFamily === f.k ? 'preset-pressed' : 'preset-tonal-surface'}"
										onclick={() => (addFamily = f.k as typeof addFamily)}
									>
										{f.l}
									</button>
								{/each}
							</div>
							{#if addFamily === "event"}
								<Select
									label="Event"
									options={catalogue.events.map((e) => ({ value: e.id, label: `${e.name} · carries ${e.carries.join(", ")}` }))}
									value={addEvent}
									placeholder="Pick an event"
									onValueChange={(v) => (addEvent = v)}
								/>
							{:else if addFamily === "action"}
								<Select
									label="Action"
									options={catalogue.actions.map((a) => ({ value: a.identity, label: a.name }))}
									value={addAction}
									placeholder="Pick an action"
									onValueChange={(v) => (addAction = v)}
								/>
							{:else}
								<Select
									label="Cadence"
									options={catalogue.cadences.map((c) => ({ value: c.id, label: c.name }))}
									value={addCadence}
									placeholder="Pick when it runs"
									onValueChange={(v) => (addCadence = v)}
								/>
								{#if cadenceDecl(addCadence)?.description}
									<FieldHelp>{cadenceDecl(addCadence)?.description}</FieldHelp>
								{/if}
								<div class="flex flex-wrap items-end gap-3">
									{#each Object.entries(cadenceDecl(addCadence)?.options ?? {}).filter(([, o]) => o.control !== "json") as [opt, o] (opt)}
										{#if o.control === "enum"}
											<div class="w-36">
												<Select
													label={o.label}
													options={(o.members ?? []).map((m) => ({ value: m.key, label: m.label }))}
													value={String(addOptions[opt] ?? "")}
													onValueChange={(v) => (addOptions = { ...addOptions, [opt]: v })}
												/>
											</div>
										{:else if o.control === "boolean"}
											<label class="flex min-h-10 items-center gap-2 text-xs">
												<input
													type="checkbox"
													class="checkbox"
													checked={addOptions[opt] === true}
													onchange={(e) => (addOptions = { ...addOptions, [opt]: e.currentTarget.checked })}
												/>
												{o.label}
											</label>
										{:else}
											<label class="flex flex-col gap-1 text-xs">
												<span class="text-surface-600-400">{o.label}</span>
												<input
													class="input w-28 rounded-base"
													type="number"
													min={o.min}
													max={o.max}
													value={addOptions[opt] ?? ""}
													onchange={(e) => (addOptions = { ...addOptions, [opt]: e.currentTarget.valueAsNumber })}
												/>
											</label>
										{/if}
									{/each}
									<div class="w-36">
										<Select label="Mode" options={MODES} value={addMode} onValueChange={(v) => (addMode = v as typeof addMode)} />
									</div>
								</div>
							{/if}
							<p class="text-sm font-medium">Which pipeline runs</p>
							<RegistrationPicker
								trigger={addTrigger}
								picked={addPick?.slug ?? null}
								{suggested}
								onpick={(c) => (addPick = c)}
							/>
							<div class="flex gap-2">
								<button
									type="button"
									class="btn btn-sm preset-filled-primary-500"
									disabled={!addTrigger || !addPick?.fits}
									onclick={commitAdd}
								>
									Add
								</button>
								<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (adding = false)}>Cancel</button>
							</div>
						</section>
					{/if}
				{:else}
					<p class="text-surface-600-400 text-xs italic">
						This preset ships with Serene Pub or an extension, and updates replace it — its changes are never edited in
						place. Clone it to change them.
					</p>
				{/if}
			</AdminFieldset>

			<!-- ── settings ───────────────────────────────────────────── -->
			{#if settingRows.length}
				<AdminFieldset
					id="settings"
					title="Settings"
					description="Each of the genre's settings: the genre's value, and this preset's own. Lock keeps sessions from changing it; Ask at start puts it on the start form."
				>
					<ul class="flex flex-col gap-2">
						{#each settingRows as s (s.key)}
							{@const d = decisionOf(s.key)}
							<li class="bg-surface-50-950 flex flex-col gap-2 rounded-base p-3" data-preset-setting={s.key}>
								<div class="flex flex-wrap items-baseline gap-2">
									<span class="text-sm font-medium">{s.label}</span>
									<span class="text-surface-600-400 text-xs">
										The genre's: {valueWords(s, genreValue(s))}{s.genre?.lock ? " · locked by the genre" : ""}
									</span>
								</div>
								{#if s.description}<FieldHelp>{s.description}</FieldHelp>{/if}
								{#if readonly || s.genre?.lock || s.control === "json"}
									<p class="text-xs">
										{d
											? `This preset: ${valueWords(s, d.value)}`
											: s.control === "json"
												? "Set in a session's settings."
												: "This preset leaves it to the genre."}
									</p>
								{:else if !d}
									<button
										type="button"
										class="anchor self-start text-xs"
										onclick={() => setDecision(s.key, { value: structuredClone($state.snapshot(genreValue(s)) as unknown) })}
									>
										Set it for this preset
									</button>
								{:else}
									<div class="flex flex-wrap items-end gap-3">
										{#if s.control === "boolean"}
											<label class="flex min-h-10 items-center gap-2 text-sm">
												<input
													type="checkbox"
													role="switch"
													class="checkbox"
													checked={d.value === true}
													onchange={(e) => setDecision(s.key, { ...d, value: e.currentTarget.checked })}
												/>
												{d.value === true ? "On" : "Off"}
											</label>
										{:else if s.control === "enum"}
											<div class="w-48">
												<Select
													label="Value"
													labelHidden
													options={(s.members ?? []).map((m) => ({ value: m.key, label: m.label }))}
													value={typeof d.value === "string" ? d.value : ""}
													onValueChange={(v) => setDecision(s.key, { ...d, value: v })}
												/>
											</div>
										{:else if s.control === "integer" || s.control === "number"}
											<input
												class="input w-28 rounded-base"
												type="number"
												aria-label="{s.label}: value"
												min={s.min}
												max={s.max}
												value={typeof d.value === "number" ? d.value : ""}
												onchange={(e) => setDecision(s.key, { ...d, value: e.currentTarget.valueAsNumber })}
											/>
										{:else if s.control === "list" && s.members?.length}
											<fieldset class="flex flex-wrap gap-3">
												<legend class="sr-only">{s.label}</legend>
												{#each s.members as m (m.key)}
													<label class="flex items-center gap-1.5 text-xs">
														<input
															type="checkbox"
															class="checkbox"
															checked={Array.isArray(d.value) && d.value.includes(m.key)}
															onchange={(e) => {
																const cur = new Set(Array.isArray(d.value) ? (d.value as string[]) : [])
																if (e.currentTarget.checked) cur.add(m.key)
																else cur.delete(m.key)
																setDecision(s.key, { ...d, value: (s.members ?? []).map((x) => x.key).filter((k) => cur.has(k)) })
															}}
														/>
														{m.label}
													</label>
												{/each}
											</fieldset>
										{:else if s.control === "string" || s.control === "text"}
											<input
												class="input min-w-[12rem] flex-1 rounded-base"
												type="text"
												aria-label="{s.label}: value"
												value={typeof d.value === "string" ? d.value : ""}
												onchange={(e) => setDecision(s.key, { ...d, value: e.currentTarget.value })}
											/>
										{:else}
											<p class="text-surface-600-400 text-xs">This preset: {valueWords(s, d.value)}</p>
										{/if}
										<label class="flex min-h-10 items-center gap-2 text-xs" title="Sessions on this preset cannot change it.">
											<input
												type="checkbox"
												class="checkbox"
												checked={d.lock === true}
												onchange={(e) => setDecision(s.key, { ...d, lock: e.currentTarget.checked ? true : undefined })}
											/>
											Lock
										</label>
										{#if s.reach === "owner" && !d.lock}
											<label class="flex min-h-10 items-center gap-2 text-xs" title="The start form asks it under this preset.">
												<input
													type="checkbox"
													class="checkbox"
													checked={d.askAtStart === true}
													onchange={(e) => setDecision(s.key, { ...d, askAtStart: e.currentTarget.checked ? true : undefined })}
												/>
												Ask at start
											</label>
										{/if}
										<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => setDecision(s.key, null)}>
											Use the genre's
										</button>
									</div>
								{/if}
								{#if s.fixedAtStart}
									<FieldHelp>Fixed once a session starts.</FieldHelp>
								{/if}
							</li>
						{/each}
					</ul>
				</AdminFieldset>
			{/if}
		{:else}
			<p class="text-surface-600-400 flex items-center gap-2 text-sm" role="status">
				<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" /> Reading the genre's defaults…
			</p>
		{/if}

		<!-- ── the creation pre-fill ────────────────────────────────── -->
		<AdminFieldset
			title="Creation defaults"
			description="What the new-session form is pre-filled with when somebody starts from this preset. Every field is optional, and each is only a starting point."
			collapsible
		>
			<div class="field-row">
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Session name</span>
					<input class="input" {readonly} placeholder="Left to the person creating it" bind:value={defName} />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Tags</span>
					<input class="input" {readonly} placeholder="comma, separated" bind:value={defTags} />
				</label>
			</div>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Scenario</span>
				<textarea class="textarea w-full" rows={3} {readonly} placeholder="Left to the person creating it" bind:value={defScenario}
				></textarea>
			</label>
			{#if Object.keys(defExtra).length}
				<p class="text-surface-600-400 text-xs italic">
					This preset also carries
					<span class="font-mono text-meta">{Object.keys(defExtra).join(", ")}</span>
					, which this screen does not edit and leaves untouched.
				</p>
			{/if}
		</AdminFieldset>
	</AdminChangeForm>
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
