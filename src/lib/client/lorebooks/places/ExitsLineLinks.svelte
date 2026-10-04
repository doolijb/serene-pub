<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy } from "svelte"
	import { SvelteMap } from "svelte/reactivity"
	import { normalizeName } from "@serene-pub/sdk"
	import { isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { exitsLineOf, parseExitsLine } from "$lib/shared/lorebooks/exitsLine"
	import type { PoolItem } from "../poolFilter"
	import type { BookRelationships } from "../relationships.svelte"
	import { createLinkParams } from "../graphs/linkDraft"
	import {
		exitsLineDraft,
		exitsLineLinks,
		isOffered,
		isTickedByDefault,
		type ExitsLineLink,
		type ExitsLineTally
	} from "./exitsLineLinks"
	import type { PlaceLinkRow } from "./placeLinks"

	/**
	 * **Read links from the Exits line** — the confirm view (plan
	 * places-graph §11, B7).
	 *
	 * Lists every signpost a room's prose `Exits:` line names, each said as
	 * the link it would be, found by the one room rule and judged against the
	 * links that stand (`exitsLineLinks`): one a link already says is shown
	 * and not offered; one to a place another link joins is offered unticked;
	 * a name no place answers to is offered as a new place, unticked. Nothing
	 * is written until the person presses the confirm button, and then one
	 * write at a time through the one store — a create's reply is matched by
	 * its ends, and its failure by nothing, so two in flight could take each
	 * other's refusal.
	 *
	 * **Ticks follow the judgement** until the person ticks or unticks a row
	 * themselves: a signpost that stops being ready as links land (the
	 * store's list, a link drawn on the canvas) loses a tick nobody gave it.
	 * A tick, a refusal and a place already made are keyed by the signpost
	 * itself, so they survive the pool gaining the place made for it.
	 *
	 * **Closing stops the run** — Cancel, **Link a place**, or the editor
	 * going away: the signposts not yet sent are never sent. A write already
	 * sent cannot be called back; it is counted when it lands. What the
	 * opening wrote goes to `onTally` each time it changes, so the Links list
	 * can say it once the view is gone.
	 */
	interface Props {
		/** The place whose Exits line it is. */
		place: { id: number; name: string }
		lorebookId: number
		relationships: BookRelationships
		/** The place's body as the editor holds it. */
		content: string
		/** The book's rows on the line being read. */
		pool: readonly PoolItem[]
		/** This place's Links rows: what is already linked. */
		rows: readonly PlaceLinkRow[]
		/** The line being read; each link is drawn on it (null is main). */
		branchId: number | null
		/** What a link written here is dated by, as **Link a place** dates one. */
		historyEntryId: number | null
		/** Writes a new place by name; absent, a name no place answers is only listed. */
		createPlace?: (name: string) => Promise<{ id: number; name: string }>
		/** Closes the view. A run still writing is stopped first. */
		onClose: () => void
		/**
		 * What this opening has written, each time that changes — also after
		 * the view has closed, when a write already sent lands or fails.
		 */
		onTally?: (tally: ExitsLineTally) => void
	}

	let {
		place,
		lorebookId,
		relationships,
		content,
		pool,
		rows,
		branchId,
		historyEntryId,
		createPlace,
		onClose,
		onTally
	}: Props = $props()

	const uid = $props.id()

	let line = $derived(exitsLineOf(content) ?? "")
	let links = $derived(
		exitsLineLinks(parseExitsLine(content), { place, pool, rows })
	)
	/**
	 * The store has read this place's links, so the judgement holds. Before
	 * then every signpost reads as ready; the action is not offered until
	 * then, and a store that fails while the view is open stops the confirm.
	 */
	let storeReady = $derived(relationships.loaded && !relationships.error)

	/** The person's own ticks and unticks, by signpost; the rest follow `isTickedByDefault`. */
	const choices = new SvelteMap<string, boolean>()
	/** New places already made, by name — so a retry links them, never makes two. */
	const made = new SvelteMap<string, { id: number; name: string }>()
	/** Why a signpost could not be linked, by its key. */
	const errors = new SvelteMap<string, string>()
	let writing = $state(false)
	let attempt = 0
	/**
	 * A run is writing — plain, not `$state`: a teardown reads `$state` as it
	 * stood before the change that closed the view, so `writing` would still
	 * say so after Cancel had stopped the run, and the stop would count twice.
	 */
	let running = false
	/** This opening's tally, and the running write's size and progress. */
	const tally: ExitsLineTally = { linked: 0, left: 0 }
	let queued = 0
	let started = 0

	const report = () => onTally?.({ ...tally })

	const isTicked = (link: ExitsLineLink) =>
		choices.get(link.key) ?? isTickedByDefault(link)

	/** A box to tick: offered, and a new place only when one can be made. */
	const tickable = (link: ExitsLineLink) =>
		isOffered(link) && (link.place !== null || !!createPlace)

	let chosen = $derived(
		links.filter((link) => tickable(link) && isTicked(link))
	)
	/** A place still to be made: the confirm says it creates as well as links. */
	let creates = $derived(
		chosen.some((link) => !link.place && !made.has(normalizeName(link.written)))
	)
	let confirmLabel = $derived(
		chosen.length === 0
			? "Link"
			: creates
				? `Create and link ${chosen.length}`
				: `Link ${chosen.length}`
	)
	let confirmProblem = $derived(
		!storeReady
			? "This place's links could not be read, so nothing is linked from here."
			: chosen.length === 0
				? "Tick a way to link."
				: null
	)

	function toggle(link: ExitsLineLink, on: boolean) {
		choices.set(link.key, on)
		errors.delete(link.key)
	}

	const failure = (err: unknown) =>
		isReplyTimeout(err)
			? "The server did not answer. This one was not linked; try again."
			: err instanceof Error
				? err.message
				: "This one could not be linked."

	/** The place a signpost leads to, made first when it is new. */
	async function farEnd(
		link: ExitsLineLink
	): Promise<{ id: number; name: string } | null> {
		if (link.place) return link.place
		const key = normalizeName(link.written)
		const known = made.get(key)
		if (known) return known
		if (!createPlace) return null
		const fresh = await createPlace(link.written.trim())
		made.set(key, fresh)
		return fresh
	}

	/**
	 * Write the ticked signposts, one at a time, and close when every one
	 * went through. A refusal stays on its row; the rest are written. A stop
	 * mid-run leaves the rest unsent; the write in flight is counted when it
	 * lands or fails.
	 */
	async function confirm() {
		if (writing || confirmProblem) return
		const run = ++attempt
		const stopped = () => run !== attempt
		const queue = [...chosen]
		writing = running = true
		errors.clear()
		queued = queue.length
		started = 0
		for (const link of queue) {
			started++
			try {
				const to = await farEnd(link)
				if (stopped()) {
					tally.left++
					report()
					return
				}
				if (!to) continue
				await relationships.create(
					createLinkParams(
						lorebookId,
						exitsLineDraft(place, to, link.signpost, historyEntryId),
						branchId
					)
				)
				tally.linked++
				report()
				if (stopped()) return
				choices.set(link.key, false)
			} catch (err) {
				if (stopped()) {
					tally.left++
					report()
					return
				}
				errors.set(link.key, failure(err))
			}
		}
		writing = running = false
		if (errors.size === 0) onClose()
	}

	/** Stop the run: what is not yet sent is never sent. */
	function stop() {
		if (!running) return
		attempt++
		writing = running = false
		tally.left += queued - started
		report()
	}

	function cancel() {
		stop()
		onClose()
	}

	// However the view closes — Link a place, the editor going away — the
	// run stops with it.
	onDestroy(stop)

	const NOTE: Record<ExitsLineLink["state"], string> = {
		ready: "",
		linked: "Already linked",
		joined: "Linked another way",
		unresolved: "New place",
		here: "This place"
	}

	/** The notes a row's box is described by. */
	const describedBy = (link: ExitsLineLink, id: string) =>
		[
			link.state !== "ready" ? `${id}-note` : "",
			link.namesakes.length ? `${id}-namesakes` : ""
		]
			.filter(Boolean)
			.join(" ") || undefined
</script>

<div
	id="{uid}-exits"
	class="bg-surface-100-900 border-surface-200-800 flex flex-col gap-2 rounded-lg border p-3 text-sm"
	role="group"
	aria-labelledby="{uid}-exits-title"
	data-exits-links
>
	<p id="{uid}-exits-title" class="font-semibold">Links from the Exits line</p>
	<p
		class="border-surface-300-700 text-surface-700-300 border-l-2 pl-2 text-xs break-words"
		data-exits-line
	>
		<span class="font-medium">Exits:</span>
		{line}
	</p>

	{#if links.length === 0}
		<p class="text-surface-600-400 text-xs" data-exits-none>
			The line names no way out to read. Write each as a way and the room it
			leads to, with an arrow: <span class="font-mono">north → The Drowned Hall</span>.
		</p>
	{:else}
		<ul class="flex flex-col gap-1.5">
			{#each links as link, index (link.key)}
				{@const id = `${uid}-exit-${index}`}
				{@const error = tickable(link) ? errors.get(link.key) : undefined}
				<li
					class="border-surface-200-800 flex flex-col gap-1 rounded-md border p-2 {tickable(
						link
					)
						? ''
						: 'opacity-80'}"
					data-exits-link
					data-exits-state={link.state}
				>
					<div class="flex items-start gap-2">
						{#if tickable(link)}
							<input
								{id}
								class="checkbox mt-0.5 shrink-0"
								type="checkbox"
								checked={isTicked(link)}
								disabled={writing}
								aria-describedby={describedBy(link, id)}
								onchange={(e) => toggle(link, e.currentTarget.checked)}
							/>
							<label for={id} class="min-w-0 flex-1" data-exits-sentence>
								{link.sentence}
							</label>
						{:else}
							{#if link.state === "linked"}
								<Icons.Check
									size={14}
									class="text-success-600-400 mt-0.5 shrink-0"
									aria-hidden="true"
								/>
							{:else}
								<Icons.Minus
									size={14}
									class="text-surface-600-400 mt-0.5 shrink-0"
									aria-hidden="true"
								/>
							{/if}
							<span class="min-w-0 flex-1" data-exits-sentence>
								{link.sentence}
							</span>
						{/if}
						{#if NOTE[link.state]}
							<span
								class="badge {link.state === 'linked'
									? 'preset-tonal-success'
									: 'preset-tonal-surface'} shrink-0 text-[11px]"
							>
								{NOTE[link.state]}
							</span>
						{/if}
					</div>
					{#if link.state === "joined" && link.standing}
						<p id="{id}-note" class="text-surface-600-400 pl-6 text-xs">
							{link.standing.later ? "Linked later:" : "Linked now:"}
							{link.standing.sentence}
							{#if link.standing.later}
								<span class="badge preset-tonal-surface ml-1 text-[11px]">
									{link.standing.later}
								</span>
							{/if}
						</p>
					{:else if link.state === "unresolved"}
						<p id="{id}-note" class="text-surface-600-400 pl-6 text-xs">
							No place on this line is called “{link.written}”.{createPlace
								? " Tick it to create the place and link it."
								: ""}
						</p>
					{:else if link.state === "here"}
						<p id="{id}-note" class="text-surface-600-400 pl-6 text-xs">
							That is {place.name} itself.
						</p>
					{/if}
					{#if link.namesakes.length && tickable(link)}
						<p
							id="{id}-namesakes"
							class="text-warning-600-400 pl-6 text-xs"
							data-exits-namesakes
						>
							{link.namesakes.length === 1
								? "Another place is"
								: `${link.namesakes.length} other places are`} also called
							“{link.written}”, so this is not ticked for you. To choose which one
							is linked, use Link a place.
						</p>
					{/if}
					{#if error}
						<p
							class="text-error-600-400 pl-6 text-xs"
							role="alert"
							data-exits-error
						>
							{error}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<p class="text-surface-600-400 text-xs">
		Each link runs one way, from {place.name}. Nothing is linked until you
		confirm; closing this stops any links not yet sent.
	</p>
	<div class="flex justify-end gap-2">
		<button class="btn btn-sm preset-tonal-surface" type="button" onclick={cancel}>
			Cancel
		</button>
		<button
			class="btn btn-sm preset-tonal-primary"
			type="button"
			disabled={writing || confirmProblem !== null}
			title={confirmProblem ?? undefined}
			onclick={confirm}
			data-exits-confirm
		>
			<Icons.Link size={13} aria-hidden="true" />
			<span>{confirmLabel}</span>
		</button>
	</div>
</div>
