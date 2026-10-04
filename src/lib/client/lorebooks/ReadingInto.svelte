<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
	import { formatDate } from "./sections/historyDates"
	import { readingIntoSentence, sessionMomentKey } from "./scopes"

	/**
	 * The session reading this book, at the top of the rail.
	 *
	 * A lorebook is only ever half the picture: the other half is the session
	 * reading it, and until now that fact lived in one grey line at the very
	 * bottom of the rail. It is promoted here because it answers the question
	 * an author actually has open — *is what I am looking at what the model
	 * sees?* — and because branches made the answer able to be **no**.
	 *
	 * ⚠ **The session reads its own line, at its own story clock** — or at
	 * now when it follows the line's present (owner ruling 3, 2026-09-28).
	 * The Moment bar is the author's tool, not the session's. So this block
	 * is also the one place that says when your reading and the session's
	 * have parted, and the one click that puts them back together.
	 *
	 * ⚠ Drawn only when a session is reading this book. With none, the rail
	 * keeps its quiet footer line — an empty block with a heading would teach
	 * every reader of every unread book a relationship they do not have.
	 */
	interface Props {
		sessionId: number
		sessionName: string
		/** How many entries the newest run read in. Null when none has run. */
		reached: number | null
		/** The line the SESSION is on. NULL = main. */
		sessionBranchId: number | null
		/** The line the READER is on. NULL = main. */
		branchId: number | null
		/** The moment the reader is at. Absent is now. */
		moment?: string
		/**
		 * The session's story clock, or null when it follows the line's
		 * present (it then reads at now).
		 */
		sessionStoryClock?: StoryDate | null
		branches: readonly Sockets.Amendments.Branch[]
		/** Put the reader where the session is: its line, at its clock. */
		onMatch: () => void
	}

	let {
		sessionId,
		sessionName,
		reached,
		sessionBranchId,
		branchId,
		moment,
		sessionStoryClock = null,
		branches,
		onMatch
	}: Props = $props()

	const nameOf = (id: number | null) =>
		id === null
			? "main"
			: (branches.find((b) => b.id === id)?.name ?? "a deleted line")

	let sessionLine = $derived(nameOf(sessionBranchId))
	/** Whether the reader is somewhere the session is not. */
	let parted = $derived(
		(moment ?? undefined) !== sessionMomentKey(sessionStoryClock) ||
			branchId !== sessionBranchId
	)

	let sentence = $derived(
		readingIntoSentence(
			sessionLine,
			reached,
			sessionStoryClock ? formatDate(sessionStoryClock) : null
		)
	)
</script>

<section
	class="panel-edge flex flex-col gap-2 rounded-[10px] border p-2"
	data-lore-reading-into
>
	<button
		type="button"
		class="hover:preset-tonal-surface flex min-w-0 items-center gap-2 rounded-[8px] px-1 py-0.5 text-left"
		onclick={() => goto(`/sessions/${sessionId}`)}
		title="Open {sessionName}"
	>
		<Icons.MessagesSquare
			size={14}
			class="text-primary-500 shrink-0"
			aria-hidden="true"
		/>
		<span class="min-w-0 flex-1 truncate text-sm font-semibold">
			{sessionName}
		</span>
		<Icons.ArrowUpRight
			size={14}
			class="text-surface-600-400 shrink-0"
			aria-hidden="true"
		/>
	</button>

	<p class="text-surface-700-300 px-1 text-xs leading-relaxed">
		{sentence}
	</p>

	{#if parted}
		<!-- At the top because it is a warning, not a status: what the author
		     is looking at is not what the model is being given. -->
		<button
			type="button"
			class="btn btn-sm preset-tonal-warning w-full justify-start"
			onclick={onMatch}
			data-lore-match-session
		>
			<Icons.Crosshair size={14} aria-hidden="true" />
			Read what it reads
		</button>
	{/if}
</section>
