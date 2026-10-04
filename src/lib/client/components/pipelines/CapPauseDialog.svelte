<script lang="ts">
	/**
	 * The cap pause (E1c): pipelines answering each other's events reached a
	 * cycle cap, and the next one waits for the session owner.
	 *
	 * Continue lets the chain run one more window; Stop here ends it. There is
	 * no third answer and no dismissal — a pause left alone simply waits, and
	 * waiting costs nothing. A card leaves only when the server says it is
	 * finished (`capPauseClosed`), so an answer given in another tab retires it
	 * here too.
	 *
	 * ⚠ Not the review modal: nothing here is edited, and the run it holds has
	 * not started.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { queueAfterThis } from "./reviewQueue"

	const socket = useTypedSocket()

	let queue = $state<Sockets.Pipelines.CapPause[]>([])
	/** The answer in flight — the card stays until the server answers. */
	let answeringId = $state<string | null>(null)

	const current = $derived(queue[0] ?? null)
	const answering = $derived(!!current && answeringId === current.id)

	function answer(action: "continue" | "cancel") {
		if (!current || answering) return
		answeringId = current.id
		socket.emit("pipelines:resolveCapPause", { id: current.id, action })
	}

	// A pause that gained a parked run arrives again under its own id:
	// replaced in place, so the count stays true and the card keeps its spot.
	const onRequested = (p: Sockets.Pipelines.CapPause) => {
		queue = queue.some((q) => q.id === p.id)
			? queue.map((q) => (q.id === p.id ? p : q))
			: [...queue, p]
	}
	const onClosed = (msg: { id: string }) => {
		queue = queue.filter((p) => p.id !== msg.id)
		if (answeringId === msg.id) answeringId = null
	}
	const onList = (res: Sockets.Pipelines.CapPauses.Response) => {
		const known = new Set(queue.map((p) => p.id))
		queue = [...queue, ...res.pauses.filter((p) => !known.has(p.id))]
	}
	const onError = (res: { error?: string; id?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
		if (answeringId && (!res?.id || res.id === answeringId)) {
			// A pause that is gone is finished, whoever finished it.
			if (res?.id) queue = queue.filter((p) => p.id !== res.id)
			answeringId = null
		}
	}

	// Both pushes are bare: a pause is addressed to a person, from wherever
	// the chain ran, not to the session open in this tab.
	useInterest<"pipelines:capPauseRequested">(
		"pipelines:capPauseRequested",
		onRequested
	)
	useInterest<"pipelines:capPauseClosed">(
		"pipelines:capPauseClosed",
		onClosed
	)
	$effect(() => requestWithInterest("pipelines:capPauses", {}, onList))
	useInterest<"pipelines:resolveCapPause:error">(
		"pipelines:resolveCapPause:error",
		onError
	)
</script>

<Dialog
	open={!!current}
	role="alertdialog"
	closeOnEscape={false}
	closeOnInteractOutside={false}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-6 shadow-xl"
				aria-labelledby="cap-pause-title"
				aria-describedby="cap-pause-description"
			>
				{#if current}
					<header class="space-y-1">
						<h2 id="cap-pause-title" class="h2">Keep going?</h2>
						<p
							id="cap-pause-description"
							class="text-surface-600-400 text-sm"
						>
							These pipelines keep setting each other off.
							{current.waiting > 1
								? `${current.waiting} runs wait`
								: "The next one waits"} for you, and waiting costs
							nothing.
							{#if queueAfterThis(queue.length)}
								{queueAfterThis(queue.length)}.
							{/if}
						</p>
					</header>
					<ol class="flex flex-wrap items-center gap-1 text-sm">
						{#each current.chain as step, i (i)}
							<li class="flex items-center gap-1">
								{#if i > 0}
									<Icons.ArrowRight
										size={14}
										aria-hidden="true"
										class="text-surface-600-400"
									/>
								{/if}
								<span
									class={i === current.chain.length - 1
										? "font-semibold"
										: ""}
								>
									{step}
								</span>
								{#if i === current.chain.length - 1}
									<span class="sr-only">(waiting)</span>
								{/if}
							</li>
						{/each}
					</ol>
					<footer class="flex justify-end gap-4">
						<button
							class="btn preset-tonal"
							onclick={() => answer("cancel")}
							disabled={answering}
							type="button"
						>
							Stop here
						</button>
						<button
							class="btn preset-filled-primary-500"
							onclick={() => answer("continue")}
							disabled={answering}
							type="button"
						>
							Continue
						</button>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
