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
	import { getContext, onDestroy, untrack } from "svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import {
		markNoticeRead,
		noticeRead,
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

	/**
	 * Once a session, then an icon (polish parity L1, 2026-10-24): the line
	 * shows the first time this device opens a session the notice applies
	 * to; from the next open it is an icon in the composer's footer that
	 * opens the line again. Collapsing the line makes it the icon now. A
	 * per-viewer convenience on this device (`noticeRead`): when storage
	 * fails, the line just shows.
	 */
	let collapsed = $state(false)
	let collapsedFor: number | null = null
	$effect(() => {
		const sid = id
		untrack(() => {
			if (collapsedFor === sid) return
			collapsedFor = sid
			collapsed = noticeRead(sid)
		})
	})
	// Shown as a line: read, for the next time this session opens.
	$effect(() => {
		if (!variant || collapsed) return
		const sid = id
		untrack(() => markNoticeRead(sid))
	})
</script>

<!-- Placed by whatever hosts it: the composer seats it at the start of its
     footer's end, beside Attach. A line takes the room it needs (the footer
     wraps it under the persona in a narrow box); an icon is one control. -->
{#if ragStatus?.applicable && variant && collapsed}
	<button
		type="button"
		class="rag-notice-icon"
		aria-expanded="false"
		aria-label="Show the indexing notice"
		title={sentence}
		onclick={() => (collapsed = false)}
	>
		{#if variant === "processing"}
			<Icons.Loader size={16} class="animate-spin" aria-hidden="true" />
		{:else}
			<Icons.AlertTriangle size={16} aria-hidden="true" />
		{/if}
	</button>
{:else if ragStatus?.applicable && variant}
	<div
		class="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs"
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
		<!-- The line, back to its icon beside Attach. -->
		<button
			type="button"
			class="rag-notice-collapse"
			aria-expanded="true"
			aria-label="Collapse the indexing notice"
			title="Collapse the indexing notice"
			onclick={() => (collapsed = true)}
		>
			<Icons.X size={12} aria-hidden="true" />
		</button>
	</div>
{:else if canHide && ragStatus?.ragIgnored && pendingVariant}
	<!-- Only while the hidden notice would have something to say: over a
	     fully indexed book there is nothing hidden to show again. An icon, as
	     the read notice is; its name says the whole of it. -->
	<button
		type="button"
		class="rag-notice-icon"
		onclick={() => handleSetRagIgnored(false)}
		disabled={ignoring}
		title="Notice hidden for this session. Search by meaning still runs. Show it again"
	>
		<Icons.EyeOff size={16} aria-hidden="true" />
		<span class="sr-only">
			Notice hidden for this session. Search by meaning still runs. Show again
		</span>
	</button>
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

	.rag-notice-link:focus-visible,
	.rag-notice-icon:focus-visible,
	.rag-notice-collapse:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}

	/* The icon: the composer's own quiet round control, its 32px (44px where
	   a finger lands), muted until pointed at. */
	.rag-notice-icon {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		inline-size: 2rem;
		block-size: 2rem;
		border-radius: 9999px;
		color: light-dark(var(--color-surface-600), var(--color-surface-400));
		cursor: pointer;
	}
	.rag-notice-icon:hover:not(:disabled) {
		background: light-dark(var(--color-surface-200), var(--color-surface-800));
	}
	.rag-notice-icon:disabled {
		opacity: 0.4;
		pointer-events: none;
	}
	@media (pointer: coarse) {
		.rag-notice-icon {
			inline-size: 2.75rem;
			block-size: 2.75rem;
		}
	}

	.rag-notice-collapse {
		display: inline-grid;
		place-items: center;
		inline-size: 1.25rem;
		block-size: 1.25rem;
		border-radius: 9999px;
		color: light-dark(var(--color-surface-600), var(--color-surface-400));
		cursor: pointer;
	}
	.rag-notice-collapse:hover {
		background: light-dark(var(--color-surface-200), var(--color-surface-800));
	}
	@media (pointer: coarse) {
		.rag-notice-collapse {
			inline-size: 2.75rem;
			block-size: 2.75rem;
		}
	}
</style>
