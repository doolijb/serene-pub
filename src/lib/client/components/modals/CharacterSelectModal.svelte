<script lang="ts" module>
	/**
	 * 🚧 A cast member the picker may offer (plan §34.2): the shown name, the
	 * face's media id, and the member's linked card (`null` when it has none).
	 * Its `id` is a MEMBER id — it shares a range with card ids, so it is never
	 * mixed into a card id list.
	 */
	export interface PickMember {
		id: number
		name: string
		faceMediaId?: number | null
		cardId: number | null
	}

	/**
	 * A book's members, as the picker offers them: the rows of
	 * `lorebooks:bindingList`, carded and card-less, overlay rows left out
	 * (an overlay row is its base member's, never seated on its own).
	 */
	export function castPickMembers(
		rows: readonly Sockets.Lorebooks.CastMemberRow[]
	): PickMember[] {
		return rows
			.filter((r) => r.overlayOf == null)
			.map((r) => ({
				id: r.id,
				name:
					r.ownNickname?.trim() ||
					r.name?.trim() ||
					"Unnamed character",
				faceMediaId: r.faceMediaId ?? null,
				cardId: r.characterId ?? null
			}))
	}
</script>

<script lang="ts">
	/**
	 * Pick characters from a list the caller hands in.
	 *
	 * Single mode: a press on a row picks it (`onSelect`). Multi mode
	 * (`multiSelect`): rows are checkboxes, and the footer's **Add N** hands
	 * back the ticked ids in the order they were ticked (`onMultiSelect`) —
	 * the order a cast was picked in is its order. Rows are the session
	 * form's `CharacterPickRow`, so the dialog and the form look alike.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import LoadingState from "../LoadingState.svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		characters: Partial<SelectCharacter>[]
		onOpenChange: (e: { open: boolean }) => void
		onSelect?: (
			character: Partial<SelectCharacter> & { id: number }
		) => void
		// Inline create. A picker must never be an overlay with nothing to
		// offer and no way to make something — on a fresh install there are
		// no characters at all, and the session form requires one. Callers
		// that can host a creator pass this; when absent, no create
		// affordance is rendered.
		onCreateNew?: () => void
		/** Tick several, then add them together with `onMultiSelect`. */
		multiSelect?: boolean
		/** The ticked ids, in the order they were ticked. */
		onMultiSelect?: (ids: number[], castMemberIds: number[]) => void
		/** Characters not to offer because they are already chosen. They go
		 *  here, not filtered out of `characters`: the empty state reads both
		 *  to tell "everyone is already chosen" from "none exist yet". */
		excludeIds?: number[]
		/** Multi mode: how many more fit — the genre's cap less what is
		 *  already chosen. Past it, the unticked rows are disabled. */
		selectedLimit?: number
		/** 🚧 The book's cast, carded and card-less, as the first group under
		 *  `castGroupLabel`; a carded member picks its card, a card-less one
		 *  (multi mode only) comes back in the second list. */
		castMembers?: PickMember[]
		/** The book's name — the first group's label. */
		castGroupLabel?: string
		/** Members not to offer because they are already seated. */
		excludeCastMemberIds?: number[]
		/** Cards another person shared: listed last, one press each. */
		sharedCards?: (Partial<SelectCharacter> & { id: number })[]
		onSelectShared?: (
			character: Partial<SelectCharacter> & { id: number }
		) => void
	}

	let {
		open = $bindable(),
		characters = [],
		onOpenChange,
		onSelect,
		onCreateNew,
		multiSelect = false,
		onMultiSelect,
		excludeIds = [],
		selectedLimit,
		castMembers = [],
		castGroupLabel = "",
		excludeCastMemberIds = [],
		sharedCards = [],
		onSelectShared
	}: Props = $props()
	let search = $state("")
	let searchInput = $state<HTMLInputElement | null>(null)
</script>

<Dialog {open} {onOpenChange} initialFocusEl={() => searchInput}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 relative flex max-h-[95dvh] w-[min(95vw,640px)] flex-col gap-4 overflow-hidden p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<Dialog.Title>
						{#snippet element(attributes)}
							<h2
								{...attributes as Record<string, unknown>}
								class="h2"
							>
								{multiSelect
									? "Add characters"
									: "Select character"}
							</h2>
						{/snippet}
					</Dialog.Title>
					<button
						type="button"
						aria-label="Close"
						class="btn btn-sm"
						onclick={() => onOpenChange({ open: false })}
					>
						<Icons.X size={20} aria-hidden="true" />
					</button>
				</header>
				<input
					bind:this={searchInput}
					aria-label="Search characters"
					class="input w-full"
					type="text"
					placeholder="Search characters..."
					bind:value={search}
				/>
				{#if open}
					{#await import("./CharacterSelectList.svelte")}
						<LoadingState />
					{:then { default: CharacterSelectList }}
						<CharacterSelectList
							{characters}
							{excludeIds}
							{castMembers}
							{excludeCastMemberIds}
							{castGroupLabel}
							{multiSelect}
							{selectedLimit}
							{search}
							{onSelect}
							{onCreateNew}
							{sharedCards}
							{onSelectShared}
							{onMultiSelect}
							{onOpenChange}
						/>
					{/await}
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
