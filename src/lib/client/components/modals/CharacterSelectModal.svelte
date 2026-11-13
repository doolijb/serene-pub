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
	import CharacterPickRow, {
		pickRowMatches
	} from "../sessionForms/CharacterPickRow.svelte"
	import EmptyState from "../EmptyState.svelte"
	import ListGroupLabel from "../panels/ListGroupLabel.svelte"
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
		excludeCastMemberIds = []
	}: Props = $props()
	let search = $state("")
	/** Multi mode's ticks, in the order they were made. */
	let picked = $state<number[]>([])
	/** The ticked card-less members, in tick order — apart from `picked`. */
	let pickedMembers = $state<number[]>([])
	let searchInput = $state<HTMLInputElement | null>(null)

	type Row = Partial<SelectCharacter> & { id: number }

	let offered = $derived.by(() => {
		const excluded = new Set(excludeIds)
		return characters.filter(
			(c): c is Row => c.id != null && !excluded.has(c.id)
		)
	})

	/** Search matches only what a row shows (`pickRowMatches`). */
	let filtered = $derived(offered.filter((c) => pickRowMatches(c, search)))

	/** One entry per individual in the book's group: a member with an offered
	 *  card is ONE row that picks the card id; a card-less member picks its
	 *  own id (multi mode only). */
	type CastEntry = {
		key: string
		row: Row
		/** The card id picked, or `null` for a card-less member. */
		cardId: number | null
		memberId: number
		card?: Row
	}
	let castEntries = $derived.by((): CastEntry[] => {
		const excluded = new Set(excludeCastMemberIds)
		const cards = new Map(offered.map((c) => [c.id, c]))
		const out: CastEntry[] = []
		for (const m of castMembers) {
			if (excluded.has(m.id)) continue
			if (m.cardId != null) {
				const card = cards.get(m.cardId)
				if (!card) continue
				out.push({
					key: `member:${m.id}`,
					row: { ...card, name: m.name, nickname: undefined },
					cardId: m.cardId,
					memberId: m.id,
					card
				})
			} else if (multiSelect) {
				out.push({
					key: `member:${m.id}`,
					row: {
						id: m.id,
						name: m.name,
						avatarMediaId: m.faceMediaId ?? null
					},
					cardId: null,
					memberId: m.id
				})
			}
		}
		return out
	})
	let filteredCast = $derived(
		castEntries.filter((e) => pickRowMatches(e.row, search))
	)
	/** The offered cards not already shown as a cast member's row. */
	let otherCards = $derived.by(() => {
		const merged = new Set(
			castEntries.filter((e) => e.cardId != null).map((e) => e.cardId)
		)
		return filtered.filter((c) => !merged.has(c.id))
	})
	/** The book's group stands only when it has someone to offer. */
	const grouped = $derived(castEntries.length > 0)

	const total = $derived(picked.length + pickedMembers.length)
	const atLimit = $derived(selectedLimit != null && total >= selectedLimit)

	const emptyMessage = $derived(
		search
			? `No characters found matching "${search}".`
			: offered.length === 0 && characters.length > 0
				? "Everyone here is already chosen."
				: "No characters yet — create one to get started."
	)

	const addLabel = $derived(
		total === 0
			? "Add"
			: `Add ${total} ${total === 1 ? "character" : "characters"}`
	)

	/** Each opening starts with nothing ticked. */
	$effect(() => {
		if (open) {
			picked = []
			pickedMembers = []
		}
	})

	function toggle(id: number) {
		if (picked.includes(id)) {
			picked = picked.filter((p) => p !== id)
			return
		}
		if (atLimit) return
		picked = [...picked, id]
	}

	function toggleMember(id: number) {
		if (pickedMembers.includes(id)) {
			pickedMembers = pickedMembers.filter((p) => p !== id)
			return
		}
		if (atLimit) return
		pickedMembers = [...pickedMembers, id]
	}

	function confirmMulti() {
		if (!total) return
		onMultiSelect?.([...picked], [...pickedMembers])
		onOpenChange({ open: false })
	}
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
				{#if multiSelect && selectedLimit != null}
					<p class="text-surface-600-400 text-xs" role="status">
						{atLimit
							? "That's all there's room for — untick one to choose another."
							: `Room for ${selectedLimit} more.`}
					</p>
				{/if}
				{#if otherCards.length === 0 && filteredCast.length === 0}
					<EmptyState
						icon={Icons.Users}
						message={emptyMessage}
						ctaLabel={search || !onCreateNew
							? undefined
							: "New character"}
						onCta={search ? undefined : onCreateNew}
					/>
				{:else}
					{#snippet cardRows()}
						{#each otherCards as c (`card:${c.id}`)}
							<li>
								{#if multiSelect}
									<CharacterPickRow
										character={c}
										kind="checkbox"
										checked={picked.includes(c.id)}
										disabled={atLimit &&
											!picked.includes(c.id)}
										onchange={() => toggle(c.id)}
									/>
								{:else}
									<CharacterPickRow
										character={c}
										kind="button"
										onchange={() => onSelect?.(c)}
									/>
								{/if}
							</li>
						{/each}
					{/snippet}
					{#snippet castRows()}
						{#each filteredCast as e (e.key)}
							{@const on =
								e.cardId != null
									? picked.includes(e.cardId)
									: pickedMembers.includes(e.memberId)}
							<li>
								{#if multiSelect}
									<CharacterPickRow
										character={e.row}
										kind="checkbox"
										checked={on}
										disabled={atLimit && !on}
										onchange={() =>
											e.cardId != null
												? toggle(e.cardId)
												: toggleMember(e.memberId)}
									/>
								{:else}
									<CharacterPickRow
										character={e.row}
										kind="button"
										onchange={() =>
											e.card && onSelect?.(e.card)}
									/>
								{/if}
							</li>
						{/each}
					{/snippet}
					{#if !grouped}
						<ul
							class="flex min-h-0 flex-col gap-1 overflow-y-auto pr-2"
							aria-label="Characters"
						>
							{@render cardRows()}
						</ul>
					{:else}
						<div class="flex min-h-0 flex-col overflow-y-auto pr-2">
							{#if filteredCast.length > 0}
								<ListGroupLabel label={castGroupLabel} />
								<ul
									class="flex flex-col gap-1"
									aria-label="Cast members"
								>
									{@render castRows()}
								</ul>
							{/if}
							{#if otherCards.length > 0}
								<ListGroupLabel label="Your other characters" />
								<p
									class="text-surface-600-400 px-3 pb-1 text-xs"
								>
									Picking one adds someone new to the story.
								</p>
								<ul
									class="flex flex-col gap-1"
									aria-label="Characters"
								>
									{@render cardRows()}
								</ul>
							{/if}
						</div>
					{/if}
					{#if onCreateNew}
						<div class="panel-edge border-t pt-4">
							<button
								type="button"
								class="btn btn-sm preset-tonal-primary flex items-center gap-1"
								onclick={onCreateNew}
							>
								<Icons.Plus size={16} aria-hidden="true" /> New character
							</button>
						</div>
					{/if}
				{/if}
				{#if multiSelect}
					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={() => onOpenChange({ open: false })}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={total === 0}
							onclick={confirmMulti}
						>
							{addLabel}
						</button>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
