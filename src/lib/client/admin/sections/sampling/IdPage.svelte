<script lang="ts">
	/**
	 * Admin → Sampling → one sampling config: the change form (owner ruling
	 * 2026-09-27 — Django-style management, not the Sampling view nested in
	 * admin). In fieldsets:
	 *
	 * - **Identity** — name; modality and origin readonly.
	 * - One fieldset per parameter group the config sends (Core, Repetition,
	 *   Budget, Size, …), drawn by `SamplingValuesForm` — the same editor the
	 *   Sampling view uses, handed one group's slice of the shape's schema.
	 * - **Used by** — the capability defaults and the pipelines that pick it.
	 * - **Advanced** (collapsed) — which parameters are sent at all
	 *   (`SamplingEnabledForm`, also shared with the view).
	 *
	 * Saved with `samplingConfigs:update` — the same event and server rules
	 * as the Sampling view. The draft is only what the form edits (name,
	 * values, enabled); the shape never changes after a config is made.
	 * Built-in configs are read-only here as there: Duplicate makes an
	 * editable copy (`/admin/sampling/new?from=<id>`).
	 */
	import { getContext, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { samplingSchemaFor, type SettingsSchema } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		adminGoto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import SamplingValuesForm from "$lib/client/components/sidebars/SamplingValuesForm.svelte"
	import SamplingEnabledForm from "$lib/client/components/sidebars/SamplingEnabledForm.svelte"
	import { groupSamplingFields } from "$lib/client/components/sidebars/samplingFields"
	import {
		samplingDefaultsFor,
		samplingDeletion,
		samplingEnabledCount,
		samplingModalityWord,
		samplingValuesForForm,
		samplingValuesToSave,
		type SamplingRow
	} from "./samplingAdmin"

	type Draft = { name: string; values: Record<string, unknown>; enabled: string[] }

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	/**
	 * Derived, not read once: AdminView keys the section on its path, but the
	 * outgoing page can see the next address's params for a frame.
	 */
	const id = $derived(Number(adminPage.params.id))
	const validId = $derived(Number.isInteger(id) && id > 0)

	// ── the list: existence, and what the delete confirmation names ─────
	let rows = $state<SamplingRow[]>([])
	let listLoaded = $state(false)
	const listed = $derived(rows.find((r) => r.id === id) ?? null)
	useInterest<"samplingConfigs:list">("samplingConfigs:list", (msg) => {
		rows = msg.samplingConfigsList as SamplingRow[]
		listLoaded = true
	})

	let usedBy = $state<Record<number, string[]>>({})
	$effect(() =>
		requestWithInterest("pipelines:library", {}, (res) => {
			usedBy = res.samplingUsedBy ?? {}
		})
	)

	// ── the row and its draft ───────────────────────────────────────────
	/** The saved row's fixed facts: shape, built-in. Never edited here. */
	let row = $state<SelectSamplingConfig | undefined>(undefined)
	let draft = $state<Draft | undefined>(undefined)
	const edits = new UnsavedEdits(() => draft)
	adminUnsavedEdits(() => edits.dirty)

	/**
	 * The draft as the form builds it — declared defaults filled in where the
	 * row stores nothing (`samplingValuesForForm`), so a slider dragged away
	 * and back, or a parameter switched on and off, is clean again.
	 */
	const toDraft = (r: SelectSamplingConfig): Draft => ({
		name: r.name ?? "",
		values: samplingValuesForForm(
			samplingSchemaFor(r.shape ?? undefined),
			$state.snapshot(r.values) as Record<string, unknown> | null
		),
		enabled: [...((r.enabled as string[] | null) ?? [])]
	})

	useInterest<"samplingConfigs:get">("samplingConfigs:get", (msg) => {
		// emitToUser: another view loading another config lands here too.
		if (msg.sampling?.id !== id) return
		const next = msg.sampling
		untrack(() => {
			row = next
			if (draft === undefined) {
				draft = toDraft(next)
				edits.markSaved()
			} else edits.adoptSaved(toDraft(next), (d) => (draft = d))
		})
	})

	// ── save ────────────────────────────────────────────────────────────
	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])
	let nameError = $state<string | null>(null)

	function save(intent: AdminSaveIntent) {
		if (!draft || !row || row.isImmutable) return
		const name = draft.name.trim()
		nameError = name ? null : "A sampling config needs a name."
		formErrors = []
		if (nameError) return
		draft.name = name
		if (!edits.dirty) return land(intent)
		saving = true
		pendingIntent = intent
		const snap = $state.snapshot(draft)
		const values = samplingValuesToSave(
			schema,
			snap.values,
			$state.snapshot(row.values) as Record<string, unknown> | null
		)
		socket.emit("samplingConfigs:update", {
			sampling: { id, name: snap.name, values, enabled: snap.enabled } as any
		})
	}
	function land(intent: AdminSaveIntent) {
		if (intent === "save") void adminGoto("/admin/sampling")
		else if (intent === "another") void adminGoto("/admin/sampling/new")
	}
	useInterest<"samplingConfigs:update">("samplingConfigs:update", (msg) => {
		if (msg.sampling?.id !== id) return
		const mine = pendingIntent
		row = msg.sampling
		if (!mine) {
			// Another view's save: a clean form takes it, a dirty one keeps
			// the edits and only moves what "saved" means.
			edits.adoptSaved(toDraft(msg.sampling), (d) => (draft = d))
			return
		}
		draft = toDraft(msg.sampling)
		edits.markSaved()
		pendingIntent = null
		saving = false
		toaster.success({ title: `Saved ${msg.sampling.name}` })
		land(mine)
	})
	useInterest<"samplingConfigs:update:error">("samplingConfigs:update:error", (msg) => {
		if (!pendingIntent) return
		pendingIntent = null
		saving = false
		const error = msg.error ?? "The sampling config was not saved."
		if (/name/i.test(error)) nameError = error
		else formErrors = [error]
	})

	// ── delete ──────────────────────────────────────────────────────────
	/** The delete answer carries no id; this page listens only while it asked. */
	let deleting = false
	function remove() {
		if (!row || row.isImmutable) return
		deleting = true
		socket.emit("samplingConfigs:delete", { id })
	}
	useInterest<"samplingConfigs:delete">("samplingConfigs:delete", () => {
		if (!deleting) return
		deleting = false
		edits.forget()
		toaster.success({ title: "Sampling config deleted" })
		void adminGoto("/admin/sampling", { replaceState: true })
	})

	onMount(() => socket.emit("samplingConfigs:list", {}))
	$effect(() => {
		if (!validId) return
		const want = id
		untrack(() => {
			row = undefined
			draft = undefined
			edits.forget()
			socket.emit("samplingConfigs:get", { id: want })
		})
	})

	// ── what the page shows ─────────────────────────────────────────────
	const defaults = $derived(systemSettingsCtx?.capabilityDefaults ?? {})
	const held = $derived(samplingDefaultsFor(id, defaults))
	const pipelines = $derived(usedBy[id] ?? [])
	const schema = $derived(samplingSchemaFor(row?.shape ?? undefined))
	const readOnly = $derived(!!row?.isImmutable)
	const title = $derived(draft?.name.trim() || row?.name || "Sampling config")
	const count = $derived(
		draft ? samplingEnabledCount({ id, name: "", enabled: draft.enabled }, schema) : null
	)
	/** One fieldset per group that has a parameter switched on. */
	const groups = $derived(
		draft ? groupSamplingFields(schema, (key) => draft!.enabled.includes(key)) : []
	)
	const sliceOf = (fields: { key: string }[]): SettingsSchema =>
		Object.fromEntries(fields.map((f) => [f.key, schema[f.key]]))

	function duplicate() {
		void adminGoto(`/admin/sampling/new?from=${id}`)
	}
</script>

{#if !validId}
	<!-- Between addresses: nothing to show for a frame. -->
{:else if listLoaded && !listed && !row}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no sampling config {id}.</p>
		<a href="/admin/sampling" class="btn btn-sm preset-tonal-surface">
			All sampling configs
		</a>
	</div>
{:else if !draft || !row}
	<div
		class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm"
		role="status"
	>
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading sampling config…
	</div>
{:else}
	<AdminChangeForm
		mode="change"
		{title}
		purpose={readOnly
			? "A built-in config: read-only. Duplicate it to make one you can change."
			: undefined}
		noun="sampling config"
		changelistHref="/admin/sampling"
		changelistLabel="Sampling"
		dirty={edits.dirty}
		{saving}
		canSave={readOnly ? false : undefined}
		errors={formErrors}
		fieldErrors={{ "sampling-admin-name": nameError }}
		historyHref="/admin/history?type=sampling-config&id={id}"
		deletion={readOnly
			? undefined
			: () => samplingDeletion(listed ? [listed] : [row as any], defaults, usedBy)}
		onDelete={readOnly ? undefined : remove}
		onSave={save}
	>
		{#snippet headerActions()}
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={duplicate}>
				<Icons.Copy size={16} aria-hidden="true" />
				Duplicate
			</button>
		{/snippet}
		{#snippet headerExtra()}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
					{samplingModalityWord(row?.shape)}
				</span>
				{#if readOnly}
					<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
						Built-in
					</span>
				{/if}
				{#if count}
					<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
						{count.on} of {count.total} parameters sent
					</span>
				{/if}
				{#each held as h (h.capability)}
					<span class="preset-tonal-primary rounded-full px-2 py-0.5">
						Default for {h.label}
					</span>
				{/each}
			</div>
		{/snippet}

		<!-- ── Identity ───────────────────────────────────────────── -->
		<AdminFieldset title="Identity">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-3">
				{#if readOnly}
					<AdminField id="sampling-admin-name" label="Name" value={draft.name} />
				{:else}
					<AdminField
						id="sampling-admin-name"
						label="Name"
						required
						error={nameError}
						help="Unique within its modality."
					>
						<input
							id="sampling-admin-name"
							class="input"
							type="text"
							bind:value={draft.name}
							aria-invalid={!!nameError}
							aria-describedby={describedBy("sampling-admin-name", !!nameError)}
						/>
					</AdminField>
				{/if}
				<AdminField
					id="sampling-admin-modality"
					label="Modality"
					value={samplingModalityWord(row.shape)}
				/>
				<AdminField
					id="sampling-admin-immutable"
					label="Origin"
					value={readOnly ? "Built-in" : "Custom"}
				/>
			</div>
		</AdminFieldset>

		<!-- ── The parameters it sends, one fieldset per group ────── -->
		{#if !groups.length}
			<AdminFieldset title="Parameters">
				<p class="text-surface-600-400 text-sm">
					No parameters switched on: requests go out with the backend's own
					defaults.
					{#if !readOnly}Switch some on under Advanced.{/if}
				</p>
			</AdminFieldset>
		{:else}
			{#each groups as g (g.group)}
				<AdminFieldset title={g.group}>
					<SamplingValuesForm
						schema={sliceOf(g.fields)}
						bind:values={draft.values}
						enabled={draft.enabled}
						disabled={readOnly}
						groupHeadings={false}
					/>
				</AdminFieldset>
			{/each}
		{/if}

		<!-- ── Used by ────────────────────────────────────────────── -->
		<AdminFieldset
			title="Used by"
			description="The defaults and pipelines that pick this config. Deleting it leaves them without that choice."
		>
			{#snippet aside()}
				<a href="/admin/defaults" class="btn btn-sm preset-tonal-surface shrink-0">
					<Icons.Target size={14} aria-hidden="true" />
					Change defaults
				</a>
			{/snippet}
			{#if held.length || pipelines.length}
				<ul class="flex flex-col gap-1.5 text-sm">
					{#each held as h (h.capability)}
						<li class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-medium">Default for {h.label}</span>
						</li>
					{/each}
					{#each pipelines as p (p)}
						<li class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-medium">{p}</span>
							<span class="text-surface-600-400 text-xs">pipeline</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 text-sm">
					Nothing yet. Pick it in Defaults or in a pipeline's settings.
				</p>
			{/if}
		</AdminFieldset>

		<!-- ── Advanced: which parameters are sent ────────────────── -->
		<AdminFieldset
			title="Advanced"
			description="Which parameters this config sends. One switched off is not sent, so the backend uses its own value; switching one on starts it at its default."
			collapsible
		>
			<SamplingEnabledForm
				{schema}
				bind:values={draft.values}
				bind:enabled={draft.enabled}
				disabled={readOnly}
			/>
		</AdminFieldset>
	</AdminChangeForm>
{/if}
