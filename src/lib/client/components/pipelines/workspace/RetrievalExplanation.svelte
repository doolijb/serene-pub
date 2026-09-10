<script lang="ts">
	/**
	 * Why the retrieval chose what it chose — design §9, plan Part 6.
	 *
	 * The trail behind every candidate has been computed on every turn since
	 * the decomposition. This is its reader, and it is shaped by the plan's
	 * ruling rather than by what the receipt happens to hold:
	 *
	 * · **Anchored to the result, not a numeric panel.** One row per candidate
	 *   with a medal and a sentence. Numbers are the second level, never the
	 *   first — "matched 2 of its 3 keys (ashguard, gate)" before "0.667".
	 * · **Two levels of disclosure and no third** (Nielsen, plan Part 6 §5).
	 *   The row is level one; opening it reveals the named criteria, the
	 *   engine's own arithmetic and the actions. There is nowhere further to go.
	 * · **Every explanation carries an action.** The CHI 2024 finding the plan
	 *   cites is that users value contestability over comprehension, so a row
	 *   that only explains is the failure mode. `constant` is "always include"
	 *   and `enabled` is "never include"; both write through `entries:update`,
	 *   the same verb the lore managers use, so the toggle here and the
	 *   checkbox there are one control.
	 *
	 * ## It is handed an explanation; it does not go and get one
	 *
	 * This used to be sited on the run receipt and to fetch by run id, because
	 * a decision only exists for a run. That is still true of a decision — and
	 * it stopped being true of the *question*: "would this fire?" is asked in
	 * the composer, and "why did this reply say that?" is asked at the
	 * message. Both are answered by compiling a real turn and projecting it
	 * with the same `explainRetrieval`, so what varies between the three
	 * surfaces is only which turn — which is a prop, not a second reader.
	 *
	 * The levers still work everywhere, because they were never about the run:
	 * they write the entry's own columns.
	 */
	import * as Icons from "@lucide/svelte"
	import { SvelteMap, SvelteSet } from "svelte/reactivity"
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	type Explanation = NonNullable<
		Sockets.Pipelines.RunExplain.Response["explanation"]
	>
	type Row = Sockets.Pipelines.RetrievalRow

	interface Props {
		/** The projection to read. Nothing renders without one. */
		explanation: Explanation | null | undefined
		/** Whether an answer is still on its way. */
		loading?: boolean
		/** The heading, so each surface can name the question it asked. */
		title?: string
		/** The sentence under it. */
		caption?: string
	}

	let {
		explanation,
		loading = false,
		title = "Retrieval",
		caption = "What each candidate was judged on, and what you can do about it."
	}: Props = $props()

	const socket = useTypedSocket()

	/** Which rows are open. A plain Set gives no reactive `.add()` in Svelte 5. */
	const open = new SvelteSet<string>()
	let outcomeFilter = $state<Row["outcome"] | null>(null)
	let search = $state("")
	let showBands = $state(false)
	/**
	 * A lever that has landed since this explanation arrived, keyed
	 * `typeId:id`.
	 *
	 * Kept beside the rows rather than written into them: the explanation is
	 * somebody else's state — a run's, a preview's, a message's — and a child
	 * reaching into it to repaint a button is how one surface ends up
	 * disagreeing with the panel that owns it. The row still shows what the
	 * database last said, which is the point; it just says it from here.
	 */
	const levers = new SvelteMap<string, { constant: boolean; enabled: boolean }>()

	/**
	 * A lever was refused. The entry handlers refuse by throwing, so this is
	 * `register()`'s synthesised `entries:update:error` — and it is shown
	 * rather than swallowed, because the button will otherwise sit at its old
	 * value with no account of why.
	 */
	const showWriteRefusal = (res: { error?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
	}

	/**
	 * A lever landed. The row is patched from the answer rather than from what
	 * was asked for: the handler is what decides, and a button that painted
	 * itself green before the write returned would be the panel disagreeing
	 * with the database — the failure the config view's "every write answers
	 * with the whole view" rule exists to prevent.
	 */
	const onEntryUpdate = (res: { entry?: any }) => {
		const e = res?.entry
		if (!e) return
		levers.set(`${e.typeId}:${e.id}`, {
			constant: !!e.constant,
			enabled: e.enabled !== false
		})
	}

	onMount(() => {
		socket.on("entries:update", onEntryUpdate)
		socket.on("entries:update:error", showWriteRefusal)
	})
	onDestroy(() => {
		socket.off("entries:update", onEntryUpdate)
		socket.off("entries:update:error", showWriteRefusal)
	})

	// A new explanation is a new set of facts: nothing carried over from the
	// last one is true of this one, least of all a lever recorded against a
	// row that may not be in it.
	$effect(() => {
		void explanation
		levers.clear()
		open.clear()
		outcomeFilter = null
	})

	const rows = $derived(explanation?.rows ?? [])
	const counts = $derived({
		included: rows.filter((r) => r.outcome === "included").length,
		excluded: rows.filter((r) => r.outcome === "excluded").length,
		skipped: rows.filter((r) => r.outcome === "skipped").length
	})
	const filtered = $derived(
		rows.filter((r) => {
			if (outcomeFilter && r.outcome !== outcomeFilter) return false
			const q = search.trim().toLowerCase()
			if (!q) return true
			return `${r.title} ${r.sourceLabel} ${r.verdict} ${r.excerpt ?? ""}`
				.toLowerCase()
				.includes(q)
		})
	)

	const OUTCOMES: Array<{ key: Row["outcome"]; label: string }> = [
		{ key: "included", label: "In the prompt" },
		{ key: "excluded", label: "Left out" },
		{ key: "skipped", label: "Never considered" }
	]

	function toggle(key: string) {
		if (open.has(key)) open.delete(key)
		else open.add(key)
	}

	/** The entry's state as it stands: what a lever wrote, else what arrived. */
	function stateOf(entry: NonNullable<Row["entry"]>) {
		return levers.get(`${entry.typeId}:${entry.id}`) ?? entry
	}

	/**
	 * What each stop kind IS, in the words the docs use.
	 *
	 * On the badge's title rather than beside it: the kind is a one-word tag in
	 * a row that is one line most of the time, and the sentence is what somebody
	 * wants once — not on every reply they read.
	 */
	const STOP_KIND: Record<string, string> = {
		format: "From the completion template's own stop strings",
		speaker: "A speaker label from this scene",
		explicit: "A stop sequence set on this step"
	}

	/** Why an entry was held back. One rule, so one sentence per wire. */
	const DROP_REASON: Record<string, string> = {
		chat: "chat wire — the roles carry the structure, so these would only override the model's own stop tokens",
		completion: "held back"
	}

	/** The two levers, written through the verb the lore managers already use. */
	function setEntry(row: Row, patch: { constant?: boolean; enabled?: boolean }) {
		if (!row.entry) return
		socket.emit("entries:update", {
			entry: { id: row.entry.id, typeId: row.entry.typeId, ...patch }
		})
	}
</script>

{#if loading}
	<p class="text-surface-600-400 text-sm">Reading the decisions…</p>
{:else if explanation && (rows.length || explanation.notes.length || explanation.warnings.length || explanation.stops)}
	<!-- A bordered section rather than a second card: every host renders this
	     INSIDE a card of its own — a receipt, a composer tab, a report modal —
	     and the same preset nested in itself reads as a rendering fault rather
	     than as a division. -->
	<section
		class="border-surface-300-700 flex flex-col gap-2 rounded border p-3"
		aria-label={title}
	>
		<div class="flex flex-wrap items-baseline gap-2">
			<h4 class="text-sm font-semibold">{title}</h4>
			<span class="text-surface-600-400 text-xs">
				{caption}
			</span>
		</div>

		{#each explanation.warnings as w (w)}
			<p
				class="preset-tonal-warning flex items-start gap-2 rounded p-2 text-xs"
			>
				<Icons.TriangleAlert size={14} class="mt-0.5 shrink-0" />
				<span>{w}</span>
			</p>
		{/each}

		{#if explanation.notes.length}
			<ul class="text-surface-600-400 flex flex-col gap-0.5 text-xs">
				{#each explanation.notes as n (n)}
					<li>{n}</li>
				{/each}
			</ul>
		{/if}

		<!-- What is eating the room, said before it is tabulated. Level one
		     because it is a finding rather than a reading: the table below
		     has carried these numbers all along and nobody adds up four
		     columns to discover that world lore is taking the prompt. -->
		{#if explanation.budget}
			<p class="text-surface-700-300 flex items-start gap-2 text-xs">
				<Icons.ChartPie
					size={14}
					class="mt-0.5 shrink-0"
					aria-hidden="true"
				/>
				<span>
					{explanation.budget.headline}
					{#if explanation.budget.detail}
						<span class="text-surface-600-400">
							{explanation.budget.detail}
						</span>
					{/if}
				</span>
			</p>
		{/if}

		<!-- What ended the reply, and what was not allowed to (ruling
		     2026-09-10). Level one, and compact: it is one line most of the
		     time, and the two questions it answers — "why did my reply run on"
		     and "why did the sequence I typed do nothing" — have had no answer
		     anywhere in the product until now. -->
		{#if explanation.stops}
			{@const stops = explanation.stops}
			<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
				<span
					class="text-surface-700-300 flex items-center gap-1.5 font-medium"
				>
					<Icons.OctagonMinus
						size={14}
						class="shrink-0"
						aria-hidden="true"
					/>
					Stops
				</span>
				{#if !stops.sent.length && !stops.dropped.length}
					<span class="text-surface-600-400">
						Nothing was sent — this reply could only end on the
						model's own stop tokens or the response limit.
					</span>
				{/if}
				{#each stops.sent as stop (stop.kind + stop.value)}
					<!-- The one that actually fired is the answer to the
					     question, so it is the only thing here that is
					     coloured. Absent on every service but llama.cpp, which
					     is the only one that reports the WORD rather than a
					     reason code — so "not highlighted" never means "did
					     not fire". -->
					<span
						class="{stops.hit === stop.value
							? 'preset-filled-success-500'
							: 'preset-tonal-surface'} inline-flex items-center gap-1 rounded-full px-2 py-0.5"
						title={stops.hit === stop.value
							? `${STOP_KIND[stop.kind]} — this is the one the model stopped on`
							: STOP_KIND[stop.kind]}
					>
						<code class="font-mono">{stop.value}</code>
						<span
							class="text-[0.62rem] tracking-wider uppercase opacity-70"
						>
							{stop.kind}
						</span>
					</span>
				{/each}
				{#each stops.dropped as stop (stop.kind + stop.value)}
					<span
						class="preset-tonal-surface inline-flex items-center gap-1 rounded-full px-2 py-0.5 line-through opacity-50"
						title="{STOP_KIND[stop.kind]} — held back: {DROP_REASON[
							stops.wire
						]}"
					>
						<code class="font-mono">{stop.value}</code>
						<span class="text-[0.62rem] tracking-wider uppercase">
							{stop.kind}
						</span>
					</span>
				{/each}
				{#if stops.dropped.length}
					<span class="text-surface-600-400">
						{DROP_REASON[stops.wire]}
					</span>
				{/if}
			</div>
		{/if}

		{#if !explanation.ranked}
			<p class="text-surface-600-400 text-xs">
				This run recorded no ranking, so there is nothing to explain
				beyond what the arms reported above.
			</p>
		{/if}

		{#if rows.length}
			<div class="flex flex-wrap items-center gap-1.5">
				{#each OUTCOMES as o (o.key)}
					{#if counts[o.key]}
						<button
							type="button"
							class="chip rounded-full px-2.5 py-1 text-xs {outcomeFilter ===
							o.key
								? 'preset-filled-primary-500'
								: 'preset-tonal-surface'}"
							onclick={() =>
								(outcomeFilter =
									outcomeFilter === o.key ? null : o.key)}
						>
							{o.label}
							<span class="opacity-70">{counts[o.key]}</span>
						</button>
					{/if}
				{/each}
				{#if outcomeFilter}
					<button
						type="button"
						class="text-surface-600-400 text-xs underline"
						onclick={() => (outcomeFilter = null)}
					>
						clear
					</button>
				{/if}
				<input
					class="input ml-auto w-48 text-sm"
					placeholder="Find an entry…"
					bind:value={search}
					aria-label="Find an entry in these results"
				/>
			</div>

			<!-- Capped rather than endless: a 200-entry lorebook produces a row
			     for every entry it declined, and whatever this is sitting under
			     should not scroll off the top of the page to say so. -->
			<ul class="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
				{#each filtered as row (row.key)}
					{@const isOpen = open.has(row.key)}
					<li class="preset-tonal-surface rounded">
						<!-- Level one: the medal, what it is, and one sentence. -->
						<button
							type="button"
							class="hover:bg-primary-500/10 flex w-full items-start gap-2 rounded p-2 text-left transition-colors"
							onclick={() => toggle(row.key)}
							aria-expanded={isOpen}
							aria-controls="retrieval-{row.key}"
						>
							<span class="mt-0.5 shrink-0">
								{#if row.outcome === "included"}
									<Icons.Check
										size={15}
										class="text-success-500"
										aria-hidden="true"
									/>
								{:else if row.outcome === "excluded"}
									<Icons.Minus
										size={15}
										class="text-warning-500"
										aria-hidden="true"
									/>
								{:else}
									<Icons.CircleSlash
										size={15}
										class="text-surface-600-400"
										aria-hidden="true"
									/>
								{/if}
							</span>
							<span class="min-w-0 flex-1">
								<span
									class="flex flex-wrap items-baseline gap-x-2 gap-y-1"
								>
									<span class="text-sm font-medium">
										{row.title}
									</span>
									<span
										class="text-surface-600-400 text-[0.68rem] tracking-wider uppercase"
									>
										{row.sourceLabel}
									</span>
									<span
										class="{row.markerKind === 'pinned'
											? 'preset-tonal-primary'
											: row.markerKind === 'none'
												? 'preset-tonal-surface opacity-70'
												: 'preset-tonal-surface'} rounded-full px-2 py-0.5 text-[0.68rem]"
									>
										{row.marker}
									</span>
									<!-- The record and the row disagree, said at
									     level one. A reader who never expands a
									     row must still not read the live title as
									     part of the decision beneath it — which
									     is the whole defect this reports. Absent
									     `provenance` says nothing, and renders
									     nothing: an older receipt carries no
									     fingerprint to check, and silence is the
									     honest answer rather than a reassuring
									     badge nothing verified. -->
									{#if row.provenance === "changed"}
										<span
											class="preset-tonal-warning rounded-full px-2 py-0.5 text-[0.68rem]"
										>
											Edited since
										</span>
									{:else if row.provenance === "deleted"}
										<span
											class="preset-tonal-error rounded-full px-2 py-0.5 text-[0.68rem]"
										>
											Gone since
										</span>
									{/if}
								</span>
								<span
									class="text-surface-700-300 mt-0.5 block text-xs"
								>
									{row.verdict}
								</span>
							</span>
							<span
								class="text-surface-600-400 mt-0.5 shrink-0 text-xs"
							>
								{#if row.tokens != null}
									{row.tokens} tok
								{/if}
							</span>
							<Icons.ChevronDown
								size={14}
								class="text-surface-600-400 mt-1 shrink-0 transition-transform {isOpen
									? 'rotate-180'
									: ''}"
								aria-hidden="true"
							/>
						</button>

						<!-- Level two, and the last one: the named criteria,
						     the arithmetic, and the levers. -->
						{#if isOpen}
							<div
								id="retrieval-{row.key}"
								class="border-surface-300-700/50 flex flex-col gap-2 border-t px-2 py-2"
							>
								<!-- What happened to the entry, before anything
								     it says. The excerpt below is the recorded
								     text either way — it is read off the
								     candidate the run published — so this
								     sentence is what tells a reader the entry
								     they would go and open is no longer that
								     text. -->
								{#if row.provenanceNote}
									<p class="text-warning-700-300 text-xs">
										{row.provenanceNote}
									</p>
									{#if row.currentTitle}
										<p
											class="text-surface-600-400 text-xs"
										>
											Now titled “{row.currentTitle}”.
										</p>
									{/if}
								{/if}
								{#if row.excerpt}
									<p
										class="text-surface-600-400 text-xs italic"
									>
										{#if row.provenance === "changed" || row.provenance === "deleted"}
											<span class="not-italic"
												>As it read then:
											</span>
										{/if}“{row.excerpt}”
									</p>
								{/if}
								{#if row.criteria.length}
									<ul class="flex flex-col gap-1">
										{#each row.criteria as c (c.label)}
											<li
												class="flex flex-wrap items-baseline gap-x-2 text-xs"
											>
												<span class="font-medium">
													{c.label}
												</span>
												<span
													class="text-surface-600-400"
												>
													— {c.detail}
												</span>
												{#if c.value != null}
													<span
														class="text-surface-600-400 font-mono text-[0.68rem]"
													>
														{c.value.toFixed(3)}
													</span>
												{/if}
											</li>
										{/each}
									</ul>
								{:else}
									<p class="text-surface-600-400 text-xs">
										No signal fired for this one.
									</p>
								{/if}

								{#if row.why?.length || row.reason}
									<p
										class="text-surface-600-400 font-mono text-[0.68rem]"
									>
										{[...(row.why ?? []), row.reason]
											.filter(Boolean)
											.join(" · ")}
										{#if row.nodeKey}
											<span class="opacity-70">
												· {row.nodeKey}
											</span>
										{/if}
									</p>
								{/if}

								{#if row.entry}
									<!-- What the entry says NOW: the answer to
									     the last write if there has been one,
									     and what arrived with the explanation
									     otherwise. -->
									{@const st = stateOf(row.entry)}
									<div class="flex flex-wrap gap-1.5">
										<button
											type="button"
											class="btn btn-sm {st.constant
												? 'preset-filled-primary-500'
												: 'preset-tonal-surface'}"
											title="An always-included entry goes in every time, without being judged"
											onclick={() =>
												setEntry(row, {
													constant: !st.constant
												})}
										>
											<Icons.Pin size={13} />
											{st.constant
												? "Always included"
												: "Always include"}
										</button>
										<button
											type="button"
											class="btn btn-sm {st.enabled
												? 'preset-tonal-surface'
												: 'preset-filled-warning-500'}"
											title="A never-included entry is left out every time"
											onclick={() =>
												setEntry(row, {
													enabled: !st.enabled
												})}
										>
											<Icons.Ban size={13} />
											{st.enabled
												? "Never include"
												: "Never included"}
										</button>
									</div>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			{#if explanation.omitted}
				<p class="text-surface-600-400 text-xs">
					{explanation.omitted} further candidate(s) are not listed.
				</p>
			{/if}
		{/if}

		{#if explanation.bands.length}
			<!-- The bands answer a different question from any one row — which
			     control to move — so they are here and closed, rather than
			     leading with an arithmetic table. -->
			<div>
				<button
					type="button"
					class="text-surface-600-400 text-xs underline"
					onclick={() => (showBands = !showBands)}
					aria-expanded={showBands}
					aria-controls="retrieval-bands"
				>
					{showBands ? "Hide" : "Show"} where the budget went
				</button>
				{#if showBands}
					<div id="retrieval-bands" class="mt-2 overflow-x-auto">
						<table
							class="w-full min-w-[560px] border-collapse text-xs"
						>
							<thead>
								<tr
									class="text-surface-600-400 border-surface-300-700 border-b text-left text-[0.68rem] tracking-wider uppercase"
								>
									<th class="px-2 py-1.5">Source</th>
									<th class="px-2 py-1.5 text-right">
										Tokens
									</th>
									<th class="px-2 py-1.5 text-right">
										Share of what went in
									</th>
									<th class="px-2 py-1.5 text-right">
										Entries
									</th>
									<th class="px-2 py-1.5 text-right">
										Turned away
									</th>
								</tr>
							</thead>
							<tbody>
								{#each explanation.bands as b (b.source)}
									<tr
										class="border-surface-300-700/50 border-b last:border-b-0"
									>
										<td class="px-2 py-1.5">{b.label}</td>
										<td
											class="px-2 py-1.5 text-right whitespace-nowrap"
										>
											{b.used} of {b.allocated}
										</td>
										<!-- Absent share renders as a dash, not
										     as 0%: nothing was spent, so the
										     division never happened, and a
										     column of zeroes would be this
										     table claiming it did. -->
										<td class="px-2 py-1.5 text-right">
											{#if b.share != null}
												<span
													class="flex items-center justify-end gap-1.5"
												>
													<span
														class="bg-surface-300-700 h-1.5 w-12 overflow-hidden rounded-full"
														aria-hidden="true"
													>
														<span
															class="bg-primary-500 block h-full rounded-full"
															style="width: {Math.round(
																b.share * 100
															)}%"
														></span>
													</span>
													<span
														class="w-9 text-right whitespace-nowrap"
													>
														{Math.round(
															b.share * 100
														)}%
													</span>
												</span>
											{:else}
												—
											{/if}
										</td>
										<td
											class="px-2 py-1.5 text-right whitespace-nowrap"
										>
											{b.entries} of {b.cap}
										</td>
										<td class="px-2 py-1.5 text-right">
											{b.dropped || "—"}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{/if}
	</section>
{/if}
