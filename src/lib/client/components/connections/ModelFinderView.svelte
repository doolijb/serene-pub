<script lang="ts">
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
	 * The four questions this view asks, in order, are the four rows at the
	 * top: what are you looking for, what is it FOR, where should it go, and
	 * then — and only then — the results.
	 *
	 * ## What decides the press is whether it will run
	 *
	 * Every catalogue quotes a size and none of them says what a size means on
	 * the machine in front of the person. The **memory tier** (`memoryTier.ts`)
	 * turns all of them into one of three words, and it is the reason the row
	 * has a gold chip, the reason exactly one Get button is gold, and the
	 * whole second line of the quant picker. "Not sure" is a real answer and
	 * suppresses every one of those rather than guessing.
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
	 * - An Ollama EMBEDDINGS destination gets no recommended group:
	 *   `ollama:recommendedModels` answers with the chat GGUF list whatever is
	 *   asked of it, and chat models filed under Embeddings would be a lie the
	 *   finder told. The Hub search still works there.
	 * - A GGUF row's second line quotes its parameter size, not a context
	 *   window: neither search carries one.
	 * - An Ollama Hub row quotes no byte size, because its search does not
	 *   return one — so those quants carry no fit hint rather than a computed
	 *   one.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import QuantPicker from "./QuantPicker.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { enableManager } from "./managers"
	import { downloads, type DownloadItem } from "./downloads.svelte"
	import { formatProgress } from "./modelManagement"
	import { downloadParams } from "$lib/client/components/koboldcppManager/availableTab"
	import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
	import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"
	import {
		DEFAULT_SCOPE,
		FINDER_SCOPES,
		destinationsFor,
		kcppHubRows,
		kcppKindForScope,
		kcppRecommendedRows,
		landingNote,
		ollamaHubRows,
		ollamaRecommendedRows,
		onnxRecommendedRows,
		pickDestination,
		primaryRowIndex,
		quantsFromKcpp,
		quantsFromOllama,
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
		type QuantFile
	} from "./finder"
	import {
		MEMORY_TIERS,
		readMemoryTier,
		tierLabel,
		writeMemoryTier,
		type MemoryTier
	} from "./memoryTier"

	interface Props {
		/** Scope the search to one transform, when the caller had one in mind. */
		capability?: string
		/** Scope it to one destination. */
		connectionId?: number
		onBack: () => void
		/**
		 * Rendered inside another view that owns the header (the Set up chat
		 * flow): no nav header of its own, and the scope row is hidden because
		 * the host already decided what the model is for.
		 */
		embedded?: boolean
	}
	let { capability, connectionId, onBack, embedded = false }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user?: SelectUser } | undefined = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	const koboldCppSettingsCtx: KoboldCppSettingsCtx | undefined = getContext(
		"koboldCppSettingsCtx"
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

	let tier = $state<MemoryTier>("unsure")
	// Read on mount rather than at module scope: `localStorage` does not exist
	// during SSR, and the default is what a browser that will not store it
	// keeps getting.
	$effect(() => {
		tier = readMemoryTier()
	})
	let tierOpen = $state(false)
	function pickTier(next: MemoryTier) {
		tier = next
		writeMemoryTier(next)
		tierOpen = false
	}

	// ── The list, and the destinations derived from it ──────────────────────

	let connectionsList = $state<Sockets.Connections.List.Row[]>([])
	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connectionsList = msg.connectionsList ?? []
	}

	const destinations = $derived(destinationsFor(scope, connectionsList))
	let destinationOverride = $state<string | null>(null)
	const destination = $derived.by(() => {
		const chosen = destinations.find((d) => d.id === destinationOverride)
		return chosen ?? pickDestination(destinations, connectionId)
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
	function handleSearchError(msg: Sockets.ErrorResponse) {
		if (searchAsks.settle()) return
		searching = false
		kcppSearch = []
		ollamaSearch = []
		searchError = msg?.error ?? "Hugging Face would not answer."
	}
	/** A download that would not start says so where the press was. */
	function handleDownloadError(msg: Sockets.ErrorResponse) {
		toaster.error({ title: msg?.error ?? "Couldn't start that download" })
	}

	// ── Add from Hugging Face by id (local ONNX only) ───────────────────────

	let hubOpen = $state(false)
	let hubId = $state("")
	let hubError = $state<string | null>(null)
	let hubPending = $state(false)
	function submitHub() {
		const id = hubId.trim()
		if (!id || !destination) return
		hubError = null
		hubPending = true
		socket.emit("connections:addHubModel", {
			id: destination.connectionId,
			hubId: id
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
	$effect(() =>
		declareInterest<"connections:list">(
			"connections:list",
			handleConnectionsList
		)
	)
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
			)
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
		socket.emit("connections:list", {})
	})

	const HUB_PAGE = 10
	let hubShown = $state(HUB_PAGE)

	let lastRecommendedAsk = ""
	$effect(() => {
		const kind = destination?.kind
		const current = scope
		if (!kind || !isAdmin) return
		// Local ONNX has no second list to fetch: its catalogue is already
		// projected into the connection's own models by the sync.
		if (kind === "onnx") return
		// See the header: the Ollama list is the chat GGUF YAML whatever is
		// asked of it, so an embeddings destination gets no group at all.
		if (kind === "ollama" && current !== "chat") return
		const signature = `${kind}:${current}`
		if (signature === lastRecommendedAsk) return
		lastRecommendedAsk = signature
		loadingRecommended = true
		// ⚠ Emptied on the way out, not on the way in: the KoboldCPP list is
		// one variable for two kinds, so a chat→images switch would otherwise
		// show the text catalogue under Images until the reply landed.
		kcppRecommended = []
		kcppRecommendedFailed = false
		recommendedAsks.ask(() => {
			if (kind === "koboldcpp")
				socket.emit("koboldcpp:recommendedModels", {
					kind: kcppKindForScope(current) ?? "text"
				})
			else socket.emit("ollama:recommendedModels", {})
		})
	})

	let lastSearchAsk = ""
	$effect(() => {
		const term = debouncedQuery.trim()
		const kind = destination?.kind
		const current = scope
		if (!term || !kind || kind === "onnx" || !isAdmin) return
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
					source: OllamaModelSearchSource.HUGGING_FACE
				})
		})
	})
	// A reply owed to an unmounted view must not be waited on by the next one.
	$effect(() => () => {
		recommendedAsks.reset()
		searchAsks.reset()
	})

	// ── The rows ────────────────────────────────────────────────────────────

	const rowContext = $derived({
		tier,
		query: debouncedQuery,
		present: presentModels
	})

	const recommendedRows = $derived.by((): FinderRow[] => {
		const dest = destination
		if (!dest) return []
		if (dest.kind === "koboldcpp")
			return kcppRecommendedRows(kcppRecommended, rowContext)
		if (dest.kind === "ollama")
			return scope === "chat"
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

	/** Exactly one gold Get, on the first row that outright fits. */
	const goldIndex = $derived(primaryRowIndex(recommendedRows))

	const hubRows = $derived.by((): HubRow[] => {
		const dest = destination
		if (!dest || dest.kind === "onnx" || !debouncedQuery.trim()) return []
		return dest.kind === "koboldcpp"
			? kcppHubRows(kcppSearch)
			: ollamaHubRows(ollamaSearch)
	})

	/**
	 * A row that is arriving right now, from whichever feed owns it.
	 *
	 * The ONNX rows carry their own state off `connections:list`; the two
	 * manager feeds are matched through the downloads store — by pull tag for
	 * Ollama, whose map is keyed by exactly that, and by model name for
	 * KoboldCPP, whose entries carry the repo name `downloadParams` sent.
	 */
	function liveDownload(row: FinderRow): DownloadItem | null {
		const kind = destination?.kind
		if (!kind || kind === "onnx") return null
		const items = downloads.items
		if (kind === "ollama")
			return items.find((i) => i.id === row.key) ?? null
		return (
			items.find(
				(i) =>
					i.source === "koboldcpp" &&
					i.state === "in_flight" &&
					i.name === row.name
			) ?? null
		)
	}

	// ── Starting a download ─────────────────────────────────────────────────

	let picker = $state<{
		repo: string
		quants: QuantFile[]
		kind: "koboldcpp" | "ollama"
		/** The KoboldCPP result the params are rebuilt from. */
		model: Sockets.KoboldCPP.SearchModels.ModelResult | null
	} | null>(null)

	function started(name: string) {
		toaster.success({ title: `Downloading ${name}` })
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

	/** The Get button on a recommended row. */
	function getRecommended(row: FinderRow) {
		const dest = destination
		if (!dest) return
		if (dest.kind === "onnx") {
			const modelId = Number(row.key.slice("onnx:".length))
			socket.emit("connections:downloadModel", {
				id: dest.connectionId,
				modelId
			})
			started(row.name)
			return
		}
		if (dest.kind === "ollama") {
			// A recommended Ollama row names one exact tag; there is nothing
			// to pick between.
			const modelName = row.key.slice("ollama:".length)
			socket.emit("ollama:pullModel", { modelName })
			started(row.name)
			return
		}
		const model = kcppRecommended.find((m) => m.name === row.name)
		if (!model) return
		const kind = kcppKindForScope(scope) ?? "text"
		const quants = quantsFromKcpp(model, kind)
		// A picker with one row asks a question with one answer.
		if (quants.length === 1) startKcpp(model, quants[0])
		else picker = { repo: model.name, quants, kind: "koboldcpp", model }
	}

	/** The Get button on a Hugging Face row. */
	function getHub(row: HubRow) {
		const dest = destination
		if (!dest || dest.kind === "onnx") return
		if (dest.kind === "koboldcpp") {
			const model = kcppSearch.find((m) => m.name === row.name)
			if (!model) return
			const kind = kcppKindForScope(scope) ?? "text"
			const quants = quantsFromKcpp(model, kind)
			if (quants.length === 1) startKcpp(model, quants[0])
			else picker = { repo: model.name, quants, kind: "koboldcpp", model }
			return
		}
		const model = ollamaSearch.find((m) => m.name === row.name)
		if (!model) return
		picker = {
			repo: model.name,
			quants: quantsFromOllama(model),
			kind: "ollama",
			model: null
		}
	}

	function downloadPicked(quant: QuantFile) {
		const open = picker
		picker = null
		if (!open) return
		if (open.kind === "koboldcpp" && open.model)
			startKcpp(open.model, quant)
		else if (open.kind === "ollama" && quant.tag) {
			socket.emit("ollama:pullModel", { modelName: quant.tag })
			started(open.repo)
		}
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
		const item = liveDownload(row)
		if (item) downloads.cancel(item)
	}

	// ── When there is nowhere to put it ─────────────────────────────────────

	function addKoboldCpp() {
		const { plan } = enableManager("koboldcpp", socket, connectionsList)
		toaster.success({ title: `${plan.label} is on` })
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

	const note = $derived(
		destination ? landingNote(destination, kcppModelsDir) : null
	)

	const hubGroupVisible = $derived(!!destination && !!debouncedQuery.trim())
	const onnxHubVisible = $derived(destination?.kind === "onnx")
</script>

<div class="flex h-full min-h-0 flex-col gap-3 {embedded ? '' : 'p-1'}">
	{#if !embedded}
		<PanelNavHeader
			title="Get a model"
			{onBack}
			backLabel="Back to connections"
			actionsLabel="Model finder"
			{actions}
		/>
	{/if}

	<div class="shrink-0">
		<PanelFilterInput
			bind:value={query}
			placeholder="Search recommended and Hugging Face"
		/>
	</div>

	<!-- WHAT IT IS FOR. One on, always. Hidden when the host chose it. -->
	<div class="flex shrink-0 flex-col gap-1.5" class:hidden={embedded}>
		<span class="text-surface-500 text-xs">For</span>
		<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="For">
			{#each FINDER_SCOPES as option (option.value)}
				{@const on = scope === option.value}
				<button
					type="button"
					role="radio"
					aria-checked={on}
					class="flex min-h-9 items-center rounded-full px-2.5 text-xs pointer-coarse:min-h-11 {on
						? 'preset-tonal-primary'
						: 'bg-surface-200-800 text-surface-700-300 hover:preset-tonal-primary'}"
					onclick={() => (scopeOverride = option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- WHERE IT GOES. Derived from the list, so a pill is never offered for
	     a runtime this pub has no connection to. -->
	<div class="flex shrink-0 flex-col gap-1.5">
		<span class="text-surface-500 text-xs">Download to</span>
		{#if destinations.length}
			<div
				class="flex flex-wrap gap-1.5"
				role="radiogroup"
				aria-label="Download to"
			>
				{#each destinations as option (option.id)}
					{@const on = destination?.id === option.id}
					<button
						type="button"
						role="radio"
						aria-checked={on}
						class="flex min-h-9 min-w-0 items-center rounded-full px-2.5 text-xs pointer-coarse:min-h-11 {on
							? 'preset-tonal-primary'
							: 'bg-surface-200-800 text-surface-700-300 hover:preset-tonal-primary'}"
						onclick={() => (destinationOverride = option.id)}
					>
						<span class="min-w-0 truncate">{option.label}</span>
					</button>
				{/each}
			</div>
		{:else}
			<!-- Nothing can hold it. The card says so and offers the one press
			     that changes that, or — for the two local modalities — names
			     the door, because a local ONNX connection is CREATED from Add
			     and not conjured from a finder. -->
			<section class="panel-card flex flex-col gap-2">
				<p class="text-sm">
					Nothing here can hold {scopePhrase(scope)} yet.
				</p>
				{#if scope === "chat" || scope === "images"}
					<button
						type="button"
						class="btn btn-sm preset-tonal-primary self-start"
						onclick={addKoboldCpp}
					>
						<Icons.Cpu size={14} aria-hidden="true" />
						Add KoboldCPP, run by Serene Pub
					</button>
				{:else}
					<p class="text-surface-600-400 text-xs">
						Add → A connection makes the local connection this pub
						downloads them into.
					</p>
				{/if}
			</section>
		{/if}

		<!-- Where the files land, and what "fits" is being measured against.
		     Rendered whether or not there is a destination, so the tier's own
		     popover always has a trigger on screen. -->
		<p
			class="text-surface-500 flex min-w-0 flex-wrap items-center gap-1 text-xs"
		>
			{#if note}
				<span class="min-w-0 truncate">{note}</span>
				<span aria-hidden="true">·</span>
			{/if}
			<span>{tierLabel(tier)} tier</span>
			<span aria-hidden="true">·</span>
			<Popover
				open={tierOpen}
				onOpenChange={(e) => (tierOpen = e.open)}
				positioning={{ placement: "bottom-start" }}
			>
				<Popover.Trigger
					class="text-primary-700 dark:text-primary-500 hover:underline"
					aria-label="Change memory tier"
					aria-expanded={tierOpen}
				>
					Change
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner class="z-[1000]!">
						<Popover.Content
							class="card bg-surface-100-900 border-surface-300-700 w-[min(90vw,240px)] border p-2 shadow-xl"
						>
							<p class="text-surface-500 px-1.5 pb-1 text-xs">
								How much memory does this machine have?
							</p>
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
											: 'hover:preset-tonal-primary'}"
										onclick={() => pickTier(option.value)}
									>
										{option.label}
									</button>
								{/each}
							</div>
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		</p>
	</div>

	<!-- RESULTS. Two groups, each with its own count, and neither rendered
	     empty (STYLE-GUIDE §6.4). -->
	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
		{#if !destination}
			<!-- The card above is the whole answer; a results list under it
			     would be a list of things that cannot be downloaded. -->
		{:else}
			<section class="flex flex-col gap-1.5">
				<span class="text-surface-500 text-xs">
					Recommended · {recommendedRows.length}
					{recommendedRows.length === 1 ? "match" : "matches"}
				</span>
				{#if loadingRecommended && !recommendedRows.length}
					<p class="text-surface-600-400 text-sm">
						Loading the recommended list…
					</p>
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
			</section>

			{#if onnxHubVisible}
				<!-- The local lists are curated and the Hub is not searchable
				     for them in the same shape, so the Hub group here is one
				     row: the id form the ONNX views already use. -->
				<section class="flex flex-col gap-1.5">
					<span class="text-surface-500 text-xs">Hugging Face</span>
					{#if hubOpen}
						<form
							class="panel-card flex flex-col gap-2"
							onsubmit={(event) => {
								event.preventDefault()
								submitHub()
							}}
						>
							<label
								class="text-surface-500 text-xs"
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
							{#if hubError}
								<p class="text-error-500 text-xs" role="alert">
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
							class="hover:preset-tonal-primary flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left"
							onclick={() => (hubOpen = true)}
						>
							<span
								class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
								aria-hidden="true"
							>
								<Icons.Plus size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block text-[15px] font-medium">
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
				<section class="flex flex-col gap-1.5">
					<span class="text-surface-500 text-xs">
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
</div>

{#if picker}
	<QuantPicker
		open={true}
		repo={picker.repo}
		quants={picker.quants}
		{tier}
		onCancel={() => (picker = null)}
		onDownload={downloadPicked}
	/>
{/if}

{#snippet actions()}
	<button
		type="button"
		class="popover-menu-btn btn"
		onclick={() => (tierOpen = true)}
	>
		<Icons.MemoryStick size={16} aria-hidden="true" />
		Change memory tier
	</button>
{/snippet}

<!-- One row anatomy, whichever catalogue the row came from: a tile, a name
     with its tier chip, one second line, and at most one button. -->
{#snippet resultRow(row: FinderRow, gold: boolean)}
	{@const live = row.downloading ? null : liveDownload(row)}
	{@const busy = row.downloading || !!live}
	<!-- The ONNX feed reports a percent; the KoboldCPP one reports only
	     bytes, so a bare `live.percent` would pin every managed download at
	     0% forever. -->
	{@const percent =
		row.percent ??
		(live?.totalBytes
			? ((live.downloadedBytes ?? 0) / live.totalBytes) * 100
			: (live?.percent ?? null))}
	<div class="flex min-h-11 items-center gap-2 rounded-[10px]">
		<span
			class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
			aria-hidden="true"
		>
			<Icons.Package size={16} />
		</span>
		<span class="min-w-0 flex-1">
			<span class="flex min-w-0 items-center gap-1.5">
				<span
					class="min-w-0 truncate text-[15px] font-medium"
					title={row.name}
				>
					{repoTitle(row.name)}
				</span>
				{#if row.tier}
					<span
						class="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] {row
							.tier.matches
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
					>
						{row.tier.label}
					</span>
				{/if}
			</span>
			{#if busy}
				<span class="flex min-w-0 items-center gap-1.5">
					<span
						class="bg-surface-300-700 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
						role="progressbar"
						aria-label={`Downloading ${row.name}`}
						aria-valuenow={percent ?? undefined}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<span
							class="bg-warning-500 block h-full rounded-full transition-[width]"
							style={`width: ${Math.round(percent ?? 0)}%`}
						></span>
					</span>
					<span class="text-surface-600-400 shrink-0 text-[11px]">
						{formatProgress(
							live?.downloadedBytes,
							live?.totalBytes,
							"GB"
						) ?? `${Math.round(percent ?? 0)}%`}
					</span>
				</span>
			{:else}
				<span class="text-surface-600-400 block truncate text-xs">
					{secondLine(row)}
				</span>
			{/if}
		</span>
		{#if busy}
			<button
				type="button"
				class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0 text-xs"
				onclick={() => cancelRow(row)}
				aria-label={`Cancel — ${row.name}`}
			>
				Cancel
			</button>
		{:else if row.presence}
			<span
				class="preset-tonal-success shrink-0 rounded-full px-2 py-0.5 text-[11px]"
			>
				{row.presence === "on_disk" ? "On disk" : "Pulled"}
			</span>
		{:else}
			<button
				type="button"
				class="btn btn-sm shrink-0 text-xs {gold
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				onclick={() => getRecommended(row)}
				aria-label={`Get ${row.name}`}
			>
				Get
			</button>
		{/if}
	</div>
{/snippet}

{#snippet hubResultRow(row: HubRow)}
	<div class="flex min-h-11 items-center gap-2 rounded-[10px]">
		<span
			class="preset-tonal-surface grid size-8 shrink-0 place-items-center rounded-lg"
			aria-hidden="true"
		>
			<Icons.Globe size={16} />
		</span>
		<span class="min-w-0 flex-1">
			<span
				class="block truncate text-[15px] font-medium"
				title={row.name}
			>
				{repoTitle(row.name)}
			</span>
			<span class="text-surface-600-400 block truncate text-xs">
				{row.detail}
			</span>
		</span>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
			onclick={() => getHub(row)}
			aria-label={`Get ${row.name}`}
		>
			Get
		</button>
	</div>
{/snippet}
