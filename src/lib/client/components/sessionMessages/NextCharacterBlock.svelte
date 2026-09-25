<script lang="ts">
	/**
	 * Who is due next (PLAN-turn-order §4.9), rendered from the session's
	 * stored turn order — never derived on the client. The head names its
	 * speaker from the order's candidates:
	 *
	 * - a character or envoy: "<name> is ready to continue", with Continue;
	 * - `ref: null`: "The narrator is ready to continue", with Continue;
	 * - a person (a persona): "<name>'s turn", or "Your turn" when the
	 *   persona is the viewer's own, and no Continue — a person's turn is
	 *   taken by writing.
	 *
	 * An empty order with people to choose from — a round that is over, or
	 * a manual strategy waiting to be told — waits on a message and offers
	 * the pick.
	 *
	 * "Someone else" asks the page to open the turn picker. With `mode:
	 * 'list'` the entries after the head follow as one quiet line.
	 */
	import type { NextUp } from "./MessagesWidget.svelte"

	type Entry = { ref: string | null; [k: string]: unknown }
	type Candidate = {
		ref: string
		kind: string
		name: string
		nickname?: string
		ownerUserId?: number
	}

	interface Props {
		order: Entry[]
		candidates: Candidate[]
		mode: NextUp
		shouldShow: boolean
		/** A face for a ref, when the session has one loaded. */
		avatarFor?: (ref: string) => unknown
		onContinue: () => void
		onSomeoneElse: () => void
		/** Whether anyone else could take the turn. */
		canChooseSomeoneElse?: boolean
		/** The person looking: their own persona's turn reads "Your turn". */
		viewerUserId?: number | null
	}

	let {
		order,
		candidates,
		mode,
		shouldShow,
		avatarFor,
		onContinue,
		onSomeoneElse,
		canChooseSomeoneElse = true,
		viewerUserId = null
	}: Props = $props()

	const byRef = $derived(new Map(candidates.map((c) => [c.ref, c])))
	const head = $derived(order[0])
	const nameOf = (ref: string | null): string => {
		if (ref === null) return "The narrator"
		const c = byRef.get(ref)
		return c?.nickname || c?.name || "Someone"
	}
	const isPerson = (ref: string | null) =>
		ref !== null && byRef.get(ref)?.kind === "persona"
	const headName = $derived(head ? nameOf(head.ref) : "")
	const headIsPerson = $derived(!!head && isPerson(head.ref))
	const headIsMine = $derived(
		headIsPerson &&
			viewerUserId != null &&
			byRef.get(head!.ref as string)?.ownerUserId === viewerUserId
	)
	const line = $derived(
		headIsMine
			? "Your turn"
			: headIsPerson
				? `${headName}'s turn`
				: `${headName} is ready to continue`
	)
	const face = $derived(head?.ref ? avatarFor?.(head.ref) : undefined)
	const after = $derived(mode === "list" ? order.slice(1) : [])
</script>

{#if shouldShow && !head && candidates.length}
	<div class="my-2 flex min-w-0 items-center gap-2 px-4">
		<span
			class="text-surface-700 dark:text-surface-300 min-w-0 truncate text-[13px] leading-[1.45]"
		>
			Waiting for a message — or pick who speaks next
		</span>
		<button
			type="button"
			class="composer-quiet-btn ml-auto shrink-0 px-2"
			onclick={onSomeoneElse}
		>
			<sp-icon name="users" size="14"></sp-icon>
			<span>Pick</span>
		</button>
	</div>
{:else if shouldShow && head}
	<!-- One line: who is up, and what you can do about it. -->
	<div class="my-2 flex min-w-0 flex-col gap-1 px-4">
		<div class="flex min-w-0 items-center gap-2">
			{#if face}
				<sp-avatar ref={head.ref} size="sm"></sp-avatar>
			{:else if head.ref === null}
				<sp-icon name="book-open-text" size="18" class="text-surface-600-400"></sp-icon>
			{/if}
			<span
				class="text-surface-700 dark:text-surface-300 min-w-0 truncate text-[13px] leading-[1.45]"
			>
				{line}
			</span>
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{#if canChooseSomeoneElse}
					<button
						type="button"
						class="composer-quiet-btn px-2"
						onclick={onSomeoneElse}
						title="Someone else"
						aria-label="Pick someone else to continue"
					>
						<sp-icon name="users" size="14"></sp-icon>
						<span class="max-sm:sr-only">Someone else</span>
					</button>
				{/if}
				{#if !headIsPerson}
					<button
						type="button"
						class="btn composer-send preset-filled-primary-500"
						onclick={onContinue}
						title="Continue"
						aria-label="Continue with {headName}"
					>
						<sp-icon name="play"></sp-icon>
						<span>Continue</span>
					</button>
				{/if}
			</div>
		</div>
		{#if after.length}
			<p class="text-surface-600-400 truncate text-xs">
				Then {after.map((e) => nameOf(e.ref)).join(", ")}
			</p>
		{/if}
	</div>
{/if}
