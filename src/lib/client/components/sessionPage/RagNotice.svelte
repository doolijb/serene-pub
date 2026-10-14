<script lang="ts">
	/**
	 * ⚠ No request here takes an ack callback, and none may.
	 * `sockets/index.ts`'s `register` listens with a one-argument handler and
	 * answers by EMITTING the request's own event back, so a three-argument
	 * `socket.emit(event, params, callback)` is a callback nothing ever calls —
	 * which is a notice that never paints. Every request is a
	 * `requestWithInterest` whose handler IS the reply.
	 */
	import * as Icons from "@lucide/svelte"
	import { getContext, onDestroy } from "svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import {
		ragNoticeActions,
		ragNoticeSentence,
		ragNoticeVariant
	} from "./ragNotice"

	interface Props {
		sessionId: number
		totalMessages: number
	}

	let { sessionId, totalMessages }: Props = $props()

	/**
	 * The two props as primitives, which the status effect reads. The session
	 * page replaces its whole `session` object per streamed chunk, and a prop
	 * handed down as `{session.id}` is a getter over it: an effect reading the
	 * prop directly would re-ask `checkRagStatus` per token (B8). A `$derived`
	 * moves only when the value does.
	 */
	const id = $derived(sessionId)
	const messageCount = $derived(totalMessages)

	type RagStatus = Sockets.Vectorization.CheckRagStatus.Response
	let ragStatus: RagStatus | null = $state(null)
	let prioritizing = $state(false)
	let ignoring = $state(false)

	/**
	 * The one-shot request interests, released the moment their reply lands.
	 *
	 * Held here as well so an unmount mid-flight releases them — a reply that
	 * never comes (the request was refused) would otherwise leave this notice's
	 * interest declared for the life of the tab.
	 */
	const pending = new Set<() => void>()

	/**
	 * A request whose interest lasts exactly as long as its reply takes: the
	 * handler calls `done` when it fires, and anything still outstanding is
	 * released on destroy.
	 */
	function oneShot(begin: (done: () => void) => () => void): void {
		let release: () => void = () => {}
		const done = () => {
			pending.delete(release)
			release()
		}
		release = begin(done)
		pending.add(release)
	}

	function fetchStatus() {
		oneShot((done) =>
			requestWithInterest(
				"vectorization:checkRagStatus",
				{ sessionId: id },
				(res) => {
					ragStatus = res
					done()
				}
			)
		)
	}

	$effect(() => {
		// Re-fetch whenever the session or its message count changes
		id
		messageCount
		fetchStatus()
	})

	// Re-fetch when the queue reports a status change (items may have
	// finished). Declared through the registry, so it is released on destroy
	// rather than piling another listener on the socket per session shown.
	useInterest<"vectorization:progress">("vectorization:progress", () => {
		if (ragStatus?.applicable) {
			fetchStatus()
		}
	})

	onDestroy(() => {
		for (const release of [...pending]) release()
		pending.clear()
	})

	function handleMoveToTop() {
		prioritizing = true
		oneShot((done) =>
			requestWithInterest(
				"vectorization:addToQueue",
				{ sessionId },
				() => {
					done()
					prioritizing = false
					fetchStatus()
				}
			)
		)
	}

	/** Releases the hide request in flight, whichever way it is answered. */
	let settleIgnoring: (() => void) | null = null

	function handleSetRagIgnored(ignored: boolean) {
		ignoring = true
		oneShot((done) => {
			settleIgnoring = () => {
				settleIgnoring = null
				done()
				ignoring = false
			}
			return requestWithInterest(
				"vectorization:setSessionRagIgnored",
				{ sessionId, ignored },
				(res) => {
					if (ragStatus)
						ragStatus = { ...ragStatus, ragIgnored: res.ragIgnored }
					settleIgnoring?.()
				}
			)
		})
	}

	// A refusal (the session changed hands under this view) is toasted by
	// Layout in the server's words; here it only frees the button.
	useInterest<"vectorization:setSessionRagIgnored:error">(
		"vectorization:setSessionRagIgnored:error",
		() => settleIgnoring?.()
	)

	/**
	 * What Search by meaning searches: the session lorebook's entries, and
	 * only them. The queue embeds messages and the cast too, but nothing ever
	 * finds those by meaning, so they are not RAG's to wait on.
	 */
	let totals = $derived.by(() => ragStatus?.lorebook ?? null)

	/**
	 * What the lorebook's indexing has to say, hidden or not (`ragNoticeVariant`):
	 * not indexed yet, needs re-indexing, or part way there. Null once every
	 * entry is indexed.
	 */
	let pendingVariant = $derived.by(() =>
		ragStatus?.applicable ? ragNoticeVariant(totals) : null
	)

	/** The notice as shown: nothing once its owner hid it for the session. */
	let variant = $derived.by(() =>
		ragStatus?.ragIgnored ? null : pendingVariant
	)

	/**
	 * Only the session's owner may hide the notice or show it again; a guest
	 * sees the notice, and nothing once it is hidden.
	 */
	let canHide = $derived.by(() => ragStatus?.canHide === true)

	/**
	 * Re-index, prioritize and the setup link are an administrator's: the
	 * server refuses `vectorization:addToQueue` to anyone else, and Admin is
	 * theirs alone (`ragNoticeActions`).
	 */
	const userCtx = getContext<UserCtx | undefined>("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)

	let sentence = $derived.by(() =>
		variant && ragStatus
			? ragNoticeSentence(variant, {
					modelName: ragStatus.activeModelName,
					readyCount: totals?.readyCount ?? 0,
					total: totals?.total ?? 0,
					queueRunning: ragStatus.queueRunning
				})
			: ""
	)
	let actions = $derived(variant ? ragNoticeActions(variant, isAdmin) : [])
</script>

<!-- One quiet line, sized and placed by whatever hosts it: the composer sets
     it above the card, opposite the Actions label. -->
{#if ragStatus?.applicable && variant}
	<div
		class="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs"
		role="alert"
		aria-live="polite"
	>
		{#if variant === "processing"}
			<Icons.Loader
				size={12}
				class="text-warning-600 dark:text-warning-500 shrink-0 animate-spin"
				aria-hidden="true"
			/>
		{:else}
			<Icons.AlertTriangle
				size={12}
				class="text-warning-600 dark:text-warning-500 shrink-0"
				aria-hidden="true"
			/>
		{/if}

		<span class="text-surface-600 dark:text-surface-400 min-w-0">
			{sentence}
		</span>

		{#each actions as action (action.label)}
			{#if action.kind === "link"}
				<a
					class="rag-notice-link"
					href={action.href}
					title={action.title}
				>
					{action.label}
				</a>
			{:else}
				<button
					type="button"
					class="rag-notice-link"
					onclick={handleMoveToTop}
					disabled={prioritizing}
					title={action.title}
				>
					{action.label}
				</button>
			{/if}
		{/each}

		<!-- Hides this notice and nothing else: `ragIgnored` is read by the
		     notice alone, so Search by meaning keeps searching the lorebook. -->
		{#if canHide}
			<button
				type="button"
				class="rag-notice-link"
				onclick={() => handleSetRagIgnored(true)}
				disabled={ignoring}
				title="Hide this notice for this session. Search by meaning still runs."
			>
				Hide for this session
			</button>
		{/if}
	</div>
{:else if canHide && ragStatus?.ragIgnored && pendingVariant}
	<!-- Only while the hidden notice would have something to say: over a
	     fully indexed book there is nothing hidden to show again. -->
	<div
		class="text-surface-500 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs"
	>
		<Icons.EyeOff size={12} class="shrink-0" aria-hidden="true" />
		<span>
			Notice hidden for this session. Search by meaning still runs.
		</span>
		<button
			type="button"
			class="rag-notice-link"
			onclick={() => handleSetRagIgnored(false)}
			disabled={ignoring}
			title="Show the indexing notice again for this session"
		>
			Show again
		</button>
	</div>
{/if}

<style>
	/* A text link, not a button box: at 12px beside the sentence it explains,
	   a bordered control would outweigh the notice itself. */
	.rag-notice-link {
		color: var(--color-primary-700);
		text-underline-offset: 2px;
		cursor: pointer;
	}

	:global([data-mode="dark"]) .rag-notice-link {
		color: var(--color-primary-500);
	}

	.rag-notice-link:hover:not(:disabled) {
		text-decoration: underline;
	}

	.rag-notice-link:disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	.rag-notice-link:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
</style>
