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
	 * Reviews queue oldest-first. A card that vanishes mid-decision
	 * (`reviewClosed`) was cancelled with its run — no ghost approvals.
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import SchemaForm from "./SchemaForm.svelte"
	import { toaster } from "$lib/client/utils/toaster"

	const socket = useTypedSocket()

	let queue = $state<Sockets.Pipelines.PendingReview[]>([])
	let values = $state<Record<string, unknown>>({})
	let currentId = $state<string | null>(null)

	const current = $derived(queue[0] ?? null)

	// A fresh card resets the working values to the payload's own.
	$effect(() => {
		if (current && current.id !== currentId) {
			currentId = current.id
			values = { ...current.values }
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

	function decide(action: "approve" | "edit" | "reject") {
		if (!current) return
		socket.emit("pipelines:resolveReview", {
			id: current.id,
			action,
			...(action === "edit" ? { values } : {})
		})
		queue = queue.filter((r) => r.id !== current.id)
	}

	const onRequested = (r: Sockets.Pipelines.PendingReview) => {
		if (!queue.some((q) => q.id === r.id)) queue = [...queue, r]
	}
	const onClosed = (msg: { id: string }) => {
		queue = queue.filter((r) => r.id !== msg.id)
	}
	const onList = (res: Sockets.Pipelines.Reviews.Response) => {
		// Reconnect catch-up: keep arrival order, dedupe by id.
		const known = new Set(queue.map((r) => r.id))
		queue = [...queue, ...res.reviews.filter((r) => !known.has(r.id))]
	}
	const onError = (res: { error?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
	}

	onMount(() => {
		socket.on("pipelines:reviewRequested", onRequested)
		socket.on("pipelines:reviewClosed", onClosed)
		socket.on("pipelines:reviews", onList)
		socket.on("pipelines:resolveReview:error", onError)
		socket.emit("pipelines:reviews", {})
	})

	onDestroy(() => {
		socket.off("pipelines:reviewRequested", onRequested)
		socket.off("pipelines:reviewClosed", onClosed)
		socket.off("pipelines:reviews", onList)
		socket.off("pipelines:resolveReview:error", onError)
	})
</script>

{#if current}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
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
					<p class="font-semibold">Waiting for your review</p>
					<p class="text-muted text-xs">
						A pipeline is paused before it acts. Nothing happens
						until you decide — waiting costs nothing.
						{#if queue.length > 1}
							· {queue.length - 1} more waiting
						{/if}
					</p>
				</div>
			</div>

			<SchemaForm schema={current.schema as any} bind:values />

			<div class="flex items-center justify-end gap-2 pt-1">
				<button
					class="btn btn-sm preset-tonal-error"
					onclick={() => decide("reject")}
					title="Halt the run — a rejection is a halt, not an error"
				>
					<Icons.X size={14} /> Reject
				</button>
				<button
					class="btn btn-sm preset-filled-primary-500"
					onclick={() => decide(dirty ? "edit" : "approve")}
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
