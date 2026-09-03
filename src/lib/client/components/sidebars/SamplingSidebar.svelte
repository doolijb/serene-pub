<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PanelToolbar from "$lib/client/components/panels/PanelToolbar.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import SamplingConfigUnsavedChangesModal from "../modals/PromptConfigUnsavedChangesModal.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import SamplingValuesForm from "./SamplingValuesForm.svelte"
	import SamplingEnabledForm from "./SamplingEnabledForm.svelte"
	import { countEnabled } from "./samplingFields"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"
	import { S, SAMPLING_SCHEMAS, samplingSchemaFor } from "@serene-pub/sdk"
	import { capabilityForSamplingShape } from "$lib/shared/capabilities/samplingShape"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
		/** Deep-link: select this config instead of the system default (admin change pages). */
		initialSelectedId?: number | null
		/** Deep-link: open the new-config flow on mount (admin create page). */
		startNew?: boolean
		/** Deep-link: land straight in one category instead of the picker. */
		initialShape?: string | null
	}

	let {
		onclose = $bindable(),
		initialSelectedId = null,
		startNew = false,
		initialShape = null
	}: Props = $props()

	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	const socket = useTypedSocket()

	// ── Categories ───────────────────────────────────────────────────────────
	//
	// Sampling configs are split by modality for the same reason connections are:
	// the two vocabularies share nothing, and a list mixing them makes the reader
	// check every row's shape before trusting its name. A deep link that names a
	// config or a shape skips the picker.
	let shape = $state<string>(initialShape ?? S.textGen)
	// Whether the deep-linked row's own shape has been adopted yet. Not `$state`:
	// nothing renders from it, and it flips once, the first time a list lands.
	let deepLinkAdopted = false
	// Three screens, one variable — the same pattern index→list already proves.
	// "enabled" is the enable/disable screen: which parameters this config is in
	// charge of, edited apart from their values rather than as a checkbox in
	// front of every one of them.
	let view = $state<"index" | "list" | "enabled">(
		initialSelectedId != null || startNew || initialShape ? "list" : "index"
	)

	const CATEGORIES = [
		{
			shape: S.textGen,
			icon: Icons.Type,
			title: "Large Language Models",
			blurb: "Temperature, penalties, context and response budgets — the parameters behind every generated reply."
		},
		{
			shape: S.imageGen,
			icon: Icons.Image,
			// The second sentence draws a real boundary, and this card is where
			// a person first meets the family presets. Steps, CFG, samplers and
			// seeds are the vocabulary of LOCAL diffusion; a hosted service has
			// no such knobs to preset (gpt-image-1 takes a size ENUM, a quality
			// word and nothing else), so what one backend alone offers —
			// quality, background, output format — lives on its CONNECTION,
			// declared by its adapter. Hence five model families here and no
			// sixth "hosted" preset.
			title: "Image Generation",
			blurb: "Steps, CFG, size, seed — shared by every image backend, whichever one a connection points at. These are the parameters of local diffusion; a hosted service's own options (quality, background, output format) live on its connection instead."
		}
	]

	const categoryTitle = $derived(
		CATEGORIES.find((c) => c.shape === shape)?.title ?? "Sampling"
	)

	function openCategory(s: string) {
		shape = s
		selectedSamplingId = defaultIdFor(s) ?? firstOfShape(s)
		view = "list"
	}

	function backToIndex() {
		view = "index"
	}

	/**
	 * The instance default for a shape.
	 *
	 * One default per modality, not one shared by all of them (0172): a default
	 * that could not say which modality it was for would hand a text config to an
	 * image provider the moment a spec left the slot unset.
	 */
	function defaultIdFor(s: string): number | null {
		// Keyed by CAPABILITY now (0175), not by a column per modality — the
		// capability space is open, so a column pair each would not scale and
		// every new modality would be a migration.
		const byCapability = systemSettingsCtx.capabilityDefaults
		// The shared mapping, not a second copy of it: a local
		// `s === S.imageGen ? … : "text->text"` reads a TTS config's default out
		// of the CHAT capability, because everything that is not image falls into
		// the else. Whatever registered it used this function; so does this.
		const capability = capabilityForSamplingShape(s)
		const registered = capability
			? byCapability?.[capability]?.samplingConfigId
			: null
		if (registered != null) return registered
		// The text default is still mirrored onto system_settings for the legacy
		// generation path, so it remains a valid fallback for that one capability.
		return s === S.imageGen
			? null
			: (systemSettingsCtx.settings?.defaultSamplingConfigId ?? null)
	}

	const firstOfShape = (s: string) =>
		samplingConfigsList.find((c) => c.shape === s)?.id ?? null

	let activeSamplingConfigId = $derived(defaultIdFor(shape))

	// Sampling config has no per-user override — it's the system-wide default
	// (systemSettingsCtx.settings.defaultSamplingConfigId), same value every
	// admin sees. Seed the initial selection from it; the samplingConfigs:get
	// effect below fetches the full editable config once this is set.
	// svelte-ignore state_referenced_locally — deliberate initial seed.
	let selectedSamplingId: number | null = $state(
		initialSelectedId ??
			systemSettingsCtx.settings?.defaultSamplingConfigId ??
			null
	)

	let sampling: SelectSamplingConfig | undefined = $state()
	let originalSamplingConfig: SelectSamplingConfig | undefined = $state()
	let unsavedChanges = $derived.by(() => {
		if (!sampling || !originalSamplingConfig) return false
		// Compare current sampling with original to detect changes
		return (
			JSON.stringify(sampling) !== JSON.stringify(originalSamplingConfig)
		)
	})
	let showUnsavedChangesModal = $state(false)
	let showNewNameModal = $state(false)
	/** A server refusal shown under the new-name input, not as a toast. */
	let newNameError: string | undefined = $state()
	let showDeleteModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// Zod validation schema
	const samplingConfigSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})

	/**
	 * The vocabulary for the row being edited — read from the ROW's shape, not the
	 * category, so a config reached by deep link renders its own parameters even
	 * if the sidebar happens to have opened on the other category.
	 */
	const activeSchema = $derived(samplingSchemaFor(sampling?.shape))

	/**
	 * "N of M" for the enable/disable nav button — the one thing the inline
	 * checkboxes carried that the values screen no longer shows, now that it
	 * draws only the parameters that are on.
	 */
	const enabledSummary = $derived(
		countEnabled(activeSchema, sampling?.enabled)
	)

	let samplingConfigsList: Sockets.SamplingConfigs.List.Response["samplingConfigsList"] =
		$state([])

	/** Only the configs belonging to the category on screen. */
	const viewConfigs = $derived(
		samplingConfigsList.filter((c) => (c.shape ?? S.textGen) === shape)
	)

	// Drives the select's value via bind: rather than per-option `selected`
	// attributes — the list of options gets regenerated on every save (the
	// server re-emits samplingConfigs:list as part of the update flow), and
	// `selected` attributes on <option> don't reliably survive that; the
	// browser falls back to the first option, which looked like "the
	// selection reverts to the default config" after saving.
	$effect(() => {
		if (selectedSamplingId) {
			socket.emit("samplingConfigs:get", { id: selectedSamplingId })
		}
	})

	function handleSetDefault() {
		if (!selectedSamplingId) return
		socket.emit("samplingConfigs:setUserActive", { id: selectedSamplingId })
	}

	function handleNew() {
		newNameError = undefined
		showNewNameModal = true
	}
	function handleNewNameConfirm(name: string) {
		if (!socket) return
		// A clone carries the whole configuration — shape included, or the copy
		// would silently become a text config and lose every value with it.
		const newSamplingConfig = { ...sampling }
		delete newSamplingConfig.id
		delete newSamplingConfig.seedKey
		delete newSamplingConfig.isImmutable
		newSamplingConfig.name = name.trim()
		newSamplingConfig.shape = sampling?.shape ?? shape
		newNameError = undefined
		socket.emit("samplingConfigs:create", {
			sampling: newSamplingConfig as any
		})
		// Deliberately NOT closed here. Names are unique per modality, so the
		// server can refuse this one, and a modal that had already closed would
		// have thrown away the name the person typed along with the clone they
		// were halfway through making. `handleSamplingConfigsCreate` closes it
		// once the row actually exists.
	}
	function handleNewNameCancel() {
		newNameError = undefined
		showNewNameModal = false
	}

	function validateForm(): boolean {
		if (!sampling) return false

		const result = samplingConfigSchema.safeParse({
			name: sampling.name
		})

		if (result.success) {
			validationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			validationErrors = errors
			return false
		}
	}

	function handleUpdate() {
		if (!socket || !sampling) return
		if (sampling.isImmutable) {
			toaster.error({
				title: "Cannot Save",
				description: "Cannot save immutable sampling configuration."
			})
			return
		}
		if (!validateForm()) return
		socket.emit("samplingConfigs:update", { sampling })
	}

	function handleReset() {
		if (originalSamplingConfig) {
			// Deep copy: `values` and `enabled` are nested, and a shallow one would
			// hand the edited objects straight back and reset nothing.
			sampling = structuredClone($state.snapshot(originalSamplingConfig))
		}
	}

	function handleDelete() {
		if (!socket || !sampling) return
		if (sampling.isImmutable) {
			toaster.error({
				title: "Cannot Delete",
				description: "Cannot delete immutable sampling configuration."
			})
			return
		}
		showDeleteModal = true
	}

	function confirmDelete() {
		socket.emit("samplingConfigs:delete", {
			id: sampling!.id!
		})
		showDeleteModal = false
	}

	function cancelDelete() {
		showDeleteModal = false
	}

	async function handleOnClose() {
		if (unsavedChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			return true
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}
	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}
	function handleUnsavedChangesModalOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	function handleSamplingConfigsList(
		message: Sockets.SamplingConfigs.List.Response
	) {
		samplingConfigsList = message.samplingConfigsList
		// A selection that belongs to the other category (or to a row that has
		// just been deleted) would render an empty panel under this heading.
		// `!== "index"` rather than `=== "list"`: the enable/disable screen
		// edits the same selection, so a row deleted while it is open needs the
		// same repair.
		// A deep link names a config but not its category, so adopt the row's own
		// shape before repairing anything.
		//
		// /admin/sampling/<id> passes only `initialSelectedId`, leaving `shape` at
		// the text default. `viewConfigs` filters by shape, so an IMAGE config is
		// never in it, the repair below fires, and the panel silently loads the
		// TEXT default instead — under the wrong heading, with the URL still
		// naming the image row. Harmless when one image config existed; this
		// sprint added five prominently-named rows whose whole purpose is to be
		// clicked.
		//
		// Consumed once (`pendingDeepLinkId = null`), so an ordinary list refresh
		// can never yank someone out of the category they picked by hand.
		if (!deepLinkAdopted) {
			deepLinkAdopted = true
			// Only when the link named a config WITHOUT naming a shape — a link
			// that named both meant both, and must not be second-guessed.
			if (initialShape == null && initialSelectedId != null) {
				const target = samplingConfigsList.find(
					(c: { id: number; shape?: string }) =>
						c.id === initialSelectedId
				)
				if (target?.shape && target.shape !== shape)
					shape = target.shape
			}
		}

		if (
			view !== "index" &&
			selectedSamplingId != null &&
			!viewConfigs.some((c) => c.id === selectedSamplingId)
		) {
			selectedSamplingId = defaultIdFor(shape) ?? firstOfShape(shape)
		}
	}
	function handleSamplingConfigsDelete(
		_message: Sockets.SamplingConfigs.Delete.Response
	) {
		toaster.success({ title: "Sampling Config Deleted" })
	}
	function handleSamplingConfigsUpdate(
		_message: Sockets.SamplingConfigs.Update.Response
	) {
		toaster.success({ title: "Sampling Config Updated" })
	}
	function handleSamplingConfigsCreate(
		message: Sockets.SamplingConfigs.Create.Response
	) {
		selectedSamplingId = message.sampling.id
		// The modal is closed HERE rather than on confirm — the row exists now,
		// so there is nothing left to correct in it.
		newNameError = undefined
		showNewNameModal = false
		toaster.success({ title: "Sampling Config Created" })
	}
	/**
	 * A refused clone — a name already taken within this modality is the one a
	 * person actually hits, and the answer is to type a different one. So the
	 * message goes under the input that has to change, and the modal stays up.
	 * Both `:error` events are listed in Layout's HANDLED_ERROR_EVENTS, or this
	 * would arrive twice: once here, once as a generated toast.
	 */
	function handleSamplingConfigsCreateError(message: Sockets.ErrorResponse) {
		newNameError = message.error
	}
	/**
	 * The same refusal on a rename. Filed under `name` rather than toasted for
	 * the same reason: it is a statement about that field, and the field is on
	 * screen. The other update errors the server can raise (immutable row,
	 * unknown shape) are unreachable from this form — Update is disabled on
	 * immutable rows and the shape is never edited here.
	 */
	function handleSamplingConfigsUpdateError(message: Sockets.ErrorResponse) {
		validationErrors = { ...validationErrors, name: message.error }
	}
	function handleSamplingConfigsGet(
		message: Sockets.SamplingConfigs.Get.Response
	) {
		// Cloned so the form edits a copy and `originalSamplingConfig` stays a
		// clean baseline for the unsaved-changes comparison. Deep, because the two
		// halves that actually get edited are nested objects.
		sampling = structuredClone(message.sampling)
		originalSamplingConfig = structuredClone(message.sampling)
	}
	function handleSamplingConfigsSetUserActive() {
		toaster.success({ title: "Default sampling config updated" })
	}

	onMount(() => {
		onclose = handleOnClose
		socket.on("samplingConfigs:list", handleSamplingConfigsList)
		socket.on("samplingConfigs:delete", handleSamplingConfigsDelete)
		socket.on("samplingConfigs:update", handleSamplingConfigsUpdate)
		socket.on("samplingConfigs:create", handleSamplingConfigsCreate)
		// Registered and torn down BY NAMED REFERENCE. A bare
		// `socket.off("samplingConfigs:create:error")` removes the
		// FIRST-registered listener for the event, which is Layout's — two real
		// bugs in this codebase already.
		socket.on(
			"samplingConfigs:create:error",
			handleSamplingConfigsCreateError
		)
		socket.on(
			"samplingConfigs:update:error",
			handleSamplingConfigsUpdateError
		)
		socket.on("samplingConfigs:get", handleSamplingConfigsGet)
		socket.on(
			"samplingConfigs:setUserActive",
			handleSamplingConfigsSetUserActive
		)

		socket.emit("samplingConfigs:list", {})
		// Admin create page deep-link: open the new-config flow immediately.
		if (startNew) handleNew()
	})

	onDestroy(() => {
		socket.off("samplingConfigs:list", handleSamplingConfigsList)
		socket.off("samplingConfigs:delete", handleSamplingConfigsDelete)
		socket.off("samplingConfigs:update", handleSamplingConfigsUpdate)
		socket.off("samplingConfigs:create", handleSamplingConfigsCreate)
		socket.off(
			"samplingConfigs:create:error",
			handleSamplingConfigsCreateError
		)
		socket.off(
			"samplingConfigs:update:error",
			handleSamplingConfigsUpdateError
		)
		socket.off("samplingConfigs:get", handleSamplingConfigsGet)
		socket.off(
			"samplingConfigs:setUserActive",
			handleSamplingConfigsSetUserActive
		)
	})
</script>

{#if view === "index"}
	<div class="text-foreground flex h-full flex-col gap-3 p-4">
		<p class="text-muted-foreground text-sm">
			Select a category to view and edit its sampling configurations.
		</p>

		{#each CATEGORIES as cat (cat.shape)}
			{@const count = samplingConfigsList.filter(
				(c) => (c.shape ?? S.textGen) === cat.shape
			).length}
			{@const defaultName = samplingConfigsList.find(
				(c) => c.id === defaultIdFor(cat.shape)
			)?.name}
			<button
				class="card preset-filled-surface-100-900 hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
				onclick={() => openCategory(cat.shape)}
			>
				<div class="flex items-start gap-3">
					<div
						class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
					>
						<cat.icon size={20} />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center justify-between gap-2">
							<span class="font-semibold">{cat.title}</span>
							<Icons.ChevronRight
								size={16}
								class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
							/>
						</div>
						<p class="text-muted-foreground mt-0.5 text-sm">
							{cat.blurb}
						</p>
						<div
							class="text-muted-foreground mt-2 flex items-center gap-3 text-xs"
						>
							<span>
								{count}
								{count === 1 ? "config" : "configs"}
							</span>
							{#if defaultName}
								<span
									class="text-success-600 dark:text-success-400 flex items-center gap-1 font-medium"
								>
									<Icons.CheckCircle size={12} />
									{defaultName}
								</span>
							{/if}
						</div>
					</div>
				</div>
			</button>
		{/each}
	</div>
{:else if view === "enabled"}
	<!-- ── ENABLE / DISABLE ────────────────────────────────────────────────
	     Back neither saves nor discards: a switch flipped here is pending in
	     exactly the way a slider drag is, and the same `unsavedChanges` compare,
	     Reset and close-guard already cover `enabled` for free. -->
	<div class="text-foreground min-h-100 p-4">
		<div class="mb-3">
			<PanelNavHeader
				title="Enabled Parameters"
				onBack={() => (view = "list")}
				backLabel={categoryTitle}
			/>
		</div>
		{#if sampling}
			<p class="text-muted-foreground mb-4 text-sm">
				Only the parameters switched on are sent — the rest are left to
				the backend's own defaults. Their values are edited on the
				previous screen, and nothing is saved until you press Update
				there.
			</p>
			{#if sampling.isImmutable}
				<!-- Repeated from the list screen: without it the switches read
				     as broken rather than as read-only. -->
				<div
					class="preset-tonal-warning mb-4 flex items-center gap-2 rounded-xl p-2 text-sm"
				>
					<Icons.Info size={16} class="shrink-0" />
					This is a built-in config — clone it to make changes.
				</div>
			{/if}
			<SamplingEnabledForm
				schema={activeSchema}
				bind:values={sampling.values}
				bind:enabled={sampling.enabled}
				disabled={sampling.isImmutable}
			/>
		{/if}
	</div>
{:else}
	<div class="text-foreground min-h-100 p-4">
		<div class="mb-3">
			<PanelNavHeader
				title={categoryTitle}
				onBack={backToIndex}
				backLabel="Categories"
			/>
		</div>

		{#if !viewConfigs.length}
			<p class="text-muted-foreground py-8 text-center text-sm">
				No sampling configurations in this category yet.
			</p>
		{:else if !!sampling}
			<div class="panel-actions mt-2 mb-2 sm:mt-0">
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					onclick={handleNew}
					title="Clone to new config"
				>
					<Icons.Plus size={16} />
					Clone
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-secondary-500"
					onclick={handleReset}
					disabled={!unsavedChanges}
					title="Reset unsaved changes"
				>
					<Icons.RefreshCcw size={16} />
					Reset
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-error-500"
					onclick={handleDelete}
					disabled={!!sampling && sampling.isImmutable}
					title="Delete sampling config"
				>
					<Icons.X size={16} />
					Delete
				</button>
			</div>
			<div class="mb-4">
				<select
					class="select w-full"
					bind:value={selectedSamplingId}
					disabled={unsavedChanges}
				>
					{#each viewConfigs.filter((w) => w.isImmutable) as w}
						{@const isDefault = w.id === activeSamplingConfigId}
						<option value={w.id}>
							{isDefault ? "★ " : ""}{w.name}*
						</option>
					{/each}
					{#each viewConfigs.filter((w) => !w.isImmutable) as w}
						{@const isDefault = w.id === activeSamplingConfigId}
						<option value={w.id}>
							{isDefault ? "★ " : ""}{w.name}
						</option>
					{/each}
				</select>
			</div>
			{#if sampling && sampling.isImmutable}
				<div
					class="preset-tonal-warning mb-4 flex items-center gap-2 rounded-xl p-2 text-sm"
				>
					<Icons.Info size={16} class="shrink-0" />
					This is a built-in config (marked with a trailing *) — clone
					it to make changes.
				</div>
			{/if}
			<PanelToolbar label="Sampling config actions" class="mb-4">
				<button
					type="button"
					class="btn btn-sm preset-filled-success-500 min-w-[6rem] flex-1"
					onclick={handleUpdate}
					disabled={(!!sampling && sampling.isImmutable) ||
						!unsavedChanges}
				>
					<Icons.Save size={16} /> Update
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-warning-500 shrink-0"
					onclick={handleSetDefault}
					disabled={!selectedSamplingId ||
						selectedSamplingId === activeSamplingConfigId}
					title={selectedSamplingId === activeSamplingConfigId
						? "Already the default"
						: "Set as default"}
				>
					<Icons.Star
						size={16}
						fill={selectedSamplingId === activeSamplingConfigId
							? "currentColor"
							: "none"}
					/>
					{selectedSamplingId === activeSamplingConfigId
						? "Default"
						: "Set Default"}
				</button>
			</PanelToolbar>

			<form class="space-y-4">
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="samplingName">Name</label>
					<input
						id="samplingName"
						type="text"
						bind:value={sampling.name}
						class="input {validationErrors.name
							? 'border-error-500'
							: ''}"
						disabled={!!sampling && sampling.isImmutable}
						oninput={() => {
							if (validationErrors.name) {
								const { name, ...rest } = validationErrors
								validationErrors = rest
							}
						}}
					/>
					{#if validationErrors.name}
						<p class="text-error-500 mt-1 text-sm" role="alert">
							{validationErrors.name}
						</p>
					{/if}
				</div>

				<!-- The count is the only thing the inline checkboxes carried
				     that this screen no longer shows: it now draws just the
				     parameters that are on, so "N of M" is how you learn there
				     are others. -->
				<button
					type="button"
					class="card preset-filled-surface-100-900 hover:preset-tonal-primary group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl p-3 text-left transition-all"
					onclick={() => (view = "enabled")}
					aria-label="Enabled Parameters — {enabledSummary.on} of {enabledSummary.total}"
				>
					<span class="flex min-w-0 items-center gap-2">
						<Icons.ListChecks
							size={16}
							class="text-primary-500 shrink-0"
						/>
						<span class="truncate font-semibold">
							Enabled Parameters
						</span>
					</span>
					<span
						class="text-muted-foreground flex shrink-0 items-center gap-1 text-sm"
					>
						{enabledSummary.on} of {enabledSummary.total}
						<Icons.ChevronRight
							size={16}
							class="transition-transform group-hover:translate-x-0.5"
						/>
					</span>
				</button>

				<!-- Every ENABLED parameter the shape declares. The switches are
				     next door; the old form listed nine hand-picked samplers and
				     the rest of the table was unreachable from anywhere. -->
				<SamplingValuesForm
					schema={activeSchema}
					bind:values={sampling.values}
					enabled={sampling.enabled}
					disabled={sampling.isImmutable}
				/>
			</form>
		{/if}
	</div>
{/if}

<SamplingConfigUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
<NewNameModal
	open={showNewNameModal}
	onOpenChange={(e) => {
		showNewNameModal = e.open
		// Dismissed by backdrop or Escape — the refusal went with it.
		if (!e.open) newNameError = undefined
	}}
	onConfirm={handleNewNameConfirm}
	onCancel={handleNewNameCancel}
	title="New Sampling Config"
	description="Your current settings will be copied."
	error={newNameError}
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
				class="card bg-surface-100-900 max-w-[95vw] space-y-4 p-4 shadow-xl"
			>
				<header class="flex justify-between">
					<h2 class="h2">Delete Sampling Configuration</h2>
				</header>
				<article>
					<p class="opacity-60">
						Are you sure you want to delete the sampling
						configuration "{sampling?.name}"? This action cannot be
						undone.
					</p>
				</article>
				<footer class="flex justify-end gap-4">
					<button
						class="btn preset-filled-surface-500"
						onclick={cancelDelete}
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
