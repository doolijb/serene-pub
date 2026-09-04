<script lang="ts">
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
	 * Cards grouped by OUTPUT KIND, with the sampling picker on the GROUP HEADER
	 * and the connection picker on each card. The three image transforms
	 * (`text->image`, `text+image->image`, `image->image`) share one
	 * steps/CFG/sampler vocabulary, so a per-card sampling control would ask the
	 * same question three times and let the answers drift — while a single
	 * control labelled "the image default" that wrote one of three rows would be
	 * a lie on screen. The header control writes the whole group; the per-card
	 * disclosure exists for the one admin who genuinely wants img2img on
	 * different settings, and it says so when it is in use.
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
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel, capabilityTagline } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { outputKindOf } from "$lib/shared/capabilities/samplingShape"
	import type { ComboRow } from "$lib/shared/capabilities/combos"

	const socket = useTypedSocket()
	const userCtx: UserCtx = getContext("userCtx")

	type ConnectionOption = Sockets.ConnectionDefaults.List.ConnectionOption
	type SamplingOption = Sockets.ConnectionDefaults.List.SamplingOption

	let combos = $state<ComboRow[]>([])
	let defaults = $state<Record<string, Sockets.CapabilityDefault>>({})
	let connectionOptions = $state<Record<string, ConnectionOption[]>>({})
	let samplingOptions = $state<Record<string, SamplingOption[]>>({})
	let loading = $state(true)
	/** Which cards have their sampling disclosure open, by capability id. */
	let openOverrides = $state<Record<string, boolean>>({})

	/**
	 * The heading each output kind gets.
	 *
	 * Plain words, because a heading reading `text` over a card reading "Chat"
	 * is the machine's vocabulary leaking into the person's. Unknown kinds — a
	 * plugin's own — fall through to the kind itself rather than to "Other", so
	 * a `text->video` provider gets a heading that names it.
	 */
	const GROUP_LABELS: Record<string, string> = {
		text: "Text",
		image: "Images",
		audio: "Speech and audio",
		video: "Video",
		document: "Documents",
		embedding: "Embeddings"
	}

	const GROUP_ICONS: Record<string, keyof typeof Icons> = {
		text: "Type",
		image: "Image",
		audio: "AudioLines",
		video: "Clapperboard",
		document: "FileText",
		embedding: "Zap"
	}

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
					label: GROUP_LABELS[kind] ?? `Produces ${kind}`,
					rows: []
				}
				out.push(group)
			}
			group.rows.push(combo)
		}
		return out
	})

	/** How many capabilities have a connection registered, and of how many. */
	let registeredCount = $derived(
		combos.filter((c) => defaults[c.id]?.connectionId != null).length
	)
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

	function setHalf(
		capability: string,
		half: "connection" | "sampling",
		raw: string
	) {
		const id = raw === "" ? null : Number(raw)
		if (id !== null && Number.isNaN(id)) return
		socket.emit("connectionDefaults:set", { capability, half, id })
	}

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

	onMount(() => {
		socket.on("connectionDefaults:list", handleList)
		socket.on("connectionDefaults:set", handleSet)
		socket.emit("connectionDefaults:list", {})
	})
	onDestroy(() => {
		socket.off("connectionDefaults:list", handleList)
		socket.off("connectionDefaults:set", handleSet)
	})
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Target size={20} /> Defaults
		</h2>
		<p class="text-surface-600-400 text-sm">
			Which connection this instance uses for each thing it can do.
			Nothing is picked automatically — a connection you have saved is not
			used until it is registered here.
		</p>
	</div>
</div>

{#if !userCtx.user?.isAdmin}
	<p class="text-surface-600-400 text-sm">Admin access required.</p>
{:else if loading}
	<div class="flex items-center justify-center py-10">
		<Icons.Loader2 size={20} class="text-surface-400 animate-spin" />
	</div>
{:else}
	<!-- The summary strip. This screen is now the definition of what the
	     instance can do, so the count has to be true on first paint — which is
	     why the whole matrix arrives in one response rather than a fetch per
	     card. -->
	<div
		class="card preset-filled-surface-100-900 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm"
	>
		<span class="flex items-center gap-2">
			<Icons.CircleCheck size={15} class="text-success-500 shrink-0" />
			<strong>{registeredCount}</strong>
			of {combos.length} registered
		</span>
		{#if missingRequired.length}
			<span class="text-warning-600-400 flex items-center gap-2">
				<Icons.TriangleAlert size={15} class="shrink-0" />
				{missingRequired.length} needed by a pipeline and not set
			</span>
		{/if}
	</div>

	{#each groups as group (group.kind)}
		{@const GroupIcon = (Icons[GROUP_ICONS[group.kind] ?? "Boxes"] ??
			Icons.Boxes) as any}
		{@const samplingChoices = groupSamplingOptions(group.rows)}
		<section class="mb-5">
			<header
				class="border-surface-200-700 mb-2 flex flex-wrap items-center gap-3 border-b pb-2"
			>
				<h3 class="flex items-center gap-2 font-semibold">
					<GroupIcon size={16} />
					{group.label}
				</h3>
				<div class="flex-1"></div>
				{#if samplingChoices.length}
					<!-- One control for the group: these capabilities share a
					     sampling vocabulary, so asking per card would ask the
					     same question three times and let the answers drift. -->
					<label
						class="text-surface-600-400 flex items-center gap-2 text-xs"
					>
						Sampling
						<select
							class="select select-sm w-52"
							value={groupSampling(group.rows)}
							onchange={(e) =>
								setGroupSampling(
									group.rows,
									e.currentTarget.value
								)}
						>
							{#if groupSampling(group.rows) === "mixed"}
								<option value="mixed">Mixed</option>
							{/if}
							<option value="">Backend's own defaults</option>
							{#each samplingChoices as opt (opt.id)}
								<option value={String(opt.id)}>
									{opt.name}
								</option>
							{/each}
						</select>
					</label>
				{/if}
			</header>

			<div class="flex flex-col gap-2">
				{#each group.rows as combo (combo.id)}
					{@const options = connectionOptions[combo.id] ?? []}
					{@const current = defaults[combo.id]?.connectionId ?? null}
					{@const eligible = hasEligible(combo.id)}
					{@const cardSampling = samplingOptions[combo.id] ?? []}
					{@const groupValue = groupSampling(group.rows)}
					{@const cardValue = String(
						defaults[combo.id]?.samplingConfigId ?? ""
					)}
					<div
						class="card preset-filled-surface-100-900 flex flex-col gap-2 p-3"
					>
						<div class="flex flex-wrap items-center gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="font-semibold">
										{capabilityLabel(combo.id as any)}
									</span>
									{#if combo.demanded && current == null}
										<span
											class="preset-tonal-warning rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold"
											title={`Required by ${combo.requiredBy
												.map((r) => r.typeId)
												.join(", ")}`}
										>
											needed
										</span>
									{:else if current != null}
										<Icons.Check
											size={13}
											class="text-success-500 shrink-0"
										/>
									{/if}
								</div>
								<p class="text-surface-600-400 text-xs">
									{capabilityTagline(combo.id as any) ??
										combo.id}
									<span class="font-mono opacity-60">
										· {combo.id}
									</span>
								</p>
							</div>

							{#if options.length}
								<!-- The picker is rendered whenever there is
								     anything to render, even when none of it
								     qualifies: the disabled rows carry the
								     per-connection reasons, and those are the
								     only place "why not mine" is answered. The
								     SENTENCE below is what changes. -->
								<select
									class="select select-sm w-64"
									value={current == null
										? ""
										: String(current)}
									onchange={(e) =>
										setHalf(
											combo.id,
											"connection",
											e.currentTarget.value
										)}
									aria-label={`Default connection for ${capabilityLabel(combo.id as any)}`}
								>
									<option value="">Not set</option>
									<!-- Every connection, judged and NOT
									     filtered: a row that cannot do this is
									     disabled and carries its own reason,
									     because a connection merely absent from
									     the list makes "why isn't mine there"
									     unanswerable here. -->
									{#each options as opt (opt.id)}
										<option
											value={String(opt.id)}
											disabled={!opt.eligible}
											title={opt.reason}
										>
											{opt.name}{opt.reason
												? ` — ${opt.reason}`
												: ""}
										</option>
									{/each}
								</select>
							{/if}
						</div>

						<!-- The empty-state ladder, INSTANCE FIRST. `servable` is
					     only ever consulted after the instance has answered no,
					     because it is wording and never a gate: openai-embeddings
					     and local-onnx carry text->embedding with no manifest
					     entry at all, so asking the build first would tell an
					     admin who HAS an embeddings connection that this build
					     cannot do embeddings. -->
						{#if eligible && current == null}
							<!-- 1. Something here fits; nobody has chosen. -->
							<p class="text-surface-600-400 text-xs">
								Not set — pipelines needing this will refuse to
								run until one is chosen.
							</p>
						{:else if !eligible && !combo.servable}
							<!-- 3. Nothing here fits, and no adapter in this
							     build could. -->
							<p class="text-surface-600-400 text-xs italic">
								Nothing in this version of Serene Pub can do
								this yet.
							</p>
						{:else if !eligible && options.length}
							<!-- 2. Connections exist, none qualify. The picker
							     above is still there, full of disabled rows;
							     this says out loud what the greying means. -->
							<p class="text-warning-600-400 text-xs">
								No connection on this instance can do this yet —
								the ones above say why.
								<a class="underline" href="/admin/connections">
									Add or test a connection
								</a>
								.
							</p>
						{:else if !eligible}
							<!-- 2b. No connections at all, but this build could
							     serve it. Not the same sentence as 3, and the
							     difference is what the admin should do next. -->
							<p class="text-surface-600-400 text-xs">
								No connections yet —
								<a class="underline" href="/admin/connections">
									add one
								</a>
								.
							</p>
						{/if}

						{#if cardSampling.length}
							<div>
								<button
									type="button"
									class="text-surface-600-400 flex items-center gap-1 text-xs hover:underline"
									onclick={() =>
										(openOverrides = {
											...openOverrides,
											[combo.id]: !openOverrides[combo.id]
										})}
									aria-expanded={!!openOverrides[combo.id]}
								>
									{#if openOverrides[combo.id]}
										<Icons.ChevronDown size={12} />
									{:else}
										<Icons.ChevronRight size={12} />
									{/if}
									Sampling for this combination
									{#if groupValue === "mixed" && cardValue !== ""}
										<span
											class="preset-tonal-secondary ml-1 rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold"
										>
											overridden
										</span>
									{/if}
								</button>
								{#if openOverrides[combo.id]}
									<div class="mt-1 flex items-center gap-2">
										<select
											class="select select-sm w-52"
											value={cardValue}
											onchange={(e) =>
												setHalf(
													combo.id,
													"sampling",
													e.currentTarget.value
												)}
											aria-label={`Sampling config for ${capabilityLabel(combo.id as any)}`}
										>
											<option value="">
												Backend's own defaults
											</option>
											{#each cardSampling as opt (opt.id)}
												<option value={String(opt.id)}>
													{opt.name}
												</option>
											{/each}
										</select>
										<span
											class="text-surface-600-400 text-xs"
										>
											Leaving this unset is a real answer
											— the backend uses its own.
										</span>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/each}

	{#if !combos.length}
		<p class="text-surface-600-400 text-sm">
			No capabilities are declared by this build. That should not happen —
			the list is aggregated from the adapter manifest and the pipeline
			type registry, and an empty one means neither answered.
		</p>
	{/if}
{/if}
