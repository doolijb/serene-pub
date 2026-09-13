<script lang="ts">
	import * as Icons from "@lucide/svelte"

	/**
	 * Everything that is about the book rather than in it.
	 *
	 * It all lives behind the chip at the top of the rail, so the rail itself
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
		/** Whether "Read it into this session" would do anything. */
		canChangeReading: boolean
		onOpen: (id: number) => void
		onNew: () => void
		onImport: () => void
		onSettings: () => void
		onDuplicate: () => void
		onExport: () => void
		onChangeReading: () => void
		onDelete: () => void
	}

	let {
		books,
		openId,
		readingInto,
		canChangeReading,
		onOpen,
		onNew,
		onImport,
		onSettings,
		onDuplicate,
		onExport,
		onChangeReading,
		onDelete
	}: Props = $props()
</script>

<div class="flex flex-col gap-3" data-lore-book-menu>
	<div class="flex flex-col gap-1">
		<span class="text-surface-700-300 text-xs tracking-wide uppercase">
			Open
		</span>
		<ul class="flex max-h-56 flex-col gap-1 overflow-y-auto">
			{#each books as b (b.id)}
				<li>
					<button
						type="button"
						class="btn btn-sm w-full justify-start gap-2 {b.id ===
						openId
							? 'preset-filled-primary-500'
							: 'hover:preset-tonal-surface'}"
						aria-current={b.id === openId ? "true" : undefined}
						onclick={() => onOpen(b.id)}
					>
						<span class="min-w-0 flex-1 truncate text-left">
							{b.name}
						</span>
						<span class="badge preset-tonal-surface shrink-0">
							{b.count}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>

	<div class="border-border flex flex-col gap-1 border-t pt-2">
		<button
			class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
			type="button"
			onclick={onNew}
		>
			<Icons.Plus size={14} aria-hidden="true" />
			<span>New lorebook…</span>
		</button>
		<button
			class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
			type="button"
			onclick={onImport}
		>
			<Icons.Upload size={14} aria-hidden="true" />
			<span>Import a lorebook…</span>
		</button>
	</div>

	{#if openId !== null}
		<div class="border-border flex flex-col gap-1 border-t pt-2">
			<button
				class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
				type="button"
				onclick={onSettings}
			>
				<Icons.SlidersHorizontal size={14} aria-hidden="true" />
				<span>Book settings</span>
			</button>
			<button
				class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
				type="button"
				title="Copy this book, entries, cast and all"
				onclick={onDuplicate}
			>
				<Icons.Copy size={14} aria-hidden="true" />
				<span>Duplicate</span>
			</button>
			<button
				class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
				type="button"
				onclick={onExport}
			>
				<Icons.Download size={14} aria-hidden="true" />
				<span>Export…</span>
			</button>
			<button
				class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
				type="button"
				disabled={!canChangeReading}
				title={canChangeReading
					? undefined
					: "Open a session you own to read this book into it"}
				onclick={onChangeReading}
			>
				<Icons.BookOpen size={14} aria-hidden="true" />
				<span>
					{readingInto
						? `Reading into ${readingInto} · change`
						: "Read it into this session"}
				</span>
			</button>
			<button
				class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
				type="button"
				onclick={onDelete}
			>
				<Icons.Trash2 size={14} aria-hidden="true" />
				<span>Delete this lorebook</span>
			</button>
		</div>
		<p class="text-surface-700-300 text-xs">
			Everything that is about the book rather than in it lives here, so
			the rail can hold nothing but views of the entries.
		</p>
	{/if}
</div>
