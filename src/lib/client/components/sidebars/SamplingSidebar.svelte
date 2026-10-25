<script lang="ts">
	/**
	 * The Sampling view: a list of every sampling config, grouped by what it
	 * samples, beside the editor of the one picked (STYLE-GUIDE §5.2, a list
	 * column). A row says whether the config is built in, whether it holds a
	 * default for ANY job (★, its title naming the jobs), how many settings it
	 * turns on and what uses it. The editor is the config's name, its
	 * parameters (Choose parameters shows every one with a checkbox, in
	 * place) and a Used by card; Save is the one primary, and ⋯ holds Set as
	 * default…, Duplicate, Reset and Delete (whose dialog says which jobs and
	 * pipelines lose it).
	 *
	 * Admin › Sampling manages the same rows with its own changelist and
	 * change form (`admin/sections/sampling/`).
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { getContext, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import type { RowMenuEntries } from "$lib/client/components/menus/RowMenu.svelte"
	import SidebarListItem from "$lib/client/components/SidebarListItem.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import SamplingConfigUnsavedChangesModal from "../modals/PromptConfigUnsavedChangesModal.svelte"
	import SamplingValuesForm from "./SamplingValuesForm.svelte"
	import SamplingNewDialog from "./SamplingNewDialog.svelte"
	import SamplingDefaultsDialog from "./SamplingDefaultsDialog.svelte"
	import { countEnabled } from "./samplingFields"
	import {
		BUILT_IN_GLYPH_WORDS,
		groupSamplingConfigs,
		initialSamplingId,
		jobLabel,
		jobsWithLiveDefaults,
		samplingDeleteWarnings,
		samplingRowLine,
		schemaOfShape,
		samplingSidebarMemory,
		samplingStarWords,
		samplingUseOf,
		shapeOf,
		sortJobs,
		uniqueCopyName,
		type SamplingJob,
		type SamplingListRow,
		type SamplingNewSeed,
		type SamplingPipelineUse
	} from "./samplingList"
	import { openInLoadouts, openInPipelines } from "$lib/client/admin/railDoors"
	import { sameFormValue } from "$lib/client/forms/sameFormValue"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"
	import { S } from "@serene-pub/sdk"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")

	const socket = useTypedSocket()
	const uid = $props.id()
	const vm = new ViewModeTracker()

	// ── The list ─────────────────────────────────────────────────────────────
	let samplingConfigsList: Sockets.SamplingConfigs.List.Response["samplingConfigsList"] =
		$state([])
	/** Whether `samplingConfigs:list` has answered: until then empty is "not yet". */
	let listLoaded = $state(false)
	let filterText = $state("")
	const groups = $derived(groupSamplingConfigs(samplingConfigsList, filterText))

	// ── What picks each config ───────────────────────────────────────────────
	let usedBy = $state<Sockets.SamplingConfigs.UsedBy.Response | null>(null)
	/**
	 * Every job, holding what the live `capabilityDefaults` says it holds:
	 * that map moves with every default write, from this view or any other,
	 * so the ★ never waits on a re-read.
	 */
	const jobs = $derived(
		jobsWithLiveDefaults(
			usedBy?.jobs ?? [],
			systemSettingsCtx?.capabilityDefaults
		)
	)
	const useOf = (id: number) => samplingUseOf(id, jobs, usedBy?.pipelines)

	// ── The selection ────────────────────────────────────────────────────────
	/** Seeded from the view's memory, so a reopened view lands where it was. */
	let selectedId = $state<number | null>(samplingSidebarMemory.selectedId)
	$effect(() => {
		samplingSidebarMemory.selectedId = selectedId
	})
	/** Compact only: the editor has replaced the list. Desk shows both. */
	let compactOpen = $state(false)
	const hasDetail = $derived(
		selectedId != null && (vm.mode === "desk" || compactOpen)
	)
	const selectedRow = $derived(
		samplingConfigsList.find((c) => c.id === selectedId) ?? null
	)

	// ── The draft ────────────────────────────────────────────────────────────
	let sampling: SelectSamplingConfig | undefined = $state()
	let originalSamplingConfig: SelectSamplingConfig | undefined = $state()
	/**
	 * Deep and forgiving where a person would be (`sameFormValue`): a number
	 * typed back to its value arrives as a string, a cleared field is `""`
	 * where the row held `null`, and a key an edit deleted and re-added moves
	 * to the end — none of those is a change.
	 */
	let unsavedChanges = $derived.by(() => {
		if (!sampling || !originalSamplingConfig) return false
		return !sameFormValue(
			$state.snapshot(sampling),
			$state.snapshot(originalSamplingConfig)
		)
	})
	const builtIn = $derived(!!sampling?.isImmutable)
	/** The ROW's vocabulary, so a config renders its own parameters. */
	const activeSchema = $derived(schemaOfShape(sampling?.shape))
	/**
	 * The image sampling keys the Image default's pair drops, by its drawing
	 * sheet (`images:drawingSheet`) — greyed in the form and left out of the
	 * "N of M sent" count. Only for an image config; a text config greys
	 * nothing from it.
	 */
	let imageSheetDrops = $state<string[]>([])
	const isImageConfig = $derived(sampling?.shape === S.imageGen)
	const unhonoured = $derived(isImageConfig ? imageSheetDrops : [])
	const sentSummary = $derived(
		countEnabled(activeSchema, sampling?.enabled, unhonoured)
	)
	/** Choose parameters: every parameter with its checkbox, in place. */
	let chooseParams = $state(false)
	const detailTitle = $derived(
		sampling?.name?.trim() ||
			originalSamplingConfig?.name ||
			selectedRow?.name ||
			"Sampling config"
	)
	const detailUse = $derived(
		sampling?.id != null ? useOf(sampling.id) : { jobs: [], pipelines: [] }
	)

	const samplingConfigSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})
	let validationErrors: Record<string, string> = $state({})

	function validateForm(): boolean {
		if (!sampling) return false
		const result = samplingConfigSchema.safeParse({ name: sampling.name })
		if (result.success) {
			validationErrors = {}
			return true
		}
		const errors: Record<string, string> = {}
		for (const error of result.error.errors)
			if (error.path.length > 0)
				errors[error.path[0] as string] = error.message
		validationErrors = errors
		return false
	}

	// ── Leaving a draft ──────────────────────────────────────────────────────
	let showUnsavedChangesModal = $state(false)
	let discardResolve: ((discard: boolean) => void) | null = null

	/** Ask, then answer: true when the person chose to discard. */
	function confirmDiscard(): Promise<boolean> {
		showUnsavedChangesModal = true
		return new Promise<boolean>((resolve) => {
			discardResolve = resolve
		})
	}
	function answerDiscard(discard: boolean) {
		showUnsavedChangesModal = false
		const resolve = discardResolve
		discardResolve = null
		resolve?.(discard)
	}

	async function handleOnClose() {
		if (!unsavedChanges) return true
		return confirmDiscard()
	}

	/** Open a config's editor, dropping whatever draft was open. */
	function openConfig(id: number) {
		if (id !== selectedId) {
			sampling = undefined
			originalSamplingConfig = undefined
			validationErrors = {}
		}
		selectedId = id
		compactOpen = true
	}

	/** A row's click: the open config stays as it is; another asks first. */
	async function selectRow(id: number) {
		if (id === selectedId) {
			compactOpen = true
			return
		}
		if (unsavedChanges && !(await confirmDiscard())) return
		openConfig(id)
	}

	// ── Save, reset, delete ──────────────────────────────────────────────────
	let saving = false
	function handleSave() {
		if (!sampling || sampling.isImmutable) return
		if (!validateForm()) return
		saving = true
		socket.emit("samplingConfigs:update", { sampling })
	}

	function handleReset() {
		if (originalSamplingConfig) {
			// Deep copy: `values` and `enabled` are nested, and a shallow one
			// would hand the edited objects straight back and reset nothing.
			sampling = structuredClone($state.snapshot(originalSamplingConfig))
			validationErrors = {}
		}
	}

	let showDeleteModal = $state(false)
	/** What deleting the open config changes: the jobs and pipelines it leaves. */
	const deleteWarnings = $derived(
		sampling?.id != null ? samplingDeleteWarnings(useOf(sampling.id)) : []
	)
	let deleting = false
	function handleDelete() {
		if (!sampling || sampling.isImmutable) return
		showDeleteModal = true
	}
	function confirmDelete() {
		if (!sampling?.id) return
		deleting = true
		socket.emit("samplingConfigs:delete", { id: sampling.id })
		showDeleteModal = false
	}

	// ── New and Duplicate ────────────────────────────────────────────────────
	let newOpen = $state(false)
	let newSeed = $state<SamplingNewSeed>({
		name: "",
		shape: S.textGen,
		fromId: null
	})
	/** A refusal from the server, under the dialog's name. */
	let newError: string | undefined = $state()
	/** The create in flight: only its own answer moves the view. */
	let creating = $state<SamplingNewSeed | null>(null)
	/** Duplicate copies the editor as it stands, unsaved edits included. */
	let duplicating = false

	/**
	 * Where a modality's copy-from starts: the open config when it is of that
	 * modality, else one holding a default there, else the first built-in,
	 * else the first, else nothing.
	 */
	function defaultFromFor(shape: string): number | null {
		const pool = samplingConfigsList.filter((r) => shapeOf(r) === shape)
		if (sampling?.id != null && pool.some((r) => r.id === sampling!.id))
			return sampling.id
		const held = new Set(
			jobs.filter((j) => j.shape === shape).map((j) => j.samplingConfigId)
		)
		return (
			(
				pool.find((r) => held.has(r.id)) ??
				pool.find((r) => r.isImmutable) ??
				pool[0]
			)?.id ?? null
		)
	}

	/**
	 * New copies saved values only, and the config it makes opens in the
	 * editor, replacing the draft there: so a draft with edits asks first.
	 */
	async function openNew() {
		if (unsavedChanges && !(await confirmDiscard())) return
		const shape = sampling ? shapeOf(sampling) : S.textGen
		newSeed = { name: "", shape, fromId: defaultFromFor(shape) }
		newError = undefined
		duplicating = false
		newOpen = true
	}

	/** The copy carries the draft's edits, so nothing is asked. */
	function openDuplicate() {
		if (!sampling?.id) return
		const shape = shapeOf(sampling)
		newSeed = {
			name: uniqueCopyName(sampling.name, shape, samplingConfigsList),
			shape,
			fromId: sampling.id
		}
		newError = undefined
		duplicating = true
		newOpen = true
	}

	function handleCreate(choice: SamplingNewSeed) {
		const source: Pick<SamplingListRow, "values" | "enabled"> | undefined =
			choice.fromId == null
				? undefined
				: duplicating && choice.fromId === sampling?.id
					? $state.snapshot(sampling)
					: samplingConfigsList.find((r) => r.id === choice.fromId)
		newError = undefined
		creating = choice
		socket.emit("samplingConfigs:create", {
			sampling: {
				name: choice.name,
				shape: choice.shape,
				values: structuredClone($state.snapshot(source?.values ?? {})),
				enabled: [...(source?.enabled ?? [])]
			} as any
		})
	}

	// ── Set as default… ──────────────────────────────────────────────────────
	let defaultsOpen = $state(false)
	let settingDefault = false
	const shapeJobs = $derived(
		sampling
			? sortJobs(jobs.filter((j) => j.shape === shapeOf(sampling!)))
			: []
	)
	const configName = (id: number) =>
		samplingConfigsList.find((c) => c.id === id)?.name ?? null

	function applyDefault(transforms: string[]) {
		if (!sampling?.id || !transforms.length) return
		settingDefault = true
		socket.emit("samplingConfigs:setDefaultFor", {
			id: sampling.id,
			transforms
		})
	}

	// ── Used by: links out ───────────────────────────────────────────────────
	/** A job opens its default loadout's sheet in the Loadouts view (I12). */
	function openJob(job: SamplingJob) {
		openInLoadouts(panelsCtx, { job: job.capability })
	}
	function openPipeline(p: SamplingPipelineUse) {
		openInPipelines(panelsCtx, { slug: p.slug })
	}

	function requestUsedBy() {
		socket.emit("samplingConfigs:usedBy", {})
	}

	// ── Socket answers ───────────────────────────────────────────────────────
	function handleSamplingConfigsList(
		message: Sockets.SamplingConfigs.List.Response
	) {
		samplingConfigsList = message.samplingConfigsList
		listLoaded = true
		// The open config went (deleted here or anywhere): the desk opens its
		// usual pick, compact goes back to the list.
		if (
			selectedId != null &&
			!samplingConfigsList.some((c) => c.id === selectedId)
		) {
			sampling = undefined
			originalSamplingConfig = undefined
			compactOpen = false
			selectedId =
				vm.mode === "desk"
					? initialSamplingId(samplingConfigsList, jobs, null)
					: null
		}
	}
	function handleSamplingConfigsGet(
		message: Sockets.SamplingConfigs.Get.Response
	) {
		// Every view's `:get` answers here; only the open config's is ours.
		if (message.sampling?.id !== selectedId) return
		// Cloned so the form edits a copy and `originalSamplingConfig` stays a
		// clean baseline for the unsaved-changes comparison.
		sampling = structuredClone(message.sampling)
		originalSamplingConfig = structuredClone(message.sampling)
	}
	function handleSamplingConfigsUpdate(
		message: Sockets.SamplingConfigs.Update.Response
	) {
		if (!saving || message.sampling?.id !== selectedId) return
		saving = false
		toaster.success({ title: `Saved ${message.sampling.name}` })
	}
	/**
	 * A refused rename: filed under `name`, where the field is, rather than
	 * toasted. Layout lists this event in HANDLED_ERROR_EVENTS, so it
	 * arrives once.
	 */
	function handleSamplingConfigsUpdateError(message: Sockets.ErrorResponse) {
		if (!saving) return
		saving = false
		validationErrors = { ...validationErrors, name: message.error }
	}
	function handleSamplingConfigsCreate(
		message: Sockets.SamplingConfigs.Create.Response
	) {
		const mine = creating
		if (!mine || (message.sampling?.name ?? "").trim() !== mine.name) return
		creating = null
		newOpen = false
		newError = undefined
		openConfig(message.sampling.id)
		toaster.success({ title: "Sampling config created" })
	}
	/**
	 * A refused create — a name already taken within this modality is the one
	 * a person hits, and the answer is to type a different one. So it goes
	 * under the name in the dialog, which stays open. Layout lists this event
	 * in HANDLED_ERROR_EVENTS, so it arrives once.
	 */
	function handleSamplingConfigsCreateError(message: Sockets.ErrorResponse) {
		if (!creating) return
		creating = null
		newError = message.error
	}
	function handleSamplingConfigsDelete() {
		if (!deleting) return
		deleting = false
		toaster.success({ title: "Sampling config deleted" })
		requestUsedBy()
	}
	function handleSamplingConfigsSetDefaultFor(
		message: Sockets.SamplingConfigs.SetDefaultFor.Response
	) {
		if (!settingDefault) return
		settingDefault = false
		defaultsOpen = false
		const name = configName(message.id) ?? "The config"
		const names = sortJobs(
			message.transforms.map((capability) => ({ capability }))
		).map((j) => jobLabel(j.capability))
		const list =
			names.length <= 1
				? names.join("")
				: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
		toaster.success({
			title: "Loadout sampling updated",
			description: `The ${list} ${names.length === 1 ? "loadout uses" : "loadouts use"} ${name} now.`
		})
	}
	function handleSamplingConfigsUsedBy(
		message: Sockets.SamplingConfigs.UsedBy.Response
	) {
		usedBy = message
	}

	/**
	 * Every `samplingConfigs:` answer is held through the interest registry,
	 * standing: the list is a cascade target (every create, update and delete
	 * re-sends it), and a view that writes holds the keys its writes answer
	 * on. The two `:error` keys release only this view's subscriber; a bare
	 * `socket.off` would take Layout's listener with it.
	 */
	useInterest<"samplingConfigs:list">(
		"samplingConfigs:list",
		handleSamplingConfigsList
	)
	useInterest<"samplingConfigs:delete">(
		"samplingConfigs:delete",
		handleSamplingConfigsDelete
	)
	useInterest<"samplingConfigs:update">(
		"samplingConfigs:update",
		handleSamplingConfigsUpdate
	)
	useInterest<"samplingConfigs:create">(
		"samplingConfigs:create",
		handleSamplingConfigsCreate
	)
	useInterest<"samplingConfigs:create:error">(
		"samplingConfigs:create:error",
		handleSamplingConfigsCreateError
	)
	useInterest<"samplingConfigs:update:error">(
		"samplingConfigs:update:error",
		handleSamplingConfigsUpdateError
	)
	useInterest<"samplingConfigs:get">(
		"samplingConfigs:get",
		handleSamplingConfigsGet
	)
	useInterest<"samplingConfigs:setDefaultFor">(
		"samplingConfigs:setDefaultFor",
		handleSamplingConfigsSetDefaultFor
	)
	useInterest<"samplingConfigs:usedBy">(
		"samplingConfigs:usedBy",
		handleSamplingConfigsUsedBy
	)
	useInterest<"images:drawingSheet">("images:drawingSheet", (res) => {
		// A workflow's sheet (the Workflows tab asked) is not the Image
		// default's: it greys nothing here.
		if (res?.workflowId != null) return
		// Nor is a card's Sprites-tab question about its own pair.
		if (res?.characterId != null) return
		imageSheetDrops = res?.drops ?? []
	})

	// ⚠ AFTER the `useInterest` declarations above, never before them. Effects
	// run in declaration order, and the `samplingConfigs:` replies are GATED:
	// a `:get` emitted by an effect declared earlier reaches the server before
	// the interest sync naming its key, and the server drops the reply.
	$effect(() => {
		const id = selectedId
		if (id == null) return
		untrack(() => {
			if (sampling?.id !== id) socket.emit("samplingConfigs:get", { id })
		})
	})

	// The Image default's drawing sheet, asked again whenever an image config
	// opens or that default moves.
	$effect(() => {
		if (!isImageConfig) return
		void systemSettingsCtx?.capabilityDefaults?.["text->image"]
		untrack(() => socket.emit("images:drawingSheet", {}))
	})

	// The desk never shows the list with nothing open beside it: once the list
	// is here, open the config last open, else the one Chat's default names.
	// Compact leaves the list standing until a pick.
	$effect(() => {
		if (vm.mode !== "desk" || !listLoaded || selectedId != null) return
		untrack(() => {
			const id = initialSamplingId(
				samplingConfigsList,
				jobs,
				samplingSidebarMemory.selectedId
			)
			if (id != null) openConfig(id)
		})
	})

	onMount(() => {
		onclose = handleOnClose
		socket.emit("samplingConfigs:list", {})
		requestUsedBy()
	})

	const menuItems: RowMenuEntries = $derived([
		{
			label: "Use in loadouts…",
			icon: Icons.Star,
			onSelect: () => (defaultsOpen = true)
		},
		{ label: "Duplicate", icon: Icons.CopyPlus, onSelect: openDuplicate },
		{
			label: "Reset unsaved changes",
			icon: Icons.RefreshCcw,
			disabled: !unsavedChanges,
			onSelect: handleReset
		},
		{ separator: true },
		{
			label: "Delete",
			icon: Icons.Trash2,
			destructive: true,
			disabled: builtIn,
			title: builtIn ? "A built-in config cannot be deleted" : undefined,
			onSelect: handleDelete
		}
	])

	/** The row's accessible name carries what its glyphs show. */
	const rowTitle = (row: SamplingListRow, star: string | null) =>
		[
			row.name,
			row.isImmutable && "built in",
			star && star[0].toLowerCase() + star.slice(1)
		]
			.filter(Boolean)
			.join(", ")
</script>

<div class="flex h-full min-h-0 flex-col" use:vm.observe>
	<!-- `listFills` (L7, 2026-10-24): nothing open, the list sits centred
	     at its own 560px instead of beside an empty pane. -->
	<PanelSplit
		mode={vm.mode}
		listWidth="340px"
		{hasDetail}
		listFills
		fillWidth="list"
		emptyMessage="Pick a sampling config, or make a new one."
		toolbar={listToolbar}
		list={listPane}
		detail={detailPane}
	/>
</div>

{#snippet listToolbar()}
	<ViewToolbar label="Sampling configs">
		{#snippet primary()}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				onclick={openNew}
			>
				<Icons.Plus size={16} aria-hidden="true" /> New
			</button>
		{/snippet}
		{#snippet filter()}
			<PanelFilterInput
				bind:value={filterText}
				placeholder="sampling configs"
				singular="sampling config"
				count={samplingConfigsList.length}
			/>
		{/snippet}
	</ViewToolbar>
{/snippet}

{#snippet listPane()}
	{#if !listLoaded}
		<LoadingState message="Loading sampling configs…" />
	{:else if !samplingConfigsList.length}
		<EmptyState
			icon={Icons.SlidersHorizontal}
			message="No sampling configs yet."
			ctaLabel="New sampling config"
			onCta={openNew}
		/>
	{:else if !groups.length}
		<EmptyState
			icon={Icons.SearchX}
			message="No sampling configs match “{filterText.trim()}”."
		/>
	{:else}
		<div class="flex flex-col">
			{#each groups as g, i (g.shape)}
				{@const labelId = `${uid}-group-${i}`}
				<section class="flex flex-col">
					<ListGroupLabel
						label={g.label}
						id={labelId}
						trailing={String(g.rows.length)}
					/>
					<div
						role="list"
						class="flex flex-col gap-1"
						aria-labelledby={labelId}
					>
						{#each g.rows as row (row.id)}
							{@const use = useOf(row.id)}
							{@const star = samplingStarWords(use)}
							<SidebarListItem
								itemType="Sampling config"
								contentTitle={rowTitle(row, star)}
								showIndex={false}
								active={row.id === selectedId}
								onclick={() => selectRow(row.id)}
							>
								{#snippet content()}
									<span
										class="flex min-w-0 flex-1 flex-col text-left"
									>
										<span
											class="flex min-w-0 items-center gap-1.5"
										>
											<span
												class="truncate text-lead font-medium"
											>
												{row.name}
											</span>
											<!-- Each glyph's own `title` is its
											     tooltip: it is inside the row's
											     button, so it cannot be a
											     focusable trigger of its own, and
											     its title wins over the row's
											     while the pointer is on it. The
											     row's name carries the same
											     words for a screen reader. -->
											{#if row.isImmutable}
												<span
													class="inline-flex shrink-0"
													role="img"
													aria-label={BUILT_IN_GLYPH_WORDS}
													title={BUILT_IN_GLYPH_WORDS}
												>
													<Icons.Lock
														size={14}
														class="text-surface-600-400"
														aria-hidden="true"
													/>
												</span>
											{/if}
											{#if star}
												<span
													class="inline-flex shrink-0"
													role="img"
													aria-label={star}
													title={star}
												>
													<Icons.Star
														size={14}
														class="text-primary-500 fill-current"
														aria-hidden="true"
													/>
												</span>
											{/if}
										</span>
										<span
											class="text-surface-600-400 truncate text-xs"
										>
											{samplingRowLine(row, use)}
										</span>
									</span>
								{/snippet}
							</SidebarListItem>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet saveButton()}
	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500 shrink-0"
		onclick={handleSave}
		disabled={builtIn || !unsavedChanges}
	>
		<Icons.Save size={16} aria-hidden="true" /> Save
	</button>
{/snippet}

{#snippet builtInLine()}
	{#if builtIn}
		<p class="text-surface-600-400 text-sm">
			Built in · read-only. Duplicate it to change values.
		</p>
	{/if}
{/snippet}

{#snippet detailPane()}
	<!-- Back only at compact, where the list has given way to the editor;
	     at desk the list stands beside it (STYLE-GUIDE §6.3). -->
	<div class="flex flex-col gap-3">
		{#if sampling && sampling.id === selectedId}
			<PanelNavHeader
				title={detailTitle}
				onBack={vm.mode === "compact"
					? () => (compactOpen = false)
					: undefined}
				backLabel="Sampling configs"
				primaryAction={saveButton}
				{menuItems}
				actionsLabel="Sampling config"
				subtitle={builtInLine}
			/>

			<form
				class="flex flex-col gap-4"
				onsubmit={(e) => e.preventDefault()}
			>
				{#if !builtIn}
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="samplingName">
							Name
						</label>
						<input
							id="samplingName"
							type="text"
							bind:value={sampling.name}
							class="input {validationErrors.name
								? 'border-error-500'
								: ''}"
							aria-invalid={!!validationErrors.name}
							aria-describedby={validationErrors.name
								? "samplingName-error"
								: undefined}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.name}
							<p
								id="samplingName-error"
								class="text-error-600-400 text-sm"
								role="alert"
							>
								{validationErrors.name}
							</p>
						{/if}
					</div>
				{/if}

				<section
					class="flex flex-col gap-2"
					aria-labelledby="{uid}-params"
				>
					<div class="flex min-w-0 items-center gap-2">
						<h3 id="{uid}-params" class="text-sm font-semibold">
							Parameters
						</h3>
						<div class="min-w-0 flex-1"></div>
						<!-- The count at the header's right edge, 11px (polish
						     parity L5), before the one action. -->
						<span class="text-surface-600-400 truncate text-meta">
							{sentSummary.on} of {sentSummary.total} sent
						</span>
						<button
							type="button"
							class="btn btn-sm shrink-0 {chooseParams
								? 'preset-pressed'
								: 'preset-tonal-surface'}"
							aria-pressed={chooseParams}
							onclick={() => (chooseParams = !chooseParams)}
						>
							<Icons.ListChecks size={16} aria-hidden="true" />
							Choose parameters
						</button>
					</div>
					<SamplingValuesForm
						schema={activeSchema}
						bind:values={sampling.values}
						bind:enabled={sampling.enabled}
						choose={chooseParams}
						disabled={builtIn}
						{unhonoured}
					/>
				</section>
			</form>

			<!-- What picks this config: the jobs whose default names it and the
			     pipelines whose sampling slot does, each opening where it is
			     changed. -->
			<section
				class="panel-card flex flex-col gap-2"
				aria-labelledby="{uid}-usedby"
			>
				<h3 id="{uid}-usedby" class="text-surface-600-400 text-xs">
					Used by
				</h3>
				{#if detailUse.jobs.length || detailUse.pipelines.length}
					<ul class="flex flex-col gap-1.5 text-sm">
						{#each detailUse.jobs as j (j.capability)}
							<li class="flex flex-wrap items-baseline gap-x-2">
								<button
									type="button"
									class="anchor text-left"
									onclick={() => openJob(j)}
								>
									{jobLabel(j.capability)}
								</button>
								<span class="text-surface-600-400 text-xs">
									loadout
								</span>
							</li>
						{/each}
						{#each detailUse.pipelines as p (p.label)}
							<li class="flex flex-wrap items-baseline gap-x-2">
								<button
									type="button"
									class="anchor text-left"
									onclick={() => openPipeline(p)}
								>
									{p.label}
								</button>
								<span class="text-surface-600-400 text-xs">
									pipeline
								</span>
							</li>
						{/each}
					</ul>
				{:else if !usedBy}
					<LoadingState message="Finding what uses it…" />
				{:else}
					<p class="text-surface-600-400 text-sm">
						Nothing uses it yet. Set it as a default from ⋯, or pick
						it in a pipeline's settings.
					</p>
				{/if}
			</section>
		{:else}
			<PanelNavHeader
				title={selectedRow?.name ?? "Sampling config"}
				onBack={vm.mode === "compact"
					? () => (compactOpen = false)
					: undefined}
				backLabel="Sampling configs"
			/>
			<!-- Asked, not yet answered — said, never a blank pane. -->
			<LoadingState message="Loading sampling config…" />
		{/if}
	</div>
{/snippet}

<SamplingConfigUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={(e) => {
		if (!e.open && showUnsavedChangesModal) answerDiscard(false)
	}}
	onConfirm={() => answerDiscard(true)}
	onCancel={() => answerDiscard(false)}
	subject="sampling config"
/>

<SamplingNewDialog
	open={newOpen}
	rows={samplingConfigsList}
	seed={newSeed}
	{defaultFromFor}
	error={newError}
	busy={!!creating}
	onCreate={handleCreate}
	onClose={() => {
		newOpen = false
		newError = undefined
		creating = null
	}}
/>

<SamplingDefaultsDialog
	open={defaultsOpen}
	config={sampling?.id != null
		? {
				id: sampling.id,
				name: originalSamplingConfig?.name ?? sampling.name
			}
		: null}
	jobs={shapeJobs}
	loaded={!!usedBy}
	{configName}
	onApply={applyDefault}
	onClose={() => (defaultsOpen = false)}
/>

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-4 shadow-xl"
			>
				<header class="flex justify-between">
					<Dialog.Title class="h2">
						Delete sampling config
					</Dialog.Title>
				</header>
				<article class="space-y-2">
					<Dialog.Description class="opacity-60">
						Delete "{sampling?.name}"? This cannot be undone.
					</Dialog.Description>
					<!-- A config some job or pipeline uses says what goes with
					     it, before the press rather than after. -->
					{#each deleteWarnings as line (line)}
						<p
							class="text-warning-700-300 flex items-start gap-2 text-sm"
						>
							<Icons.TriangleAlert
								size={16}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>
							<span>{line}</span>
						</p>
					{/each}
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-tonal-surface"
						onclick={() => (showDeleteModal = false)}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={confirmDelete}
					>
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
