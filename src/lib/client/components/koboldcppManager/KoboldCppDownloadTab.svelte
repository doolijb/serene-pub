<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import KoboldCppModelKindToggle from "./KoboldCppModelKindToggle.svelte"
	import {
		PICKER_COPY,
		SEARCH_HINT,
		downloadParams,
		isRecommendedQuant,
		pullOptionsLabel,
		recommendedEmptyState,
		skipsPicker
	} from "./availableTab"
	import { modelsDirForKind } from "./modelKindView"

	interface Props {
		isLocal: boolean
		/** Owned by the sidebar, not by this tab: switching to Image here and
		 * then walking over to Models must not drop the user back into the text
		 * world. Bindable so the toggle rendered here moves both tabs at once. */
		modelKind?: Sockets.KoboldCPP.ModelKindFilter
		onDownloadStart?: () => void
	}

	let {
		isLocal,
		modelKind = $bindable("text"),
		onDownloadStart
	}: Props = $props()

	const SOURCE_RECOMMENDED = "recommended"
	const SOURCE_HUGGING_FACE = "huggingface"
	const sourceOptions = [
		{ value: SOURCE_RECOMMENDED, label: "Recommended" },
		{ value: SOURCE_HUGGING_FACE, label: "Hugging Face" }
	]

	const socket = useTypedSocket()
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	/** Q4_K_M is the balance the picker already recommends in prose; during the
	 * wizard hand-off it also gets the glow, so a first-time user isn't left
	 * comparing quantization names they have no basis to choose between. The
	 * kind gate lives in isRecommendedQuant — see availableTab.ts. */
	let isTutorial = $derived(!!panelsCtx?.digest?.tutorial)

	/** A repo can publish 40+ quantizations, so Q4_K_M often sits below the
	 * fold of this scroll box — a highlight the user has to hunt for guides
	 * nobody. Bring it into view rather than reordering the list. */
	function revealRecommended(node: HTMLElement, active: boolean) {
		if (!active) return
		const reduced = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)"
		).matches
		requestAnimationFrame(() =>
			node.scrollIntoView({
				block: "center",
				behavior: reduced ? "auto" : "smooth"
			})
		)
	}

	/**
	 * Where a download from THIS tab will actually land.
	 *
	 * Kind-aware because there are two directories now: a download started from
	 * the Image list is written to the image directory, or to the text one when
	 * no separate image directory is set. Reading the text column alone would
	 * both gate the tab on the wrong field and name the wrong folder to a user
	 * wondering where their file went.
	 */
	let modelsDir = $derived(
		modelsDirForKind(modelKind, koboldCppSettingsCtx.settings) ?? ""
	)
	let selectedSource = $state(SOURCE_RECOMMENDED)
	let searchString = $state("")
	let isSearching = $state(false)
	// Distinguishes "haven't searched yet" from "searched, zero results" —
	// searchResults starts empty, so gating the "No models found" message on
	// searchString alone showed it the instant you typed anything, before
	// Enter (the only way to actually trigger search()) was ever pressed.
	let hasSearched = $state(false)

	let searchResults = $state<Sockets.KoboldCPP.SearchModels.ModelResult[]>([])
	let recommendedModels = $state<
		Sockets.KoboldCPP.RecommendedModels.RecommendedModel[]
	>([])
	let isLoadingRecommended = $state(false)
	// An empty recommended list has two very different causes and the server
	// reports both the same way (a list, or an error). Tracked separately so the
	// image catalog — one upstream repo — can say "couldn't fetch" instead of
	// implying KoboldCPP has no image models.
	let recommendedFailed = $state(false)

	let selectedModel =
		$state<Sockets.KoboldCPP.SearchModels.ModelResult | null>(null)
	let showQuantModal = $state(false)

	let pickerCopy = $derived(PICKER_COPY[modelKind])
	let recommendedEmpty = $derived(
		recommendedEmptyState(modelKind, recommendedFailed)
	)

	function vramColor(gb: number): string {
		if (gb <= 3) return "text-success-500"
		if (gb <= 6) return "text-primary-500"
		if (gb <= 10) return "text-warning-500"
		if (gb <= 16) return "text-warning-500"
		return "text-error-500"
	}

	function vramTier(gb: number): string {
		if (gb <= 3) return "Ultra Budget"
		if (gb <= 6) return "Budget"
		if (gb <= 10) return "Mainstream"
		if (gb <= 16) return "High-End"
		return "Enthusiast"
	}

	function search() {
		if (!searchString.trim()) return
		isSearching = true
		hasSearched = true
		searchResults = []
		socket.emit("koboldcpp:searchModels", {
			searchTerm: searchString.trim(),
			kind: modelKind
		})
	}

	function loadRecommended() {
		isLoadingRecommended = true
		recommendedFailed = false
		recommendedModels = []
		socket.emit("koboldcpp:recommendedModels", { kind: modelKind })
	}

	function startDownload(
		model: Sockets.KoboldCPP.SearchModels.ModelResult,
		opt: Sockets.KoboldCPP.SearchModels.PullOption
	) {
		showQuantModal = false
		selectedModel = null
		socket.emit(
			"koboldcpp:downloadModel",
			downloadParams(model, opt, modelKind)
		)
		toaster.success({
			title: "Download started",
			description: opt.filename
		})
		onDownloadStart?.()
	}

	/** The picker is skipped when there is nothing to pick — see skipsPicker. */
	function pickDownload(model: Sockets.KoboldCPP.SearchModels.ModelResult) {
		if (skipsPicker(model)) {
			startDownload(model, model.pullOptions[0])
			return
		}
		selectedModel = model
		showQuantModal = true
	}

	onMount(() => {
		socket.on(
			"koboldcpp:searchModels",
			(msg: Sockets.KoboldCPP.SearchModels.Response) => {
				isSearching = false
				searchResults = msg.models
			}
		)
		socket.on(
			"koboldcpp:searchModels:error",
			(msg: Sockets.ErrorResponse) => {
				isSearching = false
				// The reason matters more here than it used to: search is rate
				// limited instance-wide (5 per minute, one budget shared by both
				// kinds), and switching Text/Image re-runs the active search. A
				// user comparing the two result sets can spend the budget in
				// seconds, and a bare "Search failed" gives them nothing to
				// connect it to — the server's message names the wait.
				toaster.error({
					title: "Search failed",
					description: msg.error
				})
			}
		)

		socket.on("koboldcpp:downloadModel", () => {})
		socket.on(
			"koboldcpp:downloadModel:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: "Download failed",
					description: msg.error
				})
			}
		)

		socket.on(
			"koboldcpp:recommendedModels",
			(msg: Sockets.KoboldCPP.RecommendedModels.Response) => {
				isLoadingRecommended = false
				// The image branch reports a failed fetch on the SUCCESS
				// response — it catches its own single fetch rather than
				// throwing — so a hard `false` here would render an outage as
				// "no image models exist" and send the user to Hugging Face,
				// which is the host that just failed.
				recommendedFailed = msg.failed ?? false
				recommendedModels = msg.models
			}
		)
		socket.on("koboldcpp:recommendedModels:error", () => {
			isLoadingRecommended = false
			recommendedFailed = true
			toaster.error({ title: "Failed to load recommended models" })
		})

		// The sidebar owns the kind and this tab is remounted on every visit,
		// so the first fetch is simply for whatever kind is current — which is
		// not necessarily "text" if the user switched to Image on Models.
		loadRecommended()
	})

	// Both catalogs are per-kind on the server, so a switch has to go back for a
	// new one rather than re-filter what is already here: the recommended cache
	// is keyed by kind, and the list this tab is holding belongs to the other
	// kind — left on screen it looks exactly like an empty image catalog.
	// Search results are wrong rather than merely stale, since an SDXL
	// checkpoint is a file KoboldCPP cannot load as an LLM, and vice versa.
	function handleKindChange() {
		// A term the user already ran means they are still shopping for it;
		// re-run it against the new kind rather than leaving the box holding a
		// query whose results were just thrown away. Only while that list is the
		// one on screen: searches share one instance-wide rate-limit budget, and
		// spending it on a list nobody is looking at is how alternating between
		// kinds hits the limit at twice the rate.
		const rerun =
			selectedSource === SOURCE_HUGGING_FACE &&
			hasSearched &&
			searchString.trim().length > 0
		searchResults = []
		hasSearched = false
		loadRecommended()
		if (rerun) search()
	}

	onDestroy(() => {
		socket.off("koboldcpp:searchModels")
		socket.off("koboldcpp:searchModels:error")
		socket.off("koboldcpp:downloadModel")
		socket.off("koboldcpp:downloadModel:error")
		socket.off("koboldcpp:recommendedModels")
		socket.off("koboldcpp:recommendedModels:error")
	})
</script>

{#if !isLocal}
	<div class="py-4">
		<div
			class="bg-warning-100 dark:bg-warning-900 border-warning-300 dark:border-warning-700 rounded-lg border p-4"
		>
			<div class="flex items-start gap-3">
				<Icons.AlertTriangle
					class="text-warning-600 mt-0.5 h-5 w-5 shrink-0"
				/>
				<div>
					<h4
						class="text-warning-800 dark:text-warning-200 font-medium"
					>
						Remote instance detected
					</h4>
					<p
						class="text-warning-700 dark:text-warning-300 mt-1 text-sm"
					>
						Model downloads are only available when KoboldCPP is
						running on the same machine as Serene Pub.
					</p>
				</div>
			</div>
		</div>
	</div>
{:else if !modelsDir}
	<div class="py-4">
		<div class="bg-surface-100-800 rounded-lg border p-6 text-center">
			<Icons.FolderOpen
				class="text-muted-foreground mx-auto mb-3 h-10 w-10 opacity-50"
			/>
			<h3 class="mb-1 font-semibold">Models directory not configured</h3>
			<!-- Only reachable in image mode when NEITHER directory is set: an
			     unset Image Models Directory falls back to the Models Directory,
			     so naming only the image field here would send the user to a
			     setting they don't need. -->
			<p class="text-muted-foreground text-sm">
				Set a <strong>Models Directory</strong>
				in the Settings tab before downloading models.{#if modelKind === "image"}
					An <strong>Image Models Directory</strong>
					is optional — set one to keep image models out of your LLM folder.
				{/if}
			</p>
		</div>
	</div>
{:else}
	<!-- Toolbar. Kind is the outer axis and sits first: it changes what
	     "Recommended" means and what a search can return, so it has to be read
	     before the source below it. -->
	<div class="flex flex-col gap-2 py-2">
		<KoboldCppModelKindToggle
			bind:kind={modelKind}
			onchange={handleKindChange}
		/>
		<select
			aria-label="Model search source"
			class="select bg-background border-muted w-full rounded border"
			bind:value={selectedSource}
		>
			{#each sourceOptions as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
		<div class="relative">
			<button
				type="button"
				class="text-surface-700-300 hover:text-foreground absolute top-1/2 left-3 -translate-y-1/2 disabled:cursor-not-allowed"
				onclick={search}
				disabled={selectedSource === SOURCE_RECOMMENDED ||
					!searchString.trim()}
				title="Search"
				aria-label="Search"
			>
				<Icons.Search size={16} />
			</button>
			<input
				type="text"
				placeholder={selectedSource === SOURCE_RECOMMENDED
					? "Search not available for recommended models"
					: `${SEARCH_HINT[modelKind]}…`}
				class="input w-full pl-10"
				bind:value={searchString}
				disabled={selectedSource === SOURCE_RECOMMENDED}
				onkeydown={(e) => e.key === "Enter" && search()}
			/>
		</div>
		<!-- Which folder this tab's downloads land in. Once two directories can
		     be configured, "your models folder" is genuinely ambiguous, and a
		     file that lands in the other one is invisible in the Models tab. -->
		<p class="text-surface-700-300 text-xs">
			Downloads to
			<span class="font-mono break-all">{modelsDir}</span>
		</p>
	</div>

	<!-- Results -->
	<div class="space-y-3 py-4">
		<!-- Stated up front rather than discovered as a download that fails at
		     load time. Shown for both sources: the boundary is about what
		     KoboldCPP can load, not about where the file came from. -->
		{#if modelKind === "image"}
			<div
				class="bg-surface-200-800 rounded-lg p-3 text-xs leading-relaxed"
			>
				<p class="mb-1 font-medium">
					Single-file SD1.5 and SDXL models only
				</p>
				<p class="text-surface-700-300">
					SD3 and Flux models additionally need separate Clip and
					T5-XXL files, which the Manager can't install yet.
					ComfyUI-format GGUF files look identical from the outside,
					but KoboldCPP will refuse to load them.
				</p>
			</div>
		{/if}
		{#if selectedSource === SOURCE_RECOMMENDED}
			{#if isLoadingRecommended}
				<div class="p-6 text-center">
					<Icons.Loader2
						class="mx-auto mb-4 animate-spin"
						size={32}
					/>
					<p class="text-sm opacity-75">
						Loading recommended models…
					</p>
				</div>
			{:else if recommendedModels.length === 0}
				<div class="p-6 text-center">
					{#if recommendedEmpty.tone === "error"}
						<Icons.AlertTriangle
							class="text-warning-500 mx-auto mb-4"
							size={48}
						/>
					{:else}
						<Icons.Search
							class="text-surface-700-300 mx-auto mb-4"
							size={48}
						/>
					{/if}
					<p class="text-sm opacity-75">{recommendedEmpty.title}</p>
					<p class="text-surface-700-300 mt-1 text-xs">
						{recommendedEmpty.detail}
					</p>
				</div>
			{:else}
				{#each recommendedModels as model}
					<div class="card preset-filled-surface-100-900 p-4">
						<div class="flex flex-col gap-3">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1 break-all">
									<h4
										class="text-foreground mb-1 text-lg font-semibold"
									>
										{model.ollamaName ?? model.name}
									</h4>
									<div
										class="mb-2 flex flex-wrap items-center gap-2"
									>
										{#if model.parameterSize}
											<span
												class="badge preset-filled-primary-500 rounded-full px-2 py-1 text-xs"
											>
												{model.parameterSize}
											</span>
										{/if}
										{#if model.recommendedVram != null}
											<span
												class="badge bg-surface-200 dark:bg-surface-800 rounded-full px-2 py-1 text-xs {vramColor(
													model.recommendedVram
												)}"
											>
												{model.recommendedVram}GB VRAM • {vramTier(
													model.recommendedVram
												)}
											</span>
										{/if}
										{#if model.sdcpp}
											<span
												class="badge preset-filled-secondary-500 rounded-full px-2 py-1 text-xs"
												title="Built for stable-diffusion.cpp — the GGUF flavour KoboldCPP loads"
											>
												stable-diffusion.cpp
											</span>
										{/if}
									</div>
								</div>
							</div>

							{#if model.description}
								<p
									class="text-muted-foreground text-sm leading-relaxed"
								>
									{model.description}
								</p>
							{/if}

							<div
								class="text-surface-700-300 flex flex-wrap items-center gap-4 text-xs"
							>
								{#if model.downloads != null}
									<div class="flex items-center gap-1">
										<Icons.Download size={12} />
										<span>
											{model.downloads.toLocaleString()} downloads
										</span>
									</div>
								{/if}
								{#if model.likes != null}
									<div class="flex items-center gap-1">
										<Icons.Heart size={12} />
										<span>
											{model.likes.toLocaleString()} likes
										</span>
									</div>
								{/if}
								<div class="flex items-center gap-1">
									<Icons.Layers size={12} />
									<span>
										{pullOptionsLabel(
											model.pullOptions.length,
											modelKind
										)}
									</span>
								</div>
								<!-- A one-file card downloads without a picker, so
								     this is the only place its size is ever shown. -->
								{#if skipsPicker(model) && model.pullOptions[0].sizeBytes}
									<div class="flex items-center gap-1">
										<Icons.HardDrive size={12} />
										<span>
											{(
												model.pullOptions[0]
													.sizeBytes! / 1_073_741_824
											).toFixed(1)}GB
										</span>
									</div>
								{/if}
							</div>

							<div class="flex gap-2">
								<button
									class="btn btn-sm preset-filled-primary-500"
									onclick={() => pickDownload(model)}
								>
									<Icons.Download size={14} />
									Download
								</button>
								{#if model.url}
									<a
										href={model.url}
										target="_blank"
										rel="noopener noreferrer"
										class="btn btn-sm preset-filled-secondary-500"
									>
										<Icons.ExternalLink size={14} />
										View
									</a>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			{/if}
		{:else}
			<!-- Hugging Face search results -->
			{#if isSearching}
				<div class="p-6 text-center">
					<Icons.Loader2
						class="mx-auto mb-4 animate-spin"
						size={32}
					/>
					<p class="text-sm opacity-75">Searching…</p>
				</div>
			{:else if searchResults.length === 0 && hasSearched}
				<div class="p-6 text-center">
					<Icons.Search
						class="text-surface-700-300 mx-auto mb-4"
						size={48}
					/>
					<p class="text-sm opacity-75">
						No models found for "{searchString}".
					</p>
				</div>
			{:else if searchResults.length === 0}
				<div class="p-6 text-center">
					<Icons.Search
						class="text-surface-700-300 mx-auto mb-4"
						size={48}
					/>
					<p class="text-sm opacity-75">
						{SEARCH_HINT[modelKind]}.
					</p>
				</div>
			{:else}
				{#each searchResults as model}
					<div class="card preset-filled-surface-100-900 p-4">
						<div class="flex flex-col gap-2">
							<h4 class="text-lg font-semibold">{model.name}</h4>

							{#if model.sdcpp}
								<div>
									<span
										class="badge preset-filled-secondary-500 rounded-full px-2 py-1 text-xs"
										title="Built for stable-diffusion.cpp — the GGUF flavour KoboldCPP loads"
									>
										stable-diffusion.cpp
									</span>
								</div>
							{/if}

							{#if model.description}
								<p
									class="text-surface-700-300 line-clamp-2 text-sm"
								>
									{model.description}
								</p>
							{/if}

							<div
								class="text-surface-700-300 flex flex-wrap items-center gap-4 text-xs"
							>
								{#if model.downloads != null}
									<div class="flex items-center gap-1">
										<Icons.Download size={12} />
										<span>
											{model.downloads.toLocaleString()} downloads
										</span>
									</div>
								{/if}
								{#if model.likes != null}
									<div class="flex items-center gap-1">
										<Icons.Heart size={12} />
										<span>
											{model.likes.toLocaleString()} likes
										</span>
									</div>
								{/if}
								<div class="flex items-center gap-1">
									<Icons.Layers size={12} />
									<span>
										{pullOptionsLabel(
											model.pullOptions.length,
											modelKind
										)}
									</span>
								</div>
								<!-- Search siblings carry no size, so this only
								     appears when the API happened to report one. -->
								{#if skipsPicker(model) && model.pullOptions[0].sizeBytes}
									<div class="flex items-center gap-1">
										<Icons.HardDrive size={12} />
										<span>
											{(
												model.pullOptions[0]
													.sizeBytes! / 1_073_741_824
											).toFixed(1)}GB
										</span>
									</div>
								{/if}
							</div>

							<div class="flex gap-2">
								<button
									class="btn btn-sm preset-filled-primary-500"
									onclick={() => pickDownload(model)}
								>
									<Icons.Download size={14} />
									Download
								</button>
								{#if model.url}
									<a
										href={model.url}
										target="_blank"
										rel="noopener noreferrer"
										class="btn btn-sm preset-filled-secondary-500"
									>
										<Icons.ExternalLink size={14} />
										View
									</a>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			{/if}
		{/if}
	</div>
{/if}

<!-- Download picker modal. In image mode the rows are different checkpoints
     rather than one model at several precisions, so the whole dialog changes
     what it is asking — see PICKER_COPY. Never opens for a one-row list. -->
{#if showQuantModal && selectedModel}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-label={pickerCopy.ariaLabel}
	>
		<div
			class="card bg-surface-100-900 border-surface-300-700 w-[36rem] max-w-[95vw] space-y-4 border p-6 shadow-xl"
		>
			<div class="flex items-start justify-between gap-2">
				<div>
					<h2 class="text-lg font-bold">{pickerCopy.title}</h2>
					<p class="text-muted-foreground mt-0.5 text-sm">
						{selectedModel.name}
					</p>
				</div>
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={() => {
						showQuantModal = false
						selectedModel = null
					}}
				>
					<Icons.X size={16} />
				</button>
			</div>

			<div class="bg-surface-200-800 rounded-lg p-3 text-xs">
				{pickerCopy.blurb}
			</div>

			<div class="max-h-80 space-y-2 overflow-y-auto">
				{#each selectedModel.pullOptions as opt}
					<div
						class="card bg-surface-200-800 flex items-center justify-between p-3 {isTutorial &&
						isRecommendedQuant(modelKind, opt.label)
							? 'tutorial-highlight'
							: ''}"
						style="--tutorial-glow-radius: var(--radius-container)"
						use:revealRecommended={isTutorial &&
							isRecommendedQuant(modelKind, opt.label)}
					>
						<div class="flex items-center gap-2">
							<span class="font-mono text-sm font-medium">
								{opt.label}
							</span>
							{#if isRecommendedQuant(modelKind, opt.label)}
								<span
									class="bg-warning-500 rounded px-1.5 py-0.5 text-xs text-white"
								>
									Recommended
								</span>
							{/if}
							{#if opt.sizeBytes}
								<span class="text-surface-700-300 text-xs">
									{(opt.sizeBytes / 1_073_741_824).toFixed(
										1
									)}GB
								</span>
							{/if}
						</div>
						<button
							class="btn btn-sm preset-filled-primary-500"
							onclick={() => startDownload(selectedModel!, opt)}
						>
							<Icons.Download size={14} />
							Download
						</button>
					</div>
				{/each}
			</div>

			<div class="flex justify-end">
				<button
					class="btn preset-filled-surface-400-600"
					onclick={() => {
						showQuantModal = false
						selectedModel = null
					}}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
