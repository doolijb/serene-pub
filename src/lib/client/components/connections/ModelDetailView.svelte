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
	 * again, remove it, or go to the manager that owns it.
	 */
	import * as Icons from "@lucide/svelte"
	import { Menu, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { sectionForCapability } from "$lib/shared/constants/connectionSections"
	import { capabilityLabel } from "@serene-pub/sdk"
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
		/** Open the manager that owns this endpoint's models. */
		onOpenManager: (manager: ModelManager) => void
		/** The model row is gone (removed elsewhere) — leave the view. */
		onRemoved: () => void
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
		onRemoved
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

	function labelFor(capability: string): string {
		try {
			return `Use for ${capabilityLabel(capability as any).toLowerCase()}`
		} catch {
			const verb = sectionForCapability(capability)?.starVerb
			return verb ? `Use for ${verb}` : capability
		}
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
		"hover:preset-tonal-primary data-[highlighted]:preset-tonal-primary flex cursor-pointer items-center justify-between gap-4 rounded px-2 py-1.5 text-sm"
</script>

<div class="flex h-full flex-col gap-3">
	<div class="flex items-center gap-2">
		<button
			type="button"
			class="btn btn-sm preset-filled-surface-400-600 p-2"
			onclick={onBack}
			title="Back"
			aria-label="Back"
		>
			<Icons.ChevronLeft size={16} />
		</button>
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-sm font-semibold">
				{row?.name ?? "Model"}
			</h2>
			<p class="text-muted truncate text-xs">
				on {connectionName}{row && row.model !== row.name
					? ` · ${row.model}`
					: ""}
			</p>
		</div>
	</div>

	{#if models.loading}
		<p class="text-muted text-sm">Loading model…</p>
	{:else if !row}
		<p class="text-muted text-sm">
			This model is gone — removed here or in another tab.
		</p>
		<button
			type="button"
			class="btn preset-filled-surface-400-600 w-full"
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
									It is still the default for
									{currentDefaults
										.map(
											(c) =>
												sectionForCapability(c)
													?.starVerb ?? c
										)
										.join(", ")}, so those runs refuse until
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
							class="btn btn-sm preset-filled-surface-400-600"
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
								class="btn btn-sm preset-filled-surface-400-600"
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
				<div class="text-muted flex items-center gap-2 text-xs">
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
						class="btn-icon btn-icon-sm hover:preset-tonal-surface"
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
						onchange={(e) =>
							models.patch(row, { model: e.currentTarget.value })}
					/>
					<p class="text-muted text-xs">
						What the service knows it by — the text this connection
						sends.
					</p>
				</div>

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

				<div class="flex flex-col gap-1">
					<label class="text-xs font-semibold" for="model-template">
						Completion template
					</label>
					<select
						id="model-template"
						class="select text-sm"
						value={row.promptFormat ?? ""}
						disabled={models.busy}
						onchange={(e) =>
							models.patch(row, {
								promptFormat: e.currentTarget.value || null
							})}
					>
						<option value="">From the connection</option>
						{#each formatOptions.value as t (t.value)}
							<option value={t.value}>{t.label}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-semibold" for="model-tokenizer">
						Tokenizer
					</label>
					<select
						id="model-tokenizer"
						class="select text-sm"
						value={row.tokenCounter ?? ""}
						disabled={models.busy}
						onchange={(e) =>
							models.patch(row, {
								tokenCounter: e.currentTarget.value || null
							})}
					>
						<option value="">From the connection</option>
						{#each TokenCounterOptions.options as t (t.value)}
							<option value={t.value}>{t.label}</option>
						{/each}
					</select>
				</div>

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

			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-semibold">Instance defaults</span>
				<p class="text-muted text-xs">
					Which system defaults point at this model. "All" writes
					every transform it can serve.
				</p>
				<Menu onSelect={(details) => choose(details.value)}>
					<Menu.Trigger
						class="btn preset-filled-surface-400-600 w-full"
						disabled={models.busy || !row.enabled || missing}
						title={missing
							? "The host no longer lists this model — it cannot be a default until it comes back"
							: !row.enabled
								? "Switch the model on first — the star refuses it while it is off"
								: `Choose which instance defaults point at ${row.name}`}
					>
						<Icons.Crown size={14} aria-hidden="true" />
						Set as default…
					</Menu.Trigger>
					<Portal>
						<Menu.Positioner class="z-[1000]!">
							<Menu.Content
								class="card preset-filled-surface-100-900 max-w-[90vw] min-w-56 overflow-y-auto p-1 shadow-xl"
							>
								{#if !satisfiable.length}
									<p class="text-muted p-2 text-xs">
										Nothing this model can be a default for
										— the connection cannot do any of it.
									</p>
								{:else}
									<Menu.Item value="__all" class={menuItem}>
										<Menu.ItemText>
											Default for all ({remainingCount} remaining)
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
													aria-label="Current default"
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
					<p class="text-muted text-xs">
						Currently the default for
						{currentDefaults
							.map((c) => labelFor(c).replace(/^Use for /, ""))
							.join(", ")}.
					</p>
				{/if}
			</div>

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
								class="btn preset-filled-surface-400-600 flex-1"
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
								Remove
							</button>
						</div>
					{:else}
						<button
							type="button"
							class="btn preset-filled-surface-400-600 w-full"
							disabled={models.busy}
							title="Remove this model (the connection is kept)"
							onclick={() => (confirmingRemove = true)}
						>
							<Icons.Trash2 size={14} aria-hidden="true" />
							Remove model
						</button>
						{#if !missing}
							<p class="text-muted text-xs">
								A model the host lists comes back on the next
								refresh — switch it off instead to hide it.
							</p>
						{/if}
					{/if}
				{:else if manager}
					<button
						type="button"
						class="btn preset-filled-surface-400-600 w-full"
						onclick={() => onOpenManager(manager)}
					>
						<Icons.ExternalLink size={14} aria-hidden="true" />
						Manage in the {manager.label}
					</button>
					<p class="text-muted text-xs">{sourceHint}</p>
				{:else if sourceHint}
					<p class="text-muted text-xs">{sourceHint}</p>
				{/if}
			</div>

			{#if models.notice}
				<p class="text-muted text-xs" role="status">{models.notice}</p>
			{/if}
		</div>
	{/if}
</div>
