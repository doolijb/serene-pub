<script lang="ts">
	/**
	 * 🚧 Book settings' **Writes from sessions** — the book's own lore write
	 * mode (owner ruling 2026-10-21, "Personal > Lorebook > Session"): Full,
	 * Review changes or Off for THIS book. It only tightens: sessions write at
	 * the stricter of this and the owner's own setting (Settings › User), and
	 * when the owner's own is the stricter, this card says so — the book's
	 * choice is not what is in force then.
	 *
	 * Saved as soon as it is picked, as the personal setting is: it is one
	 * choice, and changing it back is one more.
	 */
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { v4 as uuid } from "uuid"
	import LoreWriteModePicker from "$lib/client/components/inputs/LoreWriteModePicker.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		BOOK_LORE_WRITE_MODE_CHOICES,
		LORE_WRITE_MODE_CHOICES,
		effectiveLoreWriteMode,
		isLoreWriteMode,
		loreWriteLimit,
		type LoreWriteMode
	} from "$lib/shared/lorebooks/loreWriteMode"

	interface Props {
		lorebookId: number
		/** The book's own mode as stored (`lorebooks.lore_write_mode`). */
		current: string | null
	}

	let { lorebookId, current }: Props = $props()

	const socket = useTypedSocket()
	const userSettingsCtx = getContext<UserSettingsCtx | undefined>("userSettingsCtx")
	const systemSettingsCtx = getContext<SystemSettingsCtx | undefined>(
		"systemSettingsCtx"
	)
	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")

	/** The pick on screen while its save travels. */
	let pending = $state<LoreWriteMode | null>(null)
	let error = $state("")

	const stored = $derived<LoreWriteMode>(isLoreWriteMode(current) ? current : "full")
	const shown = $derived(pending ?? stored)
	const personal = $derived(
		effectiveLoreWriteMode(
			userSettingsCtx?.settings?.loreWriteMode,
			systemSettingsCtx?.settings?.loreWriteModeDefault
		)
	)
	const limit = $derived(loreWriteLimit({ personal, book: shown }))

	async function choose(mode: LoreWriteMode | null) {
		if (!mode || mode === stored) return
		const requestId = uuid()
		pending = mode
		error = ""
		try {
			await awaitReply({
				socket,
				event: "lorebooks:update",
				params: { lorebook: { id: lorebookId }, loreWriteMode: mode, requestId },
				errorEvent: "lorebooks:update:error",
				fallbackError: "Writes from sessions could not be changed.",
				match: (data) => data?.requestId === requestId,
				matchError: (data) =>
					(data as { requestId?: string } | undefined)?.requestId === requestId
			})
			toaster.success({
				title: "Writes from sessions changed",
				description: `${BOOK_LORE_WRITE_MODE_CHOICES[mode].label} for this book.`
			})
		} catch (err) {
			error =
				err instanceof Error && err.message
					? err.message
					: "Writes from sessions could not be changed."
		} finally {
			pending = null
		}
	}

	function openPersonal() {
		if (!panelsCtx) return
		panelsCtx.digest.settingsSection = "user"
		panelsCtx.openView("settings", { toggle: false })
	}
</script>

<section
	class="card preset-filled-surface-100-900 space-y-3 p-3"
	aria-labelledby="book-writes-heading"
	data-lore-book-writes
>
	<p
		id="book-writes-heading"
		class="text-primary-ink flex items-center gap-1.5 text-xs font-semibold"
	>
		<Icons.PenLine size={13} aria-hidden="true" />
		Writes from sessions
	</p>
	<p id="book-writes-help" class="text-surface-700-300 text-sm">
		How much sessions may write to this book: the scenes they capture, the
		stats they record, the links they draw. This book can allow less than
		your own setting, never more.
	</p>
	<LoreWriteModePicker
		legend="Writes from sessions to this book"
		name="book-lore-write-mode-{lorebookId}"
		value={shown}
		wording={BOOK_LORE_WRITE_MODE_CHOICES}
		describedBy="book-writes-help"
		disabled={pending !== null}
		onValueChange={choose}
	/>
	{#if limit.limitedBy === "personal"}
		<!-- Upstream is stricter (owner 2026-10-21): what is in force here is
		     the person's own setting, not this book's. -->
		<div
			class="border-warning-500/40 bg-warning-500/10 flex items-start gap-2 rounded-lg border p-3 text-sm"
			role="note"
			data-lore-book-writes-limited
		>
			<Icons.Info size={16} class="text-warning-500 mt-0.5 shrink-0" aria-hidden="true" />
			<div class="flex min-w-0 flex-col items-start gap-2">
				<span>
					Your own setting is <strong>{LORE_WRITE_MODE_CHOICES[personal].label}</strong>,
					which is stricter, so sessions write to this book as
					<strong>{LORE_WRITE_MODE_CHOICES[limit.mode].label}</strong>.
				</span>
				{#if panelsCtx}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface gap-1"
						onclick={openPersonal}
					>
						<Icons.Settings size={14} aria-hidden="true" />
						Change it in Settings › User
					</button>
				{/if}
			</div>
		</div>
	{/if}
	{#if error}
		<p class="text-error-600-400 text-sm" role="alert">{error}</p>
	{/if}
</section>
