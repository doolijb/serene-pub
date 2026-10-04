<script lang="ts">
	import { docsHref } from "$lib/shared/utils/docsHref"
	/**
	 * Admin → Defaults: which connection and sampling config this instance uses
	 * for each capability.
	 *
	 * This screen is the DEFINITION of "does this instance have this capability".
	 * Nothing is chosen because it exists, because it is the only one, or because
	 * it happens to be capable — the chain is
	 * `capability default → pipeline config → session override`, and a run whose
	 * capability has no default registered here fails with a sentence pointing
	 * back at this page. That is why it gets its own address rather than a table
	 * on Connections: the subject is the CAPABILITY, and Connections is a list of
	 * endpoints that happens to mention them.
	 *
	 * ## The shape of the page, and why
	 *
	 * Cards grouped by OUTPUT KIND, one row per job, with the sampling picker on
	 * the GROUP HEADER and the connection picker on each row. The three image transforms
	 * (`text->image`, `text+image->image`, `image->image`) share one
	 * steps/CFG/sampler vocabulary, so a per-card sampling control would ask the
	 * same question three times and let the answers drift — while a single
	 * control labelled "the image default" that wrote one of three rows would be
	 * a lie on screen. The header control writes the whole group; each job's
	 * row also shows its own picker for the one admin who genuinely wants
	 * img2img on different settings, and says so when it differs.
	 *
	 * Connections stay per card because they genuinely differ: one backend draws
	 * and another writes.
	 *
	 * ## Empty states are evaluated INSTANCE-FIRST
	 *
	 * Three of them, and the order of the questions is the whole trick:
	 *
	 *   1. eligible connections exist, none registered → "Not set", pick one.
	 *   2. connections exist, none eligible → the picker is STILL rendered, full
	 *      of disabled rows carrying their own reasons. A connection merely
	 *      absent from a list makes "why isn't mine there" unanswerable on the
	 *      screen that raised it.
	 *   3. nothing on the instance qualifies AND no adapter in this build can
	 *      express it → say that instead. `text->audio` is here today.
	 *
	 * ⚠ Instance FIRST. `servable` is wording, never a gate: `openai-embeddings`
	 * and `local-onnx` carry `text->embedding` with no manifest entry at all, so
	 * asking the build first would tell an admin who HAS an embeddings connection
	 * that this build cannot do embeddings.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel, capabilityTagline } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import Select, {
		type SelectOption
	} from "$lib/client/components/inputs/Select.svelte"
	import { notePreview } from "$lib/shared/utils/connectionNotes"
	import { outputKindOf } from "$lib/shared/capabilities/samplingShape"
	import {
		OUTPUT_KIND_ICONS,
		outputKindLabel
	} from "$lib/shared/constants/outputKinds"
	import type { ComboRow } from "$lib/shared/capabilities/combos"
	import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
	import { NER_CAPABILITY } from "$lib/shared/constants/ner"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import EmbeddingSwitchDialog from "$lib/client/components/connections/EmbeddingSwitchDialog.svelte"
	import EntitySwitchDialog from "$lib/client/components/connections/EntitySwitchDialog.svelte"
	import {
		useStarConfirm,
		type StarMove
	} from "$lib/client/components/connections/useStarConfirm.svelte"

	const socket = useTypedSocket()
	const interest = getAdminInterestContext()
	const userCtx: UserCtx = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	/**
	 * The two jobs whose star has a CONSEQUENCE: moving the embedding model
	 * rebuilds the vector index, moving the entity model re-annotates. Those
	 * consequences live in `connections:setDefault` (the star the Connections
	 * view presses), so these two rows write through it rather than through
	 * `connectionDefaults:set`, which stores the pair and nothing more — and
	 * they ask first, with the Connections view's own confirmation
	 * (`useStarConfirm`): the price of re-embedding, the count to re-scan.
	 */
	const STAR_WITH_CONSEQUENCE = new Set<string>([
		EMBEDDING_CAPABILITY,
		NER_CAPABILITY
	])

	/**
	 * What the old Settings → Embeddings card said, now on the job it is
	 * about (moved 2026-09-27): what the job powers and what "off" means.
	 */
	const JOB_NOTES: Record<string, string> = {
		[EMBEDDING_CAPABILITY]:
			"Powers retrieval by meaning for lorebook entries, history included. With none set, retrieval falls back to keyword search. Switching models rebuilds the index.",
		[NER_CAPABILITY]:
			"Finds the people and places in passages. Switching models re-scans them."
	}

	type ConnectionOption = Sockets.ConnectionDefaults.List.ConnectionOption
	type SamplingOption = Sockets.ConnectionDefaults.List.SamplingOption

	let combos = $state<ComboRow[]>([])
	let defaults = $state<Record<string, Sockets.CapabilityDefault>>({})
	let connectionOptions = $state<Record<string, ConnectionOption[]>>({})
	let samplingOptions = $state<Record<string, SamplingOption[]>>({})
	let loading = $state(true)

	/**
	 * The cards, already grouped.
	 *
	 * The server sent them in output-kind order (see `combos.ts`), so this walks
	 * once and never sorts: the order on screen is the order one function
	 * decided, rather than something this page re-derives and can disagree
	 * about.
	 */
	let groups = $derived.by(() => {
		const out: Array<{ kind: string; label: string; rows: ComboRow[] }> = []
		for (const combo of combos) {
			const kind = outputKindOf(combo.id) ?? "other"
			let group = out.find((g) => g.kind === kind)
			if (!group) {
				group = {
					kind,
					label: outputKindLabel(kind),
					rows: []
				}
				out.push(group)
			}
			group.rows.push(combo)
		}
		return out
	})

	/**
	 * The ones a run will actually refuse over.
	 *
	 * Keyed on `requires`, never on `optional` (D2): a capability nothing
	 * requires is not missing, and warning that it is unset would put a
	 * permanent complaint on this screen about something no run will ever need.
	 */
	let missingRequired = $derived(
		combos.filter((c) => c.demanded && defaults[c.id]?.connectionId == null)
	)

	/**
	 * The first job a run needs that NO connection here can do. It alone gets
	 * the filled "Add a connection" — one primary per surface — and every
	 * other blocked job says the same thing quietly.
	 */
	let firstBlockedNeeded = $derived(
		combos.find(
			(c) =>
				c.demanded &&
				defaults[c.id]?.connectionId == null &&
				!hasEligible(c.id)
		)?.id ?? null
	)

	/**
	 * A job's state as a dot plus words (STYLE-GUIDE §6.11). "Needed" is the
	 * one a run refuses over; a registered pair whose model left its host is
	 * broken too, and a legacy endpoint-only registration has something to
	 * act on.
	 */
	function jobStatus(combo: ComboRow): { dot: string; label: string } {
		const d = defaults[combo.id]
		if (d?.connectionId == null)
			return combo.demanded
				? { dot: "bg-error-500", label: "Needed" }
				: { dot: "bg-surface-500", label: "Not set" }
		const models =
			(connectionOptions[combo.id] ?? []).find(
				(o) => o.id === d.connectionId
			)?.models ?? []
		if (d.connectionModelId == null && models.length)
			return { dot: "bg-primary-500", label: "Pick a model" }
		if (models.find((m) => m.id === d.connectionModelId)?.missingSince)
			return { dot: "bg-error-500", label: "Model gone" }
		return { dot: "bg-success-500", label: "Set" }
	}

	/** The node definitions that ask for this job, by id, deduplicated. */
	const askedBy = (combo: ComboRow): string[] => [
		...new Set(
			[...combo.requiredBy, ...combo.optionalFor].map(
				(s) => s.definitionId
			)
		)
	]

	/** Opens the Connections view on the embeddings section (the old card's button). */
	function openEmbeddingConnections() {
		panelsCtx.digest.connectionsModality = "embeddings"
		panelsCtx.openPanel({ key: "connections" })
	}

	/** Does any connection on this instance qualify for this capability? */
	const hasEligible = (id: string): boolean =>
		(connectionOptions[id] ?? []).some((o) => o.eligible)

	/**
	 * The sampling config the whole group is on, `"mixed"` when its cards
	 * disagree, or `""` for none.
	 *
	 * `"mixed"` is rendered as a real option rather than as a blank, because a
	 * blank select over three rows that hold two different values reads as
	 * "unset" and the next save silently flattens the difference.
	 */
	const groupSampling = (rows: ComboRow[]): string => {
		const withPickers = rows.filter(
			(r) => (samplingOptions[r.id] ?? []).length > 0
		)
		if (!withPickers.length) return ""
		const values = new Set(
			withPickers.map((r) =>
				String(defaults[r.id]?.samplingConfigId ?? "")
			)
		)
		return values.size === 1 ? [...values][0] : "mixed"
	}

	/** The options any card in this group offers — they share a vocabulary. */
	const groupSamplingOptions = (rows: ComboRow[]): SamplingOption[] =>
		samplingOptions[
			rows.find((r) => samplingOptions[r.id]?.length)?.id ?? ""
		] ?? []

	/**
	 * `""` is a listed choice and never a placeholder — "the backend uses its
	 * own" is a real answer here, and the card says so out loud. So these lists
	 * carry it as a row rather than leaving the picker clearable, which would
	 * offer the same outcome with none of the wording.
	 */
	const samplingItems = (rows: SamplingOption[]): SelectOption[] => [
		{ value: "", label: "Backend's own defaults" },
		...rows.map((o) => ({ value: String(o.id), label: o.name }))
	]

	/**
	 * The group control's rows, with `"mixed"` among them only while the cards
	 * disagree — same reason the old markup only emitted that `<option>` then.
	 * It is a label for a state, not a choice: `setGroupSampling` refuses it.
	 */
	const groupSamplingItems = (rows: ComboRow[]): SelectOption[] => [
		...(groupSampling(rows) === "mixed"
			? [{ value: "mixed", label: "Mixed" }]
			: []),
		...samplingItems(groupSamplingOptions(rows))
	]

	function setHalf(
		capability: string,
		half: "connection" | "sampling",
		raw: string,
		modelRaw?: string
	) {
		const id = raw === "" ? null : Number(raw)
		if (id !== null && Number.isNaN(id)) return
		// The MODEL rides with the connection, never on its own — and both
		// halves are required, because connections have no default model.
		// Changing the endpoint pins its first switched-on model at once;
		// carrying the previous endpoint's model across would register a pair
		// whose two halves name different connections, which no picker can
		// display and no run can resolve. The select below is keyed on the
		// connection for the same reason: a different endpoint is a different
		// list.
		const modelId =
			half === "connection" && modelRaw ? Number(modelRaw) : null
		if (half === "connection" && STAR_WITH_CONSEQUENCE.has(capability)) {
			stars.stage([
				{
					capability,
					connectionId: id,
					modelId:
						id !== null &&
						modelId !== null &&
						!Number.isNaN(modelId)
							? modelId
							: null
				}
			])
			return
		}
		socket.emit("connectionDefaults:set", {
			capability,
			half,
			id,
			...(half === "connection"
				? {
						modelId:
							modelId !== null && !Number.isNaN(modelId)
								? modelId
								: null
					}
				: {})
		})
	}

	/**
	 * Bumped when a staged star move ends without a write — "Keep", or a price
	 * that could not be had. A picker shows what was chosen the moment it is
	 * chosen, so the row's pickers are rebuilt from the defaults that stand.
	 */
	let pickerEpoch = $state(0)
	/** A starred or staged pair, by name, off this page's own lists. */
	function modelOf(connectionId: number, modelId: number | null) {
		for (const rows of Object.values(connectionOptions)) {
			const model = rows
				.find((o) => o.id === connectionId)
				?.models?.find((m) => m.id === modelId)
			// Whether its files are this install's own is not on this list,
			// so the dialog leaves out the line that would say so.
			if (model) return { name: model.name, isLocal: false }
		}
		return null
	}
	const stars = useStarConfirm({
		getDefaults: () => defaults,
		modelOf,
		commit: (moves: StarMove[]) => {
			for (const move of moves)
				socket.emit("connections:setDefault", {
					capability: move.capability,
					id: move.connectionId,
					modelId: move.modelId
				})
		},
		dropped: () => pickerEpoch++
	})

	function setGroupSampling(rows: ComboRow[], raw: string) {
		// "mixed" is a label, not a value — selecting it would mean "make them
		// disagree", which is not a thing anyone can ask for.
		if (raw === "mixed") return
		for (const row of rows)
			if ((samplingOptions[row.id] ?? []).length)
				setHalf(row.id, "sampling", raw)
	}

	function handleList(res: Sockets.ConnectionDefaults.List.Response) {
		combos = res.combos
		defaults = res.defaults
		connectionOptions = res.connectionOptions
		samplingOptions = res.samplingOptions
		loading = false
	}
	function handleSet(res: Sockets.ConnectionDefaults.Set.Response) {
		// The whole map comes back, so one card's write cannot leave another
		// card's copy behind — which is exactly what a per-capability response
		// would do to the group control above.
		defaults = res.defaults
	}

	/**
	 * Both keys BARE and STANDING. `connectionDefaults:set` answers every write
	 * this page makes — including the group header's, which writes one row per
	 * card — and `connectionDefaults:list` is re-sent whenever a connection or
	 * sampling config changes underneath it, so neither may end with a request.
	 *
	 * Declared ABOVE the request: the sync naming `connectionDefaults:list`
	 * leaves before it, so the handler answering it already sees the key.
	 */
	interest.useInterest<"connectionDefaults:set">(
		"connectionDefaults:set",
		handleSet
	)
	$effect(() =>
		interest.requestWithInterest("connectionDefaults:list", {}, handleList)
	)
</script>

<!-- A settings-form page (STYLE-GUIDE §6.11), wider than 820px because each
     job is ONE row at desk width: name · status · connection · model ·
     sampling. Below 900px of pane the row stacks. -->
<div class="mx-auto w-full max-w-[1120px]">
	<AdminPageHeader
		title="Defaults"
		doc={docsHref("system-settings", "system-wide-defaults")}
		purpose="Which connection and model does each job. Nothing is picked for you: a job with no default is off."
	>
		{#if userCtx.user?.isAdmin && !loading && combos.length}
			<!-- The summary strip: one status line. Deliberately no
			     fraction and no bar (docs/connections.md): most jobs are
			     optional and off is a fine answer, so nothing here is scored
			     out of the total. Only a job a pipeline needs is counted. The
			     whole matrix arrives in one response, so this is true on
			     first paint. -->
			<span class="flex items-center gap-2 text-sm">
				<span
					class="{missingRequired.length
						? 'bg-error-500'
						: 'bg-success-500'} size-2 shrink-0 rounded-full"
					aria-hidden="true"
				></span>
				{#if missingRequired.length}
					{missingRequired.length} needed by a pipeline and not set
				{:else}
					Everything a pipeline needs is set
				{/if}
			</span>
		{/if}
	</AdminPageHeader>

	{#if !userCtx.user?.isAdmin}
		<p class="text-surface-600-400 text-sm">Admin access required.</p>
	{:else if loading}
		<div class="flex items-center justify-center py-10">
			<Icons.Loader2
				size={20}
				class="text-surface-600-400 animate-spin"
			/>
		</div>
	{:else}
		{#each groups as group (group.kind)}
			{@const GroupIcon =
				(Icons as any)[OUTPUT_KIND_ICONS[group.kind]] ?? Icons.Boxes}
			{@const samplingChoices = groupSamplingOptions(group.rows)}
			{@const groupValue = groupSampling(group.rows)}
			<section
				class="panel-card mb-4 flex flex-col p-0"
				aria-labelledby="defaults-group-{group.kind}"
			>
				<header
					class="border-surface-200-800 flex flex-wrap items-center gap-3 border-b px-4 py-3"
				>
					<h2
						id="defaults-group-{group.kind}"
						class="flex items-center gap-2 text-base font-semibold"
					>
						<GroupIcon size={16} aria-hidden="true" />
						{group.label}
					</h2>
					<div class="flex-1"></div>
					{#if samplingChoices.length && group.rows.length > 1}
						<!-- One control for the group: these capabilities share a
						     sampling vocabulary, so it writes every row at once.
						     Each row still shows (and can override) its own. -->
						<div
							class="text-surface-600-400 flex w-full items-center gap-2 text-xs @min-[640px]/content:w-auto"
						>
							<span class="shrink-0">Sampling for all</span>
							<!-- The visible words are the header's, so the
							     control's own label is hidden rather than
							     dropped: the input's id is generated inside the
							     component, so a `<label for>` cannot name it. -->
							<Select
								class="min-w-0 flex-1 @min-[640px]/content:w-52 @min-[640px]/content:flex-none"
								label={`Sampling for all ${group.label} jobs`}
								labelHidden
								options={groupSamplingItems(group.rows)}
								value={groupValue}
								onValueChange={(v) =>
									setGroupSampling(group.rows, v)}
							/>
						</div>
					{/if}
				</header>

				<ul class="divide-surface-200-800 flex flex-col divide-y">
					{#each group.rows as combo (combo.id)}
						{@const options = connectionOptions[combo.id] ?? []}
						{@const current =
							defaults[combo.id]?.connectionId ?? null}
						{@const currentModel =
							defaults[combo.id]?.connectionModelId ?? null}
						{@const currentModels =
							options.find((o) => o.id === current)?.models ?? []}
						{@const eligible = hasEligible(combo.id)}
						{@const cardSampling = samplingOptions[combo.id] ?? []}
						{@const cardValue = String(
							defaults[combo.id]?.samplingConfigId ?? ""
						)}
						{@const status = jobStatus(combo)}
						{@const users = askedBy(combo)}
						{@const label = capabilityLabel(combo.id as any)}
						<li
							data-field={`default:${combo.id}`}
							class="grid grid-cols-1 items-start gap-x-3 gap-y-2 px-4 py-3 @min-[900px]/content:grid-cols-[minmax(0,1fr)_6.5rem_12rem_12rem_11rem]"
						>
							<!-- 1. The job, in words. -->
							<div class="min-w-0">
								<span class="font-semibold">{label}</span>
								<p
									class="text-surface-600-400 text-xs break-words"
								>
									{capabilityTagline(combo.id as any) ??
										combo.id}
									<span class="font-mono opacity-80">
										· {combo.id}
									</span>
								</p>
								{#if JOB_NOTES[combo.id]}
									<p
										class="text-surface-600-400 mt-0.5 text-xs"
									>
										{JOB_NOTES[combo.id]}
									</p>
								{/if}
								{#if combo.id === EMBEDDING_CAPABILITY && systemSettingsCtx?.settings?.isAndroidWrapper}
									<p
										class="text-surface-600-400 mt-0.5 text-xs"
									>
										Local embeddings aren't available in the
										Android app; an external embeddings API
										works.
									</p>
								{/if}
								{#if users.length}
									<p
										class="text-surface-600-400 mt-0.5 text-xs"
										title={users.join("\n")}
									>
										Used by {users.length} node definition{users.length ===
										1
											? ""
											: "s"}
									</p>
								{/if}
							</div>

							<!-- 2. Status: a dot plus words, never colour alone. -->
							<span
								class="flex items-center gap-2 text-sm @min-[900px]/content:pt-1.5"
								title={combo.demanded && current == null
									? `Required by ${combo.requiredBy
											.map((r) => r.definitionId)
											.join(", ")}`
									: undefined}
							>
								<span
									class="{status.dot} size-2 shrink-0 rounded-full"
									aria-hidden="true"
								></span>
								{status.label}
							</span>

							{#key pickerEpoch}
								{#if options.length}
									<!-- 3. Connection. Rendered whenever there is
								     anything to render, even when none of it
								     qualifies: the disabled rows carry the
								     per-connection reasons, and those are the
								     only place "why not mine" is answered. -->
									<div class="flex min-w-0 flex-col gap-1">
										{@render stackedLabel("Connection")}
										<Select
											class="w-full"
											label={`Connection for ${label}`}
											labelHidden
											options={[
												{ value: "", label: "Not set" },
												// Every connection, judged and NOT
												// filtered: an ineligible one is listed
												// greyed with its reason, then the
												// user's own note, bounded by
												// `notePreview`.
												...options.map((opt) => ({
													value: String(opt.id),
													label: opt.name,
													disabled: !opt.eligible,
													hint:
														[
															opt.reason,
															notePreview(
																opt.notes
															)
														]
															.filter(Boolean)
															.join(" · ") ||
														undefined
												}))
											]}
											value={current == null
												? ""
												: String(current)}
											onValueChange={(v) => {
												if (v === "") {
													setHalf(
														combo.id,
														"connection",
														v
													)
													return
												}
												// Pin the first switched-on model: the
												// registration needs both halves and
												// connections have no default model.
												const models =
													(
														connectionOptions[
															combo.id
														] ?? []
													).find(
														(o) =>
															o.id === Number(v)
													)?.models ?? []
												const first = models.find(
													(m) =>
														m.enabled &&
														!m.missingSince
												)
												setHalf(
													combo.id,
													"connection",
													v,
													first
														? String(first.id)
														: undefined
												)
											}}
										/>
									</div>

									<!-- 4. Model: the second half of the pair, only
								     where the chosen endpoint HAS models.
								     Disabled models are listed and greyed, never
								     dropped, so an older registration still
								     shows as what it is. -->
									{#if currentModels.length}
										<div
											class="flex min-w-0 flex-col gap-1"
										>
											{@render stackedLabel("Model")}
											<Select
												class="w-full"
												label={`Model for ${label}`}
												labelHidden
												placeholder="Choose a model"
												options={currentModels.map(
													(m) => ({
														value: String(m.id),
														label: m.name,
														disabled:
															!m.enabled ||
															m.missingSince !=
																null,
														hint: m.missingSince
															? "No longer listed by its host"
															: m.enabled
																? undefined
																: "Switched off"
													})
												)}
												value={currentModel == null
													? ""
													: String(currentModel)}
												onValueChange={(v) => {
													if (!v) return
													setHalf(
														combo.id,
														"connection",
														String(current),
														v
													)
												}}
											/>
										</div>
									{:else}
										<span
											class="text-surface-600-400 hidden text-xs @min-[900px]/content:block @min-[900px]/content:pt-2"
										>
											{current == null
												? "—"
												: "No models listed"}
										</span>
									{/if}
								{:else}
									<!-- No connections at all: the two picker
								     columns become the sentence that says so. -->
									<div
										class="flex flex-wrap items-center gap-2 text-xs @min-[900px]/content:col-span-2"
									>
										{#if !combo.servable}
											<span class="text-surface-600-400">
												Nothing in this version of
												Serene Pub can do this yet.
											</span>
										{:else}
											<span class="text-surface-600-400">
												No connection can do this yet.
											</span>
											{@render addConnection(combo.id)}
										{/if}
									</div>
								{/if}
							{/key}

							<!-- 5. Sampling for this job. A job with no
							     sampling vocabulary (embeddings, entities)
							     has none. "Backend's own defaults" is a real
							     answer, not a blank. -->
							{#if cardSampling.length}
								<div class="flex min-w-0 flex-col gap-1">
									{@render stackedLabel("Sampling")}
									<Select
										class="w-full"
										label={`Sampling config for ${label}`}
										labelHidden
										options={samplingItems(cardSampling)}
										value={cardValue}
										onValueChange={(v) =>
											setHalf(combo.id, "sampling", v)}
									/>
									{#if groupValue === "mixed" && cardValue !== ""}
										<span
											class="text-surface-600-400 text-xs"
										>
											Differs from the rest of the group
										</span>
									{/if}
								</div>
							{:else}
								<span
									class="text-surface-600-400 hidden text-xs @min-[900px]/content:block @min-[900px]/content:pt-2"
								>
									No sampling
								</span>
							{/if}

							<!-- The one-line states under the row, INSTANCE
							     FIRST: `servable` is consulted only after the
							     instance has answered no, because it is wording
							     and never a gate. -->
							{#if options.length && !eligible}
								<p
									class="flex flex-wrap items-center gap-2 text-xs @min-[900px]/content:col-span-5"
								>
									<span class="text-surface-600-400">
										No connection on this pub can do
										this; the list says why.
									</span>
									{@render addConnection(combo.id)}
								</p>
							{:else if eligible && current == null && combo.demanded}
								<p
									class="text-surface-600-400 text-xs @min-[900px]/content:col-span-5"
								>
									Pipelines needing this refuse to run until a
									connection is chosen.
								</p>
							{/if}
							{#if currentModels.find((m) => m.id === currentModel)?.missingSince}
								<!-- Said on the row, because this is where the
								     registration was made and where an admin
								     looks to answer "why does every reply
								     refuse". -->
								<p
									class="text-surface-600-400 flex items-center gap-2 text-xs @min-[900px]/content:col-span-5"
								>
									<span
										class="bg-error-500 size-2 shrink-0 rounded-full"
										aria-hidden="true"
									></span>
									This model is no longer listed by its host, so
									runs needing it refuse. Refresh the connection
									once it serves the model again, or choose another.
								</p>
							{/if}
							{#if combo.id === EMBEDDING_CAPABILITY}
								<div class="@min-[900px]/content:col-span-5">
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface"
										onclick={openEmbeddingConnections}
									>
										<Icons.Zap
											size={14}
											aria-hidden="true"
										/>
										Open embedding connections
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}

		{#if !combos.length}
			<p class="text-surface-600-400 text-sm">
				No jobs are declared by this build. That should not happen: the
				list is aggregated from the adapter manifest and the pipeline
				definition registry, and an empty one means neither answered.
			</p>
		{/if}
	{/if}
</div>

<!-- Moving the embedding or entity star asks first, with the numbers. -->
<EmbeddingSwitchDialog {...stars.embeddingDialog} />
<EntitySwitchDialog {...stars.entityDialog} />

<!-- Below the desk switch the row stacks and the columns lose their
     positions, so each picker says what it picks. Hidden from assistive
     tech: every control already carries its own aria-label. -->
{#snippet stackedLabel(text: string)}
	<span
		class="text-surface-600-400 text-xs @min-[900px]/content:hidden"
		aria-hidden="true"
	>
		{text}
	</span>
{/snippet}

<!-- The one filled primary goes to the first job a run needs that nothing
     here can do; every other blocked job links quietly. -->
{#snippet addConnection(capability: string)}
	{#if capability === firstBlockedNeeded}
		<a
			class="btn btn-sm preset-filled-primary-500"
			href="/admin/connections/new"
		>
			<Icons.Plus size={14} aria-hidden="true" /> Add a connection
		</a>
	{:else}
		<a class="underline" href="/admin/connections/new">Add a connection</a>
	{/if}
{/snippet}
