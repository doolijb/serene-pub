<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * ONE model finder — one search box over every recommended list this pub
	 * can read and over Hugging Face, scoped by what the model is FOR and
	 * where it should land.
	 *
	 * Concept ruling R3 (2026-09-17). Before it there were two Available tabs
	 * that could not see each other: the KoboldCPP manager's, which searched
	 * GGUFs and knew about VRAM tiers, and the Ollama manager's, which
	 * searched the same Hub for the same files and knew about none of it. A
	 * person who wanted "a chat model" had to already know which runtime they
	 * were shopping for before either screen would talk to them — and neither
	 * screen could offer the local ONNX lists at all, which lived in a third
	 * place again.
	 *
	 * The questions this view asks, in order: what are you looking for (the
	 * search box), then ONE sentence — *[Chat] models for [KoboldCPP] · sized
	 * for [8 GB]* — whose brackets are what it is FOR, where it should go and
	 * how much memory the machine has, and then the results. A part the host
	 * or the door fixed is plain words, not a menu. A result's name opens the
	 * model's own page in this pane (`FinderModelPage`); Back returns to the
	 * results with the query and the scroll kept, and **Get** on a row keeps
	 * its inline quant picker.
	 *
	 * It is never a place of its own (design 2026-10-09 C.1): it is the Models
	 * view's detail pane (**Get a model**), opened from every finder door —
	 * the view's toolbar, a runtime's **Get more…** door (destination
	 * pre-selected, the scope part of the sentence narrowed to what that connection can hold)
	 * and a loadout's Model card (scoped to that job) — and it is the Set up
	 * chat stepper's Model step. The managed and ONNX connection views carry
	 * no Get tab (plan 2026-10-29 D1). Getting a model closes nothing — the
	 * downloads tray shows the progress.
	 *
	 * ## Quants are always choosable (plan 2026-10-29 D2)
	 *
	 * Every row carries its files as `quants` (`finder.ts` reconciles the
	 * sources) and `quantChoice` decides: more than one opens the quant picker
	 * with the recommended one pre-selected, exactly one shows its name on the
	 * row and downloads at once, none downloads the list's own tag and shows
	 * the list's note. An ONNX or audio *precision* is chosen the same way.
	 *
	 * ## Presence on every row (D3)
	 *
	 * `models:presence` is asked once per row set (signature-guarded), and
	 * every row — Hugging Face rows included — says whether this destination
	 * already holds the file ("You have this on …") or another runtime does
	 * ("Also on …", and the button reads "Get for … too").
	 *
	 * ## What decides the press is whether it will run
	 *
	 * Every catalogue quotes a size and none of them says what a size means on
	 * the machine in front of the person. The **memory tier** (`memoryTier.ts`)
	 * turns all of them into one of three words, and it is the reason the row
	 * has a gold chip, the reason exactly one Get button is gold, and the
	 * whole second line of the quant picker. "Not sure" is a real answer and
	 * suppresses every one of those rather than guessing. When the person has
	 * never answered, the machine's detected graphics card proposes a tier and
	 * a sentence says why; the moment they pick one, their answer wins.
	 *
	 * ## Nothing here is a new event
	 *
	 * Four existing feeds, reconciled by `finder.ts` at this seam the way
	 * `downloads.svelte.ts` reconciles the four progress feeds. ⚠ The Hub
	 * searches are rate-limited INSTANCE-WIDE (`loginRateLimit`), so the box
	 * is debounced by 400 ms and the emit is signature-guarded — a list push
	 * arriving mid-type must not re-run a search nobody retyped.
	 *
	 * ## What is deliberately absent
	 *
	 * - Speech and Transcription have no Hugging Face group: the rows are the
	 *   audio packages (`audiocpp:listPackages`), one per model, never a
	 *   free-text search that could fetch a chat model into a speech slot.
	 * - An Ollama destination asks `ollama:recommendedModels` by kind (chat or
	 *   embedding), so Embeddings gets its own half of the list (owner ruling
	 *   2026-09-25) rather than chat models filed under it.
	 * - A GGUF row's second line quotes its parameter size, not a context
	 *   window: neither search carries one.
	 * - An Ollama Hub row quotes no byte size, because its search does not
	 *   return one — so those quants carry no fit hint rather than a computed
	 *   one.
	 */
	import { getContext, tick, untrack } from "svelte"
	import { useMachineHardware } from "./useMachineHardware.svelte"
	import { detectedMemoryTier } from "./hardwarePicks"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import QuantPicker from "./QuantPicker.svelte"
	import FinderModelPage from "./FinderModelPage.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { SvelteMap } from "svelte/reactivity"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { ONNX_DTYPES } from "$lib/shared/constants/onnxDtypes"
	import { notify } from "$lib/client/utils/notify"
	import { useConnections } from "$lib/client/contexts/connections.svelte"
	import { downloads, type DownloadItem } from "./downloads.svelte"
	import { formatProgress } from "./modelManagement"
	import { downloadParams } from "$lib/client/components/koboldcppManager/availableTab"
	import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
	import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"
	import {
		ADD_BY_ID_DEFAULT_DTYPE,
		DEFAULT_SCOPE,
		FINDER_SCOPES,
		audioFamilyRows,
		audioLiveMatch,
		audioRuntimeFor,
		defaultQuant,
		destinationsFor,
		hubRepoOf,
		kcppDownloadKind,
		kcppHubRows,
		kcppKindForScope,
		kcppRecommendedRows,
		kcppSpeechDownloads,
		landingNote,
		modelPageFacts,
		ollamaHubRows,
		ollamaRecommendedRows,
		onnxRecommendedRows,
		pickDestination,
		presenceBatches,
		presenceFor,
		presenceNote,
		presenceSignature,
		primaryRowIndex,
		quantChoice,
		quantLine,
		quantsFromKcpp,
		quantsFromOllama,
		quantsForAddById,
		scopeForCapability,
		scopePhrase,
		repoTitle,
		secondLine,
		SerialAsk,
		type FinderRow,
		type FinderScope,
		type HubRow,
		type OllamaHubResult,
		type OllamaRecommended,
		type PresenceHolder,
		type PresenceQuery,
		type QuantFile,
		withHubFileSizes
	} from "./finder"
	import {
		MEMORY_TIERS,
		readStoredMemoryTier,
		tierLabel,
		writeMemoryTier,
		type MemoryTier
	} from "./memoryTier"
	import { kcppInstallState } from "./managedConnectionView"

	interface Props {
		/** Scope the search to one transform, when the caller had one in mind. */
		capability?: string
		/** Scope it to one destination. */
		connectionId?: number
		/**
		 * Where Back goes when the finder stands alone. Only then does it draw
		 * a nav header and one scroller of its own, as the Models view's
		 * detail pane; inside the Set up chat stepper the host's header is
		 * used.
		 */
		onBack?: () => void
		/**
		 * Rendered inside another view that owns the header (the Set up chat
		 * stepper): no nav header of its own, and the scope row is hidden
		 * because the host already decided what the model is for.
		 */
		embedded?: boolean
		/**
		 * Open a connection — the ONNX destination's "N already on this
		 * machine" line goes to the list that holds them.
		 */
		onOpenConnection?: (connectionId: number) => void
	}
	let {
		capability,
		connectionId,
		onBack,
		embedded = false,
		onOpenConnection
	}: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user?: SelectUser } | undefined = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	const koboldCppSettingsCtx: KoboldCppSettingsCtx | undefined = getContext(
		"koboldCppSettingsCtx"
	)
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	/** On a machine without the ONNX runtime, ONNX destinations come disabled. */
	const localOnnx = $derived(
		systemSettingsCtx?.settings?.localOnnxAvailability
	)

	// ── What the person is asking for ───────────────────────────────────────

	let query = $state("")
	/** The box, 400 ms behind. Only this drives an emit. */
	let debouncedQuery = $state("")
	$effect(() => {
		const next = query
		const timer = setTimeout(() => (debouncedQuery = next), 400)
		return () => clearTimeout(timer)
	})

	/**
	 * A hand-set scope wins; otherwise the caller's capability, read through a
	 * derived so a later one still lands.
	 */
	let scopeOverride = $state<FinderScope | null>(null)
	const scope = $derived(
		scopeOverride ?? scopeForCapability(capability) ?? DEFAULT_SCOPE
	)

	// The person's own answer, once they have given one; read on mount rather
	// than at module scope because `localStorage` does not exist during SSR.
	// Until then the machine's detected tier (if any) is proposed, with its
	// reason, and "Not sure" is what a browser that detects nothing keeps.
	let pickedTier = $state<MemoryTier | null>(null)
	$effect(() => {
		pickedTier = readStoredMemoryTier()
	})
	const hardware = useMachineHardware()
	const detected = $derived(detectedMemoryTier(hardware.current))
	const tier = $derived<MemoryTier>(pickedTier ?? detected?.tier ?? "unsure")
	const tierReason = $derived(
		pickedTier == null ? (detected?.reason ?? null) : null
	)
	let tierOpen = $state(false)
	let scopeOpen = $state(false)
	let destinationOpen = $state(false)
	/** One look for the three triggers of the sentence: tonal, never gold. */
	const sentenceTrigger =
		"inline-flex min-h-9 items-center gap-0.5 rounded-base px-2 font-medium preset-tonal-surface pointer-coarse:min-h-11"
	function pickTier(next: MemoryTier) {
		pickedTier = next
		writeMemoryTier(next)
		tierOpen = false
	}

	// ── The list, and the destinations derived from it ──────────────────────

	/** The list is the connections context's (contexts/connections.svelte.ts). */
	const conns = useConnections()
	const connectionsList = $derived(conns.list)

	const destinations = $derived(
		destinationsFor(scope, connectionsList, { localOnnx })
	)
	/**
	 * The scope part's options. Asked for a connection (a runtime's **Get
	 * more…** door), only what THAT connection can hold — a KoboldCPP door
	 * offers Chat, Images and Speech, never Embeddings — while the destination
	 * part stays, with that connection pre-selected. A connection that no
	 * scope lists leaves all of them, so the options are never empty.
	 */
	const scopeOptions = $derived.by(() => {
		if (connectionId == null) return FINDER_SCOPES
		const narrowed = FINDER_SCOPES.filter((option) =>
			destinationsFor(option.value, connectionsList, {
				localOnnx
			}).some((d) => d.connectionId === connectionId)
		)
		return narrowed.length ? narrowed : FINDER_SCOPES
	})
	let destinationOverride = $state<string | null>(null)
	const scopeLabel = $derived(
		FINDER_SCOPES.find((option) => option.value === scope)?.label ?? ""
	)
	const destination = $derived.by(() => {
		const chosen = destinations.find((d) => d.id === destinationOverride)
		return (
			chosen ??
			pickDestination(destinations, connectionId, (d) =>
				// The managed KoboldCPP takes a file only once it is set up
				// and switched on — the same reading its row makes.
				d.kind === "koboldcpp"
					? kcppInstallState(koboldCppSettingsCtx?.settings) ===
						"ready"
					: true
			)
		)
	})

	/** The list row a destination points at, for its models. */
	const destinationRow = $derived(
		destination
			? (connectionsList.find((c) => c.id === destination.connectionId) ??
					null)
			: null
	)

	/**
	 * Which of this destination's models are already here.
	 *
	 * ⚠ KoboldCPP is read across BOTH managed rows: the text and image
	 * directories are two connections of one install (U1 folds the second into
	 * the first's view), and a file is on disk whichever of them lists it.
	 */
	const presentModels = $derived.by(() => {
		const out = new Set<string>()
		if (!destination) return out
		const rows =
			destination.kind === "koboldcpp"
				? connectionsList.filter((c) => isKoboldCppManagedType(c.type))
				: destinationRow
					? [destinationRow]
					: []
		for (const row of rows)
			for (const model of row.models ?? []) out.add(model.model)
		return out
	})

	// ── The catalogues ──────────────────────────────────────────────────────

	let kcppRecommended = $state<
		Sockets.KoboldCPP.RecommendedModels.RecommendedModel[]
	>([])
	let kcppRecommendedFailed = $state(false)
	let kcppSearch = $state<Sockets.KoboldCPP.SearchModels.ModelResult[]>([])
	let ollamaRecommended = $state<OllamaRecommended[]>([])
	let ollamaSearch = $state<OllamaHubResult[]>([])
	/** audio.cpp's packages grouped by family; null until the list answers. */
	let audioFamilies = $state<Sockets.AudioCpp.PackageFamily[] | null>(null)
	let audioFailed = $state(false)
	let loadingRecommended = $state(false)
	let searching = $state(false)
	let searchError = $state<string | null>(null)

	/**
	 * Neither list nor search echoes what was asked, so each is one ask at a
	 * time: a reply that lands while a newer ask waits is stale and dropped.
	 */
	const recommendedAsks = new SerialAsk()
	const searchAsks = new SerialAsk()

	function handleKcppRecommended(
		msg: Sockets.KoboldCPP.RecommendedModels.Response
	) {
		if (recommendedAsks.settle()) return
		kcppRecommended = msg.models ?? []
		kcppRecommendedFailed = !!msg.failed
		loadingRecommended = false
	}
	function handleKcppRecommendedError() {
		if (recommendedAsks.settle()) return
		kcppRecommended = []
		kcppRecommendedFailed = true
		loadingRecommended = false
	}
	function handleKcppSearch(msg: Sockets.KoboldCPP.SearchModels.Response) {
		if (searchAsks.settle()) return
		kcppSearch = msg.models ?? []
		searching = false
		searchError = null
	}
	function handleOllamaRecommended(
		msg: Sockets.Ollama.RecommendedModels.Response
	) {
		if (recommendedAsks.settle()) return
		ollamaRecommended = (msg.recommendedModels ?? []) as OllamaRecommended[]
		loadingRecommended = false
	}
	function handleOllamaSearch(
		msg: Sockets.Ollama.SearchAvailableModels.Response
	) {
		if (searchAsks.settle()) return
		ollamaSearch = (msg.models ?? []) as OllamaHubResult[]
		searching = false
		searchError = msg.error ?? null
	}
	function handleAudioList(msg: Sockets.AudioCpp.ListPackages.Response) {
		audioFamilies = msg.families ?? []
		audioFailed = false
	}
	function handleAudioListError() {
		audioFailed = true
		if (audioFamilies === null) audioFamilies = []
	}
	function handleSearchError(msg: Sockets.ErrorResponse) {
		if (searchAsks.settle()) return
		searching = false
		kcppSearch = []
		ollamaSearch = []
		searchError = msg?.error ?? "Hugging Face would not answer."
	}
	/** A download that would not start says so where the press was. */
	function handleDownloadError(msg: Sockets.ErrorResponse) {
		notify.error({
			source: "connections:downloadModel",
			title: msg?.error ?? "Couldn't start that download"
		})
	}

	// ── Add from Hugging Face by id (local ONNX only) ───────────────────────

	let hubOpen = $state(false)
	let hubId = $state("")
	let hubError = $state<string | null>(null)
	let hubPending = $state(false)
	/** The precision the added model is fetched in; always sent. */
	let hubDtype = $state<string>(ADD_BY_ID_DEFAULT_DTYPE)
	const hubDtypes = quantsForAddById(ONNX_DTYPES, ADD_BY_ID_DEFAULT_DTYPE)
	function submitHub() {
		const id = hubId.trim()
		if (!id || !destination) return
		hubError = null
		hubPending = true
		socket.emit("connections:addHubModel", {
			id: destination.connectionId,
			hubId: id,
			dtype: hubDtype
		})
	}
	function handleHubAdded() {
		if (!hubPending) return
		// The refreshed list arrives on `connections:list`; all this does is
		// close the form it was typed into.
		hubPending = false
		hubError = null
		hubId = ""
		hubOpen = false
	}
	function handleHubError(msg: Sockets.ErrorResponse) {
		if (!hubPending) return
		hubPending = false
		hubError = msg?.error ?? "The Hub would not confirm that id."
	}

	/**
	 * Every key this view holds, declared ABOVE the effects that emit —
	 * effects run in creation order and a request flushes the pending interest
	 * sync, so a declaration made below would miss the flush its own first
	 * reply rides on.
	 *
	 * `koboldcpp:` and `ollama:` are restricted (admin-only) interest, so a
	 * non-admin declares neither rather than collecting a refusal per key.
	 */
	$effect(() => {
		const releases = [
			declareInterest<"connections:addHubModel">(
				"connections:addHubModel",
				handleHubAdded
			),
			declareInterest<"connections:addHubModel:error">(
				"connections:addHubModel:error",
				handleHubError
			),
			declareInterest<"connections:downloadModel:error">(
				"connections:downloadModel:error",
				handleDownloadError
			)
		]
		return () => releases.forEach((release) => release())
	})
	$effect(() => {
		if (!isAdmin) return
		const releases = [
			declareInterest<"koboldcpp:recommendedModels">(
				"koboldcpp:recommendedModels",
				handleKcppRecommended
			),
			declareInterest<"koboldcpp:recommendedModels:error">(
				"koboldcpp:recommendedModels:error",
				handleKcppRecommendedError
			),
			declareInterest<"koboldcpp:searchModels">(
				"koboldcpp:searchModels",
				handleKcppSearch
			),
			declareInterest<"koboldcpp:searchModels:error">(
				"koboldcpp:searchModels:error",
				handleSearchError
			),
			declareInterest<"koboldcpp:downloadModel:error">(
				"koboldcpp:downloadModel:error",
				handleDownloadError
			),
			declareInterest<"ollama:recommendedModels">(
				"ollama:recommendedModels",
				handleOllamaRecommended
			),
			declareInterest<"ollama:searchAvailableModels">(
				"ollama:searchAvailableModels",
				handleOllamaSearch
			),
			declareInterest<"ollama:searchAvailableModels:error">(
				"ollama:searchAvailableModels:error",
				handleSearchError
			),
			declareInterest<"ollama:pullModel:error">(
				"ollama:pullModel:error",
				handleDownloadError
			),
			declareInterest<"audiocpp:listPackages">(
				"audiocpp:listPackages",
				handleAudioList
			),
			declareInterest<"audiocpp:listPackages:error">(
				"audiocpp:listPackages:error",
				handleAudioListError
			),
			// `audiocpp:downloadPackage:error` is Layout's to toast (it is not
			// in its handled set); declaring it here too would toast twice.
			declareInterest<"models:presence">(
				"models:presence",
				handlePresence
			),
			declareInterest<"models:presence:error">(
				"models:presence:error",
				handlePresenceError
			),
			// The model page's Hub card. Its failures ride the reply's
			// `error`, so there is no `:error` key, and nothing toasts.
			declareInterest<"models:hubCard">("models:hubCard", handleHubCard)
		]
		return () => releases.forEach((release) => release())
	})

	/**
	 * The manager feeds, so a row that is already arriving shows its bar here
	 * rather than only in the tray. Subscriber-counted — the index may be
	 * holding the same feeds beside this view.
	 */
	$effect(() => downloads.subscribe({ admin: isAdmin }))
	$effect(() => downloads.setOnnx(connectionsList))

	// The asks. Signature-guarded, because these effects also read the LIST,
	// and a list push must not re-ask Hugging Face for a search nobody retyped
	// — the Hub searches are rate-limited instance-wide.
	$effect(() => {
		conns.requestList()
	})

	const HUB_PAGE = 10
	/** Four chips is what fits beside a Get button before the row wraps twice. */
	const TAGS_SHOWN = 4
	let hubShown = $state(HUB_PAGE)

	let lastRecommendedAsk = ""
	$effect(() => {
		const kind = destination?.kind
		const current = scope
		if (!kind || !isAdmin) return
		// Local ONNX has no second list to fetch: its catalogue is already
		// projected into the connection's own models by the sync. The audio
		// scopes read `audiocpp:listPackages` instead (below).
		if (kind === "onnx" || audioRuntime) return
		// The Ollama list now has two halves in one file — chat, and
		// embedding models tagged `embedding` (owner ruling 2026-09-25) — so
		// both scopes an Ollama connection can take get a group.
		if (kind === "ollama" && current !== "chat" && current !== "embeddings")
			return
		const signature = `${kind}:${current}`
		if (signature === lastRecommendedAsk) return
		lastRecommendedAsk = signature
		loadingRecommended = true
		// ⚠ Emptied on the way out, not on the way in: each list is one
		// variable for two kinds, so a scope switch would otherwise show the
		// previous kind's catalogue under the new one until the reply landed.
		// The Ollama list had one kind until embeddings and was never emptied.
		kcppRecommended = []
		kcppRecommendedFailed = false
		ollamaRecommended = []
		recommendedAsks.ask(() => {
			if (kind === "koboldcpp")
				socket.emit("koboldcpp:recommendedModels", {
					kind: kcppKindForScope(current) ?? "text"
				})
			else
				socket.emit("ollama:recommendedModels", {
					kind: current === "embeddings" ? "embedding" : "chat"
				})
		})
	})

	let lastSearchAsk = ""
	$effect(() => {
		const term = debouncedQuery.trim()
		const kind = destination?.kind
		const current = scope
		if (!term || !kind || kind === "onnx" || audioRuntime || !isAdmin)
			return
		const signature = `${kind}:${current}:${term}`
		if (signature === lastSearchAsk) return
		lastSearchAsk = signature
		searching = true
		searchError = null
		kcppSearch = []
		ollamaSearch = []
		hubShown = HUB_PAGE
		searchAsks.ask(() => {
			if (kind === "koboldcpp")
				socket.emit("koboldcpp:searchModels", {
					searchTerm: term,
					kind: kcppKindForScope(current) ?? "text"
				})
			else
				socket.emit("ollama:searchAvailableModels", {
					searchTerm: term,
					source: OllamaModelSearchSource.HUGGING_FACE,
					kind: current === "embeddings" ? "embedding" : "chat"
				})
		})
	})
	// audio.cpp's packages, for an audio.cpp destination and for KoboldCPP under
	// Speech. One list serves both: each row names its runtime. It is asked
	// again when an audio download settles, because a package's state is the
	// list's to report.
	let lastAudioAsk = ""
	$effect(() => {
		if (!audioRuntime || !isAdmin) return
		const signature = `${audioRuntime}:${audioSettled}`
		if (signature === lastAudioAsk) return
		lastAudioAsk = signature
		socket.emit("audiocpp:listPackages", {})
	})
	let audioSettled = $state(0)
	let audioBusyCount = 0
	$effect(() => {
		const busy = downloads.items.filter(
			(i) =>
				(i.source === "audiocpp" || i.source === "koboldcpp") &&
				i.state === "in_flight"
		).length
		if (busy < audioBusyCount) audioSettled += 1
		audioBusyCount = busy
	})

	// A reply owed to an unmounted view must not be waited on by the next one.
	$effect(() => () => {
		recommendedAsks.reset()
		searchAsks.reset()
	})

	// ── The rows ────────────────────────────────────────────────────────────

	/** Which audio runtime's families this destination + scope lists, or null. */
	const audioRuntime = $derived(audioRuntimeFor(destination, scope))

	const rowContext = $derived({
		tier,
		query: debouncedQuery,
		present: presentModels,
		kcppKind: kcppKindForScope(scope) === "image" ? "image" : "text"
	} as const)

	const recommendedRows = $derived.by((): FinderRow[] => {
		const dest = destination
		if (!dest) return []
		if (audioRuntime)
			return audioFamilyRows(audioFamilies ?? [], rowContext, {
				scope,
				runtime: audioRuntime
			})
		if (dest.kind === "koboldcpp")
			return kcppRecommendedRows(kcppRecommended, rowContext)
		if (dest.kind === "ollama")
			// Chat and embeddings both: the server narrowed the list to the
			// asked-for kind, so these rows are already the right half.
			return scope === "chat" || scope === "embeddings"
				? ollamaRecommendedRows(ollamaRecommended, rowContext)
				: []
		return onnxRecommendedRows(
			// A row with no `local` is one the server has not answered for
			// yet; offering Get on it would be a press that fails.
			(destinationRow?.models ?? []).filter((m) => !!m.local),
			rowContext,
			scope === "entities" ? "entities" : "embeddings"
		)
	})

	/**
	 * Models an ONNX destination already has on disk. They are not in the
	 * download list (`onnxRecommendedRows`); this count is where they went.
	 */
	const onnxOnDisk = $derived(
		destination?.kind === "onnx"
			? (destinationRow?.models ?? []).filter(
					(m) => m.local?.state === "on_disk"
				).length
			: 0
	)

	/** Exactly one gold Get, on the first row that outright fits. */
	const goldIndex = $derived(primaryRowIndex(recommendedRows))

	const hubRows = $derived.by((): HubRow[] => {
		const dest = destination
		if (
			!dest ||
			dest.kind === "onnx" ||
			audioRuntime ||
			!debouncedQuery.trim()
		)
			return []
		return dest.kind === "koboldcpp"
			? kcppHubRows(
					kcppSearch,
					kcppKindForScope(scope) === "image" ? "image" : "text"
				)
			: ollamaHubRows(ollamaSearch)
	})

	/**
	 * A row that is arriving right now, from whichever feed owns it.
	 *
	 * The ONNX rows carry their own state off `connections:list`; the two
	 * manager feeds are matched through the downloads store — by pull key for
	 * Ollama, and by model name for KoboldCPP, whose entries carry the repo
	 * name `downloadParams` sent.
	 *
	 * ⚠ The server keys a pull by `<connectionId>:<tag>` whenever the pull
	 * names a connection (it always does from here), so the store's id is
	 * `ollama:<connectionId>:<tag>` while the row's key is `ollama:<tag>`.
	 * Comparing the two bare never matched: no bar, and Get offered again
	 * mid-pull.
	 */
	function liveDownload(row: FinderRow): DownloadItem | null {
		const dest = destination
		const kind = dest?.kind
		if (!dest || !kind || kind === "onnx") return null
		const items = downloads.items
		if (audioRuntime) return audioLiveMatch(row, audioRuntime, items)
		if (kind === "ollama") {
			const id =
				dest.connectionId != null
					? `ollama:${dest.connectionId}:${row.key.slice("ollama:".length)}`
					: row.key
			return items.find((i) => i.id === id) ?? null
		}
		return (
			items.find(
				(i) =>
					i.source === "koboldcpp" &&
					i.state === "in_flight" &&
					i.name === row.name
			) ?? null
		)
	}

	/**
	 * A recommended row's download, as the card and the page both draw it. The
	 * ONNX feed reports a percent; the KoboldCPP one reports only bytes, so a
	 * bare `live.percent` would pin every managed download at 0% forever.
	 * Clamped 0–100: a feed's byte count can overrun the total it reported,
	 * and a bar past 100% spills out of its track.
	 */
	function busyOf(row: FinderRow) {
		const live = row.downloading ? null : liveDownload(row)
		const rawPercent =
			row.percent ??
			(live?.totalBytes
				? ((live.downloadedBytes ?? 0) / live.totalBytes) * 100
				: (live?.percent ?? null))
		const percent =
			rawPercent == null ? null : Math.min(100, Math.max(0, rawPercent))
		return {
			active: row.downloading || !!live,
			percent,
			progress:
				formatProgress(live?.downloadedBytes, live?.totalBytes, "GB") ??
				`${Math.round(percent ?? 0)}%`
		}
	}

	// ── Presence: who already holds this ────────────────────────────────────

	/** Holders by row key. A row nobody holds maps to []. */
	const holdersByKey = new SvelteMap<string, PresenceHolder[]>()
	function handlePresence(msg: Sockets.Models.Presence.Response) {
		for (const result of msg?.results ?? [])
			holdersByKey.set(result.key, result.holders ?? [])
	}
	// A failed check is a missing note, never a toast: presence is a courtesy.
	function handlePresenceError() {}

	/** The note for a row under the current destination. */
	function summaryFor(key: string) {
		return destination
			? presenceNote(holdersByKey.get(key), destination)
			: null
	}
	/** The row's own state, or "held here" per the presence check. */
	function effectivePresence(row: {
		key: string
		presence?: FinderRow["presence"]
	}) {
		if (row.presence) return row.presence
		const summary = summaryFor(row.key)
		return summary?.here && destination
			? presenceFor(destination.kind)
			: null
	}

	const presenceQueries = $derived.by((): PresenceQuery[] => {
		const out: PresenceQuery[] = []
		for (const row of recommendedRows)
			if (row.presenceQuery) out.push(row.presenceQuery)
		for (const row of hubRows.slice(0, hubShown))
			if (row.presenceQuery) out.push(row.presenceQuery)
		return out
	})
	// Re-asked only when the row set (or a download settling) changes — never
	// on a list push that left the rows alone.
	let lastPresenceAsk = ""
	$effect(() => {
		if (!isAdmin || !destination) return
		const queries = presenceQueries
		if (!queries.length) return
		const signature = `${presenceSignature(queries)}#${audioSettled}`
		if (signature === lastPresenceAsk) return
		lastPresenceAsk = signature
		for (const batch of presenceBatches(queries))
			socket.emit("models:presence", { queries: batch })
	})

	// ── Starting a download ─────────────────────────────────────────────────

	/** What the open picker will do with the chosen file. */
	type PickerSource =
		| {
				kind: "koboldcpp"
				model: Sockets.KoboldCPP.SearchModels.ModelResult
		  }
		| { kind: "ollama" }
		| { kind: "onnx"; modelId: number }
		| { kind: "audio"; runtime: "audiocpp" | "koboldcpp"; name: string }
	/** The Get button that opened the picker; Cancel returns focus to it. */
	let pickerOpener: HTMLElement | null = null
	let picker = $state<{
		/** The row the picker opened under (`FinderRow.key` / `HubRow.key`). */
		rowKey: string
		repo: string
		quants: QuantFile[]
		source: PickerSource
		noun: "size" | "precision"
	} | null>(null)

	function started(name: string) {
		notify.success({ title: `Downloading ${name}` })
	}

	function startKcpp(
		model: Sockets.KoboldCPP.SearchModels.ModelResult,
		quant: QuantFile
	) {
		const kind = kcppKindForScope(scope) ?? "text"
		// ⚠ Through `downloadParams`, never an object literal: the kind is the
		// only evidence of what a .gguf IS at download time, and a request that
		// drops it files an image checkpoint in the text list forever.
		socket.emit(
			"koboldcpp:downloadModel",
			downloadParams(
				model,
				{
					label: quant.name,
					filename: quant.filename ?? quant.name,
					downloadUrl: quant.url ?? "",
					sizeBytes: quant.bytes
				},
				kind
			)
		)
		started(model.name)
	}

	function startOllama(tag: string, name: string) {
		socket.emit("ollama:pullModel", {
			modelName: tag,
			connectionId: destination?.connectionId
		})
		started(name)
	}

	/** ALWAYS carries the precision when the list named one. */
	function startOnnx(modelId: number, quant: QuantFile | null, name: string) {
		const dest = destination
		if (!dest) return
		socket.emit("connections:downloadModel", {
			id: dest.connectionId,
			modelId,
			...(quant?.dtype ? { dtype: quant.dtype } : {})
		})
		started(name)
	}

	function startAudio(
		runtime: "audiocpp" | "koboldcpp",
		name: string,
		quant: QuantFile
	) {
		if (runtime === "audiocpp") {
			if (!quant.packageId) return
			socket.emit("audiocpp:downloadPackage", { id: quant.packageId })
		} else {
			// One call per file, the model first and its codec after.
			for (const params of kcppSpeechDownloads(name, quant))
				socket.emit("koboldcpp:downloadModel", params)
		}
		started(name)
	}

	/** What one row's download needs, whichever door it is pressed from. */
	interface DownloadPlan {
		repo: string
		quants: QuantFile[]
		source: PickerSource
		noun: "size" | "precision"
		/** What to do with a chosen file, or with none (`null`: no files). */
		go: (quant: QuantFile | null) => void
	}

	/**
	 * The ONE decision of which source, repo, files and noun a row downloads
	 * through — for the Get button (`offer`) and the model page alike. Null
	 * when this destination cannot take the row.
	 */
	function planFor(
		row: FinderRow | HubRow,
		group: "recommended" | "hub"
	): DownloadPlan | null {
		const dest = destination
		if (!dest) return null
		const quants = row.quants ?? []
		if (group === "hub") {
			if (dest.kind === "onnx") return null
			if (dest.kind === "koboldcpp") {
				const model = kcppSearch.find((m) => m.name === row.name)
				if (!model) return null
				return {
					repo: model.name,
					quants,
					source: { kind: "koboldcpp", model },
					noun: "size",
					go: (quant) => quant && startKcpp(model, quant)
				}
			}
			return {
				repo: row.name,
				quants,
				source: { kind: "ollama" },
				noun: "size",
				go: (quant) => {
					if (quant?.tag) startOllama(quant.tag, row.name)
				}
			}
		}
		if (audioRuntime) {
			const runtime = audioRuntime
			return {
				repo: row.name,
				quants,
				source: { kind: "audio", runtime, name: row.name },
				noun: "precision",
				go: (quant) => quant && startAudio(runtime, row.name, quant)
			}
		}
		if (dest.kind === "onnx") {
			const modelId = Number(row.key.slice("onnx:".length))
			return {
				repo: row.name,
				quants,
				source: { kind: "onnx", modelId },
				noun: "precision",
				go: (quant) => startOnnx(modelId, quant, row.name)
			}
		}
		if (dest.kind === "ollama") {
			// Quants when the server could list them; else the yaml's own tag
			// (a library name has no quants, and the row says why).
			return {
				repo: row.name,
				quants,
				source: { kind: "ollama" },
				noun: "size",
				go: (quant) =>
					startOllama(
						quant?.tag ?? row.key.slice("ollama:".length),
						row.name
					)
			}
		}
		const model = kcppRecommended.find((m) => m.name === row.name)
		if (!model) return null
		return {
			repo: model.name,
			quants,
			source: { kind: "koboldcpp", model },
			noun: "size",
			go: (quant) => quant && startKcpp(model, quant)
		}
	}

	/** Open the picker, or go straight ahead when there is nothing to choose. */
	function offer(rowKey: string, plan: DownloadPlan) {
		const choice = quantChoice(plan.quants)
		if (choice === "picker") {
			picker = {
				rowKey,
				repo: plan.repo,
				quants: plan.quants,
				source: plan.source,
				noun: plan.noun
			}
		} else plan.go(defaultQuant(plan.quants))
	}

	/** The Get button on a recommended row. */
	function getRecommended(row: FinderRow, opener: HTMLElement) {
		pickerOpener = opener
		const plan = planFor(row, "recommended")
		if (plan) offer(row.key, plan)
	}

	/** The Get button on a Hugging Face row. */
	function getHub(row: HubRow, opener: HTMLElement) {
		pickerOpener = opener
		const dest = destination
		if (!dest || dest.kind === "onnx") return
		if (!(row.quants ?? []).length) {
			notify.error({ title: "That repo lists no files to get" })
			return
		}
		const plan = planFor(row, "hub")
		if (plan) offer(row.key, plan)
	}

	function cancelPicker() {
		picker = null
		void tick().then(() => pickerOpener?.focus())
	}

	/** One chosen file, routed by the source it came from. */
	function runDownload(source: PickerSource, repo: string, quant: QuantFile) {
		if (source.kind === "koboldcpp") startKcpp(source.model, quant)
		else if (source.kind === "ollama") {
			if (quant.tag) startOllama(quant.tag, repo)
		} else if (source.kind === "onnx")
			startOnnx(source.modelId, quant, repo)
		else startAudio(source.runtime, source.name, quant)
	}

	function downloadPicked(quant: QuantFile) {
		const open = picker
		picker = null
		if (!open) return
		runDownload(open.source, open.repo, quant)
	}

	function cancelRow(row: FinderRow) {
		const dest = destination
		if (!dest) return
		if (dest.kind === "onnx") {
			socket.emit("connections:cancelModelDownload", {
				id: dest.connectionId,
				modelId: Number(row.key.slice("onnx:".length))
			})
			return
		}
		if (audioRuntime === "koboldcpp") {
			// A speech conversion is several files; stop every one of them.
			for (const item of downloads.items)
				if (
					item.source === "koboldcpp" &&
					item.state === "in_flight" &&
					item.name === row.name
				)
					downloads.cancel(item)
			return
		}
		const item = liveDownload(row)
		if (item) downloads.cancel(item)
		else if (audioRuntime === "audiocpp")
			// Downloading per the list but not (yet) per the feed.
			for (const family of audioFamilies ?? [])
				if (`audio:${family.key}` === row.key)
					for (const p of family.precisions)
						if (p.state === "downloading")
							socket.emit("audiocpp:cancelPackageDownload", {
								id: p.id
							})
	}

	// ── The finder model page ───────────────────────────────────────────────

	/**
	 * The result whose page is open. `snapshot` is the row as it was opened:
	 * the live row is looked up by key, and the snapshot stands in when a list
	 * push or the debounced query has dropped it.
	 */
	let page = $state<{
		key: string
		group: "recommended" | "hub"
		snapshot: FinderRow | HubRow
	} | null>(null)
	let hubCard = $state<{
		repo: string
		loading: boolean
		card?: Sockets.Models.HubCard.Card
		files?: Sockets.Models.HubCard.File[]
		error?: string
	} | null>(null)
	/** Where the results were scrolled to; plain, nothing reads it reactively. */
	let savedScroll = 0
	let paneScroller = $state<HTMLElement>()
	let resultsScroller = $state<HTMLElement>()

	const pageRow = $derived.by((): FinderRow | HubRow | null => {
		if (!page) return null
		const live =
			page.group === "recommended"
				? recommendedRows.find((r) => r.key === page?.key)
				: hubRows.find((r) => r.key === page?.key)
		return live ?? page.snapshot
	})
	const pageRecommended = $derived(
		page?.group === "recommended" ? (pageRow as FinderRow | null) : null
	)
	/**
	 * Nothing to fetch: a Hugging Face, KoboldCPP or audio row with no files has
	 * no list tag to fall back on (only Ollama's library names and ONNX do), so
	 * the page's Download is off and says why — the words Get uses.
	 */
	const pageNoFiles = $derived(
		!!pageRow &&
			!(pageRow.quants ?? []).length &&
			(page?.group === "hub" ||
				destination?.kind === "koboldcpp" ||
				!!audioRuntime)
	)
	const pageBusy = $derived(
		pageRecommended && busyOf(pageRecommended).active
			? busyOf(pageRecommended)
			: null
	)

	function handleHubCard(msg: Sockets.Models.HubCard.Response) {
		// A reply for a page already left (or another repo's) changes nothing.
		if (!hubCard || msg?.repo !== hubCard.repo) return
		hubCard = {
			repo: hubCard.repo,
			loading: false,
			card: msg.card,
			files: msg.files,
			error: msg.error
		}
	}

	function openPage(row: FinderRow | HubRow, group: "recommended" | "hub") {
		savedScroll = (pane ? paneScroller : resultsScroller)?.scrollTop ?? 0
		page = { key: row.key, group, snapshot: row }
		const kind = destination?.kind
		const repo =
			isAdmin && (kind === "koboldcpp" || kind === "ollama")
				? hubRepoOf(row)
				: null
		hubCard = repo ? { repo, loading: true } : null
		if (repo) socket.emit("models:hubCard", { repo })
	}

	function closePage() {
		const key = page?.key
		page = null
		hubCard = null
		void tick().then(() => {
			const scroller = pane ? paneScroller : resultsScroller
			if (scroller) scroller.scrollTop = savedScroll
			const openers =
				root?.querySelectorAll<HTMLElement>("[data-page-opener]") ?? []
			for (const el of openers)
				if (el.dataset.pageOpener === key) {
					el.focus()
					break
				}
		})
	}

	function downloadFromPage(quant: QuantFile | null) {
		if (!page || !pageRow) return
		const plan = planFor(pageRow, page.group)
		if (!plan) return
		if (quant) runDownload(plan.source, plan.repo, quant)
		else plan.go(null)
	}

	// A page belongs to one destination and scope; if either moves, it closes.
	let pageFor = ""
	$effect(() => {
		const key = `${scope}|${destination?.id ?? ""}`
		untrack(() => {
			if (key !== pageFor && page) closePage()
			pageFor = key
		})
	})

	// ── When there is nowhere to put it ─────────────────────────────────────

	function addKoboldCpp() {
		// Through the context, so the create it may ask for is this tab's own
		// and the Connections view opens the new row.
		const { plan } = conns.enableManagerHere("koboldcpp")
		notify.success({ title: `${plan.label} is on` })
	}

	function addAudioCpp() {
		const { plan } = conns.enableManagerHere("audiocpp")
		notify.success({ title: `${plan.label} is on` })
	}

	const kcppModelsDir = $derived.by(() => {
		const settings = koboldCppSettingsCtx?.settings as
			| Record<string, string | null | undefined>
			| undefined
		if (!settings) return null
		return scope === "images"
			? (settings.koboldCppImageModelsDir ??
					settings.koboldCppManagerModelsDir ??
					null)
			: (settings.koboldCppManagerModelsDir ?? null)
	})

	/** The KoboldCPP destination was picked by hand but cannot run yet. */
	const kcppNotReady = $derived(
		destination?.kind === "koboldcpp" &&
			kcppInstallState(koboldCppSettingsCtx?.settings) !== "ready"
	)
	const note = $derived(
		!destination
			? null
			: kcppNotReady
				? "KoboldCPP isn't set up or switched on yet — files still land, but nothing can run them until it is"
				: landingNote(destination, kcppModelsDir)
	)

	/** The pane form: standing alone (`onBack`), not inside a host. */
	const pane = $derived(!!onBack && !embedded)
	let root = $state<HTMLElement>()
	// Opening the pane moves focus to its heading (PanelNavHeader's
	// `[data-panel-title]`), so the keyboard lands where the view begins.
	$effect(() => {
		if (!pane || !root) return
		const heading = root.querySelector<HTMLElement>("[data-panel-title]")
		heading?.setAttribute("tabindex", "-1")
		heading?.focus()
	})

	const hubGroupVisible = $derived(
		!!destination && !audioRuntime && !!debouncedQuery.trim()
	)
	const onnxHubVisible = $derived(destination?.kind === "onnx")
</script>

<div class="flex h-full min-h-0 flex-col gap-3" bind:this={root}>
	{#if page && pageRow}
		<FinderModelPage
			name={pageRow.name}
			source={page.group}
			{tier}
			tierChip={pageRecommended?.tier ?? null}
			description={pageRow.description}
			facts={modelPageFacts({
				parameters:
					pageRecommended &&
					(destination?.kind === "koboldcpp" ||
						destination?.kind === "ollama")
						? pageRecommended.facts
						: null,
				card: hubCard?.card,
				tags: pageRow.tags,
				listFacts: pageRecommended?.listFacts ?? null
			})}
			presenceText={summaryFor(pageRow.key)?.text}
			quants={withHubFileSizes(pageRow.quants ?? [], hubCard?.files)}
			quantsNote={pageRecommended?.quantsNote ?? null}
			noun={destination?.kind === "onnx" || audioRuntime
				? "precision"
				: "size"}
			cardLoading={!!hubCard?.loading}
			cardError={hubCard?.error ?? null}
			destinationLabel={destination?.label ?? null}
			landingNote={note}
			disabledReason={destination?.disabledReason ??
				(pageNoFiles ? "That repo lists no files to get" : null)}
			held={effectivePresence(pageRow)}
			busy={pageBusy}
			onDownload={downloadFromPage}
			onCancel={() => pageRecommended && cancelRow(pageRecommended)}
			onBack={closePage}
		/>
	{:else}
		{#if pane}
			<PanelNavHeader
				title="Get a model"
				{onBack}
				backLabel="Back"
				actionsLabel="Model finder"
				menuItems={[
					{
						label: "Change memory tier",
						icon: Icons.MemoryStick,
						onSelect: () => (tierOpen = true)
					}
				]}
			/>
		{/if}

		<!-- The pane form: the header is pinned and everything under it is ONE
	     scroller (a scroller carries no padding, STYLE-GUIDE §5.2). Embedded and
	     bare keep their controls pinned over a results-only scroller. -->
		{#if pane}
			<div
				class="min-h-0 flex-1 overflow-y-auto"
				bind:this={paneScroller}
			>
				<div class="flex flex-col gap-3 pb-2">
					{@render finderBody()}
				</div>
			</div>
		{:else}
			{@render finderBody()}
		{/if}
	{/if}
</div>

{#snippet finderBody()}
	<div class="shrink-0">
		<PanelFilterInput
			bind:value={query}
			placeholder="Search recommended and Hugging Face"
		/>
	</div>

	<!-- THE SENTENCE. [Chat] models for [KoboldCPP] · sized for [8 GB]. Each
	     bracket is a popover of radios; a part the host or the door fixed is
	     plain words. Derived from the list, so a destination is never offered
	     for a runtime this pub has no connection to. -->
	<div class="flex shrink-0 flex-col gap-1.5">
		<div
			class="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5 text-sm"
		>
			{#if embedded || scopeOptions.length === 1}
				<span class="font-medium">{scopeLabel}</span>
			{:else}
				<Popover
					open={scopeOpen}
					onOpenChange={(e) => (scopeOpen = e.open)}
					positioning={{ placement: "bottom-start" }}
				>
					<Popover.Trigger
						class={sentenceTrigger}
						aria-label="For: {scopeLabel}"
						aria-expanded={scopeOpen}
					>
						{scopeLabel}
						<Icons.ChevronDown size={14} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,240px)] border p-2 shadow-xl"
							>
								<div
									class="flex flex-col gap-0.5"
									role="radiogroup"
									aria-label="For"
								>
									{#each scopeOptions as option (option.value)}
										{@const on = scope === option.value}
										<button
											type="button"
											role="radio"
											aria-checked={on}
											class="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-sm {on
												? 'sidebar-row-active'
												: 'hover:bg-surface-200-800'}"
											onclick={() => {
												scopeOverride = option.value
												scopeOpen = false
											}}
										>
											{option.label}
										</button>
									{/each}
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			{/if}
			<span>{destinations.length ? "models for" : "models"}</span>
			{#if destinations.length === 1}
				<span class="min-w-0 font-medium break-words">
					{destination?.label}
				</span>
			{:else if destinations.length}
				<Popover
					open={destinationOpen}
					onOpenChange={(e) => (destinationOpen = e.open)}
					positioning={{ placement: "bottom-start" }}
				>
					<Popover.Trigger
						class={sentenceTrigger}
						aria-label="Download to: {destination?.label}"
						aria-expanded={destinationOpen}
					>
						{destination?.label}
						<Icons.ChevronDown size={14} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,280px)] border p-2 shadow-xl"
							>
								<div
									class="flex flex-col gap-0.5"
									role="radiogroup"
									aria-label="Download to"
								>
									{#each destinations as option (option.id)}
										{@const on =
											destination?.id === option.id}
										<!-- A disabled destination stays pickable: picking
										     it is how its reason reaches the line under the
										     sentence, and every Get under it is disabled
										     instead. -->
										<button
											type="button"
											role="radio"
											aria-checked={on}
											title={option.disabledReason}
											class="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-sm {on
												? 'sidebar-row-active'
												: 'hover:bg-surface-200-800'} {option.disabledReason
												? 'opacity-70'
												: ''}"
											onclick={() => {
												destinationOverride = option.id
												destinationOpen = false
											}}
										>
											<span class="min-w-0 truncate">
												{option.label}
											</span>
										</button>
									{/each}
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			{/if}
			<!-- The memory tier measures GGUF downloads against a graphics
			     card. An ONNX model runs on the CPU, so the part would be a
			     question with no bearing on the answer. -->
			{#if destination?.kind !== "onnx"}
				<span aria-hidden="true">·</span>
				<span>sized for</span>
				<Popover
					open={tierOpen}
					onOpenChange={(e) => (tierOpen = e.open)}
					positioning={{ placement: "bottom-start" }}
				>
					<Popover.Trigger
						class={sentenceTrigger}
						aria-label="Memory tier: {tierLabel(tier)}"
						aria-expanded={tierOpen}
					>
						{tierLabel(tier)}
						<Icons.ChevronDown size={14} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,240px)] border p-2 shadow-xl"
							>
								<p
									class="text-surface-600-400 px-1.5 pb-1 text-xs"
								>
									How much memory does this machine have?
								</p>
								{#if tierReason}
									<p
										class="text-surface-600-400 px-1.5 pb-1 text-xs"
									>
										{tierReason}
									</p>
								{/if}
								<div
									class="flex flex-col gap-0.5"
									role="radiogroup"
									aria-label="Memory tier"
								>
									{#each MEMORY_TIERS as option (option.value)}
										{@const on = tier === option.value}
										<button
											type="button"
											role="radio"
											aria-checked={on}
											class="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-sm {on
												? 'sidebar-row-active'
												: 'hover:bg-surface-200-800'}"
											onclick={() =>
												pickTier(option.value)}
										>
											{option.label}
										</button>
									{/each}
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			{/if}
		</div>

		{#if !destinations.length}
			<!-- Nothing can hold it. The card says so and offers the one press
			     that changes that. The two local ONNX connections are created by
			     the app itself, so embeddings and entities have no door to
			     name. -->
			<section class="panel-card flex flex-col gap-2">
				<p class="text-sm">
					Nothing here can hold {scopePhrase(scope)} yet.
				</p>
				{#if scope === "chat" || scope === "images" || scope === "speech"}
					<button
						type="button"
						class="btn btn-sm preset-tonal-primary self-start"
						onclick={addKoboldCpp}
					>
						<Icons.Cpu size={14} aria-hidden="true" />
						Add KoboldCPP, run by Serene Pub
					</button>
				{/if}
				{#if scope === "speech" || scope === "transcription"}
					<button
						type="button"
						class="btn btn-sm preset-tonal-primary self-start"
						onclick={addAudioCpp}
					>
						<Icons.AudioLines size={14} aria-hidden="true" />
						Add audio.cpp, run by Serene Pub
					</button>
				{/if}
			</section>
		{/if}

		<!-- Why this destination cannot take a file, or why a hand-picked
		     KoboldCPP cannot run one yet. A reason wraps: cut short, it would
		     hide the one thing the person needs to read. -->
		{#if destination?.disabledReason || kcppNotReady}
			<p class="text-surface-600-400 text-xs break-words">
				{destination?.disabledReason ?? note}
			</p>
		{/if}
		{#if tierReason && destination?.kind !== "onnx"}
			<p class="text-surface-600-400 text-xs break-words">{tierReason}</p>
		{/if}
	</div>

	<!-- RESULTS. Two groups, each with its own count, and neither rendered
	     empty (STYLE-GUIDE §6.4). -->
	<div
		class="flex flex-col gap-3 {pane
			? ''
			: 'min-h-0 flex-1 overflow-y-auto pb-2'}"
		bind:this={resultsScroller}
	>
		{#if !destination}
			<!-- The card above is the whole answer; a results list under it
			     would be a list of things that cannot be downloaded. -->
		{:else}
			<section class="flex flex-col gap-3">
				<span class="text-surface-600-400 text-xs">
					Recommended · {recommendedRows.length}
					{recommendedRows.length === 1 ? "match" : "matches"}
				</span>
				{#if loadingRecommended && !recommendedRows.length}
					<LoadingState
						message="Loading the recommended list…"
						showMessage
					/>
				{:else if kcppRecommendedFailed && !recommendedRows.length}
					<p class="text-surface-600-400 text-sm">
						The recommended list is fetched from Hugging Face and it
						would not answer. Search for a model by name instead.
					</p>
				{:else if !recommendedRows.length}
					<p class="text-surface-600-400 text-sm">
						{debouncedQuery.trim()
							? "Nothing in the recommended list matches."
							: "The recommended list has nothing for this pair yet."}
					</p>
				{:else}
					{#each recommendedRows as row, index (row.key)}
						{@render resultRow(row, index === goldIndex)}
					{/each}
				{/if}
				{#if onnxOnDisk && destination}
					<button
						type="button"
						class="hover:preset-tonal-primary text-surface-600-400 rounded-base flex min-h-9 items-center gap-2 px-1.5 text-left text-xs"
						onclick={() =>
							destination &&
							onOpenConnection?.(destination.connectionId)}
						disabled={!onOpenConnection}
					>
						<Icons.HardDrive size={14} aria-hidden="true" />
						{onnxOnDisk} already on this machine
						{#if onOpenConnection}
							<Icons.ChevronRight size={14} aria-hidden="true" />
						{/if}
					</button>
				{/if}
			</section>

			{#if onnxHubVisible}
				<!-- The local lists are curated and the Hub is not searchable
				     for them in the same shape, so the Hub group here is one
				     row: the id form the ONNX views already use. -->
				<section class="flex flex-col gap-3">
					<span class="text-surface-600-400 text-xs">
						Hugging Face
					</span>
					{#if hubOpen}
						<form
							class="panel-card flex flex-col gap-2"
							onsubmit={(event) => {
								event.preventDefault()
								submitHub()
							}}
						>
							<label
								class="text-surface-600-400 text-xs"
								for="finder-hub-id"
							>
								Model id
							</label>
							<input
								id="finder-hub-id"
								class="input"
								placeholder="org/name"
								bind:value={hubId}
								autocomplete="off"
								spellcheck="false"
							/>
							<span class="text-surface-600-400 text-xs">
								Precision
							</span>
							<div
								class="flex flex-wrap gap-1.5"
								role="radiogroup"
								aria-label="Precision"
							>
								{#each hubDtypes as option (option.name)}
									{@const on = hubDtype === option.dtype}
									<button
										type="button"
										role="radio"
										aria-checked={on}
										class="flex min-h-9 items-center rounded-full px-2.5 text-xs pointer-coarse:min-h-11 {on
											? 'preset-pressed'
											: 'bg-surface-200-800 text-surface-700-300 hover:bg-surface-300-700'}"
										onclick={() =>
											(hubDtype =
												option.dtype ??
												ADD_BY_ID_DEFAULT_DTYPE)}
									>
										{option.name}
									</button>
								{/each}
							</div>
							{#if hubError}
								<p
									class="text-error-600-400 text-xs"
									role="alert"
								>
									{hubError}
								</p>
							{/if}
							<div class="flex items-center justify-end gap-2">
								<button
									type="button"
									class="btn btn-sm hover:preset-tonal-surface text-surface-600-400"
									onclick={() => {
										hubOpen = false
										hubError = null
									}}
								>
									Cancel
								</button>
								<button
									type="submit"
									class="btn btn-sm preset-filled-primary-500"
									disabled={hubPending || !hubId.trim()}
								>
									Add
								</button>
							</div>
						</form>
					{:else}
						<button
							type="button"
							class="hover:preset-tonal-primary rounded-base flex min-h-11 w-full items-center gap-2.5 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-70"
							disabled={!!destination?.disabledReason}
							title={destination?.disabledReason}
							onclick={() => (hubOpen = true)}
						>
							<span
								class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
								aria-hidden="true"
							>
								<Icons.Plus size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="text-lead block font-medium">
									Add from Hugging Face by id
								</span>
								<span
									class="text-surface-600-400 block truncate text-xs"
								>
									An ONNX export this pub can download itself
								</span>
							</span>
						</button>
					{/if}
				</section>
			{:else if hubGroupVisible}
				<section class="flex flex-col gap-3">
					<span class="text-surface-600-400 text-xs">
						Hugging Face · {hubRows.length}
						{hubRows.length === 1 ? "result" : "results"}
					</span>
					{#if searching && !hubRows.length}
						<p class="text-surface-600-400 text-sm">Searching…</p>
					{:else if searchError}
						<p class="text-surface-600-400 text-sm" role="alert">
							{searchError}
						</p>
					{:else if !hubRows.length}
						<p class="text-surface-600-400 text-sm">
							Hugging Face has no GGUF repo by that name.
						</p>
					{:else}
						{#each hubRows.slice(0, hubShown) as row (row.key)}
							{@render hubResultRow(row)}
						{/each}
						{#if hubRows.length > hubShown}
							<button
								type="button"
								class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 self-start text-xs"
								onclick={() => (hubShown += HUB_PAGE)}
							>
								Show {HUB_PAGE} more
							</button>
						{/if}
					{/if}
				</section>
			{/if}
		{/if}
	</div>
{/snippet}

<!-- One card anatomy, whichever catalogue the row came from: a tile, a name
     with its tier chip, a facts line, the repo's own sentence and its tags,
     and at most one button.

     ⚠ A CARD, not a 44px list row (2026-09-25). The row crushed owner, size,
     shape AND description into one `truncate` line, so the sentence was
     fetched, quoted and then cut off on every column narrower than absurd —
     and tags were not carried at all. `.panel-card` per STYLE-GUIDE §6.4;
     12px between cards per §4.3. -->
{#snippet resultRow(row: FinderRow, gold: boolean)}
	{@const progress = busyOf(row)}
	{@const busy = progress.active}
	{@const held = effectivePresence(row)}
	{@const summary = summaryFor(row.key)}
	{@const fileLine = quantLine(row)}
	<div class="panel-card flex flex-col gap-2">
		<div class="flex items-start gap-2.5">
			<span
				class="preset-tonal-surface rounded-base grid size-9 shrink-0 place-items-center"
				aria-hidden="true"
			>
				<Icons.Package size={18} />
			</span>
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<div class="flex min-w-0 flex-wrap items-center gap-1.5">
					<button
						type="button"
						class="text-lead min-w-0 truncate text-left font-medium hover:underline"
						title={row.name}
						data-page-opener={row.key}
						onclick={() => openPage(row, "recommended")}
					>
						{repoTitle(row.name)}
					</button>
					{#if row.tier}
						<span
							class="text-meta shrink-0 rounded-full px-2 py-0.5 {row
								.tier.matches
								? 'preset-tonal-primary'
								: 'preset-tonal-surface'}"
						>
							{row.tier.label}
						</span>
					{/if}
				</div>
				<span class="text-surface-600-400 truncate text-xs">
					{secondLine(row)}
				</span>
				{#if fileLine}
					<!-- A single-file repo names its file before Get; an Ollama
					     row with no listable quants says why. -->
					<span
						class="text-surface-600-400 truncate text-xs"
						title={fileLine}
					>
						{fileLine}
					</span>
				{/if}
			</div>
			{#if busy}
				<button
					type="button"
					class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0 text-xs"
					onclick={() => cancelRow(row)}
					aria-label={`Cancel — ${row.name}`}
				>
					Cancel
				</button>
			{:else if held}
				<Badge tone="success" size="sm" class="shrink-0">
					{held === "on_disk" ? "On disk" : "Pulled"}
				</Badge>
			{:else}
				<button
					type="button"
					class="btn btn-sm shrink-0 text-xs {gold
						? 'preset-filled-primary-500'
						: 'preset-tonal-surface'}"
					disabled={!!destination?.disabledReason}
					title={destination?.disabledReason}
					onclick={(e) => getRecommended(row, e.currentTarget)}
					aria-label={`Get ${row.name}`}
				>
					{summary?.getLabel ?? "Get"}
				</button>
			{/if}
		</div>

		{#if summary?.text}
			<p class="text-surface-600-400 text-xs">{summary.text}</p>
		{/if}

		{#if row.description}
			<!-- Clamped, not truncated: two lines of a sentence is a sentence,
			     one line of it cut mid-word is a tease. -->
			<p
				class="text-surface-700-300 line-clamp-2 text-xs leading-relaxed"
			>
				{row.description}
			</p>
		{/if}

		{@render tagPills(row.tags)}

		{#if picker?.rowKey === row.key}
			<QuantPicker
				repo={picker.repo}
				quants={picker.quants}
				{tier}
				noun={picker.noun}
				onCancel={cancelPicker}
				onDownload={downloadPicked}
			/>
		{/if}

		{#if busy}
			<div class="flex min-w-0 items-center gap-2">
				<span
					class="bg-surface-300-700 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
					role="progressbar"
					aria-label={`Downloading ${row.name}`}
					aria-valuenow={progress.percent ?? undefined}
					aria-valuemin={0}
					aria-valuemax={100}
				>
					<span
						class="bg-warning-500 block h-full rounded-full transition-[width]"
						style={`width: ${Math.round(progress.percent ?? 0)}%`}
					></span>
				</span>
				<span class="text-surface-600-400 text-meta shrink-0">
					{progress.progress}
				</span>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet hubResultRow(row: HubRow)}
	{@const held = effectivePresence({ key: row.key })}
	{@const summary = summaryFor(row.key)}
	{@const fileLine = quantLine(row)}
	<div class="panel-card flex flex-col gap-2">
		<div class="flex items-start gap-2.5">
			<span
				class="preset-tonal-surface rounded-base grid size-9 shrink-0 place-items-center"
				aria-hidden="true"
			>
				<Icons.Globe size={18} />
			</span>
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<button
					type="button"
					class="text-lead truncate text-left font-medium hover:underline"
					title={row.name}
					data-page-opener={row.key}
					onclick={() => openPage(row, "hub")}
				>
					{repoTitle(row.name)}
				</button>
				<span class="text-surface-600-400 truncate text-xs">
					{row.detail}
				</span>
				{#if fileLine}
					<span
						class="text-surface-600-400 truncate text-xs"
						title={fileLine}
					>
						{fileLine}
					</span>
				{/if}
			</div>
			{#if held}
				<Badge tone="success" size="sm" class="shrink-0">
					{held === "on_disk" ? "On disk" : "Pulled"}
				</Badge>
			{:else}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
					onclick={(e) => getHub(row, e.currentTarget)}
					aria-label={`Get ${row.name}`}
				>
					{summary?.getLabel ?? "Get"}
				</button>
			{/if}
		</div>

		{#if summary?.text}
			<p class="text-surface-600-400 text-xs">{summary.text}</p>
		{/if}

		{#if row.description}
			<p
				class="text-surface-700-300 line-clamp-2 text-xs leading-relaxed"
			>
				{row.description}
			</p>
		{/if}

		{@render tagPills(row.tags)}

		{#if picker?.rowKey === row.key}
			<QuantPicker
				repo={picker.repo}
				quants={picker.quants}
				{tier}
				noun={picker.noun}
				onCancel={cancelPicker}
				onDownload={downloadPicked}
			/>
		{/if}
	</div>
{/snippet}

<!-- One tag row for both cards, so a recommended model and a searched one
     can never render the same vocabulary two ways. -->
{#snippet tagPills(tags: readonly string[])}
	{@const shown = tags.slice(0, TAGS_SHOWN)}
	{#if shown.length}
		<!-- Tonal, never `preset-filled-*`: a filled preset is a button, not a
		     badge (STYLE-GUIDE §2.4). The old Ollama manager badged these
		     filled-tertiary and filled-secondary, which is the convention that
		     was retired app-wide at 3.62:1. -->
		<div class="flex flex-wrap items-center gap-1.5">
			{#each shown as tag (tag)}
				<Badge size="sm" class="text-surface-700-300">
					{tag}
				</Badge>
			{/each}
			{#if tags.length > shown.length}
				<span class="text-surface-600-400 text-meta">
					+{tags.length - shown.length} more
				</span>
			{/if}
		</div>
	{/if}
{/snippet}
