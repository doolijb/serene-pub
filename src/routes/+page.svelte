<script lang="ts">
	import { isAwaitingUser } from "$lib/client/sessions/sessionGroups"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import AvatarStack from "$lib/client/components/AvatarStack.svelte"
	import CharacterCreator from "$lib/client/components/modals/CharacterCreatorModal.svelte"
	import BindingLinkerModal from "$lib/client/components/modals/BindingLinkerModal.svelte"
	import OllamaIcon from "$lib/client/components/icons/OllamaIcon.svelte"
	import KoboldCppIcon from "$lib/client/components/icons/KoboldCppIcon.svelte"
	import { connectionTypeIcon } from "$lib/client/components/connections/connectionTypeIcon"
	import FileDropzone from "$lib/client/components/FileDropzone.svelte"
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount } from "svelte"
	import { goto } from "$app/navigation"
	import { fade } from "svelte/transition"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import { cardFileForUpload } from "$lib/client/utils/cardUpload"
	import { refusedSwapsSentence } from "$lib/client/components/sessionForms/refusedSwaps"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { enableManager } from "$lib/client/components/connections/managers"
	import { enableAccessibility } from "$lib/client/accessibility/state.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import { lastActivityAt, timeAgo } from "$lib/client/utils/timeAgo"
	import {
		applyRowChanged,
		clearRowPatches,
		patchedRow
	} from "$lib/client/sessions/sessionRowPatches.svelte"
	import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
	import {
		GUIDE_GENRE_ID,
		STANDARD_GENRE_ID,
		autoSessionName,
		buildCreatePayload,
		welcomeSessionInput,
		enabledPresetsFor,
		genreVersion,
		latestGenres,
		lorebookSatisfied,
		type CreateSessionInput
	} from "$lib/client/components/sessionForms/createSession.svelte"
	import LanguagePicker from "$lib/client/components/inputs/LanguagePicker.svelte"
	import WelcomeNameField from "$lib/client/components/userForms/WelcomeNameField.svelte"
	import { welcomeNameSaver } from "$lib/client/components/userForms/welcomeName"
	// `t()` is the incremental UI-translation seam (R5): the English source
	// string is the key, an unwrapped string renders in English, and wrapping
	// one is the whole cost of translating it. The Welcome step is where the
	// sweep starts, because it is the first thing anybody reads and it is where
	// the language is chosen.
	import { t } from "$lib/client/i18n/state.svelte"

	let userCtx: UserCtx = $state(getContext("userCtx"))
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let userSettingsCtx: UserSettingsCtx = $state(getContext("userSettingsCtx"))
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	const socket = useTypedSocket()
	const interest = getInterestContext()

	// Data
	let characters: Partial<SelectCharacter>[] = $state([])
	/**
	 * The user's personas — not a second list: a persona is a character
	 * carrying `isPersona`, so this is a view of `characters` above.
	 */
	let personas = $derived(characters.filter((c) => c.isPersona))
	// The projected row, not `Partial<SelectSession>`: the dashboard reads the
	// list's own fields — `genreName`, `messageCount`, `lastMessage` — and the
	// bare table type does not carry them.
	type SessionListRow = Sockets.Sessions.List.Response["sessionList"][number]
	let sessions: SessionListRow[] = $state([])
	let connections: Sockets.Connections.List.Response["connectionsList"] =
		$state([])

	// Data-ready flags — wizard auto-shows once all initial socket data has arrived
	let _charsLoaded = $state(false)
	let _sessionsLoaded = $state(false)
	let _connectionsLoaded = $state(false)

	let dataReady = $derived(
		_charsLoaded &&
			_sessionsLoaded &&
			(!userCtx.user?.isAdmin || _connectionsLoaded)
	)

	let wizardStep = $state(0)
	let _wizardInitialized = $state(false)
	let showCharacterCreator = $state(false)
	let showPersonaCreator = $state(false)

	// Binding linker modal (Flow 1) — Flow 2 (node linking) is gone, binding
	// IS the graph row now, see the lorebookBindings/narrativeNodes merge plan.
	let bindingLinkerOpen = $state(false)
	let bindingLinkerData = $state<Sockets.BindingCheck.Result.Response | null>(
		null
	)

	/**
	 * Which road the Choose an LLM step is on. `null` is the doors — the
	 * model servers found running on this computer first, then the ways to
	 * set one up. `machine` and `service` wait while the Connections panel
	 * does the work (the Set up chat flow, the managed Ollama view, or the
	 * Add picker); `detected` picks a model from a found server inside the
	 * wizard.
	 *
	 * The step moves on by itself when a chat default appears — the one fact
	 * that means a session can reply — never on a connection row being
	 * created, which can happen long before a model is there to answer.
	 */
	let connectionChoice: "machine" | "service" | "detected" | null =
		$state(null)
	/** Which runtime the `machine` road is setting up, for its copy. */
	let machineKind: "koboldcpp" | "ollama" = $state("koboldcpp")
	/**
	 * The model servers running on this computer (`connections:discoverLocal`);
	 * null while the scan is out.
	 */
	let localProviders: Sockets.Connections.DiscoverLocal.Provider[] | null =
		$state(null)
	/** The found server the `detected` road is on. */
	let detectedProvider: Sockets.Connections.DiscoverLocal.Provider | null =
		$state(null)
	/** The model picked on it — its identifier, as the host lists it. */
	let selectedDetectedModel = $state("")

	/**
	 * What the person wants to do: talk to the Guide (`core:genre/guide`) or
	 * play with characters (the Chat genre). Chat adds two steps — a
	 * character, then a persona — before the session starts.
	 */
	let wizardPurpose: "guide" | "chat" | null = $state(null)
	let selectedCharacterId: number | null = $state(null)
	let selectedPersonaId: number | null = $state(null)
	/** A `sessions:create` sent by the wizard is waiting on its answer. */
	let startingSession = $state(false)
	/** "Just call me You" was pressed; its create reply selects the row. */
	let awaitingQuickPersona = false

	// Card import state
	let wizardImportingCharacterCard = $state(false)
	let wizardImportingPersonaCard = $state(false)

	// Derived setup state.
	//
	// "Has a connection" is now "a CHAT default is registered", not "a
	// connection row exists". That is the ruling, not a shortcut: nothing picks
	// a connection because it exists, so a saved-but-unregistered connection
	// genuinely cannot answer a message, and a wizard step that ticked itself
	// off for one would send the user to a chat that refuses to run.
	let chatConnectionId = $derived(
		systemSettingsCtx.capabilityDefaults?.["text->text"]?.connectionId ??
			null
	)
	let hasConnection = $derived(chatConnectionId != null)

	/**
	 * The connection the wizard just created, awaiting its defaults.
	 *
	 * Not `$state`: nothing renders from it. It exists because the eligibility
	 * judgement belongs to the SERVER — `storedCapabilities` intersects a row's
	 * cached capabilities with what its adapter still declares, and re-deriving
	 * that here would be the second copy that eventually offers a connection for
	 * a transform its adapter stopped supporting. So the flow is: create → ask
	 * `connectionDefaults:list` → register what the answer says fits.
	 */
	let pendingDefaultConnectionId: number | null = null
	/**
	 * The chat model the wizard's Ollama road named, waiting to be registered.
	 *
	 * An endpoint has no model of its own — models are `connection_models` rows
	 * and a default is an (endpoint, model) PAIR — so the pick can only be
	 * honoured once the connection exists (`connectionId`, filled by the create
	 * reply) and its listing has synced. Every `connections:list` re-asks
	 * `connectionDefaults:list` until the model appears, then it is registered
	 * for chat and this clears.
	 *
	 * ⚠ Unlike the automatic fill below, this ignores the untested `reason`:
	 * a person pressed "Use this model" on a model Ollama just listed, which
	 * is as determined as a choice gets. A freshly created connection is
	 * always untested, so honouring that gate here left the wizard waiting
	 * forever (found in the 2026-09-27 walk).
	 */
	let pendingChatPick: {
		connectionId: number | null
		type: string
		model: string
	} | null = null
	/** "Use this model" was pressed and the chat default has not landed yet. */
	let connectingDetected = $state(false)

	/** The chat capability — the one default the wizard waits for. */
	const CHAT_CAPABILITY = "text->text"

	/**
	 * Whether a model on a listed connection can serve `capability`, by the
	 * server's own pair judgement (`satisfiableCapabilities` on the list row).
	 *
	 * The gate every automatic registration here passes first. The server
	 * refuses a pair that cannot do the thing, and before this the wizard
	 * asked anyway — registering the endpoint's FIRST model for vision,
	 * embeddings and the rest — so a plain chat model came back as a
	 * "Connection Defaults Set failed" toast on a step that had just worked.
	 */
	function modelServes(
		connectionId: number,
		modelId: number,
		capability: string
	): boolean {
		const model = connections
			.find((c) => c.id === connectionId)
			?.models?.find((m: { id: number }) => m.id === modelId) as
			| { satisfiableCapabilities?: readonly string[] | null }
			| undefined
		return !!model?.satisfiableCapabilities?.includes(capability)
	}

	/**
	 * Register the newly created connection for everything it can do that
	 * nothing is registered for yet.
	 *
	 * Two gates, and both are load-bearing:
	 *
	 *   - **Never clobber.** A capability with a connection already registered
	 *     is skipped. Adding a second backend must not silently re-point chat at
	 *     it; that is the implicit pickup this change exists to delete, wearing
	 *     a wizard's clothes.
	 *   - **Determined-capable only.** `eligible` is true for an UNTESTED
	 *     connection as well, because untested is *undetermined* rather than
	 *     incapable and a picker a human is reading must still offer it. An
	 *     automatic write is the one place that distinction bites: it would
	 *     register an untested endpoint as the default for image generation,
	 *     speech and embeddings alike. `judgeAgainst` marks exactly that case
	 *     with a `reason` and no `disabled`, so requiring both is how this asks
	 *     for "known to fit" rather than "not known to be wrong".
	 */
	function handleDefaultsForNewConnection(
		res: Sockets.ConnectionDefaults.List.Response
	) {
		let chatPicked = false
		const pick = pendingChatPick
		if (pick?.connectionId != null) {
			// Enabled and still listed, or the server refuses the pair: a
			// row the sync has not caught up on is waited for, not sent.
			const chosen = (res.connectionOptions[CHAT_CAPABILITY] ?? [])
				.find((o) => o.id === pick.connectionId && o.eligible)
				?.models?.find(
					(m) =>
						m.model === pick.model && m.enabled && !m.missingSince
				)
			if (chosen) {
				pendingChatPick = null
				connectingDetected = false
				chatPicked = true
				if (res.defaults[CHAT_CAPABILITY]?.connectionId == null)
					socket.emit("connectionDefaults:set", {
						capability: CHAT_CAPABILITY,
						half: "connection",
						id: pick.connectionId,
						modelId: chosen.id
					})
			}
		}
		const id = pendingDefaultConnectionId
		pendingDefaultConnectionId = null
		if (id == null) return
		for (const combo of res.combos) {
			if (res.defaults[combo.id]?.connectionId != null) continue
			if (chatPicked && combo.id === CHAT_CAPABILITY) continue
			const option = (res.connectionOptions[combo.id] ?? []).find(
				(o) => o.id === id
			)
			if (!option?.eligible || option.reason) continue
			// The pair, not the endpoint: the model half rides the same event
			// because the two are one choice, and the server refuses a
			// registration with no model half (connections have no default
			// model). The first switched-on, listed model stands in, the way
			// Admin → Defaults pins one when a connection is chosen.
			// When neither exists the capability is left unregistered, so
			// Admin → Defaults shows it as *Not set* rather than a refusal
			// toast landing on the wizard.
			// And the model must be able to do it: the first enabled model
			// on a chat endpoint is a chat model, and the server refuses it
			// for vision or embeddings.
			const listed = option.models ?? []
			const chosen = listed.find(
				(m) =>
					m.enabled &&
					!m.missingSince &&
					modelServes(id, m.id, combo.id)
			)
			if (!chosen) continue
			socket.emit("connectionDefaults:set", {
				capability: combo.id,
				half: "connection",
				id,
				modelId: chosen.id
			})
		}
	}
	// Named because the interest registry releases by handler reference. The
	// CharacterCreatorModal instances elsewhere (e.g. the session form) hold
	// their own interest in `characters:create`; the registry counts
	// subscribers per key and only removes the one raw listener when the last
	// of them releases, so this page going away never takes theirs down with
	// it.
	//
	// The creator modals select their own new rows (`onCreated`); this
	// standing key only answers the "Just call me You" persona, which is
	// created straight from this page with no modal in between.
	function handleCharacterCreated(res: Sockets.Characters.Create.Response) {
		if (!awaitingQuickPersona || !res.character?.id) return
		awaitingQuickPersona = false
		selectedPersonaId = res.character.id
	}

	/**
	 * Make a freshly created or imported character this user's persona.
	 *
	 * `characters:setDefaultPersona` and not a `characters:update`: it sets
	 * both flags inside one transaction, so the partial unique index on the
	 * default can never trip. Only ever called from the wizard's persona step,
	 * for a row the person just created or imported there to play as — so
	 * making it the default is what they asked for.
	 */
	function adoptAsPersona(characterId: number) {
		socket.emit("characters:setDefaultPersona", { characterId })
	}
	let activeConnectionName = $derived(
		connections.find((c) => c.id === chatConnectionId)?.name ?? null
	)
	// Same "favorites first" sort as CharactersSidebar.svelte's filteredCharacters
	let sortedCharacters = $derived.by(() => {
		const list = [...characters]
		list.sort((a, b) => {
			if (a.isFavorite && !b.isFavorite) return -1
			if (!a.isFavorite && b.isFavorite) return 1
			return 0
		})
		return list
	})

	// ══ the home dashboard ═══════════════════════════════════════════════
	// Everything from here to `wizardPath` below serves the finished-setup
	// screen — the one that answers "what was I doing?". None of it is read
	// by the wizard.

	/**
	 * The greeting, on the READER's clock.
	 *
	 * `getHours()` is the browser's local hour on purpose: the server's
	 * timezone is not the one the person saying "evening" is in, and this app
	 * is routinely reached from a phone on a different continent to the box it
	 * runs on.
	 *
	 * Computed once per mount rather than ticking — a dashboard that silently
	 * changed its own greeting at 18:00 while somebody read it would be
	 * stranger than one that is a few minutes stale.
	 */
	let greeting = $derived.by(() => {
		const name =
			userCtx.user?.displayName?.trim() ||
			userCtx.user?.username?.trim() ||
			""
		// No name is not a reason to guess at one: "Welcome back." carries the
		// same welcome without addressing a stranger by a database column.
		if (!name) return "Welcome back."
		const hour = new Date().getHours()
		const part =
			hour >= 5 && hour < 12
				? "Morning"
				: hour < 18
					? "Afternoon"
					: "Evening"
		return `${part}, ${name}.`
	})

	/**
	 * The list with every `sessions:rowChanged` push since it applied.
	 * Everything that quotes a row reads this, so a
	 * message landing in a session moves its card, its "your turn" hint and
	 * its place in the sort together.
	 */
	let patchedSessions: SessionListRow[] = $derived(sessions.map(patchedRow))

	/**
	 * Sessions whose last line was somebody else's — the ones that owe the
	 * reader a reply. The same test the per-card "Your turn" hint makes, so
	 * the headline count and the cards can never disagree.
	 */
	let sessionsAwaitingYou = $derived(
		patchedSessions.filter((s) => isAwaitingUser(s)).length
	)

	let waitingLine = $derived(
		sessionsAwaitingYou > 0
			? `${sessionsAwaitingYou} session${
					sessionsAwaitingYou === 1 ? "" : "s"
				} ${sessionsAwaitingYou === 1 ? "is" : "are"} waiting on you.`
			: "Nothing is waiting on you. The pub is quiet."
	)

	/** Up to four sessions that have actually been played, freshest first. */
	let continueSessions = $derived.by(() =>
		patchedSessions
			.filter((s) => (s.messageCount ?? 0) > 0)
			.sort((a, b) => lastActivityAt(b) - lastActivityAt(a))
			.slice(0, 4)
	)

	/**
	 * The faces on a continue card: the first three of the cast, then a
	 * `+N` for the rest. Order is the session's own cast order, so the stack
	 * matches the session header's.
	 */
	function castStack(session: SessionListRow) {
		const cast = (session.sessionCharacters ?? [])
			.map((sc) => sc.character)
			.filter(Boolean)
		return { members: cast }
	}

	/** "Chat · 2 hours ago" — the genre and when the last line landed. */
	function sessionMeta(session: SessionListRow): string {
		return [session.genreName, timeAgo(new Date(lastActivityAt(session)))]
			.filter(Boolean)
			.join(" · ")
	}

	/**
	 * A character card's one-line tagline under its portrait.
	 *
	 * The list row carries no short description, so this is the first line of
	 * the description, collapsed; the card truncates it to one line. Empty
	 * stays empty rather than inventing copy.
	 */
	function characterTagline(character: Partial<SelectCharacter>): string {
		const text = character.description ?? ""
		const first = text.split(/\n+/).find((l) => l.trim()) ?? ""
		return first.replace(/\s+/g, " ").trim()
	}

	/**
	 * "Import a card" in the header. The file goes through the same
	 * `characters:importCard` call the wizard's dropzone makes, and the same
	 * reply handler toasts the result; nothing new crosses the socket.
	 */
	/**
	 * Which character cells the shelf shows at each `home` width, by index.
	 * The "New or import" cell is always last, so a row of N columns holds
	 * N − 1 characters: 5 on a phone (3 rows of 2), 5 at 640px (2 rows of
	 * 3), then one row — 4, 5, 6 at 900, 1100, 1300px. Static strings so
	 * Tailwind sees every variant.
	 */
	const SHELF_CELL = [
		"flex",
		"flex",
		"flex",
		"flex",
		"flex @min-[900px]/home:hidden @min-[1100px]/home:flex",
		"hidden @min-[1300px]/home:flex"
	]

	let cardInput: HTMLInputElement | undefined = $state()
	function handleDashboardCardPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const files = input.files ? Array.from(input.files) : []
		if (files.length > 0)
			handleCharacterCardImport({ files } as unknown as FileAcceptDetails)
		// Cleared so picking the same file twice still fires `change`.
		input.value = ""
	}

	/**
	 * Who the session is waiting on.
	 *
	 * The reader's own line last means the model owes a reply. Naming WHO is
	 * only honest for a two-hander — in a group the next speaker is the reply
	 * strategy's to decide, and this page does not run it — so anything else
	 * says "Waiting on the model" rather than guessing a name.
	 */
	function turnHint(session: SessionListRow): string | null {
		const last = session.lastMessage
		if (!last) return null
		if (!last.isUser) return "Your turn"
		const cast = session.sessionCharacters ?? []
		if (cast.length === 1) {
			const name = resolveCharacterName(cast[0].character, "")
			if (name) return `${name} is up next`
		}
		return "Waiting on the model"
	}

	/**
	 * Create a character from the dashboard.
	 *
	 * ⚠ This opens the VIEW and pulses its New button rather than opening the
	 * form itself. The Characters view keeps "am I creating?" in its own local
	 * state and exposes no digest key for it — `digest.characterId` opens the
	 * EDIT form for a row that already exists — so `tutorial`, the flag the
	 * wizard's own last steps set, is the whole of what a caller outside that
	 * view can reach. The view clears it on the first interaction.
	 */
	function openViewToCreate(key: "characters") {
		panelsCtx.digest.tutorial = true
		panelsCtx.openPanel({ key, toggle: false })
	}

	/**
	 * Start a session: the Sessions view opens straight on the start screen.
	 *
	 * `digest.createSession` is the address for that screen — an empty object
	 * is the plain "start one", and a caller that already knows a character, a
	 * persona, a genre or a preset names it here.
	 */
	function startASession(
		prefill: NonNullable<PanelsCtx["digest"]["createSession"]> = {}
	) {
		panelsCtx.digest.createSession = prefill
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}

	// Wizard path drives welcome copy
	let wizardPath = $derived.by(
		(): "admin-first-time" | "admin-existing" | "non-admin" => {
			if (!userCtx.user?.isAdmin) return "non-admin"
			if (connections.length === 0) return "admin-first-time"
			return "admin-existing"
		}
	)

	// ══ the wizard ═══════════════════════════════════════════════════════
	//
	// Get started → Choose an LLM (admins only) → What to do, and — only
	// when the answer is "Play with characters" — Character → Who you are.
	// The Guide answer starts its session straight from What to do.
	//
	// Embeddings are NOT a step (owner ruling 2026-09-27): retrieval is
	// optional, configured later in Connections, and nothing here waits on
	// it. The server's `setup` record (`ragStepComplete`) is no longer read.

	type WizardStepType =
		| "welcome"
		| "llm"
		| "purpose"
		| "character"
		| "persona"

	/**
	 * One choice on a wizard screen: a whole-card button on the page's inset
	 * ground, the same card the dashboard's continue cards sit on. Selected
	 * is `ring-2 ring-primary-500` added beside it (STYLE-GUIDE §2.4 — a
	 * card's selection is a ring, never a fill).
	 */
	const CHOICE_CARD =
		"bg-surface-50-950 border-surface-200-800 hover:bg-surface-100-900 flex w-full min-w-0 items-start gap-4 rounded-[14px] border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"

	/** The progress indicator's labels, sentence case. */
	const WIZARD_STEP_LABELS: Record<WizardStepType, string> = {
		welcome: "Get started",
		llm: "Choose an LLM",
		purpose: "What to do",
		character: "Character",
		persona: "Who you are"
	}

	/**
	 * The steps, in order, for this person on this road. The Chat steps
	 * appear once "Play with characters" is chosen, so the indicator counts
	 * only what is actually ahead.
	 */
	let wizardSteps = $derived.by((): WizardStepType[] => {
		const ids: WizardStepType[] = ["welcome"]
		// Connecting a model is the pub's, so only an admin is asked.
		if (userCtx.user?.isAdmin) ids.push("llm")
		ids.push("purpose")
		if (wizardPurpose === "chat") ids.push("character", "persona")
		return ids
	})

	let currentWizardStep = $derived(wizardSteps[wizardStep])
	let totalWizardSteps = $derived(wizardSteps.length)

	/**
	 * When the home page stops being the wizard: the pub can reply (a chat
	 * default is registered — asked of admins only, who are the ones able to
	 * fix it) and this person has started at least one session.
	 *
	 * A character and a persona are no longer required: a Guide session has
	 * neither, and a person who started one is set up. Embeddings never were
	 * required and are no longer asked about at all.
	 */
	let setupComplete = $derived(
		(!userCtx.user?.isAdmin || hasConnection) && sessions.length > 0
	)

	// Open on the first step that still needs an answer, once, when the data
	// has arrived. An admin whose pub already replies skips straight to What
	// to do; everyone else starts at Get started, where the language is.
	//
	// No config pointer or sampling default is written here: what a new
	// install needs is seeded by `bootstrapPipelines`, and a hardcoded seed
	// row id is exactly the write that once overwrote a user's choice.
	$effect(() => {
		if (dataReady && !setupComplete && !_wizardInitialized) {
			_wizardInitialized = true
			if (userCtx.user?.isAdmin && hasConnection)
				wizardStep = wizardSteps.indexOf("purpose")
		}
	})

	// The Choose an LLM step moves on by itself the moment the pub can reply,
	// whichever road got it there — the Set up chat flow, a service added in
	// the Connections panel, or the Ollama found below. Only while a road is
	// open, so going Back to a finished step shows it rather than bouncing.
	$effect(() => {
		if (
			currentWizardStep === "llm" &&
			hasConnection &&
			connectionChoice !== null
		) {
			connectionChoice = null
			nextWizardStep()
		}
	})

	/**
	 * What model servers run here? Asked once, when an admin reaches the
	 * Choose an LLM step with nothing connected, so each one found is a card
	 * before any door is pressed. Not on Android, where no local server is
	 * offered.
	 */
	let _localScanned = false
	$effect(() => {
		if (
			currentWizardStep === "llm" &&
			!hasConnection &&
			!_localScanned &&
			!systemSettingsCtx.settings?.isAndroidWrapper
		) {
			_localScanned = true
			scanLocalProviders()
		}
	})
	/** Where a found server runs, for its card: `localhost:11434`. */
	function providerHost(baseUrl: string): string {
		try {
			return new URL(baseUrl).host
		} catch {
			return baseUrl
		}
	}

	/**
	 * The language choice, on the Get started step (R5).
	 *
	 * ## Why Get started and not a step of its own
	 *
	 * A wizard step has to be able to say whether it is complete, and this one
	 * cannot: a language is always set, because the column has a default. The
	 * only honest completion predicate would be "the user made an explicit
	 * choice", and on every install that upgrades across this change nobody
	 * has — so a dedicated step would re-open the whole wizard for every
	 * existing user to ask them a question they have already been answered.
	 *
	 * Get started has the opposite property: it never counts as complete,
	 * everyone passes through it, and it is the first thing on screen — the
	 * language you read the rest of the wizard in is chosen before the rest.
	 *
	 * **An admin's choice here is the pub's**, per R5: they are setting the
	 * server up, so the language they pick becomes the default everyone
	 * inherits. It writes their own setting too, so an admin who later changes
	 * the pub's default does not move themselves by surprise.
	 */
	function chooseWizardLanguage(language: string) {
		if (!language) return
		socket.emit("userSettings:updateLanguage", { language })
		if (userCtx.user?.isAdmin) {
			socket.emit("systemSettings:updateDefaultLanguage", { language })
		}
	}

	// Navigation
	function openPanel(key: string) {
		panelsCtx.openPanel({ key })
	}

	/**
	 * Open the Connections panel through one of its first-run doors — the
	 * same doors its own empty index offers (`connectionsDoor` in the
	 * digest). `toggle: false`, so a second press never closes it.
	 */
	function openConnectionsDoor(
		door: NonNullable<PanelsCtx["digest"]["connectionsDoor"]>
	) {
		panelsCtx.digest.connectionsDoor = door
		panelsCtx.openPanel({ key: "connections", toggle: false })
	}

	/**
	 * Switch a runtime on and land on its connection.
	 *
	 * The managers fold into their connection (2026-09-17 ruling R2), and no
	 * Settings → System switch has to be found first, so this does both
	 * halves — the flag, and the row the flag is about — and opens that row.
	 *
	 * A row that had to be CREATED answers on `connections:create`, and the
	 * Connections sidebar's own handler for that event is what opens it, so
	 * the digest is seeded only when there is already an id to seed it with.
	 */
	function openManagedConnection(kind: "koboldcpp" | "ollama") {
		const { connectionId } = enableManager(kind, socket, connections)
		if (connectionId != null) panelsCtx.digest.connectionId = connectionId
		openPanel("connections")
	}

	function switchToDocumentView() {
		enableAccessibility()
		goto("/document-view")
	}

	function nextWizardStep() {
		if (wizardStep < totalWizardSteps - 1) wizardStep++
	}

	/** The welcome screen's optional "What should we call you?" answer. */
	let wizardName = $state("")

	/** Saves the welcome name, and toasts a refusal that lands after the wizard moved on. */
	const welcomeName = welcomeNameSaver(socket, (t) => toaster.error(t))

	/** Get started: save a name if one was given (never waited on), move on. */
	function leaveWelcomeStep() {
		if (welcomeName.save(wizardName)) wizardName = ""
		nextWizardStep()
	}

	function prevWizardStep() {
		if (wizardStep > 0) wizardStep--
	}

	/** Leave the wizard for another page; it resumes where the data says. */
	function closeWizard() {
		wizardStep = 0
		connectionChoice = null
	}

	/**
	 * The genre row and the preset the wizard starts a session of `bareId`
	 * with: the genre at its newest registered version, and its starred
	 * enabled preset, else its first enabled one. `null` when the genre is not
	 * registered or no enabled preset is left to start it with — an admin
	 * switched it off, and a start that the server would refuse is not
	 * offered.
	 */
	function wizardGenrePick(bareId: string) {
		const genre = latestGenres(sessionGenres).find(
			(g) => genreVersion(g.genreId).bare === bareId
		)
		if (!genre) return null
		const enabled = enabledPresetsFor(sessionPresets, genre.genreId)
		const preset = enabled.find((p) => p.isDefault) ?? enabled[0] ?? null
		if (!preset) return null
		return { genre, preset }
	}
	let guidePick = $derived(wizardGenrePick(GUIDE_GENRE_ID))
	let chatPick = $derived(wizardGenrePick(STANDARD_GENRE_ID))

	/** The persona the person plays as by default, if they have one. */
	let defaultPersonaId = $derived(
		personas.find((p) => p.isDefaultPersona)?.id ?? personas[0]?.id ?? null
	)
	/** The characters the Character step offers: everyone but the personas. */
	let wizardCharacters = $derived(
		sortedCharacters.filter((c) => !c.isPersona)
	)

	/**
	 * Send the wizard's one `sessions:create` and open what it makes.
	 *
	 * Built through `buildCreatePayload`, the same body the start screen
	 * sends, so the server derives one genre from one preset either way. The
	 * reply is the wizard's own — a one-shot interest taken with the request
	 * and released by the answer — so a session started anywhere else while
	 * the home screen is mounted does not navigate this page.
	 */
	function createWizardSession(input: CreateSessionInput) {
		if (startingSession) return
		startingSession = true
		const releaseError = interest.declareInterest<"sessions:create:error">(
			"sessions:create:error",
			handleSessionsCreateError
		)
		const releaseOk = interest.requestWithInterest(
			"sessions:create",
			buildCreatePayload(input),
			handleSessionsCreate
		)
		releaseWizardCreate = () => {
			releaseOk()
			releaseError()
		}
	}

	/**
	 * "Talk to an AI": the "Welcome to Serene Pub" Guide session, where
	 * Serene greets the person (`welcomeSessionInput`).
	 */
	function startGuideSession() {
		wizardPurpose = "guide"
		const pick = guidePick
		if (!pick) return
		createWizardSession(
			welcomeSessionInput(
				{ genreId: pick.genre.genreId, presetId: pick.preset.id },
				defaultPersonaId
			)
		)
	}

	/** "Play with characters": on to the Character step. */
	function chooseChat() {
		wizardPurpose = "chat"
		if (selectedPersonaId == null) selectedPersonaId = defaultPersonaId
		// `wizardSteps` has just grown the Chat steps; the next one is
		// Character.
		wizardStep = wizardSteps.indexOf("character")
	}

	/**
	 * The last press of the Chat road: the chosen character, the chosen
	 * persona, the Chat genre. A Chat preset that requires a lorebook cannot
	 * be answered here, so that one case hands over to the start screen with
	 * everything prefilled instead of being refused.
	 */
	function startChatSession() {
		const character = characters.find((c) => c.id === selectedCharacterId)
		if (!character?.id || selectedPersonaId == null) return
		const pick = chatPick
		const genreId = pick?.genre.genreId ?? STANDARD_GENRE_ID
		if (pick && !lorebookSatisfied(pick.genre.shape, null)) {
			startASession({
				characterId: character.id,
				personaId: selectedPersonaId,
				genreId,
				presetId: pick.preset.id
			})
			return
		}
		createWizardSession({
			name: autoSessionName(
				[character.nickname || character.name || "Character"],
				[]
			),
			genreId,
			presetId: pick?.preset.id ?? null,
			characterIds: [character.id],
			personaIds: [selectedPersonaId]
		})
	}

	function scanLocalProviders() {
		localProviders = null
		socket.emit("connections:discoverLocal", {})
	}

	/** Open a found server's road, its first model picked. */
	function chooseDetectedProvider(
		provider: Sockets.Connections.DiscoverLocal.Provider
	) {
		detectedProvider = provider
		selectedDetectedModel = provider.models[0]?.model ?? ""
		connectionChoice = "detected"
	}

	/** The service's name, or the first "Name 2", "Name 3"… not yet taken. */
	function freeConnectionName(label: string): string {
		const taken = new Set(
			connections.map((c) => (c.name ?? "").trim().toLowerCase())
		)
		let name = label
		for (let n = 2; taken.has(name.toLowerCase()); n++)
			name = `${label} ${n}`
		return name
	}

	/**
	 * "Use this model" on a found server: reuse the connection that already
	 * points at it, or create the one, then register the chosen model as the
	 * chat default once the endpoint lists it
	 * (`handleDefaultsForNewConnection`). The step moves on when that default
	 * lands, not here.
	 */
	function useDetectedModel() {
		const provider = detectedProvider
		const model = selectedDetectedModel
		if (!provider || !model || connectingDetected) return
		connectingDetected = true
		if (provider.connectionId != null) {
			// Reuse, never duplicate: a second Ollama to one host is refused.
			pendingChatPick = {
				connectionId: provider.connectionId,
				type: provider.type,
				model
			}
			// Forced: the model was just listed live, and an unforced sync
			// skips a listing it thinks is fresh — which would leave a model
			// pulled since then without a row, and this pick waiting on it.
			socket.emit("connections:syncModels", {
				id: provider.connectionId,
				force: true
			})
			socket.emit("connectionDefaults:list", {})
			return
		}
		pendingChatPick = { connectionId: null, type: provider.type, model }
		// The Ollama view reads the manager flag; the row alone is not enough.
		if (provider.type === CONNECTION_TYPE.OLLAMA)
			socket.emit("systemSettings:updateOllamaManagerEnabled", {
				enabled: true
			})
		socket.emit("connections:create", {
			connection: {
				name: freeConnectionName(provider.label),
				type: provider.type,
				baseUrl: provider.baseUrl,
				// The picked model becomes its row at create
				// (`ensureConnectionModel`), so the pick does not wait on the
				// first sync to find it.
				model
			} as Sockets.Connections.Create.Params["connection"]
		})
	}

	function createSamplePersona() {
		// A persona is a character: one create, with the two flags on the row.
		// The server applies the default in its own transaction; the reply
		// selects it (`handleCharacterCreated`).
		awaitingQuickPersona = true
		socket.emit("characters:create", {
			character: {
				name: "You",
				description:
					"This represents you in sessions. You can edit it later to add more about yourself, or create other personas for different kinds of stories.",
				isPersona: true,
				isDefaultPersona: true
			} as any
		})
	}

	async function handleCharacterCardImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		// The server's own ceiling, said before a byte is uploaded.
		const upload = await cardFileForUpload(details.files[0])
		if ("refused" in upload) {
			toaster.error({ title: upload.refused })
			return
		}
		wizardImportingCharacterCard = true
		socket.emit("characters:importCard", { file: upload.base64 })
	}

	async function handlePersonaCardImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		const upload = await cardFileForUpload(details.files[0])
		if ("refused" in upload) {
			toaster.error({ title: upload.refused })
			return
		}
		wizardImportingPersonaCard = true
		// One card family. `handleCharactersImportCard` flags the row as
		// this user's persona when the wizard is on the persona step.
		socket.emit("characters:importCard", { file: upload.base64 })
	}

	// Every listener below is named because the interest registry releases by
	// handler reference. The sidebars and the session form hold their own
	// interest in these same events; the registry counts subscribers per key,
	// so this page's release cannot take theirs down — the bare
	// `socket.off("characters:list")` that would have is not reachable from
	// here at all any more.
	function handleCharactersList(
		msg: SocketEventMap["characters:list"]["response"]
	) {
		characters = msg.characterList || []
		_charsLoaded = true
	}

	function handleSessionsList(
		msg: SocketEventMap["sessions:list"]["response"]
	) {
		sessions = msg.sessionList || []
		// The list carries the server's own projection of every row, so what
		// the pushes said before it is older than what just arrived.
		clearRowPatches()
		_sessionsLoaded = true
	}

	function handleRowChanged(
		msg: SocketEventMap["sessions:rowChanged"]["response"]
	) {
		applyRowChanged(msg)
	}

	/**
	 * The home page's three lists, each asked for and listened for in one.
	 *
	 * All BARE — a list is this user's own cast or sessions, with nothing to
	 * scope it to — and all STANDING, because the server re-emits every one of
	 * them as a cascade after a write, which is how the wizard's "done" ticks
	 * move without this page asking again.
	 *
	 * They are asked for here rather than in `onMount`, so the interest sync
	 * naming each key leaves ahead of its request; `sessions:create` is sent
	 * from `createWizardSession`, which declares its own one-shot key
	 * with the request and releases it on the answer.
	 */
	$effect(() =>
		interest.requestWithInterest(
			"characters:list",
			{},
			handleCharactersList
		)
	)
	$effect(() =>
		interest.requestWithInterest("sessions:list", {}, handleSessionsList)
	)
	/**
	 * The rows this page quotes, kept current between lists. BARE like the
	 * list itself: any session on the page may have a message land in it.
	 */
	interest.useInterest<"sessions:rowChanged">(
		"sessions:rowChanged",
		handleRowChanged
	)

	/**
	 * What the wizard's first session starts on: every registered genre, and
	 * the presets this user may start one with. Both BARE and standing, on the
	 * same terms as the three lists above, and both read only through
	 * `createSession`'s derivations so this page picks the genre and preset the
	 * start screen would.
	 */
	let sessionGenres: Sockets.Sessions.Genres.Response["genres"] = $state([])
	let sessionPresets: Sockets.SessionAdmin.PresetRow[] = $state([])

	$effect(() =>
		interest.requestWithInterest(
			"sessions:genres",
			{},
			(msg) => (sessionGenres = msg.genres || [])
		)
	)
	$effect(() =>
		interest.requestWithInterest(
			"sessionPresets:list",
			{},
			(msg) => (sessionPresets = msg.presets || [])
		)
	)

	function handleConnectionsList(
		msg: SocketEventMap["connections:list"]["response"]
	) {
		connections = msg.connectionsList || []
		_connectionsLoaded = true
		// A chat pick still waiting on its model's listing asks again: the
		// list is re-sent after every write, the model sync's included.
		if (pendingChatPick?.connectionId != null)
			socket.emit("connectionDefaults:list", {})
	}

	function handleDiscoverLocal(
		res: SocketEventMap["connections:discoverLocal"]["response"]
	) {
		localProviders = res.providers ?? []
		// A found server's road re-reads its card, so "Check again" there
		// shows the model just loaded.
		if (detectedProvider) {
			const again = localProviders.find(
				(p) =>
					p.type === detectedProvider!.type &&
					p.baseUrl === detectedProvider!.baseUrl
			)
			if (again) {
				detectedProvider = again
				if (
					!again.models.some((m) => m.model === selectedDetectedModel)
				)
					selectedDetectedModel = again.models[0]?.model ?? ""
			}
		}
	}

	function handleDiscoverLocalError() {
		localProviders = []
	}

	/** The pick's create was refused: let the button be pressed again. */
	function handleConnectionsCreateError() {
		if (pendingChatPick?.connectionId !== null) return
		pendingChatPick = null
		connectingDetected = false
	}

	function handleConnectionsCreate(
		res: SocketEventMap["connections:create"]["response"]
	) {
		if (res.connection) {
			// The wizard registers defaults EXPLICITLY — it does not rely on
			// anything picking this connection up. It used to emit
			// `connections:setUserActive`, which starred one row as "the
			// default" and said nothing about which of the five things a
			// KoboldCPP connection does was meant; and the server used to
			// auto-star the first connection created, which is the implicit
			// pickup the whole change deletes.
			//
			// Explicit is not the same as implicit-with-extra-steps. This
			// fires for any connection created while the home screen is
			// mounted — the wizard's connection step, or the Connections
			// sidebar opened from it — and it only ever FILLS EMPTY slots,
			// never re-points one somebody already chose. See the handler:
			// that gate is what keeps "the second backend you add" from
			// quietly taking over chat.
			pendingDefaultConnectionId = res.connection.id!
			if (
				pendingChatPick?.connectionId === null &&
				res.connection.type === pendingChatPick.type
			) {
				pendingChatPick.connectionId = res.connection.id!
				// The picked model's row exists from the create; the sync
				// fills in the rest of the listing and its facts.
				socket.emit("connections:syncModels", {
					id: res.connection.id!
				})
			}
			socket.emit("connectionDefaults:list", {})
			toaster.success({
				title: "Connection created",
				description: `Connected to ${res.connection.name}`
			})
			// The wizard's Choose an LLM step moves on when the chat default
			// lands (the `hasConnection` effect), not here: a row can exist
			// long before any model on it can answer.
		}
	}

	/** Released by whichever of the two replies the wizard's create gets. */
	let releaseWizardCreate: (() => void) | null = null

	function handleSessionsCreate(
		res: SocketEventMap["sessions:create"]["response"]
	) {
		releaseWizardCreate?.()
		releaseWizardCreate = null
		startingSession = false
		if (res.session) {
			const refused = refusedSwapsSentence(res)
			if (refused)
				toaster.warning({
					title: "Some settings were not applied",
					description: refused
				})
			goto(`/sessions/${res.session.id}`)
		}
	}

	function handleSessionsCreateError(res: Sockets.ErrorResponse) {
		releaseWizardCreate?.()
		releaseWizardCreate = null
		startingSession = false
		toaster.error({
			title: "Could not start the session",
			description: res?.error || "The server refused the request."
		})
	}

	// Card imports, from the wizard and the dashboard. One family: a persona
	// card and a character card are the same file in the same table, so the
	// dropzone the card landed on decides whether the row becomes a persona.
	// Either way the new row is selected on its wizard step.
	function handleCharactersImportCard(msg: any) {
		const wasPersonaDrop = wizardImportingPersonaCard
		wizardImportingCharacterCard = false
		wizardImportingPersonaCard = false
		if (msg.character) {
			toaster.success({
				title: `Imported ${msg.character.nickname || msg.character.name}`
			})
			if (setupComplete) return
			if (wasPersonaDrop && currentWizardStep === "persona") {
				adoptAsPersona(msg.character.id)
				selectedPersonaId = msg.character.id
			} else if (currentWizardStep === "character") {
				selectedCharacterId = msg.character.id
			}
		}
	}

	function handleCharactersImportCardError(msg: any) {
		wizardImportingCharacterCard = false
		wizardImportingPersonaCard = false
		toaster.error({
			title: "Import failed",
			description: msg.error ?? "Could not import character card"
		})
	}

	// Binding linker modal
	function handleBindingCheckResult(
		data: SocketEventMap["bindingCheck:result"]["response"]
	) {
		if (data.orphanedBindings.length > 0) {
			bindingLinkerData = data
			bindingLinkerOpen = true
		}
	}

	/**
	 * The cast PUSH and the card-import reply, both BARE.
	 *
	 * `characters:create` is a standing key: the creator modals send their
	 * own creates, and this page's only one is the "Just call me You"
	 * persona, whose reply selects it on the wizard's persona step.
	 * `characters:importCard` IS a reply, to the dropzone emits in
	 * `handleCharacterCardImport` / `handlePersonaCardImport` (one family: a
	 * persona is a character), and its `:error` half is never gated (plan
	 * ruling 2).
	 *
	 * Neither event is in `SCOPED_EVENTS`, so a scoped key would match no
	 * payload at all.
	 */
	interest.useInterest<"users:current:updateDisplayName">(
		"users:current:updateDisplayName",
		() => welcomeName.saved()
	)
	interest.useInterest<"users:current:updateDisplayName:error">(
		"users:current:updateDisplayName:error",
		(message) => welcomeName.refused(message)
	)
	interest.useInterest<"characters:create">(
		"characters:create",
		handleCharacterCreated
	)
	interest.useInterest<"characters:importCard">(
		"characters:importCard",
		handleCharactersImportCard
	)
	interest.useInterest<"characters:importCard:error">(
		"characters:importCard:error",
		handleCharactersImportCardError
	)

	/**
	 * The orphaned-binding sweep's answer, BARE. It is a push rather than a
	 * reply — nothing here asks for it. It IS in `SCOPED_EVENTS` (on
	 * `sessionId`), but this page has no session to key it to, and a bare key
	 * hears every scope.
	 */
	interest.useInterest<"bindingCheck:result">(
		"bindingCheck:result",
		handleBindingCheckResult
	)

	/**
	 * The connection families this page reads, all BARE and STANDING.
	 *
	 * `connections:list` and `connectionDefaults:list` are re-sent after every
	 * write, and `connections:create` answers a create this page sends from the
	 * wizard but also one the Connections sidebar opened from here sends — so
	 * every one of them has to outlive its request. Neither family is
	 * restricted interest (both are mixed by design), so the keys are declared
	 * for every user; the admin check stays where it was, on the emit.
	 *
	 * Declared ABOVE the effects and the mount that emit: effects run in
	 * creation order and a request flushes the pending interest sync, so a
	 * declaration made below one of them would miss the flush its own first
	 * reply rides on.
	 */
	interest.useInterest<"connections:list">(
		"connections:list",
		handleConnectionsList
	)
	interest.useInterest<"connections:create">(
		"connections:create",
		handleConnectionsCreate
	)
	interest.useInterest<"connectionDefaults:list">(
		"connectionDefaults:list",
		handleDefaultsForNewConnection
	)

	/**
	 * The local scan behind the Choose an LLM step's found-server cards.
	 *
	 * Admin-only handlers, on the home screen every user lands on: declared
	 * only for an admin, so a non-admin's registry holds no key it could never
	 * use — and only an admin ever reaches the step that emits them.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"connections:discoverLocal">(
				"connections:discoverLocal",
				handleDiscoverLocal
			),
			interest.declareInterest<"connections:discoverLocal:error">(
				"connections:discoverLocal:error",
				handleDiscoverLocalError
			),
			interest.declareInterest<"connections:create:error">(
				"connections:create:error",
				handleConnectionsCreateError
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	onMount(() => {
		// Every listener this page holds is an interest, declared above.
		if (userCtx.user?.isAdmin) {
			socket.emit("connections:list", {})
		} else {
			_connectionsLoaded = true
		}
	})
</script>

<svelte:head>
	<title>Serene Pub - Get started</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

<!-- Page background content.
     The vertical padding belongs to this page: `<main>` supplies none, and the
     first thing inside is the beta line, which has no breathing room of its
     own. -->
<div
	class="flex flex-1 flex-col items-center justify-center gap-4 px-2 py-8 md:px-0"
>
	<!-- ══ the beta line ═════════════════════════════════════════════════
	     One quiet line above everything, on the dashboard and the wizard
	     alike: it has to be readable on every visit without being the
	     loudest thing on a page whose single accent belongs to "Start a
	     session". The 400 stop carries the warning at speaking volume; the
	     500 dot is the one place the ember runs at full strength. -->
	<div
		class="text-warning-800 dark:text-warning-400 flex w-full items-center gap-2 text-xs"
	>
		<span
			class="bg-warning-500 h-1.5 w-1.5 shrink-0 rounded-full"
			aria-hidden="true"
		></span>
		Serene Pub is in beta. Expect bugs and rapid changes.
	</div>

	<!-- Loading state while socket data arrives -->
	{#if !dataReady}
		<div
			class="preset-filled-surface-200-800 mx-auto w-full rounded-2xl p-10 text-center"
		>
			<Icons.Loader2
				size={40}
				class="text-primary-500 mx-auto mb-4 animate-spin"
			/>
			<p class="text-surface-600-400">Loading…</p>
		</div>
	{/if}

	<!-- ══ the home dashboard ═══════════════════════════════════════════
	     Shown once setup is done. It answers one question — "what was I
	     doing?" — so it reads top to bottom as an answer: who you are and
	     what is owed, then the sessions to walk back into, then the cast.

	     `@container/home` and not viewport breakpoints: `<main>` is
	     everything right of the rail MINUS whatever sidebar is docked, so a
	     `md:` grid would go two-up on a 1400px window whose content column
	     is 700px wide. The variants below read this box. -->
	{#if dataReady && setupComplete}
		<div class="@container/home flex w-full flex-col gap-8">
			<!-- ── greeting ─────────────────────────────────────────── -->
			<div
				class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4"
			>
				<div class="flex min-w-0 flex-col gap-1.5">
					<h1
						class="[font-family:var(--typo-heading--font-family)] text-[32px] leading-[1.15] font-semibold tracking-[-0.015em]"
					>
						{greeting}
					</h1>
					<p class="text-surface-600-400 text-[15px]">
						{waitingLine}
					</p>
				</div>
				<!-- "New session" is the one filled primary on this page.
				     Everything else here is tonal or a link, so the single
				     call to action is the only thing wearing the accent. -->
				<div class="flex shrink-0 flex-wrap items-center gap-2.5">
					<input
						bind:this={cardInput}
						type="file"
						accept=".png,.apng,.jpeg,.jpg,.webp,.json,.charx"
						class="hidden"
						tabindex="-1"
						aria-hidden="true"
						onchange={handleDashboardCardPick}
					/>
					<button
						type="button"
						class="btn preset-tonal"
						disabled={wizardImportingCharacterCard}
						onclick={() => cardInput?.click()}
					>
						{#if wizardImportingCharacterCard}
							<Icons.Loader2
								size={16}
								class="animate-spin"
								aria-hidden="true"
							/>
						{:else}
							<Icons.Upload size={16} aria-hidden="true" />
						{/if}
						Import a card
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={() => startASession()}
					>
						<Icons.Plus size={16} aria-hidden="true" />
						New session
					</button>
				</div>
			</div>

			<!-- ── pick up where you left off ─────────────────────────
			     One card per row on a phone, two side by side once the
			     column has room for a prose excerpt in each. -->
			<section class="flex flex-col gap-3.5">
				<h2
					class="[font-family:var(--typo-heading--font-family)] text-base font-semibold"
				>
					Pick up where you left off
				</h2>
				{#if continueSessions.length > 0}
					<div
						class="grid grid-cols-1 gap-3 @min-[640px]/home:grid-cols-2"
					>
						{#each continueSessions as session (session.id)}
							{@const stack = castStack(session)}
							{@const hint = turnHint(session)}
							{@const last = session.lastMessage}
							<div
								class="bg-surface-50-950 border-surface-200-800 flex min-w-0 flex-col gap-3 rounded-[14px] border p-4"
							>
								<div class="flex min-w-0 items-center gap-3">
									{#if stack.members.length > 0}
										<span aria-hidden="true">
											<AvatarStack
												members={stack.members}
												size="md"
												ring="ring-surface-50-950"
											/>
										</span>
									{/if}
									<div class="flex min-w-0 flex-1 flex-col">
										<span
											class="truncate [font-family:var(--typo-heading--font-family)] text-[18px] leading-[1.3] font-semibold"
										>
											{session.name || "Untitled session"}
										</span>
										<span
											class="text-surface-600-400 truncate text-xs"
										>
											{sessionMeta(session)}
										</span>
									</div>
								</div>
								{#if last?.excerpt}
									<p
										class="text-surface-800-200 line-clamp-3 [font-family:var(--sp-prose)] text-[15px] leading-[1.55]"
									>
										{#if last.speakerName}
											<span
												class="text-surface-950-50 [font-family:var(--typo-heading--font-family)] text-sm font-semibold"
											>
												{last.speakerName}
											</span>
										{/if}
										{last.excerpt}
									</p>
								{/if}
								<div class="flex-1"></div>
								<div class="flex items-center gap-2.5">
									{#if hint === "Your turn"}
										<span
											class="chip preset-tonal-primary rounded-full text-xs"
										>
											Your turn
										</span>
									{:else if hint}
										<span
											class="text-surface-600-400 truncate text-xs"
										>
											{hint}
										</span>
									{/if}
									<button
										type="button"
										class="btn btn-sm hover:preset-tonal-surface text-surface-800-200 ml-auto text-sm font-medium"
										aria-label="Continue {session.name ||
											'Untitled session'}"
										onclick={() =>
											goto(`/sessions/${session.id}`)}
									>
										Continue
										<Icons.ArrowRight
											size={16}
											aria-hidden="true"
										/>
									</button>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="bg-surface-50-950 border-surface-200-800 text-surface-600-400 rounded-[14px] border px-5 py-6 text-sm"
					>
						Nothing on tonight. Start a session and it will be here
						tomorrow.
					</div>
				{/if}
			</section>

			<!-- ── characters ─────────────────────────────────────────
			     Portrait cards on a grid that counts columns off the
			     `home` container, never the viewport: two to a row on a
			     phone (three rows), three at 640px (two rows), then ONE row
			     at desk width — 5, 6 or 7 across. Cells past what the row
			     holds are hidden by index rather than clipped, so the shelf
			     never grows a scrollbar (principle 6) and never shows half a
			     card. The last cell is always "New or import"; the header's
			     "All N" is the way to everyone else. -->
			<section class="flex flex-col gap-3.5">
				<div class="flex items-baseline justify-between gap-4">
					<h2
						class="[font-family:var(--typo-heading--font-family)] text-base font-semibold"
					>
						Characters
					</h2>
					{#if characters.length > 0}
						<button
							type="button"
							class="text-primary-500 shrink-0 text-sm hover:underline"
							onclick={() =>
								panelsCtx.openPanel({
									key: "characters",
									toggle: false
								})}
						>
							All {characters.length}
						</button>
					{/if}
				</div>
				<div
					class="grid grid-cols-2 gap-3 overflow-hidden @min-[640px]/home:grid-cols-3 @min-[900px]/home:grid-cols-5 @min-[1100px]/home:grid-cols-6 @min-[1300px]/home:grid-cols-7"
				>
					{#each sortedCharacters.slice(0, 6) as character, i (character.id)}
						{@const src = avatarSrc(character)}
						{@const tagline = characterTagline(character)}
						<button
							type="button"
							class="group min-w-0 flex-col gap-2 text-left {SHELF_CELL[
								i
							]}"
							title="Go to character sessions"
							onclick={() => {
								panelsCtx.digest.sessionCharacterId =
									character.id
								panelsCtx.openPanel({
									key: "sessions",
									toggle: false
								})
							}}
						>
							<div
								class="bg-surface-50-950 border-surface-200-800 group-hover:border-surface-600 aspect-[3/4] overflow-hidden rounded-[14px] border transition-colors"
							>
								{#if src}
									<img
										{src}
										alt=""
										class="h-full w-full object-cover object-top"
									/>
								{:else}
									<div
										class="text-surface-500 flex h-full w-full items-center justify-center"
									>
										<Icons.UsersRound
											size={32}
											aria-hidden="true"
										/>
									</div>
								{/if}
							</div>
							<span class="flex min-w-0 flex-col">
								<span
									class="truncate text-sm leading-[1.4] font-medium"
								>
									{character.nickname ||
										character.name ||
										"Unknown"}
								</span>
								<span
									class="text-surface-600-400 min-h-[1.4em] truncate text-xs leading-[1.4]"
								>
									{tagline}
								</span>
							</span>
						</button>
					{/each}
					<button
						type="button"
						class="group flex min-w-0 flex-col gap-2 text-left"
						onclick={() => openViewToCreate("characters")}
					>
						<div
							class="border-surface-300-700 text-surface-500 group-hover:border-surface-600 flex aspect-[3/4] items-center justify-center rounded-[14px] border border-dashed transition-colors"
						>
							<Icons.Plus size={32} aria-hidden="true" />
						</div>
						<span class="flex min-w-0 flex-col">
							<span
								class="text-surface-800-200 truncate text-sm leading-[1.4] font-medium"
							>
								New or import
							</span>
							<span
								class="text-surface-600-400 min-h-[1.4em] truncate text-xs leading-[1.4]"
							>
								Write one or bring a card
							</span>
						</span>
					</button>
				</div>
			</section>

			<!-- ── playing as ─────────────────────────────────────────── -->
			{#if personas.length > 0}
				<section
					class="flex flex-wrap items-center gap-2.5"
					aria-label="Personas"
				>
					<span class="text-surface-600-400 mr-1 text-[13px]">
						Playing as
					</span>
					{#each personas as persona (persona.id)}
						<button
							type="button"
							class="bg-surface-50-950 border-surface-200-800 hover:border-surface-300-700 flex min-h-11 items-center gap-2.5 rounded-full border py-1.5 pr-3.5 pl-1.5 transition-colors"
							onclick={() => {
								// A persona is a character, so its card
								// opens in the Characters view.
								panelsCtx.digest.viewCharacterId = persona.id
								panelsCtx.openPanel({
									key: "characters",
									toggle: false
								})
							}}
						>
							<Avatar char={persona} size="sm" decorative />
							<span class="truncate text-[13px] font-medium">
								{persona.name || "Unnamed"}
							</span>
							{#if persona.isDefaultPersona}
								<span class="text-surface-600-400 text-[11px]">
									default
								</span>
							{/if}
						</button>
					{/each}
				</section>
			{/if}

			<!-- ── the quiet foot ───────────────────────────────────────
			     Both are places you go once rather than things you do on
			     this page, so they read as text at the bottom instead of
			     competing with the session cards for the eye. Anything
			     admin-gated belongs on the rail, not here. -->
			<div
				class="text-surface-600-400 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
			>
				<a href="/docs" class="hover:text-surface-800-200">
					Documentation
				</a>
				<button
					type="button"
					class="hover:text-surface-800-200 text-left"
					onclick={switchToDocumentView}
					title="Switch to a simplified, high-contrast, keyboard- and screen-reader-friendly view (Ctrl+Shift+Y)"
				>
					Document View
				</button>
			</div>
		</div>
	{/if}

	<!-- ══ the wizard ══════════════════════════════════════════════════
	     Shown until setup is complete (see `setupComplete`): Get started →
	     Choose an LLM (admins) → What to do → Character → Who you are (the
	     last two only for "Play with characters"). One decision per
	     screen; the footer carries Back and the screen's one primary. -->
	{#if dataReady && !setupComplete}
		<section
			class="preset-filled-surface-200-800 mx-auto w-full max-w-2xl overflow-hidden rounded-2xl"
			aria-labelledby="wizard-heading"
		>
			<!-- Progress: one bar per step still on this road. Finished steps
			     are buttons back to themselves; later ones are inert. -->
			<header class="border-surface-300-700 border-b px-6 py-4">
				<ol class="flex items-start gap-2" aria-label="Setup progress">
					{#each wizardSteps as step, i (step)}
						<li class="min-w-0 flex-1">
							<button
								type="button"
								class="flex w-full min-w-0 flex-col gap-1.5 rounded text-left disabled:cursor-default"
								onclick={() => {
									if (i < wizardStep) wizardStep = i
								}}
								disabled={i > wizardStep}
								aria-current={i === wizardStep
									? "step"
									: undefined}
								aria-label={i < wizardStep
									? `Back to ${WIZARD_STEP_LABELS[step]}`
									: WIZARD_STEP_LABELS[step]}
							>
								<span
									class="h-1 w-full rounded-full transition-colors {i <=
									wizardStep
										? 'bg-primary-500'
										: 'bg-surface-300-700'}"
									aria-hidden="true"
								></span>
								<span
									class="hidden truncate text-xs sm:block {i ===
									wizardStep
										? 'font-semibold'
										: 'text-surface-600-400'}"
								>
									{WIZARD_STEP_LABELS[step]}
								</span>
							</button>
						</li>
					{/each}
				</ol>
				<p class="text-surface-600-400 mt-2 text-xs sm:hidden">
					Step {wizardStep + 1} of {totalWizardSteps} · {currentWizardStep
						? WIZARD_STEP_LABELS[currentWizardStep]
						: ""}
				</p>
			</header>

			<!--
				Wizard body.

				⚠ A div, not a `<main>`. The shell already owns the page's one
				main landmark (`Layout.svelte`), and a second one nested inside
				it is announced as a duplicate — axe:
				`landmark-no-duplicate-main`. The wizard is a section of the
				page, not the page.
			-->
			<div>
				{#key wizardStep}
					<div
						class="flex flex-col gap-6 p-6 sm:p-8"
						in:fade={{ duration: 120 }}
					>
						<!-- ══ GET STARTED ══ -->
						{#if currentWizardStep === "welcome"}
							<div class="text-center">
								<Icons.Sparkles
									size={48}
									class="text-primary-500 mx-auto mb-4"
									aria-hidden="true"
								/>
								<h2
									id="wizard-heading"
									class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
								>
									{#if wizardPath === "non-admin"}
										{t("Welcome")}
									{:else}
										{t("Welcome to Serene Pub")}
									{/if}
								</h2>
								<p
									class="text-surface-600-400 mx-auto max-w-md text-base"
								>
									{#if wizardPath === "admin-first-time"}
										{t(
											"Let's set up your pub. Choose an AI to write the replies, then start your first session. It only takes a few minutes."
										)}
									{:else if wizardPath === "admin-existing"}
										{t(
											"Your pub is partly set up. A couple of quick choices and you're in your first session."
										)}
									{:else}
										{t(
											"An admin has already set up this pub. One quick choice and you're in your first session."
										)}
									{/if}
								</p>
							</div>

							<!-- Language (R5). First thing on the first step:
							     it is what the rest of the wizard is read in. -->
							<div class="mx-auto w-full max-w-sm">
								<LanguagePicker
									label={t("Language")}
									value={userSettingsCtx.settings
										?.effectiveLanguage ?? "en"}
									describedBy="wizard-language-note"
									onValueChange={chooseWizardLanguage}
								/>
								<p
									id="wizard-language-note"
									class="text-surface-600-400 mt-2 text-sm"
								>
									{#if userCtx.user?.isAdmin}
										{t(
											"This becomes the default for everyone on this pub. Anyone can change their own later in Settings."
										)}
									{:else}
										{t(
											"You can change this later in Settings."
										)}
									{/if}
								</p>
							</div>

							<!-- Optional, and only for someone with no display
							     name yet; saved as Get started moves on. -->
							<WelcomeNameField bind:value={wizardName} />

							<!-- ══ CHOOSE AN LLM ══ -->
						{:else if currentWizardStep === "llm"}
							{#if hasConnection}
								<div class="text-center">
									<Icons.CircleCheck
										size={48}
										class="text-success-500 mx-auto mb-4"
										aria-hidden="true"
									/>
									<h2
										id="wizard-heading"
										class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
									>
										{t("Your pub can reply")}
									</h2>
									<p
										class="text-surface-600-400 mx-auto max-w-md"
									>
										{#if activeConnectionName}
											Replies are written by <strong>
												{activeConnectionName}
											</strong>
											.
										{/if}
										{t(
											"You can change this later in Connections."
										)}
									</p>
								</div>
							{:else if connectionChoice === null}
								<div class="text-center">
									<h2
										id="wizard-heading"
										class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
									>
										{t("Choose an LLM")}
									</h2>
									<p
										class="text-surface-600-400 mx-auto max-w-md"
									>
										{t(
											"An LLM (large language model) is the AI that writes the replies. Choose where yours runs. You can add others later."
										)}
									</p>
								</div>
								{#if !systemSettingsCtx.settings?.isAndroidWrapper}
									<!-- Found on this computer: every model server the scan
									     reached, first — a person who already runs one should
									     not have to find it among the ways to set one up. -->
									<section
										class="flex flex-col gap-3"
										aria-labelledby="wizard-found-heading"
									>
										<div
											class="flex items-center justify-between gap-2"
										>
											<h3
												id="wizard-found-heading"
												class="text-sm font-semibold"
											>
												{t("Found on this computer")}
											</h3>
											{#if localProviders !== null}
												<button
													type="button"
													class="btn btn-sm preset-tonal-surface"
													onclick={scanLocalProviders}
												>
													<Icons.RefreshCw
														size={14}
														aria-hidden="true"
													/>
													{t("Scan again")}
												</button>
											{/if}
										</div>
										{#if localProviders === null}
											<p
												class="text-surface-600-400 flex items-center gap-2 text-sm"
												role="status"
											>
												<Icons.LoaderCircle
													size={16}
													class="animate-spin"
													aria-hidden="true"
												/>
												{t(
													"Looking for Ollama, LM Studio, llama.cpp and KoboldCPP…"
												)}
											</p>
										{:else if localProviders.length === 0}
											<p
												class="text-surface-600-400 text-sm"
												role="status"
											>
												{t(
													"No model server is running on this computer. Set one up below, or start yours and scan again."
												)}
											</p>
										{:else}
											{#each localProviders as provider, i (provider.type + provider.baseUrl)}
												{@const ready =
													provider.models.length > 0}
												{@const ProviderIcon =
													connectionTypeIcon(
														provider.type,
														Icons.Server
													)}
												<button
													type="button"
													class={CHOICE_CARD}
													onclick={() =>
														chooseDetectedProvider(
															provider
														)}
												>
													<span
														class="{ready
															? 'preset-tonal-primary'
															: 'preset-tonal-surface'} flex size-10 shrink-0 items-center justify-center rounded-xl"
														aria-hidden="true"
													>
														<ProviderIcon
															size={20}
														/>
													</span>
													<span
														class="flex min-w-0 flex-col gap-1.5"
													>
														<span
															class="flex flex-wrap items-center gap-2 font-semibold"
														>
															{provider.label}
															{#if ready && i === localProviders.findIndex((p) => p.models.length > 0)}
																<span
																	class="chip preset-tonal-primary rounded-full text-xs font-normal"
																>
																	{t(
																		"Recommended"
																	)}
																</span>
															{/if}
														</span>
														<span
															class="text-surface-600-400 text-sm"
														>
															{#if ready}
																{t(
																	"Running on this computer. Choose one of its models."
																)}
															{:else if provider.error}
																{t(
																	"Running, but it didn't list its models."
																)}
															{:else}
																{t(
																	"Running, but no chat model is loaded yet."
																)}
															{/if}
														</span>
														<span
															class="flex flex-wrap gap-1.5"
														>
															<span
																class="chip preset-tonal-surface rounded-full font-mono text-xs"
															>
																{providerHost(
																	provider.baseUrl
																)}
															</span>
															{#if ready}
																<span
																	class="chip preset-tonal-surface rounded-full text-xs"
																>
																	{provider
																		.models
																		.length}
																	{provider
																		.models
																		.length ===
																	1
																		? t(
																				"chat model"
																			)
																		: t(
																				"chat models"
																			)}
																</span>
															{/if}
															{#if provider.connectionId != null}
																<span
																	class="chip preset-tonal-surface rounded-full text-xs"
																>
																	{t(
																		"Already added"
																	)}
																</span>
															{/if}
														</span>
													</span>
												</button>
											{/each}
										{/if}
									</section>
								{/if}
								<section
									class="flex flex-col gap-3"
									aria-labelledby="wizard-setup-heading"
								>
									<h3
										id="wizard-setup-heading"
										class="text-sm font-semibold"
									>
										{systemSettingsCtx.settings
											?.isAndroidWrapper
											? t("Where it runs")
											: t("Or set one up")}
									</h3>
									{#if !systemSettingsCtx.settings?.isAndroidWrapper}
										<button
											type="button"
											class={CHOICE_CARD}
											onclick={() => {
												machineKind = "koboldcpp"
												connectionChoice = "machine"
												openConnectionsDoor(
													"setup-chat"
												)
											}}
										>
											<span
												class="preset-tonal-primary flex size-10 shrink-0 items-center justify-center rounded-xl"
												aria-hidden="true"
											>
												<KoboldCppIcon size={20} />
											</span>
											<span
												class="flex min-w-0 flex-col gap-1.5"
											>
												<span
													class="flex flex-wrap items-center gap-2 font-semibold"
												>
													{t(
														"KoboldCPP, run by Serene Pub"
													)}
													{#if localProviders !== null && !localProviders.some((p) => p.models.length > 0)}
														<span
															class="chip preset-tonal-primary rounded-full text-xs font-normal"
														>
															{t("Recommended")}
														</span>
													{/if}
												</span>
												<span
													class="text-surface-600-400 text-sm"
												>
													{t(
														"Serene Pub downloads KoboldCPP and a model that suits your computer, then runs it for you."
													)}
												</span>
												<span
													class="flex flex-wrap gap-1.5"
												>
													{#each [t("Private"), t("Free"), t("Needs about 8 GB of memory")] as chip}
														<span
															class="chip preset-tonal-surface rounded-full text-xs"
														>
															{chip}
														</span>
													{/each}
												</span>
											</span>
										</button>
										<button
											type="button"
											class={CHOICE_CARD}
											onclick={() => {
												machineKind = "ollama"
												connectionChoice = "machine"
												openManagedConnection("ollama")
											}}
										>
											<span
												class="preset-tonal-surface flex size-10 shrink-0 items-center justify-center rounded-xl"
												aria-hidden="true"
											>
												<OllamaIcon class="h-5 w-5" />
											</span>
											<span
												class="flex min-w-0 flex-col gap-1.5"
											>
												<span class="font-semibold">
													{t(
														"Ollama, managed by Serene Pub"
													)}
												</span>
												<span
													class="text-surface-600-400 text-sm"
												>
													{t(
														"Serene Pub connects to Ollama on this computer and downloads models into it for you. Ollama must be installed."
													)}
												</span>
												<span
													class="flex flex-wrap gap-1.5"
												>
													{#each [t("Private"), t("Free")] as chip}
														<span
															class="chip preset-tonal-surface rounded-full text-xs"
														>
															{chip}
														</span>
													{/each}
												</span>
											</span>
										</button>
									{/if}
									<button
										type="button"
										class={CHOICE_CARD}
										onclick={() => {
											connectionChoice = "service"
											openConnectionsDoor("service")
										}}
									>
										<span
											class="preset-tonal-surface flex size-10 shrink-0 items-center justify-center rounded-xl"
											aria-hidden="true"
										>
											<Icons.Cloud size={20} />
										</span>
										<span
											class="flex min-w-0 flex-col gap-1.5"
										>
											<span class="font-semibold">
												{t("An online service")}
											</span>
											<span
												class="text-surface-600-400 text-sm"
											>
												{t(
													"OpenAI, Anthropic, OpenRouter, Groq and more. You need an account with the service and an API key."
												)}
											</span>
											<span
												class="flex flex-wrap gap-1.5"
											>
												{#each [t("Fast"), t("Nothing to install"), t("Costs per message")] as chip}
													<span
														class="chip preset-tonal-surface rounded-full text-xs"
													>
														{chip}
													</span>
												{/each}
											</span>
										</span>
									</button>
									<button
										type="button"
										class={CHOICE_CARD}
										onclick={() => {
											connectionChoice = "service"
											openConnectionsDoor("local")
										}}
									>
										<span
											class="preset-tonal-surface flex size-10 shrink-0 items-center justify-center rounded-xl"
											aria-hidden="true"
										>
											<Icons.Cable size={20} />
										</span>
										<span
											class="flex min-w-0 flex-col gap-1.5"
										>
											<span class="font-semibold">
												{t("A custom connection")}
											</span>
											<span
												class="text-surface-600-400 text-sm"
											>
												{t(
													"A server on another machine, or one on a different address. Enter its address in Connections."
												)}
											</span>
										</span>
									</button>
								</section>
							{:else if connectionChoice === "machine"}
								<div class="text-center">
									{#if machineKind === "ollama"}
										<OllamaIcon
											class="text-primary-500 mx-auto mb-4 h-12 w-12"
										/>
									{:else}
										<KoboldCppIcon
											size={48}
											class="text-primary-500 mx-auto mb-4"
											aria-hidden="true"
										/>
									{/if}
									<h2
										id="wizard-heading"
										class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
									>
										{machineKind === "ollama"
											? t("Setting up Ollama")
											: t(
													"Setting it up on this machine"
												)}
									</h2>
									<p
										class="text-surface-600-400 mx-auto max-w-md"
									>
										{machineKind === "ollama"
											? t(
													"The Connections view shows Ollama's models: get one, then choose it for chat. Downloads can take a while."
												)
											: t(
													"The Connections view walks you through it: choose the download that suits your computer, then a model. Downloads can take a while."
												)}
									</p>
								</div>
								<p
									class="text-surface-600-400 flex items-center justify-center gap-2 text-sm"
									role="status"
								>
									<Icons.LoaderCircle
										size={16}
										class="animate-spin"
										aria-hidden="true"
									/>
									{t(
										"This page moves on by itself when the model is ready."
									)}
								</p>
							{:else if connectionChoice === "service"}
								<div class="text-center">
									<Icons.Cable
										size={48}
										class="text-primary-500 mx-auto mb-4"
										aria-hidden="true"
									/>
									<h2
										id="wizard-heading"
										class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
									>
										{t("Finish in Connections")}
									</h2>
									<p
										class="text-surface-600-400 mx-auto max-w-md"
									>
										{t(
											"Choose what you're connecting to, fill in its address or API key, then pick a model."
										)}
									</p>
								</div>
								<p
									class="text-surface-600-400 flex items-center justify-center gap-2 text-sm"
									role="status"
								>
									<Icons.LoaderCircle
										size={16}
										class="animate-spin"
										aria-hidden="true"
									/>
									{t(
										"This page moves on by itself once a model can reply."
									)}
								</p>
								<p
									class="text-surface-600-400 text-center text-sm"
								>
									{t("Added it and still waiting?")}
									<button
										type="button"
										class="anchor"
										onclick={() =>
											openConnectionsDoor("chat")}
									>
										{t("Choose which model replies")}
									</button>
								</p>
							{:else if connectionChoice === "detected" && detectedProvider}
								{@const provider = detectedProvider}
								{@const DetectedIcon = connectionTypeIcon(
									provider.type,
									Icons.Server
								)}
								<div class="text-center">
									<DetectedIcon
										size={48}
										class="text-primary-500 mx-auto mb-4"
										aria-hidden="true"
									/>
									<h2
										id="wizard-heading"
										class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
									>
										{provider.label}
									</h2>
									<p
										class="text-surface-600-400 mx-auto max-w-md"
									>
										{t("Running on this computer at")}
										<span class="font-mono">
											{providerHost(provider.baseUrl)}
										</span>
									</p>
								</div>
								{#if provider.models.length > 0}
									<fieldset
										class="mx-auto flex w-full max-w-md flex-col gap-2"
										disabled={connectingDetected}
									>
										<legend
											class="mb-2 text-sm font-semibold"
										>
											{t(
												"Choose the model that writes the replies"
											)}
										</legend>
										<div
											class="flex max-h-72 flex-col gap-2 overflow-y-auto p-0.5"
										>
											{#each provider.models as m (m.model)}
												<label
													class="{CHOICE_CARD} has-[:checked]:border-primary-500 has-[:checked]:ring-primary-500 cursor-pointer items-center has-[:checked]:ring-1"
												>
													<input
														type="radio"
														class="radio shrink-0"
														name="wizard-detected-model"
														value={m.model}
														bind:group={
															selectedDetectedModel
														}
													/>
													<span
														class="min-w-0 break-words"
													>
														{m.name}
													</span>
												</label>
											{/each}
										</div>
										<p class="text-surface-600-400 text-xs">
											{t(
												"You can switch models later in Connections."
											)}
										</p>
									</fieldset>
								{:else}
									<div
										class="bg-surface-50-950 border-surface-200-800 mx-auto flex max-w-md flex-col items-center gap-3 rounded-[14px] border p-4 text-center"
									>
										<p class="text-sm">
											{#if provider.error}
												{t(
													"It's running, but it didn't say which models it has. Check that it has finished starting, then check again."
												)}
											{:else}
												{t(
													"It's running, but no chat model is loaded yet. Load one, then check again."
												)}
											{/if}
										</p>
										<div
											class="flex flex-wrap justify-center gap-2"
										>
											{#if provider.type === CONNECTION_TYPE.OLLAMA}
												<button
													type="button"
													class="btn btn-sm preset-tonal-surface"
													onclick={() => {
														machineKind = "ollama"
														connectionChoice =
															"machine"
														openManagedConnection(
															"ollama"
														)
													}}
												>
													<Icons.Download
														size={14}
														aria-hidden="true"
													/>
													{t("Get a model")}
												</button>
											{/if}
											<button
												type="button"
												class="btn btn-sm preset-tonal-surface"
												onclick={scanLocalProviders}
												disabled={localProviders ===
													null}
											>
												<Icons.RefreshCw
													size={14}
													class={localProviders ===
													null
														? "animate-spin"
														: ""}
													aria-hidden="true"
												/>
												{t("Check again")}
											</button>
										</div>
									</div>
								{/if}
							{/if}

							<!-- ══ WHAT TO DO ══ -->
						{:else if currentWizardStep === "purpose"}
							<div class="text-center">
								<h2
									id="wizard-heading"
									class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
								>
									{t("What would you like to do?")}
								</h2>
								<p
									class="text-surface-600-400 mx-auto max-w-md"
								>
									{t(
										"You can do both later. This is just where to start."
									)}
								</p>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								<button
									type="button"
									class="{CHOICE_CARD} flex-col {wizardPurpose ===
									'guide'
										? 'ring-primary-500 ring-2'
										: ''}"
									onclick={startGuideSession}
									disabled={!guidePick || startingSession}
								>
									<span
										class="preset-tonal-primary flex size-10 shrink-0 items-center justify-center rounded-xl"
										aria-hidden="true"
									>
										{#if startingSession && wizardPurpose === "guide"}
											<Icons.LoaderCircle
												size={20}
												class="animate-spin"
											/>
										{:else}
											<Icons.Compass size={20} />
										{/if}
									</span>
									<span class="flex min-w-0 flex-col gap-1.5">
										<span class="font-semibold">
											{t("Talk to an AI")}
										</span>
										<span
											class="text-surface-600-400 text-sm"
										>
											{#if guidePick}
												{t(
													"A calm conversation with Serene, Serene Pub's guide. Ask her anything about the app."
												)}
											{:else}
												{t(
													"The Guide is switched off on this pub."
												)}
											{/if}
										</span>
									</span>
								</button>
								<button
									type="button"
									class="{CHOICE_CARD} flex-col {wizardPurpose ===
									'chat'
										? 'ring-primary-500 ring-2'
										: ''}"
									onclick={chooseChat}
									disabled={startingSession}
								>
									<span
										class="preset-tonal-primary flex size-10 shrink-0 items-center justify-center rounded-xl"
										aria-hidden="true"
									>
										<Icons.Drama size={20} />
									</span>
									<span class="flex min-w-0 flex-col gap-1.5">
										<span class="font-semibold">
											{t("Play with characters")}
										</span>
										<span
											class="text-surface-600-400 text-sm"
										>
											{t(
												"Pick a character for the AI to play, choose who you are, and start a story together."
											)}
										</span>
									</span>
								</button>
							</div>

							<!-- ══ CHARACTER ══ -->
						{:else if currentWizardStep === "character"}
							<div class="text-center">
								<h2
									id="wizard-heading"
									class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
								>
									{t("Pick a character")}
								</h2>
								<p
									class="text-surface-600-400 mx-auto max-w-md"
								>
									{t(
										"The AI plays this character. Pick one, or add your own."
									)}
								</p>
							</div>
							{#if wizardCharacters.length > 0}
								<div
									class="grid gap-2 sm:grid-cols-2"
									role="group"
									aria-label={t("Your characters")}
								>
									{#each wizardCharacters.slice(0, 12) as character (character.id)}
										<button
											type="button"
											class="{CHOICE_CARD} items-center gap-3 p-3 {selectedCharacterId ===
											character.id
												? 'ring-primary-500 ring-2'
												: ''}"
											aria-pressed={selectedCharacterId ===
												character.id}
											onclick={() =>
												(selectedCharacterId =
													character.id ?? null)}
										>
											<Avatar
												char={character}
												size="md"
												decorative
											/>
											<span class="min-w-0 flex-1">
												<span
													class="block truncate font-semibold"
												>
													{character.nickname ||
														character.name ||
														"Unnamed"}
												</span>
												{#if characterTagline(character)}
													<span
														class="text-surface-600-400 block truncate text-sm"
													>
														{characterTagline(
															character
														)}
													</span>
												{/if}
											</span>
											{#if selectedCharacterId === character.id}
												<Icons.Check
													size={18}
													class="text-primary-500 shrink-0"
													aria-hidden="true"
												/>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
							<div class="flex flex-col gap-2">
								{#if wizardCharacters.length > 0}
									<h3 class="text-surface-600-400 text-sm">
										{t("Or add one")}
									</h3>
								{/if}
								<div class="grid gap-2 sm:grid-cols-3">
									<button
										type="button"
										class="{CHOICE_CARD} flex-col gap-1.5 p-3"
										onclick={() =>
											(showCharacterCreator = true)}
									>
										<Icons.UserPlus
											size={20}
											class="text-primary-500"
											aria-hidden="true"
										/>
										<span class="font-semibold">
											{t("Create one")}
										</span>
										<span
											class="text-surface-600-400 text-xs"
										>
											{t(
												"A name, a picture and a personality."
											)}
										</span>
									</button>
									<button
										type="button"
										class="{CHOICE_CARD} flex-col gap-1.5 p-3"
										onclick={() =>
											// The Library opens beside the wizard, which
											// stays: an import lands in the list above.
											panelsCtx.openView("library", {
												toggle: false
											})}
									>
										<Icons.Library
											size={20}
											class="text-primary-500"
											aria-hidden="true"
										/>
										<span class="font-semibold">
											{t("Browse the library")}
										</span>
										<span
											class="text-surface-600-400 text-xs"
										>
											{t(
												"Ready-made characters from the community."
											)}
										</span>
									</button>
									<div
										class="bg-surface-50-950 border-surface-200-800 flex flex-col gap-1.5 rounded-[14px] border p-3"
									>
										<span
											class="flex items-center gap-2 font-semibold"
										>
											<Icons.Upload
												size={20}
												class="text-primary-500"
												aria-hidden="true"
											/>
											{t("Import a card")}
										</span>
										{#if wizardImportingCharacterCard}
											<span
												class="flex items-center gap-2 text-sm"
												role="status"
											>
												<Icons.LoaderCircle
													size={14}
													class="animate-spin"
													aria-hidden="true"
												/>
												{t("Importing…")}
											</span>
										{:else}
											<FileDropzone
												name="wizard-char-card"
												accept=".png,.apng,.jpeg,.jpg,.webp,.json,.charx"
												class="border-surface-300-700 hover:bg-surface-100-900 flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-xs"
												onFileAccept={handleCharacterCardImport}
											/>
										{/if}
									</div>
								</div>
								{#if userCtx.user?.isAdmin && !systemSettingsCtx.settings?.isAndroidWrapper}
									<p class="text-surface-600-400 text-sm">
										{t("Coming from SillyTavern?")}
										<button
											type="button"
											class="anchor"
											onclick={() => {
												closeWizard()
												// Settings › Import, the old /import page's home
												// since owner note 23 (2026-10-02).
												panelsCtx.digest.settingsSection = "import"
												panelsCtx.openPanel({ key: "settings", toggle: false })
											}}
										>
											{t(
												"Import your characters and personas"
											)}
										</button>
									</p>
								{/if}
							</div>

							<!-- ══ WHO YOU ARE ══ -->
						{:else if currentWizardStep === "persona"}
							<div class="text-center">
								<h2
									id="wizard-heading"
									class="mb-3 [font-family:var(--typo-heading--font-family)] text-2xl font-semibold"
								>
									{t("Who are you in the story?")}
								</h2>
								<p
									class="text-surface-600-400 mx-auto max-w-md"
								>
									{t(
										"This is your persona, the character you play. The AI sees its name and description."
									)}
								</p>
							</div>
							{#if personas.length > 0}
								<div
									class="grid gap-2 sm:grid-cols-2"
									role="group"
									aria-label={t("Your personas")}
								>
									{#each personas.slice(0, 12) as persona (persona.id)}
										<button
											type="button"
											class="{CHOICE_CARD} items-center gap-3 p-3 {selectedPersonaId ===
											persona.id
												? 'ring-primary-500 ring-2'
												: ''}"
											aria-pressed={selectedPersonaId ===
												persona.id}
											onclick={() =>
												(selectedPersonaId =
													persona.id ?? null)}
										>
											<Avatar
												char={persona}
												size="md"
												decorative
											/>
											<span class="min-w-0 flex-1">
												<span
													class="block truncate font-semibold"
												>
													{persona.nickname ||
														persona.name ||
														"Unnamed"}
												</span>
												{#if characterTagline(persona)}
													<span
														class="text-surface-600-400 block truncate text-sm"
													>
														{characterTagline(
															persona
														)}
													</span>
												{/if}
											</span>
											{#if selectedPersonaId === persona.id}
												<Icons.Check
													size={18}
													class="text-primary-500 shrink-0"
													aria-hidden="true"
												/>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
							<div class="flex flex-col gap-2">
								{#if personas.length > 0}
									<h3 class="text-surface-600-400 text-sm">
										{t("Or add one")}
									</h3>
								{/if}
								<div class="grid gap-2 sm:grid-cols-3">
									<button
										type="button"
										class="{CHOICE_CARD} flex-col gap-1.5 p-3"
										onclick={createSamplePersona}
									>
										<Icons.User
											size={20}
											class="text-primary-500"
											aria-hidden="true"
										/>
										<span class="font-semibold">
											{t("Just call me “You”")}
										</span>
										<span
											class="text-surface-600-400 text-xs"
										>
											{t(
												"The quickest start. Fill in details later."
											)}
										</span>
									</button>
									<button
										type="button"
										class="{CHOICE_CARD} flex-col gap-1.5 p-3"
										onclick={() =>
											(showPersonaCreator = true)}
									>
										<Icons.UserPlus
											size={20}
											class="text-primary-500"
											aria-hidden="true"
										/>
										<span class="font-semibold">
											{t("Create one")}
										</span>
										<span
											class="text-surface-600-400 text-xs"
										>
											{t(
												"Your name, a picture and a few lines about you."
											)}
										</span>
									</button>
									<div
										class="bg-surface-50-950 border-surface-200-800 flex flex-col gap-1.5 rounded-[14px] border p-3"
									>
										<span
											class="flex items-center gap-2 font-semibold"
										>
											<Icons.Upload
												size={20}
												class="text-primary-500"
												aria-hidden="true"
											/>
											{t("Import a card")}
										</span>
										{#if wizardImportingPersonaCard}
											<span
												class="flex items-center gap-2 text-sm"
												role="status"
											>
												<Icons.LoaderCircle
													size={14}
													class="animate-spin"
													aria-hidden="true"
												/>
												{t("Importing…")}
											</span>
										{:else}
											<FileDropzone
												name="wizard-persona-card"
												accept=".png,.apng,.jpeg,.jpg,.webp,.json,.charx"
												class="border-surface-300-700 hover:bg-surface-100-900 flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-xs"
												onFileAccept={handlePersonaCardImport}
											/>
										{/if}
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/key}
			</div>

			<!-- Footer: Back on the left, the screen's one primary on the right. -->
			<footer class="border-surface-300-700 border-t px-6 py-4">
				<div class="flex items-center justify-between gap-4">
					<!-- Back — out of an LLM road to its doors first, else the
					     previous step. -->
					{#if wizardStep > 0 || connectionChoice !== null}
						<button
							type="button"
							class="btn preset-tonal-surface"
							disabled={startingSession}
							onclick={() => {
								if (
									currentWizardStep === "llm" &&
									connectionChoice !== null
								) {
									connectionChoice = null
								} else {
									prevWizardStep()
								}
							}}
						>
							<Icons.ChevronLeft size={16} aria-hidden="true" />
							{t("Back")}
						</button>
					{:else}
						<div></div>
					{/if}

					{#if currentWizardStep === "welcome"}
						<button
							type="button"
							class="btn preset-filled-primary-500"
							onclick={leaveWelcomeStep}
						>
							{t("Get started")}
							<Icons.ChevronRight size={16} aria-hidden="true" />
						</button>
					{:else if currentWizardStep === "llm"}
						{#if hasConnection}
							<button
								type="button"
								class="btn preset-filled-primary-500"
								onclick={nextWizardStep}
							>
								{t("Continue")}
								<Icons.ChevronRight
									size={16}
									aria-hidden="true"
								/>
							</button>
						{:else if connectionChoice === "detected" && (detectedProvider?.models.length ?? 0) > 0}
							<button
								type="button"
								class="btn preset-filled-primary-500"
								disabled={!selectedDetectedModel ||
									connectingDetected}
								onclick={useDetectedModel}
							>
								{#if connectingDetected}
									<Icons.Loader2
										size={16}
										class="animate-spin"
										aria-hidden="true"
									/>
									{t("Connecting…")}
								{:else}
									<Icons.Plug size={16} aria-hidden="true" />
									{t("Use this model")}
								{/if}
							</button>
						{:else if connectionChoice === "machine"}
							<button
								type="button"
								class="btn preset-tonal-surface"
								onclick={() =>
									machineKind === "ollama"
										? openManagedConnection("ollama")
										: openConnectionsDoor("setup-chat")}
							>
								{t("Open the setup again")}
							</button>
						{:else if connectionChoice === "service"}
							<button
								type="button"
								class="btn preset-tonal-surface"
								onclick={() => openPanel("connections")}
							>
								{t("Open Connections")}
							</button>
						{/if}
					{:else if currentWizardStep === "character"}
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={selectedCharacterId == null}
							onclick={() => {
								if (selectedPersonaId == null)
									selectedPersonaId = defaultPersonaId
								nextWizardStep()
							}}
						>
							{t("Continue")}
							<Icons.ChevronRight size={16} aria-hidden="true" />
						</button>
					{:else if currentWizardStep === "persona"}
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={selectedCharacterId == null ||
								selectedPersonaId == null ||
								startingSession}
							onclick={startChatSession}
						>
							{#if startingSession}
								<Icons.LoaderCircle
									size={16}
									class="animate-spin"
									aria-hidden="true"
								/>
							{:else}
								<Icons.Play size={16} aria-hidden="true" />
							{/if}
							{t("Start the session")}
						</button>
					{/if}
				</div>
			</footer>
		</section>
		<!-- Under every wizard step: the Help view at /docs, as the
		     dashboard's foot links it. -->
		<p class="text-surface-600-400 max-w-2xl text-center text-sm">
			<a href="/docs" class="hover:text-surface-800-200 underline">
				{t(
					"You can browse the entire documentation in the app at any time."
				)}
			</a>
		</p>
	{/if}
</div>

<!-- Modals -->
<!-- The wizard's Character step: a new character is selected there. -->
<CharacterCreator
	bind:open={showCharacterCreator}
	onOpenChange={(e) => {
		showCharacterCreator = e.open
	}}
	onCreated={(character) => {
		if (currentWizardStep === "character")
			selectedCharacterId = character.id
	}}
/>

<!-- The persona creator IS the character creator: a persona is a character
	the user voices. `onCreated` flags the new row as this user's persona and
	selects it on the wizard's Who you are step. -->
<CharacterCreator
	bind:open={showPersonaCreator}
	initial={{ isPersona: true }}
	onOpenChange={(e) => {
		showPersonaCreator = e.open
	}}
	onCreated={(character) => {
		adoptAsPersona(character.id)
		selectedPersonaId = character.id
	}}
/>

{#if bindingLinkerData}
	<BindingLinkerModal
		bind:open={bindingLinkerOpen}
		orphanedBindings={bindingLinkerData.orphanedBindings}
		onOpenChange={(e) => (bindingLinkerOpen = e.open)}
		onDone={() => (bindingLinkerData = null)}
	/>
{/if}
