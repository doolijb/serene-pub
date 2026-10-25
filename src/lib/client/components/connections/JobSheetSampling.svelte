<script lang="ts">
	/**
	 * A job's sheet, after **Which model answers**: **How it writes** (the
	 * job's default sampling config, for a job whose output has a sampling
	 * vocabulary) and **Where this applies** (plan 2026-10-11, lane B).
	 *
	 * ## How it writes
	 *
	 * The configs of the job's shape as radio rows, ★ on the one the job's
	 * default names now (`systemSettingsCtx.capabilityDefaults`). Choosing a
	 * row IS the write, at once, like the model's Use:
	 * `samplingConfigs:setDefaultFor { id, transforms: [job] }`, which keeps
	 * the job's model. The row shows checked while the write is in flight;
	 * the ★ moves when the server's `systemSettings:get` lands. **Open in
	 * Sampling** takes the checked config to the Sampling view, which owns
	 * editing, New and Duplicate (owner 2026-10-11: the sheet picks, the
	 * view edits).
	 *
	 * ## Where this applies
	 *
	 * One sentence, then the pipelines whose `sampling` slot picks a config
	 * of this shape themselves (`samplingConfigs:usedBy`), each a door to
	 * Admin › Pipelines — the answer to "why didn't my change do anything?".
	 *
	 * Mounted only while the sheet is open, so its `samplingConfigs:`
	 * interests and its two reads live only as long as the sheet does. Every
	 * word comes from `jobSheet.ts`.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import { samplingShapeForCapability } from "$lib/shared/capabilities/samplingShape"
	import {
		jobsWithLiveDefaults,
		samplingSidebarMemory,
		type SamplingListRow
	} from "$lib/client/components/sidebars/samplingList"
	import { openInPipelines } from "$lib/client/admin/railDoors"
	import {
		OPEN_IN_SAMPLING_VERB,
		NO_SAMPLING_CONFIGS_SENTENCE,
		NO_SAMPLING_DEFAULT_SENTENCE,
		SAMPLING_SUBLINE,
		overridesSentence,
		overridingPipelines,
		pipelineLinkLabel,
		samplingChoiceLabel,
		samplingChoiceRows,
		samplingDefaultToast,
		sheetSections,
		speechSamplingNote,
		whereSentence,
		type OverridingPipeline
	} from "./jobSheet"

	interface Props {
		/** The job's transform id. */
		capability: string
		/** Close the whole sheet: a door here leads to another view. */
		onLeave: () => void
	}
	let { capability, onLeave }: Props = $props()

	const socket = useTypedSocket()
	const uid = $props.id()
	const systemSettingsCtx = getContext<SystemSettingsCtx | undefined>(
		"systemSettingsCtx"
	)
	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")

	const shape = $derived(samplingShapeForCapability(capability))
	const sections = $derived(sheetSections(capability))
	const samplingSection = $derived(sections.find((s) => s.key === "sampling"))
	const speechNote = $derived(speechSamplingNote(capability))
	const whereSection = $derived(sections.find((s) => s.key === "where")!)

	// ── The configs, and what picks them ─────────────────────────────────────
	let samplingConfigsList: SamplingListRow[] = $state([])
	let listLoaded = $state(false)
	let usedBy = $state<Sockets.SamplingConfigs.UsedBy.Response | null>(null)
	const jobs = $derived(
		jobsWithLiveDefaults(
			usedBy?.jobs ?? [],
			systemSettingsCtx?.capabilityDefaults
		)
	)
	/** The config this job's default names now: the ★. */
	const defaultId = $derived(
		systemSettingsCtx?.capabilityDefaults?.[capability]?.samplingConfigId ??
			null
	)
	/** A pick in flight: shown checked until its answer lands. */
	let pendingId = $state<number | null>(null)
	const checkedId = $derived(pendingId ?? defaultId)
	const rows = $derived(
		samplingChoiceRows(samplingConfigsList, capability, defaultId)
	)
	const overrides = $derived(
		overridingPipelines(samplingConfigsList, usedBy?.pipelines, capability)
	)

	// ── Choosing ─────────────────────────────────────────────────────────────
	let settingDefault = false
	function pick(id: number) {
		if (id === checkedId) return
		pendingId = id
		settingDefault = true
		socket.emit("samplingConfigs:setDefaultFor", {
			id,
			transforms: [capability]
		})
	}

	// ── The door to the Sampling view ────────────────────────────────────────
	/** The checked config, when it is one of this job's rows. */
	const editTarget = $derived(
		checkedId != null && rows.some((r) => r.id === checkedId)
			? checkedId
			: null
	)
	/** The Sampling view opens on the checked config and owns the editing. */
	function openInSampling() {
		samplingSidebarMemory.selectedId = editTarget
		panelsCtx?.openPanel({ key: "sampling", toggle: false })
		onLeave()
	}

	// ── Where this applies: links out ────────────────────────────────────────
	function openPipeline(p: OverridingPipeline) {
		openInPipelines(panelsCtx, { slug: p.slug })
		onLeave()
	}

	// ── Socket answers ───────────────────────────────────────────────────────
	function handleSamplingConfigsList(
		message: Sockets.SamplingConfigs.List.Response
	) {
		samplingConfigsList = message.samplingConfigsList
		listLoaded = true
	}
	function handleSamplingConfigsUsedBy(
		message: Sockets.SamplingConfigs.UsedBy.Response
	) {
		usedBy = message
	}
	function handleSamplingConfigsSetDefaultFor(
		message: Sockets.SamplingConfigs.SetDefaultFor.Response
	) {
		if (!settingDefault) return
		settingDefault = false
		pendingId = null
		const name =
			samplingConfigsList.find((c) => c.id === message.id)?.name ?? null
		toaster.success(samplingDefaultToast(name, capability))
	}
	/** Refused: the radio goes back; Layout's catch-all says why. */
	function handleSamplingConfigsSetDefaultForError() {
		if (!settingDefault) return
		settingDefault = false
		pendingId = null
	}
	/** A deleted config drops out of every pipeline's pick: re-read Used by. */
	function handleSamplingConfigsDelete() {
		socket.emit("samplingConfigs:usedBy", {})
	}

	useInterest<"samplingConfigs:list">(
		"samplingConfigs:list",
		handleSamplingConfigsList
	)
	useInterest<"samplingConfigs:usedBy">(
		"samplingConfigs:usedBy",
		handleSamplingConfigsUsedBy
	)
	useInterest<"samplingConfigs:setDefaultFor">(
		"samplingConfigs:setDefaultFor",
		handleSamplingConfigsSetDefaultFor
	)
	useInterest<"samplingConfigs:setDefaultFor:error">(
		"samplingConfigs:setDefaultFor:error",
		handleSamplingConfigsSetDefaultForError
	)
	useInterest<"samplingConfigs:delete">(
		"samplingConfigs:delete",
		handleSamplingConfigsDelete
	)

	// ⚠ AFTER the interests above, never before: `onMount` is an effect, and
	// effects run in declaration order, so the gated keys are declared before
	// the reads go out (as the Sampling view had it).
	onMount(() => {
		if (!shape) return
		socket.emit("samplingConfigs:list", {})
		socket.emit("samplingConfigs:usedBy", {})
	})
</script>

{#if samplingSection}
	<section
		class="flex flex-col gap-2"
		aria-labelledby="{uid}-sampling"
		data-sheet-section="sampling"
	>
		<div class="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
			<span
				class="text-surface-600-400 font-mono text-xs"
				aria-hidden="true"
			>
				{samplingSection.number}
			</span>
			<h2 id="{uid}-sampling" class="text-sm font-semibold">
				{samplingSection.heading}
			</h2>
			<span class="text-surface-600-400 text-xs">{SAMPLING_SUBLINE}</span>
		</div>
		{#if speechNote}
			<!-- 🚧 O7: a job that writes and speaks takes a second sampling. -->
			<p class="text-surface-600-400 px-1 text-xs leading-relaxed">
				{speechNote}
			</p>
		{/if}

		{#if !listLoaded}
			<LoadingState message="Loading sampling configs…" />
		{:else if !rows.length}
			<p class="text-surface-600-400 px-1 text-xs leading-relaxed">
				{NO_SAMPLING_CONFIGS_SENTENCE}
			</p>
		{:else}
			<!-- One radio per config; choosing one IS the write. -->
			<div
				class="flex flex-col gap-1"
				role="radiogroup"
				aria-labelledby="{uid}-sampling"
			>
				{#each rows as row (row.id)}
					{@const checked = row.id === checkedId}
					<button
						type="button"
						role="radio"
						aria-checked={checked}
						class="focus-visible:ring-primary-500 flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-base px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none {checked
							? 'sidebar-row-active'
							: 'hover:bg-surface-200-800'}"
						aria-label={samplingChoiceLabel(row, capability)}
						onclick={() => pick(row.id)}
					>
						<span
							class="grid size-4 shrink-0 place-items-center rounded-full border-2 {checked
								? 'border-primary-500'
								: 'border-surface-400-600'}"
							aria-hidden="true"
						>
							{#if checked}
								<span
									class="bg-primary-500 size-2 rounded-full"
								></span>
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span class="flex min-w-0 items-center gap-1.5">
								<span class="truncate text-lead font-medium">
									{row.name}
								</span>
								{#if row.isDefault}
									<Icons.Star
										size={14}
										class="text-primary-500 shrink-0 fill-current"
										aria-hidden="true"
									/>
								{/if}
							</span>
							<span
								class="text-surface-600-400 block truncate text-xs"
							>
								{row.line}
							</span>
						</span>
					</button>
				{/each}
			</div>
			{#if checkedId == null}
				<p class="text-surface-600-400 px-1 text-xs leading-relaxed">
					{NO_SAMPLING_DEFAULT_SENTENCE}
				</p>
			{/if}
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				disabled={!listLoaded}
				onclick={openInSampling}
			>
				<Icons.SlidersHorizontal size={16} aria-hidden="true" />
				{OPEN_IN_SAMPLING_VERB}
			</button>
		</div>
	</section>
{/if}

<section
	class="flex flex-col gap-2"
	aria-labelledby="{uid}-where"
	data-sheet-section="where"
>
	<div class="flex min-w-0 items-baseline gap-2.5">
		<span class="text-surface-600-400 font-mono text-xs" aria-hidden="true">
			{whereSection.number}
		</span>
		<h2 id="{uid}-where" class="text-sm font-semibold">
			{whereSection.heading}
		</h2>
	</div>
	<p class="text-sm leading-relaxed">{whereSentence(capability)}</p>
	{#if shape}
		{#if !usedBy}
			<LoadingState message="Finding pipelines that pick their own…" />
		{:else}
			<p class="text-surface-600-400 text-xs">
				{overridesSentence(overrides.length)}
			</p>
			{#if overrides.length}
				<ul class="flex flex-col gap-1.5 text-sm">
					{#each overrides as p (`${p.label}:${p.configName}`)}
						<li class="flex flex-wrap items-baseline gap-x-2">
							<button
								type="button"
								class="anchor text-left"
								aria-label={pipelineLinkLabel(p)}
								onclick={() => openPipeline(p)}
							>
								{p.label}
							</button>
							<span class="text-surface-600-400 text-xs">
								{p.configName}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</section>

