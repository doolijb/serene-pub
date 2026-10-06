<script lang="ts">
	/**
	 * ONE capability, and the three questions a person has about it.
	 *
	 * What answers when this is asked for, what else here could, and how to get
	 * something that can — in that order, because the first is the one they came
	 * to check and the third is only interesting once the first two disappoint.
	 * It is the destination of every readiness row (the index's status strip
	 * and jobs grid, `jobTile.ts`) and of the `Change` fix on one.
	 *
	 * ## It fetches its own list, and takes its defaults from the shell
	 *
	 * `connections:list` carries every endpoint with every model, which is
	 * everything both sections need, so this view declares that interest itself
	 * rather than growing a prop for a list its parent happens to hold.
	 *
	 * ⚠ The DEFAULTS come from `systemSettingsCtx`, not from
	 * `connectionDefaults:list`. That family is restricted interest (admin-only,
	 * `RESTRICTED_INTEREST_PREFIXES`), so a non-admin reading this panel would be
	 * refused it — and the shell's copy is the one every other connections
	 * surface reads, kept current by the sidebar as each `connections:setDefault`
	 * lands. A second answer here could only disagree with the one on screen.
	 *
	 * ## Use is not a write this view performs
	 *
	 * `onSelectDefault` is the same registration as a model view's
	 * **Set as default…**, raised to the sidebar so that switching the embedding
	 * or entity model still opens its costed confirmation ("N stored vectors are
	 * re-embedded"). Nothing here emits `connectionDefaults:set`.
	 *
	 * Every sentence, row, count and verb comes out of `capabilityView.ts` and
	 * `readiness.ts`; this file decides none of them.
	 *
	 * ⚠ On a machine whose local ONNX runtime didn't load, both ways to a
	 * download — the fix's Download and the "N more" door — stay on screen,
	 * disabled, with the reason beside them (`connectionTypeDisabledReason`).
	 * So does a local ONNX row's Use, which the server refuses with the same
	 * sentence, and the finder door where local ONNX is the only provider
	 * (`getModelDisabledReason`: named entities).
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel } from "@serene-pub/sdk"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { readinessRow, type EntryFacts } from "./readiness"
	import {
		alsoAbleHeading,
		candidateRows,
		toDownloadSentence,
		capabilityEntry,
		capabilityStateWord,
		CANDIDATE_LIMIT,
		defaultChipLabel,
		finderNote,
		getModelButtonLabel,
		getModelDisabledReason,
		hiddenSentence,
		modelFact,
		nothingCanSentence,
		nothingElseSentence,
		serviceLabel,
		statusSentence
	} from "./capabilityView"
	import type { PairDefaultSelection } from "./modelSystemDefaults"
	import { connectionTypeIcon } from "./connectionTypeIcon"
	import {
		connectionTypeDisabledReason,
		localOnnxDisabledReason
	} from "$lib/shared/utils/connectionServiceItems"

	interface Props {
		/** A transform id, e.g. `text->text`. */
		capability: string
		onBack: () => void
		onOpenModel: (connectionId: number, modelId: number) => void
		onGetModel: (capability: string) => void
		/**
		 * Register this pair as the capability's default. The sidebar owns the
		 * emit and the costed confirmation — see the header.
		 */
		onSelectDefault: (
			connectionId: number,
			model: { id: number; name: string },
			selection: PairDefaultSelection
		) => void
	}
	let {
		capability,
		onBack,
		onOpenModel,
		onGetModel,
		onSelectDefault
	}: Props = $props()

	const socket = useTypedSocket()
	const systemSettingsCtx = getContext<SystemSettingsCtx | undefined>(
		"systemSettingsCtx"
	)

	/** List rows always carry ids; the guard is for the type. */
	type Row = Sockets.Connections.List.Row & { id: number }
	let connectionsList = $state<Row[]>([])

	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connectionsList = (msg.connectionsList ?? []).filter(
			(c): c is Row => c.id != null
		)
	}
	// Declared at initialisation, above the mount emit below: a request flushes
	// the pending interest sync, so a declaration made after it would miss the
	// flush its own first reply rides on. `connections:list` is re-sent by the
	// server after a sync or a write, so this one key keeps the view current.
	useInterest<"connections:list">("connections:list", handleConnectionsList)

	onMount(() => {
		socket.emit("connections:list", {})
	})

	const label = $derived.by(() => {
		try {
			return capabilityLabel(capability as any)
		} catch {
			return capability
		}
	})

	const defaults = $derived(systemSettingsCtx?.capabilityDefaults ?? {})
	const entry = $derived(
		capabilityEntry(connectionsList, defaults, capability)
	)

	/**
	 * What the list rows cannot say about the registered pair.
	 *
	 * Two facts only — the local file's state and the host's last listing —
	 * because they are the two this view actually holds. The managed process
	 * and the manager flags are the index's to gather, and an absent fact means
	 * "not answered" rather than "no" (`EntryFacts`), so leaving them out costs
	 * a clause and claims nothing.
	 */
	const facts = $derived<EntryFacts>({
		localState: entry.model?.local?.state,
		syncError: entry.connection?.modelsSync?.error ?? null
	})
	const status = $derived(readinessRow(entry, facts))
	const stateWord = $derived(capabilityStateWord(status.state))
	const sentence = $derived(statusSentence(status))
	/** A fix is offered for a fault, never for a blank: `Set up` is the list below. */
	const fix = $derived(status.state === "warning" ? status.action : null)
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

	const pairFact = $derived(entry.model ? modelFact(entry.model) : null)
	const chip = $derived(defaultChipLabel(capability))

	const candidates = $derived(
		candidateRows(connectionsList, capability, {
			connectionId: entry.connection?.id,
			modelId: entry.model?.id
		})
	)
	const nothingServes = $derived(!entry.set && candidates.rows.length === 0)
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
	/**
	 * The reason, once under the rows, when any shown row's Use is disabled
	 * and the "N more" door below is not already saying it.
	 */
	const rowsBlocked = $derived.by(() => {
		if (toDownloadBlocked) return null
		for (const row of shown) {
			const reason = row.usable ? useBlocked(row) : null
			if (reason) return reason
		}
		return null
	})
	/** Why the finder door leads nowhere here, or null (`getModelDisabledReason`). */
	const getBlocked = $derived(getModelDisabledReason(capability, localOnnx))
	let showAll = $state(false)

	/**
	 * Whether every candidate sits on one connection. See the row's second line.
	 *
	 * Computed over `candidates.rows` rather than `shown`, so expanding "Show
	 * all N" cannot make the name appear or vanish halfway down a list.
	 */
	const oneConnection = $derived(
		new Set(candidates.rows.map((r) => r.connectionId)).size <= 1
	)
	const shown = $derived(
		showAll ? candidates.rows : candidates.rows.slice(0, CANDIDATE_LIMIT)
	)

	/** The tile's tone follows the state — one signal, said twice, never thrice. */
	const TILE: Record<string, string> = {
		ok: "preset-tonal-success",
		pending: "preset-tonal-warning",
		warning: "preset-tonal-warning",
		unset: "preset-tonal-surface"
	}
	const StatusIcon = $derived(
		((Icons as any)[status.icon] as any) ?? Icons.Boxes
	)
	const PairIcon = $derived(connectionTypeIcon(entry.connection?.type))

	let alsoSection = $state<HTMLElement | null>(null)

	/**
	 * The `Change` fix: the pair is changed from the list below, so the fix is
	 * to put that list in front of the person rather than to open anything.
	 */
	function scrollToList() {
		const reduced =
			typeof matchMedia === "function" &&
			matchMedia("(prefers-reduced-motion: reduce)").matches
		alsoSection?.scrollIntoView({
			behavior: reduced ? "auto" : "smooth",
			block: "start"
		})
	}

	/**
	 * The one fix a warning offers.
	 *
	 * ⚠ None of these is a new write: Download and Refresh are the same emits
	 * the model rows already make, Start is the manager's, and everything else
	 * is the list below.
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
			default:
				scrollToList()
		}
	}

	function use(row: {
		connectionId: number
		modelId: number
		modelName: string
	}) {
		onSelectDefault(
			row.connectionId,
			{ id: row.modelId, name: row.modelName },
			{ kind: "one", capability }
		)
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<PanelNavHeader title={label} {onBack} backLabel="Back to connections" />

	<!-- One column at every width; the cap keeps the 12px sentences at a
	     readable measure when this view is full page (§3.4). -->
	<div
		class="mt-3 flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto pb-2 @lg/view:max-w-[640px]"
	>
		<section
			class="panel-card flex flex-col gap-3"
			aria-label="{label} status"
		>
			<div class="flex items-start gap-2.5">
				<span
					class="grid size-10 shrink-0 place-items-center rounded-[10px] {TILE[
						status.state
					]}"
					aria-hidden="true"
				>
					<StatusIcon size={18} />
				</span>
				<div class="min-w-0 flex-1">
					<!-- The tile's tone is the signal; the word names it. No
					     third dot — one signal, said twice, never thrice. -->
					<p class="text-sm font-medium">{stateWord}</p>
					<p class="text-surface-600-400 text-xs leading-relaxed">
						{sentence}
					</p>
					<!-- In words, not only the button's tooltip: nothing is
					     hover-only (§9), and a disabled button takes no focus. -->
					{#if fixBlocked}
						<p class="text-surface-600-400 mt-1 text-xs break-words">
							{fixBlocked}
						</p>
					{/if}
				</div>
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

			<div
				class="flex items-baseline gap-2 pt-3"
			>
				<span class="text-surface-600-400 min-w-0 flex-1 text-xs">
					{chip}
				</span>
				<a class="anchor shrink-0 text-xs" href="/admin/defaults">
					Admin → Defaults
				</a>
			</div>

			{#if entry.set && entry.connection && entry.model}
				{@const connection = entry.connection}
				{@const model = entry.model}
				<button
					type="button"
					class="hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
					onclick={() => onOpenModel(connection.id, model.id)}
					aria-label={`Open ${model.name}, the ${chip.toLowerCase()} for ${label}`}
				>
					<!-- Neutral: the card above already carries the state, in
					     its tile and in its word. -->
					<span
						class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
						aria-hidden="true"
					>
						<PairIcon size={16} />
					</span>
					<span class="min-w-0 flex-1">
						<span class="flex min-w-0 items-center gap-1.5">
							<span
								class="min-w-0 truncate text-[15px] font-medium"
							>
								{model.name}
							</span>
							<!-- Lamp gold means "this is what a run reaches
							     for". Tonal rather than filled: filled primary
							     is a button and never a badge (§2.4). -->
							<span
								class="preset-tonal-primary inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
							>
								<Icons.Star size={9} aria-hidden="true" />
								{chip}
							</span>
						</span>
						<!--
							⚠ The service is printed only where it is not
							already the name. The shipped card read "Anthropic
							(Claude) · Anthropic (Claude) · listed" — a
							connection's default name IS its service label, so
							every default-named connection said itself twice and
							then truncated. Same amendment as `ConnectionRow`
							(NOMENCLATURE §10, service chip, 2026-09-23).
						-->
						<span
							class="text-surface-600-400 block min-w-0 truncate text-xs"
						>
							{[
								connection.name ?? "Untitled connection",
								serviceLabel(connection),
								pairFact
							]
								.filter(
									(part, i, all) =>
										!!part &&
										all
											.slice(0, i)
											.every(
												(earlier) =>
													earlier
														?.trim()
														.toLowerCase() !==
													part.trim().toLowerCase()
											)
								)
								.join(" · ")}
						</span>
					</span>
					<Icons.ChevronRight
						size={16}
						class="text-surface-500 shrink-0"
						aria-hidden="true"
					/>
				</button>
			{:else}
				<div
					class="border-surface-300-700 text-surface-600-400 flex min-h-11 items-center rounded-[10px] border border-dashed px-2.5 text-xs"
				>
					Not set · pick one below
				</div>
			{/if}
		</section>

		<section
			bind:this={alsoSection}
			class="panel-card flex flex-col gap-1"
			aria-label={alsoAbleHeading(
				capability,
				label,
				candidates.rows.length
			)}
		>
			<p class="text-surface-600-400 mb-1 text-xs">
				{alsoAbleHeading(capability, label, candidates.rows.length)}
			</p>

			{#if nothingServes}
				<p class="text-surface-600-400 text-xs leading-relaxed">
					{nothingCanSentence(capability, label)}
				</p>
			{:else if !candidates.rows.length}
				<p class="text-surface-600-400 text-xs leading-relaxed">
					{nothingElseSentence(capability, label)}
				</p>
			{:else}
				{#each shown as row (`${row.connectionId}:${row.modelId}`)}
					{@const RowIcon = connectionTypeIcon(
						row.connectionType,
						((Icons as any)[row.icon] as any) ?? Icons.Cable
					)}
					<!-- The row opens the model; Use is a sibling button beside
					     it, never nested (R7). -->
					<div class="flex min-h-11 items-center gap-2">
						<button
							type="button"
							class="hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
							onclick={() =>
								onOpenModel(row.connectionId, row.modelId)}
							aria-label={`Open ${row.modelName} on ${row.connectionTitle}`}
						>
							<span
								class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
								aria-hidden="true"
							>
								<RowIcon size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span
									class="block truncate text-[15px] font-medium"
								>
									{row.modelName}
								</span>
								<!--
									⚠ The connection's name is dropped when every
									candidate is on the SAME connection, which is
									the common case: eight Claude models each
									prefixed "Anthropic (Claude)" is one word
									printed down a column, and it was pushing the
									facts a person is choosing on off the right
									edge ("200k context · $1…"). Where the list
									spans two connections it is back, because
									then it is the thing that distinguishes them.
								-->
								<span
									class="text-surface-600-400 block truncate text-xs"
								>
									{oneConnection
										? row.fact
										: `${row.connectionTitle} · ${row.fact}`}
								</span>
							</span>
						</button>
						{#if row.usable}
							{@const blocked = useBlocked(row)}
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface shrink-0 text-xs disabled:cursor-not-allowed disabled:opacity-70"
								disabled={!!blocked}
								title={blocked}
								onclick={() => use(row)}
								aria-label={blocked
									? `Use ${row.modelName} for ${label} — ${blocked}`
									: `Use ${row.modelName} for ${label}`}
							>
								Use
							</button>
						{/if}
					</div>
				{/each}

				{#if candidates.rows.length > CANDIDATE_LIMIT}
					<button
						type="button"
						class="hover:preset-tonal-primary text-surface-600-400 flex min-h-9 items-center gap-2 rounded-[10px] px-1.5 text-left text-xs"
						aria-expanded={showAll}
						onclick={() => (showAll = !showAll)}
					>
						{#if showAll}
							<Icons.ChevronDown size={14} aria-hidden="true" />
							Show fewer
						{:else}
							<Icons.ChevronRight size={14} aria-hidden="true" />
							Show all {candidates.rows.length}
						{/if}
					</button>
				{/if}
			{/if}

			{#if rowsBlocked}
				<!-- In words, not only the buttons' tooltips: a disabled button
				     takes no focus (§9). Once, for every row it holds for. -->
				<p class="text-surface-600-400 px-1.5 text-xs break-words">
					{rowsBlocked}
				</p>
			{/if}
			{#if hidden}
				<p class="text-surface-600-400 px-1.5 text-xs">{hidden}</p>
			{/if}
			{#if toDownload}
				<button
					type="button"
					class="text-surface-600-400 flex min-h-9 items-center gap-2 rounded-[10px] px-1.5 text-left text-xs {toDownloadBlocked
						? 'cursor-not-allowed opacity-70'
						: 'hover:preset-tonal-primary'}"
					disabled={!!toDownloadBlocked}
					title={toDownloadBlocked}
					onclick={() => onGetModel(capability)}
				>
					<Icons.Download size={14} aria-hidden="true" />
					{toDownload}
				</button>
				{#if toDownloadBlocked}
					<p class="text-surface-600-400 px-1.5 text-xs break-words">
						{toDownloadBlocked}
					</p>
				{/if}
			{/if}
		</section>

		<div class="flex flex-col gap-1.5 pt-3">
			<button
				type="button"
				class="btn w-full disabled:cursor-not-allowed {nothingServes
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				disabled={!!getBlocked}
				title={getBlocked}
				onclick={() => onGetModel(capability)}
			>
				<Icons.Download size={16} aria-hidden="true" />
				{getModelButtonLabel(label, nothingServes)}
			</button>
			<!-- The reason in place of where the door goes: it goes nowhere. -->
			<p class="text-surface-600-400 px-0.5 text-xs break-words">
				{getBlocked ?? finderNote(label, capability)}
			</p>
		</div>
	</div>
</div>
