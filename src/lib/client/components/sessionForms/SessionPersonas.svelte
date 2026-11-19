<script lang="ts">
	/**
	 * The Personas card on the Participants tab: the seated personas (a
	 * drag-to-reorder list), the card-less player seats with their name
	 * fields, and **Add a persona**. The form owns the lists, every move, drag
	 * and removal; the seat-name fields edit the form's draft in place.
	 */
	import * as Icons from "@lucide/svelte"
	import { dndzone, type DndEvent } from "svelte-dnd-action"
	import Avatar from "../Avatar.svelte"
	import CharacterPickRow from "./CharacterPickRow.svelte"
	import SeatBenchButton from "./SeatBenchButton.svelte"
	import SeatBringBackNote from "./SeatBringBackNote.svelte"
	import Select from "../inputs/Select.svelte"
	import SeatMoveConfirm from "./SeatMoveConfirm.svelte"
	import { groupPeople, type PendingPlayerSeat } from "./seatGroups"
	import type { PickMember } from "../modals/CharacterSelectModal.svelte"
	import type {
		PlayedByChoice,
		PlayerSeatDraft,
		SavedPlayerSeat,
		SeatCard,
		SeatKind
	} from "./editSessionForm"
	import { CARD_CLASS } from "./editSessionForm"

	interface Props {
		/** How many personas the genre needs; the heading stars it. */
		personasFloor: number
		selectedPersonas: SeatCard[]
		/** The card-less player seats; a name field edits its row in place. */
		playerSeats: PlayerSeatDraft[]
		/** A drag in progress: the seated zone shows its drop hint only when empty. */
		dragging: "character" | "persona" | null
		session: Sockets.Sessions.Get.Response["session"] | undefined
		isGuest: boolean
		userCtx: UserCtx
		savedPersonaSeat: (personaId: number) => SavedPlayerSeat | undefined
		savedPlayerSeat: (seatId: number) => SavedPlayerSeat | undefined
		handleSeatDrag: (
			kind: "character" | "persona",
			zone: "seated" | "benched",
			final: boolean,
			e: CustomEvent<DndEvent<SeatCard>>,
			group?: number
		) => void
		movePersonaUp: (index: number) => void
		movePersonaDown: (index: number) => void
		moveSeat: (kind: SeatKind, id: number, toBench: boolean) => void
		confirmRemovePersona: (id: number, name: string) => void
		fallenNote: (
			kind: "character" | "player",
			saved: { removedAt?: unknown; isActive?: boolean | null } | undefined
		) => boolean
		castMemberHref: (saved: object | undefined) => string | null
		seatPlayerWords: (userId: number | null) => string
		/** The session's people in order (the owner, then the saved guests): the order of the groups. */
		people: number[]
		/** A person in words: "You", the owner, a guest. */
		personName: (userId: number | null) => string
		/** Who plays a carded persona / a card-less named seat. */
		personaPlayer: (p: SeatCard) => number
		seatPlayer: (seat: PlayerSeatDraft) => number
		/** The "Played by" control of a named seat, or null where there is none. */
		playedByChoice: (kind: "player", id: number) => PlayedByChoice | null
		/** A pick in a "Played by" control: a handover, or a move choice that awaits confirmation. */
		pickPlayedBy: (kind: "player", id: number, value: string) => void
		confirmMove: (kind: "player", id: number) => void
		cancelMove: (kind: "player", id: number) => void
		/** False for a guest whose owner switched off bringing their own: every seat here is frozen. */
		canChangeCarded: boolean
		/** Open the persona picker for the person whose group asked. */
		onAddPersona: (who: number) => void
		/** The session's owner's view: the people whose group takes an added persona, cast member or named seat (the owner, then each saved guest who plays). Empty for a guest. */
		addFor: number[]
		/** The book's card-less members no seat holds, for **Add a cast member**. */
		membersForSeats: PickMember[]
		/** Cast members and named seats picked for a person, not yet saved. */
		pendingSeats: PendingPlayerSeat[]
		addMemberSeat: (member: PickMember, toUserId: number) => void
		addNamedSeat: (name: string, toUserId: number) => void
		removePendingSeat: (key: string) => void
		/** Shared cards picked to play and not yet saved: the viewer's own group. */
		sharedPicks: SeatCard[]
		onRemoveSharedPick: (id: number) => void
	}

	let {
		personasFloor,
		selectedPersonas,
		playerSeats = $bindable(),
		dragging,
		session,
		isGuest,
		userCtx,
		savedPersonaSeat,
		savedPlayerSeat,
		handleSeatDrag,
		movePersonaUp,
		movePersonaDown,
		moveSeat,
		confirmRemovePersona,
		fallenNote,
		castMemberHref,
		seatPlayerWords,
		people,
		personName,
		personaPlayer,
		seatPlayer,
		playedByChoice,
		pickPlayedBy,
		confirmMove,
		cancelMove,
		canChangeCarded,
		onAddPersona,
		addFor,
		membersForSeats,
		pendingSeats,
		addMemberSeat,
		addNamedSeat,
		removePendingSeat,
		sharedPicks,
		onRemoveSharedPick
	}: Props = $props()

	const me = $derived(userCtx.user?.id)
	/** Everyone with a group: the session's people, then any other player on a seat. */
	const players = $derived(
		groupPeople(people, [
			...(me != null ? [me] : []),
			...selectedPersonas.map(personaPlayer),
			...playerSeats.map(seatPlayer),
			...pendingSeats.map((p) => p.toUserId),
			...addFor
		])
	)
	const holds = (who: number) =>
		(who === me && sharedPicks.length > 0) ||
		pendingSeats.some((p) => p.toUserId === who) ||
		selectedPersonas.some((p) => personaPlayer(p) === who) ||
		playerSeats.some((s) => seatPlayer(s) === who)
	const holders = $derived(players.filter(holds))
	/** A group shows when it holds a seat, is the viewer's own and they may add a persona, or the owner may add to it. */
	const shown = $derived(
		players.filter(
			(w) =>
				holders.includes(w) ||
				(w === me && canChangeCarded) ||
				addFor.includes(w)
		)
	)
	/** The name typed for a new seat, by the group's person. */
	let seatNames: Record<number, string> = $state({})
</script>

<section class={CARD_CLASS}>
	<h3 class="mb-3 text-sm font-medium">
		Personas{personasFloor > 0 ? "*" : ""}
	</h3>
	{#each shown as who (who)}
		{@const rows = selectedPersonas.filter((p) => personaPlayer(p) === who)}
		{@const named = playerSeats.filter((s) => seatPlayer(s) === who)}
		<h4 class="text-surface-600-400 mb-1 text-xs">{personName(who)}</h4>
		<div
			class="relative mb-2 flex flex-col gap-1 {dragging === 'persona' &&
			rows.length === 0
				? 'border-surface-200-800 rounded-base min-h-11 border border-dashed'
				: ''}"
			use:dndzone={{
				items: rows,
				flipDurationMs: 150,
				dragDisabled: !session || !canChangeCarded || isGuest,
				type: "player-seat"
			}}
			onconsider={(e) =>
				handleSeatDrag(
					"persona",
					"seated",
					false,
					e,
					who
				)}
			onfinalize={(e) =>
				handleSeatDrag(
					"persona",
					"seated",
					true,
					e,
					who
				)}
		>
			{#each rows as p, gi (p.id)}
				{@const i = selectedPersonas.findIndex((x) => x.id === p.id)}
				{@const saved = savedPersonaSeat(p.id)}
				{@const mine =
					!isGuest || !saved || p.userId === userCtx.user?.id}
				{@const own = mine && canChangeCarded}
				{@const playedCard =
					!isGuest && saved
						? playedByChoice("player", saved.id)
						: null}
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
					<Avatar char={p} size="md" decorative />
					<div class="min-w-0 flex-1">
						<div
							class="text-lead truncate font-medium select-none"
						>
							{p.name}
						</div>
						<div
							class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
						>
							{isGuest ? seatPlayerWords(personaPlayer(p)) : p.description || ""}
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						{#if !isGuest && own && rows.length > 1}
							<button
								class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
								onclick={() => movePersonaUp(i)}
								disabled={gi === 0}
								title="Move up"
								aria-label="Move {p.name} up"
							>
								<Icons.ChevronUp size={16} />
							</button>
							<button
								class="btn-ghost text-surface-500 hover:text-foreground rounded p-1 disabled:opacity-30"
								onclick={() => movePersonaDown(i)}
								disabled={gi === rows.length - 1}
								title="Move down"
								aria-label="Move {p.name} down"
							>
								<Icons.ChevronDown size={16} />
							</button>
						{/if}
						{#if !own}
							<!-- Frozen, or another person's seat: no controls. -->
						{:else if saved}
							<SeatBenchButton kind="persona" id={p.id} label={p.name || ""} {moveSeat} />
						{:else}
							<span class="text-surface-600-400 text-xs">
								Ready to add
							</span>
							<button
								class="btn-ghost text-error-600-400 hover:bg-error-500/10 rounded p-1"
								onclick={() =>
									confirmRemovePersona(p.id, p.name || "")}
								title="Remove from session"
								aria-label="Remove {p.name} from the session"
							>
								<Icons.X size={16} />
							</button>
						{/if}
					</div>
					{#if fallenNote("player", saved)}
						<SeatBringBackNote {saved} label={p.name || ""} {castMemberHref} />
					{/if}
					{#if playedCard && saved}
						<div class="basis-full">
							<Select
								label="Played by"
								accessibleName="Played by, {p.name || 'this persona'}"
								options={playedCard.options}
								value={playedCard.value}
								onValueChange={(v) =>
									pickPlayedBy("player", saved.id, v)}
							/>
							{#if playedCard.move}
								<SeatMoveConfirm
									move={playedCard.move}
									onMove={() => confirmMove("player", saved.id)}
									onCancel={() => cancelMove("player", saved.id)}
								/>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if pendingSeats.some((p) => p.toUserId === who)}
			<ul class="mb-2 flex flex-col gap-1" aria-label="Seats to add">
				{#each pendingSeats.filter((p) => p.toUserId === who) as pending (pending.key)}
					<li
						class="bg-surface-50-950 rounded-base flex min-h-11 flex-wrap items-center gap-2 p-2"
					>
						<Icons.UserRound
							size={20}
							class="text-surface-500 shrink-0"
							aria-hidden="true"
						/>
						<div class="text-lead min-w-0 flex-1 truncate font-medium">
							{pending.name}
						</div>
						<span class="text-surface-600-400 text-xs">Ready to add</span>
						<button
							class="btn-ghost text-error-600-400 hover:bg-error-500/10 rounded p-1"
							onclick={() => removePendingSeat(pending.key)}
							title="Remove"
							aria-label="Remove {pending.name} from the session"
						>
							<Icons.X size={16} />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if named.length}
			<ul
				class="mb-2 flex flex-col gap-1"
				aria-label="Player seats without a card"
			>
				{#each named as seat (seat.id)}
					{@const mine = !isGuest || seat.userId === userCtx.user?.id}
					{@const saved = savedPlayerSeat(seat.id)}
					{@const played = playedByChoice("player", seat.id)}
					<li
						class="bg-surface-50-950 rounded-base flex min-h-11 flex-wrap items-center gap-2 p-2"
					>
						<Icons.UserRound
							size={20}
							class="text-surface-500 shrink-0"
							aria-hidden="true"
						/>
						<div class="min-w-0 flex-1">
							{#if mine}
								<input
									class="input text-lead"
									type="text"
									id="player-seat-{seat.id}"
									aria-label="Seat name"
									bind:value={seat.name}
								/>
							{:else}
								<div
									class="text-lead truncate font-medium select-none"
									id="player-seat-{seat.id}"
								>
									{seat.name}
								</div>
							{/if}
							<div
								class="text-surface-600-400 truncate text-xs select-none"
							>
								{seatPlayerWords(seatPlayer(seat))}
							</div>
						</div>
						{#if mine && canChangeCarded}
							<SeatBenchButton kind="player" id={seat.id} label={seat.name || "this seat"} {moveSeat} />
						{/if}
						{#if fallenNote("player", saved)}
							<SeatBringBackNote {saved} label={seat.name || "this seat"} {castMemberHref} />
						{/if}
						{#if played}
							<div class="basis-full">
								<Select
									label="Played by"
									accessibleName="Played by, {seat.name || 'this seat'}"
									options={played.options}
									value={played.value}
									onValueChange={(v) =>
										pickPlayedBy("player", seat.id, v)}
								/>
								{#if played.move}
									<SeatMoveConfirm
										move={played.move}
										onMove={() => confirmMove("player", seat.id)}
										onCancel={() => cancelMove("player", seat.id)}
									/>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if who === me && sharedPicks.length > 0}
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
		{#if (who === me && canChangeCarded) || addFor.includes(who)}
			<button
				class="btn btn-sm preset-tonal mb-2"
				onclick={() => onAddPersona(who)}
				aria-label={who === me
					? "Add a persona"
					: `Add a persona for ${personName(who)}`}
			>
				<Icons.Plus size={16} aria-hidden="true" />
				Add a persona
			</button>
		{/if}
		{#if addFor.includes(who)}
			{#if membersForSeats.length}
				<div class="mb-2">
					<Select
						label="Add a cast member"
						accessibleName="Add a cast member for {personName(who)}"
						placeholder="Choose a cast member"
						options={membersForSeats.map((m) => ({
							value: String(m.id),
							label: m.name
						}))}
						value=""
						onValueChange={(v) => {
							const m = membersForSeats.find((x) => String(x.id) === v)
							if (m) addMemberSeat(m, who)
						}}
					/>
				</div>
			{/if}
			<div class="mb-2 flex flex-wrap items-center gap-2">
				<input
					class="input min-w-0 flex-1"
					type="text"
					aria-label="New seat name"
					placeholder="Name a new seat"
					value={seatNames[who] ?? ""}
					oninput={(e) => (seatNames[who] = e.currentTarget.value)}
				/>
				<button
					class="btn btn-sm preset-tonal"
					disabled={!(seatNames[who] ?? "").trim()}
					onclick={() => {
						addNamedSeat(seatNames[who] ?? "", who)
						seatNames[who] = ""
					}}
				>
					Add a seat
				</button>
			</div>
		{/if}
	{/each}
</section>
