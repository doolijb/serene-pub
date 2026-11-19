<script lang="ts">
	/**
	 * The Characters card on the Participants tab: the seated characters (a
	 * drag-to-reorder list), the seated card-less cast members, and **Add a
	 * character**. The form owns the lists, every move, drag and removal;
	 * this draws them.
	 */
	import * as Icons from "@lucide/svelte"
	import { dndzone, type DndEvent } from "svelte-dnd-action"
	import Avatar from "../Avatar.svelte"
	import CharacterPickRow from "./CharacterPickRow.svelte"
	import SeatBenchButton from "./SeatBenchButton.svelte"
	import SeatBringBackNote from "./SeatBringBackNote.svelte"
	import Select from "../inputs/Select.svelte"
	import SeatMoveConfirm from "./SeatMoveConfirm.svelte"
	import { characterSummary } from "$lib/shared/characters/characterSummary"
	import type { PickMember } from "../modals/CharacterSelectModal.svelte"
	import type {
		PlayedByChoice,
		SavedCharacterSeat,
		SeatCard,
		SeatKind
	} from "./editSessionForm"
	import { CARD_CLASS } from "./editSessionForm"

	interface Props {
		/** How many characters the genre needs; the heading stars it. */
		charactersFloor: number
		selectedCharacters: SeatCard[]
		selectedMembers: PickMember[]
		/** A drag in progress: the seated zone shows its drop hint only when empty. */
		dragging: "character" | "persona" | null
		session: Sockets.Sessions.Get.Response["session"] | undefined
		/** A guest sees other people's seats read-only (G1). */
		isGuest: boolean
		userCtx: UserCtx
		/** Who plays a card, in words: a guest's second line on other people's characters. */
		seatPlayerWords: (userId: number | null) => string
		/** The session's owner: a seat seated by them is played by no person. */
		ownerId: number | null
		/** Who plays a character seat (the draft first, then the saved seater). */
		characterSeater: (c: SeatCard) => number
		memberSeater: (m: PickMember) => number
		/** The "Played by" control of a seat, or null where there is none. */
		playedByChoice: (
			kind: "character" | "member",
			id: number
		) => PlayedByChoice | null
		/** A pick in a "Played by" control: a handover, or a move choice that awaits confirmation. */
		pickPlayedBy: (
			kind: "character" | "member",
			id: number,
			value: string
		) => void
		confirmMove: (kind: "character" | "member", id: number) => void
		cancelMove: (kind: "character" | "member", id: number) => void
		savedCharacterSeat: (
			characterId: number
		) => SavedCharacterSeat | undefined
		savedMemberSeat: (memberId: number) => SavedCharacterSeat | undefined
		handleSeatDrag: (
			kind: "character" | "persona",
			zone: "seated" | "benched",
			final: boolean,
			e: CustomEvent<DndEvent<SeatCard>>
		) => void
		moveCharacterUp: (index: number) => void
		moveCharacterDown: (index: number) => void
		moveSeat: (kind: SeatKind, id: number, toBench: boolean) => void
		confirmRemoveCharacter: (id: number, name: string) => void
		confirmRemoveMember: (id: number, name: string) => void
		fallenNote: (
			kind: "character" | "player",
			saved: { removedAt?: unknown; isActive?: boolean | null } | undefined
		) => boolean
		castMemberHref: (saved: object | undefined) => string | null
		/** False for a guest whose owner switched off bringing their own: the seats holding a card are frozen. */
		canChangeCarded: boolean
		/** False for a guest whose owner switched off taking cast members: the card-less cast seats are frozen. */
		canChangeCastSeats: boolean
		/** Open the character picker. */
		onAddCharacter: () => void
		/** Shared cards picked and not yet saved, drawn under the seats. */
		sharedPicks: SeatCard[]
		onRemoveSharedPick: (id: number) => void
	}

	let {
		charactersFloor,
		selectedCharacters,
		selectedMembers,
		dragging,
		session,
		isGuest,
		userCtx,
		seatPlayerWords,
		ownerId,
		characterSeater,
		memberSeater,
		playedByChoice,
		pickPlayedBy,
		confirmMove,
		cancelMove,
		savedCharacterSeat,
		savedMemberSeat,
		handleSeatDrag,
		moveCharacterUp,
		moveCharacterDown,
		moveSeat,
		confirmRemoveCharacter,
		confirmRemoveMember,
		fallenNote,
		castMemberHref,
		canChangeCarded,
		canChangeCastSeats,
		onAddCharacter,
		sharedPicks,
		onRemoveSharedPick
	}: Props = $props()

	const me = $derived(userCtx.user?.id)
</script>

<section class={CARD_CLASS}>
	<h3 class="mb-3 text-sm font-medium">
		Characters{charactersFloor > 0 ? "*" : ""}
	</h3>
	{#key session?.sessionCharacters}
		<div
			class="relative mb-2 flex flex-col gap-1 {dragging === 'character' &&
			selectedCharacters.length === 0
				? 'border-surface-200-800 rounded-base min-h-11 border border-dashed'
				: ''}"
			use:dndzone={{
				items: selectedCharacters,
				flipDurationMs: 150,
				// A guest's drag would move other people's rows too: their
				// own keep the buttons (G1).
				dragDisabled: !session || !canChangeCarded || isGuest,
				type: "character-seat"
			}}
			onconsider={(e) =>
				handleSeatDrag(
					"character",
					"seated",
					false,
					e
				)}
			onfinalize={(e) =>
				handleSeatDrag(
					"character",
					"seated",
					true,
					e
				)}
		>
			{#each selectedCharacters as c, i (c.id)}
				{@const saved = savedCharacterSeat(
					c.id
				)}
				{@const label =
					c.nickname || c.name || ""}
				{@const mine = !isGuest || !saved || c.userId === me}
				{@const own = mine && canChangeCarded}
				{@const played = playedByChoice("character", c.id)}
				<div
					class="bg-surface-50-950 rounded-base flex min-h-11 flex-wrap items-center gap-2 p-2"
					data-dnd-handle
				>
					{#if !isGuest}
						<span
							class="text-surface-500 hover:text-primary-ink shrink-0 cursor-grab"
							data-dnd-handle
							title="Drag to reorder"
						>
							<Icons.GripVertical size={16} />
						</span>
					{/if}
					<Avatar
						char={c}
						size="md"
						decorative
					/>
					<div class="min-w-0 flex-1">
						<div
							class="text-lead truncate font-medium select-none"
						>
							{label}
						</div>
						<div
							class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
						>
							{characterSeater(c) !== ownerId
								? seatPlayerWords(characterSeater(c))
								: isGuest
									? ""
									: characterSummary(c)}
						</div>
					</div>
					<div
						class="flex shrink-0 items-center gap-1"
					>
						{#if !isGuest && own && selectedCharacters.length > 1}
							<button
								class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
								onclick={() =>
									moveCharacterUp(i)}
								disabled={i === 0}
								title="Move up"
								aria-label="Move {label} up"
							>
								<Icons.ChevronUp
									size={16}
								/>
							</button>
							<button
								class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
								onclick={() =>
									moveCharacterDown(
										i
									)}
								disabled={i ===
									selectedCharacters.length -
										1}
								title="Move down"
								aria-label="Move {label} down"
							>
								<Icons.ChevronDown
									size={16}
								/>
							</button>
						{/if}
						{#if !own}
							<!-- Frozen, or another person's seat: no controls. -->
						{:else if saved}
							<SeatBenchButton kind="character" id={c.id} {label} {moveSeat} />
						{:else}
							<span
								class="text-surface-600-400 text-xs"
							>
								Ready to add
							</span>
							<button
								class="btn-ghost text-error-600-400 hover:bg-error-500/10 rounded p-1"
								onclick={() =>
									confirmRemoveCharacter(
										c.id,
										label
									)}
								title="Remove from session"
								aria-label="Remove {label} from the session"
							>
								<Icons.X size={16} />
							</button>
						{/if}
					</div>
					{#if fallenNote("character", saved)}
						<SeatBringBackNote {saved} {label} {castMemberHref} />
					{/if}
					{#if played}
						<div class="basis-full">
							<Select
								label="Played by"
								accessibleName="Played by, {label}"
								options={played.options}
								value={played.value}
								onValueChange={(v) =>
									pickPlayedBy("character", c.id, v)}
							/>
							{#if played.move}
								<SeatMoveConfirm
									move={played.move}
									onMove={() => confirmMove("character", c.id)}
									onCancel={() => cancelMove("character", c.id)}
								/>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/key}
	{#if selectedMembers.length > 0}
		<div
			class="mb-2 flex flex-col gap-1"
			aria-label="Cast members"
		>
			{#each selectedMembers as m (`member:${m.id}`)}
				{@const saved = savedMemberSeat(m.id)}
				{@const own =
					canChangeCastSeats &&
					(!isGuest || !saved || saved.seatedByUserId === me)}
				{@const played = playedByChoice("member", m.id)}
				<div
					class="bg-surface-50-950 rounded-base flex min-h-11 flex-wrap items-center gap-2 p-2"
				>
					<Avatar
						char={{
							avatarMediaId: m.faceMediaId
						}}
						name={m.name}
						fallback="initial"
						size="md"
						decorative
					/>
					<div class="min-w-0 flex-1">
						<div class="text-lead truncate font-medium">
							{m.name}
						</div>
						{#if memberSeater(m) !== ownerId}
							<div
								class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
							>
								{seatPlayerWords(memberSeater(m))}
							</div>
						{/if}
					</div>
					{#if !own}
						<!-- Frozen, or another person's seat: no controls. -->
					{:else if saved}
						<SeatBenchButton kind="member" id={m.id} label={m.name} {moveSeat} />
					{:else}
						<span
							class="text-surface-600-400 text-xs"
						>
							Ready to add
						</span>
						<button
							class="btn-ghost text-error-600-400 hover:bg-error-500/10 rounded p-1"
							onclick={() =>
								confirmRemoveMember(
									m.id,
									m.name
								)}
							title="Remove from session"
							aria-label="Remove {m.name} from the session"
						>
							<Icons.X size={16} />
						</button>
					{/if}
					{#if fallenNote("character", saved)}
						<SeatBringBackNote {saved} label={m.name} {castMemberHref} />
					{/if}
					{#if played}
						<div class="basis-full">
							<Select
								label="Played by"
								accessibleName="Played by, {m.name}"
								options={played.options}
								value={played.value}
								onValueChange={(v) =>
									pickPlayedBy("member", m.id, v)}
							/>
							{#if played.move}
								<SeatMoveConfirm
									move={played.move}
									onMove={() => confirmMove("member", m.id)}
									onCancel={() => cancelMove("member", m.id)}
								/>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if sharedPicks.length > 0}
		<div
			class="mb-2 flex flex-col gap-1"
			role="group"
			aria-label="Shared cards to add"
		>
			{#each sharedPicks as c (`shared:${c.id}`)}
				{@const name = c.nickname || c.name || "Unnamed character"}
				<CharacterPickRow character={c} kind="chosen">
					{#snippet actions()}
						<button
							class="btn-ghost text-error-600-400 hover:bg-error-500/10 rounded p-1"
							onclick={() => onRemoveSharedPick(c.id)}
							title="Remove"
							aria-label="Remove {name}"
						>
							<Icons.X size={16} />
						</button>
					{/snippet}
				</CharacterPickRow>
			{/each}
		</div>
	{/if}
	{#if canChangeCarded || canChangeCastSeats}
		<button
			class="btn btn-sm preset-tonal"
			onclick={onAddCharacter}
		>
			<Icons.Plus size={16} aria-hidden="true" />
			Add a character
		</button>
	{/if}
</section>
