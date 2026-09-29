<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
	import { READ_INTO_SESSION, STOP_READING } from "./scopes"

	/**
	 * Everything that is about the book rather than in it.
	 *
	 * It all lives behind the Manage button in the book's header, so the rail
	 * can hold nothing but views of the entries. Opening another book is here
	 * for the same reason: which book is open is a fact about the book, not a
	 * scope of one.
	 */
	interface BookChoice {
		id: number
		name: string
		count: number
	}

	interface Props {
		books: BookChoice[]
		openId: number | null
		/** What the open session is called, when one is reading this book. */
		readingInto: string | null
		/** Whether "Read into this session" would do anything. */
		canChangeReading: boolean
		/**
		 * The book the open session reads instead of this one, when it reads
		 * another — reading this one asks first, since it replaces that.
		 */
		readsOtherBook?: string | null
		onOpen: (id: number) => void
		onNew: () => void
		onImport: () => void
		onSettings: () => void
		onDuplicate: () => void
		onChangeReading: () => void
		onDelete: () => void
	}

	let {
		books,
		openId,
		readingInto,
		canChangeReading,
		readsOtherBook = null,
		onOpen,
		onNew,
		onImport,
		onSettings,
		onDuplicate,
		onChangeReading,
		onDelete
	}: Props = $props()

	/** RowMenu's row (STYLE-GUIDE §6.6), so this panel reads as one of them. */
	const row =
		"flex h-9 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
	const neutral = "hover:bg-surface-200-800"
	const destructive = "text-error-600-400 hover:bg-error-500/10"
</script>

<!-- Not a `RowMenu` (STYLE-GUIDE §6.6): the top half is a picker — which
     book is open is a choice with a current value (`aria-current`), not an
     action — so the panel stays buttons, drawn in RowMenu's rows so the two
     read as one family. -->
<div class="flex flex-col" data-lore-book-menu>
	<span class="text-surface-600-400 px-2.5 pt-1 pb-1 text-xs">Open</span>
	<ul class="flex max-h-56 flex-col overflow-y-auto">
		{#each books as b (b.id)}
			<li>
				<button
					type="button"
					class="{row} {b.id === openId
						? 'sidebar-row-active'
						: neutral}"
					aria-current={b.id === openId ? "true" : undefined}
					onclick={() => onOpen(b.id)}
				>
					<span class="min-w-0 flex-1 truncate">{b.name}</span>
					<span class="text-surface-600-400 shrink-0 text-xs">
						{b.count}
					</span>
				</button>
			</li>
		{/each}
	</ul>

	<hr class="border-surface-200-800 my-1" />
	<button class="{row} {neutral}" type="button" onclick={onNew}>
		<Icons.Plus size={16} class="shrink-0" aria-hidden="true" />
		<span class="min-w-0 truncate">New lorebook…</span>
	</button>
	<button class="{row} {neutral}" type="button" onclick={onImport}>
		<Icons.Upload size={16} class="shrink-0" aria-hidden="true" />
		<span class="min-w-0 truncate">Import a lorebook…</span>
	</button>

	{#if openId !== null}
		<hr class="border-surface-200-800 my-1" />
		<button class="{row} {neutral}" type="button" onclick={onSettings}>
			<Icons.SlidersHorizontal
				size={16}
				class="shrink-0"
				aria-hidden="true"
			/>
			<span class="min-w-0 truncate">Book settings</span>
		</button>
		<button
			class="{row} {neutral}"
			type="button"
			title="Copy this book, entries, cast and all"
			onclick={onDuplicate}
		>
			<Icons.Copy size={16} class="shrink-0" aria-hidden="true" />
			<span class="min-w-0 truncate">Duplicate</span>
		</button>
		<!-- Export is paused (owner ruling 2026-09-28): visible, disabled, and
		     says why. It takes no handler until it returns. -->
		<button
			class="{row} {neutral}"
			type="button"
			disabled
			title={LOREBOOK_EXPORT_PAUSED}
			aria-label="Export. {LOREBOOK_EXPORT_PAUSED}"
		>
			<Icons.Download size={16} class="shrink-0" aria-hidden="true" />
			<span class="min-w-0 truncate">Export…</span>
			<span class="text-surface-600-400 ml-auto shrink-0 text-[11px]"
				>Paused</span
			>
		</button>
		<button
			class="{row} {neutral}"
			type="button"
			disabled={!canChangeReading}
			title={!canChangeReading
				? "Open a session you own to read this book into it"
				: readingInto
					? `Stop reading this book into ${readingInto}`
					: readsOtherBook
						? `This session reads ${readsOtherBook}; reading this book replaces it`
						: undefined}
			onclick={onChangeReading}
		>
			{#if readingInto}
				<Icons.BookX size={16} class="shrink-0" aria-hidden="true" />
				<span class="min-w-0 truncate">
					Reading into {readingInto} · {STOP_READING.toLowerCase()}
				</span>
			{:else}
				<Icons.BookOpen size={16} class="shrink-0" aria-hidden="true" />
				<span class="min-w-0 truncate">{READ_INTO_SESSION}</span>
			{/if}
		</button>
		<hr class="border-surface-200-800 my-1" />
		<button class="{row} {destructive}" type="button" onclick={onDelete}>
			<Icons.Trash2 size={16} class="shrink-0" aria-hidden="true" />
			<span class="min-w-0 truncate">Delete this lorebook</span>
		</button>
	{/if}
</div>
