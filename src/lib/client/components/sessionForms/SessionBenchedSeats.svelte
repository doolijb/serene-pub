<script lang="ts">
	/**
	 * The Benched card on the Participants tab: the seats in the session but
	 * out of the turns, in a characters list (drop target, then card-less cast
	 * members) and a players list (drop target, then card-less player seats).
	 * The form owns the lists, every move and every drag; this draws them and
	 * reports a card-less seat's removal.
	 */
	import * as Icons from "@lucide/svelte"
	import { dndzone, type DndEvent } from "svelte-dnd-action"
	import Avatar from "../Avatar.svelte"
	import BenchedSeatRow from "./BenchedSeatRow.svelte"
	import { seatFellInStory, seatHasNoLines } from "./benchedSeats"
	import { inPlay } from "$lib/shared/sessions/inPlay"
	import { characterSummary } from "$lib/shared/characters/characterSummary"
	import type { PickMember } from "../modals/CharacterSelectModal.svelte"
	import type {
		PlayerSeatDraft,
		SavedCharacterSeat,
		SavedPlayerSeat,
		SeatCard,
		SeatKind
	} from "./editSessionForm"
	import { CARD_CLASS } from "./editSessionForm"

	interface Props {
		showCharactersSection: boolean
		showPersonasSection: boolean
		benchedCharacters: SeatCard[]
		benchedMembers: PickMember[]
		benchedPersonas: SeatCard[]
		benchedPlayerSeats: PlayerSeatDraft[]
		/** A drag in progress: the benched zones show their drop hint only then. */
		dragging: "character" | "persona" | null
		session: Sockets.Sessions.Get.Response["session"] | undefined
		isGuest: boolean
		userCtx: UserCtx
		savedCharacterSeat: (
			characterId: number
		) => SavedCharacterSeat | undefined
		savedMemberSeat: (memberId: number) => SavedCharacterSeat | undefined
		savedPersonaSeat: (personaId: number) => SavedPlayerSeat | undefined
		savedPlayerSeat: (seatId: number) => SavedPlayerSeat | undefined
		handleSeatDrag: (
			kind: "character" | "persona",
			zone: "seated" | "benched",
			final: boolean,
			e: CustomEvent<DndEvent<SeatCard>>
		) => void
		moveSeat: (kind: SeatKind, id: number, toBench: boolean) => void
		openReassignModal: (
			type: "character" | "persona",
			oldId: number,
			name: string
		) => void
		confirmRemoveCharacter: (id: number, name: string) => void
		confirmRemoveMember: (id: number, name: string) => void
		confirmRemovePersona: (id: number, name: string) => void
		seatPlayerWords: (userId: number | null) => string
		/** The session's owner: a seat seated by them is played by no person. */
		ownerId: number | null
		/** Who plays each kind of seat (the draft first, then the saved row). */
		characterSeater: (c: SeatCard) => number
		memberSeater: (m: PickMember) => number
		personaPlayer: (p: SeatCard) => number
		seatPlayer: (seat: PlayerSeatDraft) => number
		/** False for a guest whose owner switched off bringing their own: benched seats holding a card, and card-less player seats, are frozen. */
		canChangeCarded: boolean
		/** False for a guest whose owner switched off taking cast members: benched card-less cast seats are frozen. */
		canChangeCastSeats: boolean
		/** Drop a card-less player seat from the bench draft. */
		onRemoveBenchedPlayerSeat: (id: number) => void
	}

	let {
		showCharactersSection,
		showPersonasSection,
		benchedCharacters,
		benchedMembers,
		benchedPersonas,
		benchedPlayerSeats,
		dragging,
		session,
		isGuest,
		userCtx,
		savedCharacterSeat,
		savedMemberSeat,
		savedPersonaSeat,
		savedPlayerSeat,
		handleSeatDrag,
		moveSeat,
		openReassignModal,
		confirmRemoveCharacter,
		confirmRemoveMember,
		confirmRemovePersona,
		seatPlayerWords,
		ownerId,
		characterSeater,
		memberSeater,
		personaPlayer,
		seatPlayer,
		canChangeCarded,
		canChangeCastSeats,
		onRemoveBenchedPlayerSeat
	}: Props = $props()
</script>

<section class={CARD_CLASS}>
	<h3 class="mb-1 text-sm font-medium">Benched</h3>
	<p class="text-surface-600-400 mb-3 text-xs">
		In the session, out of the turns. Their lines stay
		theirs.
	</p>
	{#if showCharactersSection}
		{#if benchedCharacters.length + benchedMembers.length > 0 || dragging === 'character'}
			<h4 class="text-surface-600-400 mb-1 text-xs">
				Characters
			</h4>
		{/if}
		{#key session?.sessionCharacters}
			<ul
				class="relative mb-2 flex flex-col gap-1 {dragging === 'character'
					? 'border-surface-200-800 rounded-base min-h-11 border border-dashed'
					: ''}"
				aria-label="Benched characters"
				use:dndzone={{
					items: benchedCharacters,
					flipDurationMs: 150,
					dragDisabled: !canChangeCarded || isGuest,
					type: "character-seat"
				}}
				onconsider={(e) =>
					handleSeatDrag(
						"character",
						"benched",
						false,
						e
					)}
				onfinalize={(e) =>
					handleSeatDrag(
						"character",
						"benched",
						true,
						e
					)}
			>
				{#each benchedCharacters as c (c.id)}
					{@const saved = savedCharacterSeat(c.id)}
					{@const label = c.nickname || c.name || ""}
					{@const fallen =
						!!saved &&
						seatFellInStory(
							session,
							saved,
							"character"
						)}
						{@const own =
							canChangeCarded &&
							(!isGuest || c.userId === userCtx.user?.id)}
						{@const onServer =
							own && !!saved && !inPlay(saved)}
						<BenchedSeatRow
							name={label}
						meta={characterSeater(c) !== ownerId
							? seatPlayerWords(characterSeater(c))
							: isGuest
								? ""
								: characterSummary(c)}
						{fallen}
							seatAction="character:{c.id}"
							grip={own && !isGuest}
							canBringBack={own}
						onBringBack={() =>
							moveSeat("character", c.id, false)}
						menuItems={[
							onServer &&
								!fallen && {
									label: "Reassign…",
									icon: Icons.ArrowRightLeft,
									onSelect: () =>
										openReassignModal(
											"character",
											c.id,
											label
										)
								},
							onServer &&
								seatHasNoLines(saved) && {
									separator: true
								},
							onServer &&
								seatHasNoLines(saved) && {
									label: "Remove",
									icon: Icons.X,
									destructive: true,
									onSelect: () =>
										confirmRemoveCharacter(
											c.id,
											label
										)
								}
						]}
					>
						{#snippet face()}
							<Avatar
								char={c}
								size="md"
								decorative
							/>
						{/snippet}
					</BenchedSeatRow>
				{/each}
			</ul>
		{/key}
		{#if benchedMembers.length > 0}
			<ul
				class="mb-2 flex flex-col gap-1"
				aria-label="Benched cast members"
			>
				{#each benchedMembers as m (`member:${m.id}`)}
					{@const saved = savedMemberSeat(m.id)}
					{@const fallen =
						!!saved &&
						seatFellInStory(
							session,
							saved,
							"character"
						)}
						{@const own =
							canChangeCastSeats &&
							(!isGuest || saved?.seatedByUserId === userCtx.user?.id)}
						{@const onServer = own && !!saved && !inPlay(saved)}
					<BenchedSeatRow
						name={m.name}
						meta={memberSeater(m) !== ownerId
							? seatPlayerWords(memberSeater(m))
							: ""}
						{fallen}
						seatAction="member:{m.id}"
							canBringBack={own}
						onBringBack={() =>
							moveSeat("member", m.id, false)}
						menuItems={[
							onServer &&
								seatHasNoLines(saved) && {
									label: "Remove",
									icon: Icons.X,
									destructive: true,
									onSelect: () =>
										confirmRemoveMember(
											m.id,
											m.name
										)
								}
						]}
					>
						{#snippet face()}
							<Avatar
								char={{
									avatarMediaId:
										m.faceMediaId
								}}
								name={m.name}
								fallback="initial"
								size="md"
								decorative
							/>
						{/snippet}
					</BenchedSeatRow>
				{/each}
			</ul>
		{/if}
	{/if}
	{#if showPersonasSection}
		{#if benchedPersonas.length + benchedPlayerSeats.length > 0 || dragging === 'persona'}
			<h4 class="text-surface-600-400 mb-1 text-xs">
				Players
			</h4>
		{/if}
		<ul
			class="relative mb-2 flex flex-col gap-1 {dragging === 'persona'
				? 'border-surface-200-800 rounded-base min-h-11 border border-dashed'
				: ''}"
			aria-label="Benched players"
			use:dndzone={{
				items: benchedPersonas,
				flipDurationMs: 150,
				dragDisabled: !canChangeCarded || isGuest,
				type: "player-seat"
			}}
			onconsider={(e) =>
				handleSeatDrag("persona", "benched", false, e)}
			onfinalize={(e) =>
				handleSeatDrag("persona", "benched", true, e)}
		>
			{#each benchedPersonas as p (p.id)}
				{@const saved = savedPersonaSeat(p.id)}
				{@const fallen =
					!!saved &&
					seatFellInStory(session, saved, "player")}
					{@const own =
						canChangeCarded &&
						(!isGuest || p.userId === userCtx.user?.id)}
					{@const onServer = own && !!saved && !inPlay(saved)}
					<BenchedSeatRow
						name={p.name || ""}
						meta={seatPlayerWords(personaPlayer(p))}
					{fallen}
						seatAction="persona:{p.id}"
						grip={own && !isGuest}
						canBringBack={own}
					onBringBack={() =>
						moveSeat("persona", p.id, false)}
					menuItems={[
						onServer &&
							!fallen && {
								label: "Reassign…",
								icon: Icons.ArrowRightLeft,
								onSelect: () =>
									openReassignModal(
										"persona",
										p.id,
										p.name || ""
									)
							},
						onServer &&
							seatHasNoLines(saved) && {
								separator: true
							},
						onServer &&
							seatHasNoLines(saved) && {
								label: "Remove",
								icon: Icons.X,
								destructive: true,
								onSelect: () =>
									confirmRemovePersona(
										p.id,
										p.name || ""
									)
							}
					]}
				>
					{#snippet face()}
						<Avatar char={p} size="md" decorative />
					{/snippet}
				</BenchedSeatRow>
			{/each}
		</ul>
		{#if benchedPlayerSeats.length > 0}
			<ul
				class="mb-2 flex flex-col gap-1"
				aria-label="Benched player seats without a card"
			>
				{#each benchedPlayerSeats as seat (seat.id)}
					{@const mine =
						!isGuest ||
						seat.userId === userCtx.user?.id}
					{@const saved = savedPlayerSeat(seat.id)}
					{@const fallen =
						!!saved &&
						seatFellInStory(
							session,
							saved,
							"player"
						)}
					{@const onServer =
						canChangeCarded && !!saved && !inPlay(saved)}
					<BenchedSeatRow
						name={seat.name || "This seat"}
						meta={seatPlayerWords(seatPlayer(seat))}
						{fallen}
						seatAction="player:{seat.id}"
						canBringBack={mine && canChangeCarded}
						onBringBack={() =>
							moveSeat("player", seat.id, false)}
						menuItems={[
							mine &&
								onServer &&
								seatHasNoLines(saved) && {
									label: "Remove",
									icon: Icons.X,
									destructive: true,
									onSelect: () =>
										onRemoveBenchedPlayerSeat(seat.id)
								}
						]}
					>
						{#snippet face()}
							<Icons.UserRound
								size={20}
								class="text-surface-500 shrink-0"
								aria-hidden="true"
							/>
						{/snippet}
					</BenchedSeatRow>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
