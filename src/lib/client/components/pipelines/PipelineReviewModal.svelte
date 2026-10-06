<script lang="ts">
	/**
	 * The review gate's surface (01 §7) — a run is parked at a gated node and
	 * a person decides.
	 *
	 * The form is 100% defined by the data the node received: the server
	 * inferred a schema from the payload and `SchemaForm` renders it — no
	 * bespoke screen per pipeline, which is what lets a plugin's write gate
	 * exactly like core's with no UI work. Approve resumes the run untouched;
	 * an edited form folds back into the payload server-side (the binding
	 * cannot tell, F14); reject halts the run — a halt, not an error.
	 *
	 * Reviews queue oldest-first. A card leaves only when the server says it is
	 * finished (`reviewClosed`) — decided here, decided in another tab, or
	 * cancelled with its run: no ghost approvals. It deliberately survives the
	 * click that decides it, because an edit the server refuses leaves the run
	 * parked, and the person needs the form back to correct the field.
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import * as Icons from "@lucide/svelte"
	import SchemaForm from "./SchemaForm.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { queueAfterThis, queuePosition } from "./reviewQueue"
	import { pipelineLabel } from "$lib/client/utils/pipelineGenre"

	const socket = useTypedSocket()

	let queue = $state<Sockets.Pipelines.PendingReview[]>([])
	let values = $state<Record<string, unknown>>({})
	let currentId = $state<string | null>(null)
	/** The decision in flight, if any — the card stays until the server answers. */
	let submittingId = $state<string | null>(null)
	/** Why the last decision on this card was refused, shown beside the form. */
	let lastError = $state<string | null>(null)

	const current = $derived(queue[0] ?? null)

	/**
	 * The published pipelines and the genres' names, asked for only while a
	 * card is up: a card can come from any session, and pipeline names carry
	 * no genre (NOMENCLATURE §2), so it names both — "Reply · Adventure".
	 */
	let pipelines = $state<Sockets.Pipelines.Namespace[] | null>(null)
	let genres = $state<Sockets.Sessions.Genres.Response["genres"] | null>(
		null
	)
	const carded = $derived(!!current)
	$effect(() => {
		if (!carded) return
		return requestWithInterest("pipelines:list", {}, (res) => {
			pipelines = res.pipelinesList
		})
	})
	$effect(() => {
		if (!carded) return
		return requestWithInterest("sessions:genres", {}, (res) => {
			genres = res.genres ?? []
		})
	})

	/**
	 * The pipeline the card belongs to: its name and genre, and until those
	 * arrive the slug's tail (`core:spec/chat-respond` → "Chat respond").
	 */
	const specLabel = (specId: string) => {
		const named = pipelineLabel(specId, pipelines, genres)
		if (named) return named
		const tail = specId.slice(specId.lastIndexOf("/") + 1).replace(/-/g, " ")
		return tail ? tail[0].toUpperCase() + tail.slice(1) : specId
	}
	const submitting = $derived(!!current && submittingId === current.id)

	// A fresh card resets the working values to the payload's own.
	$effect(() => {
		if (current && current.id !== currentId) {
			currentId = current.id
			values = { ...current.values }
			lastError = null
		}
		if (!current) currentId = null
	})

	const dirty = $derived(
		current
			? Object.keys(current.values).some(
					(k) =>
						String(values[k] ?? "") !==
						String(current.values[k] ?? "")
				)
			: false
	)

	/**
	 * The card outlives the click on purpose.
	 *
	 * An edit can be refused server-side — a JSON field that does not parse,
	 * a number that is not one — and the run stays parked when it is. Dropping
	 * the card here left the person with an error toast and nothing to correct
	 * it in, so it goes when the server says it is finished
	 * (`pipelines:reviewClosed`, the same event a cancelled run sends) and not
	 * before.
	 */
	function decide(action: "approve" | "edit" | "reject") {
		if (!current || submitting) return
		lastError = null
		submittingId = current.id
		socket.emit("pipelines:resolveReview", {
			id: current.id,
			action,
			...(action === "edit" ? { values } : {})
		})
	}

	const onRequested = (r: Sockets.Pipelines.PendingReview) => {
		if (!queue.some((q) => q.id === r.id)) queue = [...queue, r]
	}
	const onClosed = (msg: { id: string }) => {
		queue = queue.filter((r) => r.id !== msg.id)
		if (submittingId === msg.id) submittingId = null
	}
	const onList = (res: Sockets.Pipelines.Reviews.Response) => {
		// Reconnect catch-up: keep arrival order, dedupe by id.
		const known = new Set(queue.map((r) => r.id))
		queue = [...queue, ...res.reviews.filter((r) => !known.has(r.id))]
	}
	const onError = (res: { error?: string; id?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
		// A refusal reaches the tab that asked and names its card; only the
		// card in flight re-enables. A server too old to name the card falls back to whatever
		// this tab has in flight.
		if (submittingId && (!res?.id || res.id === submittingId)) {
			if (res?.error && submittingId === current?.id)
				lastError = res.error
			submittingId = null
		}
	}

	/**
	 * The two pushes, both BARE: a review is addressed to the person, not to a
	 * session — `reviewRequested` is how this modal learns a run parked at all,
	 * from anywhere in the app — so there is no interest scope to narrow to.
	 */
	useInterest<"pipelines:reviewRequested">(
		"pipelines:reviewRequested",
		onRequested
	)
	useInterest<"pipelines:reviewClosed">("pipelines:reviewClosed", onClosed)

	/**
	 * The catch-up list and the request that fills it, in one: the interest
	 * sync naming `pipelines:reviews` leaves ahead of the request (ruling 3),
	 * so the reply cannot arrive before the key that wants it exists.
	 */
	$effect(() => requestWithInterest("pipelines:reviews", {}, onList))

	// Never gated (plan ruling 2 — an error is not an output to skip), but the
	// registry is the only listener path, so it is declared like the rest.
	useInterest<"pipelines:resolveReview:error">(
		"pipelines:resolveReview:error",
		onError
	)
</script>

{#if current}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Review a pipeline write"
	>
		<div
			class="bg-surface-100-900 flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl p-4 shadow-xl"
		>
			<div class="flex items-start gap-2">
				<Icons.ShieldQuestion size={20} class="mt-0.5 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="font-semibold">
						Waiting for your review{#if queuePosition(queue.length)}
							<span class="text-surface-600-400 font-normal">
								· {queuePosition(queue.length)}</span
							>{/if}
					</p>
					<p class="text-surface-600-400 text-xs">
						A pipeline is paused before it acts. Nothing happens
						until you decide — waiting costs nothing.
						{#if queueAfterThis(queue.length)}
							· {queueAfterThis(queue.length)}
						{/if}
					</p>
					{#if current.whatIsReviewed}
						<p class="mt-1 text-sm" data-testid="review-what">
							<span class="text-surface-600-400"
								>{specLabel(current.specId)} · step “{current.nodeKey}”:</span
							>
							{current.whatIsReviewed}
						</p>
					{/if}
				</div>
			</div>

			<SchemaForm schema={current.schema as any} bind:values />

			{#if lastError}
				<p
					class="preset-tonal-error rounded-lg p-2 text-xs"
					role="alert"
				>
					{lastError} Nothing has happened yet — the run is still waiting
					on you.
				</p>
			{/if}

			<div class="flex items-center justify-end gap-2 pt-1">
				<button
					class="btn btn-sm preset-tonal-error"
					onclick={() => decide("reject")}
					disabled={submitting}
					title="Halt the run — a rejection is a halt, not an error"
				>
					<Icons.X size={14} /> Reject
				</button>
				<button
					class="btn btn-sm preset-filled-primary-500"
					onclick={() => decide(dirty ? "edit" : "approve")}
					disabled={submitting}
					title={dirty
						? "Continue with your edits — the pipeline receives them as if they were its own"
						: "Continue with the payload untouched"}
				>
					<Icons.Check size={14} />
					{dirty ? "Approve with edits" : "Approve"}
				</button>
			</div>
		</div>
	</div>
{/if}
