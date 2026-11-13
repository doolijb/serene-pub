<script lang="ts">
	import { withoutShared } from "$lib/shared/utils/sharedRows"
	/**
	 * Start a session: the first screen, a few answers down one column.
	 *
	 * A name, then the genre, then an admin-enabled preset of that genre, then
	 * who is in it, then — for a genre whose shape has the capability — a
	 * lorebook (ruled 2026-09-10; the name moved to the top 2026-09-27, where
	 * it is always on screen instead of waiting behind the cast). A step with
	 * one option answers itself and shows as its summary line. The genre is a
	 * radio list that stays on screen and the preset a row with Change (polish
	 * parity L11, 2026-10-24: Name, every genre and the Preset fit the dock
	 * without scrolling); the cast collapses to its line with Change once
	 * answered. Everything else a session has is edited afterwards in the
	 * edit form.
	 *
	 * The form owns its own reply: it declares a one-shot interest in
	 * `sessions:create` / `sessions:create:error` with the request, releases
	 * both when one arrives, and hands the new id to `onCreated`, which is
	 * where navigation lives.
	 */
	import { getContext, onDestroy, tick, untrack } from "svelte"
	import { v4 as uuid } from "uuid"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { appletLauncher } from "$lib/client/sessions/appletRows"
	import type { SessionCreationMode } from "@serene-pub/sdk"
	import CreationModePicker from "./CreationModePicker.svelte"
	import {
		declareInterest,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import { notify } from "$lib/client/utils/notify"
	import { refusedSwapsSentence } from "./refusedSwaps"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import {
		asksHowStrict,
		howStrictChoices
	} from "$lib/shared/rulesets/rulesOffer"
	import CharacterPickRow from "./CharacterPickRow.svelte"
	import CharacterSelectModal, {
		castPickMembers,
		type PickMember
	} from "../modals/CharacterSelectModal.svelte"
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import NewLorebookDialog from "../lorebookForms/NewLorebookDialog.svelte"
	import StarterKitPicker from "../lorebookForms/StarterKitPicker.svelte"
	import SessionLorebookReading from "./SessionLorebookReading.svelte"
	import type { StoryClock } from "$lib/shared/lorebooks/storyDate"
	import {
		isStarterKit,
		KIT_SESSION_NOTE,
		providedRowLine,
		refOfCard
	} from "$lib/client/lorebooks/starterKitCards"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import RulesFitAuditDialog from "./RulesFitAuditDialog.svelte"
	import StartAskField from "./StartAskField.svelte"
	import AdvancedHiddenLine from "$lib/client/components/AdvancedHiddenLine.svelte"
	import { showsAdvancedControls } from "$lib/client/advancedControls"
	import type { RulesChoice } from "$lib/shared/rulesets/rulesOffer"
	import {
		autoSessionName,
		bookRulesFit,
		castCountHint,
		castOptions,
		defaultGenreId,
		draftSessionName,
		finalSessionName,
		genreFacts,
		playAsOptions,
		preselectsDefaultPersona,
		StartSessionFlow
	} from "./createSession.svelte"

	type FollowRow = Sockets.Sessions.List.Response["sessionList"][number]

	interface Props {
		/** What the caller already knows: a character to start with, a persona
		 *  to speak as, a genre or preset to open on. */
		prefill?: {
			characterId?: number
			personaId?: number
			genreId?: string
			presetId?: number
			mode?: SessionCreationMode
			from?: number
			/** 🚧 M2c: an applet's `create-session` — its genre's declared field values and a proposed lorebook. */
			fields?: Record<string, unknown>
			lorebookId?: number
			/** 🚧 M2c: the asking applet's plugin id; the form then collapses to a one-press confirm. */
			fromApplet?: string
			/** 🚧 M3b: the persona the applet offers to play as (name: _persona draft_) — made only when the person presses Start. */
			persona?: { name: string; description?: string }
		}
		/** The person's sessions: what a branch or next chapter may follow. */
		sessions?: readonly FollowRow[]
		/** The new session's id, once the server has made it. */
		onCreated: (sessionId: number) => void
		onCancel: () => void
		/** The view's close gate reads this. Bindable. */
		hasChanges?: boolean
		/**
		 * Show the back chevron — the list is behind this screen, off screen
		 * (compact). At desk the list stands beside it, so no back (Q3).
		 */
		showBack?: boolean
	}

	let {
		prefill,
		sessions = [],
		onCreated,
		onCancel,
		hasChanges = $bindable(false),
		showBack = false
	}: Props = $props()

	const flow = new StartSessionFlow()

	/** An administrator is offered the way to the presets (E3). Absent in a
	 *  test that mounts the form alone. */
	const userCtx = getContext<UserCtx | undefined>("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	/** 🚧 Starred starts (ruled 2026-10-19): the favourite genre and the favourite preset per genre. */
	const settingsCtx = getContext<UserSettingsCtx | undefined>(
		"userSettingsCtx"
	)
	const advanced = $derived(showsAdvancedControls(settingsCtx?.settings))
	const favourites = $derived(settingsCtx?.settings?.startFavourites ?? null)
	function saveFavourites(next: {
		genre?: string
		presetByGenre?: Record<string, number>
	}) {
		if (settingsCtx?.settings)
			settingsCtx.settings = {
				...settingsCtx.settings,
				startFavourites: next
			}
		const release = requestWithInterest(
			"userSettings:updateStartFavourites",
			{ favourites: next },
			() => release()
		)
	}
	function starGenre(id: string) {
		const cur = favourites ?? {}
		saveFavourites({
			...cur,
			...(cur.genre === id ? { genre: undefined } : { genre: id })
		})
	}
	function starPreset(genreId: string, id: number) {
		const cur = favourites ?? {}
		const by = { ...(cur.presetByGenre ?? {}) }
		if (by[genreId] === id) delete by[genreId]
		else by[genreId] = id
		saveFavourites({ ...cur, presetByGenre: by })
	}
	/** The one genre row whose long copy is unfolded ("More"); never a dialog. */
	let aboutOpen = $state<string | null>(null)
	/** The rules choice whose fit audit is open (admins). */
	let auditChoice = $state<RulesChoice | null>(null)
	const RATING_WORD: Record<string, string> = {
		incompatible: "Incompatible",
		poor: "Poor",
		ok: "Ok",
		good: "Good",
		great: "Great",
		perfect: "Perfect"
	}
	/** The picker's bands (ruled 2026-10-19): [Incompatible] · [Poor] · [Ok, Good] · [Great, Perfect], best first. */
	const rulesBands = $derived.by(() => {
		const choices = rulesOffer?.choices ?? []
		if (!choices.some((c) => c.fit))
			return [{ group: -1, label: "", choices }]
		const bands = [3, 2, 1, 0].map((group) => ({
			group,
			label: ["Incompatible", "Poor", "Ok · Good", "Great · Perfect"][
				group
			]!,
			choices: choices.filter((c) => (c.fit?.group ?? 3) === group)
		}))
		return bands.filter((b) => b.choices.length)
	})

	/** The card a section sits in — the shared `@utility panel-card` in app.css. */
	const CARD_CLASS = "panel-card"
	/** A cast row's ↑ ↓ × — 32px, 44px on a coarse pointer (STYLE-GUIDE §9). */
	const ICON_BUTTON =
		"text-surface-600-400 hover:bg-surface-200-800 hover:text-surface-950-50 inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-11"

	type Step = "genre" | "preset" | "cast" | "name"

	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let lorebookList: Sockets.Lorebooks.List.Response["lorebookList"] = $state(
		[]
	)
	const SURFACED_STARTS = [
		{
			id: "continue",
			name: "Continue the latest line",
			line: "Picks up the line played most recently, where the story stands now."
		},
		{
			id: "branch-off",
			name: "Branch off at a point",
			line: "Pick a line and a date. The first time this session writes to the lorebook, a new line forks there."
		}
	] as const
	/** Shared surfaced books: copy only (owner 2026-11-09, "Own: start on; shared: copy"). */
	let sharedSurfacedList: Sockets.Lorebooks.List.Response["lorebookList"] =
		$state([])
	/** How a new session starts on an own surfaced book: the draft. */
	let surfacedStart = $state<"continue" | "branch-off">("continue")
	let surfacedBranchId = $state<number | null>(null)
	let surfacedClock = $state<StoryClock | null>(null)
	let creating = $state(false)
	/** 🚧 M2c: the person chose the generic start form for an applet genre ("Use the start form"). */
	let genericForm = $state(false)
	/** 🚧 M2c: an applet's request collapses to a one-press confirm until "Change…". */
	let changeOpen = $state(false)
	/**
	 * Which step the person has asked to open, over the first unsettled one.
	 * Every collapsed step carries a Change action, so a person who wants the
	 * cast before the genre can say so.
	 */
	let openStep = $state<Step | null>(null)
	/** The two pickers the cast step opens: Add characters, and Change. */
	let castPickerOpen = $state(false)
	let playAsPickerOpen = $state(false)
	let choosePlayAsButton = $state<HTMLButtonElement | null>(null)
	let addCharactersButton = $state<HTMLButtonElement | null>(null)
	let touched = $state(false)
	/** The person has answered this step themselves, so it may collapse. */
	let genreConfirmed = $state(false)
	let presetConfirmed = $state(false)
	let castTouched = $state(false)

	/** Released when the create is answered, or when the form goes away. */
	let releaseCreateInterest: (() => void) | null = null
	/** 🚧 M3b: the persona card Start made from the draft, kept so a refused create (and the session's name) can say so. */
	let madePersona = $state<{ id: number; name: string } | null>(null)
	/** True from the press on a draft until `characters:create` answers (or is refused); the broadcast reply is guarded on it. */
	let awaitingPersona = false
	let releasePersonaCreate: (() => void) | null = null
	/** The server's words when making the persona was refused; shown inline, never toasted. */
	let personaError = $state<string | null>(null)

	const handleCharactersList = (msg: Sockets.Characters.List.Response) => {
		characters = withoutShared(msg.characterList) // shared rows are read and copy only (PLAN-private-messages §6.7, Q3)
	}
	const handleLorebooksList = (msg: Sockets.Lorebooks.List.Response) => {
		// Only owned books — a shared one is read and copy only (PLAN-private-messages §6.7) — plus a
		// provided book, which every person may read into a session (owner ruling 2026-11-05, m3-core).
		lorebookList = msg.lorebookList.filter(
			(b) => !b.isSharedWithMe || !!(b as { provided?: unknown }).provided
		)
		// A lorebook someone shared from their session: copy only, listed apart.
		sharedSurfacedList = msg.lorebookList.filter(
			(b) =>
				b.isSharedWithMe &&
				b.surfacedFromSessionId != null &&
				!(b as { provided?: unknown }).provided
		)
	}
	const handleGenres = (msg: Sockets.Sessions.Genres.Response) => {
		flow.rawGenres = msg.genres || []
	}
	const handlePresets = (msg: Sockets.SessionAdmin.Presets.Response) => {
		flow.rawPresets = msg.presets || []
		flow.presetsLoaded = true
	}

	/**
	 * The four lists this screen reads, each asked for and listened for in
	 * one. The cast and the "who you play as" rows come from the SAME list: a
	 * persona is a character carrying `isPersona`, so there is no second
	 * family to ask. The lorebook picker's list is the edit form's, on the
	 * same terms.
	 *
	 * All BARE: none has an entry in `SCOPED_EVENTS`, and each is the whole of
	 * a list rather than one session's rows. All standing while the form is
	 * mounted, because each is a cascade target — a character created in its
	 * own picker, or a lorebook created elsewhere, re-sends the list this
	 * screen renders.
	 */
	/** The prefilled creation mode (and the session it follows), applied once. */
	let modePrefilled = false
	$effect(() => {
		if (modePrefilled || !prefill?.mode) return
		modePrefilled = true
		flow.chooseMode(prefill.mode)
		flow.from = prefill.from ?? null
	})
	$effect(() =>
		requestWithInterest("characters:list", {}, handleCharactersList)
	)
	$effect(() =>
		requestWithInterest("lorebooks:list", {}, handleLorebooksList)
	)
	$effect(() => requestWithInterest("sessions:genres", {}, handleGenres))
	$effect(() => requestWithInterest("sessionPresets:list", {}, handlePresets))

	/**
	 * Step 1's opening answer: the caller's genre, the only registered one, or
	 * the genre whose default preset an administrator has starred.
	 *
	 * The starred pick waits for `sessionPresets:list`, because the star lives
	 * on a preset row — with several genres and no preset list yet there is
	 * nothing to read it from, and the step simply stays open.
	 */
	$effect(() => {
		if (flow.genreId !== null) return
		const genres = flow.genres
		if (!genres.length) return
		if (
			prefill?.genreId &&
			genres.some((g) => g.genreId === prefill.genreId)
		) {
			flow.chooseGenre(prefill.genreId)
			return
		}
		if (genres.length === 1) {
			flow.chooseGenre(genres[0].genreId)
			return
		}
		if (
			favourites?.genre &&
			genres.some((g) => g.genreId === favourites.genre)
		) {
			flow.chooseGenre(favourites.genre)
			return
		}
		if (!flow.presetsLoaded) return
		const wanted = defaultGenreId(genres, flow.rawPresets)
		if (wanted) flow.chooseGenre(wanted)
	})

	/** Step 2's answer: one enabled preset is taken silently, several open the
	 *  chooser with the genre's default selected. */
	$effect(() => {
		// Read what the choice depends on, so the effect re-runs with it.
		void flow.presetsForGenre
		void flow.presetId
		const wanted =
			prefill?.presetId ?? favourites?.presetByGenre?.[flow.genreId ?? ""]
		if (
			wanted != null &&
			flow.presetId !== wanted &&
			flow.presetsForGenre.some((p) => p.id === wanted)
		) {
			flow.choosePreset(wanted)
			return
		}
		flow.syncPresetChoice()
	})

	/**
	 * 🚧 M2c: an applet's declared field values and proposed lorebook, applied once the genre and its preset have
	 * filled their own defaults (so the applet's answers win).
	 */
	let appletFieldsApplied = $state(false)
	$effect(() => {
		if (appletFieldsApplied || !prefill) return
		if (!prefill.fields && prefill.lorebookId == null && !prefill.persona)
			return
		if (flow.genreId === null || flow.genreId !== prefill.genreId) return
		if (flow.presetId === null && !flow.noPresetsForGenre) return
		appletFieldsApplied = true
		untrack(() => {
			// 🚧 M3b: the applet's offered persona wins over the person's default persona (and a `personaId`).
			// The same test `reconcileToShape` applies: a genre with no `personas` takes none.
			if (
				prefill.persona &&
				flow.shape?.personas &&
				flow.shape.personas.max !== 0
			) {
				flow.personaDraft = { ...prefill.persona }
				flow.personaIds = []
				personaDecidedByPerson = true
			}
			if (prefill.fields) {
				flow.fields.genreFields = {
					...flow.fields.genreFields,
					...prefill.fields
				}
				// 🚧 M3b (gate walk 2026-11-05): a prefilled field the preset asks at start is the
				// person's answer — given in the applet, not in this form — and it survives a preset
				// change (owner, 2026-11-05). Without this, Start took every untouched ask OUT
				// (`sentGenreFields`) and the session inherited the preset's defaults over the game's
				// wizard (world, hero, difficulty, mode all lost; only the non-ask `home` survived).
				flow.prefillAnswers = { ...prefill.fields }
				flow.askAnswers = { ...flow.askAnswers, ...prefill.fields }
			}
			if (prefill.lorebookId != null && flow.shape?.lorebook)
				flow.fields.lorebookId = prefill.lorebookId
		})
	})

	/** 🚧 M2c: nothing left to ask an applet's request: one press, with what will be used. */
	const confirmOnly = $derived(
		!!prefill?.fromApplet &&
			!changeOpen &&
			flow.genreId !== null &&
			flow.genreId === prefill.genreId &&
			(!(
				prefill.fields ||
				prefill.lorebookId != null ||
				prefill.persona
			) ||
				appletFieldsApplied) &&
			flow.canStart
	)
	/**
	 * 🚧 M3b: the genre seats its cast from the attached lorebook at create (`shape.castFromLorebook`) — said in
	 * the confirm only when it will happen: the switch field (absent = always on) is on, and a book is chosen
	 * (the server seats only from an attached book).
	 */
	const seatsCastFromBook = $derived.by(() => {
		const seat = flow.shape?.castFromLorebook
		if (!seat || flow.fields.lorebookId == null) return false
		if (!seat.field) return true
		// The server's rule, read off what Start will actually SEND (unanswered
		// start-form questions are dropped): the sent value, else the declared
		// default; only `true` counts.
		const sent = flow.sentGenreFields()
		const declared = (flow.shape?.fields ?? {}) as Record<
			string,
			{ default?: unknown } | undefined
		>
		const value =
			sent[seat.field] !== undefined
				? sent[seat.field]
				: declared[seat.field]?.default
		return value === true
	})
	const confirmFacts = $derived.by(() => {
		const out: string[] = []
		if (flow.preset?.name) out.push(`Preset: ${flow.preset.name}`)
		const personas = personaOptions.filter((p) =>
			flow.personaIds.includes(p.id)
		)
		if (flow.personaDraft)
			out.push(`Playing as ${flow.personaDraft.name} (new)`)
		else if (personas.length)
			out.push(`Playing as ${personas.map((p) => p.name).join(", ")}`)
		const book = lorebookList.find((b) => b.id === flow.fields.lorebookId)
		if (book) {
			// 🚧 A book on Freeform brings no rules: say which rules it plays with.
			const withRules =
				rulesOffer &&
				bookRulesFit(rulesOffer, book.primaryRuleset, flow.genre?.name)
					.rulesId === null
					? rulesOffer.choices.find((c) => c.id === rulesNow?.value)
							?.name
					: null
			out.push(
				withRules
					? `Lorebook: ${book.name} with ${withRules}`
					: `Lorebook: ${book.name}`
			)
		}
		if (seatsCastFromBook) out.push("Who is in it: the world's own people")
		return out
	})
	/**
	 * 🚧 M2c (ruled 2026-10-31): the applet's field values the session will start with, one row each under the
	 * genre's declared label; a key the genre does not declare is not shown (nothing would use it).
	 */
	const confirmFields = $derived.by(() => {
		const declared = (flow.shape?.fields ?? {}) as Record<
			string,
			ConfirmFieldDecl | undefined
		>
		const applied = (flow.fields.genreFields ?? {}) as Record<
			string,
			unknown
		>
		const out: Array<{ key: string; label: string; value: string }> = []
		for (const key of Object.keys(prefill?.fields ?? {})) {
			const decl = declared[key]
			if (!decl) continue
			out.push({
				key,
				label: i18nTextIn(decl.label) ?? key,
				value: confirmValueText(applied[key], decl)
			})
		}
		return out
	})
	type ConfirmFieldDecl = {
		label?: unknown
		fields?: Record<string, { label?: unknown } | undefined>
	}
	function fieldValueText(v: unknown): string {
		if (v === null || v === undefined || v === "") return "—"
		if (typeof v === "boolean") return v ? "Yes" : "No"
		if (typeof v === "object") return JSON.stringify(v)
		return String(v)
	}
	/**
	 * 🚧 The words for one confirm value (owner, 2026-11-05): a scalar as is; an object whose
	 * declaration names its sub-fields as _<Label> <value> · <Label> <value>_ (a nested object or
	 * list one level deep as _k: v, k: v_; empty ones skipped); any other object as _(details)_ —
	 * the game's own review screen already showed it, and raw JSON is not for the person.
	 */
	function confirmValueText(v: unknown, decl: ConfirmFieldDecl): string {
		if (v === null || v === undefined || v === "") return "—"
		if (typeof v !== "object") return fieldValueText(v)
		const subs = decl.fields
		if (!subs || Array.isArray(v)) return "(details)"
		const parts: string[] = []
		for (const [k, sub] of Object.entries(subs)) {
			const sv = (v as Record<string, unknown>)[k]
			if (isEmptyValue(sv)) continue
			parts.push(`${i18nTextIn(sub?.label) ?? k} ${compactValueText(sv)}`)
		}
		return parts.length ? parts.join(" · ") : "(details)"
	}
	function isEmptyValue(v: unknown): boolean {
		if (v === null || v === undefined || v === "") return true
		if (Array.isArray(v)) return v.length === 0
		if (typeof v === "object")
			return Object.values(v as Record<string, unknown>).every(
				isEmptyValue
			)
		return false
	}
	function compactValueText(v: unknown): string {
		if (Array.isArray(v))
			return v
				.filter((x) => !isEmptyValue(x))
				.map(compactValueText)
				.join(", ")
		if (v && typeof v === "object")
			return Object.entries(v as Record<string, unknown>)
				.filter(([, x]) => !isEmptyValue(x))
				.map(([k, x]) => `${k}: ${compactValueText(x)}`)
				.join(", ")
		return fieldValueText(v)
	}

	/** The prefilled character, once the list carrying it lands. */
	let prefilledCharacter = $state(false)
	$effect(() => {
		const id = prefill?.characterId
		if (prefilledCharacter || id == null) return
		if (!characterOptions.some((c) => c.id === id)) return
		prefilledCharacter = true
		if (!flow.characterIds.includes(id))
			flow.characterIds = [...flow.characterIds, id]
	})

	/**
	 * The persona the person speaks as: the caller's prefilled one, else
	 * their default — when the genre preselects it
	 * (`preselectsDefaultPersona`; Dungeon Crawler does not: a persona there
	 * is only a seed, and the player is the seat). Decided once the genre is
	 * known, and again when it changes, but only over the form's own pick:
	 * once the person chooses or removes a persona, the form never refills.
	 */
	let personaDecidedByPerson = false
	let autoPersonaId: number | null = null
	$effect(() => {
		if (personaDecidedByPerson || !personaOptions.length) return
		// 🚧 M3b: the applet's offered persona (the draft) takes the seat; the default is not preselected.
		if (flow.personaDraft) return
		if (flow.genreId === null) return
		const shape = flow.shape
		const held = untrack(() => flow.personaIds)
		const prefilled = prefill?.personaId
		if (
			prefilled != null &&
			personaOptions.some((p) => p.id === prefilled)
		) {
			// The caller's answer is the person's: kept as given.
			personaDecidedByPerson = true
			if (held.length !== 1 || held[0] !== prefilled)
				flow.personaIds = [prefilled]
			return
		}
		const ownPick =
			held.length === 0 ||
			(held.length === 1 && held[0] === autoPersonaId)
		if (!ownPick) return
		const wanted = preselectsDefaultPersona(shape)
			? (personaOptions.find((p) => p.isDefaultPersona)?.id ?? null)
			: null
		autoPersonaId = wanted
		const next = wanted != null ? [wanted] : []
		if (next.length !== held.length || next[0] !== held[0])
			flow.personaIds = next
	})

	/**
	 * Unsaved edits are the person's own: the saved snapshot is the form as
	 * it stood just before their first touch (`touch()`), after the effects
	 * above filled in the genre, preset and prefilled cast for them. So
	 * nothing the form chose by itself is an edit, and a name typed and
	 * deleted, or a character picked and un-picked, is none either. The cast
	 * is compared in order, because its order is the turn order the person
	 * set with ↑ ↓.
	 */
	const edits = new UnsavedEdits(
		() => ({
			genreId: flow.genreId,
			mode: flow.mode,
			from: flow.from,
			presetId: flow.presetId,
			characterIds: flow.characterIds,
			castMemberIds: flow.castMemberIds,
			personaIds: flow.personaIds,
			personaDraft: flow.personaDraft?.name ?? null,
			lorebookId: flow.fields.lorebookId,
			starterKit: flow.starterKit,
			name: flow.fields.name.trim(),
			scenario: flow.fields.scenario,
			rulesPick: flow.rulesPick,
			rigourPick: flow.rigourPick
		}),
		{ unordered: ["personaIds"] }
	)
	/** Call BEFORE the person's change lands (hence `onbeforeinput` below). */
	function touch() {
		if (touched) return
		edits.markSaved()
		touched = true
	}
	$effect(() => {
		hasChanges = edits.dirty
	})

	const genreOptions = $derived.by(() => {
		const fav = favourites?.genre
		const all = flow.genres
		if (!fav) return all
		return [
			...all.filter((g) => g.genreId === fav),
			...all.filter((g) => g.genreId !== fav)
		]
	})
	const presetOptions = $derived(flow.presetsForGenre)

	const genreAnswered = $derived(flow.genreId !== null)
	const presetAnswered = $derived(
		flow.presetId !== null || flow.noPresetsForGenre
	)
	const castAnswered = $derived(
		flow.characterIds.length + flow.castMemberIds.length >=
			flow.floors.characters &&
			flow.personaIds.length + (flow.personaDraft ? 1 : 0) >=
				flow.floors.personas
	)

	/** A step with one option is answered for the person, never asked. */
	const genreIsAChoice = $derived(genreOptions.length > 1)
	const presetIsAChoice = $derived(
		presetOptions.length > 1 || flow.noPresetsForGenre
	)

	/**
	 * A step is *settled* when nothing is left to ask there: it had one option,
	 * or the person picked, or the caller answered it in the prefill. Settled
	 * steps show as their summary line and the one below them opens.
	 *
	 * The cast step is the exception that stays open after it is answered: the
	 * floors say the session *can* start, not that the room is full, so the
	 * list stays on screen and the Name card appears under it.
	 */
	/** A genre that takes neither a cast nor a persona is not asked who is in
	 *  it — there is nobody to put there. */
	const castStepApplies = $derived(
		(flow.shape?.characters?.max ?? 1) !== 0 ||
			(flow.shape?.personas?.max ?? 1) !== 0
	)

	/**
	 * The genre list stays on screen (polish parity L11), so a genre that is
	 * answered — by the person, the prefill, a star or the admin's default —
	 * settles its step; and the preset is a row with Change, so one chosen
	 * (the genre's default, or a star) settles it until Change reopens it.
	 */
	const genreSettled = $derived(
		!genreIsAChoice || genreConfirmed || genreAnswered
	)
	const presetSettled = $derived(
		!presetIsAChoice || presetConfirmed || flow.presetId !== null
	)
	const castSettled = $derived(
		!castStepApplies || (castAnswered && prefilledCharacter && !castTouched)
	)

	/** The step the screen is asking — the first unsettled, unless reopened. */
	const firstUnsettled = $derived.by((): Step => {
		if (!genreSettled) return "genre"
		if (!presetSettled) return "preset"
		if (!castSettled) return "cast"
		return "name"
	})
	const activeStep = $derived(openStep ?? firstUnsettled)

	/**
	 * A step is on screen once everything above it has an answer. The preset
	 * step shows only when there is something to choose, or nothing to start
	 * from (less-confusing E4): one preset is answered silently, and a card
	 * holding a heading and the one name read as a question with no question.
	 */
	const showPreset = $derived(genreAnswered && presetIsAChoice)
	const showCast = $derived(
		genreAnswered && presetAnswered && castStepApplies
	)
	/** The Scenario offer sits at the foot once the genre and preset are
	 *  answered; the Name card is always on screen, at the top. */
	const showScenarioCard = $derived(genreAnswered && presetAnswered)

	const expandedPreset = $derived(presetIsAChoice && activeStep === "preset")
	const expandedCast = $derived(activeStep === "cast")

	/** The rows a person can pick. A list row with no id has nothing to add to
	 *  the session, so it is not offered. */
	type CharacterOption = (typeof characters)[number] & { id: number }
	type PersonaOption = CharacterOption
	const characterOptions = $derived(
		characters.filter((c): c is CharacterOption => c.id != null)
	)
	/**
	 * Who the person can play as: every character they have, personas first
	 * (the default leading), then everyone else — see `playAsOptions`. A
	 * library with no personas yet can still start: the server flags the
	 * character it seats (`markCharacterAsPersona`).
	 */
	const personaOptions = $derived(
		playAsOptions(characterOptions, flow.characterIds)
	)

	/**
	 * The lorebook step, asked only of a genre whose shape has the
	 * capability. Required or optional is the shape's word (`lorebook:
	 * "required" | "optional"`); a genre without it is never asked, and
	 * `reconcileToShape` has already detached whatever was held.
	 */
	type LorebookOption = (typeof lorebookList)[number] & { id: number }
	const lorebookOptions = $derived(
		lorebookList.filter(
			// 🚧 An admin's own starter lorebooks are on their shelf too; a session
			// starts FROM a kit (below), never reads one.
			(l): l is LorebookOption => l.id != null && !isStarterKit(l)
		)
	)
	/**
	 * 🚧 A **surfaced book** (`Share as a lorebook`) the asker owns is an
	 * ordinary book to start on (owner 2026-11-09, "Own: start on; shared:
	 * copy"): the list holds only their own books, so it stays among them and
	 * unfolds the two starts when chosen. One shared by someone else is copy
	 * only (`sharedSurfacedOptions`).
	 */
	const sharedSurfacedOptions = $derived(
		sharedSurfacedList.filter((l): l is LorebookOption => l.id != null)
	)
	/** 🚧 (c-3, 2026-11-10) the picker's books by source. The asker's own books (no `provided`) come first. */
	const ownBookOptions = $derived(
		lorebookOptions.filter((l) => !(l as { provided?: unknown }).provided)
	)
	/** 🚧 Provided books, one group per plugin (core = `Serene Pub`), groups by label, rows in list order. */
	const pluginBookGroups = $derived.by(() => {
		// The heading is the canon's provided-book line (`providedRowLine`).
		const byHeading = new Map<string, LorebookOption[]>()
		for (const l of lorebookOptions) {
			const heading = providedRowLine(l)
			if (!heading) continue
			const rows = byHeading.get(heading) ?? []
			rows.push(l)
			byHeading.set(heading, rows)
		}
		return [...byHeading.entries()]
			.map(([heading, rows]) => ({
				heading,
				label: heading.replace(/^Comes with /, ""),
				rows
			}))
			.sort((a, b) => a.label.localeCompare(b.label))
	})
	/** 🚧 Shared surfaced books, one group per person (`ownerName`; none → `Shared with you`), groups by name. */
	const sharedBookGroups = $derived.by(() => {
		const byName = new Map<string, LorebookOption[]>()
		for (const l of sharedSurfacedOptions) {
			const name = (l as { ownerName?: string | null }).ownerName || ""
			const rows = byName.get(name) ?? []
			rows.push(l)
			byName.set(name, rows)
		}
		return [...byName.entries()]
			.map(([name, rows]) => ({
				label: name || "Shared with you",
				heading: name ? `Shared by ${name}` : "Shared with you",
				rows
			}))
			.sort((a, b) => a.label.localeCompare(b.label))
	})
	/** The chosen book when it is the asker's own surfaced book and the start is a plain new one. */
	const ownSurfacedChosen = $derived(
		flow.mode === "new" && flow.fields.lorebookId != null
			? (lorebookOptions.find(
					(l) =>
						l.id === flow.fields.lorebookId &&
						l.surfacedFromSessionId != null &&
						!l.isSharedWithMe
				) ?? null)
			: null
	)
	// The draft starts over whenever the book or the mode changes.
	$effect(() => {
		void flow.fields.lorebookId
		void flow.mode
		untrack(() => {
			surfacedStart = "continue"
			surfacedBranchId = null
			surfacedClock = null
		})
	})
	/** Start in the copy mode on a surfaced book. */
	function chooseSurfacedBook(id: number) {
		touch()
		flow.chooseMode("new-world")
		chooseLorebook(id)
	}
	/** 🚧 What the genre says of its characters while none is added (`shape.characters.hint`). */
	const charactersHint = $derived(
		i18nTextIn(
			(flow.shape?.characters as { hint?: unknown } | undefined)?.hint
		) ?? null
	)
	/**
	 * **None** chosen: no book and no starter lorebook. Always offered — a
	 * session may start without a book (RF fix 2, 2026-10-23; the genre's
	 * `lorebook: 'required'` is retired): its own is its world.
	 */
	const noLorebookChosen = $derived(
		flow.fields.lorebookId == null && !flow.starterKit
	)
	/** On screen once everything above it has an answer, like the Name card. */
	const showLorebook = $derived(
		genreAnswered &&
			presetAnswered &&
			castAnswered &&
			!!flow.shape?.lorebook
	)

	/**
	 * 🚧 **Start from a starter lorebook** on the Lorebook card (PLAN-lorebook-kinds
	 * ruling 8): the kits are asked for while the card is on screen (a GATED
	 * family, so with interest declared), and a pick sends `starterKit` in
	 * place of a lorebook. With no kit listed the choice is not drawn.
	 */
	let kits = $state<Sockets.StarterKits.Card[] | null>(null)
	/** The kit card chosen, by its id; "" while a book (or None) is. */
	let kitCardId = $state("")
	$effect(() => {
		if (!showLorebook) return
		return requestWithInterest("starterKits:list", {}, (res) => {
			kits = res?.kits ?? []
		})
	})
	const chosenKit = $derived(
		kitCardId && flow.starterKit
			? (kits?.find((k) => k.id === kitCardId) ?? null)
			: null
	)
	// Only a kit the list holds stays chosen.
	$effect(() => {
		if (!kits || !kitCardId) return
		if (!kits.some((k) => k.id === kitCardId))
			untrack(() => chooseLorebook(null))
	})
	// A book chosen from anywhere (a pre-fill, the dialog) replaces a kit.
	$effect(() => {
		if (flow.fields.lorebookId == null) return
		untrack(() => {
			if (flow.starterKit) {
				flow.starterKit = null
				kitCardId = ""
			}
		})
	})

	function chooseKit(card: Sockets.StarterKits.Card) {
		const ref = refOfCard(card)
		if (!ref) return
		touch()
		flow.fields.lorebookId = null
		flow.starterKit = ref
		kitCardId = card.id
	}

	/**
	 * **Create a lorebook** from the lorebook step itself (less-confusing E2):
	 * the same dialog the Lorebooks view opens, and the new book is chosen
	 * here once the server answers. The create is claimed by its `requestId`,
	 * so a book made in another tab is never taken for this one. A refusal is
	 * toasted by the shell's catch-all; this only stops waiting.
	 */
	let newLorebookOpen = $state(false)
	let pendingLorebookRequestId: string | null = null
	let releaseLorebookCreate: (() => void) | null = null

	const handleLorebookCreated = (res: Sockets.Lorebooks.Create.Response) => {
		if (
			pendingLorebookRequestId === null ||
			res?.requestId !== pendingLorebookRequestId
		)
			return
		pendingLorebookRequestId = null
		releaseLorebookCreate?.()
		releaseLorebookCreate = null
		const book = res.lorebook
		if (book?.id == null) return
		// The list's own re-send may land after this answer: hold the row so
		// the picker shows it selected at once.
		if (!lorebookList.some((l) => l.id === book.id))
			lorebookList = [...lorebookList, book]
		chooseLorebook(book.id)
	}

	const handleLorebookCreateError = (res: { requestId?: string }) => {
		if (
			pendingLorebookRequestId === null ||
			res?.requestId !== pendingLorebookRequestId
		)
			return
		pendingLorebookRequestId = null
		releaseLorebookCreate?.()
		releaseLorebookCreate = null
	}

	function createLorebook(details: {
		name: string
		primaryRuleset?: string
		starterKit?: Sockets.StarterKits.Ref
	}) {
		const name = details.name.trim()
		if (!name && !details.starterKit) return
		newLorebookOpen = false
		touch()
		releaseLorebookCreate?.()
		const requestId = uuid()
		pendingLorebookRequestId = requestId
		// The error key first, so the one interest sync carries both halves.
		const releaseError = declareInterest<"lorebooks:create:error">(
			"lorebooks:create:error",
			handleLorebookCreateError
		)
		const releaseOk = requestWithInterest(
			"lorebooks:create",
			{
				name,
				requestId,
				...(details.starterKit
					? { starterKit: details.starterKit }
					: details.primaryRuleset
						? { primaryRuleset: details.primaryRuleset }
						: {})
			},
			handleLorebookCreated
		)
		releaseLorebookCreate = () => {
			releaseOk()
			releaseError()
		}
	}

	const selectedCharacters = $derived(
		flow.characterIds
			.map((id) => characterOptions.find((c) => c.id === id))
			.filter((c): c is CharacterOption => !!c)
	)
	/**
	 * 🚧 The chosen book's card-less members (plan §34.2), offered under the
	 * book's name in **Add characters**. Only a session that reads the chosen
	 * book itself (`new`) seats them: a copy of the world has members of its
	 * own. A new book clears the picks — they belong to the old one.
	 */
	const memberBookId = $derived(
		flow.mode === "new" ? flow.fields.lorebookId : null
	)
	let bookMembers = $state<PickMember[]>([])
	$effect(() => {
		const id = memberBookId
		untrack(() => {
			bookMembers = []
			flow.castMemberIds = []
		})
		if (id == null) return
		return requestWithInterest(
			"lorebooks:bindingList",
			{ lorebookId: id },
			(msg) => {
				if (msg.lorebookId !== id) return
				bookMembers = castPickMembers(msg.lorebookBindingList)
				flow.keepCastMembersIn(
					new Set(
						bookMembers
							.filter((m) => m.cardId == null)
							.map((m) => m.id)
					)
				)
			}
		)
	})
	/** Carded members travel as card ids; only card-less ones are seated by member id. */
	const cardlessBookMembers = $derived(
		bookMembers.filter((m) => m.cardId == null)
	)
	const selectedMembers = $derived(
		flow.castMemberIds
			.map((id) => cardlessBookMembers.find((m) => m.id === id))
			.filter((m): m is PickMember => !!m)
	)
	const membersToOffer = $derived(
		cardlessBookMembers.filter((m) => !flow.castMemberIds.includes(m.id))
	)
	const selectedPersonas = $derived(
		flow.personaIds
			.map((id) => personaOptions.find((p) => p.id === id))
			.filter((p): p is PersonaOption => !!p)
	)

	/**
	 * 🚧 M3b: the persona draft drawn as a chosen row — no card behind it, so a negative id no card can have.
	 * It is the one row of "Who you play as" while a draft is held.
	 */
	const personaRows = $derived(
		flow.personaDraft
			? [
					{
						id: -1,
						name: flow.personaDraft.name,
						description: flow.personaDraft.description ?? "",
						isPersona: true
					}
				]
			: selectedPersonas
	)

	const characterName = (c: CharacterOption) =>
		c.nickname || c.name || "Unnamed character"

	const castSummary = $derived(
		[
			[
				...selectedCharacters.map(characterName),
				...selectedMembers.map((m) => m.name)
			].join(", "),
			[
				...selectedPersonas.map((p) => p.name),
				...(flow.personaDraft ? [flow.personaDraft.name] : [])
			].join(", ")
		]
			.filter(Boolean)
			.join(" · ") || "Nobody yet"
	)

	/**
	 * Who the cast picker offers: everyone but the one the person plays as —
	 * the mirror of `personaOptions` (note 33), so the two lists never share
	 * a row.
	 */
	const castPickOptions = $derived(
		castOptions(characterOptions, flow.personaIds)
	)

	/** The genre's cap on the cast, when it has one. */
	const castMax = $derived(flow.shape?.characters?.max ?? null)
	/** How many more the cast takes; null when the genre sets no cap. */
	const castRoom = $derived(
		castMax == null
			? null
			: Math.max(
					0,
					castMax -
						flow.characterIds.length -
						flow.castMemberIds.length
				)
	)

	/**
	 * Why **Add characters** cannot open, or null when it can. The picker
	 * offers `castPickOptions` less the chosen, so each reason is one way
	 * that comes to nobody.
	 */
	const addCharactersBlocked = $derived.by((): string | null => {
		if (castRoom === 0)
			return castMax === 1
				? "The cast is full — this genre takes one character."
				: `The cast is full — this genre takes at most ${castMax} characters.`
		// The book's card-less members are someone to add whatever cards there are.
		if (membersToOffer.length > 0) return null
		if (characterOptions.length === 0)
			return "You have no characters yet. Write one in the Characters view, then come back."
		if (castPickOptions.length === 0)
			return "The only character you have is the one you play as. Pick someone else to play as, or write another character."
		if (castPickOptions.every((c) => flow.characterIds.includes(c.id)))
			return "Everyone you have is in the cast."
		return null
	})

	/** Why **Choose who you play as** cannot open, or null when it can. */
	const playAsBlocked = $derived.by((): string | null => {
		if (characterOptions.length === 0)
			return "You have no characters yet. Write one in the Characters view, then come back."
		if (personaOptions.length === 0)
			return "Everyone you have is in the cast. Take one out to play as them, or write another character."
		return null
	})

	/**
	 * The Scenario box, revealed rather than standing.
	 *
	 * Every genre's session row has a scenario column and every one of them
	 * takes it, so the question is not whether the field exists but whether
	 * this session wants one — and most do not. A textarea left empty on most
	 * starts reads as a step that has been skipped; a text action reads as an
	 * offer. Once opened it stays open, so clearing the text does not take the
	 * box away mid-edit, and a preset that filled one opens it because there is
	 * already something to see.
	 */
	let scenarioOpen = $state(false)
	const showScenario = $derived(scenarioOpen || !!flow.fields.scenario)

	const canStart = $derived(flow.canStart && !creating)
	/** Why Start is grey, said under it (less-confusing E1); none while the
	 *  create is on its way. */
	const startReason = $derived(creating ? null : flow.startBlocker)

	function reopen(step: Step) {
		openStep = step
	}

	/** 🚧 M2c: an applet genre starts in its launcher, unless the applet itself asked or the person chose this form. */
	function launcherOf(id: string): string | null {
		if (prefill?.fromApplet || genericForm) return null
		return appletLauncher(flow.genres.find((g) => g.genreId === id))
	}

	function useStartForm(id: string) {
		genericForm = true
		chooseGenre(id)
	}

	function chooseGenre(id: string) {
		const launcher = launcherOf(id)
		if (launcher) {
			void goto(`/apps/${launcher}`)
			return
		}
		touch()
		genreConfirmed = true
		// A preset belongs to one genre: the new genre's default takes the
		// Preset row (`syncPresetChoice`), and Change offers the others.
		presetConfirmed = false
		openStep = null
		flow.chooseGenre(id)
	}

	function choosePreset(id: number) {
		touch()
		presetConfirmed = true
		openStep = null
		flow.choosePreset(id)
	}

	/** "exactly 1", "1–3", "at least 1" — the floor the form holds and the cap the genre sets. */
	const characterCountHint = $derived(
		castCountHint(
			flow.floors.characters,
			flow.shape?.characters?.max ?? undefined
		)
	)

	/** The removed row takes its × with it, so focus lands on Add. */
	async function removeCharacter(id: number) {
		touch()
		castTouched = true
		if (flow.characterIds.includes(id)) flow.toggleCharacter(id)
		await tick()
		if (!addCharactersButton?.disabled) addCharactersButton?.focus()
	}

	function addCharacters(ids: number[], castMemberIds: number[]) {
		touch()
		castTouched = true
		flow.addCharacters(ids)
		flow.addCastMembers(castMemberIds)
	}

	/** The removed member's row takes its × with it, so focus lands on Add. */
	async function removeMember(id: number) {
		touch()
		castTouched = true
		flow.removeCastMember(id)
		await tick()
		if (!addCharactersButton?.disabled) addCharactersButton?.focus()
	}

	/**
	 * Focus stays on the arrow pressed, which a moved row can drop. At an end
	 * that arrow is disabled, so focus crosses to the row's other arrow
	 * rather than falling to the page.
	 */
	async function moveCharacter(id: number, by: -1 | 1) {
		touch()
		castTouched = true
		flow.moveCharacter(id, by)
		await tick()
		const arrow = (dir: "up" | "down") =>
			document.querySelector<HTMLButtonElement>(
				`[data-cast-move="${id}:${dir}"]`
			)
		const pressed = arrow(by === -1 ? "up" : "down")
		const other = arrow(by === -1 ? "down" : "up")
		;(pressed && !pressed.disabled ? pressed : other)?.focus()
	}

	function choosePersona(id: number) {
		touch()
		castTouched = true
		personaDecidedByPerson = true
		flow.playAs(id)
	}

	/** Play as nobody: the removed row takes its × with it, so focus lands
	 *  on Choose who you play as. */
	async function removePersona() {
		touch()
		castTouched = true
		personaDecidedByPerson = true
		flow.personaDraft = null
		flow.personaIds = []
		await tick()
		if (!choosePlayAsButton?.disabled) choosePlayAsButton?.focus()
	}

	function chooseLorebook(id: number | null) {
		touch()
		flow.starterKit = null
		kitCardId = ""
		flow.fields.lorebookId = id
	}

	/**
	 * 🚧 Rules and How strict (PLAN-rulesets §4, §21): the genre's offer,
	 * asked once the genre and preset are answered. A chosen lorebook's own
	 * rules are adopted (the server takes them whatever is sent), so the
	 * picker says where they come from instead of offering a choice. A book
	 * on Freeform, every book's default, brings none: the picker stays, as
	 * with no book (fix7, 2026-10-23; `adoptedBookRules`).
	 */
	const rulesOffer = $derived(flow.rulesOffer)
	/** A genre with a lorebook step asks it first: the Rules card sits under
	 *  the Lorebook card and appears with it, never ahead of it — a book's
	 *  rules are adopted, so "From the lorebook" is only said once the book
	 *  is on screen to see and change. */
	const showRules = $derived(
		genreAnswered &&
			presetAnswered &&
			!!rulesOffer &&
			(!flow.shape?.lorebook || showLorebook)
	)
	const chosenLorebook = $derived(
		flow.fields.lorebookId == null
			? null
			: (lorebookOptions.find((l) => l.id === flow.fields.lorebookId) ??
					null)
	)
	/**
	 * 🚧 M3b: the persona the session is named for while no character is in the cast — the draft held, or the
	 * card Start made from it (kept while it is the one chosen, so the placeholder does not change between the
	 * press and the create, nor on a retry).
	 */
	const namedPersona = $derived(
		flow.personaDraft?.name ??
			(madePersona && flow.personaIds.includes(madePersona.id)
				? madePersona.name
				: null)
	)
	const placeholderName = $derived(
		namedPersona && selectedCharacters.length + selectedMembers.length === 0
			? draftSessionName(namedPersona, chosenLorebook?.name ?? null)
			: autoSessionName(
					[
						...selectedCharacters.map(characterName),
						...selectedMembers.map((m) => m.name)
					],
					[
						...selectedPersonas.map((p) => p.name || ""),
						...(flow.personaDraft ? [flow.personaDraft.name] : [])
					]
				)
	)

	/** The chosen book's rules, which the session adopts: How strict follows them. */
	$effect(() => {
		flow.lorebookRules =
			chosenKit?.rulesId ?? chosenLorebook?.primaryRuleset ?? null
	})
	const rulesNow = $derived(flow.rulesShown)
	/** 🚧 Where adopted rules come from, in words: the book's or the kit's — only when it brings its own. */
	const rulesAdoptedLine = $derived(
		chosenKit && flow.adoptedRules
			? `From the starter lorebook: ${chosenKit.rulesName}`
			: (rulesNow?.fromLorebook ?? null)
	)
	/**
	 * A preset that pins a How strict the chosen rules cannot play (Rule Based
	 * with Freeform): said, not hidden — the session runs in words.
	 */
	const presetRigourUnplayed = $derived(
		!!flow.presetRigour &&
			!!rulesOffer &&
			!!rulesNow &&
			!howStrictChoices(rulesOffer, rulesNow.value).some(
				(o) => o.id === flow.presetRigour
			)
	)

	function chooseRules(id: string) {
		touch()
		flow.rulesPick = id
	}

	/**
	 * 🚧 **The book pick** (owner, 2026-11-05: one choice for the lorebook and the rules): for a genre with a
	 * lorebook step and a rules offer, ONE card lists the person's lorebooks, a blank start on each rules choice,
	 * and the starter lorebooks. Elsewhere today's Lorebook card and Rules card stand (Dungeon Crawler, Chat,
	 * the next chapter).
	 */
	const bookPickShown = $derived(
		flow.mode !== "branch" &&
			flow.mode !== "next-chapter" &&
			showLorebook &&
			flow.bookPick != null
	)
	/** **Start blank** on these rules: no lorebook, the session's own notes made on them. */
	function pickBlankRules(id: string) {
		touch()
		kitCardId = ""
		flow.pickBlank(id)
	}
	/** A starter lorebook's rules line for its row: what it brings, how well it fits, or why it can't be picked. */
	function kitRulesLine(kit: Sockets.StarterKits.Card) {
		if (!rulesOffer) return null
		const fit = bookRulesFit(rulesOffer, kit.rulesId, flow.genre?.name)
		if (fit.refusal) return { text: fit.refusal, refused: true }
		if (fit.rulesId === null)
			return { text: "Freeform: brings no rules of its own" }
		return {
			text: `Rules: ${fit.choice?.name ?? kit.rulesName}`,
			recommended: !!fit.choice?.recommended,
			rating: fit.choice?.fit ? RATING_WORD[fit.choice.fit.rating] : null
		}
	}
	/** How strict follows the rules in force; it is asked only when the preset leaves it open and the rules play more than one. */
	const howStrictShown = $derived(
		!!rulesOffer &&
			!flow.rigourLocked &&
			asksHowStrict(rulesOffer) &&
			howStrictChoices(rulesOffer, rulesNow?.value).length > 1
	)
	/** 🚧 Advanced controls: true when the book pick would draw a rules control with the switch on (the conditions of the pieces it hides). */
	const bookPickHides = $derived.by(() => {
		if (!rulesOffer) return false
		if (flow.mode !== "new-world") return true
		const chosenBook = lorebookOptions.find(
			(l) => l.id === flow.fields.lorebookId
		)
		if (
			chosenBook &&
			bookRulesFit(
				rulesOffer,
				chosenBook.primaryRuleset,
				flow.genre?.name
			).rulesId === null
		)
			return true
		if (
			kits?.length &&
			chosenKit &&
			bookRulesFit(rulesOffer, chosenKit.rulesId, flow.genre?.name)
				.rulesId === null
		)
			return true
		if (
			rulesOffer.choices.find((c) => c.id === rulesNow?.value)?.fit
				?.inWords?.length
		)
			return true
		return howStrictShown
	})
	/** 🚧 Advanced controls: true when the Rules card would draw a choice with the switch on: the rules list (no adopted rules) or How strict. */
	const rulesCardHides = $derived(!rulesAdoptedLine || howStrictShown)

	function chooseHowStrict(id: string) {
		touch()
		flow.rigourPick = id
	}

	const handleCreated = (res: Sockets.Sessions.Create.Response) => {
		releaseCreateInterest?.()
		releaseCreateInterest = null
		creating = false
		if (!res?.session?.id) return
		notify.success({
			source: "socket:sessions:create",
			title: "Session started",
			description: res.session.name || placeholderName
		})
		const refused = refusedSwapsSentence(res)
		if (refused)
			notify.warning({
				source: "socket:sessions:create:swaps",
				title: "Some settings were not applied",
				description: refused
			})
		edits.forget()
		hasChanges = false
		onCreated(res.session.id)
	}

	const handleCreateError = (res: Sockets.ErrorResponse) => {
		releaseCreateInterest?.()
		releaseCreateInterest = null
		creating = false
		notify.error({
			source: "socket:sessions:create:error",
			title: "Could not start the session",
			description:
				(res?.error || "The server refused the request.") +
				(madePersona && flow.personaIds.includes(madePersona.id)
					? ` Your persona ${madePersona.name} was made and is kept; Start again plays as it.`
					: "")
		})
	}

	/**
	 * 🚧 M3b: the persona draft becomes a card. The reply of `characters:create` is a broadcast to every tab of
	 * the person with no request id, so it is taken only while this form waits, and only for the name asked for.
	 */
	const handlePersonaCreated = (res: Sockets.Characters.Create.Response) => {
		const draft = flow.personaDraft
		const made = res?.character
		if (!awaitingPersona || !draft || !made || made.id == null) return
		if (made.name !== draft.name || !made.isPersona) return
		awaitingPersona = false
		releasePersonaCreate?.()
		releasePersonaCreate = null
		// The list's own re-send may land after this answer: hold the row so the persona shows at once.
		if (!characters.some((c) => c.id === made.id))
			characters = [...characters, made]
		madePersona = { id: made.id, name: made.name }
		flow.personaDraft = null
		flow.personaIds = [made.id]
		personaDecidedByPerson = true
		sendCreate()
	}

	const handlePersonaCreateError = (res: Sockets.ErrorResponse) => {
		if (!awaitingPersona) return
		awaitingPersona = false
		releasePersonaCreate?.()
		releasePersonaCreate = null
		creating = false
		personaError = res?.error || "The server refused the request."
	}

	/** Make the persona card the person is about to play as (the one door, `characters:create`), then start. */
	function makePersona(draft: { name: string; description?: string }) {
		personaError = null
		releasePersonaCreate?.()
		awaitingPersona = true
		// The error key first, so the one interest sync carries both halves.
		const releaseError = declareInterest<"characters:create:error">(
			"characters:create:error",
			handlePersonaCreateError
		)
		const releaseOk = requestWithInterest(
			"characters:create",
			{
				character: {
					name: draft.name,
					description: draft.description ?? "",
					isPersona: true
				}
			},
			handlePersonaCreated
		)
		releasePersonaCreate = () => {
			releaseOk()
			releaseError()
		}
	}

	function start() {
		if (!canStart) return
		creating = true
		const draft = flow.personaDraft
		if (draft) makePersona(draft)
		else sendCreate()
	}

	function sendCreate() {
		const finalName = finalSessionName(flow.fields.name, placeholderName)
		// The error key is declared first so the one interest sync the request
		// flushes carries both halves of the reply this form is waiting for.
		const releaseError = declareInterest<"sessions:create:error">(
			"sessions:create:error",
			handleCreateError
		)
		// 🚧 M2c: started from an applet's request (and still its genre): the server judges the applet's grant too.
		const payload = flow.payload(finalName)
		// A start on the asker's own surfaced book that branches off: a line and
		// a date, forked at the first write. Continue sends nothing.
		if (ownSurfacedChosen && surfacedStart === "branch-off") {
			const c = surfacedClock
			Object.assign(payload.session, {
				lorebookBranchId: surfacedBranchId,
				lineOnFirstWrite: true,
				...(c
					? {
							storyClockYear: c.year,
							storyClockMonth: c.month ?? null,
							storyClockDay: c.day ?? null,
							storyClockHour: c.hour ?? null,
							storyClockMinute: c.minute ?? null
						}
					: {})
			})
		}
		const fromApplet =
			prefill?.fromApplet && flow.genreId === prefill.genreId
				? { fromApplet: { pluginId: prefill.fromApplet } }
				: {}
		const releaseOk = requestWithInterest(
			"sessions:create",
			{ ...payload, ...fromApplet },
			handleCreated
		)
		releaseCreateInterest = () => {
			releaseOk()
			releaseError()
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return
		e.stopPropagation()
		onCancel()
	}

	onDestroy(() => {
		releaseCreateInterest?.()
		releaseCreateInterest = null
		releaseLorebookCreate?.()
		releaseLorebookCreate = null
		releasePersonaCreate?.()
		releasePersonaCreate = null
	})
</script>

<!-- Escape closes the screen from anywhere inside it, and stops there rather
     than reaching the shell, so a person with focus in the cast list leaves
     this form and not the view behind it. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex min-h-full w-full max-w-[760px] flex-col gap-3"
	onkeydown={handleKeydown}
>
	<PanelNavHeader
		title="Start a session"
		onBack={showBack ? onCancel : undefined}
		backLabel="Back"
	>
		{#snippet primaryAction()}
			{#if !confirmOnly}
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 shrink-0"
					disabled={!canStart}
					aria-describedby={startReason
						? "start-session-reason"
						: undefined}
					onclick={start}
				>
					{#if creating}
						<Icons.Loader2
							size={16}
							class="animate-spin"
							aria-hidden="true"
						/>
					{:else}
						<Icons.Play size={16} aria-hidden="true" />
					{/if}
					Start
				</button>
			{/if}
		{/snippet}
		{#snippet subtitle()}
			{#if startReason}
				<p
					id="start-session-reason"
					class="text-surface-600-400 text-right text-xs"
					role="status"
				>
					{startReason}
				</p>
			{/if}
			{#if personaError && flow.personaDraft}
				<p class="text-error-600-400 text-right text-xs" role="alert">
					Could not make your persona: {personaError}
				</p>
			{/if}
		{/snippet}
	</PanelNavHeader>

	{#if confirmOnly}
		<section class="{CARD_CLASS} flex flex-col gap-2" data-applet-confirm>
			<p class="text-lead font-medium">
				Start {flow.genre?.name ?? "a session"}
			</p>
			{#if confirmFields.length}
				<ul
					class="text-sm"
					aria-label="What {flow.genre?.name ?? 'it'} starts with"
				>
					{#each confirmFields as field (field.key)}
						<li data-applet-field={field.key}>
							<span class="text-surface-600-400">
								{field.label}:
							</span>
							{field.value}
						</li>
					{/each}
				</ul>
			{/if}
			{#if confirmFacts.length}
				<ul class="text-surface-600-400 text-sm">
					{#each confirmFacts as fact (fact)}
						<li>{fact}</li>
					{/each}
				</ul>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					disabled={!canStart}
					onclick={start}
				>
					{#if creating}
						<Icons.Loader2
							size={16}
							class="animate-spin"
							aria-hidden="true"
						/>
					{:else}
						<Icons.Play size={16} aria-hidden="true" />
					{/if}
					Start {flow.genre?.name ?? ""}
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => (changeOpen = true)}
				>
					Change…
				</button>
			</div>
		</section>
	{:else}
		<div class="flex flex-col gap-3">
			<!-- ── 1. Name ───────────────────────────────────────────────────
		     First: the one thing most people type (polish parity L11). What
		     an empty name becomes is the placeholder, and the title says it. -->
			{#if flow.mode !== "branch"}
				<section class="{CARD_CLASS} flex flex-col gap-1.5">
					<label class="text-sm font-medium" for="start-session-name">
						Name
					</label>
					<input
						id="start-session-name"
						type="text"
						class="input rounded-base"
						placeholder={placeholderName}
						title="Optional. Leave it empty and the session is called “{placeholderName}”."
						bind:value={flow.fields.name}
						onbeforeinput={touch}
					/>
				</section>
			{/if}

			<!-- ── 2. Genre ──────────────────────────────────────────────────
		     A radio list (polish parity L11): one row per genre, its name and
		     one line; only the chosen row unfolds its meta line and More.
		     Selection is the row's tonal ground and 3px bar, never a fill.
		     The list stays on screen, so a genre answered (by the person, the
		     prefill, a star or the admin's default) settles the step. -->
			<section class={CARD_CLASS} aria-labelledby="start-genre-heading">
				<h3 id="start-genre-heading" class="text-sm font-medium">
					Genre
				</h3>
				{#if genreIsAChoice}
					<div
						class="mt-2 flex flex-col gap-1"
						role="radiogroup"
						aria-labelledby="start-genre-heading"
					>
						{#each genreOptions as g (g.genreId)}
							{@const selected = g.genreId === flow.genreId}
							{@const starred = favourites?.genre === g.genreId}
							{@const facts = genreFacts(g.shape)}
							<div
								class="rounded-base py-2 pr-1 pl-2.5 {selected
									? 'sidebar-row-active'
									: 'hover:bg-surface-200-800'}"
								data-genre-card={g.genreId}
							>
								<div class="flex items-start gap-1">
									<button
										type="button"
										role="radio"
										aria-checked={selected}
										class="flex min-w-0 flex-1 items-start gap-2.5 text-left"
										onclick={() => chooseGenre(g.genreId)}
									>
										<span
											class="border-surface-400-600 mt-1 grid size-4 shrink-0 place-items-center rounded-full border"
											aria-hidden="true"
										>
											{#if selected}
												<span
													class="bg-surface-950-50 size-2 rounded-full"
												></span>
											{/if}
										</span>
										<span
											class="flex min-w-0 flex-1 flex-col"
										>
											<span class="text-lead font-medium">
												{g.name}
											</span>
											{#if g.description}
												<span
													class="text-surface-600-400 text-chip {selected
														? ''
														: 'truncate'}"
												>
													{g.description}
												</span>
											{/if}
										</span>
									</button>
									<button
										type="button"
										class="btn-icon btn-icon-sm shrink-0 {starred
											? 'text-warning-500'
											: 'text-surface-500 hover:text-warning-500'}"
										aria-pressed={starred}
										aria-label={starred
											? `Unstar ${g.name}`
											: `Star ${g.name} as your usual start`}
										title={starred
											? "Your usual start"
											: "Star as your usual start"}
										onclick={() => starGenre(g.genreId)}
									>
										<Icons.Star
											size={14}
											fill={starred
												? "currentColor"
												: "none"}
											aria-hidden="true"
										/>
									</button>
								</div>
								{#if appletLauncher(g) && !prefill?.fromApplet && !genericForm}
									<p
										class="text-surface-600-400 mt-1 pl-[26px] text-xs"
									>
										Opens its own app.
										<button
											type="button"
											class="anchor"
											data-use-start-form={g.genreId}
											onclick={() =>
												useStartForm(g.genreId)}
										>
											Use the start form
										</button>
									</p>
								{/if}
								{#if selected && (facts || g.about)}
									<p
										class="text-surface-600-400 mt-1 pl-[26px] text-xs"
										data-genre-meta={g.genreId}
									>
										{facts}{#if g.about}{facts ? " · " : ""}
											<button
												type="button"
												class="anchor"
												aria-expanded={aboutOpen ===
													g.genreId}
												onclick={() =>
													(aboutOpen =
														aboutOpen === g.genreId
															? null
															: g.genreId)}
											>
												{aboutOpen === g.genreId
													? "Less"
													: "More"}
											</button>{/if}
									</p>
									{#if g.about && aboutOpen === g.genreId}
										<p
											class="text-surface-600-400 mt-1 pl-[26px] text-xs whitespace-pre-line"
											data-genre-about={g.genreId}
										>
											{g.about}
										</p>
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-chip mt-1">
						{flow.genre?.name ?? "Loading…"}
					</p>
				{/if}
			</section>

			<!-- ── 1b. How it starts ──────────────────────────────────────────
		     The four creation modes, one line each; the genre may suggest
		     one, never lock it. -->
			<CreationModePicker
				cardClass={CARD_CLASS}
				mode={flow.mode}
				proposed={flow.proposedMode}
				genreName={flow.genre?.name ?? "this genre"}
				genreId={flow.genreId}
				from={flow.from}
				{sessions}
				onmode={(m) => {
					touch()
					flow.chooseMode(m)
				}}
				onfrom={(id) => {
					touch()
					flow.from = id
				}}
			/>

			<!-- ── 3. Preset ─────────────────────────────────────────────────
		     A row with its value and Change (polish parity L11); the chooser
		     opens on Change, or by itself while nothing is chosen. -->
			{#if flow.mode !== "branch" && showPreset}
				<section
					class={CARD_CLASS}
					aria-labelledby="start-preset-heading"
				>
					{#if flow.noPresetsForGenre}
						<h3
							id="start-preset-heading"
							class="text-sm font-medium"
						>
							Preset
						</h3>
						<p
							class="preset-tonal-warning rounded-base text-chip mt-2 p-3"
							role="status"
						>
							No preset is available for this genre. An
							administrator decides which presets a session may
							start from.
							{#if isAdmin}
								<a
									class="anchor mt-1 block"
									href="/admin/session-presets"
								>
									Open Admin › Play › Presets
								</a>
							{/if}
						</p>
					{:else if expandedPreset}
						<h3
							id="start-preset-heading"
							class="text-sm font-medium"
						>
							Preset
						</h3>
						<p class="text-surface-600-400 mt-1 text-xs">
							A starting recipe for this genre: the settings and
							actions the session begins with. The default is
							fine.
						</p>
						<div
							class="mt-3 grid grid-cols-1 gap-2 @lg/view:grid-cols-2"
							role="radiogroup"
							aria-labelledby="start-preset-heading"
						>
							{#each presetOptions as p (p.id)}
								{@const selected = p.id === flow.presetId}
								{@const starred =
									favourites?.presetByGenre?.[
										flow.genreId ?? ""
									] === p.id}
								{@const calls =
									p.derived?.callsPerTurn ?? p.callsPerTurn}
								<div
									class="border-surface-200-800 rounded-base flex items-start gap-2 border p-3 {selected
										? 'sidebar-row-active'
										: ''}"
									data-preset-card={p.id}
								>
									<button
										type="button"
										role="radio"
										aria-checked={selected}
										class="hover:bg-surface-200-800 -m-1 flex min-w-0 flex-1 flex-col items-start gap-1 rounded-lg p-1 text-left"
										onclick={() => choosePreset(p.id)}
									>
										<span class="text-lead font-medium">
											{p.name}
										</span>
										{#if p.description}
											<span
												class="text-surface-600 dark:text-surface-400 line-clamp-2 text-xs"
											>
												{p.description}
											</span>
										{/if}
										<span
											class="text-surface-600-400 text-meta"
											data-preset-numbers
										>
											<!-- Derived from what the preset registers (lane 5b), never typed. -->
											{#if typeof calls === "number"}
												{calls === 0
													? "No model call per turn"
													: calls === 1
														? "1 call per turn"
														: `${calls} calls per turn`}
											{/if}
											{#if p.castFloor && (p.castFloor.characters === 0 || p.castFloor.personas === 0)}
												{typeof calls === "number"
													? " · "
													: ""}Nobody required
											{/if}
											{#if p.isDefault}
												{typeof calls === "number" ||
												p.castFloor
													? " · "
													: ""}Default
											{/if}
										</span>
										{#if p.recommendations?.words}
											<!-- 🚧 R56: what its registrations need, and what would make it better. -->
											<span
												class="text-surface-600-400 text-meta"
												data-preset-recommendations
											>
												{p.recommendations.words}
											</span>
										{/if}
										{#if p.recommendations?.unserved?.length}
											<span
												class="text-warning-700-300 text-meta"
												data-preset-unserved
											>
												{p.recommendations
													.unservedWords}
											</span>
										{/if}
									</button>
									<button
										type="button"
										class="btn-icon btn-icon-sm shrink-0 {starred
											? 'text-warning-500'
											: 'text-surface-500 hover:text-warning-500'}"
										aria-pressed={starred}
										aria-label={starred
											? `Unstar ${p.name}`
											: `Star ${p.name} as your usual preset`}
										title={starred
											? "Your usual preset"
											: "Star as your usual preset"}
										onclick={() =>
											flow.genreId &&
											starPreset(flow.genreId, p.id)}
									>
										<Icons.Star
											size={16}
											fill={starred
												? "currentColor"
												: "none"}
											aria-hidden="true"
										/>
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<div class="flex min-w-0 items-center gap-2">
							<div class="flex min-w-0 flex-1 flex-col">
								<h3
									id="start-preset-heading"
									class="text-surface-600-400 text-xs"
								>
									Preset
								</h3>
								<p class="truncate text-sm" data-preset-chosen>
									{flow.preset?.name ?? "Loading…"}
								</p>
							</div>
							{#if presetIsAChoice}
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface shrink-0"
									aria-label="Change preset"
									onclick={() => reopen("preset")}
								>
									Change
								</button>
							{/if}
						</div>
						{#if flow.preset?.recommendations?.unserved?.length}
							<p class="text-warning-700-300 text-meta mt-1">
								{flow.preset.recommendations.unservedWords}
							</p>
						{/if}
					{/if}
				</section>
			{/if}

			<!-- ── 2b. What the preset asks (R32, A10; lane 7) ─────────────────
		     Under the chosen preset: the genre's settings it marks
		     `askAtStart`, and those fixed at start. A fixed one says it
		     cannot change later. The rules have their own card below. -->
			{#if flow.mode !== "branch" && genreAnswered && presetAnswered && flow.genreAsks.length}
				<section
					class={CARD_CLASS}
					aria-labelledby="start-asks-heading"
					data-testid="start-asks"
				>
					<h3 id="start-asks-heading" class="text-sm font-medium">
						Before you start
					</h3>
					<p class="text-surface-600-400 mt-1 text-xs">
						{flow.preset?.name ?? "This preset"} asks for these. Most
						can be changed later in the session's settings.
					</p>
					<div class="mt-3 flex flex-col gap-4">
						{#each flow.genreAsks as ask (ask.key)}
							<StartAskField
								{ask}
								value={flow.askAnswers[ask.key]}
								onchange={(v) => flow.setAsk(ask.key, v)}
							/>
						{/each}
					</div>
				</section>
			{/if}

			<!-- ── 3. Who is in it ──────────────────────────────────────────── -->
			{#if flow.mode !== "branch" && showCast}
				<section
					class={CARD_CLASS}
					aria-labelledby="start-cast-heading"
				>
					<div class="flex min-w-0 items-baseline gap-2">
						<h3
							id="start-cast-heading"
							class="flex-1 text-sm font-medium"
						>
							Who is in it
						</h3>
						{#if !expandedCast}
							<button
								type="button"
								class="text-surface-600 hover:text-foreground dark:text-surface-400 dark:hover:text-surface-200 text-chip shrink-0 underline-offset-2 hover:underline"
								onclick={() => reopen("cast")}
							>
								Change
							</button>
						{/if}
					</div>
					{#if expandedCast}
						{#if flow.floors.characters > 0 || (flow.shape?.characters?.max ?? 1) !== 0}
							<div class="mt-3 flex flex-col gap-2">
								<p class="text-surface-600-400 text-xs">
									Characters{characterCountHint
										? ` — ${characterCountHint}`
										: ""}
								</p>
								{#if selectedCharacters.length + selectedMembers.length > 0}
									<ul
										class="flex flex-col gap-1"
										aria-label="Characters"
									>
										{#each selectedCharacters as c, i (c.id)}
											{@const label = characterName(c)}
											<li>
												<CharacterPickRow
													character={c}
													kind="chosen"
												>
													{#snippet actions()}
														{#if selectedCharacters.length > 1}
															<button
																type="button"
																class={ICON_BUTTON}
																data-cast-move="{c.id}:up"
																aria-label="Move {label} up"
																disabled={i ===
																	0}
																onclick={() =>
																	moveCharacter(
																		c.id,
																		-1
																	)}
															>
																<Icons.ChevronUp
																	size={16}
																	aria-hidden="true"
																/>
															</button>
															<button
																type="button"
																class={ICON_BUTTON}
																data-cast-move="{c.id}:down"
																aria-label="Move {label} down"
																disabled={i ===
																	selectedCharacters.length -
																		1}
																onclick={() =>
																	moveCharacter(
																		c.id,
																		1
																	)}
															>
																<Icons.ChevronDown
																	size={16}
																	aria-hidden="true"
																/>
															</button>
														{/if}
														<button
															type="button"
															class="{ICON_BUTTON} hover:text-error-600-400"
															aria-label="Remove {label}"
															onclick={() =>
																removeCharacter(
																	c.id
																)}
														>
															<Icons.X
																size={16}
																aria-hidden="true"
															/>
														</button>
													{/snippet}
												</CharacterPickRow>
											</li>
										{/each}
										{#each selectedMembers as m (`member:${m.id}`)}
											<li>
												<CharacterPickRow
													character={{
														id: m.id,
														name: m.name,
														avatarMediaId:
															m.faceMediaId ??
															null
													}}
													kind="chosen"
												>
													{#snippet actions()}
														<button
															type="button"
															class="{ICON_BUTTON} hover:text-error-600-400"
															aria-label="Remove {m.name}"
															onclick={() =>
																removeMember(
																	m.id
																)}
														>
															<Icons.X
																size={16}
																aria-hidden="true"
															/>
														</button>
													{/snippet}
												</CharacterPickRow>
											</li>
										{/each}
									</ul>
								{:else if !addCharactersBlocked}
									<p class="text-surface-600-400 text-chip">
										<!-- 🚧 The genre's own words when it has
									     them (`shape.characters.hint`): the
									     Dungeon Crawler's join as companions. -->
										{charactersHint ??
											"No one yet. Add the characters you'll talk to."}
									</p>
								{/if}
								<div
									class="flex flex-wrap items-center gap-x-3 gap-y-1"
								>
									<button
										bind:this={addCharactersButton}
										type="button"
										class="btn btn-sm preset-tonal-surface"
										disabled={!!addCharactersBlocked}
										aria-describedby={addCharactersBlocked
											? "start-cast-add-blocked"
											: undefined}
										onclick={() => (castPickerOpen = true)}
									>
										<Icons.Plus
											size={16}
											aria-hidden="true"
										/>
										Add characters
									</button>
									{#if addCharactersBlocked}
										<p
											id="start-cast-add-blocked"
											class="text-surface-600-400 text-xs"
										>
											{addCharactersBlocked}
										</p>
									{/if}
								</div>
							</div>
						{/if}

						{#if (flow.shape?.personas?.max ?? 1) !== 0}
							<div class="mt-4 flex flex-col gap-2">
								<p class="text-surface-600-400 text-xs">
									Who you play as{flow.floors.personas > 0
										? " — pick one"
										: " — optional"}
								</p>
								{#if personaRows.length > 0}
									<ul
										class="flex flex-col gap-1"
										aria-label="Who you play as"
									>
										{#each personaRows as p (p.id)}
											<li>
												<CharacterPickRow
													character={p}
													kind="chosen"
												>
													{#snippet actions()}
														{#if flow.personaDraft}
															<span
																class="text-surface-600-400 text-meta"
															>
																New, from the
																game
															</span>
														{/if}
														<button
															type="button"
															class="btn btn-sm preset-tonal-surface"
															aria-label="Change who you play as"
															onclick={() =>
																(playAsPickerOpen = true)}
														>
															Change
														</button>
														{#if flow.floors.personas === 0}
															<button
																type="button"
																class="{ICON_BUTTON} hover:text-error-600-400"
																aria-label="Remove {p.name ||
																	'persona'}"
																title="Play without a persona"
																onclick={removePersona}
															>
																<Icons.X
																	size={16}
																	aria-hidden="true"
																/>
															</button>
														{/if}
													{/snippet}
												</CharacterPickRow>
											</li>
										{/each}
									</ul>
								{:else}
									<div
										class="flex flex-wrap items-center gap-x-3 gap-y-1"
									>
										<button
											bind:this={choosePlayAsButton}
											type="button"
											class="btn btn-sm preset-tonal-surface"
											disabled={!!playAsBlocked}
											aria-describedby={playAsBlocked
												? "start-play-as-blocked"
												: undefined}
											onclick={() =>
												(playAsPickerOpen = true)}
										>
											<Icons.UserRound
												size={16}
												aria-hidden="true"
											/>
											Choose who you play as
										</button>
										{#if playAsBlocked}
											<p
												id="start-play-as-blocked"
												class="text-surface-600-400 text-xs"
											>
												{playAsBlocked}
											</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					{:else}
						<p class="text-chip mt-1 truncate">{castSummary}</p>
					{/if}
				</section>
			{/if}

			{#snippet surfacedStartChoice(bookId: number)}
				{#if ownSurfacedChosen?.id === bookId}
					<div class="mt-1 mb-1 ml-9" data-surfaced-start>
						<p
							id="start-surfaced-start-heading-{bookId}"
							class="text-surface-600-400 text-chip font-medium"
						>
							How it starts
						</p>
						<ul
							class="mt-1 flex flex-col gap-1"
							role="radiogroup"
							aria-labelledby="start-surfaced-start-heading-{bookId}"
						>
							{#each SURFACED_STARTS as opt (opt.id)}
								{@const on = surfacedStart === opt.id}
								<li>
									<button
										type="button"
										role="radio"
										aria-checked={on}
										data-start={opt.id}
										class="hover:bg-surface-200-800 rounded-base flex min-h-11 w-full items-center gap-2.5 px-2 py-1.5 text-left {on
											? 'sidebar-row-active'
											: ''}"
										onclick={() => {
											touch()
											surfacedStart = opt.id
										}}
									>
										<span class="min-w-0 flex-1">
											<span
												class="text-lead block truncate font-medium"
											>
												{opt.name}
											</span>
											<span
												class="text-surface-600-400 block truncate text-xs"
											>
												{opt.line}
											</span>
										</span>
										{#if on}
											<Icons.Check
												size={16}
												class="text-primary-500 shrink-0"
												aria-hidden="true"
											/>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
						{#if surfacedStart === "branch-off"}
							<SessionLorebookReading
								lorebookId={bookId}
								bind:branchId={surfacedBranchId}
								bind:clock={surfacedClock}
							/>
						{/if}
					</div>
				{/if}
			{/snippet}

			<!-- 🚧 (c-3, 2026-11-10) the people's shared books, one group per person; copy only. -->
			{#snippet surfacedBooksGroup(prefix: string)}
				{#if sharedBookGroups.length > 0}
					<div data-surfaced-books>
						{#each sharedBookGroups as g, i (g.heading)}
							<div
								data-book-group="shared"
								data-book-group-label={g.label}
							>
								<p
									id="{prefix}-shared-heading-{i}"
									class="text-chip mt-4 font-medium"
								>
									{g.heading}
								</p>
								<p class="text-surface-600-400 mt-1 text-xs">
									Their session's lorebook. The new session
									starts on a copy; theirs stays as it is.
								</p>
								<ul
									class="mt-2 flex flex-col gap-1"
									role="radiogroup"
									aria-labelledby="{prefix}-shared-heading-{i}"
								>
									{#each g.rows as l (l.id)}
										{@const selected =
											flow.mode === "new-world" &&
											flow.fields.lorebookId === l.id}
										<li>
											<button
												type="button"
												role="radio"
												aria-checked={selected}
												data-book-row={l.id}
												class="hover:bg-surface-200-800 rounded-base flex min-h-11 w-full items-center gap-2.5 px-2 py-1.5 text-left {selected
													? 'sidebar-row-active'
													: ''}"
												onclick={() =>
													chooseSurfacedBook(l.id)}
											>
												<Icons.BookMarked
													size={20}
													class="text-surface-500 shrink-0"
													aria-hidden="true"
												/>
												<span class="min-w-0 flex-1">
													<span
														class="text-lead block truncate font-medium"
														data-book-name
													>
														{l.name ||
															"Untitled lorebook"}
													</span>
												</span>
												{#if selected}
													<Icons.Check
														size={16}
														class="text-primary-500 shrink-0"
														aria-hidden="true"
													/>
												{/if}
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{/each}
					</div>
				{/if}
			{/snippet}

			<!-- ── 4. Lorebook and rules — the book pick (owner, 2026-11-05: one
		     choice). A genre with a lorebook step AND a rules offer: the person's
		     lorebooks, a blank start on each rules choice, the starter lorebooks;
		     each row says how well its rules fit. How strict is its own card
		     after it. Without both, today's two cards stand (below). -->
			{#if bookPickShown && rulesOffer}
				{@const offer = rulesOffer}
				{#snippet rulesRows(
					labelledby: string,
					unfold: boolean,
					chosen: (id: string) => boolean,
					onpick: (id: string) => void
				)}
					<div
						class="mt-2 flex flex-col gap-2"
						role="radiogroup"
						aria-labelledby={labelledby}
					>
						{#each rulesBands as band (band.group)}
							{#if band.label}
								<p
									class="text-surface-600-400 text-meta font-semibold tracking-wide uppercase"
									data-rules-band={band.group}
								>
									{band.label}
								</p>
							{/if}
							<ul class="flex flex-col gap-1">
								{#each band.choices as r (r.id)}
									{@const selected = chosen(r.id)}
									{@const incompatible =
										r.fit?.rating === "incompatible"}
									<li class="flex items-center gap-1">
										<button
											type="button"
											role="radio"
											aria-checked={selected}
											aria-disabled={incompatible}
											disabled={incompatible}
											{...unfold
												? {
														"data-book-rules-choice":
															r.id
													}
												: { "data-rules-choice": r.id }}
											data-rules-rating={r.fit?.rating ??
												""}
											class="hover:bg-surface-200-800 rounded-base flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50 {selected
												? 'sidebar-row-active'
												: ''}"
											onclick={() => onpick(r.id)}
										>
											<span class="min-w-0 flex-1">
												<span
													class="text-lead flex items-center gap-1.5 font-medium"
												>
													<span class="truncate">
														{r.name}
													</span>
													{#if r.recommended}
														<Icons.Star
															size={14}
															class="text-warning-500 shrink-0"
															aria-label="Recommended for this genre"
														/>
													{/if}
													{#if r.fit}
														<span
															class="text-surface-600-400 shrink-0 text-xs font-normal"
														>
															{RATING_WORD[
																r.fit.rating
															]}
														</span>
													{/if}
												</span>
												{#if r.fit && r.fit.rating !== "perfect" && r.fit.rating !== "great"}
													<span
														class="text-surface-600-400 line-clamp-2 block text-xs"
													>
														{r.fit.reason}
													</span>
												{:else if r.subtitle}
													<span
														class="text-surface-600-400 line-clamp-2 block text-xs"
													>
														{r.subtitle}
													</span>
												{/if}
											</span>
											{#if selected}
												<Icons.Check
													size={16}
													class="text-primary-500 shrink-0"
													aria-hidden="true"
												/>
											{/if}
										</button>
										{#if isAdmin && r.fit}
											<button
												type="button"
												class="anchor shrink-0 text-xs"
												data-rules-audit={r.id}
												onclick={() =>
													(auditChoice = r)}
											>
												Why?
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						{/each}
					</div>
				{/snippet}
				{#snippet kitUnder(kit: Sockets.StarterKits.Card)}
					<!-- A starter lorebook on Freeform brings no rules: the choice opens under it, as under a book. -->
					{#if bookRulesFit(offer, kit.rulesId, flow.genre?.name).rulesId === null}
						<div class="mt-1 mb-1 ml-9" data-book-rules-under>
							<p
								id="start-kit-play-heading"
								class="text-chip font-medium"
							>
								Play it with
							</p>
							{@render rulesRows(
								"start-kit-play-heading",
								true,
								(id) => rulesNow?.value === id,
								chooseRules
							)}
						</div>
					{/if}
				{/snippet}
				<!-- 🚧 (c-3, 2026-11-10) one own/plugin book row of the book pick, identical in every group. -->
				{#snippet bookPickRow(l: LorebookOption)}
					{@const selected = flow.fields.lorebookId === l.id}
					{@const fit = bookRulesFit(
						offer,
						l.primaryRuleset,
						flow.genre?.name
					)}
					<li>
						<button
							type="button"
							role="radio"
							aria-checked={selected}
							aria-disabled={!!fit.refusal}
							disabled={!!fit.refusal}
							data-book-row={l.id}
							class="hover:bg-surface-200-800 rounded-base flex min-h-11 w-full items-center gap-2.5 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50 {selected
								? 'sidebar-row-active'
								: ''}"
							onclick={() => chooseLorebook(l.id)}
						>
							<Icons.BookMarked
								size={20}
								class="text-surface-500 shrink-0"
								aria-hidden="true"
							/>
							<span class="min-w-0 flex-1">
								<span
									class="text-lead block truncate font-medium"
									data-book-name
								>
									{l.name || "Untitled lorebook"}
								</span>
								<span
									class="text-surface-600-400 flex items-center gap-1.5 text-xs"
									data-book-rules-line
								>
									{#if fit.refusal}
										<span class="min-w-0 truncate">
											{fit.refusal}
										</span>
									{:else if fit.rulesId === null}
										<span class="min-w-0 truncate">
											Freeform: brings no rules of its own
										</span>
									{:else if fit.choice}
										<span class="min-w-0 truncate">
											Rules: {fit.choice.name}
										</span>
										{#if fit.choice.recommended}
											<Icons.Star
												size={12}
												class="text-warning-500 shrink-0"
												aria-label="Recommended for this genre"
											/>
										{/if}
										{#if fit.choice.fit}
											<span class="shrink-0">
												· {RATING_WORD[
													fit.choice.fit.rating
												]}
											</span>
										{/if}
									{:else}
										<span class="min-w-0 truncate">
											Rules of its own
										</span>
									{/if}
								</span>
								{#if fit.choice?.fit && fit.choice.fit.rating !== "perfect" && fit.choice.fit.rating !== "great"}
									<span
										class="text-surface-600-400 line-clamp-2 block text-xs"
									>
										{fit.choice.fit.reason}
									</span>
								{/if}
							</span>
							{#if selected}
								<Icons.Check
									size={16}
									class="text-primary-500 shrink-0"
									aria-hidden="true"
								/>
							{/if}
						</button>
						{#if advanced && selected && fit.rulesId === null}
							<!-- A book on Freeform brings no rules: the choice opens under it (fix7). -->
							<div class="mt-1 mb-1 ml-9" data-book-rules-under>
								<p
									id="start-book-play-heading-{l.id}"
									class="text-chip font-medium"
								>
									Play it with
								</p>
								{@render rulesRows(
									`start-book-play-heading-${l.id}`,
									true,
									(id) => rulesNow?.value === id,
									chooseRules
								)}
							</div>
						{/if}
						{@render surfacedStartChoice(l.id)}
					</li>
				{/snippet}

				<section
					class={CARD_CLASS}
					aria-labelledby="start-book-pick-heading"
					data-book-pick
				>
					<h3
						id="start-book-pick-heading"
						class="text-sm font-medium"
					>
						Lorebook and rules
					</h3>
					<p class="text-surface-600-400 mt-1 text-xs">
						The world the session reads, and the rules it plays by.
					</p>
					{#if flow.mode === "new-world"}
						<p class="text-surface-600-400 mt-1 text-xs">
							This story starts on a copy of the lorebook you
							choose; the original stays as it is.
						</p>
					{/if}
					{#if flow.rulesFixed}
						<p
							class="text-surface-600-400 mt-1 text-xs"
							data-testid="start-rules-fixed"
						>
							The rules can't be changed after the session starts.
						</p>
					{/if}
					{#if offer.playsBestWith}
						<!-- 🚧 RF fix 8: what the genre plays best with — a recommendation, never a lock. -->
						<p
							class="text-surface-600-400 mt-1 text-xs"
							data-rules-plays-best-with
						>
							{offer.playsBestWith}
						</p>
					{/if}

					{#if lorebookOptions.length === 0}
						<!-- Never required (RF fix 2, 2026-10-23): the session's own
					     book is its world until one is chosen. -->
						<p
							class="text-surface-600-400 text-chip mt-3"
							role="status"
						>
							You have no lorebooks of your own yet. The session
							can keep its world in its own notes.
						</p>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface mt-2"
							onclick={() => (newLorebookOpen = true)}
						>
							<Icons.Plus size={16} aria-hidden="true" />
							Create a lorebook
						</button>
					{:else}
						{#if ownBookOptions.length > 0}
							<p
								id="start-book-own-heading"
								class="text-chip mt-3 font-medium"
							>
								Your lorebooks
							</p>
							<ul
								class="mt-2 flex flex-col gap-1"
								role="radiogroup"
								aria-labelledby="start-book-own-heading"
							>
								{#each ownBookOptions as l (l.id)}
									{@render bookPickRow(l)}
								{/each}
							</ul>
						{/if}
						{#each pluginBookGroups as g, i (g.heading)}
							<div
								data-book-group="plugin"
								data-book-group-label={g.label}
							>
								<p
									id="start-book-plugin-heading-{i}"
									class="text-chip mt-4 font-medium"
								>
									{g.heading}
								</p>
								<ul
									class="mt-2 flex flex-col gap-1"
									role="radiogroup"
									aria-labelledby="start-book-plugin-heading-{i}"
								>
									{#each g.rows as l (l.id)}
										{@render bookPickRow(l)}
									{/each}
								</ul>
							</div>
						{/each}
					{/if}
					<!-- Other people's books show even when the asker has none of
					     their own (lead, 2026-11-10). -->
					{@render surfacedBooksGroup("start-book")}

					{#if advanced && flow.mode !== "new-world"}
						<p
							id="start-book-blank-heading"
							class="text-chip mt-4 font-medium"
						>
							Start blank
						</p>
						<p class="text-surface-600-400 mt-1 text-xs">
							No lorebook: the session keeps its world in its own
							notes.
						</p>
						{@render rulesRows(
							"start-book-blank-heading",
							false,
							(id) => noLorebookChosen && rulesNow?.value === id,
							pickBlankRules
						)}
					{/if}

					{#if kits?.length}
						<!-- 🚧 A third way beside the books: the session keeps
					     the kit in its own notes (PLAN-lorebook-kinds 8). -->
						<p
							id="start-kit-heading"
							class="text-chip mt-4 font-medium"
						>
							Start from a starter lorebook
						</p>
						<div class="mt-2">
							<StarterKitPicker
								bind:value={kitCardId}
								{kits}
								labelledby="start-kit-heading"
								onpick={chooseKit}
								rulesLine={kitRulesLine}
								under={advanced ? kitUnder : undefined}
							/>
						</div>
						{#if chosenKit}
							<p
								class="text-surface-600-400 mt-2 text-xs"
								data-start-kit-note
							>
								{KIT_SESSION_NOTE}
							</p>
						{/if}
					{/if}
					{#if advanced && offer.choices.find((c) => c.id === rulesNow?.value)?.fit?.inWords?.length}
						<!-- 🚧 RF fix 8: the rules in force lack some of it — each told in words, and why. -->
						<ul
							class="text-surface-600-400 mt-3 flex flex-col gap-0.5 text-xs"
							data-rules-in-words
						>
							{#each offer.choices.find((c) => c.id === rulesNow?.value)?.fit?.inWords ?? [] as w (w.label)}
								<!-- prettier-ignore -->
								<li>
									<span class="font-medium">{w.label[0]?.toUpperCase()}{w.label.slice(1)}</span>: {w.why}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				{#if advanced && (presetRigourUnplayed || howStrictShown)}
					<!-- How strict is the session's, never the book's: its own card after the pick. -->
					<section
						class={CARD_CLASS}
						aria-labelledby="start-how-strict-heading"
					>
						<h3
							id="start-how-strict-heading"
							class="text-sm font-medium"
						>
							How strict
						</h3>
						{#if presetRigourUnplayed}
							<p
								class="text-surface-600-400 mt-1 text-xs"
								data-testid="start-rules-preset-hint"
							>
								{offer.choices.find(
									(c) => c.id === rulesNow?.value
								)?.name ?? "These rules"} keeps no numbers, so {flow
									.preset?.name ?? "this preset"} runs in words
								here.{#if !rulesAdoptedLine}{" "}Pick rules with
									numbers for them to decide.{/if}
							</p>
						{/if}
						{#if howStrictShown}
							<div
								class="mt-2 flex flex-wrap gap-2"
								role="radiogroup"
								aria-labelledby="start-how-strict-heading"
							>
								{#each howStrictChoices(offer, rulesNow?.value) as o (o.id)}
									{@const selected = flow.rigour === o.id}
									<button
										type="button"
										role="radio"
										aria-checked={selected}
										data-how-strict={o.id}
										class="btn btn-sm min-h-11 {selected
											? 'preset-pressed'
											: 'preset-tonal-surface'}"
										onclick={() => chooseHowStrict(o.id)}
									>
										{o.label}
									</button>
								{/each}
							</div>
						{/if}
					</section>
				{/if}
				{#if !advanced && presetRigourUnplayed}
					<p
						class="text-surface-600-400 px-1 text-xs"
						data-testid="start-rules-preset-hint"
					>
						{offer.choices.find((c) => c.id === rulesNow?.value)?.name ??
							"These rules"} keeps no numbers, so {flow.preset?.name ??
							"this preset"} runs in words here.{#if !rulesAdoptedLine}{" "}Pick
							rules with numbers for them to decide.{/if}
					</p>
				{/if}
				{#if !advanced && bookPickHides}
					<AdvancedHiddenLine class="px-1" />
				{/if}
			{/if}

			<!-- 🚧 (c-3, 2026-11-10) one book row of the plain Lorebook card, identical in every group. -->
			{#snippet plainBookRow(l: LorebookOption)}
				{@const selected = flow.fields.lorebookId === l.id}
				<li>
					<button
						type="button"
						role="radio"
						aria-checked={selected}
						data-book-row={l.id}
						class="hover:bg-surface-200-800 rounded-base flex min-h-11 w-full items-center gap-2.5 px-2 py-1.5 text-left {selected
							? 'sidebar-row-active'
							: ''}"
						onclick={() => chooseLorebook(l.id)}
					>
						<Icons.BookMarked
							size={20}
							class="text-surface-500 shrink-0"
							aria-hidden="true"
						/>
						<span
							class="text-lead min-w-0 flex-1 truncate font-medium"
						>
							{l.name || "Untitled lorebook"}
						</span>
						{#if selected}
							<Icons.Check
								size={16}
								class="text-primary-500 shrink-0"
								aria-hidden="true"
							/>
						{/if}
					</button>
					{@render surfacedStartChoice(l.id)}
				</li>
			{/snippet}

			<!-- ── 4. Lorebook (no rules offer: Chat, Guide) ────────────────── -->
			{#if flow.mode !== "branch" && flow.mode !== "next-chapter" && showLorebook && !bookPickShown}
				<section
					class={CARD_CLASS}
					aria-labelledby="start-lorebook-heading"
				>
					<h3 id="start-lorebook-heading" class="text-sm font-medium">
						Lorebook
					</h3>
					<p
						class="text-surface-600 dark:text-surface-400 mt-1 text-xs"
					>
						The session will use world lore, character lore and
						history entries from this lorebook.
					</p>
					{#if flow.mode === "new-world"}
						<p class="text-surface-600-400 mt-1 text-xs">
							This story starts on a copy of the lorebook you
							choose; the original stays as it is.
						</p>
					{/if}
					{#if lorebookOptions.length === 0}
						<!-- Never required (RF fix 2, 2026-10-23): the session's own
					     book is its world until one is chosen. -->
						<p
							class="text-surface-600-400 text-chip mt-3"
							role="status"
						>
							You have no lorebooks of your own yet. The session
							can keep its world in its own notes.
						</p>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface mt-2"
							onclick={() => (newLorebookOpen = true)}
						>
							<Icons.Plus size={16} aria-hidden="true" />
							Create a lorebook
						</button>
					{:else}
						<ul
							class="mt-3 flex flex-col gap-1"
							role="radiogroup"
							aria-labelledby="start-lorebook-heading"
						>
							{#if flow.mode !== "new-world"}
								<li>
									<button
										type="button"
										role="radio"
										aria-checked={noLorebookChosen}
										class="hover:bg-surface-200-800 rounded-base flex min-h-11 w-full items-center gap-2.5 px-2 py-1.5 text-left {noLorebookChosen
											? 'sidebar-row-active'
											: ''}"
										onclick={() => chooseLorebook(null)}
									>
										<Icons.BookDashed
											size={20}
											class="text-surface-500 shrink-0"
											aria-hidden="true"
										/>
										<span
											class="text-lead min-w-0 flex-1 truncate"
										>
											None
										</span>
										{#if noLorebookChosen}
											<Icons.Check
												size={16}
												class="text-primary-500 shrink-0"
												aria-hidden="true"
											/>
										{/if}
									</button>
								</li>
							{/if}
							{#each ownBookOptions as l (l.id)}
								{@render plainBookRow(l)}
							{/each}
						</ul>
						{#each pluginBookGroups as g, i (g.heading)}
							<div
								data-book-group="plugin"
								data-book-group-label={g.label}
							>
								<p
									id="start-lorebook-plugin-heading-{i}"
									class="text-chip mt-4 font-medium"
								>
									{g.heading}
								</p>
								<ul
									class="mt-2 flex flex-col gap-1"
									role="radiogroup"
									aria-labelledby="start-lorebook-plugin-heading-{i}"
								>
									{#each g.rows as l (l.id)}
										{@render plainBookRow(l)}
									{/each}
								</ul>
							</div>
						{/each}
					{/if}
					<!-- Other people's books show even when the asker has none of
					     their own (lead, 2026-11-10). -->
					{@render surfacedBooksGroup("start-lorebook")}
					{#if kits?.length}
						<!-- 🚧 A third way beside the books: the session keeps
					     the kit in its own notes (PLAN-lorebook-kinds 8). -->
						<p
							id="start-kit-heading"
							class="text-chip mt-4 font-medium"
						>
							Start from a starter lorebook
						</p>
						<div class="mt-2">
							<StarterKitPicker
								bind:value={kitCardId}
								{kits}
								labelledby="start-kit-heading"
								onpick={chooseKit}
							/>
						</div>
						{#if chosenKit}
							<p
								class="text-surface-600-400 mt-2 text-xs"
								data-start-kit-note
							>
								{KIT_SESSION_NOTE}
							</p>
						{/if}
					{/if}
				</section>
			{/if}

			<!-- ── 4b. Rules and How strict (PLAN-rulesets §4, §21; NOMENCLATURE
		     §28). Only for a genre that offers a choice: Chat shows none. -->
			{#if flow.mode !== "branch" && showRules && rulesOffer && !bookPickShown}
				{#if advanced}
					<section
						class={CARD_CLASS}
						aria-labelledby="start-rules-heading"
					>
						<h3
							id="start-rules-heading"
							class="text-sm font-medium"
						>
							Rules
						</h3>
						{#if flow.rulesFixed && !rulesAdoptedLine}
							<p
								class="text-surface-600-400 mt-1 text-xs"
								data-testid="start-rules-fixed"
							>
								Can't be changed after the session starts.
							</p>
						{/if}
						{#if rulesAdoptedLine}
							<p
								class="text-surface-600-400 text-chip mt-1"
								data-rules-from-lorebook
								data-rules-from-kit={chosenKit ? "" : undefined}
							>
								{rulesAdoptedLine}
							</p>
						{:else}
							{#if rulesOffer.playsBestWith}
								<!-- 🚧 RF fix 8: what the genre plays best with — a recommendation, never a lock. -->
								<p
									class="text-surface-600-400 mt-1 text-xs"
									data-rules-plays-best-with
								>
									{rulesOffer.playsBestWith}
								</p>
							{/if}
							<div
								class="mt-3 flex flex-col gap-2"
								role="radiogroup"
								aria-labelledby="start-rules-heading"
							>
								{#each rulesBands as band (band.group)}
									{#if band.label}
										<p
											class="text-surface-600-400 text-meta font-semibold tracking-wide uppercase"
											data-rules-band={band.group}
										>
											{band.label}
										</p>
									{/if}
									<ul class="flex flex-col gap-1">
										{#each band.choices as r (r.id)}
											{@const selected =
												rulesNow?.value === r.id}
											{@const incompatible =
												r.fit?.rating ===
												"incompatible"}
											<li class="flex items-center gap-1">
												<button
													type="button"
													role="radio"
													aria-checked={selected}
													aria-disabled={incompatible}
													disabled={incompatible}
													data-rules-choice={r.id}
													data-rules-rating={r.fit
														?.rating ?? ""}
													class="hover:bg-surface-200-800 rounded-base flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50 {selected
														? 'sidebar-row-active'
														: ''}"
													onclick={() =>
														chooseRules(r.id)}
												>
													<span
														class="min-w-0 flex-1"
													>
														<span
															class="text-lead flex items-center gap-1.5 font-medium"
														>
															<span
																class="truncate"
															>
																{r.name}
															</span>
															{#if r.recommended}
																<Icons.Star
																	size={14}
																	class="text-warning-500 shrink-0"
																	aria-label="Recommended for this genre"
																/>
															{/if}
															{#if r.fit}
																<span
																	class="text-surface-600-400 shrink-0 text-xs font-normal"
																>
																	{RATING_WORD[
																		r.fit
																			.rating
																	]}
																</span>
															{/if}
														</span>
														{#if r.fit && r.fit.rating !== "perfect" && r.fit.rating !== "great"}
															<span
																class="text-surface-600-400 line-clamp-2 block text-xs"
															>
																{r.fit.reason}
															</span>
														{:else if r.subtitle}
															<span
																class="text-surface-600-400 line-clamp-2 block text-xs"
															>
																{r.subtitle}
															</span>
														{/if}
													</span>
													{#if selected}
														<Icons.Check
															size={16}
															class="text-primary-500 shrink-0"
															aria-hidden="true"
														/>
													{/if}
												</button>
												{#if isAdmin && r.fit}
													<button
														type="button"
														class="anchor shrink-0 text-xs"
														data-rules-audit={r.id}
														onclick={() =>
															(auditChoice = r)}
													>
														Why?
													</button>
												{/if}
											</li>
										{/each}
									</ul>
								{/each}
							</div>
						{/if}
						{#if !rulesAdoptedLine && rulesOffer.choices.find((c) => c.id === rulesNow?.value)?.fit?.inWords?.length}
							<!-- 🚧 RF fix 8: the chosen rules lack some of it — each told in words, and why. -->
							<ul
								class="text-surface-600-400 mt-2 flex flex-col gap-0.5 text-xs"
								data-rules-in-words
							>
								{#each rulesOffer.choices.find((c) => c.id === rulesNow?.value)?.fit?.inWords ?? [] as w (w.label)}
									<!-- prettier-ignore -->
									<li>
									<span class="font-medium">{w.label[0]?.toUpperCase()}{w.label.slice(1)}</span>: {w.why}
								</li>
								{/each}
							</ul>
						{/if}
						{#if presetRigourUnplayed}
							<p
								class="text-surface-600-400 mt-2 text-xs"
								data-testid="start-rules-preset-hint"
							>
								{rulesOffer?.choices.find(
									(c) => c.id === rulesNow?.value
								)?.name ?? "These rules"} keeps no numbers, so {flow
									.preset?.name ?? "this preset"} runs in words
								here.{#if !rulesAdoptedLine}{" "}Pick rules with
									numbers for them to decide.{/if}
							</p>
						{/if}
						{#if !flow.rigourLocked && asksHowStrict(rulesOffer) && howStrictChoices(rulesOffer, rulesNow?.value).length > 1}
							<h3
								id="start-how-strict-heading"
								class="mt-4 text-sm font-medium"
							>
								How strict
							</h3>
							<div
								class="mt-2 flex flex-wrap gap-2"
								role="radiogroup"
								aria-labelledby="start-how-strict-heading"
							>
								{#each howStrictChoices(rulesOffer, rulesNow?.value) as o (o.id)}
									{@const selected = flow.rigour === o.id}
									<button
										type="button"
										role="radio"
										aria-checked={selected}
										data-how-strict={o.id}
										class="btn btn-sm min-h-11 {selected
											? 'preset-pressed'
											: 'preset-tonal-surface'}"
										onclick={() => chooseHowStrict(o.id)}
									>
										{o.label}
									</button>
								{/each}
							</div>
						{/if}
					</section>
				{:else}
					{#if rulesAdoptedLine}
						<p
							class="text-surface-600-400 text-chip px-1"
							data-rules-from-lorebook
							data-rules-from-kit={chosenKit ? "" : undefined}
						>
							{rulesAdoptedLine}
						</p>
					{/if}
					{#if presetRigourUnplayed}
						<p
							class="text-surface-600-400 px-1 text-xs"
							data-testid="start-rules-preset-hint"
						>
							{rulesOffer?.choices.find(
								(c) => c.id === rulesNow?.value
							)?.name ?? "These rules"} keeps no numbers, so {flow
								.preset?.name ?? "this preset"} runs in words
							here.{#if !rulesAdoptedLine}{" "}Pick rules with
								numbers for them to decide.{/if}
						</p>
					{/if}
					{#if rulesCardHides}
						<AdvancedHiddenLine class="px-1" />
					{/if}
				{/if}
			{/if}

			<!-- ── 5. Scenario ─────────────────────────────────────────────── -->
			{#if flow.mode !== "branch" && showScenarioCard}
				{#if showScenario}
					<section class="{CARD_CLASS} flex flex-col">
						<label
							class="text-sm font-medium"
							for="start-session-scenario"
						>
							Scenario
						</label>
						<textarea
							id="start-session-scenario"
							rows="4"
							class="input rounded-base mt-3"
							bind:value={flow.fields.scenario}
							onbeforeinput={touch}
						></textarea>
						<p class="text-surface-600-400 mt-1 text-xs">
							Scene-setting text every prompt will see
						</p>
					</section>
				{:else}
					<button
						type="button"
						class="text-surface-600-400 hover:text-surface-700-300 flex items-center gap-1.5 self-start px-1 text-sm"
						onclick={() => (scenarioOpen = true)}
					>
						<Icons.Plus size={14} aria-hidden="true" />
						Add a scenario
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<CharacterSelectModal
	open={castPickerOpen}
	multiSelect
	characters={castPickOptions}
	excludeIds={flow.characterIds}
	castMembers={bookMembers}
	castGroupLabel={chosenLorebook?.name || "Untitled lorebook"}
	excludeCastMemberIds={flow.castMemberIds}
	selectedLimit={castRoom ?? undefined}
	onOpenChange={(e) => (castPickerOpen = e.open)}
	onMultiSelect={addCharacters}
/>

<NewLorebookDialog
	bind:open={newLorebookOpen}
	onOpenChange={(e) => (newLorebookOpen = e.open)}
	onConfirm={createLorebook}
	onCancel={() => (newLorebookOpen = false)}
/>

<PersonaSelectModal
	open={playAsPickerOpen}
	title="Choose who you play as"
	excludeIds={flow.characterIds}
	onOpenChange={(e) => (playAsPickerOpen = e.open)}
	onSelect={(id: number) => choosePersona(id)}
/>

<RulesFitAuditDialog
	open={auditChoice !== null}
	onOpenChange={(e) => {
		if (!e.open) auditChoice = null
	}}
	choice={auditChoice}
	genreName={flow.genre?.name ?? "this genre"}
/>
