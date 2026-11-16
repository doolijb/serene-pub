<script lang="ts">
	/**
	 * 🚧 Book settings' **Timeline** switch: whether the book keeps time. Off,
	 * the book is read as it stands now, written undated, keeps no history and
	 * its story time does not move; nothing dated is deleted.
	 *
	 * Switching on saves at once. Switching off asks first, in place, only when
	 * the book holds something dated (its counts are read fresh, as the switch
	 * is used). The prompt's recommended way out is **Make a timeless copy**:
	 * the server makes a new lorebook from the line open in the workspace, and
	 * the source is left as it is, its switch on. Notes over a lorebook have no
	 * switch: they follow their lorebook's. A session's notes are offered only
	 * Cancel and Switch off here, as they cannot be copied as a lorebook.
	 */
	import * as Icons from "@lucide/svelte"
	import { v4 as uuid } from "uuid"
	import SettingSwitch from "$lib/client/components/admin/pub/SettingSwitch.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { interestKey } from "$lib/shared/sockets/interest"

	/**
	 * How long the copy may take before the card gives up waiting: a 3,000-entry
	 * lorebook copied in about 3 s under test (`timelessCopy.large.int.test.ts`),
	 * so this leaves room for a far larger one on a slow machine.
	 */
	const TIMELESS_COPY_TIMEOUT_MS = 60_000

	interface Props {
		lorebookId: number
		/** The book's switch as stored (`BookData.timelineEnabled`). */
		timelineEnabled: boolean
		/** The book is notes over a lorebook: it follows that lorebook's switch. */
		overlaysLorebook?: boolean
		/** The line open in the workspace; null is main. */
		branchId?: number | null
		/** That line's name; null is main. */
		branchName?: string | null
		/** How many lines the book has, main included. */
		lineCount?: number
		/** The book is a session's notes. */
		sessionNotes?: boolean
		/** The one-time upgrade pass switched this lorebook's timeline off. */
		offByPass?: boolean
		/** A copy landed: open it. */
		onDuplicated?: (lorebookId: number) => void
	}

	let {
		lorebookId,
		timelineEnabled,
		overlaysLorebook = false,
		branchId = null,
		branchName = null,
		lineCount = 1,
		sessionNotes = false,
		offByPass = false,
		onDuplicated
	}: Props = $props()

	const socket = useTypedSocket()
	let saving = $state(false)
	let copying = $state(false)
	let error = $state("")
	/** The counts the off prompt names; null when no prompt is open. */
	let asking = $state<string | null>(null)

	const plural = (n: number, one: string, many: string) =>
		`${n} ${n === 1 ? one : many}`

	async function save(next: boolean) {
		const requestId = uuid()
		saving = true
		error = ""
		try {
			await awaitReply({
				socket,
				event: "lorebooks:update",
				params: {
					lorebook: { id: lorebookId },
					timelineEnabled: next,
					requestId
				},
				errorEvent: "lorebooks:update:error",
				fallbackError: "The timeline could not be changed.",
				match: (data) => data?.requestId === requestId,
				matchError: (data) =>
					(data as { requestId?: string } | undefined)?.requestId ===
					requestId
			})
			asking = null
		} catch (err) {
			error =
				err instanceof Error && err.message
					? err.message
					: "The timeline could not be changed."
			asking = null
		} finally {
			saving = false
		}
	}

	async function makeCopy() {
		const requestId = uuid()
		saving = true
		copying = true
		error = ""
		try {
			const reply = await awaitReply({
				socket,
				event: "lorebooks:duplicate",
				params: {
					lorebookId,
					timeless: { branchId },
					requestId
				},
				errorEvent: "lorebooks:duplicate:error",
				fallbackError: "The lorebook could not be duplicated.",
				match: (data) => data?.requestId === requestId,
				matchError: (data) =>
					(data as { requestId?: string } | undefined)?.requestId ===
					requestId,
				timeoutMs: TIMELESS_COPY_TIMEOUT_MS
			})
			asking = null
			onDuplicated?.(reply.lorebook.id)
		} catch (err) {
			error =
				err instanceof Error && err.message
					? err.message
					: "The lorebook could not be duplicated."
		} finally {
			saving = false
			copying = false
		}
	}

	async function askOff() {
		saving = true
		error = ""
		let counts:
			| {
					datedChanges: number
					historyEntries: number
					presences?: number
					beginnings?: number
					clockSet: boolean
			  }
			| undefined
		try {
			const reply = await awaitReply({
				socket,
				event: "lorebooks:get",
				params: { id: lorebookId },
				replyKey: interestKey("lorebooks:get", lorebookId),
				errorEvent: "lorebooks:get:error",
				match: (d) => d?.lorebookId === lorebookId,
				matchError: (d) =>
					(d as { lorebookId?: number } | undefined)?.lorebookId ===
					lorebookId
			})
			counts = reply?.lorebook?.timelineCounts
		} catch (err) {
			counts = undefined
			error =
				err instanceof Error && err.message
					? err.message
					: "The timeline could not be changed."
		}
		// Counts that did not arrive are not "nothing dated": nothing is saved.
		if (!counts) {
			if (!error) error = "The timeline could not be changed."
			saving = false
			return
		}
		// The prompt names only what this lorebook holds.
		const parts: string[] = []
		if (counts.datedChanges > 0)
			parts.push(plural(counts.datedChanges, "dated version", "dated versions"))
		if (counts.historyEntries > 0)
			parts.push(plural(counts.historyEntries, "history entry", "history entries"))
		if ((counts.presences ?? 0) > 0)
			parts.push(plural(counts.presences ?? 0, "cast presence", "cast presences"))
		if ((counts.beginnings ?? 0) > 0)
			parts.push(
				plural(
					counts.beginnings ?? 0,
					"entry with a beginning",
					"entries with a beginning"
				)
			)
		if (counts.clockSet) parts.push("a story clock")
		if (parts.length === 0) {
			await save(false)
			return
		}
		asking =
			parts.length === 1
				? parts[0]
				: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
		saving = false
	}

	function onCheckedChange(e: { checked: boolean }) {
		if (saving || e.checked === timelineEnabled) return
		if (e.checked) void save(true)
		else void askOff()
	}
</script>

<section
	class="card preset-filled-surface-100-900 space-y-3 p-3"
	aria-labelledby="book-timeline-heading"
	data-lore-book-timeline
>
	<p
		id="book-timeline-heading"
		class="text-primary-ink flex items-center gap-1.5 text-xs font-semibold"
	>
		<Icons.History size={13} aria-hidden="true" />
		<!-- 🚧 -->Timeline
	</p>
	<p class="text-surface-700-300 text-sm">
		<!-- 🚧 -->Dates, versions over time, history and a story clock. Turn it off
		for a world where nothing needs a date.
	</p>
	{#if overlaysLorebook}
		<p class="text-sm" data-lore-book-timeline-follows>
			<!-- 🚧 -->{timelineEnabled ? "On" : "Off"}: these notes follow their
			lorebook's timeline.
		</p>
	{:else}
		<SettingSwitch
			name="book-timeline"
			label="Timeline"
			labelHidden
			checked={timelineEnabled}
			disabled={saving}
			{onCheckedChange}
		/>
		{#if offByPass && !timelineEnabled}
			<p class="text-surface-700-300 text-sm" data-lore-book-timeline-by-pass>
				<!-- 🚧 -->An update switched this off because nothing in this
				lorebook was dated. Switch it on to keep dates, history and a story
				clock.
			</p>
		{/if}
		{#if asking}
			<div
				class="bg-surface-50-950 rounded-base flex flex-col gap-2 p-3"
				role="group"
				aria-label="Switch the timeline off"
				data-lore-book-timeline-confirm
			>
				<p class="text-sm">
					<!-- 🚧 -->This lorebook has {asking}.
					With the timeline off that is hidden, not deleted, and sessions
					read the lorebook as it stands now.{#if !sessionNotes}{" "}
						A timeless copy keeps this one as it is.{/if}
				</p>
				{#if !sessionNotes && lineCount > 1}
					<p class="text-sm" data-lore-book-timeline-line>
						<!-- 🚧 -->The copy is made from the line {branchName ?? "main"}.
					</p>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={() => (asking = null)}
						disabled={saving}
					>
						<!-- 🚧 -->Cancel
					</button>
					<button
						type="button"
						class="btn btn-sm {sessionNotes
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						onclick={() => save(false)}
						disabled={saving}
					>
						<!-- 🚧 -->Switch off here
					</button>
					{#if !sessionNotes}
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500"
							onclick={makeCopy}
							disabled={saving}
						>
							<!-- 🚧 -->{copying ? "Copying…" : "Make a timeless copy"}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
	{#if error}
		<p class="text-error-600-400 text-sm" role="alert">{error}</p>
	{/if}
</section>
