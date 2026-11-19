<script lang="ts">
	/**
	 * The character picker's list, loaded by `CharacterSelectModal` when it
	 * opens. It mounts with each opening, so every opening starts with nothing
	 * ticked.
	 */
	import CharacterPickRow, {
		pickRowMatches
	} from "../sessionForms/CharacterPickRow.svelte"
	import EmptyState from "../EmptyState.svelte"
	import ListGroupLabel from "../panels/ListGroupLabel.svelte"
	import * as Icons from "@lucide/svelte"
	import type { PickMember } from "./CharacterSelectModal.svelte"

	interface Props {
		characters: Partial<SelectCharacter>[]
		excludeIds?: number[]
		castMembers?: PickMember[]
		excludeCastMemberIds?: number[]
		castGroupLabel?: string
		multiSelect?: boolean
		selectedLimit?: number
		search: string
		onSelect?: (
			character: Partial<SelectCharacter> & { id: number }
		) => void
		onCreateNew?: () => void
		/** Cards another person shared: listed last, one press each. */
		sharedCards?: (Partial<SelectCharacter> & { id: number })[]
		onSelectShared?: (
			character: Partial<SelectCharacter> & { id: number }
		) => void
		onMultiSelect?: (ids: number[], castMemberIds: number[]) => void
		onOpenChange: (e: { open: boolean }) => void
	}

	let {
		characters = [],
		excludeIds = [],
		castMembers = [],
		excludeCastMemberIds = [],
		castGroupLabel = "",
		multiSelect = false,
		selectedLimit,
		search,
		onSelect,
		onCreateNew,
		sharedCards = [],
		onSelectShared,
		onMultiSelect,
		onOpenChange
	}: Props = $props()
	/** Multi mode's ticks, in the order they were made. */
	let picked = $state<number[]>([])
	/** The ticked card-less members, in tick order — apart from `picked`. */
	let pickedMembers = $state<number[]>([])

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
	let filteredShared = $derived(
		sharedCards.filter((c) => pickRowMatches(c, search))
	)
	/** The book's group stands only when it has someone to offer. */
	const grouped = $derived(
		castEntries.length > 0 || filteredShared.length > 0
	)

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

{#if multiSelect && selectedLimit != null}
	<p class="text-surface-600-400 text-xs" role="status">
		{atLimit
			? "That's all there's room for — untick one to choose another."
			: `Room for ${selectedLimit} more.`}
	</p>
{/if}
{#if otherCards.length === 0 && filteredCast.length === 0 && filteredShared.length === 0}
	<EmptyState
		icon={Icons.Users}
		message={emptyMessage}
		ctaLabel={search || !onCreateNew ? undefined : "New character"}
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
						disabled={atLimit && !picked.includes(c.id)}
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
						onchange={() => e.card && onSelect?.(e.card)}
					/>
				{/if}
			</li>
		{/each}
	{/snippet}
	{#snippet sharedRows()}
		{#each filteredShared as c (`shared:${c.id}`)}
			<li>
				<CharacterPickRow
					character={c}
					kind="button"
					onchange={() => onSelectShared?.(c)}
				/>
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
				<ul class="flex flex-col gap-1" aria-label="Cast members">
					{@render castRows()}
				</ul>
			{/if}
			{#if otherCards.length > 0}
				<ListGroupLabel label="Your other characters" />
				<p class="text-surface-600-400 px-3 pb-1 text-xs">
					Picking one adds someone new to the story.
				</p>
				<ul class="flex flex-col gap-1" aria-label="Characters">
					{@render cardRows()}
				</ul>
			{/if}
			{#if filteredShared.length > 0}
				<ListGroupLabel label="Shared with you" />
				<p class="text-surface-600-400 px-3 pb-1 text-xs">
					Picking one puts a copy in this session; the original stays as
					it is.
				</p>
				<ul class="flex flex-col gap-1" aria-label="Shared characters">
					{@render sharedRows()}
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
