<script lang="ts">
	import { onDestroy } from "svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { normalizeSpriteName } from "$lib/shared/sprites"
	import { ownNameValue } from "$lib/shared/lorebooks/memberIdentity"
	import type { CastMember, CastRow } from "../castPool"
	import {
		draftFollowsRow,
		memberDraftOf,
		memberPatch,
		notesText,
		sameMemberDraft,
		withNotesText,
		type MemberDraft
	} from "./memberDraft"
	import {
		GREETINGS_LABEL,
		RETOLD_LABELS,
		greetingListOf,
		greetingsOf,
		retoldRows,
		setRetold,
		takeFromCard,
		withGreetingList,
		type RetoldProseField,
		type RetoldRow,
		type RetoldRowField
	} from "./retoldRows"
	import { memberFaceSrc } from "./memberFace"
	import { mediaThumbUrl } from "$lib/client/utils/media"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { laterVersionsLine } from "./castSave"
	import CardUpdateOffer from "./CardUpdateOffer.svelte"
	import UseFromCardSwitch from "./UseFromCardSwitch.svelte"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import { FORM_TABS } from "$lib/client/components/characterForms/formTabs"
	import { FIELD_CLASS } from "$lib/client/components/characterForms/fieldClass"
	import ProseField from "$lib/client/components/characterForms/ProseField.svelte"
	import GreetingsList from "$lib/client/components/characterForms/GreetingsList.svelte"
	import CreatorNotesFields from "$lib/client/components/characterForms/CreatorNotesFields.svelte"
	import {
		noteLanguageProblem,
		type NoteLanguageRow
	} from "$lib/client/components/characterForms/cardDraft"
	import VoiceTab from "$lib/client/components/characterForms/VoiceTab.svelte"
	import LikenessTab from "$lib/client/components/characterForms/LikenessTab.svelte"
	import { likenessOfExtensions } from "$lib/shared/characters/likeness"
	import type { CharacterGreeting } from "$lib/shared/characters/profile"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import {
		CAST_STATES,
		CAST_VISIBILITIES,
		stateBadge,
		visibilityBadge
	} from "./castVocabulary"
	import { emptyOwnTimbre } from "./memberDraft"

	/**
	 * One cast member's page: who they are, and where they stand in the world.
	 *
	 * A background member's name and other names are edited here. A carded
	 * member reads as their card's name and nickname until the book gives them
	 * their own (`ownName` / `ownNickname`: shown in this book only, not dated).
	 * *Use from card* on = the card's; off = the book's own, and an own empty
	 * nickname means no nickname in this book. Their other names are their own too (#114,
	 * cast-first): editable here like anyone's, with the card's names merged in
	 * by the server and every name they were known by before the card was
	 * linked kept — changing or unlinking the card never takes those away.
	 *
	 * ⚠ The form draws the member as they READ at the moment being read, so the
	 * row moves under it. The draft remembers what it was built from
	 * (`pristine`), follows the row while clean, and every save hands both up so
	 * the write is only what the author changed (`memberDraft.ts`).
	 */
	interface Props {
		member: CastMember
		row: CastRow
		/** The book the member is in — the face picker lists its pictures. */
		lorebookId: number
		hasUnsavedChanges: boolean
		/**
		 * Write the change to the member. Handed the draft's patch and the patch
		 * it was built from; resolves true once the server has it.
		 */
		onSave: (
			patch: Record<string, unknown>,
			pristine: Record<string, unknown>,
			options: SaveOptions
		) => Promise<boolean>
		/**
		 * File the change as a dated overlay instead. Absent at now, where
		 * there is nothing to choose between.
		 */
		onAmend?: (
			patch: Record<string, unknown>,
			pristine: Record<string, unknown>,
			options: SaveOptions
		) => Promise<boolean>
		/**
		 * How many later versions each save would leave with their own words:
		 * `base` for **Save** (and "change them outright"), `amend` for
		 * **Save as of**. Absent, there is nothing to offer.
		 */
		laterCounts?: { base: number; amend: number }
		/** The moment being read, spelled for the button. */
		momentLabel?: string | null
		onDelete: () => void
		/**
		 * Pick a card. `"amend"` files it from the moment being read; `"base"`
		 * changes the member outright. At now it is always `"base"`.
		 */
		onLinkCharacter: (how: CardWrite) => void
		onUnlink: (how: CardWrite) => void
		/**
		 * Open the linked card in Characters. Given only when the reader
		 * owns the card and the book; absent, there is no button.
		 */
		onEditCard?: () => void
		/**
		 * The viewer can edit the book (the page's edit gate): the **Update**
		 * offer to the card's current version is shown only then.
		 */
		canUpdateCard?: boolean
	}

	type CardWrite = "amend" | "base"

	/** How one save is sent. */
	interface SaveOptions {
		/** ★CV-13: also write the same fields onto the later versions. */
		changeLaterVersions: boolean
	}

	let {
		member,
		row,
		lorebookId,
		hasUnsavedChanges = $bindable(false),
		onSave,
		onAmend,
		laterCounts,
		momentLabel = null,
		onDelete,
		onLinkCharacter,
		onUnlink,
		onEditCard,
		canUpdateCard = false
	}: Props = $props()

	/** Chips rather than a comma-delimited field: one name, one thing to remove. */
	let draft = $state<MemberDraft>(memberDraftOf({ id: 0 }))
	/** What the draft was built from — the "as built" half of every diff. */
	let pristine = $state<MemberDraft>(memberDraftOf({ id: 0 }))
	let aliasDraft = $state("")
	/** Which member the draft belongs to, so a list arrival never discards it. */
	let draftFor = $state<number | null>(null)
	/** A write of ours is on its way; the save controls stand down. */
	let saving = $state(false)
	/**
	 * **Change later versions too** is pressed. Only changes how the next save
	 * is sent, so it is not an unsaved change (§6.14); it resets after every
	 * save and when the member changes.
	 */
	let changeLater = $state(false)

	let card = $derived(row.character ?? null)

	function seed() {
		blankAdded = false
		draft = memberDraftOf(row)
		pristine = memberDraftOf(row)
		seedNotes()
	}

	/**
	 * The member's own creator notes as the shared fields edit them: text,
	 * language and the other-language rows. `writeNotes` writes them back to
	 * the draft; this reads them from it (on seed, and when the card's are
	 * switched on or off).
	 */
	let noteText = $state("")
	let noteLang = $state("")
	let noteRows = $state<NoteLanguageRow[]>([])

	function seedNotes() {
		const notes = draft.creatorNotes
		noteText = notes?.text ?? ""
		noteLang = notes?.lang ?? ""
		noteRows = Object.entries(notes?.variants ?? {}).map(
			([lang, text]) => ({
				lang,
				text
			})
		)
		delete validationErrors.creatorNotesLanguages
	}

	const noteCode = (value: string) => value.trim().toLowerCase()

	/**
	 * A notes edit into the draft. A text edit goes the way it always did
	 * (language and variants kept as they came); a language edit rebuilds
	 * both from the rows. An added empty row changes nothing in the draft, so
	 * it is not an unsaved change (§6.14).
	 */
	function writeNotes() {
		delete validationErrors.creatorNotesLanguages
		if (noteText !== notesText(draft)) {
			draft = withNotesText(draft, noteText)
			return
		}
		const lang = noteCode(noteLang)
		const variants: Record<string, string> = {}
		for (const r of noteRows) {
			const code = noteCode(r.lang)
			if (code) variants[code] = r.text
		}
		const same =
			(lang || undefined) === (draft.creatorNotes?.lang || undefined) &&
			JSON.stringify(variants) ===
				JSON.stringify(draft.creatorNotes?.variants ?? {})
		if (same) return
		draft.creatorNotes = {
			text: noteText,
			...(lang ? { lang } : {}),
			variants
		}
	}

	/** Group → fields that can fail, as on the card. */
	let validationErrors = $state<Record<string, string>>({})
	let activeFormTab: MemberTab = $state("profile")

	/**
	 * Which group each validated field sits in, so a group can mark itself when
	 * something inside it fails while another group is on show. Name is in the
	 * hero above the tabs and shows its own state there.
	 */
	const TAB_FIELDS: Record<MemberTab, string[]> = {
		profile: [],
		voice: [],
		notes: ["creatorNotesLanguages"],
		likeness: [],
		speech: []
	}

	/** The strip's tabs: the card's, without Stats (a member has no stats fields). */
	let formTabs = $derived(
		FORM_TABS.filter((tab) => tab.value !== "stats").map((tab) => ({
			...tab,
			hasError: TAB_FIELDS[tab.value as MemberTab].some(
				(field) => !!validationErrors[field]
			)
		}))
	)

	/** The member's own creator notes are on show (card-less, or the card's switched off). */
	function ownNotesShown() {
		return !member.linked || draft.retold.creatorNotes === true
	}

	/** A sentence when the own notes name a language twice; sets it and stops the save. */
	function notesBlockSave(): boolean {
		if (!ownNotesShown()) return false
		const problem = noteLanguageProblem({
			creatorNotes: noteText,
			creatorNotesLang: noteLang,
			creatorNotesVariants: noteRows
		})
		if (!problem) return false
		validationErrors.creatorNotesLanguages = problem
		return true
	}

	$effect(() => {
		if (draftFor === member.id) return
		draftFor = member.id
		aliasDraft = ""
		changeLater = false
		seed()
	})

	/**
	 * A card-less member has no card's voice to read through, so their form is
	 * always the voice fields. An empty voice writes null, so this is clean.
	 */
	$effect(() => {
		if (draftFor !== member.id || member.linked || draft.timbre) return
		draft.timbre = emptyOwnTimbre()
		pristine.timbre = emptyOwnTimbre()
	})

	let dirty = $derived(
		draftFor === member.id &&
			!sameMemberDraft(draft, pristine, member.linked)
	)

	/**
	 * The draft follows the moment (and the line, and every amendment that
	 * lands) while it is clean (#106). Edits in flight are never discarded to
	 * follow a reading; their save is still a diff against `pristine`.
	 */
	$effect(() => {
		if (draftFor !== member.id || saving) return
		if (
			draftFollowsRow({
				draft: $state.snapshot(draft) as MemberDraft,
				pristine: $state.snapshot(pristine) as MemberDraft,
				row,
				linked: member.linked
			})
		)
			seed()
	})

	$effect(() => {
		hasUnsavedChanges = dirty
	})

	// A form that goes away takes its draft with it: never leave the bound
	// flag claiming changes nothing holds any more, or every later move in
	// the lorebook asks about them.
	onDestroy(() => {
		hasUnsavedChanges = false
	})

	/**
	 * Send the form one way or the other, and once it has landed make what
	 * was sent the new "as built" — so typing done while waiting stays dirty,
	 * and a save the row does not reflect (an amendment still wins) lets the
	 * clean form re-read the row.
	 */
	async function submit(
		write: (
			patch: Record<string, unknown>,
			pristine: Record<string, unknown>,
			options: SaveOptions
		) => Promise<boolean>
	) {
		if (saving) return
		const forId = member.id
		const linked = member.linked
		const sent = $state.snapshot(draft) as MemberDraft
		const options = { changeLaterVersions: changeLater }
		saving = true
		let ok = false
		try {
			ok = await write(
				memberPatch(sent, linked),
				memberPatch($state.snapshot(pristine) as MemberDraft, linked),
				options
			)
		} finally {
			saving = false
			if (draftFor === forId) changeLater = false
		}
		if (ok && draftFor === forId) pristine = sent
	}

	function save() {
		if (notesBlockSave()) return
		void submit(onSave)
	}

	/** Own names are not dated: an amendment never carries them. */
	function undated(patch: Record<string, unknown>) {
		const { ownName: _n, ownNickname: _k, ...rest } = patch
		return rest
	}

	/** An own name or nickname typed and not yet saved. */
	let ownNamesDirty = $derived(
		ownNameValue(draft.ownName) !== ownNameValue(pristine.ownName) ||
			ownNameValue(draft.ownNickname) !==
				ownNameValue(pristine.ownNickname)
	)

	function amend() {
		if (notesBlockSave()) return
		if (onAmend)
			void submit((patch, was, options) =>
				onAmend(undated(patch), undated(was), options)
			)
	}

	let saveMenuOpen = $state(false)

	/**
	 * The later versions the PRIMARY button leaves with their own words:
	 * Save as of while a moment is read, else Save. The menu's "change them
	 * outright" is a base save; it says its own count when that differs.
	 */
	let datedPrimary = $derived(!!onAmend && !!momentLabel)
	let primaryLater = $derived(
		(datedPrimary ? laterCounts?.amend : laterCounts?.base) ?? 0
	)
	let outrightLater = $derived(laterCounts?.base ?? 0)

	/** Read at a moment, a card change is dated from it (#115). */
	let cardDated = $derived(!!onAmend && !!momentLabel)

	let cardMenuItems = $derived([
		member.linked
			? {
					label: "Change the card everywhere",
					icon: Icons.Repeat,
					title: "They read as drawn with the new card on every line and at every moment, before this one too",
					onSelect: () => onLinkCharacter("base")
				}
			: {
					label: "Link a card everywhere",
					icon: Icons.Link,
					title: "They read as drawn with the card on every line and at every moment, before this one too",
					onSelect: () => onLinkCharacter("base")
				},
		member.linked && {
			label: "Unlink the card everywhere",
			icon: Icons.Unlink,
			destructive: true,
			title: "They read as a background character on every line and at every moment",
			onSelect: () => onUnlink("base")
		}
	])

	/**
	 * The sprite sets of the card this member RESOLVES to, at this moment.
	 *
	 * ⚠ The resolved card, not the base one: which card represents them is
	 * itself amendable, so reading as of a later year can put them on a
	 * different card with a different set of sets. `row` is already resolved;
	 * `member` is not, and using it would offer the wrong card's sets.
	 *
	 * ⚠ **A set this card does not have is kept, never cleared.** The server
	 * falls back to the card's default and records the miss on the receipt, so
	 * a card swap does not silently throw away what the author wrote. That is
	 * why the stored name is offered as its own option when it is missing.
	 */
	const socket = useTypedSocket()
	let cardSets = $state<{ name: string; isDefault: boolean }[]>([])
	/**
	 * The card whose list has actually ARRIVED.
	 *
	 * ⚠ An empty `cardSets` is two different facts — "the reply is still in
	 * flight" and "this card has no sets at all" — and the difference decides
	 * whether a stored name is missing or merely unconfirmed. Without this the
	 * zero-set card never offers the stored name below, which is the one way
	 * the picker could silently drop it.
	 */
	let loadedFor = $state<number | null>(null)

	/**
	 * ⚠ A PRIMITIVE, deliberately — the effect below must depend on the card's
	 * id and nothing else. `row` is rebuilt by `resolvedCast` on every
	 * recompute, so an effect that reads `row.characterId` directly re-runs
	 * whenever any unrelated cast state moves, clearing `cardSets` a moment
	 * after the reply filled it and firing another request. A `$derived`
	 * holding a number only notifies when the number changes.
	 */
	let cardIdForSprites = $derived(row.characterId ?? null)

	$effect(() => {
		const cardId = cardIdForSprites
		cardSets = []
		loadedFor = null
		if (cardId == null) return
		const release = declareInterest<"characters:listSprites">(
			interestKey("characters:listSprites", cardId),
			(msg) => {
				if (msg.characterId !== cardId) return
				cardSets = msg.sets.map((s) => ({
					name: s.name,
					isDefault: s.isDefault
				}))
				loadedFor = cardId
			}
		)
		socket.emit("characters:listSprites", { characterId: cardId })
		return release
	})

	/**
	 * The member's OWN sprite sets, which are its art when any holds an image
	 * (NOMENCLATURE §18); a card's are read only otherwise. A member-form
	 * reply carries `castMemberId` and no `characterId`, so it is scoped
	 * `member:<id>` (the shared `SCOPED_EVENTS`). Every sprite write
	 * answers with the whole list, so the sibling Sprites tab's edits reach
	 * this picker through the same events.
	 */
	let ownSets = $state<
		{ name: string; isDefault: boolean; drawn: boolean }[]
	>([])
	let ownLoadedFor = $state<number | null>(null)
	/** A primitive for the same reason as `cardIdForSprites`. */
	let memberIdForSprites = $derived(member.id)
	const OWN_LIST_EVENTS = [
		"characters:listSprites",
		"characters:createSpriteSet",
		"characters:updateSpriteSet",
		"characters:deleteSpriteSet",
		"characters:uploadSprite",
		"characters:addStandardSprites",
		"characters:updateSprite",
		"characters:deleteSprite",
		"characters:reorderSprites"
	] as const

	$effect(() => {
		const memberId = memberIdForSprites
		ownSets = []
		ownLoadedFor = null
		const onList = (msg: {
			castMemberId?: number
			sets?: {
				name: string
				isDefault: boolean
				sprites: { media?: unknown }[]
			}[]
		}) => {
			if (msg.castMemberId !== memberId || !msg.sets) return
			ownSets = msg.sets.map((s) => ({
				name: s.name,
				isDefault: s.isDefault,
				drawn: s.sprites.some((sp) => sp.media)
			}))
			ownLoadedFor = memberId
		}
		const releases = OWN_LIST_EVENTS.map((event) =>
			declareInterest<any>(
				interestKey(event, `member:${memberId}`),
				onList
			)
		)
		socket.emit("characters:listSprites", { castMemberId: memberId })
		return () => {
			for (const release of releases) release()
		}
	})

	/** Whether the member's own sets are the art (any holds an image). */
	let ownDrawn = $derived(ownSets.some((s) => s.drawn))
	/** The picker reads the member's own sets: they hold an image, or there is no card. */
	let ownSetsShown = $derived(ownDrawn || cardIdForSprites == null)
	/** The sets the picker offers: the member's own, else its card's. */
	let spriteSets = $derived(ownSetsShown ? ownSets : cardSets)

	/**
	 * The chosen set, when no set of the resolved card carries that name.
	 *
	 * ⚠ Computed WITHOUT waiting for the list, because it is what keeps the
	 * stored name as a row of the picker, labelled as missing rather than
	 * showing bare, and choosable again after picking something else —
	 * clearing what the author wrote is the one thing this control must never
	 * do.
	 */
	let missingSet = $derived(
		draft.spriteSet &&
			!spriteSets.some(
				(s) =>
					normalizeSpriteName(s.name) ===
					normalizeSpriteName(draft.spriteSet)
			)
			? draft.spriteSet
			: null
	)

	/**
	 * Whether to SAY it is missing — only once the card's list has arrived.
	 *
	 * The option above must exist immediately; the warning must not, or every
	 * card swap flashes "not on this card" for the length of a round trip.
	 */
	let missingConfirmed = $derived(
		missingSet != null &&
			ownLoadedFor === memberIdForSprites &&
			(cardIdForSprites == null || loadedFor === cardIdForSprites)
	)

	/**
	 * Names folded in from members merged into this one (`absorbedAliases`):
	 * the member answers to them, but they are the merge's to keep, not the
	 * alias list's to edit.
	 */
	let absorbedNames = $derived(
		member.aliases.filter((a) => !draft.aliases.includes(a))
	)

	// ── From the card: the member's own words (retold fields) ──────────────
	//
	// A card is a starter. Each prose field may be RETOLD here — the member's
	// text is read instead of the card's. Switching back to the card keeps
	// the member's text (hidden, never discarded). Everything goes through
	// the draft, so a retold change saves — or files as a dated change — with
	// the rest of the form.

	let retold = $derived(member.linked && card ? retoldRows(draft, card) : [])

	/** A card-less member's five fields are plain: no card to read or retell. */
	let ownWords = $derived(!member.linked)

	// ── Post-history instructions, creator notes, likeness ─────────────────
	//
	// The card is a seed, not the sole carrier: a carded member reads the
	// card's until the book gives them their own (*Use from card* off); a
	// card-less member has only their own. Their own is kept while the card's
	// is read — hidden, never discarded.

	/** The card's values for the three, as the wire sends the card's whole row. */
	let cardExtras = $derived(
		card as
			| (NonNullable<typeof card> & {
					postHistoryInstructions?: string | null
					creatorNotes?: string | null
					extensions?: unknown
			  })
			| null
	)

	type OwnedField = "postHistoryInstructions" | "creatorNotes" | "likeness"
	type MemberTab = "profile" | "voice" | "notes" | "likeness" | "speech"

	const ownedId = (field: OwnedField) => `castOwned-${field}-${member.id}`

	/** The card's value reads through (a carded member, *Use from card* on). */
	const usesCard = (field: OwnedField) =>
		member.linked && draft.retold[field] !== true

	function emptyLikeness() {
		return { prompt: "", negative: "" }
	}

	/** The card's current value for a field, as the draft holds it. */
	function cardOwned(field: OwnedField): MemberDraft[OwnedField] {
		if (field === "postHistoryInstructions")
			return cardExtras?.postHistoryInstructions ?? ""
		if (field === "creatorNotes") return { text: cardExtras?.creatorNotes ?? "", variants: {} }
		const l = likenessOfExtensions(cardExtras?.extensions)
		return {
			...(l.imageMediaId !== undefined ? { imageMediaId: l.imageMediaId } : {}),
			prompt: l.prompt ?? "",
			negative: l.negative ?? ""
		}
	}

	function ownedEmpty(field: OwnedField, d: MemberDraft): boolean {
		if (field === "postHistoryInstructions")
			return !d.postHistoryInstructions.trim()
		if (field === "creatorNotes")
			return (
				!notesText(d).trim() &&
				!Object.keys(d.creatorNotes?.variants ?? {}).length
			)
		return (
			d.likeness.imageMediaId === undefined &&
			!d.likeness.prompt.trim() &&
			!d.likeness.negative.trim()
		)
	}

	function setOwned<F extends OwnedField>(field: F, value: MemberDraft[F]) {
		draft[field] = value
	}

	/**
	 * Switch one of the three between the card's and the member's own. Off
	 * starts from the member's kept value, or the card's current one when they
	 * have none; on keeps the member's value, except an untouched copy of the
	 * card's, which gives back what was saved (so on-and-off leaves the form clean).
	 */
	function useFromCard(field: OwnedField, fromCard: boolean) {
		draft.retold = { ...draft.retold, [field]: !fromCard }
		if (!fromCard) {
			if (ownedEmpty(field, draft)) setOwned(field, cardOwned(field))
			return
		}
		if (
			ownedEmpty(field, pristine) &&
			JSON.stringify(draft[field]) === JSON.stringify(cardOwned(field))
		)
			setOwned(field, $state.snapshot(pristine[field]))
	}

	type ProseTextField = Exclude<
		RetoldProseField,
		"firstMessage" | "alternateGreetings"
	>

	/** One retold row by field (absent for a background member). */
	const rowOf = (field: RetoldRowField) =>
		retold.find((r) => r.field === field)

	function snapshot(): MemberDraft {
		return $state.snapshot(draft) as MemberDraft
	}

	function toggleRetold(field: RetoldRowField, on: boolean) {
		draft = setRetold(
			snapshot(),
			field,
			on,
			card,
			$state.snapshot(pristine) as MemberDraft
		)
	}

	function takeCardValue(field: RetoldRowField) {
		draft = takeFromCard(snapshot(), field, card)
	}

	function setText(field: ProseTextField, value: string) {
		draft[field] = value
	}

	/**
	 * One greeting list: the first is the opener, the rest the alternates.
	 * `blankAdded` is an added greeting nobody has typed in yet, which the
	 * draft cannot hold while the list is empty (an empty list and a list of
	 * one empty greeting write the same thing).
	 */
	let blankAdded = $state(false)
	let greetingList = $derived.by(() => {
		const list = greetingListOf(draft)
		return list.every((g) => g.groupOnly) && blankAdded
			? [{ text: "" }, ...list]
			: list
	})

	function setGreetingList(list: CharacterGreeting[]) {
		blankAdded = false
		const next = withGreetingList(snapshot(), list)
		draft.firstMessage = next.firstMessage
		draft.alternateGreetings = next.alternateGreetings
		draft.groupOnlyGreetings = next.groupOnlyGreetings
	}

	function setGreeting(index: number, value: string) {
		setGreetingList(
			greetingList.map((g, i) =>
				i === index ? { ...g, text: value } : g
			)
		)
	}

	/** Absent, not false, when unmarked: marking and unmarking stays clean. */
	function markGreeting(index: number, groupOnly: boolean) {
		setGreetingList(
			greetingList.map((g, i) =>
				i === index
					? groupOnly
						? { text: g.text, groupOnly: true }
						: { text: g.text }
					: g
			)
		)
	}

	function addGreeting() {
		if (greetingsOf(draft).length === 0) blankAdded = true
		else setGreetingList([...greetingList, { text: "" }])
	}

	function removeGreeting(index: number) {
		setGreetingList(greetingList.filter((_, i) => i !== index))
	}

	// ── The member's face ──────────────────────────────────────────────────
	//
	// Drawn while `retold.face` and a `faceMediaId` say so — a picture from
	// the card's gallery or one uploaded to this lorebook — else the card's
	// own avatar. ⚠ A face, not a portrait (the picture pipeline) and not an
	// avatar (the card's own picture).

	let faceSrc = $derived(memberFaceSrc(draft))
	let facePickerOpen = $state(false)
	let gallery = $state<number[]>([])
	/** The card whose gallery has ARRIVED (an empty list is also an answer). */
	let galleryFor = $state<number | null>(null)
	let faceUploading = $state(false)
	let faceError = $state<string | null>(null)
	/** This book's pictures (uploads), newest first; null until listed. */
	let bookPictures = $state<number[] | null>(null)
	let bookPicturesFor = $state<number | null>(null)

	$effect(() => {
		if (!facePickerOpen) return
		const bookId = lorebookId
		const release = declareInterest<"lorebooks:listMemberFaces">(
			"lorebooks:listMemberFaces",
			(msg) => {
				if (msg.lorebookId !== bookId) return
				bookPictures = msg.mediaIds
				bookPicturesFor = bookId
			}
		)
		socket.emit("lorebooks:listMemberFaces", { lorebookId: bookId })
		return release
	})

	$effect(() => {
		if (!facePickerOpen) return
		const cardId = cardIdForSprites
		if (cardId == null) return
		const release = declareInterest<"characters:listGallery">(
			interestKey("characters:listGallery", cardId),
			(msg) => {
				if (msg.characterId !== cardId) return
				gallery = msg.images.map((m) => m.id)
				galleryFor = cardId
			}
		)
		socket.emit("characters:listGallery", { characterId: cardId })
		return release
	})

	function pickFace(mediaId: number) {
		const next = snapshot()
		draft = {
			...next,
			faceMediaId: mediaId,
			retold: { ...next.retold, face: true }
		}
		facePickerOpen = false
	}

	function useCardPicture() {
		// The face is kept — switching back is one click away.
		draft = setRetold(snapshot(), "face", false, card)
		facePickerOpen = false
	}

	/**
	 * Upload a picture to this lorebook and pick it, like a gallery picture:
	 * the server only STORES it, and the draft takes it as the face, so Save
	 * (or Save as of a date) writes it like every other field (review
	 * 2026-10-13). It joins **This book's pictures** at the front.
	 */
	async function uploadFace(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		input.value = ""
		if (!file) return
		if (!file.type.startsWith("image/")) {
			faceError = "Choose an image file."
			return
		}
		const castId = member.id
		faceUploading = true
		faceError = null
		try {
			const buffer = await file.arrayBuffer()
			const reply = await awaitReply({
				socket,
				event: "lorebooks:uploadMemberFace",
				params: {
					castId,
					imageFile: new Uint8Array(buffer),
					mimeType: file.type
				},
				errorEvent: "lorebooks:uploadMemberFace:error",
				fallbackError: "The picture could not be uploaded.",
				match: (data) => data?.castId === castId
			})
			const mediaId = reply?.mediaId
			if (typeof mediaId !== "number") return
			bookPictures = [
				mediaId,
				...(bookPictures ?? []).filter((id) => id !== mediaId)
			]
			// The member may have changed while the picture travelled.
			if (draftFor === castId) pickFace(mediaId)
		} catch (err) {
			faceError =
				err instanceof Error && err.message
					? err.message
					: "The picture could not be uploaded."
		} finally {
			faceUploading = false
		}
	}

	function addAlias() {
		const value = aliasDraft.trim()
		aliasDraft = ""
		if (!value || draft.aliases.includes(value)) return
		draft.aliases = [...draft.aliases, value]
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-start gap-3">
		<!-- The member's face on the avatar scale (STYLE-GUIDE §6.4): lg,
		     square — an identity — ringed in the state's colour. A member
		     with no card gets their kind's glyph, or a background member's
		     initial. -->
		<div
			class="ring-offset-surface-50-950 shrink-0 rounded-full ring-2 ring-offset-2 {stateBadge(
				member.state
			).ring}"
		>
			<Avatar
				char={card as any}
				src={faceSrc}
				name={member.name}
				size="lg"
				kind={member.kind === "persona" ? "persona" : "character"}
				fallback={member.kind === "background" ? "initial" : "glyph"}
				decorative
			/>
		</div>
		<div class="min-w-0 flex-1">
			<h4 class="truncate text-sm font-semibold">{member.name}</h4>
			<p class="text-tertiary-600-400 truncate font-mono text-xs">
				{member.tag}
			</p>
			<div class="mt-1 flex flex-wrap items-center gap-1">
				<span class="badge preset-tonal-surface text-meta capitalize">
					{member.kind}
				</span>
				{#if member.state !== "active"}
					<span
						class="badge {stateBadge(member.state).color} text-meta"
					>
						{member.state}
					</span>
				{/if}
				{#if member.visibility !== "normal"}
					<span
						class="badge {visibilityBadge(
							member.visibility
						)} text-meta"
					>
						{member.visibility}
					</span>
				{/if}
			</div>
		</div>
		<button
			class="btn btn-sm preset-tonal-error shrink-0 p-1.5"
			type="button"
			onclick={onDelete}
			title="Delete cast member"
			aria-label="Delete cast member"
		>
			<Icons.Trash2 size={14} aria-hidden="true" />
		</button>
	</div>

	{#if !member.linked}
		<div class="flex flex-col gap-1">
			<label class="text-sm font-semibold" for="castName-{member.id}">
				Name
			</label>
			<input
				id="castName-{member.id}"
				class="input text-sm"
				type="text"
				bind:value={draft.name}
			/>
		</div>
	{:else}
		<div class="flex flex-col gap-2" data-testid="cast-own-identity">
			<div class="flex flex-col gap-1">
				<label
					class="text-sm font-semibold"
					for="castOwnName-{member.id}"
				>
					Name
				</label>
				<UseFromCardSwitch
					name="castOwnName-{member.id}-fromCard"
					label="Name"
					checked={draft.ownName === null}
					onCheckedChange={(on) =>
						(draft.ownName = on ? null : (card?.name ?? ""))}
				/>
				{#if draft.ownName === null}
					<input
						id="castOwnName-{member.id}"
						class="input text-sm opacity-60"
						type="text"
						disabled
						value={card?.name ?? ""}
					/>
				{:else}
					<input
						id="castOwnName-{member.id}"
						class="input text-sm"
						type="text"
						bind:value={draft.ownName}
					/>
				{/if}
			</div>
			<div class="flex flex-col gap-1">
				<label
					class="text-sm font-semibold"
					for="castOwnNickname-{member.id}"
				>
					Nickname
				</label>
				<UseFromCardSwitch
					name="castOwnNickname-{member.id}-fromCard"
					label="Nickname"
					checked={draft.ownNickname === null}
					onCheckedChange={(on) =>
						(draft.ownNickname = on
							? null
							: (card?.nickname ?? ""))}
				/>
				{#if draft.ownNickname === null}
					<input
						id="castOwnNickname-{member.id}"
						class="input text-sm opacity-60"
						type="text"
						disabled
						placeholder={card?.nickname ? "" : "The card has none."}
						value={card?.nickname ?? ""}
					/>
				{:else}
					<input
						id="castOwnNickname-{member.id}"
						class="input text-sm"
						type="text"
						placeholder="No nickname in this book"
						bind:value={draft.ownNickname}
					/>
				{/if}
			</div>
			{#if card}
				<div class="flex flex-col items-start gap-1">
					<p class="text-sm font-semibold">Face</p>
					<!-- The member's face: a picture from the card's gallery or one
						     uploaded to this lorebook. A popover, not a dialog: it picks
						     into the draft, and Save writes it like everything else. -->
					<Popover
						open={facePickerOpen}
						onOpenChange={(e) => {
							facePickerOpen = e.open
							if (e.open) faceError = null
						}}
						positioning={{ placement: "bottom-start" }}
					>
						<Popover.Trigger
							class="btn btn-sm preset-tonal-surface"
							title="Draw this member with a picture of their own"
							data-cast-change-face
						>
							<Icons.ImageUp size={14} aria-hidden="true" />
							Change face
						</Popover.Trigger>
						<Portal>
							<Popover.Positioner class="z-[1000]!">
								<Popover.Content
									class="card bg-surface-50-950 border-surface-200-800 flex w-[min(90vw,360px)] flex-col gap-3 border p-4 shadow-xl"
								>
									<div class="flex flex-col gap-1">
										<p class="text-sm font-semibold">
											Card gallery
										</p>
										{#if galleryFor !== cardIdForSprites}
											<p
												class="text-surface-600-400 text-xs"
											>
												Loading the card's gallery…
											</p>
										{:else if gallery.length === 0}
											<p
												class="text-surface-600-400 text-xs"
											>
												The card's gallery is empty.
											</p>
										{:else}
											<div
												class="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto"
											>
												{#each gallery as mediaId (mediaId)}
													{@const current =
														draft.retold.face ===
															true &&
														draft.faceMediaId ===
															mediaId}
													<button
														type="button"
														class="aspect-square overflow-hidden rounded-md ring-2 {current
															? 'ring-primary-500'
															: 'hover:ring-surface-400-600 ring-transparent'}"
														aria-pressed={current}
														title="Use this picture as their face"
														aria-label="Use gallery picture {mediaId} as their face"
														onclick={() =>
															pickFace(mediaId)}
													>
														<img
															src={mediaThumbUrl(
																mediaId
															)}
															alt=""
															class="h-full w-full object-cover"
															loading="lazy"
														/>
													</button>
												{/each}
											</div>
										{/if}
									</div>
									<hr class="border-surface-200-800" />
									<div class="flex flex-col gap-1">
										<p class="text-sm font-semibold">
											This book's pictures
										</p>
										{#if bookPicturesFor !== lorebookId}
											<p
												class="text-surface-600-400 text-xs"
											>
												Loading this book's pictures…
											</p>
										{:else if !bookPictures?.length}
											<p
												class="text-surface-600-400 text-xs"
											>
												None yet. Upload one below.
											</p>
										{:else}
											<div
												class="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto"
												data-cast-book-pictures
											>
												{#each bookPictures as mediaId (mediaId)}
													{@const current =
														draft.retold.face ===
															true &&
														draft.faceMediaId ===
															mediaId}
													<button
														type="button"
														class="aspect-square overflow-hidden rounded-md ring-2 {current
															? 'ring-primary-500'
															: 'hover:ring-surface-400-600 ring-transparent'}"
														aria-pressed={current}
														title="Use this picture as their face"
														aria-label="Use book picture {mediaId} as their face"
														onclick={() =>
															pickFace(mediaId)}
													>
														<img
															src={mediaThumbUrl(
																mediaId
															)}
															alt=""
															class="h-full w-full object-cover"
															loading="lazy"
														/>
													</button>
												{/each}
											</div>
										{/if}
										<label
											class="btn btn-sm preset-tonal-surface mt-1 w-full justify-start {faceUploading
												? 'pointer-events-none opacity-60'
												: ''}"
										>
											<Icons.Upload
												size={14}
												aria-hidden="true"
											/>
											{faceUploading
												? "Uploading…"
												: "Upload a picture"}
											<input
												class="sr-only"
												type="file"
												accept="image/*"
												disabled={faceUploading}
												onchange={uploadFace}
											/>
										</label>
										<p class="text-surface-700-300 text-xs">
											Kept with this lorebook, not added
											to the card, and picked as their
											face. Save to keep it, or Save as of
											a date to date it.
										</p>
										{#if faceError}
											<p
												class="text-error-600-400 text-xs"
												role="alert"
											>
												{faceError}
											</p>
										{/if}
									</div>
									<hr class="border-surface-200-800" />
									<button
										class="btn btn-sm preset-tonal-surface w-full justify-start"
										type="button"
										disabled={draft.retold.face !== true}
										onclick={useCardPicture}
										title="Draw them with the card's own picture again; their face is kept"
									>
										<Icons.Undo2
											size={14}
											aria-hidden="true"
										/>
										Use the card's picture
									</button>
								</Popover.Content>
							</Popover.Positioner>
						</Portal>
					</Popover>
				</div>
			{/if}
			<p class="text-surface-600-400 text-xs">
				Shown in this book only; the card keeps its own.
			</p>
		</div>
	{/if}

	{#snippet fromCardIntro()}
		<!-- From the card (retold fields): the card is a starter; each field
		     may be told in this member's own words for this story. Use from
		     card off, the member's own text is read; on, the card's reads
		     through, shown dimmed, and the member's own is kept, set aside. -->
		<div class="panel-inset flex flex-col gap-1" data-cast-retold>
			<p class="text-sm font-semibold">From the card</p>
			<p class="text-surface-700-300 text-xs leading-relaxed">
				The card is a starter. Switch <strong>Use from card</strong>
				off on a field to tell it in this member's own words for this story;
				the card itself is not changed. Switching it back on keeps what you
				wrote here, set aside, until you switch it off again.
			</p>
		</div>
	{/snippet}

	{#snippet retoldControls(r: RetoldRow)}
		{@const fieldId = `castRetold-${r.field}-${member.id}`}
		<div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
			<UseFromCardSwitch
				name="{fieldId}-retold"
				label={r.label}
				checked={!r.retold}
				onCheckedChange={(on) => toggleRetold(r.field, !on)}
			/>
			{#if r.retold}
				<button
					class="btn btn-sm preset-tonal-surface"
					type="button"
					disabled={!r.cardHasText}
					title="Copy the card's current {r.label.toLowerCase()} into this member's"
					onclick={() => takeCardValue(r.field)}
				>
					<Icons.Copy size={14} aria-hidden="true" />
					Take from card
				</button>
			{/if}
		</div>
	{/snippet}

	{#snippet keptLine(r: RetoldRow)}
		{#if r.kept}
			<p class="text-surface-700-300 text-xs">
				Their own {r.label.toLowerCase()} is kept, set aside. Switch off
				Use from card to read it again.
			</p>
		{/if}
	{/snippet}

	{#snippet textRow(
		field: ProseTextField,
		hint: string,
		placeholder: string,
		mono: boolean = false
	)}
		{@const r = rowOf(field)}
		{#if r}
			<div class="flex flex-col" data-retold-field={field}>
				<ProseField
					id="castRetold-{field}-{member.id}"
					label={r.label}
					{hint}
					rows={8}
					class={mono ? "font-mono" : ""}
					value={r.retold ? draft[field] : (r.cardValue as string)}
					disabled={!r.retold}
					placeholder={r.retold ? placeholder : "The card has none."}
					oninput={(v) => setText(field, v)}
				>
					{#snippet follow()}
						{@render retoldControls(r)}
					{/snippet}
				</ProseField>
				{@render keptLine(r)}
			</div>
		{/if}
		{#if ownWords}
			<div class="flex flex-col" data-own-field={field}>
				<ProseField
					id="castOwn-{field}-{member.id}"
					label={RETOLD_LABELS[field]}
					{hint}
					rows={8}
					class={mono ? "font-mono" : ""}
					value={draft[field]}
					{placeholder}
					oninput={(v) => setText(field, v)}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet greetingsRow()}
		{@const r = rowOf("greetings")}
		{#if r}
			{@const fieldId = `castRetold-greetings-${member.id}`}
			<div class="flex flex-col" data-retold-field="greetings">
				<label
					class="text-surface-600-400 mb-1.5 text-xs"
					for={fieldId}
				>
					{r.label}
				</label>
				{@render retoldControls(r)}
				{#if r.retold}
					<GreetingsList
						id={fieldId}
						greetings={greetingList}
						onText={setGreeting}
						onGroupOnly={markGreeting}
						onRemove={removeGreeting}
						onAdd={addGreeting}
					/>
				{:else if r.cardHasText}
					<ul
						class="flex flex-col gap-2 opacity-60"
						id={fieldId}
						aria-label="The card's greetings"
					>
						{#each r.cardValue as string[] as greeting, i (i)}
							<li
								class="textarea min-h-12 text-sm whitespace-pre-wrap"
							>
								{greeting}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-surface-600-400 text-xs" id={fieldId}>
						The card has none.
					</p>
				{/if}
				{@render keptLine(r)}
			</div>
		{/if}
		{#if ownWords}
			{@const ownId = `castOwn-greetings-${member.id}`}
			<div class="flex flex-col" data-own-field="greetings">
				<label class="text-surface-600-400 mb-1.5 text-xs" for={ownId}>
					{GREETINGS_LABEL}
				</label>
				<GreetingsList
					id={ownId}
					greetings={greetingList}
					onText={setGreeting}
					onGroupOnly={markGreeting}
					onRemove={removeGreeting}
					onAdd={addGreeting}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet postHistorySwitch()}
		{#if member.linked}
			<div class="mb-1.5">
				<UseFromCardSwitch
					name="{ownedId('postHistoryInstructions')}-fromCard"
					label="Post-history instructions"
					checked={usesCard("postHistoryInstructions")}
					onCheckedChange={(on) =>
						useFromCard("postHistoryInstructions", on)}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet creatorNotesSwitch()}
		{#if member.linked}
			<div class="mb-1.5">
				<UseFromCardSwitch
					name="{ownedId('creatorNotes')}-fromCard"
					label="Creator notes"
					checked={usesCard("creatorNotes")}
					onCheckedChange={(on) => {
						useFromCard("creatorNotes", on)
						seedNotes()
					}}
				/>
			</div>
		{/if}
	{/snippet}

	<PanelTabStrip
		bind:value={activeFormTab}
		tabs={formTabs}
		ariaLabel="Character fields"
		panelIdPrefix="cast-member-form"
	/>

	<div
		id="cast-member-form-profile"
		role="tabpanel"
		aria-labelledby="cast-member-form-profile-tab"
		hidden={activeFormTab !== "profile"}
		class="space-y-3"
	>
		{#if retold.length > 0}
			{@render fromCardIntro()}
		{/if}
		<section class="panel-inset flex flex-col gap-3">
			<h5 class="text-sm font-medium">About</h5>
			<div class="flex flex-col">
				<label
					class="text-surface-600-400 mb-1.5 text-xs"
					for="castSummary-{member.id}"
				>
					Summary
				</label>
				<textarea
					id="castSummary-{member.id}"
					class="{FIELD_CLASS} min-h-16"
					maxlength="200"
					placeholder="A short line on who this is right now…"
					bind:value={draft.summary}
				></textarea>
				<p class="text-surface-700-300 mt-1 text-xs">
					Reaches the model only while Visibility is legendary, where
					it is attached to the historical-figures layer of the
					relationship context. At normal visibility it is a note to
					yourself.
				</p>
				<p class="text-surface-600-400 text-right text-xs">
					{draft.summary.length} / 200
				</p>
			</div>
			{@render textRow(
				"description",
				"This field will be visible in prompts",
				"Description..."
			)}
			<div class="flex flex-col gap-1">
				<p class="text-surface-600-400 mb-1.5 text-xs">Also known as</p>
				<div class="flex flex-wrap items-center gap-1">
					{#each draft.aliases as alias (alias)}
						<span class="chip preset-tonal-surface gap-1">
							{alias}
							<button
								type="button"
								class="opacity-70 hover:opacity-100"
								title="Remove {alias}"
								aria-label="Remove {alias}"
								onclick={() =>
									(draft.aliases = draft.aliases.filter(
										(a) => a !== alias
									))}
							>
								<Icons.X size={11} aria-hidden="true" />
							</button>
						</span>
					{/each}
					<label class="sr-only" for="castAlias-{member.id}">
						Add another name
					</label>
					<input
						id="castAlias-{member.id}"
						class="{FIELD_CLASS} input-sm w-28 text-xs"
						type="text"
						placeholder="Add…"
						bind:value={aliasDraft}
						onblur={addAlias}
						onkeydown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault()
								addAlias()
							}
							if (e.key === "Escape") aliasDraft = ""
						}}
					/>
				</div>
				<p class="text-surface-700-300 text-xs">
					Other names this member is known by, so scene summarization
					recognises them under a nickname or a title instead of
					adding a second row for the same person.{member.linked
						? " They are the member's own: the card's names are added to them, and changing or unlinking the card keeps them."
						: ""}
				</p>
				{#if absorbedNames.length > 0}
					<p class="text-surface-700-300 text-xs">
						Also answers to {absorbedNames.join(", ")}: names kept
						from before a card was linked, or from members merged
						into this one.
					</p>
				{/if}
			</div>
		</section>

		<section class="panel-inset flex flex-col gap-3">
			<h5 class="text-sm font-medium">Status in world</h5>
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<Select
						label="State"
						class="text-surface-600-400 [&_input]:text-surface-950-50 min-w-0 text-xs [&_input]:text-sm"
						options={CAST_STATES.map((s) => ({
							value: s,
							label: s
						}))}
						value={draft.nodeState}
						onValueChange={(v) => {
							if (v) draft.nodeState = v
						}}
					/>
				</div>
				<div class="flex flex-col gap-1">
					<Select
						label="Visibility"
						class="text-surface-600-400 [&_input]:text-surface-950-50 min-w-0 text-xs [&_input]:text-sm"
						options={CAST_VISIBILITIES.map((v) => ({
							value: v,
							label: v
						}))}
						value={draft.nodeVisibility}
						onValueChange={(v) => {
							if (v) draft.nodeVisibility = v
						}}
					/>
				</div>
			</div>
			<p class="text-surface-700-300 text-xs">
				State is your own tracking of who is still around. Normal
				visibility surfaces by relevance, legendary always appears as a
				historical figure, and hidden is kept out of other members'
				relationship context.
			</p>
		</section>

		<!-- ⚠ Which card represents them is amendable like any other field
		     (#115): read at a moment, Change and Unlink are DATED from it, and the
		     outright rewrite is in the menu, never the primary (STYLE-GUIDE §6.1). -->
		<div class="panel-inset flex flex-col gap-2" data-cast-card>
			<div class="flex flex-wrap items-center gap-2">
				{#if member.linked}
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<p class="text-sm font-semibold">Character card</p>
						<p class="text-surface-600-400 truncate text-xs">
							{member.name}, {member.kind === "persona"
								? "your persona"
								: "character"}
						</p>
					</div>
					{#if onEditCard}
						<button
							class="btn btn-sm preset-tonal-surface"
							type="button"
							title="Open this card in Characters"
							onclick={onEditCard}
							data-cast-edit-card
						>
							<Icons.Pencil size={14} aria-hidden="true" /> Edit the
							card
						</button>
					{/if}
					<button
						class="btn btn-sm preset-tonal-surface"
						type="button"
						disabled={saving}
						title={cardDated
							? `Draw this member with a different card from ${momentLabel}`
							: "Point this member at a different card"}
						onclick={() =>
							onLinkCharacter(cardDated ? "amend" : "base")}
					>
						<Icons.Repeat size={14} aria-hidden="true" /> Change
					</button>
					<button
						class="btn btn-sm preset-tonal-warning"
						type="button"
						disabled={saving}
						onclick={() => onUnlink(cardDated ? "amend" : "base")}
						title={cardDated
							? `Detach the card from ${momentLabel}; before then they keep it`
							: "Detach the card and keep this member as a background character"}
					>
						<Icons.Unlink size={14} aria-hidden="true" /> Unlink card
					</button>
				{:else}
					<!-- One picker: a persona IS a character, so "link a persona" and
						"link a character" were always the same act. -->
					<p class="min-w-0 flex-1 text-sm font-semibold">
						Character card
					</p>
					<button
						class="btn btn-sm preset-tonal-surface"
						type="button"
						disabled={saving}
						title={cardDated
							? `Draw this member with a card from ${momentLabel}`
							: "Draw this member with a character card"}
						onclick={() =>
							onLinkCharacter(cardDated ? "amend" : "base")}
					>
						<Icons.Link size={14} aria-hidden="true" /> Link character
					</button>
				{/if}
				{#if cardDated}
					<RowMenu
						label="Card"
						triggerLabel="Other ways to change the card"
						triggerTitle="Other ways to change the card"
						width={300}
						items={cardMenuItems}
					/>
				{/if}
			</div>
			{#if canUpdateCard && member.linked && row.behindCard && row.cardVersion && row.cardCurrentVersion}
				<CardUpdateOffer
					castId={member.id}
					{lorebookId}
					memberName={member.name}
					cardVersion={row.cardVersion}
					cardCurrentVersion={row.cardCurrentVersion}
				/>
			{/if}
			{#if cardDated}
				<p class="text-surface-700-300 text-xs" data-cast-card-dated>
					{member.linked ? "Change and Unlink" : "Linking"} here
					{member.linked ? "are" : "is"} dated {momentLabel}: before
					then they read as they do now. The menu changes the card
					everywhere.
				</p>
			{/if}
		</div>
	</div>

	<div
		id="cast-member-form-voice"
		role="tabpanel"
		aria-labelledby="cast-member-form-voice-tab"
		hidden={activeFormTab !== "voice"}
		class="space-y-3"
	>
		{#if retold.length > 0 || ownWords}
			{#if retold.length > 0}
				{@render fromCardIntro()}
			{/if}
			<section class="panel-inset flex flex-col gap-3">
				<h5 class="text-sm font-medium">Voice</h5>
				{@render textRow(
					"personality",
					"This field will be visible in prompts",
					"Personality..."
				)}
				{@render textRow(
					"scenario",
					"This field will be visible in prompts (excluded from group sessions)",
					"Scenario..."
				)}
			</section>
			<section class="panel-inset flex flex-col gap-3">
				<h5 class="text-sm font-medium">Greetings</h5>
				{@render greetingsRow()}
			</section>
			<section class="panel-inset flex flex-col gap-3">
				<h5 class="text-sm font-medium">Examples</h5>
				{@render textRow(
					"exampleDialogues",
					"This field will be visible in prompts",
					"Example dialogue...",
					true
				)}
			</section>
		{/if}
		<section class="panel-inset flex flex-col gap-3" data-cast-post-history>
			<h5 class="text-sm font-medium">Instructions</h5>
			<div class="flex flex-col">
				{#if usesCard("postHistoryInstructions")}
					<ProseField
						id={ownedId("postHistoryInstructions")}
						label="Post-history instructions"
						hint="This field will be visible in prompts"
						rows={4}
						disabled
						placeholder="The card has none."
						value={cardExtras?.postHistoryInstructions ?? ""}
						follow={postHistorySwitch}
					/>
				{:else}
					<ProseField
						id={ownedId("postHistoryInstructions")}
						label="Post-history instructions"
						hint="This field will be visible in prompts"
						rows={4}
						bind:value={draft.postHistoryInstructions}
						placeholder="Stay in character and keep replies short…"
						title="Placed after the conversation, just before the reply; good for style reminders."
						follow={postHistorySwitch}
					/>
				{/if}
			</div>
		</section>
	</div>

	<div
		id="cast-member-form-notes"
		role="tabpanel"
		aria-labelledby="cast-member-form-notes-tab"
		hidden={activeFormTab !== "notes"}
		class="space-y-3"
	>
		<section
			class="panel-inset flex flex-col gap-3"
			data-cast-creator-notes
		>
			<h5 class="text-sm font-medium">Creator notes</h5>
			{#if usesCard("creatorNotes")}
				<CreatorNotesFields
					textId={ownedId("creatorNotes")}
					langId="castOwnedLang-creatorNotes-{member.id}"
					text={cardExtras?.creatorNotes ?? ""}
					placeholder="The card has none."
					disabled
					languages={false}
					follow={creatorNotesSwitch}
				/>
			{:else}
				<CreatorNotesFields
					textId={ownedId("creatorNotes")}
					langId="castOwnedLang-creatorNotes-{member.id}"
					bind:text={noteText}
					bind:lang={noteLang}
					bind:variants={noteRows}
					languages
					error={validationErrors.creatorNotesLanguages}
					onchange={writeNotes}
					follow={creatorNotesSwitch}
				/>
			{/if}
		</section>
	</div>

	<div
		id="cast-member-form-likeness"
		role="tabpanel"
		aria-labelledby="cast-member-form-likeness-tab"
		hidden={activeFormTab !== "likeness"}
		class="space-y-3"
	>
		<section class="panel-inset flex flex-col gap-3" data-cast-likeness>
			<h5 class="text-sm font-medium">Likeness</h5>
			{#if member.linked}
				<UseFromCardSwitch
					name="{ownedId('likeness')}-fromCard"
					label="Likeness"
					checked={usesCard("likeness")}
					onCheckedChange={(on) => useFromCard("likeness", on)}
				/>
			{/if}
			{#if usesCard("likeness")}
				<p class="text-surface-600-400 text-xs">
					Uses the card's likeness.
				</p>
			{:else}
				<LikenessTab
					owner={{ castMemberId: member.id }}
					active={activeFormTab === "likeness"}
					avatarUrl={faceSrc}
					bind:likeness={draft.likeness}
				/>
			{/if}
		</section>
		{#if (member.linked || ownSets.length > 0) && (spriteSets.length > 0 || draft.spriteSet)}
			<div class="panel-inset flex flex-col gap-1">
				<!-- ⚠ The missing set stays a row so choosing it again is possible
				     and saving does not silently drop it. The card they resolve to
				     here has no set by this name; another card may. -->
				<Select
					label="Sprite set"
					class="text-sm"
					options={[
						{
							value: "",
							label: ownSetsShown
								? "Their default set"
								: "The card's default set"
						},
						...spriteSets.map((set) => ({
							value: set.name,
							label: `${set.name}${set.isDefault ? " (default)" : ""}`
						})),
						...(missingSet
							? [
									{
										value: missingSet,
										label: `${missingSet} — ${ownSetsShown ? "not in their sets" : "not on this card"}`
									}
								]
							: [])
					]}
					bind:value={draft.spriteSet}
				/>
				{#if missingConfirmed}
					<p class="text-warning-700-300 text-xs leading-relaxed">
						{#if ownSetsShown}
							They have no set called
							<strong>{missingSet}</strong>
							, so they fall back to their default. The name is kept.
						{:else}
							The card they are drawn with here has no set called
							<strong>{missingSet}</strong>
							, so they fall back to its default. The name is kept:
							a card swap does not throw away what you wrote, and another
							card may have it.
						{/if}
					</p>
				{:else}
					<p class="text-surface-700-300 text-xs leading-relaxed">
						{#if ownSetsShown}
							Which of their own sets this member is drawn with,
							from the Sprites tab. Which one they use can be
							dated like anything else on this page.
						{:else}
							Which of the card's sets this member is drawn with.
							Sets belong to the card; which one they use is
							theirs, and can be dated like anything else on this
							page.
						{/if}
					</p>
				{/if}
			</div>
		{/if}
	</div>

	<div
		id="cast-member-form-speech"
		role="tabpanel"
		aria-labelledby="cast-member-form-speech-tab"
		hidden={activeFormTab !== "speech"}
		class="space-y-3"
	>
		<!-- The member's voice: the card's until the book gives them their own;
		     the card form's Voice fields, reused. -->
		<div class="panel-inset flex flex-col gap-2" data-cast-voice>
			{#if member.linked}
				<UseFromCardSwitch
					name="castVoice-{member.id}-fromCard"
					label="Voice"
					checked={draft.timbre === null}
					onCheckedChange={(on) =>
						(draft.timbre = on ? null : emptyOwnTimbre())}
				/>
				{#if draft.timbre === null}
					<p class="text-surface-600-400 text-xs">
						Uses the card's voice.
					</p>
				{/if}
			{/if}
			{#if draft.timbre}
				<VoiceTab
					characterName={member.name}
					castMember={{ linked: !!member.linked }}
					bind:timbre={draft.timbre}
				/>
			{/if}
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		{#if dirty && primaryLater > 0}
			<div
				class="flex min-w-0 flex-wrap items-center gap-2"
				data-later-versions
			>
				<p class="text-surface-700-300 text-xs">
					{laterVersionsLine(primaryLater)}
				</p>
				<button
					class="btn btn-sm pointer-coarse:min-h-11 {changeLater
						? 'preset-pressed'
						: 'preset-tonal-surface'}"
					type="button"
					aria-pressed={changeLater}
					disabled={saving}
					title="Write the same change onto the later versions too. A version a session wrote keeps its words."
					onclick={() => (changeLater = !changeLater)}
				>
					Change later versions too
				</button>
			</div>
		{/if}
		{#if onAmend && momentLabel}
			<!-- The same two-action save the entry editor offers, and the same
			     rule: the one that rewrites what was always true is in the
			     menu, never the primary (STYLE-GUIDE §6.1). -->
			<div class="ml-auto flex items-center">
				<button
					class="btn btn-sm preset-filled-primary-500 rounded-r-none"
					type="button"
					disabled={saving ||
						ownNamesDirty ||
						(!member.linked && !draft.name.trim()) ||
						(member.linked &&
							draft.ownName !== null &&
							!draft.ownName.trim())}
					onclick={amend}
					title={ownNamesDirty
						? "A name in this book is not dated: Save keeps it for every moment"
						: `File this change as an amendment dated ${momentLabel}`}
				>
					<Icons.Save size={14} aria-hidden="true" />
					Save as of {momentLabel}
				</button>
				<Popover
					open={saveMenuOpen}
					onOpenChange={(e) => (saveMenuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn btn-sm preset-filled-primary-500 rounded-l-none border-l border-white/25 p-2"
						title="Other ways to save this change"
						aria-label="Other ways to save this change"
					>
						<Icons.ChevronDown size={16} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-100-900 flex w-[min(90vw,320px)] flex-col gap-3 p-4 shadow-xl"
							>
								<div class="flex flex-col gap-1">
									<span class="text-sm font-semibold">
										Save as of {momentLabel}
									</span>
									<p
										class="text-surface-700-300 text-xs leading-relaxed"
									>
										They stay as they are. The change begins
										at {momentLabel} and reads from then on.
									</p>
								</div>
								<hr class="border-surface-200-800" />
								<div class="flex flex-col gap-2">
									<p
										class="text-surface-700-300 text-xs leading-relaxed"
									>
										Or change them outright: they read this
										way <strong>everywhere</strong>
										, on every line and at every moment — including
										before
										{momentLabel}, where it is who they
										always were.
									</p>
									{#if dirty && outrightLater > 0 && outrightLater !== primaryLater}
										<p
											class="text-surface-700-300 text-xs"
											data-later-versions-outright
										>
											{laterVersionsLine(outrightLater)}
										</p>
									{/if}
									<button
										class="btn btn-sm preset-tonal-warning w-full justify-start"
										type="button"
										disabled={saving ||
											(!member.linked &&
												!draft.name.trim()) ||
											(member.linked &&
												draft.ownName !== null &&
												!draft.ownName.trim())}
										onclick={() => {
											saveMenuOpen = false
											save()
										}}
									>
										<Icons.PenLine
											size={14}
											aria-hidden="true"
										/>
										Change the member
									</button>
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			</div>
		{:else}
			<button
				class="btn btn-sm preset-filled-primary-500 ml-auto"
				type="button"
				disabled={saving ||
					(!member.linked && !draft.name.trim()) ||
					(member.linked &&
						draft.ownName !== null &&
						!draft.ownName.trim())}
				onclick={save}
			>
				<Icons.Save size={14} aria-hidden="true" /> Save
			</button>
		{/if}
	</div>
</div>
