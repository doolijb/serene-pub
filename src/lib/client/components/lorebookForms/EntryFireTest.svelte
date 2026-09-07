<script lang="ts">
	/**
	 * "Would this entry fire?" — asked and answered without leaving the editor.
	 *
	 * The six steps this replaces (save, open a session, send a message, find
	 * the run, open its receipt, read the retrieval panel) all existed to
	 * manufacture a turn, because a retrieval decision only exists for one.
	 * `entries:testRetrieval` manufactures it server-side and answers with the
	 * **same row** the receipt's retrieval panel renders, so the two surfaces
	 * cannot disagree about what a decision means.
	 *
	 * Three rules it keeps:
	 *
	 * · **Explicit, never live.** A turn is a real pipeline run with a real
	 *   embedding call in it. It happens when the author presses the button and
	 *   at no other time — no debounce, no `$effect` that watches the content.
	 * · **A conversation is part of the question.** An entry does not fire in
	 *   the abstract, so the picker is not a refinement, it is the other half of
	 *   what was asked. It offers the conversations bound to *this* lorebook,
	 *   newest first, and defaults to the newest — the one the author was most
	 *   likely just reading.
	 * · **"No" always arrives with a reason.** The verdict sentence, the
	 *   criteria the ranker weighed, the engine's own arithmetic, and — when
	 *   nothing reported on the entry at all — the mechanism-level notes that
	 *   say how far the scan looked. A bare "it did not fire" is the thing this
	 *   exists to fix.
	 *
	 * ⚠ **It reports on the SAVED entry.** The pipeline gathers lore out of the
	 * database, so this is offered from the view of a stored row and never from
	 * the editor, where the verdict would be about text the run never read.
	 */
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import type { EntryTypeId } from "$lib/shared/entries/types"

	interface Props {
		/** The stored entry being asked about. */
		entryId: number
		typeId: EntryTypeId
		/** Only conversations reading this lorebook can answer. */
		lorebookId: number
		/** Whether the entry is switched on — an "off" entry explains itself. */
		enabled?: boolean
	}

	let { entryId, typeId, lorebookId, enabled = true }: Props = $props()

	const socket = useTypedSocket()
	/** Unique per instance: two lorebook panels can be open at once. */
	const uid = $props.id()

	type Session = Sockets.Sessions.List.Response["sessionList"][number]
	type Answer = Sockets.Entries.TestRetrieval.Response

	let sessions = $state<Session[]>([])
	let sessionsLoaded = $state(false)
	let sessionId = $state<number | null>(null)
	let running = $state(false)
	let answer = $state<Answer | null>(null)
	/**
	 * Which conversation the question in flight named.
	 *
	 * Held apart from `sessionId` because the picker's value is the *next*
	 * question and this is the one outstanding — a list refresh that retires
	 * the selected conversation mid-run must not make the answer unmatchable.
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

	const onAnswer = (res: Answer) => {
		// The question named an entry and a conversation and the answer echoes
		// all three, so a reply for a different one is dropped rather than
		// shown under this heading — the channel is shared by every open
		// manager, and by every earlier ask this one superseded.
		if (
			res.id !== entryId ||
			res.typeId !== typeId ||
			res.sessionId !== asked
		)
			return
		running = false
		answer = res
	}

	/** The run threw somewhere we did not anticipate. Stop waiting, say so. */
	const onRefusal = (res: { error?: string }) => {
		if (!running) return
		running = false
		answer = {
			id: entryId,
			typeId,
			sessionId: asked ?? 0,
			error: res?.error || "The test could not be run."
		}
	}

	onMount(() => {
		socket.on("sessions:list", onSessions)
		socket.on("entries:testRetrieval", onAnswer)
		socket.on("entries:testRetrieval:error", onRefusal)
		socket.emit("sessions:list", {})
	})
	onDestroy(() => {
		socket.off("sessions:list", onSessions)
		socket.off("entries:testRetrieval", onAnswer)
		socket.off("entries:testRetrieval:error", onRefusal)
	})

	function run() {
		if (sessionId == null || running) return
		answer = null
		asked = sessionId
		running = true
		socket.emit("entries:testRetrieval", { id: entryId, typeId, sessionId })
	}

	const row = $derived(answer?.row)

	/**
	 * The four states, and the fourth is not a weaker third.
	 *
	 * `included`/`excluded`/`skipped` are the run's own outcomes; `unreported`
	 * is the absence of a row, which means no mechanism offered this entry to
	 * the ranker *and* none declined it by name. Collapsing it into "no" would
	 * be this panel asserting a decision nobody made.
	 */
	const verdict = $derived(
		!answer || answer.error ? null : (row?.outcome ?? "unreported")
	)

	const HEADLINE: Record<string, { label: string; preset: string }> = {
		included: { label: "It fired", preset: "preset-filled-success-500" },
		excluded: { label: "Left out", preset: "preset-filled-warning-500" },
		skipped: {
			label: "Never considered",
			preset: "preset-filled-surface-400-600"
		},
		unreported: {
			label: "Nothing reported on it",
			preset: "preset-filled-surface-400-600"
		}
	}
</script>

<section
	class="border-surface-300-700 flex flex-col gap-2 rounded border p-3"
	aria-label="Would this entry fire?"
>
	<div class="flex flex-wrap items-baseline gap-2">
		<h4 class="text-sm font-semibold">Would this fire?</h4>
		<span class="text-surface-600-400 text-xs">
			Run the retrieval against a conversation without sending anything.
		</span>
	</div>

	{#if !sessionsLoaded}
		<p class="text-surface-600-400 text-xs">Looking for conversations…</p>
	{:else if !sessions.length}
		<p class="text-surface-600-400 text-xs">
			No conversation uses this lorebook yet. An entry only fires against
			a conversation, so there is nothing to test it on until one does.
		</p>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<label class="sr-only" for="{uid}-session">
				Conversation to test against
			</label>
			<select
				id="{uid}-session"
				class="select compact min-w-0 flex-1 text-sm"
				bind:value={sessionId}
				disabled={running}
			>
				{#each sessions as s (s.id)}
					<option value={s.id}>{s.name || "Untitled Session"}</option>
				{/each}
			</select>
			<button
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				onclick={run}
				disabled={running || sessionId == null}
				type="button"
			>
				{#if running}
					<Icons.LoaderCircle size={14} class="animate-spin" />
					Running…
				{:else}
					<Icons.FlaskConical size={14} /> Test
				{/if}
			</button>
		</div>

		{#if running}
			<p class="text-surface-600-400 text-xs">
				Compiling the turn this conversation would send next. Nothing is
				sent and nothing is saved.
			</p>
		{/if}

		{#if answer?.error}
			<p
				class="preset-tonal-warning flex items-start gap-2 rounded p-2 text-xs"
			>
				<Icons.TriangleAlert size={14} class="mt-0.5 shrink-0" />
				<span>{answer.error}</span>
			</p>
		{:else if verdict}
			<div class="flex flex-col gap-2">
				<div class="flex flex-wrap items-center gap-2">
					<span
						class="{HEADLINE[verdict]
							.preset} rounded px-2 py-1 text-xs font-semibold"
					>
						{HEADLINE[verdict].label}
					</span>
					{#if row?.marker}
						<span
							class="preset-tonal-surface rounded px-2 py-1 text-xs"
						>
							{row.marker}
						</span>
					{/if}
					{#if row?.score !== undefined}
						<span class="text-surface-600-400 text-xs">
							score {row.score.toFixed(3)}
						</span>
					{/if}
					{#if row?.tokens !== undefined}
						<span class="text-surface-600-400 text-xs">
							{row.tokens} tokens
						</span>
					{/if}
				</div>

				<!-- Why. Never omitted: a verdict with no reason is the defect
				     this panel exists to remove. -->
				<p class="text-sm">
					{#if row}
						{row.verdict}
					{:else if !enabled}
						No mechanism reported on this entry — it is switched
						off, so nothing offered it to the ranker.
					{:else if answer?.ranked}
						No mechanism reported on this entry. It was neither
						offered to the ranker nor declined by name — nothing
						matched it, and nothing named it as a miss either.
					{:else}
						This turn ranked nothing at all, so there is no decision
						to report.
					{/if}
				</p>

				{#if row?.criteria?.length}
					<ul class="flex flex-col gap-0.5 text-xs">
						{#each row.criteria as c (c.label)}
							<li>
								<span class="font-semibold">{c.label}</span>
								—
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

				{#each answer?.warnings ?? [] as w (w)}
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
				{#if answer?.notes?.length && (!row || row.outcome !== "included")}
					<ul
						class="text-surface-600-400 flex flex-col gap-0.5 text-xs"
					>
						{#each answer.notes as n (n)}
							<li>{n}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/if}
</section>
