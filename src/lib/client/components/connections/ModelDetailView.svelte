<script lang="ts">
	/**
	 * One MODEL's own detail view — every control for a pair lives here.
	 *
	 * Reached from a model row in the index, never inline: the connection
	 * view stays about the endpoint, and a model is always edited with its
	 * full context (identifier, overrides, which instance defaults point at
	 * it, whether its host still lists it) around it. All writes go through
	 * `useConnectionModels`, so every response still replaces wholesale and
	 * the chips can never lag a press behind.
	 *
	 * Availability leads. A model the host has stopped listing is refused
	 * everywhere, and this is the one screen that can say since when, what
	 * that means, and what to do about it — refresh once the host serves it
	 * again, remove it, or go to the connection whose runtime owns it.
	 */
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { Menu, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { sectionForModality } from "$lib/shared/constants/connectionSections"
	import { modalityLabel } from "$lib/shared/constants/ConnectionTypes"
	import {
		modelModalityChoices,
		modelPurposeChoices
	} from "$lib/shared/connections/modelModality"
	import {
		modelKindsOf,
		purposeOn,
		SINGLE_MODALITIES,
		toggledPurpose
	} from "$lib/shared/connections/modelKinds"
	import { defaultLoadoutName } from "$lib/shared/loadouts/defaultLoadoutName"
	import { shortDate, timeAgo } from "$lib/client/utils/timeAgo"
	import { useConnectionModels } from "./useConnectionModels.svelte"
	import {
		managerFor,
		modelsSourceHint,
		removeAllowed,
		type ModelManager
	} from "./modelManagement"
	import type {
		CapabilityDefaultRef,
		PairDefaultSelection
	} from "./modelSystemDefaults"
	import type { ConnectionModelRow } from "./useConnectionModels.svelte"
	import type { Snippet } from "svelte"

	interface Props {
		connectionId: number
		connectionName: string
		modelId: number
		capabilityDefaults?: Record<string, CapabilityDefaultRef | undefined>
		/** A refresh of this endpoint is in flight. */
		syncing: boolean
		onBack: () => void
		onSelectDefault: (
			model: ConnectionModelRow,
			selection: PairDefaultSelection
		) => void
		/** Ask the host again (forced). */
		onRefresh: () => void
		/**
		 * Open the connection whose runtime owns this endpoint's models.
		 *
		 * The managers fold into their connection (2026-09-17 ruling R2), so
		 * the press lands on that connection's view — which is where the
		 * models are.
		 */
		onOpenManager: (manager: ModelManager) => void
		/** The model row is gone (removed elsewhere) — leave the view. */
		onRemoved: () => void
		/**
		 * Asked before the identifier is saved; false keeps the old one.
		 * Renaming the starred embedding model's identifier makes it another
		 * model, and the owner asks first when that re-embeds the index.
		 */
		confirmIdentifier?: (
			model: ConnectionModelRow,
			next: string
		) => Promise<boolean>
		/**
		 * The Models view's *Use in…* menu (`UseInMenu`), drawn in place of
		 * *Set as default…*: there a model is put in a loadout, the default
		 * loadout first. Absent, the defaults menu stays (the Connections view).
		 */
		useIn?: Snippet<[ConnectionModelRow]>
	}
	let {
		connectionId,
		connectionName,
		modelId,
		capabilityDefaults = {},
		syncing,
		onBack,
		onSelectDefault,
		onRefresh,
		onOpenManager,
		onRemoved,
		confirmIdentifier,
		useIn
	}: Props = $props()

	const models = useConnectionModels(() => connectionId)
	const row = $derived(models.rows.find((m) => m.id === modelId))
	const manager = $derived(managerFor(models.endpointType))
	const canRemove = $derived(removeAllowed(models.endpointType))
	const sourceHint = $derived(modelsSourceHint(models.endpointType))
	const missing = $derived(row?.missingSince != null)

	/**
	 * The SAME list the endpoint's own format picker shows — from the table,
	 * not from the constant beside it, so a template an admin wrote is
	 * selectable here too.
	 */
	const formatOptions = completionTemplateOptions()

	// Leave when the row disappears under us (removed from another tab or
	// from this view's own Remove). Loading first is not disappearing.
	let everLoaded = $state(false)
	$effect(() => {
		if (!models.loading && row) everLoaded = true
		if (everLoaded && !models.loading && !row) onRemoved()
	})

	const satisfiable = $derived(row?.satisfiableCapabilities ?? [])

	/**
	 * What a model on this connection's type can be FOR
	 * (`modelModalityChoices`, the one answer `connections:updateModel` judges
	 * a choice by). One choice is no choice, so the control shows only where
	 * there are two.
	 */
	const modalityChoices = $derived(
		modelModalityChoices(models.endpointType ?? "")
			.map((m) => sectionForModality(m))
			.filter((s): s is NonNullable<typeof s> => !!s)
	)

	const modalityOptions = $derived.by(() => {
		const options = modalityChoices.map((s) => ({
			value: s.modality,
			label: s.starVerb.charAt(0).toUpperCase() + s.starVerb.slice(1)
		}))
		// A value the type does not offer (written before the choices
		// narrowed) still reads as itself rather than as a blank box.
		const saved = row?.modality
		if (saved && !options.some((o) => o.value === saved))
			options.push({ value: saved, label: modalityLabel(saved) })
		return [...options, { value: "", label: "Not sure" }]
	})

	/**
	 * The pick in flight. The box shows it while the write is out and the
	 * saved value after, so a refused pick falls back to what is stored.
	 */
	let modalityPick = $state<string | null>(null)

	/**
	 * 🚧 **What it's for**, as several choices (O3): Writes replies · Draws
	 * pictures · Speaks · Hears · Sees — the ones this connection's type can
	 * carry (`modelPurposeChoices`, the answer `connections:updateModel`
	 * judges by). An embedding or entities model keeps its one choice (the
	 * select below).
	 */
	const singlePurpose = $derived(
		!!row?.modality && SINGLE_MODALITIES.has(row.modality)
	)
	const purposeChoices = $derived(
		modelPurposeChoices(models.endpointType ?? "")
	)
	const kinds = $derived(
		modelKindsOf({
			modality: row?.modality ?? null,
			reads: row?.reads ?? null,
			writes: row?.writes ?? null
		})
	)

	/**
	 * Files on this endpoint that look like vision projectors, offered as
	 * suggestions — the managed listing shows an mmproj GGUF as a model row
	 * like any other, and its name is the only hint there is.
	 */
	const projectorFiles = $derived(
		models.rows
			.map((m) => m.model)
			.filter((name) => /mmproj|projector/i.test(name))
	)

	function isCurrent(capability: string): boolean {
		if (!row) return false
		const def = capabilityDefaults[capability]
		if (!def || def.connectionId !== connectionId) return false
		return def.connectionModelId === row.id
	}

	/** Defaults that point here even though the pair cannot serve them. */
	const currentDefaults = $derived(
		Object.keys(capabilityDefaults).filter((c) => isCurrent(c))
	)

	/** "Use in Reply" — the default loadout this pick fills. */
	function labelFor(capability: string): string {
		return `Use in ${defaultLoadoutName(capability)}`
	}

	const remainingCount = $derived(
		satisfiable.filter((c) => !isCurrent(c)).length
	)

	function choose(value: string) {
		if (!row) return
		if (value === "__all") {
			const rest = satisfiable.filter((c) => !isCurrent(c))
			if (rest.length)
				onSelectDefault(row, { kind: "all", capabilities: rest })
			return
		}
		if (!isCurrent(value))
			onSelectDefault(row, { kind: "one", capability: value })
	}

	let confirmingRemove = $state(false)

	const menuItem =
		"hover:bg-surface-200-800 data-[highlighted]:bg-surface-200-800 flex h-9 cursor-pointer items-center justify-between gap-4 rounded-lg px-2.5 text-chip"
</script>

<div class="flex h-full flex-col gap-3">
	<!-- Back at every width: this level replaced the one it came from in
	     the detail pane (a connection, a capability), so that level is off
	     screen even at desk. -->
	<PanelNavHeader title="Model" {onBack} backLabel="Back" />
	<DetailHero
		title="Model"
		icon={Icons.Box}
		subtitle="on {connectionName}{row && row.model !== row.name
			? ` · ${row.model}`
			: ''}"
	/>

	{#if models.loading}
		<LoadingState message="Loading model…" />
	{:else if !row}
		<p class="text-surface-600-400 text-sm">
			This model is gone — removed here or in another tab.
		</p>
		<button
			type="button"
			class="btn preset-tonal-surface w-full"
			onclick={onBack}
		>
			Back
		</button>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4">
			<!-- AVAILABILITY. First, because it is the one thing that can make
			     every other control moot. -->
			{#if missing}
				<div
					class="preset-tonal-warning flex flex-col gap-2 rounded-lg p-3"
					role="alert"
				>
					<div class="flex items-start gap-2">
						<Icons.TriangleAlert
							size={16}
							class="mt-0.5 shrink-0"
							aria-hidden="true"
						/>
						<div class="min-w-0 flex-1 text-xs">
							<p class="font-semibold">
								Not listed by the host since {shortDate(
									row.missingSince
								)}.
							</p>
							<p class="mt-0.5">
								{#if currentDefaults.length}
									It is still in the
									{currentDefaults
										.map((c) => defaultLoadoutName(c))
										.join(", ")}
									{currentDefaults.length > 1
										? "loadouts"
										: "loadout"}, so those runs refuse until
									it comes back.
								{:else}
									Anything set to use it refuses to run until
									the host serves it again.
								{/if}
								Its settings are kept.
							</p>
						</div>
					</div>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							disabled={syncing}
							onclick={onRefresh}
						>
							<Icons.RefreshCw
								size={12}
								class={syncing ? "animate-spin" : ""}
								aria-hidden="true"
							/>
							Check again
						</button>
						{#if manager}
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface"
								onclick={() => onOpenManager(manager)}
							>
								<Icons.ExternalLink
									size={12}
									aria-hidden="true"
								/>
								Open {manager.label}
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<div
					class="text-surface-600-400 flex items-center gap-2 text-xs"
				>
					<Icons.Check size={12} aria-hidden="true" />
					<span class="min-w-0 flex-1 truncate">
						{#if models.modelsSync.at}
							Listed by the host · checked {timeAgo(
								models.modelsSync.at
							)}
						{:else}
							Not checked against the host yet
						{/if}
					</span>
					<button
						type="button"
						class="btn btn-icon btn-icon-sm hover:preset-tonal-surface"
						disabled={syncing}
						onclick={onRefresh}
						title="Ask the host again"
						aria-label="Refresh this connection's models"
					>
						<Icons.RefreshCw
							size={12}
							class={syncing ? "animate-spin" : ""}
							aria-hidden="true"
						/>
					</button>
				</div>
			{/if}

			<!-- The OVERRIDES. Every one of them is blank by default and
			     blank means "whatever the connection says". -->
			<div class="flex flex-col gap-2">
				<div class="flex flex-col gap-1">
					<label class="text-xs font-semibold" for="model-name">
						Display name
					</label>
					<input
						id="model-name"
						class="input text-sm"
						value={row.name}
						disabled={models.busy}
						onchange={(e) =>
							models.patch(row, { name: e.currentTarget.value })}
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-semibold" for="model-sends">
						Sends
					</label>
					<input
						id="model-sends"
						class="input text-sm"
						value={row.model}
						disabled={models.busy || !canRemove}
						title={canRemove
							? "What the adapter sends"
							: "The identifier comes from the host and cannot be edited here"}
						onchange={async (e) => {
							const input = e.currentTarget
							const next = input.value
							if (
								confirmIdentifier &&
								!(await confirmIdentifier(row, next))
							) {
								input.value = row.model
								return
							}
							models.patch(row, { model: next })
						}}
					/>
					<p class="text-surface-600-400 text-xs">
						What the service knows it by — the text this connection
						sends.
					</p>
				</div>

				{#if !singlePurpose && purposeChoices.length > 1}
					<fieldset
						class="flex flex-col gap-1"
						aria-describedby="model-purpose-hint"
					>
						<legend class="text-xs font-semibold">What it's for</legend>
						<div class="flex flex-wrap gap-x-4 gap-y-1">
							{#each purposeChoices as purpose (purpose.key)}
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										class="checkbox"
										checked={purposeOn(kinds, purpose)}
										disabled={models.busy}
										onchange={(e) =>
											models.patch(
												row,
												toggledPurpose(
													kinds,
													purpose,
													e.currentTarget.checked
												)
											)}
									/>
									{purpose.label}
								</label>
							{/each}
						</div>
						<p
							id="model-purpose-hint"
							class="text-surface-600-400 text-xs"
						>
							Tick what this model does, so the right models are
							offered for each loadout.
							{#if kinds.reads == null}
								What it hears and sees isn't set — the
								connection's switches decide.
							{/if}
						</p>
					</fieldset>
				{:else if modalityChoices.length > 1}
					<div class="flex flex-col gap-1">
						<Select
							label="What it's for"
							value={models.busy && modalityPick != null
								? modalityPick
								: (row.modality ?? "")}
							disabled={models.busy}
							options={modalityOptions}
							describedBy="model-modality-hint"
							onValueChange={(v) => {
								if (v === (row.modality ?? "")) return
								modalityPick = v
								models.patch(row, { modality: v || null })
							}}
						/>
						<p
							id="model-modality-hint"
							class="text-surface-600-400 text-xs"
						>
							Set it so the right models are offered for each loadout;
							Not sure offers this one for all of them. A service
							that says what its models are for replaces this on
							the next refresh.
						</p>
					</div>
				{/if}

				<div class="flex flex-col gap-1">
					<label class="text-xs font-semibold" for="model-window">
						Context window
					</label>
					<input
						id="model-window"
						class="input text-sm"
						type="number"
						min="1"
						placeholder="From the sampling config"
						value={row.contextWindow ?? ""}
						disabled={models.busy}
						onchange={(e) =>
							models.patch(row, {
								contextWindow:
									e.currentTarget.value === ""
										? null
										: Number(e.currentTarget.value)
							})}
					/>
				</div>

				<Select
					label="Completion template"
					value={row.promptFormat ?? ""}
					disabled={models.busy}
					options={[
						{ value: "", label: "From the connection" },
						...formatOptions.value.map((t) => ({
							value: String(t.value),
							label: t.label
						}))
					]}
					onValueChange={(v) =>
						models.patch(row, { promptFormat: v || null })}
				/>

				<Select
					label="Tokenizer"
					value={row.tokenCounter ?? ""}
					disabled={models.busy}
					options={[
						{ value: "", label: "From the connection" },
						...TokenCounterOptions.options.map((t) => ({
							value: String(t.value),
							label: t.label
						}))
					]}
					onValueChange={(v) =>
						models.patch(row, { tokenCounter: v || null })}
				/>

				{#if row.visionProjector !== undefined && row.modality !== "image-gen"}
					<!-- The managed KoboldCPP only: the server sends the field
					     for its rows and no others. -->
					<div class="flex flex-col gap-1">
						<label class="text-xs font-semibold" for="model-mmproj">
							Vision projector
						</label>
						<input
							id="model-mmproj"
							class="input text-sm"
							list="model-mmproj-files"
							placeholder="None"
							spellcheck="false"
							autocomplete="off"
							value={row.visionProjector ?? ""}
							disabled={models.busy}
							onchange={(e) =>
								models.patch(row, {
									visionProjector:
										e.currentTarget.value.trim() || null
								})}
						/>
						<datalist id="model-mmproj-files">
							{#each projectorFiles as file (file)}
								<option value={file}></option>
							{/each}
						</datalist>
						<p class="text-surface-600-400 text-xs">
							The model's mmproj file, in the models folder. Set
							one to let this model read images; it turns Vision
							on for it.
						</p>
					</div>
				{/if}

				<Switch
					name="model-enabled"
					checked={row.enabled}
					disabled={models.busy}
					onCheckedChange={(e) =>
						models.patch(row, { enabled: e.checked })}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="text-xs font-semibold">
						Offer in pickers
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
			</div>

			{#if useIn}
				<div class="flex flex-col gap-1.5">
					<span class="text-xs font-semibold">Loadouts</span>
					<p class="text-surface-600-400 text-xs">
						Which loadouts run this model. A step runs on its
						default loadout unless it names another.
					</p>
					{@render useIn(row)}
				</div>
			{:else}
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-semibold">Default loadouts</span>
				<p class="text-surface-600-400 text-xs">
					Which default loadouts run this model. "All" fills every
					one it can serve.
				</p>
				<Menu onSelect={(details) => choose(details.value)}>
					<Menu.Trigger
						class="btn preset-tonal-surface w-full"
						disabled={models.busy || !row.enabled || missing}
						title={missing
							? "The host no longer lists this model — it cannot fill a loadout until it comes back"
							: !row.enabled
								? "Switch the model on first — the star refuses it while it is off"
								: `Choose which default loadouts run ${row.name}`}
					>
						<Icons.Crown size={14} aria-hidden="true" />
						Use in…
					</Menu.Trigger>
					<Portal>
						<Menu.Positioner class="z-[1000]!">
							<Menu.Content
								class="bg-surface-50-950 border-surface-200-800 max-w-[90vw] min-w-56 overflow-y-auto rounded-container border p-1 shadow-xl"
							>
								{#if !satisfiable.length}
									<p class="text-surface-600-400 p-2 text-xs">
										No default loadout can run this model
										— the connection cannot do any of it.
									</p>
								{:else}
									<Menu.Item value="__all" class={menuItem}>
										<Menu.ItemText>
											All of them ({remainingCount} remaining)
										</Menu.ItemText>
									</Menu.Item>
									{#each satisfiable as capability (capability)}
										<Menu.Item
											value={capability}
											class={menuItem}
										>
											<Menu.ItemText>
												{labelFor(capability)}
											</Menu.ItemText>
											{#if isCurrent(capability)}
												<Icons.Check
													size={12}
													class="text-success-500 shrink-0"
													aria-label="In this loadout"
												/>
											{/if}
										</Menu.Item>
									{/each}
								{/if}
							</Menu.Content>
						</Menu.Positioner>
					</Portal>
				</Menu>
				{#if currentDefaults.length}
					<p class="text-surface-600-400 text-xs">
						Currently in the
						{currentDefaults
							.map((c) => defaultLoadoutName(c))
							.join(", ")}
						{currentDefaults.length > 1 ? "loadouts" : "loadout"}.
					</p>
				{/if}
			</div>
			{/if}

			<!-- REMOVE, or the door to whoever owns this row. -->
			<div class="flex flex-col gap-1.5">
				{#if canRemove}
					{#if confirmingRemove}
						<p class="text-xs font-medium">
							Remove "{row.name}"? The connection is kept.
						</p>
						<div class="flex gap-2">
							<button
								type="button"
								class="btn preset-tonal-surface flex-1"
								onclick={() => (confirmingRemove = false)}
							>
								Keep
							</button>
							<button
								type="button"
								class="btn preset-filled-error-500 flex-1"
								disabled={models.busy}
								onclick={() => models.remove(row)}
							>
								<Icons.Trash2 size={14} aria-hidden="true" />
								Remove model
							</button>
						</div>
					{:else}
						<button
							type="button"
							class="btn preset-tonal-error w-full"
							disabled={models.busy}
							title="Remove this model (the connection is kept)"
							onclick={() => (confirmingRemove = true)}
						>
							<Icons.Trash2 size={14} aria-hidden="true" />
							Remove model
						</button>
						{#if !missing}
							<p class="text-surface-600-400 text-xs">
								A model the host lists comes back on the next
								refresh — switch it off instead to hide it.
							</p>
						{/if}
					{/if}
				{:else if manager}
					<button
						type="button"
						class="btn preset-tonal-surface w-full"
						onclick={() => onOpenManager(manager)}
					>
						<Icons.ExternalLink size={14} aria-hidden="true" />
						Manage in {manager.label}
					</button>
					<p class="text-surface-600-400 text-xs">{sourceHint}</p>
				{:else if sourceHint}
					<p class="text-surface-600-400 text-xs">{sourceHint}</p>
				{/if}
			</div>

			{#if models.notice}
				<p class="text-surface-600-400 text-xs" role="status">
					{models.notice}
				</p>
			{/if}
		</div>
	{/if}
</div>
