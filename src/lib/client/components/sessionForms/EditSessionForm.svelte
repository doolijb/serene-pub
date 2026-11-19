<script lang="ts">
	import SessionVisibilityPanel from "./SessionVisibilityPanel.svelte"
	import SessionActions from "./SessionActions.svelte"
	import SessionTags from "./SessionTags.svelte"
	import SessionBenchedSeats from "./SessionBenchedSeats.svelte"
	import SessionCharacters from "./SessionCharacters.svelte"
	import SessionPersonas from "./SessionPersonas.svelte"
	import {
		CARD_CLASS,
		STANDARD_GENRE_ID,
		cardLabel,
		characterPositionsOf,
		seatedThenBenchedIds,
		sessionSchema,
		type BenchChange,
		type GuestRow,
		type PlayedByChoice,
		type PlayerSeatDraft,
		type SavedCharacterSeat,
		type SavedPlayerSeat,
		type SeatCard,
		type SeatKind,
		type ValidationErrors
	} from "./editSessionForm"
	import { splitSharedRows } from "$lib/shared/utils/sharedRows"
	/**
	 * A session's own settings: its name, then Participants, Settings and
	 * Privacy.
	 *
	 * EDIT ONLY. Starting a session is `StartSessionForm` — genre, preset, who
	 * is in it, a name — and the derivations both screens would otherwise each
	 * carry live in `createSession.svelte.ts`. A session keeps its genre for
	 * life, so the one genre control here is the upgrade along the same type.
	 */
	import { sameFormValue } from "$lib/client/forms/sameFormValue"
	import PipelineCards from "./PipelineCards.svelte"
	import { showsAdvancedControls } from "$lib/client/advancedControls"
	import AdvancedHiddenLine from "$lib/client/components/AdvancedHiddenLine.svelte"
	import SessionAttributes from "./SessionAttributes.svelte"
	import SessionAnnexPanel from "./SessionAnnexPanel.svelte"
	import RetakeAskSetting from "./RetakeAskSetting.svelte"
	import RulesOptions from "./RulesOptions.svelte"
	import { howStrictChoices } from "$lib/shared/rulesets/rulesOffer"
	import SessionLorebookReading from "./SessionLorebookReading.svelte"
	import { BookTime } from "$lib/client/lorebooks/time/bookTime.svelte"
	import {
		LORE_WRITE_MODE_CHOICES,
		effectiveLoreWriteMode,
		isLoreWriteMode,
		loreWriteLimit,
		type LoreWriteMode
	} from "$lib/shared/lorebooks/loreWriteMode"
	import {
		DEFAULT_SCOPE,
		emptyRoute,
		reduce,
		toHash
	} from "$lib/shared/lorebooks/loreRoute"
	import type { StoryClock } from "$lib/shared/lorebooks/storyDate"
	import { STORY_CLOCK_KEYS, stripUnmovedReading } from "./sessionReadingPatch"
	import {
		clockMoveBackAsking,
		openBranchedSession
	} from "../sessionPage/clockMoveBackConfirm"
	import {
		adoptSavedGenreFields,
		changedGenreFields
	} from "./genreFieldsPatch"
	import { guestChanges } from "./guestChanges"
	import { genreVersion, genreVersionLabel } from "./createSession.svelte"
	import { storedPlayerLabel } from "$lib/shared/sessions/playerLabel"
	import {
		GUEST_SEAT_SENTENCES,
		storedGuestSeatSwitches
	} from "$lib/shared/sessions/guestSeats"
	import { storedSceneSettings } from "$lib/shared/sessions/sceneSettings"
	import type { SceneSettingsDecl } from "@serene-pub/sdk"
	import SessionSceneSettings from "./SessionSceneSettings.svelte"
	import SessionSettingsForm from "./SessionSettingsForm.svelte"
	import SessionPresetControl from "./SessionPresetControl.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import CharacterSelectModal, {
		castPickMembers,
		type PickMember
	} from "../modals/CharacterSelectModal.svelte"
	import CharacterCreatorModal from "../modals/CharacterCreatorModal.svelte"
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import ReassignSessionParticipantModal from "../modals/ReassignSessionParticipantModal.svelte"
	import UserSelectModal from "../modals/UserSelectModal.svelte"
	import * as Icons from "@lucide/svelte"
	import { TRIGGERS, type DndEvent } from "svelte-dnd-action"
	import { seatFellInStory } from "./benchedSeats"
	import {
		differingHandovers,
		playerSeatsForOf,
		type PendingPlayerSeat,
		fillGroupSlots,
		groupPeople,
		handoverSeatOf,
		isMoveValue,
		MOVE_TO_AI,
		moveTargetOf,
		moveToPersonValue,
		seatMovesOf,
		swapWithinGroup
	} from "./seatGroups"
	import { SvelteMap } from "svelte/reactivity"
	import { inPlay } from "$lib/shared/sessions/inPlay"
	import RemoveFromSessionModal from "../modals/RemoveFromSessionModal.svelte"
	import SessionsUnsavedChangesModal from "../modals/SessionsUnsavedChangesModal.svelte"
	import { onMount, getContext, tick } from "svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import FieldHelp from "../FieldHelp.svelte"
	import { notify } from "$lib/client/utils/notify"
	import ActionConfirm from "../sessionPage/ActionConfirm.svelte"
	import { askingOf } from "../sessionPage/actionConfirmAsking"
	import {
		SHARE_LABELS,
		SHARE_CONFIRMS,
		SESSION_NOTES_LABEL,
		BOOK_LOCK_LINES
	} from "$lib/shared/lorebooks/sessionNotes"
	import { resolveUserHandle } from "$lib/shared/utils/resolveCharacterName"
	import { sessionBookOf } from "$lib/client/sessions/store/derive"
	import PipelineConfigOptions from "../pipelines/PipelineConfigOptions.svelte"
	import DocPeek from "$lib/client/components/docs/DocPeek.svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import LoadingState from "../LoadingState.svelte"
	import PanelTabStrip from "../panels/PanelTabStrip.svelte"
	import { actionIdentity } from "$lib/shared/actions/identity"
	import { isCardlessPlayerSeat } from "$lib/shared/sessions/playerSeat"
	import {
		castNameOf,
		seatCardAsShown
	} from "$lib/client/components/sessionPage/projections/characters"



	interface Props {
		/**
		 * The session this screen edits. Required in practice: starting one is
		 * `StartSessionForm`'s, and this screen shows a spinner until
		 * `sessions:get` answers for the id.
		 */
		editSessionId?: number | null
		showEditSessionForm: boolean // Controls visibility of the form
		hasChanges?: boolean // Track if the form has unsaved changes
		onClose?: () => void
		/**
		 * Show the back chevron — the list is behind this screen, off screen
		 * (compact). At desk the list stands beside it, so no back (Q3); a
		 * row click there leaves through the view's unsaved-changes gate.
		 */
		showBack?: boolean
		/**
		 * 🚧 The tab the form opens on (2026-10-18): the session header's
		 * **Session settings** opens it on Settings. Absent: Participants.
		 */
		initialTab?: "participants" | "settings" | "visibility"
	}

	let {
		editSessionId = $bindable(null),
		showEditSessionForm = $bindable(),
		hasChanges = $bindable(false),
		onClose,
		showBack = false,
		initialTab
	}: Props = $props()

	const socket = useTypedSocket()

	/**
	 * The one input/textarea chrome this form uses: Skeleton's field preset —
	 * theme-aware background, a focus ring that is already primary — with this
	 * view's corner radius.
	 */
	const FIELD_CLASS = "input rounded-base"

	// STATE VARIABLES

	// Tag-related state
	let tagsList: SelectTag[] = $state([])
	let tagSearchInput = $state("")
	let showTagSuggestions = $state(false)
	let selectedTags: string[] = $state([])

	let session: Sockets.Sessions.Get.Response["session"] | undefined = $state()
	/** The rows another person shared, kept apart from `characters` (G3). */
	let sharedRows: Sockets.Characters.List.Response["characterList"] =
		$state([])
	/** Shared cards picked in a picker and not yet saved: a copy is made on Save. */
	let sharedPicks = $state<{ kind: "character" | "player"; card: SeatCard }[]>(
		[]
	)
	const sharedOfKind = (kind: "character" | "player") =>
		sharedToOffer.filter(
			(r) => !sharedPicks.some((p) => p.kind === kind && p.card.id === r.id)
		) as SeatCard[]
	function addSharedPick(kind: "character" | "player", card: SeatCard) {
		if (!sharedPicks.some((p) => p.kind === kind && p.card.id === card.id))
			sharedPicks = [...sharedPicks, { kind, card }]
		if (kind === "character") showCharacterModal = false
		else showPersonaModal = false
	}
	function removeSharedPick(kind: "character" | "player", id: number) {
		sharedPicks = sharedPicks.filter(
			(p) => !(p.kind === kind && p.card.id === id)
		)
	}
	const sharedPicksOf = (kind: "character" | "player") =>
		sharedPicks.filter((p) => p.kind === kind).map((p) => p.card)

	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let lorebookList: Sockets.Lorebooks.List.Response["lorebookList"] = $state(
		[]
	)
	/** Every book's name by id, from the reply before the picker's filters: a shared or provided book is still named on the read-only line. */
	let lorebookNames: Record<number, string> = $state({})

	// Data structure to hold session and selected characters/personas
	let data:
		| {
				session: {
					id: number | undefined
					name: string
					scenario: string
					lorebookId?: number | null
					tags: string[]
					genreId?: string
					genreFields?: Record<string, unknown>
					onRevision?: "overwrite" | "branch"
					rigour?: string | null
				}
				characterIds: number[]
				/** 🚧 The card-less members seated as characters (member ids, never card ids). */
				castMemberIds: number[]
				personaIds: number[]
				guestIds: number[]
				characterPositions: Record<number, number>
				/** The `playerLabel` override (R4); blank = the genre's. */
				playerLabel: string
				/** 🚧 Owner's switch: guests can bring their own characters (held until Save). */
				guestsBringOwn: boolean
				/** 🚧 Owner's switch: guests can take cast members (held until Save). */
				guestsTakeCast: boolean
				/** 🚧 The scene settings override (live scenes §4–§5), as JSON; "null" = the genre's. */
				sceneSettings: string
				/** 🚧 The live card-less player seats, by id, with their names. */
				playerSeats: Array<{ id: number; name: string }>
				/** 🚧 The "Played by" handovers held until Save: only those that differ from the saved person, by key. */
				seatHandovers: Array<{ key: string; toUserId: number }>
				/** 🚧 Shared cards picked and not yet saved, each seated as a copy (guests only). */
				sharedCardSeats: Array<{
					characterId: number
					kind: "character" | "player"
				}>
				/** 🚧 Seats the owner named for other people, held until Save (`sessions:update`'s `playerSeatsFor`). */
				playerSeatsFor: ReturnType<typeof playerSeatsForOf>
		  }
		| undefined = $state()

	let originalData:
		| {
				session: {
					id: number | undefined
					name: string
					scenario: string
					lorebookId?: number | null
					tags: string[]
					genreId?: string
					genreFields?: Record<string, unknown>
					onRevision?: "overwrite" | "branch"
					rigour?: string | null
				}
				characterIds: number[]
				/** 🚧 The card-less members seated as characters (member ids, never card ids). */
				castMemberIds: number[]
				personaIds: number[]
				guestIds: number[]
				characterPositions: Record<number, number>
				/** The `playerLabel` override (R4); blank = the genre's. */
				playerLabel: string
				/** 🚧 Owner's switch: guests can bring their own characters (held until Save). */
				guestsBringOwn: boolean
				/** 🚧 Owner's switch: guests can take cast members (held until Save). */
				guestsTakeCast: boolean
				/** 🚧 The scene settings override (live scenes §4–§5), as JSON; "null" = the genre's. */
				sceneSettings: string
				/** 🚧 The live card-less player seats, by id, with their names. */
				playerSeats: Array<{ id: number; name: string }>
				/** 🚧 The "Played by" handovers held until Save: only those that differ from the saved person, by key. */
				seatHandovers: Array<{ key: string; toUserId: number }>
				/** 🚧 Shared cards picked and not yet saved, each seated as a copy (guests only). */
				sharedCardSeats: Array<{
					characterId: number
					kind: "character" | "player"
				}>
				/** 🚧 Seats the owner named for other people, held until Save (`sessions:update`'s `playerSeatsFor`). */
				playerSeatsFor: ReturnType<typeof playerSeatsForOf>
		  }
		| undefined = $state()

	// DATA FIELDS
	let name = $state("")
	let scenario = $state("")
	let lorebookId: number | null = $state(null)
	/**
	 * 🚧 Where the session reads its book (ruling 15): the line (null = main)
	 * and the session's story clock (DESIGN-story-time P3; null follows the
	 * line's present). Only for the SAVED book — a book picked but not yet
	 * saved starts at its most recently used line with no clock of its own
	 * (it follows that line's present), and is pointed after the save.
	 */
	let savedLorebookId: number | null = $state(null)
	let lorebookBranchId: number | null = $state(null)
	let storyClock: StoryClock | null = $state(null)

	// CHAT MODE (19 §2, U-C2)
	let modesList: Sockets.Sessions.Genres.Response["genres"] = $state([])
	/** 🚧 The genre's session presets (2026-10-19): the Preset control. */
	let sessionPresetRows: Sockets.SessionAdmin.PresetRow[] = $state([])
	$effect(() =>
		requestWithInterest("sessionPresets:list", {}, (msg: any) => {
			sessionPresetRows = msg?.presets ?? []
		})
	)
	/** The genre's presets a session may switch to — the Preset card shows only when there is a choice. */
	const switchablePresets = $derived(
		sessionPresetRows.filter(
			(p) =>
				p.genreId === genreId &&
				p.enabled &&
				!(p as { withdrawnAt?: unknown }).withdrawnAt
		)
	)
	let genreId: string = $state(STANDARD_GENRE_ID)
	let genreFields: Record<string, unknown> = $state({})
	/**
	 * 🚧 **On revision** (PLAN-rulesets §28): what deleting or regenerating
	 * the latest turn does — overwrite it, or branch the session there. A
	 * session setting for every genre, not a genre field.
	 */
	let onRevision: "overwrite" | "branch" = $state("overwrite")
	/**
	 * 🚧 **How strict** (PLAN-rulesets §21; NOMENCLATURE §28): one of the
	 * genre's options, changeable mid-session (ruled). Changed in the derived
	 * settings below (lane 7), which write it at once; held here only so Save
	 * never posts back a value it did not move.
	 */
	let rigour: string | null = $state(null)
	const rulesOffer = $derived(
		modesList.find((m) => m.genreId === genreId)?.rules ?? null
	)
	// 🚧 Only what the session's rules play (2026-10-18): Story, Words only.
	const howStrictOptions = $derived(
		howStrictChoices(
			rulesOffer,
			(session as { primaryRuleset?: string | null } | null | undefined)
				?.primaryRuleset ?? null
		)
	)
	/**
	 * What this session calls a person's own lines (lair re-plan R4): its
	 * override, blank for the genre's `playerLabel`. Offered only when the
	 * genre declares one; stored on the row's `metadata`, never a column.
	 */
	let playerLabelOverride = $state("")
	/** 🚧 The owner's two guest seat switches, as drafted here (held until Save). */
	let guestsBringOwn = $state(true)
	let guestsTakeCast = $state(true)
	/**
	 * 🚧 The session's scene settings override (live scenes §4–§5): its
	 * Scenes mode, boundary triggers and Summaries; null follows the
	 * genre's. Stored on the row's `metadata` with Save, never a column.
	 */
	let sceneOverride = $state<SceneSettingsDecl | null>(null)

	// The selected mode's shape, or null when the mode is unknown to this
	// build — in which case the form falls back to today's behaviour (every
	// capability shown), the F29 posture.
	let modeShape = $derived(
		modesList.find((m) => m.genreId === genreId)?.shape ?? null
	)
	/** The genre's `playerLabel` (R4) — absent when it declares none. */
	let genrePlayerLabel = $derived(
		modesList.find((m) => m.genreId === genreId)?.playerLabel
	)
	// A capability the shape omits (or caps at zero) does not exist for the
	// session: its section disappears rather than rendering an un-fillable
	// requirement. No shape at all means "behave as before modes existed".
	let showCharactersSection = $derived(
		!modeShape ||
			(!!modeShape.characters && (modeShape.characters.max ?? 1) !== 0)
	)
	let showPersonasSection = $derived(
		!modeShape ||
			(!!modeShape.personas && (modeShape.personas.max ?? 1) !== 0)
	)
	let showLorebookField = $derived(!modeShape || !!modeShape.lorebook)
	/** Naming a seat (`take-seat`) is offered only in a genre of player seats: one with a player label and personas. */
	let guestsMayNameSeat = $derived(
		!!genrePlayerLabel?.trim() && showPersonasSection
	)
	// Save floors: a non-standard mode's shape speaks for itself. The
	// standard mode keeps the form's historical ≥1 character / ≥1 persona
	// floor even though its shape says min 0 — the shape states what the
	// *server* permits, and relaxing the form here would change today's
	// creation UX, which the parity posture forbids.
	let charactersFloor = $derived(
		!modeShape ? 1 : (modeShape.characters?.min ?? 0)
	)
	let personasFloor = $derived(
		!modeShape ? 1 : (modeShape.personas?.min ?? 0)
	)
	// The mode's declared per-session fields (SettingsSchema), rendered through
	// the one schema renderer in session settings.
	let modeFieldDecls = $derived(modeShape?.fields ?? {})

	let activeSessionTab = $state<"participants" | "settings" | "visibility">(
		"participants"
	)
	// 🚧 The tab an opener named (the session header's Session settings):
	// taken whenever it names one, so a second ask lands there again.
	$effect(() => {
		if (initialTab) activeSessionTab = initialTab
	})

	// The pipelines involved in this chat (respond + enabled contributed
	// functions like narrate), each rendered as its own settings card at
	// session scope. Fetched lazily when the Settings tab opens.
	let sessionPipelines: Sockets.Sessions.Pipelines.Pipeline[] = $state([])
	const handleSessionsPipelines = (
		msg: Sockets.Sessions.Pipelines.Response
	) => {
		if (msg.sessionId === editSessionId) sessionPipelines = msg.pipelines
	}

	/**
	 * A pipeline setting saved in the settings rows (a prompt picked in
	 * **Read the wording**) is also shown by the Pipelines cards; each card
	 * re-reads its own view, which it already listens for.
	 */
	const rereadPipelineCards = (field: { address: { kind: string } }) => {
		if (field.address.kind !== "pipeline" || !session?.id) return
		for (const p of sessionPipelines)
			socket.emit("pipelines:get", { slug: p.slug, sessionId: session.id })
	}

	// The account-visibility view (design §4): what of the current user's data
	// this session exposes to its other participants. Fetched lazily when the
	// tab opens.
	let accountVisibility = $state<
		Sockets.Sessions.AccountVisibility.Response | undefined
	>(undefined)

	// MODALS
	let showCharacterModal = $state(false)
	let showPersonaModal = $state(false)
	// Inline create from the pickers. A fresh install has no characters and no
	// personas, and the standard genre's floors require one of each — without
	// these the pickers are dead ends and the first session can never be
	// created. Close-then-open, never nested: both are skeleton Dialog +
	// Portal at z-50 and there is no nested-Dialog precedent in the repo.
	let showCharacterCreator = $state(false)
	let showPersonaCreator = $state(false)
	let showGuestModal = $state(false)
	let showReassignModal = $state(false)
	let reassignTarget: {
		type: "character" | "persona"
		oldId: number
		name: string
	} | null = $state(null)

	// FORM SUBMIT STATE
	/**
	 * Not `JSON.stringify` (`sameFormValue`): a genre field's number input
	 * hands back `"5"` for `5`, a cleared field is `""` where the row held
	 * `null`, `genreFields` keys come back in the server's order, and tags,
	 * personas and guests are sets. The cast is ordered — its order is the
	 * turn order (`characterPositions`).
	 */
	let isDirty: boolean = $derived(
		(!!data &&
			!!originalData &&
			!sameFormValue(
				$state.snapshot(data),
				$state.snapshot(originalData),
				{
					unordered: ["session.tags", "personaIds", "guestIds"]
				}
			)) ||
			participantChangesDirty()
	)
	let canSave: boolean = $derived(
		// Name plus the mode's participant floors — for the standard mode
		// these are the historical ≥1/≥1, so nothing changes there.
		!!(
			data?.session.name.trim() &&
			(data?.characterIds.length ?? 0) +
				(data?.castMemberIds.length ?? 0) +
				(data?.sharedCardSeats.filter((p) => p.kind === "character")
					.length ?? 0) >=
				charactersFloor &&
			(data?.personaIds.length ?? 0) +
				(data?.playerSeats.length ?? 0) +
				(data?.playerSeatsFor.filter((p) => p.characterId == null)
					.length ?? 0) +
				(data?.sharedCardSeats.filter((p) => p.kind === "player")
					.length ?? 0) >=
				personasFloor
		)
	)

	// Sync hasChanges with isDirty
	$effect(() => {
		hasChanges = isDirty
	})

	// SELECTED CHARACTERS AND PERSONAS
	// Populated either from the full session load (session.sessionCharacters/Personas,
	// which carry the complete row) or from CharacterSelectModal/
	// PersonaSelectModal (which only carry the display-column subset from
	// "characters:list") — Partial<...> reflects the latter. A persona is a
	// character the user voices, so both lists hold the same row shape.
	/**
	 * The four seated lists hold the seats IN PLAY in the draft; the four
	 * `benched…` lists hold the benched ones, in the same row shapes (owner
	 * 2026-11-10). `data` carries both, so Save never unseats a benched seat.
	 */
	let selectedCharacters: SeatCard[] = $state([])
	let selectedPersonas: SeatCard[] = $state([])
	let benchedCharacters: SeatCard[] = $state([])
	let benchedPersonas: SeatCard[] = $state([])
	/**
	 * 🚧 The session's card-less character seats, shown as their cast member
	 * (`cardlessSeatShown`, by MEMBER id): held until Save, which sends the
	 * whole set as `castMemberIds`.
	 */
	let selectedMembers: PickMember[] = $state([])
	let benchedMembers: PickMember[] = $state([])
	/** The session's book's members, for **Add a character**. */
	let bookMembers: PickMember[] = $state([])
	/** Only card-less members make the picker multi (★s4-seat-live-1): a carded
	 *  member travels as its card id, like any card. */
	const membersToOffer = $derived(
		bookMembers.filter(
			(m) =>
				m.cardId == null &&
				!selectedMembers.some((s) => s.id === m.id) &&
				!benchedMembers.some((s) => s.id === m.id) &&
				!heldByPlayerSeat(m.id)
		)
	)
	/** Whether a player seat, saved or picked here, already holds the member: one member, one seat. */
	const heldByPlayerSeat = (memberId: number): boolean =>
		pendingSeats.some((p) => p.castMemberId === memberId) ||
		!!session?.sessionPersonas?.some(
			(cp) => cp.castMemberId === memberId && !cp.removedAt
		)
	let playerSeats: PlayerSeatDraft[] = $state([])
	let benchedPlayerSeats: PlayerSeatDraft[] = $state([])
	/**
	 * The guests the form wants. A pending change like the cast (note 34):
	 * added and removed here, committed by Save as the difference from the
	 * session's saved guests (`guestChanges`), dropped with the form. A row
	 * picked but not yet saved carries only the user the picker returned.
	 */
	let selectedGuests: GuestRow[] = $state([])
	/**
	 * Participant writes Save sent and not yet answered (guests, a cast
	 * member's enabled switch, an envoy's seat) — the form closes after, so a
	 * refusal can still be told. Every path of each write's handler answers
	 * (a refusal on its own event, a throw or the setup gate on `:error`), so
	 * the form closes on the answers alone.
	 */
	let participantWritesInFlight = $state(0)
	let closeWhenParticipantsSettle = false

	/**
	 * An envoy's seat, held until Save (note 34): the switch shows the draft,
	 * and Save sends only what differs from the saved row, so flipping one back
	 * is clean (§6.14).
	 */
	let envoyDraft: Record<string, boolean> = $state({})

	// The saved side of each seat, read off the live row (`removedAt` unset).
	const savedCharacterSeat = (characterId: number) =>
		session?.sessionCharacters?.find(
			(cc) => cc.characterId === characterId && !cc.removedAt
		)
	const savedMemberSeat = (memberId: number) =>
		session?.sessionCharacters?.find(
			(cc) =>
				cc.castMemberId === memberId &&
				cc.characterId == null &&
				!cc.removedAt
		)
	const savedPersonaSeat = (personaId: number) =>
		session?.sessionPersonas?.find(
			(cp) => cp.personaId === personaId && !cp.removedAt
		)
	const savedPlayerSeat = (seatId: number) =>
		session?.sessionPersonas?.find(
			(cp) => cp.id === seatId && !cp.removedAt
		)

	// ---- The people of the session and who plays each seat ("Played by") ----
	/** The viewer's id (0 before the user is known). */
	const viewerId = $derived.by(() => userCtx.user?.id ?? 0)
	const ownerId: number | null = $derived(session?.userId ?? null)
	/** A guest who is a player, saved (never one pending in the form). */
	const savedPlayerGuests = $derived(
		selectedGuests.filter((g) =>
			session?.sessionGuests?.some(
				(s) => s.userId === g.userId && s.isPlayer !== false
			)
		)
	)
	/** The session's people: the owner, then the saved guests, in the form's guest order. */
	const seatPeople = $derived<number[]>([
		...(ownerId != null ? [ownerId] : []),
		...selectedGuests
			.filter((g) =>
				session?.sessionGuests?.some((s) => s.userId === g.userId)
			)
			.map((g) => g.userId)
	])
	/** 🚧 The handovers picked here, held until Save: `character:<cardId>` · `member:<castMemberId>` · `player:<playerSeatId>` to the person's user id. */
	const handoverDraft = new SvelteMap<string, number>()
	/** The person a saved seat has now, by draft key (the draft compares against it). */
	const savedHandoverPerson = (key: string): number | null | undefined => {
		const [kind, raw] = key.split(":")
		const id = Number(raw)
		if (kind === "character") return savedCharacterSeat(id)?.seatedByUserId
		if (kind === "member") return savedMemberSeat(id)?.seatedByUserId
		return savedPlayerSeat(id)?.userId
	}
	/** Who plays a character seat: the draft, the saved seater, then the viewer for an unsaved row. A saved seat with no seater is the owner's. */
	const seaterOf = (
		key: string,
		saved: { seatedByUserId?: number | null } | undefined
	): number =>
		handoverDraft.get(key) ??
		(saved ? (saved.seatedByUserId ?? ownerId ?? viewerId) : viewerId)
	const characterSeater = (c: SeatCard): number =>
		seaterOf(`character:${c.id}`, savedCharacterSeat(c.id))
	const memberSeater = (m: PickMember): number =>
		seaterOf(`member:${m.id}`, savedMemberSeat(m.id))
	/** 🚧 The person each unsaved carded persona was picked for (the owner's, in a guest's group). */
	const cardFor = new SvelteMap<number, number>()
	/** 🚧 Card-less cast members and named seats the owner picked for a person, held until Save. */
	let pendingSeats: PendingPlayerSeat[] = $state([])
	let pendingSeatCount = 0
	/** Whose group asked for the persona picker now (null: the viewer's). */
	let personaAskedBy: number | null = null
	/** Who plays a carded persona: the draft, then the saved player, else the card's owner; an unsaved row, the person it was picked for. */
	const personaPlayer = (p: SeatCard): number => {
		const saved = savedPersonaSeat(p.id)
		return saved
			? (handoverDraft.get(`player:${saved.id}`) ??
					saved.userId ??
					p.userId ??
					viewerId)
			: (cardFor.get(p.id) ?? viewerId)
	}
	/** The book's card-less members no seat of the form holds, for **Add a cast member**. */
	const membersForSeats = $derived(
		bookMembers.filter(
			(m) =>
				m.cardId == null &&
				!selectedMembers.some((s) => s.id === m.id) &&
				!benchedMembers.some((s) => s.id === m.id) &&
				!heldByPlayerSeat(m.id)
		)
	)
	const addMemberSeat = (m: PickMember, toUserId: number) => {
		pendingSeats = [
			...pendingSeats,
			{ key: `member:${m.id}`, toUserId, castMemberId: m.id, name: m.name }
		]
	}
	const addNamedSeat = (seatName: string, toUserId: number) => {
		const name = seatName.trim()
		if (!name) return
		pendingSeats = [
			...pendingSeats,
			{ key: `name:${++pendingSeatCount}`, toUserId, seatName: name, name }
		]
	}
	const removePendingSeat = (key: string) => {
		pendingSeats = pendingSeats.filter((p) => p.key !== key)
	}
	/** Who plays a card-less named seat: the draft, then the saved player, then the viewer. */
	const seatPlayer = (seat: PlayerSeatDraft): number =>
		handoverDraft.get(`player:${seat.id}`) ??
		savedPlayerSeat(seat.id)?.userId ??
		seat.userId ??
		viewerId
	/** 🚧 A person in words: "You", the owner (a guest reads their username), a guest by name. */
	const personName = (userId: number | null | undefined): string => {
		if (userId != null && userId === userCtx.user?.id) return "You"
		if (userId != null && userId === ownerId)
			return (
				accountVisibility?.viewers
					?.find((v) => v.role === "owner")
					?.username?.trim() || "The session's owner"
			)
		const guest = selectedGuests.find((g) => g.userId === userId)
		return (
			guest?.user?.displayName?.trim() ||
			guest?.user?.username?.trim() ||
			"Someone else"
		)
	}
	/** 🚧 The moves picked and confirmed here, held until Save: `player:<playerSeatId>` to the AI-played group, `character:<cardId>` / `member:<castMemberId>` to a person's Personas group. */
	const moveDraft = new SvelteMap<string, string>()
	/** A move choice picked and not yet confirmed or cancelled, by the same keys. */
	const movePick = new SvelteMap<string, string>()
	/** Who owns a seat's card: undefined for a card-less seat. */
	const cardOwnerOf = (
		kind: "character" | "member" | "player",
		id: number
	): number | null | undefined => {
		if (kind === "member") return undefined
		if (kind === "character")
			return selectedCharacters.find((c) => c.id === id)?.userId ?? null
		const saved = savedPlayerSeat(id)
		return saved?.personaId != null ? (saved.persona?.userId ?? null) : undefined
	}
	/** The seat's name as its row shows it. */
	const seatNameOf = (
		kind: "character" | "member" | "player",
		id: number
	): string => {
		if (kind === "character") {
			const c = selectedCharacters.find((x) => x.id === id)
			return (c && cardLabel(c)) || "this seat"
		}
		if (kind === "member")
			return selectedMembers.find((m) => m.id === id)?.name || "this seat"
		const saved = savedPlayerSeat(id)
		const card =
			saved?.personaId != null
				? selectedPersonas.find((p) => p.id === saved.personaId)
				: undefined
		return (
			card?.name ||
			playerSeats.find((s) => s.id === id)?.name ||
			"this seat"
		)
	}
	/**
	 * The move choices the server allows on a saved, in-play seat (the owner's
	 * view): a player seat holding a card or a cast member goes to the
	 * AI-played group; a character seat goes to the owner or a player guest
	 * (an owner's card or a cast member), or back to the guest whose card it
	 * holds. None while the card or member has a live seat of the other kind.
	 */
	const moveOptionsOf = (
		kind: "character" | "member" | "player",
		id: number,
		cardOwner: number | null | undefined
	): PlayedByChoice["options"] => {
		if (!session?.id) return []
		const sessionCharacters = session.sessionCharacters ?? []
		const sessionPersonas = session.sessionPersonas ?? []
		if (kind === "player") {
			const saved = savedPlayerSeat(id)
			if (!saved) return []
			const held =
				saved.personaId != null
					? sessionCharacters.some(
							(cc) => cc.characterId === saved.personaId && !cc.removedAt
						)
					: saved.castMemberId != null
						? sessionCharacters.some(
								(cc) =>
									cc.castMemberId === saved.castMemberId &&
									cc.characterId == null &&
									!cc.removedAt
							)
						: true
			return held ? [] : [{ value: MOVE_TO_AI, label: "No one" }]
		}
		const saved =
			kind === "character" ? savedCharacterSeat(id) : savedMemberSeat(id)
		if (!saved) return []
		const held =
			kind === "character"
				? sessionPersonas.some(
						(cp) => cp.personaId === id && !cp.removedAt
					)
				: sessionPersonas.some(
						(cp) => cp.castMemberId === id && !cp.removedAt
					)
		if (held) return []
		const to =
			cardOwner != null && cardOwner !== ownerId
				? savedPlayerGuests.filter((g) => g.userId === cardOwner)
				: savedPlayerGuests
		return [
			...(cardOwner != null && cardOwner !== ownerId
				? []
				: [
						{
							value: moveToPersonValue(ownerId!),
							label: "You as a persona"
						}
					]),
			...to.map((g) => ({
				value: moveToPersonValue(g.userId),
				label: `${personName(g.userId)} as a persona`
			}))
		]
	}
	/**
	 * The "Played by" control of a saved, in-play seat, only where the server
	 * would allow the change (`resolveSeatHandovers`): the owner on their own
	 * cards' character seats, card-less cast members and card-less named
	 * player seats; a guest on a card-less member the owner seated (take) or
	 * they seated (hand back) while guests can take cast members. Null: none.
	 */
	const playedByChoice = (
		kind: "character" | "member" | "player",
		id: number
	): PlayedByChoice | null => {
		if (!session?.id || ownerId == null) return null
		const key = `${kind}:${id}`
		const saved =
			kind === "character"
				? savedCharacterSeat(id)
				: kind === "member"
					? savedMemberSeat(id)
					: savedPlayerSeat(id)
		if (!saved || !inPlay(saved)) return null
		if ((saved as { envoySlug?: string | null }).envoySlug) return null
		const current =
			kind === "player"
				? handoverDraft.get(key) ??
					(saved as SavedPlayerSeat).userId ??
					ownerId
				: seaterOf(key, saved as SavedCharacterSeat)
		if (!isGuest) {
			// A seat whose person is outside the session reads as nobody (never an id)
			// and is recovered by picking the owner.
			const stranded = !seatPeople.includes(current)
			const cardOwner = cardOwnerOf(kind, id)
			const guestCard = cardOwner != null && cardOwner !== ownerId
			const moves = moveOptionsOf(kind, id, cardOwner)
			let base: PlayedByChoice["options"]
			if (guestCard) {
				// A guest's own card is handed to no one else: only the move is offered.
				if (!moves.length) return null
				base = [{ value: String(current), label: personName(current) }]
			} else {
				if (!savedPlayerGuests.length && !stranded && !moves.length)
					return null
				if (kind === "character") {
					const card = selectedCharacters.find((c) => c.id === id)
					if (card?.userId !== ownerId) return null
				}
				base = [
					{
						value: String(ownerId),
						label: kind === "player" ? "You" : "No one"
					},
					...savedPlayerGuests.map((g) => ({
						value: String(g.userId),
						label: personName(g.userId)
					}))
				]
			}
			if (!moves.length)
				return { value: stranded ? "" : String(current), options: base }
			const pick = movePick.get(key)
			const name = seatNameOf(kind, id)
			const target = pick != null ? moveTargetOf(pick) : null
			return {
				value:
					pick ??
					moveDraft.get(key) ??
					(stranded ? "" : String(current)),
				options: [...base, ...moves],
				move: {
					name,
					sentence:
						pick == null
							? null
							: pick === MOVE_TO_AI
								? `${name} moves to the characters the story plays when you save. Its earlier lines stay as they are.`
								: `${name} moves to ${target === ownerId ? "your" : `${personName(target)}'s`} personas when you save. Its earlier lines stay as they are.`,
					drafted: moveDraft.has(key) && pick == null
				}
			}
		}
		if (kind !== "member" || !canTakeCast || !saved.isActive) return null
		const seated = (saved as SavedCharacterSeat).seatedByUserId ?? ownerId
		if (seated !== ownerId && seated !== viewerId) return null
		return {
			value: String(current),
			options: [
				{ value: String(ownerId), label: "No one" },
				{ value: String(viewerId), label: "You" }
			]
		}
	}
	/** A pick in a "Played by" control: a move choice waits for its confirmation; any other choice is a handover and clears a drafted move. */
	const pickPlayedBy = (
		kind: "character" | "member" | "player",
		id: number,
		value: string
	) => {
		const key = `${kind}:${id}`
		if (isMoveValue(value)) {
			movePick.set(key, value)
			return
		}
		movePick.delete(key)
		moveDraft.delete(key)
		handoverDraft.set(key, Number(value))
	}
	/** Record the picked move in the draft; it replaces a handover of the row. */
	const confirmMove = (
		kind: "character" | "member" | "player",
		id: number
	) => {
		const key = `${kind}:${id}`
		const value = movePick.get(key)
		movePick.delete(key)
		if (value == null) return
		moveDraft.set(key, value)
		handoverDraft.delete(key)
	}
	/** Drop the picked move; the control reads as it did before the pick. */
	const cancelMove = (
		kind: "character" | "member" | "player",
		id: number
	) => {
		movePick.delete(`${kind}:${id}`)
	}

	/**
	 * The seats whose draft side differs from their saved side: a seated row
	 * saved benched is brought back, a benched row saved in play is benched.
	 * A row not saved yet has no side to change.
	 */
	const benchChanges = $derived.by((): BenchChange[] => {
		const out: BenchChange[] = []
		const note = (
			seated: boolean,
			saved:
				| { removedAt?: unknown; isActive?: boolean | null }
				| undefined,
			seat: BenchChange["seat"]
		) => {
			if (saved && inPlay(saved) !== seated)
				out.push({ seat, enabled: seated })
		}
		for (const [seated, list] of [
			[true, selectedCharacters],
			[false, benchedCharacters]
		] as const)
			for (const c of list)
				note(seated, savedCharacterSeat(c.id), { characterId: c.id })
		for (const [seated, list] of [
			[true, selectedMembers],
			[false, benchedMembers]
		] as const)
			for (const m of list)
				note(seated, savedMemberSeat(m.id), { castMemberId: m.id })
		for (const [seated, list] of [
			[true, selectedPersonas],
			[false, benchedPersonas]
		] as const)
			for (const p of list) {
				const saved = savedPersonaSeat(p.id)
				if (saved) note(seated, saved, { playerSeatId: saved.id })
			}
		for (const [seated, list] of [
			[true, playerSeats],
			[false, benchedPlayerSeats]
		] as const)
			for (const p of list)
				note(seated, savedPlayerSeat(p.id), { playerSeatId: p.id })
		return out
	})
	let showRemoveModal = $state(false)
	let removeType: "character" | "persona" | "guest" | "member" =
		$state("character")
	let removeName = $state("")
	let removeId: number | null = $state(null)
	let validationErrors: ValidationErrors = $state({})
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	// A guest (session participant who isn't the owner) may manage characters/
	// personas/guests on this session but not session-level settings (name,
	// scenario, lorebook, tags, response mode, AI overrides) — mirrors the
	// same restriction enforced server-side in sessionsUpdateHandler, which
	// silently ignores those fields for non-owners regardless of what this
	// form sends, so this is UX clarity, not the actual security boundary.
	let isGuest: boolean = $derived(
		!!session && session.userId !== userCtx.user?.id
	)
	/**
	 * Who gets the Pipelines card: the session's owner. A guest gets none,
	 * administrators included (owner ruling G6, 2026-11-16), so the form
	 * does not even ask `sessions:pipelines`.
	 */
	const seesSessionPipelines: boolean = $derived(!isGuest)
	/**
	 * 🚧 What a guest may do with seats, from the SAVED switches (G3, G4),
	 * never the owner's draft. The owner is never frozen.
	 */
	const canBringOwn: boolean = $derived(
		!isGuest || storedGuestSeatSwitches(session?.metadata).bringOwn
	)
	const canTakeCast: boolean = $derived(
		!isGuest || storedGuestSeatSwitches(session?.metadata).takeCast
	)
	/** Only a guest allowed to bring their own may pick from what others shared. */
	const sharedToOffer = $derived(isGuest && canBringOwn ? sharedRows : [])
	/**
	 * A session on its own notes reads them on its own line and moment, like
	 * any book (★bk-fold-1): the own book's reading shows once its notes
	 * have lines. A guest reads them too, read-only: the server lets any
	 * member of the session read its own notes.
	 */
	let ownReadingBookId: number | null = $derived(
		savedLorebookId == null ? (session?.ownBookId ?? null) : null
	)
	const ownTime = new BookTime()
	$effect(() => {
		const id = ownReadingBookId
		if (id == null || isGuest) return
		return ownTime.listen(socket, id)
	})
	let showOwnReading: boolean = $derived(
		ownReadingBookId != null &&
			ownTime.lorebookId === ownReadingBookId &&
			ownTime.linesLoaded &&
			ownTime.branches.length > 0
	)
	/** The book the session started with, named for the read-only line. */
	let savedLorebookName: string = $derived(
		session?.lorebookName ??
			(savedLorebookId != null
				? (lorebookNames[savedLorebookId] ?? "its lorebook")
				: SESSION_NOTES_LABEL)
	)

	/**
	 * 🚧 What this session may write to its lorebook (owner ruling 2026-10-21,
	 * "Personal > Lorebook > Session"): the stricter of the owner's own setting
	 * and the book's. The session has no setting of its own; this line says
	 * which level is the stricter one, so a session that writes less than
	 * expected says why.
	 */
	const userSettingsCtx = getContext<UserSettingsCtx | undefined>(
		"userSettingsCtx"
	)
	/** 🚧 Advanced controls (2026-11-10): off hides the controls that tune how a session works; a hidden control keeps its stored value. */
	const advanced = $derived(showsAdvancedControls(userSettingsCtx?.settings))
	/** True iff a control hidden by the switch would render for this viewer with it on: the owner's (On revision always). A guest, administrators included (G6), has nothing hidden by the switch. PipelineCards' own cards are fetched inside it and not counted. */
	const settingsHides = $derived(!isGuest && !!session?.id)
	const writesPanelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")
	let sessionWrites = $derived.by(() => {
		if (lorebookId == null) return null
		const personal = effectiveLoreWriteMode(
			userSettingsCtx?.settings?.loreWriteMode,
			systemSettingsCtx?.settings?.loreWriteModeDefault
		)
		const book = lorebookList.find(
			(l) => l.id === lorebookId
		)?.loreWriteMode
		return {
			personal,
			...loreWriteLimit({
				personal,
				book: isLoreWriteMode(book) ? book : null
			})
		}
	})

	function openWritesSetting(where: "personal" | "lorebook") {
		if (!writesPanelsCtx || lorebookId == null) return
		if (where === "lorebook") {
			writesPanelsCtx.digest.lore = {
				lorebookId,
				scope: DEFAULT_SCOPE,
				settings: true
			}
			writesPanelsCtx.openView("lorebooks", { toggle: false })
		} else {
			writesPanelsCtx.digest.settingsSection = "user"
			writesPanelsCtx.openView("settings", { toggle: false })
		}
	}

	/**
	 * The three groups, each carrying whether something it holds is missing —
	 * the dot says "look in here" while another panel is the one on show.
	 */
	let sessionTabs = $derived([
		{
			value: "participants",
			label: "Participants",
			icon: Icons.UsersRound,
			hasError:
				selectedCharacters.length +
					selectedMembers.length +
					benchedCharacters.length +
					benchedMembers.length +
					sharedPicksOf("character").length <
					charactersFloor ||
				selectedPersonas.length +
					playerSeats.length +
					benchedPersonas.length +
					benchedPlayerSeats.length +
					pendingSeats.length +
					sharedPicksOf("player").length <
					personasFloor
		},
		// No lorebook error (RF fix 2, 2026-10-23): a session may always run
		// without a book — its own is its world.
		{ value: "settings", label: "Settings", icon: Icons.Settings2 },
		{ value: "visibility", label: "Privacy", icon: Icons.Eye }
	])

	// Filtered tags for suggestions
	let filteredTags = $derived.by(() => {
		if (!tagSearchInput)
			return tagsList.filter(
				(tag) =>
					!selectedTags.some(
						(selectedTag) =>
							selectedTag.toLowerCase() === tag.name.toLowerCase()
					)
			)
		return tagsList.filter(
			(tag) =>
				tag.name.toLowerCase().includes(tagSearchInput.toLowerCase()) &&
				!selectedTags.some(
					(selectedTag) =>
						selectedTag.toLowerCase() === tag.name.toLowerCase()
				)
		)
	})

	// Tag helper functions
	function addTag(tagName: string) {
		const trimmedName = tagName.trim()
		if (!trimmedName) return

		// Check for case-insensitive duplicates
		const isDuplicate = selectedTags.some(
			(existingTag) =>
				existingTag.toLowerCase() === trimmedName.toLowerCase()
		)
		if (isDuplicate) return

		selectedTags = [...selectedTags, trimmedName]
		tagSearchInput = ""
		showTagSuggestions = false
	}

	function removeTag(tagName: string) {
		selectedTags = selectedTags.filter((tag) => tag !== tagName)
	}

	$effect(() => {
		const _name = name.trim()
		const _scenario = scenario.trim()
		const _selectedCharacters = selectedCharacters
		const _selectedPersonas = selectedPersonas
		const _selectedMembers = selectedMembers
		const _benchedCharacters = benchedCharacters
		const _benchedPersonas = benchedPersonas
		const _benchedMembers = benchedMembers
		// A benched seat stays in what Save sends: `sessions:update` unseats
		// anything omitted, so only a real Remove leaves a seat out.
		const _playerSeats = [...playerSeats, ...benchedPlayerSeats].map(
			(p) => ({
				id: p.id,
				name: p.name.trim()
			})
		)
		const _selectedGuests = selectedGuests
		const _lorebookId = lorebookId || null
		// Where it reads the book travels only with the book it was chosen
		// for: switching books lets the server start the new one.
		const _reading =
			(_lorebookId !== null && _lorebookId === savedLorebookId) ||
			(_lorebookId === null && showOwnReading && !isGuest)
				? {
						lorebookBranchId,
						storyClockYear: storyClock?.year ?? null,
						storyClockMonth: storyClock?.month ?? null,
						storyClockDay:
							storyClock?.month != null
								? (storyClock?.day ?? null)
								: null,
						storyClockHour: storyClock?.hour ?? null,
						storyClockMinute:
							storyClock?.hour != null
								? (storyClock?.minute ?? 0)
								: null
					}
				: {}
		const _tags = selectedTags
		const _genreId = genreId
		const _genreFields = JSON.parse(JSON.stringify(genreFields))
		const _onRevision = onRevision
		const _rigour = rigour
		const _playerLabel = playerLabelOverride.trim()
		const _guestsBringOwn = guestsBringOwn
		const _guestsTakeCast = guestsTakeCast
		const _sceneSettings = JSON.stringify(sceneOverride ?? null)
		const _seatHandovers = differingHandovers(
			handoverDraft,
			savedHandoverPerson
		)
		const _playerSeatsFor = isGuest
			? []
			: playerSeatsForOf(cardFor, pendingSeats, ownerId)
		const _sharedCardSeats = sharedPicks.map((p) => ({
			characterId: p.card.id,
			kind: p.kind
		}))
		data = {
			session: {
				id: session?.id,
				name: _name,
				scenario: _scenario,
				lorebookId: _lorebookId,
				..._reading,
				tags: _tags,
				genreId: _genreId,
				genreFields: _genreFields,
				onRevision: _onRevision,
				rigour: _rigour
			},
			characterIds: seatedThenBenchedIds(
				_selectedCharacters,
				_benchedCharacters
			),
			castMemberIds: seatedThenBenchedIds(
				_selectedMembers,
				_benchedMembers
			),
			personaIds: seatedThenBenchedIds(
				_selectedPersonas,
				_benchedPersonas
			),
			guestIds: _selectedGuests.map((g) => g.userId),
			characterPositions: characterPositionsOf(
				_selectedCharacters,
				_benchedCharacters
			),
			playerLabel: _playerLabel,
			guestsBringOwn: _guestsBringOwn,
			guestsTakeCast: _guestsTakeCast,
			sceneSettings: _sceneSettings,
			playerSeats: _playerSeats,
			seatHandovers: _seatHandovers,
			sharedCardSeats: _sharedCardSeats,
			playerSeatsFor: _playerSeatsFor
		}

		if (!originalData) {
			originalData = JSON.parse(JSON.stringify(data))
		}
	})

	/**
	 * The session being edited: its SCOPED interest and the request for it, in
	 * one effect so the two cannot drift.
	 *
	 * `sessions:get` carries its scope on `session.id` (`SCOPED_EVENTS`), so
	 * `sessions:get#<id>` is both the reply to this request and every later
	 * re-read the handlers below ask for. The effect form — rather than
	 * `useInterest`, which reads its key once — is what releases `#41` when the
	 * sidebar points this form at 42 without remounting it.
	 *
	 * ⚠ CREATE mode declares NO key. There is no session yet, so there is no id
	 * to scope to and nothing this form could ask for — and a bare `sessions:get`
	 * would open the server's gate for every session's reply while the form is
	 * mounted. The effect re-runs the moment `editSessionId` becomes known (the
	 * form is re-pointed at a saved session) and declares the scoped key then.
	 *
	 * 🚧 pr-6: the member push is `sessions:refresh` (same payload); this form reads it as it reads its own reply.
	 */
	$effect(() => {
		const id = editSessionId
		if (!id) return
		const release = declareInterest<"sessions:get">(
			interestKey("sessions:get", id),
			handleSessionsGet
		)
		const releaseRefresh = declareInterest<"sessions:refresh">(
			interestKey("sessions:refresh", id),
			handleSessionsGet
		)
		// The typed `emit` puts the pending sync ahead of the request on the
		// same socket, so the handler answering it already sees the key
		// (plan ruling 3).
		socket.emit("sessions:get", { id })
		return () => {
			release()
			releaseRefresh()
		}
	})

	/**
	 * 🚧 The session's own book is fixed, so its card-less members are read
	 * once for it, whether that is an attached lorebook or its own notes. An
	 * effect rather than `useInterest`: the key moves with the book.
	 */
	$effect(() => {
		if (isGuest && session?.id != null) {
			// 🚧 A guest cannot read the book's bindings: the session lists the
			// free card-less members it offers (G3, G4), asked again when the
			// seats change (another guest may take someone).
			const sessionId = session.id
			void session.sessionCharacters
			const release = declareInterest<"sessions:castToTake">(
				interestKey("sessions:castToTake", sessionId),
				(msg) => {
					if (msg.sessionId !== sessionId) return
					bookMembers = msg.members.map((m) => ({
						id: m.castMemberId,
						name: m.name,
						faceMediaId: m.faceMediaId,
						cardId: null
					}))
				}
			)
			socket.emit("sessions:castToTake", { sessionId })
			return release
		}
		const id = savedLorebookId ?? sessionBookOf(session)
		if (id == null) {
			bookMembers = []
			return
		}
		const release = declareInterest<"lorebooks:bindingList">(
			interestKey("lorebooks:bindingList", id),
			(msg) => {
				if (msg.lorebookId === id)
					bookMembers = castPickMembers(msg.lorebookBindingList)
			}
		)
		socket.emit("lorebooks:bindingList", { lorebookId: id })
		return release
	})

	function handleAddCharacter(
		char: Partial<SelectCharacter> & { id: number }
	) {
		if (
			!selectedCharacters.some((c) => c.id === char.id) &&
			!benchedCharacters.some((c) => c.id === char.id)
		)
			selectedCharacters = [...selectedCharacters, char]
		showCharacterModal = false
		// Update data to reflect the new character
		if (data) {
			data = {
				...data,
				characterIds: seatedThenBenchedIds(
					selectedCharacters,
					benchedCharacters
				),
				characterPositions: characterPositionsOf(
					selectedCharacters,
					benchedCharacters
				)
			}
		}
	}

	function handleRemoveCharacter(id: number) {
		selectedCharacters = selectedCharacters.filter((c) => c.id !== id)
		benchedCharacters = benchedCharacters.filter((c) => c.id !== id)
		// Update data to reflect removed character
		if (data) {
			data = {
				...data,
				characterIds: seatedThenBenchedIds(
					selectedCharacters,
					benchedCharacters
				),
				characterPositions: characterPositionsOf(
					selectedCharacters,
					benchedCharacters
				)
			}
		}
	}

	/** The picker's multi mode: cards and card-less members, apart. */
	function handleAddMany(ids: number[], castMemberIds: number[]) {
		for (const id of ids) {
			const char = characters.find((c) => c.id === id)
			if (
				char &&
				!selectedCharacters.some((c) => c.id === id) &&
				!benchedCharacters.some((c) => c.id === id)
			)
				selectedCharacters = [...selectedCharacters, { ...char, id }]
		}
		for (const id of castMemberIds) {
			const member = bookMembers.find((m) => m.id === id)
			if (
				member &&
				!selectedMembers.some((m) => m.id === id) &&
				!benchedMembers.some((m) => m.id === id)
			)
				selectedMembers = [...selectedMembers, member]
		}
		showCharacterModal = false
	}

	function handleRemoveMember(id: number) {
		selectedMembers = selectedMembers.filter((m) => m.id !== id)
		benchedMembers = benchedMembers.filter((m) => m.id !== id)
	}

	function handleAddPersona(p: Partial<SelectCharacter> & { id: number }) {
		if (
			!selectedPersonas.some((pp) => pp.id === p.id) &&
			!benchedPersonas.some((pp) => pp.id === p.id)
		) {
			selectedPersonas = [...selectedPersonas, p]
			if (personaAskedBy != null && personaAskedBy !== viewerId)
				cardFor.set(p.id, personaAskedBy)
		}
		personaAskedBy = null
		showPersonaModal = false
		// Update data to reflect the new persona
		if (data) {
			data = {
				...data,
				personaIds: seatedThenBenchedIds(
					selectedPersonas,
					benchedPersonas
				)
			}
		}
	}

	function handleRemovePersona(id: number) {
		cardFor.delete(id)
		selectedPersonas = selectedPersonas.filter((p) => p.id !== id)
		benchedPersonas = benchedPersonas.filter((p) => p.id !== id)
		// Update data to reflect removed persona
		if (data) {
			data = {
				...data,
				personaIds: seatedThenBenchedIds(
					selectedPersonas,
					benchedPersonas
				)
			}
		}
	}

	// BENCHED SEATS (owner 2026-11-10): a benched seat is still in the
	// session, out of the turns; its lines stay its own. Everything below is
	// held until Save, which sends one `sessions:setCastSeatEnabled` per
	// change (`benchChanges`) before `sessions:update`.

	/** The tab's panel, where the focus after a move is looked for (the form can mount twice, so never a global id). */
	let participantsPanel: HTMLDivElement | undefined = $state()
	/** The visually hidden line a move says. */
	let seatLive = $state("")
	/** A drag in progress: the benched zones show their drop hint only then. */
	let dragging: "character" | "persona" | null = $state(null)
	let dragFrom: "seated" | "benched" | null = null
	/** The persona lists as a drag began: where a refused drop returns them to. */
	let personaDragStart: { seated: SeatCard[]; benched: SeatCard[] } | null =
		null
	/**
	 * The groups whose zone a dragged seat now hovers as another person's. The
	 * library gives that zone's finalize only the zone's own rows, so a refused
	 * drop is known from this, not from the rows.
	 */
	const foreignOver = new Set<number>()

	function announceSeat(name: string, benched: boolean) {
		seatLive = `${name} ${benched ? "benched" : "brought back"} — waits for Save.`
	}

	async function focusSeatAction(seatAction: string) {
		await tick()
		participantsPanel
			?.querySelector<HTMLElement>(`[data-seat-action="${seatAction}"]`)
			?.focus()
	}

	/** Move one row between its seated and benched lists: benching appends to the benched list, bringing back to the end of the seated one. */
	function moveSeat(kind: SeatKind, id: number, toBench: boolean) {
		let name = ""
		const take = <T extends { id: number }>(
			from: T[],
			to: T[]
		): [T[], T[], T | undefined] => {
			const row = from.find((r) => r.id === id)
			return row
				? [from.filter((r) => r.id !== id), [...to, row], row]
				: [from, to, undefined]
		}
		if (kind === "character") {
			const [a, b, row] = toBench
				? take(selectedCharacters, benchedCharacters)
				: take(benchedCharacters, selectedCharacters)
			if (!row) return
			;[selectedCharacters, benchedCharacters] = toBench ? [a, b] : [b, a]
			name = cardLabel(row)
		} else if (kind === "member") {
			const [a, b, row] = toBench
				? take(selectedMembers, benchedMembers)
				: take(benchedMembers, selectedMembers)
			if (!row) return
			;[selectedMembers, benchedMembers] = toBench ? [a, b] : [b, a]
			name = row.name
		} else if (kind === "persona") {
			const [a, b, row] = toBench
				? take(selectedPersonas, benchedPersonas)
				: take(benchedPersonas, selectedPersonas)
			if (!row) return
			;[selectedPersonas, benchedPersonas] = toBench ? [a, b] : [b, a]
			name = row.name || ""
		} else {
			const [a, b, row] = toBench
				? take(playerSeats, benchedPlayerSeats)
				: take(benchedPlayerSeats, playerSeats)
			if (!row) return
			;[playerSeats, benchedPlayerSeats] = toBench ? [a, b] : [b, a]
			name = row.name || "This seat"
		}
		announceSeat(name, toBench)
		void focusSeatAction(`${kind}:${id}`)
	}

	/**
	 * A drag in a seated zone or its benched pair. A drop across the pair
	 * says the move (no focus move); an unsaved row dropped on the bench goes
	 * back to the end of its seated list, silently.
	 */
	function handleSeatDrag(
		kind: "character" | "persona",
		side: "seated" | "benched",
		final: boolean,
		e: CustomEvent<DndEvent<SeatCard>>,
		/** The person whose group zone this is, when several people hold player seats. */
		group?: number
	) {
		const { items, info } = e.detail
		if (info.trigger === TRIGGERS.DRAG_STARTED && kind === "persona")
			personaDragStart = {
				seated: selectedPersonas,
				benched: benchedPersonas
			}
		// A seat dropped into another person's group goes back where it was.
		// Both zones' finalize events are refused (the target's, then the
		// origin's with the row already gone); the restore waits until both ran.
		const foreign =
			kind === "persona" &&
			side === "seated" &&
			group !== undefined &&
			items.some((r) => personaPlayer(r) !== group)
		if (kind === "persona" && side === "seated" && group !== undefined) {
			if (foreign) foreignOver.add(group)
			else if (!final) foreignOver.delete(group)
		}
		if (kind === "persona" && final && foreignOver.size > 0) {
			dragging = null
			dragFrom = null
			const back = personaDragStart
			void tick().then(() => {
				foreignOver.clear()
				if (back) {
					selectedPersonas = back.seated
					benchedPersonas = back.benched
				}
			})
			return
		}
		if (foreign) return
		if (kind === "character") {
			if (side === "seated") selectedCharacters = items
			else benchedCharacters = items
		} else if (side === "seated")
			selectedPersonas =
				group === undefined
					? items
					: fillGroupSlots(
							selectedPersonas,
							(r) => personaPlayer(r) === group,
							items
						)
		else benchedPersonas = items
		if (!final) {
			if (info.trigger === TRIGGERS.DRAG_STARTED) {
				dragging = kind
				dragFrom = side
			}
			return
		}
		dragging = null
		const from = dragFrom
		dragFrom = null
		const saved =
			kind === "character" ? savedCharacterSeat : savedPersonaSeat
		if (side === "benched") {
			const unsaved = items.filter((r) => !saved(r.id))
			// After the tick: the library finalizes the target zone first and
			// the origin zone right after, with the origin's items as they were
			// (without the dragged row), which would undo a bounce made now.
			if (unsaved.length)
				void tick().then(() => {
					const ids = new Set(unsaved.map((r) => r.id))
					const back = (seated: SeatCard[]) => [
						...seated.filter((r) => !ids.has(r.id)),
						...unsaved
					]
					if (kind === "character") {
						benchedCharacters = benchedCharacters.filter(
							(r) => !ids.has(r.id)
						)
						selectedCharacters = back(selectedCharacters)
					} else {
						benchedPersonas = benchedPersonas.filter(
							(r) => !ids.has(r.id)
						)
						selectedPersonas = back(selectedPersonas)
					}
				})
		}
		if (
			info.trigger === TRIGGERS.DROPPED_INTO_ZONE &&
			from &&
			from !== side
		) {
			const moved = items.find((r) => String(r.id) === String(info.id))
			if (moved && saved(moved.id))
				announceSeat(
					kind === "character" ? cardLabel(moved) : moved.name || "",
					side === "benched"
				)
		}
	}

	/**
	 * Bringing back a seat whose story ended: it comes back as it is. The
	 * note shows while its row sits in a seated list and still differs from
	 * its saved (benched) side.
	 */
	function fallenNote(
		kind: "character" | "player",
		saved: { removedAt?: unknown; isActive?: boolean | null } | undefined
	): boolean {
		return (
			!!saved && !inPlay(saved) && seatFellInStory(session, saved, kind)
		)
	}
	/** Where a seat's cast member opens in the lorebook, when it has one and the session a book. */
	function castMemberHref(saved: object | undefined): string | null {
		const castId = (saved as { castMemberId?: number | null } | undefined)
			?.castMemberId
		const bookId = sessionBookOf(session)
		if (castId == null || bookId == null) return null
		// A guest neither opens nor edits the session's notes (G2): no link to them.
		if (
			isGuest &&
			bookId === (session as { ownBookId?: number | null } | undefined)?.ownBookId
		)
			return null
		const route = reduce(
			reduce(emptyRoute(), { type: "openBook", lorebookId: bookId }),
			{ type: "openCastMember", castId }
		)
		return "/lorebooks" + toHash(route)
	}

	/** Whether any seat is saved: the Benched section waits for one. */
	const hasSavedSeat = $derived(
		!!session &&
			((session.sessionCharacters ?? []).some((cc) => !cc.removedAt) ||
				(session.sessionPersonas ?? []).some((cp) => !cp.removedAt))
	)
	/** 🚧 Whose a seat is, said in its place of "No card" (R3-2): the person who plays it. */
	const seatPlayerWords = (userId: number | null): string => {
		if (userId != null && userId === userCtx.user?.id)
			return "Your character"
		if (
			userId != null &&
			(userId === ownerId || selectedGuests.some((g) => g.userId === userId))
		)
			return `${personName(userId)}'s character`
		return "A player's character"
	}

	function openReassignModal(
		type: "character" | "persona",
		oldId: number,
		name: string
	) {
		reassignTarget = { type, oldId, name }
		showReassignModal = true
	}

	function handleReassignSelect(newId: number) {
		if (!session?.id || !reassignTarget) return
		const req: Sockets.Sessions.ReassignRemovedParticipant.Params = {
			sessionId: session.id,
			type: reassignTarget.type,
			oldId: reassignTarget.oldId,
			newId
		}
		socket.emit("sessions:reassignRemovedParticipant", req)
		showReassignModal = false
		reassignTarget = null
	}

	/** Held, not written: Save commits it (note 34). */
	function handleAddGuests(userIds: number[], users: SelectUser[]) {
		const held = new Set(selectedGuests.map((g) => g.userId))
		const added = userIds
			.filter((id) => !held.has(id))
			.map((userId) => ({
				userId,
				user: users.find((u) => u.id === userId) ?? null
			}))
		if (added.length) selectedGuests = [...selectedGuests, ...added]
		showGuestModal = false
	}

	/** Held, not written: Save commits it (note 34). */
	function handleRemoveGuest(userId: number) {
		selectedGuests = selectedGuests.filter((g) => g.userId !== userId)
	}

	/**
	 * Save's guest half: the difference from the saved guests, one write per
	 * user (`sessions:update` carries no guests). Counted, so the form stays
	 * open until every answer is in and a refusal can still be toasted.
	 */
	function commitParticipantChanges(sessionId: number) {
		// The seat is SET to the held side, never flipped, so a stale form
		// cannot invert it; only a seat whose draft side differs from the
		// saved row is sent.
		for (const c of benchChanges) {
			participantWritesInFlight++
			socket.emit("sessions:setCastSeatEnabled", {
				sessionId,
				...c.seat,
				enabled: c.enabled
			})
		}
		if (!isGuest)
			for (const e of envoyChanges) {
				participantWritesInFlight++
				socket.emit("sessions:setEnvoySeat", {
					sessionId,
					slug: e.slug,
					seated: envoyDraft[e.slug]
				})
			}
		if (!isGuest) commitGuestChanges(sessionId)
	}

	function commitGuestChanges(sessionId: number) {
		const saved = (session?.sessionGuests ?? []).map((g) => g.userId)
		const { add, remove } = guestChanges(
			saved,
			selectedGuests.map((g) => g.userId)
		)
		participantWritesInFlight += add.length + remove.length
		for (const guestUserId of add)
			socket.emit("sessions:addGuest", { sessionId, guestUserId })
		for (const guestUserId of remove)
			socket.emit("sessions:removeGuest", { sessionId, guestUserId })
	}

	function participantWriteAnswered() {
		participantWritesInFlight = Math.max(0, participantWritesInFlight - 1)
		if (participantWritesInFlight === 0 && closeWhenParticipantsSettle) {
			closeWhenParticipantsSettle = false
			showEditSessionForm = false
			onClose?.()
		}
	}

	function handleSave() {
		// Re-fit held data to the genre's shape before anything reads it
		// (19 §2): a field under a name the shape stopped declaring, or a
		// participant past its bound, must not ride the commit.
		reconcileToMode()
		if (!validateForm()) return
		if (
			!data?.session.name.trim() ||
			selectedCharacters.length +
				selectedMembers.length +
				benchedCharacters.length +
				benchedMembers.length +
				sharedPicksOf("character").length <
				charactersFloor ||
			selectedPersonas.length +
				playerSeats.length +
				benchedPersonas.length +
				benchedPlayerSeats.length +
				pendingSeats.length +
				sharedPicksOf("player").length <
				personasFloor
		)
			return
		// Ensure data is synced with current selections (a benched seat
		// stays in the lists: the server unseats whatever is omitted)
		const characterIds = seatedThenBenchedIds(
			selectedCharacters,
			benchedCharacters
		)
		const personaIds = seatedThenBenchedIds(
			selectedPersonas,
			benchedPersonas
		)
		const characterPositions = characterPositionsOf(
			selectedCharacters,
			benchedCharacters
		)

		// Update data to ensure everything is in sync
		if (data) {
			data = {
				...data,
				characterIds,
				personaIds,
				characterPositions,
				session: {
					...data.session,
					name: name.trim(),
					scenario: scenario.trim()
				}
			}
		}

		if (!session?.id) return
		// genreId rides in `data` but the server ignores it on update —
		// switching an existing session's mode is an open policy question
		// (19 §10). genreFields does land, filtered to declared keys.
		// A guest's view edits seats only: the session fields are not sent.
		const sent: Record<string, unknown> = isGuest
			? { id: session.id }
			: {
					...data!.session,
					id: session.id
				}
		// The story clock and the line go only when the person moved them
		// here: a pipeline may have advanced the clock since the form loaded
		// (DESIGN-story-time P3), and deleting a branch moves its sessions to
		// main — posting that dead id back was refused, failing every later
		// save of the tab (#136).
		const was = (originalData?.session ?? {}) as Record<string, unknown>
		if (!isGuest) {
			stripUnmovedReading(sent, was)
			// How strict goes only when moved here: a stored value a genre no
			// longer offers is never posted back to be refused.
			if ((sent.rigour ?? null) === (was.rigour ?? null))
				delete sent.rigour
		}
		// Genre fields go only as the person changed them here, field by
		// field (2026-10-03): the server merges them over what is stored, so
		// an author's note saved from its widget while this form was open is
		// not put back to the value the form loaded.
		const fieldsPatch = isGuest
			? undefined
			: changedGenreFields(
					data!.session.genreFields,
					was.genreFields as Record<string, unknown> | undefined,
					modeShape ? Object.keys(modeFieldDecls) : undefined
				)
		if (fieldsPatch) sent.genreFields = fieldsPatch
		else delete sent.genreFields
		const {
			playerLabel,
			guestsBringOwn: bringOwnNow,
			guestsTakeCast: takeCastNow,
			sceneSettings,
			playerSeats: seatsNow,
			castMemberIds,
			seatHandovers: handoversNow,
			sharedCardSeats: sharedNow,
			playerSeatsFor: forNow,
			...rest
		} = data!
		// 🚧 Card-less player seats: the ones gone are removed, a changed
		// non-blank name renames (a blank one keeps the saved name).
		const seatsWas = originalData?.playerSeats ?? []
		type SeatChange = NonNullable<
			Sockets.Sessions.Update.Params["playerSeatChanges"]
		>[number]
		const playerSeatChanges = seatsWas.flatMap((was): SeatChange[] => {
			const now = seatsNow.find((p) => p.id === was.id)
			if (!now) return [{ playerSeatId: was.id, remove: true }]
			return now.name && now.name !== was.name
				? [{ playerSeatId: was.id, seatName: now.name }]
				: []
		})
		// 🚧 The scene settings go only when the person changed them here.
		const scenesMoved =
			!isGuest &&
			sceneSettings !== (originalData?.sceneSettings ?? "null")
		const movesNow = seatMovesOf(moveDraft, (key) => {
			const [kind, raw] = key.split(":")
			return (
				kind === "character"
					? savedCharacterSeat(Number(raw))
					: savedMemberSeat(Number(raw))
			)?.id
		})
		const updateSession: Sockets.Sessions.Update.Params = {
			...rest,
			session: sent as Sockets.Sessions.Update.Params["session"],
			// R4: only where the genre names the person's lines; blank clears.
			...(genrePlayerLabel && !isGuest ? { playerLabel } : {}),
			// 🚧 Each guest seat switch goes only when the owner moved it here.
			...(!isGuest &&
			bringOwnNow !== (originalData?.guestsBringOwn ?? true)
				? { guestsBringOwn: bringOwnNow }
				: {}),
			...(!isGuest &&
			takeCastNow !== (originalData?.guestsTakeCast ?? true)
				? { guestsTakeCast: takeCastNow }
				: {}),
			...(scenesMoved
				? {
						sceneSettings: JSON.parse(
							sceneSettings
						) as SceneSettingsDecl | null
					}
				: {}),
			...(playerSeatChanges.length ? { playerSeatChanges } : {}),
			// A guest's shared cards picked here: the server copies each.
			...(isGuest && sharedNow.length
				? { sharedCardSeats: sharedNow }
				: {}),
			...(!isGuest && forNow.length ? { playerSeatsFor: forNow } : {}),
			// 🚧 "Played by": the moves confirmed here, between the groups.
			...(!isGuest && movesNow.length ? { seatMoves: movesNow } : {}),
			// 🚧 "Played by": only the handovers the person picked here.
			...(handoversNow.length
				? {
						seatHandovers: handoversNow.map((h) => ({
							...handoverSeatOf(h.key),
							toUserId: h.toUserId
						}))
					}
				: {}),
			// 🚧 The card-less seats go as the whole set they should be, and only
			// when the person changed them here (the server seats the new ones
			// and lets the owner's or seater's missing ones go).
			...(sameFormValue(castMemberIds, originalData?.castMemberIds ?? [])
				? {}
				: { castMemberIds })
		}
		// Participant writes first: their answers are counted, and the
		// update's answer closes the form only once they are all in.
		// 🚧 A clock moved here is asked about first: moved back past what the
		// session wrote, the server names the On revision mode and the person
		// confirms before anything is saved.
		if (
			!isGuest &&
			STORY_CLOCK_KEYS.every((k) => k in sent) &&
			!("lorebookBranchId" in sent)
		) {
			const year = sent.storyClockYear as number | null
			clockAsk = {
				token: `clock-${++clockAskCount}-${Date.now()}`,
				update: updateSession
			}
			socket.emit("sessions:storyClock", {
				sessionId: session.id,
				request: clockAsk.token,
				moveTo:
					year == null
						? null
						: {
								year,
								month: (sent.storyClockMonth as number | null) ?? null,
								day: (sent.storyClockDay as number | null) ?? null,
								hour: (sent.storyClockHour as number | null) ?? null,
								minute: (sent.storyClockMinute as number | null) ?? null
							}
			})
			return
		}
		sendUpdate(updateSession, false)
	}

	/** 🚧 The save held while the server says whether its clock move needs confirming. */
	let clockAsk: {
		token: string
		update: Sockets.Sessions.Update.Params
	} | null = null
	let clockAskCount = 0
	/** 🚧 The notice the person is asked about; the held save waits on the answer. */
	let clockMoveBack: Sockets.Sessions.StoryClock.ClockMoveBackNotice | null =
		$state(null)
	/** This form sent the confirmed save: a Branch reply takes the person there. */
	let confirmedSent = false

	/** Participant writes first: their answers are counted (see `save`). */
	function sendUpdate(
		update: Sockets.Sessions.Update.Params,
		confirmed: boolean
	) {
		if (!session?.id) return
		commitParticipantChanges(session.id)
		confirmedSent = confirmed
		socket.emit(
			"sessions:update",
			confirmed ? { ...update, confirmClockMoveBack: true } : update
		)
	}

	/** The server's answer to the pre-check: a notice asks; anything else saves as ever. */
	function handleClockPreCheck(res: Sockets.Sessions.StoryClock.Response) {
		if (!clockAsk || res.request !== clockAsk.token) return
		if (res.sessionId !== session?.id) return
		if (res.clockMoveBack) {
			clockMoveBack = res.clockMoveBack
			return
		}
		const { update } = clockAsk
		clockAsk = null
		sendUpdate(update, false)
	}
	function confirmClockMove() {
		const held = clockAsk
		clockMoveBack = null
		clockAsk = null
		if (held) sendUpdate(held.update, true)
	}
	function cancelClockMove() {
		clockMoveBack = null
		clockAsk = null
	}

	// Touch-friendly alternative to the drag handle above — dndzone works fine
	// with a mouse but has no keyboard/touch-tap equivalent on its own.
	function moveCharacterUp(index: number) {
		if (index <= 0) return
		const next = selectedCharacters.slice()
		;[next[index - 1], next[index]] = [next[index], next[index - 1]]
		selectedCharacters = next
	}

	function moveCharacterDown(index: number) {
		if (index >= selectedCharacters.length - 1) return
		const next = selectedCharacters.slice()
		;[next[index], next[index + 1]] = [next[index + 1], next[index]]
		selectedCharacters = next
	}

	/** Past the nearest row of the same person's group; the other groups' rows keep their places. */
	function movePersona(index: number, delta: -1 | 1) {
		const who = personaPlayer(selectedPersonas[index])
		selectedPersonas = swapWithinGroup(
			selectedPersonas,
			index,
			delta,
			(r) => personaPlayer(r) === who
		)
	}
	const movePersonaUp = (index: number) => movePersona(index, -1)
	const movePersonaDown = (index: number) => movePersona(index, 1)

	function confirmRemoveCharacter(id: number, name: string) {
		removeType = "character"
		removeName = name
		removeId = id
		showRemoveModal = true
	}

	function confirmRemoveMember(id: number, name: string) {
		removeType = "member"
		removeName = name
		removeId = id
		showRemoveModal = true
	}

	function confirmRemovePersona(id: number, name: string) {
		removeType = "persona"
		removeName = name
		removeId = id
		showRemoveModal = true
	}

	function confirmRemoveGuest(userId: number, username: string) {
		removeType = "guest"
		removeName = username
		removeId = userId
		showRemoveModal = true
	}

	function handleRemoveConfirm() {
		if (removeType === "character") handleRemoveCharacter(removeId!)
		else if (removeType === "member") handleRemoveMember(removeId!)
		else if (removeType === "persona") handleRemovePersona(removeId!)
		else if (removeType === "guest") handleRemoveGuest(removeId!)
		showRemoveModal = false
		removeId = null
		removeName = ""
	}

	function handleRemoveCancel() {
		showRemoveModal = false
		removeId = null
		removeName = ""
	}

	function validateForm(): boolean {
		const result = sessionSchema.safeParse({
			name: name,
			scenario: scenario
		})

		if (result.success) {
			validationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			validationErrors = errors
			return false
		}
	}

	let showCancelModal = $state(false)

	function handleCloseFormOnOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showCancelModal = false
		}
	}

	function handleCloseForm() {
		if (hasChanges) {
			showCancelModal = true
		} else {
			showEditSessionForm = false
			onClose?.()
		}
	}

	function handleCloseModalDiscard() {
		showCancelModal = false
		showEditSessionForm = false
		onClose?.()
	}

	function handleCloseModalCancel() {
		showCancelModal = false
	}

	// Socket event handlers - defined as named functions for proper cleanup
	const handleSessionsGet = (msg: Sockets.Sessions.Get.Response) => {
		if (msg.session && msg.session.id === editSessionId) {
			// Create new object reference to ensure reactivity
			session = {
				...msg.session,
				sessionCharacters: [...(msg.session.sessionCharacters || [])]
			}
			name = session.name || ""
			scenario = session.scenario || ""
			// Removed rows are in neither list: not in the cast, never shown
			// (and not re-submitted by the next Save). A benched seat is held
			// apart from the seats in play, but still goes with Save.
			const chars = (session.sessionCharacters ?? []).filter(
				(cc) => !cc.removedAt
			)
			const carded = chars.filter((cc) => cc.character)
			// Each seat's card as its cast member shows it.
			const cardOf = (cc: (typeof carded)[number]) =>
				seatCardAsShown(session, cc.character)
			selectedCharacters = carded.filter(inPlay).map(cardOf)
			benchedCharacters = carded.filter((cc) => !inPlay(cc)).map(cardOf)
			// A card-less character seat is listed as its cast member, by member id.
			const memberOf = (cc: (typeof chars)[number]): PickMember[] => {
				const shown =
					!cc.character && cc.castMemberId != null
						? session?.cardlessSeatShown?.[cc.castMemberId]
						: undefined
				return shown
					? [
							{
								id: cc.castMemberId!,
								name: shown.nickname?.trim() || shown.name,
								faceMediaId: shown.faceMediaId,
								cardId: null
							}
						]
					: []
			}
			selectedMembers = chars.filter(inPlay).flatMap(memberOf)
			benchedMembers = chars.filter((cc) => !inPlay(cc)).flatMap(memberOf)
			// A card-less player seat has no card (`persona` null): it is
			// listed by its seat name below, never as a persona.
			const players = (session.sessionPersonas ?? []).filter(
				(cp) => !cp.removedAt
			)
			selectedPersonas = players
				.filter((cp) => cp.persona && inPlay(cp))
				.map((cp) => cp.persona!)
			benchedPersonas = players
				.filter((cp) => cp.persona && !inPlay(cp))
				.map((cp) => cp.persona!)
			const seatOf = (cp: (typeof players)[number]): PlayerSeatDraft => ({
				id: cp.id,
				name: cp.seatName?.trim() ?? "",
				userId: cp.userId ?? null
			})
			playerSeats = players
				.filter((cp) => isCardlessPlayerSeat(cp) && inPlay(cp))
				.map(seatOf)
			benchedPlayerSeats = players
				.filter((cp) => isCardlessPlayerSeat(cp) && !inPlay(cp))
				.map(seatOf)
			selectedGuests = session.sessionGuests || []
			lorebookId = session.lorebookId || null
			savedLorebookId = lorebookId
			lorebookBranchId = session.lorebookBranchId ?? null
			storyClock =
				session.storyClockYear != null
					? {
							year: session.storyClockYear,
							month: session.storyClockMonth ?? null,
							day: session.storyClockDay ?? null,
							hour: session.storyClockHour ?? null,
							minute: session.storyClockMinute ?? null
						}
					: null
			selectedTags = session.tags || []
			genreId = (session as any).genreId ?? STANDARD_GENRE_ID
			genreFields = ((session as any).genreFields ?? {}) as Record<
				string,
				unknown
			>
			onRevision =
				(session as any).onRevision === "branch"
					? "branch"
					: "overwrite"
			rigour =
				typeof (session as any).rigour === "string"
					? (session as any).rigour
					: null
			playerLabelOverride = storedPlayerLabel(session.metadata) ?? ""
			{
				const stored = storedGuestSeatSwitches(session.metadata)
				guestsBringOwn = stored.bringOwn
				guestsTakeCast = stored.takeCast
			}
			sceneOverride = storedSceneSettings(session.metadata)
			// Reset originalData to null so it gets re-initialized with the loaded data
			originalData = undefined
			handoverDraft.clear()
			moveDraft.clear()
			movePick.clear()
			cardFor.clear()
			pendingSeats = []
			sharedPicks = []
		}
	}

	const handleCharactersList = (msg: Sockets.Characters.List.Response) => {
		// The owner's pickers drop shared rows (read and copy only, Q3); a
		// guest may copy one into the session (G3), offered via `sharedToOffer`.
		const split = splitSharedRows(msg.characterList)
		characters = split.own
		sharedRows = split.shared
	}

	const handleLorebooksList = (msg: Sockets.Lorebooks.List.Response) => {
		lorebookNames = Object.fromEntries(
			msg.lorebookList.map((b) => [b.id, b.name ?? ""])
		)
		// A provided book stays (read into a session by anyone, m3-core); other shared books are read and copy only.
		lorebookList = msg.lorebookList
			.filter(
				(b) =>
					!b.isSharedWithMe ||
					!!(b as { provided?: unknown }).provided
			)
			.filter(
				// 🚧 An admin's own starter lorebooks: a session starts from a kit, never reads one.
				(l) => (l as { kind?: string }).kind !== "starter_kit"
			) // only owned books: a shared one is read and copy only (PLAN-private-messages §6.7)
	}

	const handleSessionsModes = (msg: Sockets.Sessions.Genres.Response) => {
		modesList = msg.genres || []
	}

	const handleAccountVisibility = (
		msg: Sockets.Sessions.AccountVisibility.Response
	) => {
		if (msg.sessionId !== session?.id) return
		accountVisibility = msg
	}

	/** 🚧 pr-6 (R-p): Share as a lorebook — asked first, then the session's notes become a lorebook it reads. */
	let makingBook = $state(false)
	let askingShare = $state(false)
	function makeBookFromNotes() {
		if (!session?.id || makingBook) return
		askingShare = true
	}
	function shareNotesAsLorebook() {
		askingShare = false
		if (!session?.id || makingBook) return
		const sessionId = session.id
		makingBook = true
		let releaseOk = () => {}
		let releaseErr = () => {}
		const done = () => {
			releaseOk()
			releaseErr()
			makingBook = false
		}
		releaseErr = declareInterest<"sessions:shareAsLorebook:error">(
			interestKey("sessions:shareAsLorebook:error"),
			(res) => {
				if (res.sessionId !== sessionId) return
				done()
			}
		)
		releaseOk = requestWithInterest(
			"sessions:shareAsLorebook",
			{ sessionId },
			(res) => {
				if (res.sessionId !== sessionId) return
				done()
				if (typeof res.lorebookId === "number") {
					lorebookId = res.lorebookId
					savedLorebookId = res.lorebookId
				}
			}
		)
	}

	// The mode's functions and their state on this session (19 §3). Companions —
	// contributed from the mode owner's own namespace — arrive on; foreign ones
	// arrive off and are opt-in. Absence of a row means the default answers, so
	// a companion added in a later update reaches sessions that never had a view.
	let sessionFunctions: Sockets.Sessions.Functions.Response["functions"] =
		$state([])
	let functionsBusy: string | null = $state(null)
	let canAddOutsidePreset = $state(false)

	const handleSessionsFunctions = (
		msg: Sockets.Sessions.Functions.Response
	) => {
		if (msg.sessionId !== session?.id) return
		sessionFunctions = msg.functions || []
		canAddOutsidePreset = !!msg.canAddOutsidePreset
		functionsBusy = null
	}

	// Two groups, because they answer different questions. The preset's actions
	// are "what this session has"; the rest are "what its mode could offer" — and
	// only an admin can move something from the second list into the first.
	const presetActions = $derived(sessionFunctions.filter((f) => f.included))
	const outsideActions = $derived(sessionFunctions.filter((f) => !f.included))

	const handleSessionsSetFunction = (
		msg: Sockets.Sessions.SetFunction.Response
	) => {
		if (msg.sessionId !== session?.id) return
		functionsBusy = null
		// The refusal verbatim — an unoffered function and a mode mismatch both
		// name what went wrong, and summarizing them here would lose the half
		// that tells somebody what to do about it.
		if (msg.error)
			notify.error({
				source: "socket:sessions:setFunction",
				title: "Actions",
				description: msg.error
			})
	}

	/**
	 * One action's switch, named by its identity (`<spec slug>#<key>`, W1):
	 * enablement is per action, so core's `summarize` and a plugin's are
	 * two checkboxes that do not move together.
	 */
	function toggleSessionFunction(
		f: { specSlug: string; key: string },
		enabled: boolean
	) {
		if (!session?.id) return
		const identity = actionIdentity(f)
		functionsBusy = identity
		socket.emit("sessions:setFunction", {
			sessionId: session.id,
			action: identity,
			enabled
		})
	}

	/** The mode's functions on this session — interest and request in one, bare. */
	$effect(() => {
		const id = session?.id
		if (!id) return
		return requestWithInterest(
			"sessions:functions",
			{ sessionId: id },
			handleSessionsFunctions
		)
	})

	const handleSessionsUpgradeMode = (
		msg: Sockets.Sessions.UpgradeGenre.Response
	) => {
		if (msg.sessionId !== session?.id) return
		if (msg.error) {
			// The validator's sentences, verbatim — "never a silent coercion"
			// also means never a summarized refusal.
			notify.error({
				source: "socket:sessions:upgradeGenre",
				title: "Genre",
				description: msg.error
			})
			return
		}
		notify.success({
			source: "socket:sessions:upgradeGenre",
			title: "Genre upgraded"
		})
		socket.emit("sessions:get", { id: msg.sessionId })
	}

	/** `ns:kind/name@N` → its halves, for the latest-per-type folds below. */
	const modeParts = genreVersion

	// There is no mid-session mode swap (19 §6, ruled): a session keeps its mode
	// for life. What exists instead is the upgrade — the same bare type at a
	// higher version, offered when one is registered.
	let modeUpgradeTarget = $derived.by(() => {
		if (!session) return null
		const current = modeParts(genreId)
		let best: (typeof modesList)[number] | null = null
		for (const m of modesList) {
			const p = modeParts(m.genreId)
			if (p.bare !== current.bare || p.version <= current.version)
				continue
			if (!best || p.version > modeParts(best.genreId).version) best = m
		}
		return best
	})

	function upgradeMode() {
		if (!session?.id || !modeUpgradeTarget) return
		socket.emit("sessions:upgradeGenre", {
			sessionId: session.id,
			genreId: modeUpgradeTarget.genreId
		})
	}

	/**
	 * Re-fit what the form already holds to the selected mode's shape (19 §2):
	 * field values filtered to the declared keys, participants trimmed to the
	 * shape's bounds, the lorebook detached when the capability is absent — so
	 * a commit can never carry another type's leftovers. The server filters and
	 * validates again on create; this keeps what is *sent* honest so that
	 * refusal never fires from stale UI state.
	 */
	function reconcileToMode() {
		const shape = modesList.find((m) => m.genreId === genreId)?.shape
		if (!shape) return // unknown mode: today's behaviour, nothing to trim
		const declared = shape.fields ?? {}
		genreFields = Object.fromEntries(
			Object.entries(genreFields).filter(([k]) => k in declared)
		)
		const charMax = shape.characters
			? (shape.characters.max ?? Infinity)
			: 0
		if (selectedCharacters.length > charMax)
			selectedCharacters = selectedCharacters.slice(0, charMax)
		if (selectedCharacters.length + selectedMembers.length > charMax)
			selectedMembers = selectedMembers.slice(
				0,
				Math.max(0, charMax - selectedCharacters.length)
			)
		const personaMax = shape.personas ? (shape.personas.max ?? Infinity) : 0
		if (selectedPersonas.length > personaMax)
			selectedPersonas = selectedPersonas.slice(0, personaMax)
	}

	/**
	 * The two views a tab pays for only when it is opened: the account-privacy
	 * view and the pipelines this session involves. Both are session-scoped, so
	 * neither is asked for before `sessions:get` has landed.
	 */
	$effect(() => {
		const id = session?.id
		if (!id) return
		if (activeSessionTab === "visibility" || isGuest)
			socket.emit("sessions:accountVisibility", { sessionId: id })
		if (activeSessionTab === "settings" && seesSessionPipelines)
			socket.emit("sessions:pipelines", { sessionId: id })
	})

	const handleTagsList = (msg: any) => {
		tagsList = msg.tagsList || []
	}

	const handleSetCastSeatEnabled = (
		msg: Sockets.Sessions.SetCastSeatEnabled.Response
	) => {
		if (msg.sessionId !== session?.id) return
		// Sent by Save (note 34): "Session updated" says it landed, and the
		// server re-sends the session itself — only a refusal speaks.
		if (msg.error)
			notify.error({
				source: "socket:sessions:setCastSeatEnabled",
				title: "Seat not benched or brought back",
				description: msg.error
			})
		participantWriteAnswered()
	}

	/**
	 * A newer save of this session's genre fields — the Author's note
	 * widget's, another tab's (2026-10-03). Each one moves what the form
	 * counts as saved; a field the person has not touched here follows it,
	 * an edited one keeps the edit (§6.14), so Save never puts back a value
	 * the form loaded before someone else saved.
	 */
	const handleGenreFieldsChanged = (
		msg: Sockets.Sessions.GenreFieldsChanged.Response
	) => {
		if (msg.sessionId !== session?.id || !originalData) return
		const next = adoptSavedGenreFields(
			$state.snapshot(genreFields),
			$state.snapshot(originalData.session.genreFields ?? {}),
			msg.genreFields ?? {}
		)
		if (!next.moved) return
		originalData.session.genreFields = next.loaded
		genreFields = next.current
	}

	const handleSessionsUpdate = (res: any) => {
		notify.success({
			source: "socket:sessions:update",
			title: "Session updated",
			description: `Session "${res.session.name || "Unnamed session"}" updated successfully.`
		})
		// Participant writes still out: the last answer closes the form.
		const branch =
			confirmedSent && typeof res.branchedTo === "number"
				? (res.branchedTo as number)
				: null
		confirmedSent = false
		if (participantWritesInFlight > 0) {
			closeWhenParticipantsSettle = true
		} else {
			showEditSessionForm = false
			onClose?.()
		}
		// A confirmed Branch: the person goes to the branch it made.
		if (branch !== null) openBranchedSession(branch)
	}

	/**
	 * The answers to Save's guest writes. "Session updated" already says the
	 * save landed, so only a refusal speaks; the server re-broadcasts the
	 * session to its participants, so there is nothing to re-ask.
	 */
	const handleSessionsAddGuest = (
		res: Sockets.Sessions.AddGuest.Response
	) => {
		if (res.sessionId !== session?.id) return
		if (!res.success && res.error)
			notify.error({
				source: "socket:sessions:addGuest",
				title: "Guest not added",
				description: res.error
			})
		participantWriteAnswered()
	}

	const handleSessionsRemoveGuest = (
		res: Sockets.Sessions.RemoveGuest.Response
	) => {
		if (res.sessionId !== session?.id) return
		if (!res.success && res.error)
			notify.error({
				source: "socket:sessions:removeGuest",
				title: "Guest not removed",
				description: res.error
			})
		participantWriteAnswered()
	}

	const handleReassignRemovedParticipant = (
		res: Sockets.Sessions.ReassignRemovedParticipant.Response
	) => {
		if (res.error) {
			notify.error({
				source: "socket:sessions:reassignRemovedParticipant",
				title: "Error reassigning",
				description: res.error
			})
			return
		}
		if (res.success) {
			notify.success({
				source: "socket:sessions:reassignRemovedParticipant",
				title: "History reassigned"
			})
			// The server also broadcasts a "sessions:get" to every participant
			// (including this socket), which handleSessionsGet already applies —
			// no separate local state update needed here.
		}
	}

	/**
	 * Every other `sessions:*` reply this form reads, on the interest registry.
	 *
	 * ⚠ All BARE: none of these events has an entry in `SCOPED_EVENTS`, and a
	 * `#<id>` key for an unscoped event matches NO payload at all, so each
	 * handler's own `msg.sessionId !== session?.id` check stays the filter. The
	 * one scoped key this form holds is `sessions:get`, declared in its own
	 * effect above; `:presets` and `:functions`
	 * are declared with the request that fills them, likewise above.
	 *
	 * Declared at initialisation and released when the form is destroyed: the
	 * interest registry releases this form's subscribers as its effects are.
	 */
	useInterest<"sessions:setCastSeatEnabled">(
		"sessions:setCastSeatEnabled",
		handleSetCastSeatEnabled
	)
	useInterest<"sessions:update">("sessions:update", handleSessionsUpdate)
	useInterest<"sessions:storyClock">(
		"sessions:storyClock",
		handleClockPreCheck
	)
	useInterest<"sessions:storyClock:error">(
		"sessions:storyClock:error",
		handleClockPreCheck
	)
	useInterest<"sessions:genreFieldsChanged">(
		"sessions:genreFieldsChanged",
		handleGenreFieldsChanged
	)
	useInterest<"sessions:addGuest">(
		"sessions:addGuest",
		handleSessionsAddGuest
	)
	useInterest<"sessions:removeGuest">(
		"sessions:removeGuest",
		handleSessionsRemoveGuest
	)
	// A thrown write answers on its `:error` sibling, which Layout's catch-all
	// already toasts — counted here only, so the form still closes.
	useInterest<"sessions:addGuest:error">(
		"sessions:addGuest:error",
		participantWriteAnswered
	)
	useInterest<"sessions:removeGuest:error">(
		"sessions:removeGuest:error",
		participantWriteAnswered
	)
	// The setup gate (and any throw `register` catches) answers the cast and
	// envoy writes on `:error` too — counted the same way.
	useInterest<"sessions:setCastSeatEnabled:error">(
		"sessions:setCastSeatEnabled:error",
		participantWriteAnswered
	)
	useInterest<"sessions:setEnvoySeat:error">(
		"sessions:setEnvoySeat:error",
		participantWriteAnswered
	)
	useInterest<"sessions:reassignRemovedParticipant">(
		"sessions:reassignRemovedParticipant",
		handleReassignRemovedParticipant
	)
	useInterest<"sessions:genres">("sessions:genres", handleSessionsModes)
	useInterest<"sessions:upgradeGenre">(
		"sessions:upgradeGenre",
		handleSessionsUpgradeMode
	)
	useInterest<"sessions:accountVisibility">(
		"sessions:accountVisibility",
		handleAccountVisibility
	)
	useInterest<"sessions:pipelines">(
		"sessions:pipelines",
		handleSessionsPipelines
	)
	useInterest<"sessions:setFunction">(
		"sessions:setFunction",
		handleSessionsSetFunction
	)

	/**
	 * The cast pickers' three lists. All BARE — each is the whole of this
	 * user's characters/personas/tags, not one session's rows, so none has an
	 * interest scope to narrow to — and all standing, because all three are
	 * cascade targets: a character created, imported or renamed anywhere
	 * re-sends the list these pickers render.
	 */
	useInterest<"characters:list">("characters:list", handleCharactersList)
	useInterest<"tags:list">("tags:list", handleTagsList)

	/**
	 * The lorebook picker's list, on the same terms and for the same reasons:
	 * BARE (this user's whole list, nothing in `SCOPED_EVENTS` to key it to)
	 * and standing, because a lorebook created elsewhere re-sends it.
	 */
	useInterest<"lorebooks:list">("lorebooks:list", handleLorebooksList)

	onMount(() => {
		// Request initial data
		socket.emit("characters:list", {})
		socket.emit("lorebooks:list", {})
		socket.emit("tags:list", {})
		// The `sessions:genres` key is already held (declared above); the typed
		// `emit` puts its sync packet ahead of this request on the same socket.
		socket.emit("sessions:genres", {})
	})

	/**
	 * The session's envoys (plans/29 R-18; U5g) — the speakers its genre
	 * brings with it, off `sessions:view`, with whether each is seated. The
	 * genre's are offered here with a seat toggle; an action's is seated by
	 * its action's post and is listed without one.
	 */
	let sessionEnvoys: Sockets.Sessions.View.Envoy[] = $state([])
	const handleSessionsView = (msg: Sockets.Sessions.View.Response) => {
		if (msg.sessionId !== session?.id) return
		sessionEnvoys = msg.envoys ?? []
	}
	$effect(() => {
		const id = session?.id
		if (!id) return
		return requestWithInterest(
			"sessions:view",
			{ sessionId: id },
			handleSessionsView
		)
	})
	const genreEnvoys = $derived(
		sessionEnvoys.filter((e) => e.origin === "genre")
	)
	/**
	 * An envoy's seat is a pending change like the rest of Participants
	 * (note 34): the switch shows `envoyDraft` over the saved seat, and Save
	 * sends `sessions:setEnvoySeat` for each that differs. A refusal (not the
	 * owner, an undeclared slug, an action's envoy) is toasted and the list
	 * re-read, so the saved truth shows (U5g review, S3).
	 */
	function setEnvoySeat(slug: string, seated: boolean): void {
		// Held until Save (note 34); `envoyChanges` is what Save sends.
		envoyDraft = { ...envoyDraft, [slug]: seated }
	}
	const shownSeated = (e: { slug: string; seated: boolean }) =>
		envoyDraft[e.slug] ?? e.seated
	/** Envoys whose seat switch differs from the saved seat. */
	const envoyChanges = $derived(
		genreEnvoys.filter(
			(e) => e.slug in envoyDraft && envoyDraft[e.slug] !== e.seated
		)
	)
	/** The held bench changes and envoy seats that differ from saved —
	 *  read by `isDirty`, which is declared before these. */
	function participantChangesDirty(): boolean {
		return (
			benchChanges.length > 0 ||
			envoyChanges.length > 0 ||
			moveDraft.size > 0
		)
	}
	const handleSessionsSetEnvoySeat = (
		msg: Sockets.Sessions.SetEnvoySeat.Response
	) => {
		if (msg.sessionId !== session?.id) return
		participantWriteAnswered()
		if (!msg.error) return
		notify.error({
			source: "socket:sessions:setEnvoySeat",
			title: "Envoy seat",
			description: msg.error
		})
		// The truth is the server's list; the optimistic flip is reverted by
		// re-reading it rather than by guessing the previous value.
		socket.emit("sessions:view", { sessionId: msg.sessionId })
	}
	useInterest<"sessions:setEnvoySeat">(
		"sessions:setEnvoySeat",
		handleSessionsSetEnvoySeat
	)
</script>

{#if data}
	<div class="flex min-h-full flex-col gap-3">
		<PanelNavHeader
			title={name || session?.name || "Session"}
			onBack={showBack ? handleCloseForm : undefined}
			backLabel="Back"
		>
			{#snippet primaryAction()}
				<button
					type="button"
					class="btn btn-sm shrink-0 {isDirty
						? 'preset-filled-primary-500'
						: 'preset-tonal'}"
					onclick={handleSave}
					disabled={!canSave}
				>
					<Icons.Save size={16} aria-hidden="true" />
					Save
				</button>
			{/snippet}
			{#snippet subtitle()}
				{#if isDirty}
					<p class="text-surface-600-400 text-xs">Unsaved changes</p>
				{/if}
			{/snippet}
		</PanelNavHeader>

		{#if !session}
			<LoadingState message="Loading session…" />
		{:else}
			{#if isGuest}
				<p class="preset-tonal-surface rounded-base text-chip p-3">
					You're a guest in this session. You can change your own
					seats here; everything else is the session owner's.
				</p>
			{/if}

			{#if !isGuest}
				<section class={CARD_CLASS}>
				<h3 class="mb-3 text-sm font-medium">Name</h3>
				<div class="flex flex-col">
					<label
						class="text-surface-600-400 mb-1.5 text-xs"
						for="sessionName"
					>
						Session name
					</label>
					<input
						id="sessionName"
						class="{FIELD_CLASS} {validationErrors.name
							? 'border-error-500'
							: ''}"
						type="text"
						placeholder="Name this session"
						bind:value={name}
						required
						disabled={isGuest}
						oninput={() => {
							if (validationErrors.name) {
								const { name, ...rest } = validationErrors
								validationErrors = rest
							}
						}}
					/>
					{#if validationErrors.name}
						<p class="text-error-600-400 mt-1 text-xs" role="alert">
							{validationErrors.name}
						</p>
					{/if}
				</div>
				</section>
			{/if}

			<!-- Genre (19 §2, §6 as ruled). A session keeps its genre for life:
			     there is no swap control, only the upgrade along the same type
			     when the author has shipped a newer version, and even that is
			     shape-validated server-side with sentence refusals. -->
			{#if !isGuest && modeUpgradeTarget}
				<section class={CARD_CLASS}>
					<h3 class="mb-3 text-sm font-medium">Genre</h3>
					<div class="flex flex-wrap items-center gap-2">
						<span
							class="preset-tonal rounded-base text-chip px-3 py-1.5"
						>
							{modesList.find((m) => m.genreId === genreId)
								?.name ?? genreId}
						</span>
						<button
							class="btn btn-sm preset-filled-primary-500 shrink-0"
							onclick={upgradeMode}
						>
							<Icons.ArrowUpCircle size={14} aria-hidden="true" />
							Upgrade to {genreVersionLabel(
								modeUpgradeTarget.genreId
							)}
						</button>
					</div>
					<p class="text-surface-600-400 mt-2 text-xs">
						This session is on {genreVersionLabel(genreId)} of its genre,
						and {genreVersionLabel(modeUpgradeTarget.genreId)}
						is installed. Upgrading keeps the session and its settings.
					</p>
				</section>
			{/if}

			{#if !isGuest}
				<PanelTabStrip
					bind:value={activeSessionTab}
					tabs={sessionTabs}
					ariaLabel="Session settings"
					panelIdPrefix="session-panel"
				/>
			{/if}

			<!-- A guest has this view and no tabs (G1): it is not a tabpanel,
			     and shows whatever tab an opener named. -->
			<div
				id="session-panel-participants"
				role={isGuest ? undefined : "tabpanel"}
				aria-labelledby={isGuest
					? undefined
					: "session-panel-participants-tab"}
				aria-label={isGuest ? "Participants" : undefined}
				hidden={!isGuest && activeSessionTab !== "participants"}
				bind:this={participantsPanel}
			>
				<div class="flex flex-col gap-3 pt-3">
					<!-- The tab's rule, said once (note 34; STYLE-GUIDE §6.14):
					     everything here is held until Save. -->
					<p class="text-surface-600-400 text-xs">
						Changes here wait for Save — adding, benching, bringing
						back and reordering. Reassigning a benched seat's lines
						happens at once.
					</p>
					{#if isGuest && !canBringOwn && (showCharactersSection || showPersonasSection)}
						<p class="text-surface-600-400 text-xs">
							{GUEST_SEAT_SENTENCES.bringOwnOff}
						</p>
					{/if}
					{#if isGuest && !canTakeCast && showCharactersSection}
						<p class="text-surface-600-400 text-xs">
							{GUEST_SEAT_SENTENCES.takeCastOff}
						</p>
					{/if}
					<p class="sr-only" aria-live="polite">{seatLive}</p>
					<!-- Capability-gated (19 §2): a section the mode's shape
						     omits does not exist for this session, so it neither
						     renders nor blocks saving. -->
					{#if showCharactersSection}
						<SessionCharacters
							{charactersFloor}
							{selectedCharacters}
							{selectedMembers}
							{dragging}
							{session}
							{isGuest}
							{userCtx}
							{seatPlayerWords}
							{ownerId}
							{characterSeater}
							{memberSeater}
							{playedByChoice}
							{pickPlayedBy}
							{confirmMove}
							{cancelMove}
							{savedCharacterSeat}
							{savedMemberSeat}
							{handleSeatDrag}
							{moveCharacterUp}
							{moveCharacterDown}
							{moveSeat}
							{confirmRemoveCharacter}
							{confirmRemoveMember}
							{fallenNote}
							{castMemberHref}
							canChangeCarded={canBringOwn}
							canChangeCastSeats={canTakeCast}
							onAddCharacter={() => (showCharacterModal = true)}
							sharedPicks={sharedPicksOf("character")}
							onRemoveSharedPick={(id) =>
								removeSharedPick("character", id)}
						/>
					{/if}
					{#if genreEnvoys.length}
						<!-- The genre's envoys (R-18): cast members the genre
						     brings with it, seated with a switch. Not a
						     character — nothing to add, remove or reorder. -->
						<section class={CARD_CLASS}>
							<h3 class="mb-1 text-sm font-medium">Envoys</h3>
							<p class="text-surface-600-400 mb-3 text-xs">
								Characters this genre brings along, such as a
								narrator.{isGuest ? "" : " Switch one on to include it."}
							</p>
							<div class="mb-2 flex flex-col gap-1">
								{#each genreEnvoys as envoy (envoy.slug)}
									<div
										class="bg-surface-50-950 rounded-base flex min-h-11 flex-wrap items-center gap-2 p-2"
									>
										{#if envoy.image}
											<img
												class="h-10 w-10 shrink-0 rounded-full object-cover"
												src={envoy.image}
												alt=""
											/>
										{:else}
											<span
												class="preset-tonal-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
												aria-hidden="true"
											>
												{envoy.name
													.trim()
													.charAt(0)
													.toUpperCase() || "?"}
											</span>
										{/if}
										<div class="min-w-0 flex-1">
											<div
												class="text-lead truncate font-medium select-none"
											>
												{envoy.name}
											</div>
											<div
												class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
											>
												{envoy.description ?? ""}
											</div>
										</div>
										<span
											class="text-surface-600-400 shrink-0 text-xs"
											title={envoy.speaks === "in-turn"
												? "Takes turns replying like a character"
												: "Speaks only through its action"}
										>
											{envoy.speaks === "in-turn"
												? "Replies in turn"
												: "On action"}
										</span>
										{#if isGuest}
											<span
												class="text-surface-600-400 shrink-0 text-xs"
											>
												{shownSeated(envoy)
													? "In this session"
													: "Not in this session"}
											</span>
										{:else}
										<Switch
											name="toggle-envoy-seat-{envoy.slug}"
											checked={shownSeated(envoy)}
											onCheckedChange={(e) =>
												setEnvoySeat(
													envoy.slug,
													e.checked
												)}
											aria-label="Seat {envoy.name} in this session"
										>
											<Switch.Control
												class="preset-filled-surface-500 data-[state=checked]:preset-filled-primary-500 w-9"
											>
												<Switch.Thumb>
													{#if shownSeated(envoy)}
														<Icons.Smile
															size="14"
														/>
													{:else}
														<Icons.Meh size="14" />
													{/if}
												</Switch.Thumb>
											</Switch.Control>
											<Switch.HiddenInput />
										</Switch>
										{/if}
									</div>
								{/each}
							</div>
						</section>
					{/if}
					{#if showPersonasSection}
						<SessionPersonas
							{personasFloor}
							{selectedPersonas}
							bind:playerSeats
							{dragging}
							{session}
							{isGuest}
							{userCtx}
							{savedPersonaSeat}
							{savedPlayerSeat}
							{handleSeatDrag}
							{movePersonaUp}
							{movePersonaDown}
							{moveSeat}
							{confirmRemovePersona}
							{fallenNote}
							{castMemberHref}
							{seatPlayerWords}
							people={seatPeople}
							{personName}
							{personaPlayer}
							{seatPlayer}
							{playedByChoice}
							{pickPlayedBy}
							{confirmMove}
							{cancelMove}
							canChangeCarded={canBringOwn}
							onAddPersona={(who) => {
								personaAskedBy = who
								showPersonaModal = true
							}}
							addFor={isGuest
								? []
								: [
										...(ownerId != null ? [ownerId] : []),
										...savedPlayerGuests.map((g) => g.userId)
									]}
							{membersForSeats}
							{pendingSeats}
							{addMemberSeat}
							{addNamedSeat}
							{removePendingSeat}
							sharedPicks={sharedPicksOf("player")}
							onRemoveSharedPick={(id) =>
								removeSharedPick("player", id)}
						/>
					{/if}

					{#if hasSavedSeat}
							<SessionBenchedSeats
								{showCharactersSection}
								{showPersonasSection}
								{benchedCharacters}
								{benchedMembers}
								{benchedPersonas}
								{benchedPlayerSeats}
								{dragging}
								{session}
								{isGuest}
								{userCtx}
								{savedCharacterSeat}
								{savedMemberSeat}
								{savedPersonaSeat}
								{savedPlayerSeat}
								{handleSeatDrag}
								{moveSeat}
								{openReassignModal}
								{confirmRemoveCharacter}
								{confirmRemoveMember}
								{confirmRemovePersona}
								{seatPlayerWords}
								{ownerId}
								{characterSeater}
								{memberSeater}
								{personaPlayer}
								{seatPlayer}
								canChangeCarded={canBringOwn}
								canChangeCastSeats={canTakeCast}
								onRemoveBenchedPlayerSeat={(id) =>
									(benchedPlayerSeats = benchedPlayerSeats.filter(
										(p) => p.id !== id
									))}
							/>
					{/if}

					<!-- A solo genre (`GenreDecl.members`, ruled 2026-10-19) seats nobody else: no Guests card. -->
					{#if editSessionId && systemSettingsCtx?.settings?.isAccountsEnabled && (modesList.find((m) => m.genreId === genreId) as any)?.members !== "solo"}
						<section class={CARD_CLASS}>
							<div
								class="mb-3 flex items-center justify-between gap-2"
							>
								<h3 class="text-sm font-medium">Guests</h3>
								{#if !isGuest}
									<button
										class="btn btn-sm preset-tonal shrink-0"
										onclick={() => (showGuestModal = true)}
									>
										<Icons.UserPlus
											size={16}
											aria-hidden="true"
										/>
										Add guests
									</button>
								{/if}
							</div>
							<div class="flex flex-col gap-1">
								{#each selectedGuests as guest (guest.userId)}
									{@const guestSaved =
										!!session?.sessionGuests?.some(
											(g) => g.userId === guest.userId
										)}
									<div
										class="bg-surface-50-950 rounded-base flex min-h-11 items-center justify-between gap-2 p-2"
									>
										<span
											class="flex min-w-0 flex-1 items-center gap-2"
										>
											<Icons.UserRound
												size={18}
												class="shrink-0"
												aria-hidden="true"
											/>
											<span
												class="text-lead truncate font-medium"
											>
												{resolveUserHandle(guest.user)}
											</span>
										</span>
										{#if !guestSaved}
											<span
												class="text-surface-600-400 shrink-0 text-xs"
											>
												Ready to add
											</span>
										{/if}
										{#if !isGuest}
										<button
											class="btn-ghost text-error-600-400 hover:bg-error-500/10 shrink-0 rounded p-1"
											onclick={() =>
												confirmRemoveGuest(
													guest.userId,
													resolveUserHandle(
														guest.user
													)
												)}
											title="Remove guest"
											aria-label="Remove {resolveUserHandle(
												guest.user
											)} from the session"
										>
											<Icons.X size={16} />
										</button>
										{/if}
									</div>
								{/each}
							</div>
							{#if !isGuest && selectedGuests.length > 0 && (showCharactersSection || showPersonasSection)}
								<!-- 🚧 The owner's two guest seat switches (G3, G4):
								     held until Save; only the seat kinds the genre has, and only
								     once the session has a guest (saved or pending here). -->
								<div class="mt-3 flex flex-col gap-3">
									<div class="flex flex-col gap-1">
										<Switch
											name="guests-bring-own"
											checked={guestsBringOwn}
											onCheckedChange={(e) =>
												(guestsBringOwn = e.checked)}
										>
											<Switch.Control
												class="preset-filled-surface-500 data-[state=checked]:preset-filled-primary-500 w-9"
											>
												<Switch.Thumb />
											</Switch.Control>
											<Switch.HiddenInput
												aria-describedby="guests-bring-own-help"
											/>
											<Switch.Label class="text-sm"
												>Guests can bring their own
												characters</Switch.Label
											>
										</Switch>
										<FieldHelp id="guests-bring-own-help">
											Guests add, remove and bench
											characters and personas they own{guestsMayNameSeat
												? ", and can name a seat"
												: ""}. Off keeps their seats as
											they are.
										</FieldHelp>
									</div>
									{#if showCharactersSection}
										<div class="flex flex-col gap-1">
											<Switch
												name="guests-take-cast"
												checked={guestsTakeCast}
												onCheckedChange={(e) =>
													(guestsTakeCast = e.checked)}
											>
												<Switch.Control
													class="preset-filled-surface-500 data-[state=checked]:preset-filled-primary-500 w-9"
												>
													<Switch.Thumb />
												</Switch.Control>
												<Switch.HiddenInput
													aria-describedby="guests-take-cast-help"
												/>
												<Switch.Label class="text-sm"
													>Guests can take cast
													members</Switch.Label
												>
											</Switch>
											<FieldHelp id="guests-take-cast-help">
												Guests take or leave the seat of
												a cast member without a card whom
												nobody plays. Off keeps their
												seats as they are.
											</FieldHelp>
										</div>
									{/if}
								</div>
							{/if}
						</section>
					{/if}
					<!-- A guest's own Privacy view, at the foot (G1): they have
					     no Privacy tab. -->
					{#if isGuest}
						<section class={CARD_CLASS}>
							<h3 class="mb-3 text-sm font-medium">Privacy</h3>
							<SessionVisibilityPanel {accountVisibility} omitGuestLine />
						</section>
					{/if}
				</div>
			</div>

			{#if !isGuest}
			<div
				id="session-panel-settings"
				role="tabpanel"
				aria-labelledby="session-panel-settings-tab"
				hidden={activeSessionTab !== "settings"}
			>
				<div class="flex flex-col gap-3 pt-3">
					<!-- The tab's rule, said once (note 34; STYLE-GUIDE §6.14):
					     the session's own fields wait for Save; the controls that
					     change how it runs write as they move and say so. -->
					<p class="text-surface-600-400 text-xs">
						The story, what your lines are called and the tags wait
						for Save. Everything marked “Applies at once” — the
						genre's settings, each pipeline's and the routines —
						changes the session as you set it.
					</p>
					<section class={CARD_CLASS}>
						<h3 class="mb-3 text-sm font-medium">The story</h3>
						<div class="flex flex-col gap-4">
							<div class="flex flex-col">
								<label
									class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
									for="scenario"
								>
									Scenario
									<span
										class="flex items-center"
										title="This field will be visible in prompts"
									>
										<Icons.ScanEye
											size={14}
											aria-hidden="true"
										/>
									</span>
								</label>
								<textarea
									id="scenario"
									class={FIELD_CLASS}
									placeholder="Describe the session scenario, setting, or context (optional)"
									bind:value={scenario}
									rows={3}
									disabled={isGuest}
								></textarea>
							</div>
							{#if showLorebookField}
								<div class="flex flex-col">
									<p
										class="text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
									>
										Lorebook{modeShape?.lorebook ===
										"required"
											? "*"
											: ""}
										<span
											class="flex items-center"
											title="The session will use world lore, character lore and history entries from this lorebook"
										>
											<Icons.MessageCircleQuestion
												size={14}
												aria-hidden="true"
											/>
										</span>
									</p>
									<!-- 🚧 The book is fixed at start (owner 2026-11-08): chosen
									     when the session is created, read-only here. -->
									<p
										class="text-surface-600-400 text-xs"
										data-session-lorebook-line={savedLorebookId ==
										null
											? "own"
											: "overlay"}
									>
										{#if isGuest}
											{savedLorebookName}
										{:else if savedLorebookId == null}
											{BOOK_LOCK_LINES.ownBook}
										{:else}
											{BOOK_LOCK_LINES.overlay(
												savedLorebookName
											)}
										{/if}
									</p>
									<!-- 🚧 Lorebook writes: the stricter of the owner's
									     setting and the book's, and which one it is when
									     they differ (owner 2026-10-21). The owner's to
									     read: a guest's turn writes under the owner's. -->
									{#if sessionWrites && !isGuest}
										<div
											class="text-surface-600-400 mt-2 flex flex-col items-start gap-1 text-xs"
											data-session-lore-writes={sessionWrites.mode}
											data-session-lore-writes-limited={sessionWrites.limitedBy ??
												""}
										>
											<p>
												Lorebook writes:
												<strong
													class="text-surface-800-200"
												>
													{LORE_WRITE_MODE_CHOICES[
														sessionWrites.mode
													].label}
												</strong>
												{#if sessionWrites.limitedBy === "lorebook"}
													— this lorebook allows no
													more, though your own
													setting is {LORE_WRITE_MODE_CHOICES[
														sessionWrites.personal
													].label}.
												{:else if sessionWrites.limitedBy === "personal"}
													— your own setting allows no
													more, though this lorebook
													would take
													{LORE_WRITE_MODE_CHOICES[
														(lorebookList.find(
															(l) =>
																l.id ===
																lorebookId
														)
															?.loreWriteMode as LoreWriteMode) ??
															"full"
													].label}.
												{:else}
													— as your setting and this
													lorebook allow.
												{/if}
											</p>
											{#if sessionWrites.limitedBy && writesPanelsCtx}
												<button
													type="button"
													class="anchor text-xs"
													onclick={() =>
														openWritesSetting(
															sessionWrites!
																.limitedBy!
														)}
												>
													{sessionWrites.limitedBy ===
													"lorebook"
														? "Change it in Book settings"
														: "Change it in Settings › User"}
												</button>
											{/if}
										</div>
									{/if}
									<!-- 🚧 The session's own notes (PLAN-rulesets §26): the book it
									     reads when it started with none of its own choosing; made a
									     real one here as well as from the session's menu in Sessions
									     (2026-10-19: nobody found it there). -->
									{#if session?.id && !isGuest && lorebookId == null && savedLorebookId == null}
										<div
											class="mt-2 flex flex-col gap-1"
											data-testid="lorebook-from-notes"
										>
											<button
												type="button"
												class="btn btn-sm preset-tonal self-start"
												disabled={makingBook}
												onclick={makeBookFromNotes}
											>
												<Icons.BookPlus
													size={16}
													aria-hidden="true"
												/>
												{SHARE_LABELS.asLorebook}
											</button>
										</div>
									{/if}
								</div>
								{#if lorebookId != null && lorebookId === savedLorebookId}
									<!-- Guests see where the session reads, read-only: the
									     book's lines and presents are the owner's to read
									     (#139), so nothing is asked for on their behalf. -->
									<SessionLorebookReading
										{lorebookId}
										timeline={lorebookList.find(
											(b) => b.id === lorebookId
										)?.timelineEnabled !== false}
										bind:branchId={lorebookBranchId}
										bind:clock={storyClock}
										readOnly={isGuest || !advanced}
										lockedByAdvanced={!isGuest && !advanced}
									/>
									<!-- The reply tick (*Each reply advances the clock by …*)
									     is the reply's own setting now: it sits on the Reply
									     card of the settings below (lane 7, 2026-10-21). -->
								{/if}
								{#if showOwnReading && ownReadingBookId != null}
									<SessionLorebookReading
										lorebookId={ownReadingBookId}
										bind:branchId={lorebookBranchId}
										bind:clock={storyClock}
										readOnly={isGuest || !advanced}
										lockedByAdvanced={!isGuest && !advanced}
									/>
								{/if}
								<!-- 🚧 Scenes (live scenes §4–§5): where a new scene
								     begins and when its summary is written — for a
								     session reading a book, in a genre that writes
								     scenes. Waits for Save like the rest of the card. -->
								{#if lorebookId != null && (modeShape as { writes?: { scenes?: boolean } } | null)?.writes?.scenes !== false}
									<SessionSceneSettings
										sessionId={editSessionId}
										genreShape={modeShape}
										bind:override={sceneOverride}
										boundaryTriggers={modesList.find(
											(m) => m.genreId === genreId
										)?.sceneBoundaryTriggers ?? []}
										disabled={isGuest}
									/>
								{/if}
							{/if}
						</div>
					</section>
					<!-- What the session tracks (ruled 2026-09-25): applied at once,
					     not with Save — a pick changes what this session tracks
					     from now on. -->
					{#if editSessionId != null}
						<SessionAttributes
							sessionId={editSessionId}
							cardClass={CARD_CLASS}
						/>
					{/if}

					<!-- Session actions (19 §3). Three layers decide what a session has:
						     its own answer, then its preset's included set, then the
						     companion rule. The permission line runs between the two
						     lists — anyone may toggle what the preset included; only
						     an admin may reach into the second list, because that
						     gives the session something the instance owner did not
						     offer it. -->
					{#if advanced && session && !isGuest && sessionFunctions.length > 0}
						<SessionActions
							{presetActions}
							{outsideActions}
							{functionsBusy}
							{canAddOutsidePreset}
							{toggleSessionFunction}
						/>
					{/if}

					<!-- Pipeline cards (PLAN-turn-order §4.11): every node the
					     session's pipelines expose to it — the turn order's
					     strategy first among them — as a swap picker. -->
					{#if advanced && session}
						<PipelineCards
							sessionId={session.id}
							canEdit={!isGuest}
							cardClass={CARD_CLASS}
						/>
					{/if}
					<!-- What the person's own lines are called (lair re-plan R4): only
					     for a genre that declares a `playerLabel`. Blank keeps the
					     genre's; a rename relabels every line already written. -->
					{#if genrePlayerLabel}
						<section class={CARD_CLASS}>
							<div class="flex flex-col">
								<label
									class="text-surface-600-400 mb-1.5 text-xs"
									for="playerLabel"
								>
									What your lines are called
								</label>
								<input
									id="playerLabel"
									class={FIELD_CLASS}
									type="text"
									maxlength="60"
									placeholder={genrePlayerLabel}
									aria-describedby="playerLabel-help"
									bind:value={playerLabelOverride}
									disabled={isGuest}
								/>
								<p
									id="playerLabel-help"
									class="text-surface-600-400 mt-1.5 text-xs"
								>
									The name your messages show and the AI
									reads. Leave it empty to use "{genrePlayerLabel}".
								</p>
							</div>
						</section>
					{/if}

					<!-- 🚧 The preset (2026-10-19): which of its genre's presets the
					     session runs, when the genre offers more than one. Applies at
					     once; what it changes reaches the settings below. -->
					{#if session?.id && !isGuest && switchablePresets.length > 1}
						<section class={CARD_CLASS} aria-label="Preset">
							<SessionPresetControl
								sessionId={session.id}
								{genreId}
								presetId={(session as any)?.presetId ?? null}
								fields={genreFields}
								presets={sessionPresetRows}
								onapplied={() => {
									const next = { ...genreFields }
									delete next.tools
									genreFields = next
								}}
							/>
						</section>
					{/if}

					<!-- 🚧 The session's settings, derived (PLAN-layering §5, A10;
					     lane 7, 2026-10-21): the genre's settings — How strict and
					     the rules among them — then a card per pipeline the preset
					     registers that offers anything, then Routines. Each applies
					     at once; who sees what is the server's (an owner the
					     settings that reach them, an administrator all of it,
					     locked ones read-only). Replaces the Genre settings card,
					     How strict, the step settings and the background tasks. -->
					{#if session?.id && !isGuest}
						<SessionSettingsForm
							sessionId={session.id}
							cardClass={CARD_CLASS}
							genreFieldDecls={modeFieldDecls}
							onchanged={rereadPipelineCards}
							valueLabelOf={(f) =>
								f.address.kind === "genre" &&
								f.address.key === "ruleset"
									? (rulesOffer?.choices.find(
											(c) => c.id === f.value
										)?.name ?? null)
									: null}
							membersOf={(f) =>
								f.address.kind === "genre" &&
								f.address.key === "rigour" &&
								howStrictOptions.length
									? howStrictOptions.map((o) => ({
											key: o.id,
											label: o.label
										}))
									: undefined}
						/>
					{/if}

					<!-- 🚧 On revision (PLAN-rulesets §28): every genre's, beside
					     the genre's own settings. Saved with the form. -->
					{#if advanced && session?.id && !isGuest}
						<section class={CARD_CLASS}>
							<label
								class="mb-1 block text-sm font-medium"
								for="session-on-revision"
							>
								On revision
							</label>
							<p class="text-surface-600-400 mb-2 text-xs">
								What deleting or regenerating the latest turn
								does, and moving the story clock back past
								what this session wrote.
							</p>
							<select
								id="session-on-revision"
								class={FIELD_CLASS}
								bind:value={onRevision}
							>
								<option value="overwrite">
									Overwrite — the old turn is gone
								</option>
								<option value="branch">
									Branch — keep the old turn in the original
									session
								</option>
							</select>
						</section>
					{/if}

					<!-- 🚧 Rules options (PLAN-rulesets §8, W3-A): the session's
					     choices for its rules' options, beside On revision.
					     Applies at once; hidden when the rules offer none. -->
					{#if advanced && session?.id && !isGuest}
						<RulesOptions
							sessionId={session.id}
							cardClass={CARD_CLASS}
							fieldClass={FIELD_CLASS}
						/>
					{/if}

					<!-- One card per pipeline this session runs — the reply's,
					     titled by its pipeline (*Reply*), then each
					     enabled action's — each drawn by the settings panel at this
					     session's scope: every model call's switch, Prompt, Model
					     (read-only: a session names no model) and Sampling — each
					     only to a role that normally edits it, so a non-admin sees
					     prompts alone. A card is drawn only when it holds a row
					     this role edits (owner ruling 2026-09-30). Last
					     comes the pipeline that created the session: editable while
					     creating, then collapsed and read-only, its card saying why
					     (owner ruling 2026-09-30). The section is a heading, not a
					     card: the cards are siblings. Who gets it: the
					     session's owner, and an administrator; a guest gets
					     none (owner ruling D58, 2026-11-16). -->
					{#if advanced && seesSessionPipelines && session?.id && sessionPipelines.length}
						<section
							class="flex flex-col gap-3"
							aria-labelledby="session-pipelines"
						>
							<div>
								<div class="flex items-center gap-1">
									<h3
										id="session-pipelines"
										class="text-sm font-medium"
									>
										Pipelines
									</h3>
									<DocPeek
										href={docsHref("pipelines", "agents")}
										topic="pipeline settings"
									/>
								</div>
								<p class="text-surface-600-400 text-xs">
									Changes here apply to this session only.
									Applies at once — each setting saves as you
									make it.
								</p>
							</div>
							{#each sessionPipelines as p, i (p.slug)}
								<PipelineConfigOptions
									slug={p.slug}
									sessionId={session.id}
									mode="session"
									title={p.label}
									collapsed={i > 0 ||
										p.creation === "created"}
								/>
							{/each}
						</section>
					{/if}

					<!-- Tags -->
					<SessionTags
						bind:tagSearchInput
						bind:showTagSuggestions
						{filteredTags}
						{selectedTags}
						{tagsList}
						{isGuest}
						{addTag}
						{removeTag}
					/>
					<!-- Session data (2026-09-26): the annex, read-only, for the
					     owner's only (the server refuses anyone else, administrators
					     included).
					     Mounted with the tab, so it reads when the tab opens. -->
					<!-- The undo for Regenerate's "Don't ask again" (R2): the
					     owner's, and only where the genre offers retake. -->
					{#if advanced && editSessionId != null && activeSessionTab === "settings" && !isGuest}
						<RetakeAskSetting
							sessionId={editSessionId}
							shape={modeShape}
							cardClass={CARD_CLASS}
						/>
					{/if}
					{#if advanced && editSessionId != null && activeSessionTab === "settings" && !isGuest}
						<SessionAnnexPanel
							sessionId={editSessionId}
							cardClass={CARD_CLASS}
						/>
					{/if}
					{#if !advanced && settingsHides}
						<AdvancedHiddenLine class="px-1" />
					{/if}
				</div>
			</div>

			<div
				id="session-panel-visibility"
				role="tabpanel"
				aria-labelledby="session-panel-visibility-tab"
				hidden={activeSessionTab !== "visibility"}
			>
					<SessionVisibilityPanel {accountVisibility} />
			</div>
			{/if}
		{/if}
	</div>
{/if}
<!-- Each picker hides what the other holds (note 33): a character in the
	cast is not offered to play as, and the one played as is not offered for
	the cast. The same rule as the start form's castOptions / playAsOptions. -->
<CharacterSelectModal
	open={showCharacterModal}
	characters={canBringOwn ? characters : []}
	excludeIds={[
		...selectedCharacters.map((c) => c.id),
		...benchedCharacters.map((c) => c.id),
		...selectedPersonas.map((p) => p.id),
		...benchedPersonas.map((p) => p.id)
	]}
	multiSelect={canTakeCast && membersToOffer.length > 0}
	castMembers={canTakeCast ? bookMembers : []}
	castGroupLabel={isGuest
		? "Cast members"
		: savedLorebookId == null
			? SESSION_NOTES_LABEL
			: lorebookNames[savedLorebookId] || "Untitled lorebook"}
	excludeCastMemberIds={[
		...selectedMembers.map((m) => m.id),
		...benchedMembers.map((m) => m.id),
		...bookMembers.filter((m) => heldByPlayerSeat(m.id)).map((m) => m.id)
	]}
	onOpenChange={(e) => (showCharacterModal = e.open)}
	onSelect={handleAddCharacter}
	sharedCards={sharedOfKind("character")}
	onSelectShared={(row) => addSharedPick("character", row)}
	onMultiSelect={handleAddMany}
	onCreateNew={canBringOwn
		? () => {
				showCharacterModal = false
				showCharacterCreator = true
			}
		: undefined}
/>
<PersonaSelectModal
	open={showPersonaModal}
	excludeIds={[
		...selectedPersonas.map((p) => p.id),
		...benchedPersonas.map((p) => p.id),
		...selectedCharacters.map((c) => c.id),
		...benchedCharacters.map((c) => c.id)
	]}
	onOpenChange={(e) => (showPersonaModal = e.open)}
	onSelect={handleAddPersona}
	sharedCards={sharedOfKind("player")}
	onSelectShared={(row) => addSharedPick("player", row)}
	returnFullPersona={true}
	onCreateNew={() => {
		showPersonaModal = false
		showPersonaCreator = true
	}}
/>
<!-- The creators close themselves once the row exists; onCreated adds it to
	the form straight away so the user lands back on the form with the new
	participant already selected. -->
<CharacterCreatorModal
	bind:open={showCharacterCreator}
	onOpenChange={(e) => (showCharacterCreator = e.open)}
	onCreated={handleAddCharacter}
/>
<!-- A persona is a character, so the persona creator IS the character
	creator. Nothing here sets `is_persona`: the server does it when the
	sessionPersonas row is inserted (markCharacterAsPersona), so a creation the
	user then abandons never leaves a stray flag behind.
	TODO: once CharacterCreatorModal accepts a preset (the library lane's
	`initial` prop), pass `{ isPersona: true }` so the flag is visible in the
	form before Save. -->
<CharacterCreatorModal
	bind:open={showPersonaCreator}
	onOpenChange={(e) => (showPersonaCreator = e.open)}
	onCreated={handleAddPersona}
/>
<ReassignSessionParticipantModal
	open={showReassignModal}
	type={reassignTarget?.type ?? "character"}
	removedName={reassignTarget?.name ?? ""}
	{characters}
	excludeCharacterIds={[
		...selectedCharacters.map((c) => c.id),
		...benchedCharacters.map((c) => c.id)
	]}
	excludePersonaIds={[
		...selectedPersonas.map((p) => p.id),
		...benchedPersonas.map((p) => p.id)
	]}
	onOpenChange={(e) => {
		showReassignModal = e.open
		if (!e.open) reassignTarget = null
	}}
	onSelect={handleReassignSelect}
/>
<!-- RemoveFromSessionModal only models "character" | "persona" (its ternaries
	fall back to the "character" copy for anything else, including its own
	default value of "character") — mapping "guest" to undefined below
	keeps that exact same fallback behavior while satisfying its prop type. -->
<ActionConfirm
	asking={askingShare
		? askingOf(SHARE_CONFIRMS.asLorebook, SHARE_LABELS.asLorebook)
		: null}
	onConfirm={shareNotesAsLorebook}
	onCancel={() => (askingShare = false)}
/>

<ActionConfirm
	asking={clockMoveBack ? clockMoveBackAsking(clockMoveBack) : null}
	onConfirm={confirmClockMove}
	onCancel={cancelClockMove}
/>

<RemoveFromSessionModal
	open={showRemoveModal}
	onOpenChange={(e) => (showRemoveModal = e.open)}
	onConfirm={handleRemoveConfirm}
	onCancel={handleRemoveCancel}
	name={removeName}
	type={removeType === "guest" || removeType === "member"
		? undefined
		: removeType}
/>
<!-- Gated on the same condition the Guests section is: the modal asks for
     `users:list` on mount, and with accounts disabled that request is refused
     and toasted. Mounting it beside a section that cannot be reached means the
     refusal arrives every time the edit form opens. A viewer who is not the
     session's owner adds nobody, and the server refuses `users:list` to a
     non-admin, so the modal is absent for them. -->
{#if editSessionId && session && !isGuest && systemSettingsCtx?.settings?.isAccountsEnabled}
	<UserSelectModal
		open={showGuestModal}
		excludeUserIds={[
			...(session?.userId ? [session.userId] : []),
			...selectedGuests.map((g) => g.userId)
		]}
		onclose={() => (showGuestModal = false)}
		onSelect={() => {}}
		multiSelect={true}
		onMultiSelect={handleAddGuests}
		title="Add guests to session"
		description="Select users to add as guests. Guests can view and participate in the session."
	/>
{/if}
<SessionsUnsavedChangesModal
	open={showCancelModal}
	onOpenChange={handleCloseFormOnOpenChange}
	onConfirm={handleCloseModalDiscard}
	onCancel={handleCloseModalCancel}
/>
