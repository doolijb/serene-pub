<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * **A job's sheet** — one job, three questions, in the order a person asks
	 * them (plan 2026-10-11, lane B; `jobSheet.ts`):
	 *
	 *   1. **Which model answers** — the job's pair, below. Unchanged from
	 *      the job picker it was (design 2026-10-09 C.1).
	 *   2. **How it writes** / **How it draws** — the job's default sampling
	 *      config, where the job has a sampling vocabulary.
	 *   3. **Where this applies** — every session, and the pipelines that
	 *      pick their own sampling config.
	 *
	 * Sections 2 and 3 are `JobSheetSampling`, mounted only while the sheet
	 * is open; the foot is **Open in Admin** (Admin › Defaults, the same
	 * defaults as an inventory). The rest of this header is section 1's.
	 *
	 * A job is a transform the pub needs a default pair for (NOMENCLATURE §10),
	 * and choosing that pair picks one value for one thing: a control, not a
	 * place (design 2026-10-09 C.1, STYLE-GUIDE §6.5). So it opens over
	 * whatever is on screen — from the status strip's Change / Choose a model,
	 * a job tile or chip, a "Later, optionally" door, the digest's
	 * `connectionsDoor: "chat"` — and closing it leaves everything where it was.
	 *
	 * Top to bottom: what the job's model is used for, the job's state line
	 * with its one fix (Download / Start / Refresh) where one applies, then
	 * every pair on any connection that can do the job — the one in use first,
	 * selected and marked **In use**, every other with **Use** — then what is
	 * hidden or still to download, and **Get a model…** at the foot.
	 *
	 * ## Use is not a write this dialog performs
	 *
	 * `onChoose` is the sidebar's `chooseJobModel`, the one way a model becomes
	 * the one a job uses (C.3): the costed confirmation for an embeddings or
	 * entities switch, and one toast. Nothing here emits `connections:setDefault`.
	 * The fix buttons are the same emits the readiness strip's fixes make.
	 *
	 * The DEFAULTS come from `systemSettingsCtx`, not from
	 * `connectionDefaults:list`: that family is restricted interest (admin-only),
	 * and the shell's copy is the one every other connections surface reads,
	 * kept current by the sidebar as each `connections:setDefault` lands.
	 *
	 * Every sentence, row, count and verb comes out of `jobPicker.ts` and
	 * `readiness.ts`; this file decides none of them.
	 *
	 * ⚠ On a machine whose local ONNX runtime didn't load, both ways to a
	 * download — the fix's Download and the "N more" door — stay on screen,
	 * disabled, with the reason beside them (`connectionTypeDisabledReason`).
	 * So does a local ONNX row's Use, which the server refuses with the same
	 * sentence, and **Get a model…** where local ONNX is the only provider
	 * (`getModelDisabledReason`: named entities).
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel } from "@serene-pub/sdk"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { readinessRow, type EntryFacts } from "./readiness"
	import { CONNECTION_STATE_DOT } from "./connectionRowStatus"
	import {
		candidateRows,
		capabilityEntry,
		CANDIDATE_LIMIT,
		choicesHeading,
		getModelDisabledReason,
		hiddenSentence,
		inUseRow,
		jobLabel,
		nothingCanSentence,
		nothingElseSentence,
		readySentence,
		stateLine,
		toDownloadSentence,
		type CandidateRow,
		type CapabilityConnection,
		type JobPair
	} from "./jobPicker"
	import { connectionTypeIcon } from "./connectionTypeIcon"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import JobSheetSampling from "./JobSheetSampling.svelte"
	import {
		OPEN_IN_ADMIN,
		SHEET_EYEBROW,
		sheetSections,
		sheetTitle
	} from "./jobSheet"
	import {
		connectionTypeDisabledReason,
		localOnnxDisabledReason
	} from "$lib/shared/utils/connectionServiceItems"

	interface Props {
		/** The job the picker is open on (a transform id), or null: closed. */
		job: string | null
		/** The sidebar's list — every connection with every model. */
		connections: readonly CapabilityConnection[]
		onClose: () => void
		/** The sidebar's `chooseJobModel` — see the header. */
		onChoose: (job: string, pair: JobPair) => void
		/** The model finder, scoped to this job. */
		onGetModel: (job: string) => void
	}
	let { job, connections, onClose, onChoose, onGetModel }: Props = $props()

	const socket = useTypedSocket()
	const systemSettingsCtx = getContext<SystemSettingsCtx | undefined>(
		"systemSettingsCtx"
	)

	const capability = $derived(job ?? "text->text")
	const label = $derived.by(() => {
		try {
			return capabilityLabel(capability as any)
		} catch {
			return capability
		}
	})

	const defaults = $derived(systemSettingsCtx?.capabilityDefaults ?? {})
	const entry = $derived(capabilityEntry(connections, defaults, capability))

	/**
	 * What the list rows cannot say about the registered pair.
	 *
	 * Two facts only — the local file's state and the host's last listing —
	 * because they are the two this dialog actually holds. The managed process
	 * and the manager flags are the index's to gather, and an absent fact means
	 * "not answered" rather than "no" (`EntryFacts`), so leaving them out costs
	 * a clause and claims nothing.
	 */
	const facts = $derived<EntryFacts>({
		localState: entry.model?.local?.state,
		syncError: entry.connection?.modelsSync?.error ?? null
	})
	const status = $derived(readinessRow(entry, facts))
	const line = $derived(stateLine(status))
	/**
	 * A fix is offered for a fault that one press undoes — files to fetch, a
	 * process to start, a listing to ask again. Change is the list itself.
	 */
	const fix = $derived(
		status.state === "broken" &&
			status.action &&
			status.action.verb !== "change" &&
			status.action.verb !== "setup"
			? status.action
			: null
	)
	/** This machine's local ONNX verdict; absent reads as available. */
	const localOnnx = $derived(
		systemSettingsCtx?.settings?.localOnnxAvailability
	)
	/**
	 * Why the fix's Download can't run here, or null. Only a local ONNX pair
	 * has files to fetch, and where the runtime didn't load the server refuses
	 * them with this same sentence — so the button is disabled and says so.
	 */
	const fixBlocked = $derived(
		fix?.verb === "download"
			? connectionTypeDisabledReason(entry.connection?.type, localOnnx)
			: null
	)

	const candidates = $derived(
		candidateRows(connections, capability, {
			connectionId: entry.connection?.id,
			modelId: entry.model?.id
		})
	)
	/** The pair in use first, then every other that can do the job. */
	const rows = $derived.by(() => {
		const current = inUseRow(entry)
		return current ? [current, ...candidates.rows] : candidates.rows
	})
	const nothingServes = $derived(rows.length === 0)
	const hidden = $derived(hiddenSentence(candidates.hidden))
	const toDownload = $derived(toDownloadSentence(candidates.toDownload))
	/**
	 * Why those downloads can't happen here, or null. Every model the count
	 * holds is a local ONNX file — no other connection's models carry a
	 * `local` state (`candidateRows`) — so the ONNX verdict is the answer.
	 */
	const toDownloadBlocked = $derived(
		toDownload ? localOnnxDisabledReason(localOnnx) : null
	)
	/** Why a row's Use can't register it here, or null — local ONNX rows only. */
	const useBlocked = (row: { connectionType: string | null }) =>
		connectionTypeDisabledReason(row.connectionType, localOnnx)
	let showAll = $state(false)
	$effect(() => {
		// A different job is a different list.
		void job
		showAll = false
	})
	const shown = $derived(showAll ? rows : rows.slice(0, CANDIDATE_LIMIT))
	/**
	 * The reason, once under the rows, when any shown row's Use is disabled
	 * and the "N more" door below is not already saying it.
	 */
	const rowsBlocked = $derived.by(() => {
		if (toDownloadBlocked) return null
		for (const row of shown) {
			const reason = row.usable && !row.inUse ? useBlocked(row) : null
			if (reason) return reason
		}
		return null
	})
	/** Why the finder door leads nowhere here, or null (`getModelDisabledReason`). */
	const getBlocked = $derived(getModelDisabledReason(capability, localOnnx))

	/**
	 * Whether every row sits on one connection. See the row's second line.
	 *
	 * Computed over every row rather than `shown`, so expanding "Show all N"
	 * cannot make the name appear or vanish halfway down a list.
	 */
	const oneConnection = $derived(
		new Set(rows.map((r) => r.connectionId)).size <= 1
	)

	/**
	 * The one fix a broken job offers.
	 *
	 * ⚠ None of these is a new write: Download and Refresh are the same emits
	 * the model rows already make, and Start is the manager's.
	 */
	function runFix() {
		switch (fix?.verb) {
			case "download":
				if (fixBlocked) return
				if (status.connectionId != null && status.modelId != null)
					socket.emit("connections:downloadModel", {
						id: status.connectionId,
						modelId: status.modelId
					})
				return
			case "start":
				socket.emit("koboldcpp:startSubprocess", {})
				return
			case "refresh":
				if (status.connectionId != null)
					socket.emit("connections:syncModels", {
						id: status.connectionId,
						force: true
					})
				return
		}
	}

	function use(row: CandidateRow) {
		if (!job || row.inUse || !row.usable || useBlocked(row)) return
		onChoose(job, {
			connectionId: row.connectionId,
			model: { id: row.modelId, name: row.modelName }
		})
	}

	const listLabelId = $props.id()
	const modelSection = $derived(sheetSections(capability)[0])
</script>

<Dialog
	open={job != null}
	onOpenChange={(e) => {
		if (!e.open) onClose()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-xl flex-col gap-4 p-6 shadow-xl"
			>
				{#if job}
					<header class="flex shrink-0 items-start gap-2">
						<div class="min-w-0 flex-1 space-y-1">
							<p class="text-surface-600-400 text-xs">
								{SHEET_EYEBROW}
							</p>
							<Dialog.Title
								class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
							>
								{sheetTitle(capability)}
							</Dialog.Title>
							<Dialog.Description
								class="text-surface-600-400 text-sm"
							>
								{readySentence(capability)}
							</Dialog.Description>
						</div>
						<Dialog.CloseTrigger
							class="btn-icon btn-icon-sm hover:preset-tonal shrink-0"
							aria-label="Close"
						>
							<Icons.X size={16} aria-hidden="true" />
						</Dialog.CloseTrigger>
					</header>

					<!-- The sheet's body is the one scroller, and carries no
					     padding (STYLE-GUIDE §5.2): the inset is the wrapper's
					     margin, so a focus ring at the edge is not cut. -->
					<div class="min-h-0 flex-1 overflow-y-auto">
						<div class="m-1 flex flex-col gap-6">
							<section
								class="flex flex-col gap-3"
								aria-labelledby="{listLabelId}-model"
								data-sheet-section="model"
							>
								<div
									class="flex min-w-0 items-baseline gap-2.5"
								>
									<span
										class="text-surface-600-400 font-mono text-xs"
										aria-hidden="true"
									>
										{modelSection.number}
									</span>
									<h2
										id="{listLabelId}-model"
										class="text-sm font-semibold"
									>
										{modelSection.heading}
									</h2>
								</div>
								<!-- The job's state line: the dot and the word are the one
					     scale (`connectionRowStatus`), the sentence what it means. -->
								<div class="flex shrink-0 flex-col gap-1">
									<div
										class="flex min-w-0 items-center gap-2"
										data-job-state={status.state}
									>
										<span
											class="size-2 shrink-0 rounded-full {CONNECTION_STATE_DOT[
												status.state
											]}"
											aria-hidden="true"
										></span>
										<p class="min-w-0 flex-1 text-sm">
											<span class="font-medium">
												{line.word}
											</span>
											<span
												class="text-surface-600-400 text-xs"
											>
												· {line.sentence}
											</span>
										</p>
										{#if fix}
											<button
												type="button"
												class="btn btn-sm preset-tonal-surface shrink-0 text-xs disabled:cursor-not-allowed disabled:opacity-70"
												disabled={!!fixBlocked}
												title={fixBlocked}
												onclick={runFix}
												aria-label={`${fix.label} — ${label}`}
											>
												{fix.label}
											</button>
										{/if}
									</div>
									<!-- In words, not only the button's tooltip: nothing is
						     hover-only (§9), and a disabled button takes no focus. -->
									{#if fixBlocked}
										<p
											class="text-surface-600-400 pl-4 text-xs break-words"
										>
											{fixBlocked}
										</p>
									{/if}
								</div>

								<div
									class="flex flex-col gap-1"
									role="group"
									aria-labelledby={listLabelId}
								>
									<ListGroupLabel
										id={listLabelId}
										label={choicesHeading(
											capability,
											label,
											rows.length
										)}
									/>

									{#if nothingServes}
										<p
											class="text-surface-600-400 px-1 text-xs leading-relaxed"
										>
											{nothingCanSentence(
												capability,
												label
											)}
										</p>
									{:else}
										<!-- One radio per pair; choosing one IS Use. The pair in
							     use is the checked one, selected and marked, with
							     nothing to press. -->
										<div
											class="flex flex-col gap-1"
											role="radiogroup"
											aria-labelledby={listLabelId}
										>
											{#each shown as row (`${row.connectionId}:${row.modelId}`)}
												{@const RowIcon =
													connectionTypeIcon(
														row.connectionType,
														((Icons as any)[
															row.icon
														] as any) ?? Icons.Cable
													)}
												{@const blocked =
													row.usable && !row.inUse
														? useBlocked(row)
														: null}
												{@const offline =
													!row.inUse && !row.usable}
												<button
													type="button"
													role="radio"
													aria-checked={!!row.inUse}
													class="focus-visible:ring-primary-500 flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-base px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none {row.inUse
														? 'sidebar-row-active'
														: blocked || offline
															? 'cursor-not-allowed opacity-70'
															: 'hover:bg-surface-200-800'}"
													disabled={!!blocked ||
														offline}
													title={blocked}
													onclick={() => use(row)}
													aria-label={row.inUse
														? `${row.modelName} on ${row.connectionTitle}, in use for ${jobLabel(capability)}`
														: blocked
															? `Use ${row.modelName} for ${label} — ${blocked}`
															: `Use ${row.modelName} for ${label}`}
												>
													<span
														class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
														aria-hidden="true"
													>
														<RowIcon size={16} />
													</span>
													<span
														class="min-w-0 flex-1"
													>
														<span
															class="block truncate text-lead font-medium"
														>
															{row.modelName}
														</span>
														<!--
												⚠ The connection's name is dropped when every
												row is on the SAME connection, which is the
												common case: eight Claude models each prefixed
												"Anthropic (Claude)" is one word printed down a
												column, and it pushes the facts a person is
												choosing on off the right edge. Where the list
												spans two connections it is back, because then
												it is the thing that distinguishes them.
											-->
														<span
															class="text-surface-600-400 block truncate text-xs"
														>
															{oneConnection
																? row.fact
																: `${row.connectionTitle} · ${row.fact}`}
														</span>
													</span>
													{#if row.inUse}
														<Badge tone="primary" size="sm" class="inline-flex shrink-0 items-center gap-1 font-medium">
															<Icons.Star
																size={9}
																aria-hidden="true"
															/>
															In use
														</Badge>
													{:else if row.usable}
														<!-- The radio is the control; this is its
											     word, drawn as the action it is. -->
														<span
															class="btn btn-sm preset-tonal-surface pointer-events-none shrink-0 text-xs"
															aria-hidden="true"
														>
															Use
														</span>
													{/if}
												</button>
											{/each}
										</div>

										{#if rows.length === 1 && rows[0].inUse}
											<p
												class="text-surface-600-400 px-1 text-xs leading-relaxed"
											>
												{nothingElseSentence(
													capability,
													label
												)}
											</p>
										{/if}

										{#if rows.length > CANDIDATE_LIMIT}
											<button
												type="button"
												class="hover:preset-tonal-primary text-surface-600-400 flex min-h-9 items-center gap-2 rounded-base px-1.5 text-left text-xs"
												aria-expanded={showAll}
												onclick={() =>
													(showAll = !showAll)}
											>
												{#if showAll}
													<Icons.ChevronDown
														size={14}
														aria-hidden="true"
													/>
													Show fewer
												{:else}
													<Icons.ChevronRight
														size={14}
														aria-hidden="true"
													/>
													Show all {rows.length}
												{/if}
											</button>
										{/if}
									{/if}

									{#if rowsBlocked}
										<!-- In words, not only the rows' tooltips: a disabled
							     button takes no focus (§9). Once, for every row it
							     holds for. -->
										<p
											class="text-surface-600-400 px-1.5 text-xs break-words"
										>
											{rowsBlocked}
										</p>
									{/if}
									{#if hidden}
										<p
											class="text-surface-600-400 px-1.5 text-xs"
										>
											{hidden}
										</p>
									{/if}
									{#if toDownload}
										<button
											type="button"
											class="text-surface-600-400 flex min-h-9 items-center gap-2 rounded-base px-1.5 text-left text-xs {toDownloadBlocked
												? 'cursor-not-allowed opacity-70'
												: 'hover:preset-tonal-primary'}"
											disabled={!!toDownloadBlocked}
											title={toDownloadBlocked}
											onclick={() =>
												onGetModel(capability)}
										>
											<Icons.Download
												size={14}
												aria-hidden="true"
											/>
											{toDownload}
										</button>
										{#if toDownloadBlocked}
											<p
												class="text-surface-600-400 px-1.5 text-xs break-words"
											>
												{toDownloadBlocked}
											</p>
										{/if}
									{/if}
								</div>

								<div class="flex flex-col gap-1.5">
									<!-- The reason in place of a door that goes nowhere. -->
									{#if getBlocked}
										<p
											class="text-surface-600-400 text-xs break-words"
										>
											{getBlocked}
										</p>
									{/if}
									<div class="flex justify-end">
										<!-- Filled only when nothing here can do the job: then
							     getting a model is the one way forward (§6.1). -->
										<button
											type="button"
											class="btn disabled:cursor-not-allowed {nothingServes
												? 'preset-filled-primary-500'
												: 'preset-tonal-surface'}"
											disabled={!!getBlocked}
											title={getBlocked}
											onclick={() =>
												onGetModel(capability)}
										>
											<Icons.Download
												size={16}
												aria-hidden="true"
											/>
											Get a model…
										</button>
									</div>
								</div>
							</section>

							<JobSheetSampling {capability} onLeave={onClose} />
						</div>
					</div>

					<footer
						class="border-surface-200-800 flex shrink-0 items-center gap-2 border-t pt-3"
					>
						<!-- Admin › Defaults: the same defaults, as an inventory.
						     A plain link: the shell's view-link handler opens the
						     Admin view in place, and the sheet steps aside. -->
						<a
							href={OPEN_IN_ADMIN.href}
							class="anchor inline-flex items-center gap-1.5 text-sm"
							onclick={onClose}
						>
							<Icons.Settings2 size={14} aria-hidden="true" />
							{OPEN_IN_ADMIN.label}
						</a>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
