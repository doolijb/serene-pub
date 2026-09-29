<script lang="ts">
	/**
	 * "Would this be read in?" — asked and answered without leaving the editor.
	 *
	 * The six steps this replaces (save, open a session, send a message, find
	 * the run, open its receipt, read the retrieval panel) all existed to
	 * manufacture a turn, because a retrieval decision only exists for one.
	 * `pipelines:previewRetrieval` manufactures it server-side and answers with
	 * the **whole explanation** the receipt's retrieval panel renders, so the
	 * two surfaces cannot disagree about what a decision means.
	 *
	 * ⚠ **The whole turn, not this entry's row.** "Rank 2 of 12" is a place
	 * among the entries the turn judged and "4 entries ahead of the ceiling" is
	 * a share of what the turn was given, and neither figure exists in a payload
	 * carrying one row — which is why this asks the same verb the composer's
	 * "What would fire now" asks and takes its own line out of the answer.
	 *
	 * Three rules it keeps:
	 *
	 * · **Explicit, never live.** A turn is a real pipeline run with a real
	 *   embedding call in it. It happens when the author presses the button and
	 *   at no other time — no debounce, no `$effect` that watches the content.
	 * · **A session is part of the question.** An entry is not read in in
	 *   the abstract, so the picker is not a refinement, it is the other half of
	 *   what was asked. It offers the sessions bound to *this* lorebook,
	 *   newest first, and defaults to the newest — the one the author was most
	 *   likely just reading.
	 * · **"No" always arrives with a reason.** The verdict sentence, the
	 *   criteria the ranker weighed, the engine's own arithmetic, and — when
	 *   nothing reported on the entry at all — the mechanism-level notes that
	 *   say how far the scan looked. A bare "it was not read in" is the thing
	 *   this exists to fix.
	 *
	 * ⚠ **It reports on the SAVED entry.** The pipeline gathers lore out of the
	 * database, so this is offered from the view of a stored row and never from
	 * the editor, where the verdict would be about text the run never read.
	 *
	 * Teach it writes the two levers that exist — `constant` is "always" and
	 * `enabled: false` is "never", both real columns with real editors — and
	 * says so about the third rather than pretending to record it.
	 */
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import type { EntryTypeId } from "$lib/shared/entries/types"
	import {
		signalFactsFrom,
		signalRow,
		signalsResult
	} from "$lib/client/lorebooks/editor/signals"
	import type { RunExplanation } from "$lib/client/lorebooks/editor/readIn"

	interface Props {
		/** The stored entry being asked about. */
		entryId: number
		typeId: EntryTypeId
		/** Only sessions reading this lorebook can answer. */
		lorebookId: number
		/** Whether the entry is switched on — an "off" entry explains itself. */
		enabled?: boolean
		/** Whether it is already pinned, so "always" says what it would do. */
		constant?: boolean
	}

	let {
		entryId,
		typeId,
		lorebookId,
		enabled = true,
		constant = false
	}: Props = $props()

	const socket = useTypedSocket()
	const interest = getInterestContext()
	/** Unique per instance: two lorebook panels can be open at once. */
	const uid = $props.id()

	type Session = Sockets.Sessions.List.Response["sessionList"][number]

	let sessions = $state<Session[]>([])
	let sessionsLoaded = $state(false)
	let sessionId = $state<number | null>(null)
	let running = $state(false)
	let explanation = $state<RunExplanation | null>(null)
	/** The server's own sentence when it refused, shown in place. */
	let refusal = $state<string | null>(null)
	/**
	 * Which session the question in flight named.
	 *
	 * Held apart from `sessionId` because the picker's value is the *next*
	 * question and this is the one outstanding — a list refresh that retires
	 * the selected session mid-run must not make the answer unmatchable.
	 */
	let asked = $state<number | null>(null)

	const onSessions = (res: Sockets.Sessions.List.Response) => {
		// Newest first is the server's order (`updatedAt` descending), kept.
		sessions = (res.sessionList ?? []).filter(
			(s) => s.lorebookId === lorebookId
		)
		sessionsLoaded = true
		// Default to the most recent one, and leave a deliberate pick alone —
		// a background list refresh must not move the author's choice.
		if (sessionId == null || !sessions.some((s) => s.id === sessionId))
			sessionId = sessions[0]?.id ?? null
	}

	/**
	 * The turn, explained.
	 *
	 * ⚠ **Only what this panel asked for.** The answer echoes the
	 * session and nothing else, and the channel is shared with the
	 * composer's own "What would fire now" — whose answer is about the draft
	 * sitting in its box rather than about the session as it stands. So
	 * an answer arriving while this panel is not waiting is somebody else's.
	 */
	const onAnswer = (res: Sockets.Pipelines.PreviewRetrieval.Response) => {
		if (!running) return
		if (res.error) {
			running = false
			refusal = res.error
			explanation = null
			return
		}
		if (res.sessionId !== asked) return
		running = false
		refusal = null
		explanation = res.explanation ?? null
	}

	/** The run threw somewhere we did not anticipate. Stop waiting, say so. */
	const onRefusal = (res: { error?: string }) => {
		if (!running) return
		running = false
		explanation = null
		refusal = res?.error || "The test could not be run."
	}

	/**
	 * The session picker's list, asked for and listened for in one: the
	 * interest sync naming `sessions:list` leaves ahead of the request, so the
	 * handler answering it already sees the key. BARE — the list is this user's
	 * own and has no session to be scoped to.
	 */
	$effect(() => interest.requestWithInterest("sessions:list", {}, onSessions))

	/**
	 * The answer, held for as long as the panel is: the request is a button
	 * press (`run` below), not a mount, so the interest stays and the emit
	 * stays where the press is. BARE — neither event is in `SCOPED_EVENTS`,
	 * and `onAnswer`'s own `running`/`asked` checks stay the filter.
	 *
	 * The refusal is never gated (plan ruling 2 — an error is not an output to
	 * skip), but the registry is the only listener path, so it is declared too.
	 */
	interest.useInterest<"pipelines:previewRetrieval">(
		"pipelines:previewRetrieval",
		onAnswer
	)
	interest.useInterest<"pipelines:previewRetrieval:error">(
		"pipelines:previewRetrieval:error",
		onRefusal
	)

	function run() {
		if (sessionId == null || running) return
		explanation = null
		refusal = null
		asked = sessionId
		running = true
		// No draft: the question is what this session would read in as
		// it stands, which is the turn the author is about to provoke rather
		// than one they are halfway through typing.
		socket.emit("pipelines:previewRetrieval", {
			sessionId,
			content: ""
		} satisfies Sockets.Pipelines.PreviewRetrieval.Params)
	}

	/**
	 * Teach it — the same `entries:update` the editor writes.
	 *
	 * A patch of one column: the handler writes what the payload names and
	 * nothing else, so this never sends a whole row back over what is being
	 * typed in the editor beside it.
	 */
	function teach(patch: { constant?: boolean; enabled?: boolean }) {
		socket.emit("entries:update", {
			entry: { id: entryId, typeId, ...patch } as any
		})
	}

	const row = $derived(
		explanation ? signalRow(explanation, entryId) : undefined
	)
	const facts = $derived(
		explanation ? signalFactsFrom(explanation, { entryId, enabled }) : null
	)
	const result = $derived(facts ? signalsResult(facts) : null)
</script>

<section
	class="border-surface-300-700 flex flex-col gap-2 rounded border p-3"
	aria-label="Would this entry be read in?"
	data-lore-signals
>
	{#if !sessionsLoaded}
		<p class="text-surface-600-400 text-xs">Looking for sessions…</p>
	{:else if !sessions.length}
		<p class="text-surface-600-400 text-xs">
			No session uses this lorebook yet. An entry is only read in
			against a session, so there is nothing to test it on until one
			does.
		</p>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-sm">Against</span>
			<Select
				label="Session to test against"
				labelHidden
				class="min-w-0 flex-1 text-sm"
				disabled={running}
				options={sessions.map((s) => ({
					value: String(s.id),
					label: s.name || "Untitled session"
				}))}
				bind:value={
					() => (sessionId == null ? "" : String(sessionId)),
					(v) => (sessionId = v ? Number(v) : null)
				}
			/>
			<span class="text-surface-600-400 text-xs">newest turn</span>
			<button
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				onclick={run}
				disabled={running || sessionId == null}
				type="button"
			>
				{#if running}
					<Icons.Loader2 size={14} class="animate-spin" />
					Running…
				{:else}
					<Icons.FlaskConical size={14} /> Test
				{/if}
			</button>
		</div>

		{#if running}
			<p class="text-surface-600-400 text-xs">
				Compiling the turn this session would send next. Nothing is
				sent and nothing is saved.
			</p>
		{/if}

		{#if refusal}
			<p
				class="preset-tonal-warning flex items-start gap-2 rounded p-2 text-xs"
			>
				<Icons.TriangleAlert size={14} class="mt-0.5 shrink-0" />
				<span>{refusal}</span>
			</p>
		{:else if result}
			<div class="flex flex-col gap-2">
				<!-- Level one: the whole answer as one sentence, in content
				     vocabulary. Never omitted, and never without its reason. -->
				<p class="text-sm" data-lore-signals-result>{result}</p>

				{#if row?.verdict && facts?.read}
					<p class="text-surface-600-400 text-xs">{row.verdict}</p>
				{/if}

				{#if row?.criteria?.length}
					<ul class="flex flex-col gap-0.5 text-xs">
						{#each row.criteria as c (c.label)}
							<li>
								<span class="font-semibold">{c.label}:</span>
								{c.detail}
								{#if c.value !== undefined}
									<span class="text-surface-600-400">
										({c.value.toFixed(3)})
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<!-- The engine's own arithmetic, written at the decision site. -->
				{#if row?.why?.length}
					<ul
						class="text-surface-600-400 flex flex-col gap-0.5 text-xs"
					>
						{#each row.why as w (w)}
							<li>{w}</li>
						{/each}
					</ul>
				{/if}

				{#each explanation?.warnings ?? [] as w (w)}
					<p
						class="preset-tonal-warning flex items-start gap-2 rounded p-2 text-xs"
					>
						<Icons.TriangleAlert
							size={14}
							class="mt-0.5 shrink-0"
						/>
						<span>{w}</span>
					</p>
				{/each}

				<!-- The half of the trail no row can carry: how deep the scan
				     went, whether an embedding model was there. It answers a
				     missing row, so it is shown whenever there isn't one. -->
				{#if explanation?.notes?.length && (!row || row.outcome !== "included")}
					<ul
						class="text-surface-600-400 flex flex-col gap-0.5 text-xs"
					>
						{#each explanation.notes as n (n)}
							<li>{n}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/if}

	<div class="border-surface-300-700 flex flex-col gap-1 border-t pt-2">
		<span class="text-xs font-semibold">Teach it</span>
		<div class="flex flex-wrap gap-1">
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				disabled={constant}
				title={constant
					? "This entry is already pinned"
					: "Pin it, so every turn reads it in"}
				onclick={() => teach({ constant: true })}
			>
				Always read this in
			</button>
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				disabled={!enabled}
				title={enabled
					? "Switch it off, so no turn reads it in"
					: "This entry is already off"}
				onclick={() => teach({ enabled: false })}
			>
				Never read this in
			</button>
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				disabled
				title="Feedback is not collected yet"
			>
				This ranking is wrong
			</button>
		</div>
		<p class="text-surface-600-400 text-[11px]">
			Feedback is not collected yet.
		</p>
	</div>
</section>
