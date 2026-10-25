<script lang="ts">
	/**
	 * 🚧 Said by a review screen that saves into a lorebook, before any work,
	 * when this person's lore write mode is Off (plan A22): the save would be
	 * refused, and here is where the setting lives.
	 *
	 * The way there is a button (less-confusing G6): it opens Settings at its
	 * User section (`digest.settingsSection`, consumed by `SettingsSidebar`,
	 * the same door the SillyTavern import's buttons use), where **Lorebook
	 * writes from sessions** is. Drawn with no shell around it (no
	 * `panelsCtx`: a test, a page outside the layout) it says the whole
	 * sentence instead, naming the setting's place in words.
	 */
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import {
		BOOK_LORE_WRITES_OFF_NOTICE_ACTION,
		BOOK_LORE_WRITES_OFF_NOTICE_LEAD,
		LORE_WRITES_OFF_NOTICE,
		LORE_WRITES_OFF_NOTICE_ACTION,
		LORE_WRITES_OFF_NOTICE_LEAD
	} from "$lib/shared/lorebooks/loreWriteMode"
	import { DEFAULT_SCOPE } from "$lib/shared/lorebooks/loreRoute"

	interface Props {
		/**
		 * Called after Settings is asked to open, so a host drawn over the
		 * page (a modal) can step aside and let the setting be seen.
		 */
		onOpenSettings?: () => void
		/**
		 * Which level is Off (`useLoreWritesOff().by`): the person's own
		 * setting (the default), or the book's — then the button opens that
		 * book's Book settings instead.
		 */
		by?: "personal" | "lorebook" | null
		/** The book, for `by: "lorebook"`. */
		lorebookId?: number | null
	}

	let { onOpenSettings, by = "personal", lorebookId = null }: Props = $props()

	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")
	const bookIsOff = $derived(by === "lorebook" && lorebookId != null)

	function openSettings() {
		if (!panelsCtx) return
		if (bookIsOff) {
			// The book's own page, the way Jump opens a book (`digest.lore`).
			panelsCtx.digest.lore = {
				lorebookId: lorebookId!,
				scope: DEFAULT_SCOPE,
				settings: true
			}
			panelsCtx.openView("lorebooks", { toggle: false })
		} else {
			panelsCtx.digest.settingsSection = "user"
			panelsCtx.openView("settings", { toggle: false })
		}
		onOpenSettings?.()
	}
</script>

<div
	class="border-warning-500/40 bg-warning-500/10 flex items-start gap-2 rounded-lg border p-3 text-sm"
	role="note"
	data-lore-writes-off
>
	<Icons.TriangleAlert size={16} class="text-warning-500 mt-0.5 shrink-0" aria-hidden="true" />
	{#if panelsCtx}
		<div class="flex min-w-0 flex-col items-start gap-2">
			<span>
				{bookIsOff ? BOOK_LORE_WRITES_OFF_NOTICE_LEAD : LORE_WRITES_OFF_NOTICE_LEAD}
			</span>
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface gap-1"
				data-lore-writes-off-open-settings
				onclick={openSettings}
			>
				<Icons.Settings size={14} aria-hidden="true" />
				{bookIsOff ? BOOK_LORE_WRITES_OFF_NOTICE_ACTION : LORE_WRITES_OFF_NOTICE_ACTION}
			</button>
		</div>
	{:else}
		<span>{LORE_WRITES_OFF_NOTICE}</span>
	{/if}
</div>
