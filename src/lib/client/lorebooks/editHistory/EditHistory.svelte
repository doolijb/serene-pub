<script lang="ts">
	/**
	 * 🚧 An entry's, a card version's or a cast version's **Edit history**
	 * (`lore_redlines`): a fold under the fields, closed on load, drawn only
	 * when the subject has edits. The subject is an entry (`lorebookId` +
	 * `entryId`) or a version (`characterVersionId`); one descriptor holds the
	 * events, key and match, the markup is shared. The list is asked when the
	 * subject or its saved row changes and heard again whenever the server
	 * re-sends it (after a Restore or a clear). A refusal is said inline here,
	 * never as a toast. An entry's ⋯ menu **Clear edit history…** sets
	 * `clearOpen`; a version, having no ⋯ menu, ends the open fold with its own
	 * button. This component owns the question and the clear, and reports
	 * `{ count, canClear }` through `onState`.
	 */
	import * as Icons from "@lucide/svelte"
	import { SvelteMap, SvelteSet } from "svelte/reactivity"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { realDateTime } from "$lib/client/utils/realTime.svelte"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import { interestKey } from "$lib/shared/sockets/interest"
	import ClearEditHistoryDialog from "./ClearEditHistoryDialog.svelte"
	import {
		AFTER_LABEL,
		BEFORE_LABEL,
		CLEAR_ENTRY_QUESTION,
		HIDE_LABEL,
		REDLINE_CAUSE_LABELS,
		RESTORE_LABEL,
		RESTORE_TITLE,
		SHOW_LABEL,
		CLEAR_ACTION_LABEL,
		CLEAR_VERSION_QUESTION,
		FOLLOWS_CARD_TEXT,
		NO_PREVIEW_TEXT,
		clearEntrySentence,
		clearVersionSentence,
		editHistoryFoldLabel,
		isShortChange,
		redlineValueText,
		versionLine
	} from "./editHistoryCopy"

	interface Props {
		/** With `entryId`: the entry's lorebook. */
		lorebookId?: number
		entryId?: number
		/** The other subject: a card version or a cast version. */
		characterVersionId?: number
		/** When set, every Restore is disabled and carries this as its title. */
		restoreBlocked?: string
		/** A Restore is about to be sent / was answered / was refused. */
		onRestore?: (phase: "start" | "done" | "failed") => void
		/** The stored row's `updatedAt`; a change asks the list again. */
		updatedAt?: string | null
		/** Set by the ⋯ menu; true shows the clear question. */
		clearOpen?: boolean
		onState?: (state: {
			entryId: number
			count: number
			canClear: boolean
		}) => void
		/** Draw only rows whose `amendmentId` is listed; null is the entry's own edits. Counts stay the whole subject's. */
		amendmentIds?: readonly (number | null)[]
		/** `rows` draws the rows alone: no fold, no version clear button, no dialog. */
		variant?: "fold" | "rows"
		/** The fold button's words. */
		foldLabel?: (count: number) => string
	}

	let {
		lorebookId,
		entryId,
		characterVersionId,
		restoreBlocked,
		onRestore,
		updatedAt = null,
		clearOpen = $bindable(false),
		onState,
		amendmentIds,
		variant = "fold",
		foldLabel = editHistoryFoldLabel
	}: Props = $props()

	const socket = useTypedSocket()

	type Row = Sockets.RedlineView
	let list = $state<{
		subjectId: number
		canRestore: boolean
		canClear: boolean
		redlines: Row[]
	} | null>(null)
	let open = $state(false)
	let restoreError = new SvelteMap<number, string>()
	let restoring = new SvelteSet<number>()
	let shown = new SvelteSet<string>()
	let clearError = $state("")
	let clearBusy = $state(false)
	let versionClearOpen = $state(false)

	// Everything that differs between the subjects. Events are loosely typed
	// here: the two families share one reply shape once normalised.
	const subject = $derived.by(() => {
		if (characterVersionId !== undefined) {
			const id = characterVersionId
			return {
				kind: "version" as const,
				id,
				scope: id,
				asks: "characterVersions:redlines",
				restores: "characterVersions:restoreRedline",
				clears: "characterVersions:clearRedlines",
				askParams: { characterVersionId: id },
				clearParams: { characterVersionId: id },
				matchClear: (d: { characterVersionId?: number }) =>
					d.characterVersionId === id,
				normalise: (res: any) =>
					res.characterVersionId === id
						? {
								subjectId: id,
								canRestore: res.canRestore,
								canClear: res.canClear,
								redlines: res.redlines as Row[]
							}
						: null,
				question: CLEAR_VERSION_QUESTION,
				sentence: clearVersionSentence
			}
		}
		const id = entryId as number
		return {
			kind: "entry" as const,
			id,
			scope: lorebookId as number,
			asks: "entries:redlines",
			restores: "entries:restoreRedline",
			clears: "entries:clearRedlines",
			askParams: { entryId: id },
			clearParams: { entryId: id },
			matchClear: (d: { entryId?: number }) => d.entryId === id,
			normalise: (res: any) =>
				res.entryId === id
					? {
							subjectId: id,
							canRestore: res.canRestore,
							canClear: res.canClear,
							redlines: res.redlines as Row[]
						}
					: null,
			question: CLEAR_ENTRY_QUESTION,
			sentence: clearEntrySentence
		}
	})
	const subjectId = $derived(subject.id)

	const allRows = $derived(list?.subjectId === subjectId ? list.redlines : [])
	const rows = $derived(
		amendmentIds
			? allRows.filter((r) =>
					amendmentIds.includes(r.amendmentId ?? null)
				)
			: allRows
	)

	$effect(() => {
		const count = allRows.length
		const canClear = list?.subjectId === subjectId && list.canClear
		onState?.({ entryId: subjectId, count, canClear })
	})

	// Another subject starts closed and clean.
	let lastSubject: string | null = null
	$effect(() => {
		const now = `${subject.kind}:${subjectId}`
		const previous = lastSubject
		lastSubject = now
		if (previous === null || previous === now) return
		open = false
		list = null
		restoreError.clear()
		shown.clear()
		clearError = ""
	})

	$effect(() => {
		const s = subject
		const release = declareInterest<any>(
			interestKey(s.asks, s.scope),
			(res: unknown) => {
				const next = s.normalise(res)
				if (next) list = next
			}
		)
		return release
	})

	$effect(() => {
		void updatedAt
		const s = subject
		const release = declareInterest<any>(`${s.asks}:error`, () => {})
		// Rows under a version ask nothing: the form's one fold asks, and its
		// reply reaches every mount through the shared key.
		if (variant !== "rows") socket.emit(s.asks as never, s.askParams as never)
		return release
	})

	const exact = (iso: string) => realDateTime(iso)

	async function restore(id: number) {
		restoreError.delete(id)
		restoring.add(id)
		onRestore?.("start")
		try {
			await awaitReply({
				socket,
				event: subject.restores as never,
				params: { redlineId: id } as never,
				replyKey: interestKey(subject.restores, subject.scope),
				errorEvent: `${subject.restores}:error` as never,
				fallbackError: "That edit could not be restored.",
				match: (d: any) => d.redlineId === id,
				matchError: (d) =>
					(d as { redlineId?: number })?.redlineId === id
			})
			onRestore?.("done")
		} catch (e) {
			onRestore?.("failed")
			restoreError.set(id, e instanceof Error ? e.message : String(e))
		} finally {
			restoring.delete(id)
		}
	}

	async function clearAll() {
		clearBusy = true
		clearError = ""
		try {
			await awaitReply({
				socket,
				event: subject.clears as never,
				params: subject.clearParams as never,
				replyKey: interestKey(subject.clears, subject.scope),
				errorEvent: `${subject.clears}:error` as never,
				fallbackError: "The edit history could not be cleared.",
				match: (d: any) => subject.matchClear(d),
				matchError: (d) => subject.matchClear((d ?? {}) as never)
			})
			clearOpen = false
			versionClearOpen = false
		} catch (e) {
			clearError = e instanceof Error ? e.message : String(e)
		} finally {
			clearBusy = false
		}
	}

	function cancelClear() {
		clearOpen = false
		versionClearOpen = false
		clearError = ""
	}
</script>

{#snippet rowsList()}
	<ul
		id="edit-history-body-{subject.kind}-{subjectId}"
		class="divide-surface-200-800 divide-y"
	>
		{#each rows as row (row.id)}
			<li
				class="flex flex-wrap items-start gap-2 py-2"
				data-redline-id={row.id}
			>
				<div class="min-w-0 flex-1 space-y-1">
					<p class="flex flex-wrap items-baseline gap-x-1 text-sm">
						<span class="font-semibold">{row.who}</span>
						<span class="text-surface-600-400">
							· {REDLINE_CAUSE_LABELS[row.cause]} ·
						</span>
						<span
							class="text-surface-600-400 text-xs"
							title={exact(row.at)}
						>
							{timeAgo(row.at)}
						</span>
					</p>
					{#if row.version}
						<p class="text-surface-600-400 text-xs">
							{versionLine(row.version)}
						</p>
					{/if}
					<ul class="space-y-1 text-sm">
						{#each row.changes as change (change.key)}
							{@const before = change.beforeFollows
								? FOLLOWS_CARD_TEXT
								: redlineValueText(
										change.before,
										change.wasAbsent
									)}
							{@const after = change.afterFollows
								? FOLLOWS_CARD_TEXT
								: redlineValueText(
										change.after,
										change.nowAbsent
									)}
							{@const id = `${row.id}:${change.key}`}
							<li class="min-w-0">
								{#if change.noPreview}
									<span class="text-surface-600-400">
										{change.label}:
									</span>
									<span class="break-words">
										{NO_PREVIEW_TEXT}
									</span>
								{:else if isShortChange(before, after)}
									<span class="text-surface-600-400">
										{change.label}:
									</span>
									<span class="break-words">
										{before} → {after}
									</span>
								{:else}
									<span class="text-surface-600-400">
										{change.label}
									</span>
									<button
										type="button"
										class="anchor text-xs"
										aria-expanded={shown.has(id)}
										onclick={() =>
											shown.has(id)
												? shown.delete(id)
												: shown.add(id)}
									>
										{shown.has(id)
											? HIDE_LABEL
											: SHOW_LABEL}
									</button>
									{#if shown.has(id)}
										<div class="mt-1 space-y-1">
											<div>
												<p
													class="text-surface-600-400 text-xs"
												>
													{BEFORE_LABEL}
												</p>
												<p
													class="bg-surface-100-900 rounded p-2 text-xs whitespace-pre-wrap"
												>
													{before}
												</p>
											</div>
											<div>
												<p
													class="text-surface-600-400 text-xs"
												>
													{AFTER_LABEL}
												</p>
												<p
													class="bg-surface-100-900 rounded p-2 text-xs whitespace-pre-wrap"
												>
													{after}
												</p>
											</div>
										</div>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
					{#if restoreError.get(row.id)}
						<p class="text-error-600-400 text-xs" role="alert">
							{restoreError.get(row.id)}
						</p>
					{/if}
				</div>
				{#if list?.canRestore}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title={restoreBlocked ?? RESTORE_TITLE}
						disabled={restoring.has(row.id) || !!restoreBlocked}
						onclick={() => restore(row.id)}
					>
						{RESTORE_LABEL}
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if rows.length && variant === "rows"}
	{@render rowsList()}
{:else if rows.length}
	<section
		class="border-surface-200-800 border-t pt-2"
		data-testid="edit-history"
	>
		<button
			type="button"
			class="hover:bg-surface-100-900 flex w-full items-center gap-2 rounded px-1 py-2 text-left text-sm font-semibold"
			aria-expanded={open}
			aria-controls="edit-history-body-{subject.kind}-{subjectId}"
			onclick={() => (open = !open)}
		>
			{#if open}
				<Icons.ChevronDown size={14} aria-hidden="true" />
			{:else}
				<Icons.ChevronRight size={14} aria-hidden="true" />
			{/if}
			{foldLabel(rows.length)}
		</button>
		{#if open}
			{@render rowsList()}
			{#if subject.kind === "version" && list?.canClear}
				<div class="pt-2">
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={() => (versionClearOpen = true)}
					>
						{CLEAR_ACTION_LABEL}
					</button>
				</div>
			{/if}
		{/if}
	</section>
{/if}

{#if variant === "fold"}
	<ClearEditHistoryDialog
		open={clearOpen || versionClearOpen}
		question={subject.question}
		sentence={subject.sentence(allRows.length)}
		busy={clearBusy}
		error={clearError}
		onConfirm={clearAll}
		onCancel={cancelClear}
	/>
{/if}
