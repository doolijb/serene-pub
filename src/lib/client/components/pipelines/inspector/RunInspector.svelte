<script lang="ts">
	/**
	 * What one run did — the receipt, read.
	 *
	 * Two levels and no third (handover §4.5): the stage list is level one and
	 * the detail pane beside it is level two. Everything on screen comes from
	 * `receiptView`, which is pure and asserted against saved receipts, so this
	 * file decides layout and nothing else.
	 *
	 * ⚠ **Render what the server sent.** Connection identity is removed at the
	 * egress for a non-admin, so a provider row shows a model marker with no
	 * name and a `Wire` tab with no connection. Nothing here reconstructs a
	 * missing field from a neighbouring one.
	 */
	import * as Icons from "@lucide/svelte"
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	// The incremental UI-translation seam (R5) — see `src/routes/+page.svelte`.
	// Wrapped here for the Portrayed-by line's words; a member's name is
	// never passed through it.
	import { statusText, t } from "$lib/client/i18n/state.svelte"
	import {
		nodeRows,
		outputView,
		postHistoryView,
		promptView,
		verdict,
		lastStatusOf,
		portrayalsLine,
		wireView,
		type InspectedRun,
		type NodeRow
	} from "./receiptView"

	interface Props {
		/** Which run. Nothing is asked for without one. */
		runId: string | null | undefined
		/**
		 * What the read returned, for a host that needs a fact off the run it
		 * did not fetch — the session a receipt belongs to, say.
		 */
		onLoaded?: (run: InspectedRun) => void
	}

	let { runId, onLoaded }: Props = $props()

	let run = $state<InspectedRun | null>(null)
	let loading = $state(false)
	let refusal = $state<string | null>(null)
	let selectedSeq = $state<number | null>(null)
	let tab = $state("prompt")

	const onRun = (res: Sockets.Pipelines.Run.Response) => {
		// A shared channel: an answer is drawn only under the run this
		// inspector is showing, never under whichever one replaced it.
		if (!res.run || res.run.runId !== runId) return
		loading = false
		refusal = null
		run = res.run as InspectedRun
		selectedSeq = null
		onLoaded?.(run)
	}

	const onRunError = (res: { error?: string }) => {
		loading = false
		refusal = res?.error ?? "That run could not be read."
	}

	// Never gated (plan ruling 2 — an error is not an output to skip), but the
	// registry is the only listener path, so it is declared like the reply.
	useInterest<"pipelines:run:error">("pipelines:run:error", onRunError)

	/**
	 * The run this inspector is showing, asked for and listened for together:
	 * `requestWithInterest` declares the reply's key, flushes the interest sync
	 * and only then sends the request (ruling 3).
	 *
	 * BARE — `pipelines:run` has no entry in `SCOPED_EVENTS`, and a `#<runId>`
	 * key for an unscoped event would match no payload at all. `onRun`'s own
	 * `res.run.runId !== runId` check is the filter, as it was.
	 *
	 * The release is the effect's teardown, so re-pointing the inspector at
	 * another run drops the previous interest rather than stacking one.
	 */
	$effect(() => {
		const id = runId
		run = null
		refusal = null
		selectedSeq = null
		if (!id) return
		loading = true
		return requestWithInterest("pipelines:run", { runId: id }, onRun)
	})

	const rows = $derived(run ? nodeRows(run.receipt) : [])

	/**
	 * Where a reader's eye should land: the node that ended the run, else the
	 * last model call, else the last thing that happened. Opening on `input`
	 * would answer a question nobody asked.
	 */
	const defaultRow = $derived.by(() => {
		if (!rows.length) return null
		const haltKey = run?.haltNodeKey
		return (
			rows.find((r) => haltKey && r.nodeKey === haltKey) ??
			[...rows].reverse().find((r) => r.isOracle) ??
			rows[rows.length - 1]
		)
	})

	const selected = $derived(
		rows.find((r) => r.seq === selectedSeq) ?? defaultRow
	)

	const wire = $derived(selected ? wireView(selected.raw) : null)
	const prompt = $derived(
		selected && run ? promptView(selected.raw, run.receipt) : null
	)
	const output = $derived(outputView(selected?.raw?.output))
	/**
	 * Whether the post-history reminder went out, and why.
	 *
	 * A suppressed reminder leaves no trace in the payload beside it, so the
	 * line is the only place a reader can tell "the trigger held it back" from
	 * "nobody wrote one".
	 */
	const postHistory = $derived(
		selected ? postHistoryView(selected.raw) : null
	)

	const tabs = $derived([
		...(prompt ? ["prompt"] : []),
		"output",
		...(wire ? ["wire"] : []),
		"notes"
	])

	// A tab that does not exist on the newly selected node falls back rather
	// than leaving an empty pane.
	$effect(() => {
		if (!tabs.includes(tab)) tab = tabs[0] ?? "output"
	})

	function select(row: NodeRow) {
		selectedSeq = row.seq
	}

	async function copyOutput() {
		try {
			await navigator.clipboard.writeText(
				JSON.stringify(selected?.raw?.output ?? null, null, 2)
			)
			toaster.success({ title: "Copied to the clipboard" })
		} catch {
			toaster.error({
				title: "Could not reach the clipboard. Select the text and copy it."
			})
		}
	}

	/** Copy one piece of the exchange, with the same answer copyOutput gives. */
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text)
			toaster.success({ title: "Copied to the clipboard" })
		} catch {
			toaster.error({
				title: "Could not reach the clipboard. Select the text and copy it."
			})
		}
	}

	const ms = (n: number) =>
		n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`

	/** The run's own outcome, in the same four tones the stage rows use. */
	const runTone = $derived(
		run?.outcome === "ok" ? "ok" : run?.outcome === "err" ? "error" : "halt"
	)

	const badgeClass: Record<string, string> = {
		ok: "text-success-500",
		halt: "text-warning-500",
		skip: "text-surface-600-400",
		error: "text-error-500"
	}

	/** "1 message, 2 files" — what the run left behind, counted by kind. */
	const madeSummary = $derived.by(() => {
		const counts = new Map<string, number>()
		for (const a of run?.artifacts ?? [])
			counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1)
		return [...counts.entries()]
			.map(
				([kind, n]) =>
					`${n} ${kind.replace(/_/g, " ")}${n > 1 ? "s" : ""}`
			)
			.join(", ")
	})

	const triggerSource = $derived((run?.receipt as any)?.triggerSource ?? null)
	const runNotes = $derived(((run?.receipt as any)?.notes ?? []) as string[])
	/**
	 * Where this run stands in a tree of runs (01 §8; U5d): the run that
	 * dispatched it — a form's answer is the child of the run that asked, the
	 * action it fired the grandchild — and how deep. Absent for a root, which
	 * is nearly every run.
	 */
	const lineage = $derived.by(() => {
		const r = run?.receipt as
			| { parentRunId?: string; rootRunId?: string; depth?: number }
			| undefined
		return r?.parentRunId
			? { parent: r.parentRunId, root: r.rootRunId ?? r.parentRunId, depth: r.depth ?? 1 }
			: null
	})
	/** Who portrayed whom this run — pinned at run start (R-21 (4)). */
	const portrayals = $derived(run ? portrayalsLine(run) : [])
</script>

<section data-run-inspector class="flex min-h-0 flex-col gap-3">
	{#if loading}
		<p class="text-surface-600-400 text-sm">Loading the receipt…</p>
	{:else if refusal}
		<p class="preset-tonal-warning rounded-lg p-3 text-sm" role="alert">
			{refusal}
		</p>
	{:else if run}
		<!-- ── the verdict, then the facts behind it ───────────────────── -->
		<header class="flex flex-col gap-2">
			<!-- The one status the receipt keeps (R-21): what the run was
			     doing when it died, in the reader's language, inside the
			     sentence — "Stopped at generate on request while Jasmine is
			     typing." -->
			<p class="text-base font-semibold" data-run-verdict>
				{verdict(run, {
					status: statusText(lastStatusOf(run)?.text)
				})}
			</p>
			<div
				class="text-surface-600-400 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
			>
				<span class="font-mono" title="The pipeline this run used">
					{run.specSlug}@{run.specVersion}
				</span>
				{#if run.specHash}
					<!-- The slug and the semver name a pointer; the hash names
					     the document. Whether it is still the current one is
					     what decides if this receipt also describes what the
					     same button does today. -->
					<span
						class="chip rounded-full px-2 py-0.5 font-mono {run.specHashIsCurrent
							? 'preset-tonal-surface'
							: run.specHashRenamedAt
								? 'preset-tonal-surface'
								: 'preset-tonal-warning'}"
						title={run.specHashIsCurrent
							? "This pipeline still resolves to the document this run used."
							: run.specHashRenamedAt
								? "The vocabulary was renamed after this run — the same document under new words. The receipt describes what the pipeline still does."
								: "This pipeline has been edited since. The receipt describes the run, not what the pipeline does now."}
					>
						{run.specHash.slice(0, 8)}
						{run.specHashIsCurrent
							? ""
							: run.specHashRenamedAt
								? `· renamed ${run.specHashRenamedAt.slice(0, 10)}`
								: "· superseded"}
					</span>
				{/if}
				<span class={badgeClass[runTone]}>
					{run.outcome}
				</span>
				{#if run.haltNodeKey}
					<span class="font-mono">at {run.haltNodeKey}</span>
				{/if}
				<span>{ms(run.elapsedMs)}</span>
				<span>{run.tokensSpent || 0} tokens</span>
				{#if triggerSource}
					<span>triggered by {triggerSource}</span>
				{/if}
				{#if run.isPreview}
					<span
						class="chip preset-tonal-surface rounded-full px-2 py-0.5"
						title="This run left nothing behind."
					>
						preview
					</span>
				{/if}
				{#if madeSummary}
					<span>made {madeSummary}</span>
				{/if}
				<span class="font-mono opacity-70">{run.runId}</span>
			</div>
			{#if run.haltReason}
				<p class="text-surface-600-400 text-xs">{run.haltReason}</p>
			{/if}
			{#if lineage}
				<!-- A dispatched run names the run that dispatched it (U5d):
				     the answer to a question names the run that asked. -->
				<p
					class="text-surface-600-400 flex flex-wrap items-center gap-x-2 text-xs"
					data-run-lineage
					title="This run was dispatched by another: a form put to a participant the AI portrays is answered as a child of the run that asked."
				>
					<span>{t("Dispatched by")}</span>
					<span class="font-mono opacity-70">{lineage.parent}</span>
					<span>· {t("depth")} {lineage.depth}</span>
				</p>
			{/if}
			{#if portrayals.length}
				<!-- Who portrayed whom, as the run pinned it before its first
				     node: a member joining mid-run changes the next run's
				     line, never this one's. Each pair is its own chip so
				     "Tom · AI · Elara · you" groups by participant. -->
				<p
					class="text-surface-600-400 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
					data-run-portrayals
					title="Who portrayed each participant this run, decided when the run started."
				>
					<span>{t("Portrayed by")}</span>
					{#each portrayals as chip (chip.ref)}
						<span class="chip preset-tonal-surface rounded-full px-2 py-0.5">
							{chip.name} · {chip.by === "person" && !chip.you
								? chip.portrayedBy
								: t(chip.portrayedBy)}
						</span>
					{/each}
				</p>
			{/if}
			{#if runNotes.length}
				<ul class="text-surface-600-400 list-disc pl-5 text-xs">
					{#each runNotes as note (note)}
						<li>{note}</li>
					{/each}
				</ul>
			{/if}
		</header>

		{#if !rows.length}
			<p class="text-surface-600-400 text-sm">
				This receipt records no stages. A run that halts before anything
				effectful keeps attribution only.
			</p>
		{:else}
			<div class="flex min-h-0 flex-col gap-3 lg:flex-row">
				<!-- ── level one: what ran, in order ───────────────────── -->
				<ul
					class="border-surface-300-700 flex max-h-[22rem] shrink-0 flex-col overflow-y-auto rounded-lg border lg:max-h-[34rem] lg:w-80"
					aria-label="Stages, in the order they ran"
				>
					{#each rows as row (row.seq)}
						<li>
							<button
								type="button"
								data-run-node
								data-node-key={row.nodeKey}
								aria-pressed={selected?.seq === row.seq}
								class="border-surface-300-700/50 hover:bg-surface-200-800 flex w-full flex-col gap-0.5 border-b px-2 py-1.5 text-left last:border-b-0 {selected?.seq ===
								row.seq
									? 'bg-surface-200-800'
									: ''}"
								onclick={() => select(row)}
							>
								<span class="flex items-baseline gap-2 text-xs">
									<span
										class="text-surface-600-400 w-5 shrink-0 font-mono"
									>
										{row.seq}
									</span>
									<span
										class="min-w-0 flex-1 truncate font-mono"
									>
										{row.label}
									</span>
									<span class={badgeClass[row.badge]}>
										{row.result}
									</span>
								</span>
								<span
									class="text-surface-600-400 flex items-center gap-2 pl-7 text-[0.68rem]"
								>
									<span class="min-w-0 truncate">
										{row.definitionId}
									</span>
									<span class="flex-1"></span>
									{#if row.isOracle}
										<span
											class="inline-flex shrink-0 items-center gap-1"
											title={row.model
												? `Model: ${row.model}`
												: "This stage called a model."}
										>
											<Icons.Cpu size={11} />
											{row.model ? "model" : "model call"}
										</span>
									{/if}
									<span class="shrink-0">
										{ms(row.elapsedMs)}
									</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>

				<!-- ── level two: one stage, in detail ──────────────────── -->
				<div class="min-w-0 flex-1">
					{#if selected}
						<div
							class="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"
						>
							<span class="font-mono text-sm font-semibold">
								{selected.label}
							</span>
							<span
								class="text-surface-600-400 font-mono text-xs"
							>
								{selected.definitionId}
							</span>
							{#if selected.model}
								<span
									class="chip preset-tonal-surface rounded-full px-2 py-0.5 font-mono text-xs"
								>
									{selected.model}
								</span>
							{/if}
							{#if selected.cacheHit}
								<span class="text-surface-600-400 text-xs">
									cache hit
								</span>
							{/if}
							{#if selected.recoveredAsEmpty}
								<span class="text-warning-500 text-xs">
									recovered as empty
								</span>
							{/if}
						</div>
						{#if selected.reason}
							<p
								class="preset-tonal-warning mb-2 rounded-lg p-2 text-xs"
							>
								{selected.reason}
							</p>
						{/if}

						<Tabs
							value={tab}
							onValueChange={(e) => (tab = e.value)}
							class="flex min-h-0 flex-col"
						>
							<Tabs.List class="flex shrink-0 flex-wrap gap-1">
								{#if prompt}
									<Tabs.Trigger
										value="prompt"
										data-run-tab="prompt"
									>
										Prompt
									</Tabs.Trigger>
								{/if}
								<Tabs.Trigger
									value="output"
									data-run-tab="output"
								>
									Output
								</Tabs.Trigger>
								{#if wire}
									<Tabs.Trigger
										value="wire"
										data-run-tab="wire"
									>
										Wire
									</Tabs.Trigger>
								{/if}
								<Tabs.Trigger
									value="notes"
									data-run-tab="notes"
								>
									Notes
								</Tabs.Trigger>
							</Tabs.List>

							{#if prompt}
								<Tabs.Content value="prompt" class="pt-2">
									<p
										class="text-surface-600-400 mb-2 text-xs"
									>
										{prompt.source === "wire"
											? "The turns as sent by the adapter."
											: prompt.source === "sent"
												? "The payload this stage sent."
												: prompt.source === "prepared"
													? "The payload this stage was handed. It halted before sending."
													: "The payload this stage rendered."}
										{#if prompt.totalTokens != null}
											· {prompt.totalTokens} tokens
										{/if}
										{#if prompt.promptFormat}
											· {prompt.promptFormat}
										{/if}
										{#if prompt.budget}
											· budget {prompt.budget.used ??
												0}/{prompt.budget.total ?? 0}
										{/if}
									</p>

									{#if postHistory && postHistory.source === "decision"}
										<p
											class="mb-2 text-xs {postHistory.included
												? 'text-surface-600-400'
												: 'text-warning-500'}"
										>
											{postHistory.line}
											{#each postHistory.notes as note (note)}
												· {note}
											{/each}
										</p>
									{/if}

									{#if prompt.blocks.length}
										<div class="mb-3 overflow-x-auto">
											<table
												class="w-full min-w-[34rem] border-collapse text-xs"
											>
												<thead>
													<tr
														class="text-surface-600-400 border-surface-300-700 border-b text-left text-[0.68rem] tracking-wider uppercase"
													>
														<th class="px-2 py-1.5">
															Source
														</th>
														<th class="px-2 py-1.5">
															Name
														</th>
														<th
															class="px-2 py-1.5 text-right"
														>
															Tokens
														</th>
														<th class="px-2 py-1.5">
															In
														</th>
														<th class="px-2 py-1.5">
															Why
														</th>
													</tr>
												</thead>
												<tbody>
													{#each prompt.blocks as block, i (`${block.source}-${block.name}-${i}`)}
														<tr
															class="border-surface-300-700/50 border-b last:border-b-0"
														>
															<td
																class="px-2 py-1.5"
															>
																{block.source}
															</td>
															<td
																class="px-2 py-1.5"
															>
																{block.name}
															</td>
															<td
																class="px-2 py-1.5 text-right"
															>
																{block.tokens}
															</td>
															<td
																class="px-2 py-1.5"
															>
																<span
																	class={block.included
																		? "text-success-500"
																		: "text-surface-600-400"}
																>
																	{block.included
																		? "yes"
																		: "no"}
																</span>
															</td>
															<td
																class="text-surface-600-400 px-2 py-1.5"
															>
																{block.why.join(
																	" · "
																) || "none"}
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									{/if}

									{#if prompt.messages.length}
										<div class="flex flex-col gap-2">
											{#each prompt.messages as message, i (i)}
												<div
													class="border-surface-300-700 rounded-lg border"
												>
													<p
														class="text-surface-600-400 border-surface-300-700 border-b px-2 py-1 text-[0.68rem] tracking-wider uppercase"
													>
														{message.role}
													</p>
													<pre
														class="max-h-72 overflow-auto p-2 text-[11px] whitespace-pre-wrap">{message.content}</pre>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-surface-600-400 text-xs">
											This payload rendered no messages.
										</p>
									{/if}
								</Tabs.Content>
							{/if}

							<Tabs.Content value="output" class="pt-2">
								{#if postHistory && postHistory.source === "carried"}
									<p
										class="text-surface-600-400 mb-2 text-xs"
									>
										{postHistory.line}
									</p>
								{/if}
								{#if output.empty}
									<p class="text-surface-600-400 text-xs">
										This stage published nothing.
									</p>
								{:else}
									<div class="flex flex-col gap-2">
										{#each output.texts as text (text.key)}
											<div
												class="border-surface-300-700 rounded-lg border"
											>
												<p
													class="text-surface-600-400 border-surface-300-700 border-b px-2 py-1 font-mono text-[0.68rem]"
												>
													{text.key}
												</p>
												{#if text.note}
													<p
														class="text-surface-600-400 border-surface-300-700 border-b px-2 py-1 text-[0.68rem]"
													>
														{text.note}
													</p>
												{/if}
												<pre
													class="max-h-72 overflow-auto p-2 text-[11px] whitespace-pre-wrap">{text.value}</pre>
											</div>
										{/each}
										{#if output.rest != null}
											<details>
												<summary
													class="text-surface-600-400 flex cursor-pointer items-center gap-2 text-xs select-none"
												>
													The rest, as JSON
												</summary>
												<pre
													class="bg-surface-200-800 mt-2 max-h-72 overflow-auto rounded p-2 font-mono text-[11px]">{JSON.stringify(
														output.rest,
														null,
														2
													)}</pre>
											</details>
										{/if}
										<div>
											<button
												type="button"
												class="btn btn-sm preset-tonal-surface"
												onclick={copyOutput}
											>
												<Icons.Copy size={13} /> Copy output
											</button>
										</div>
									</div>
								{/if}
							</Tabs.Content>

							{#if wire}
								<Tabs.Content value="wire" class="pt-2">
									<p
										class="text-surface-600-400 mb-2 text-xs"
									>
										{#if wire.wire}
											Wire: <span class="font-mono">
												{wire.wire}
											</span>
											{#if wire.wire === "chat"}
												· roles carry the structure:
												template delimiters are held
												back, speaker labels ride the
												wire when the turns inline them
											{/if}
										{:else}
											This stage recorded no wire kind.
										{/if}
										{#if wire.structured}
											· structured output:
											<span class="font-mono">
												{wire.structured.mode ?? "?"}
											</span>
											{#if wire.structured.capability}
												via
												<span class="font-mono">
													{wire.structured.capability}
												</span>
											{/if}
										{/if}
									</p>
									<!-- What the adapter put on the wire, and what
									     came back. Administrator-only: the
									     exchange names the connection, so the
									     egress removes it for everybody else and
									     the stop lists below stand alone. -->
									{#each wire.calls as call, i (`call-${i}`)}
										<div
											class="border-surface-300-700 mb-3 rounded-lg border"
										>
											<div
												class="border-surface-300-700 text-surface-600-400 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-2 py-1 text-[0.68rem]"
											>
												<span
													class="font-mono tracking-wider uppercase"
												>
													{call.method}
												</span>
												<span
													class="min-w-0 flex-1 truncate font-mono"
													title={call.url}
												>
													{call.url}
												</span>
												{#if call.status !== null}
													<span>{call.status}</span>
												{/if}
												{#if call.durationMs !== null}
													<span>
														{ms(call.durationMs)}
													</span>
												{/if}
												{#if call.streamed}
													<span>
														streamed{call.chunks !==
														null
															? ` · ${call.chunks} frames`
															: ""}
													</span>
												{/if}
											</div>
											<div
												class="flex flex-col gap-3 p-2"
											>
												<div
													class="flex flex-col gap-1"
												>
													<p
														class="text-surface-600-400 text-[0.68rem] tracking-wider uppercase"
													>
														Request
													</p>
													<pre
														class="bg-surface-200-800 max-h-72 overflow-auto rounded p-2 font-mono text-[11px]">{call.body}</pre>
													<div>
														<button
															type="button"
															class="btn btn-sm preset-tonal-surface"
															data-run-copy="request"
															onclick={() =>
																copy(call.body)}
														>
															<Icons.Copy
																size={13}
															/>
															Copy request
														</button>
													</div>
												</div>
												<div
													class="flex flex-col gap-1"
												>
													<p
														class="text-surface-600-400 text-[0.68rem] tracking-wider uppercase"
													>
														Response
													</p>
													{#if call.raw}
														<pre
															class="bg-surface-200-800 max-h-72 overflow-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap">{call.raw}</pre>
													{:else}
														<p
															class="text-surface-600-400 text-xs"
														>
															Nothing came back on
															this call.
														</p>
													{/if}
													{#if call.truncated}
														<p
															class="text-surface-600-400 text-[0.68rem]"
														>
															Kept to the first 64
															KB. The rest of the
															response is not
															stored.
														</p>
													{/if}
													{#if call.raw}
														<div>
															<button
																type="button"
																class="btn btn-sm preset-tonal-surface"
																data-run-copy="response"
																onclick={() =>
																	copy(
																		call.raw
																	)}
															>
																<Icons.Copy
																	size={13}
																/>
																Copy response
															</button>
														</div>
													{/if}
												</div>
												{#if call.redacted.length}
													<p
														class="text-surface-600-400 text-[0.68rem]"
													>
														Replaced before this was
														stored: {call.redacted.join(
															", "
														)}
													</p>
												{/if}
											</div>
										</div>
									{/each}

									<div class="overflow-x-auto">
										<table
											class="w-full min-w-[26rem] border-collapse text-xs"
										>
											<thead>
												<tr
													class="text-surface-600-400 border-surface-300-700 border-b text-left text-[0.68rem] tracking-wider uppercase"
												>
													<th class="px-2 py-1.5">
														Stop sequence
													</th>
													<th class="px-2 py-1.5">
														Kind
													</th>
													<th class="px-2 py-1.5">
														On the wire
													</th>
												</tr>
											</thead>
											<tbody>
												{#each wire.sent as stop, i (`sent-${stop.value}-${i}`)}
													<tr
														class="border-surface-300-700/50 border-b last:border-b-0"
													>
														<td
															class="px-2 py-1.5 font-mono"
														>
															{stop.value}
														</td>
														<td class="px-2 py-1.5">
															{stop.kind}
														</td>
														<td
															class="text-success-500 px-2 py-1.5"
														>
															sent
															{#if stop.why}
																<span
																	class="text-surface-600-400"
																>
																	· {stop.why}
																</span>
															{/if}
														</td>
													</tr>
												{/each}
												{#each wire.dropped as stop, i (`dropped-${stop.value}-${i}`)}
													<tr
														class="border-surface-300-700/50 border-b last:border-b-0"
													>
														<td
															class="px-2 py-1.5 font-mono"
														>
															{stop.value}
														</td>
														<td class="px-2 py-1.5">
															{stop.kind}
														</td>
														<td
															class="text-surface-600-400 px-2 py-1.5"
														>
															held back
															{#if stop.why}
																· {stop.why}
															{/if}
														</td>
													</tr>
												{/each}
												{#if !wire.sent.length && !wire.dropped.length}
													<tr>
														<td
															class="text-surface-600-400 px-2 py-1.5"
															colspan="3"
														>
															No stop sequences
															were composed for
															this call.
														</td>
													</tr>
												{/if}
											</tbody>
										</table>
									</div>
								</Tabs.Content>
							{/if}

							<Tabs.Content value="notes" class="pt-2">
								{#if selected.notes.length}
									<ul
										class="list-disc pl-5 text-xs"
										aria-label="Stage notes"
									>
										{#each selected.notes as note, i (i)}
											<li>{note}</li>
										{/each}
									</ul>
								{:else}
									<p class="text-surface-600-400 text-xs">
										This stage recorded no notes.
									</p>
								{/if}
							</Tabs.Content>
						</Tabs>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</section>
