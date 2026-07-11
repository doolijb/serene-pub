<script lang="ts">
	import Avatar from "$lib/client/components/Avatar.svelte"
	import SidebarListItem from "$lib/client/components/SidebarListItem.svelte"
	import CharacterCreator from "$lib/client/components/modals/CharacterCreatorModal.svelte"
	import PersonaCreator from "$lib/client/components/modals/PersonaCreatorModal.svelte"
	import CharacterLibraryModal from "$lib/client/components/modals/CharacterLibraryModal.svelte"
	import PersonaLibraryModal from "$lib/client/components/modals/PersonaLibraryModal.svelte"
	import BindingLinkerModal from "$lib/client/components/modals/BindingLinkerModal.svelte"
	import NodeLinkerModal from "$lib/client/components/modals/NodeLinkerModal.svelte"
	import OllamaIcon from "$lib/client/components/icons/OllamaIcon.svelte"
	import { FileUpload } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, onDestroy } from "svelte"
	import { goto } from "$app/navigation"
	import { fade } from "svelte/transition"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

	let userCtx: UserCtx = $state(getContext("userCtx"))
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let userSettingsCtx: UserSettingsCtx = $state(getContext("userSettingsCtx"))
	let systemSettingsCtx: SystemSettingsCtx = $state(getContext("systemSettingsCtx"))
	let ollamaSettingsCtx: OllamaSettingsCtx = $state(getContext("ollamaSettingsCtx"))
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(getContext("koboldCppSettingsCtx"))

	const socket = useTypedSocket()

	// Data
	let characters: Partial<SelectCharacter>[] = $state([])
	let personas: Partial<SelectPersona>[] = $state([])
	let chats: Partial<SelectChat>[] = $state([])
	let connections: Sockets.Connections.List.Response["connectionsList"] = $state([])

	// Setup data — tracks summarization and RAG wizard step completion (server-side)
	let setupData = $state<{ summarizationStepComplete: boolean; ragStepComplete: boolean } | null>(null)

	// Data-ready flags — wizard auto-shows once all initial socket data has arrived
	let _charsLoaded = $state(false)
	let _personasLoaded = $state(false)
	let _chatsLoaded = $state(false)
	let _connectionsLoaded = $state(false)
	let _setupLoaded = $state(false)

	let dataReady = $derived(
		_charsLoaded &&
		_personasLoaded &&
		_chatsLoaded &&
		(!userCtx.user?.isAdmin || _connectionsLoaded) &&
		_setupLoaded
	)

	let wizardStep = $state(0)
	let _wizardInitialized = $state(false)
	let showCharacterCreator = $state(false)
	let showPersonaCreator = $state(false)
	let showCharacterLibrary = $state(false)
	let showPersonaLibrary = $state(false)

	// Binding / node linker modals (Flow 1 + 2)
	let bindingLinkerOpen = $state(false)
	let bindingLinkerData = $state<Sockets.BindingCheck.Result.Response | null>(null)
	let nodeLinkerOpen = $state(false)
	let nodeLinkerData = $state<Sockets.BindingCheck.NodeResult.Response | null>(null)

	// Connection setup state
	let connectionChoice: "ollama" | "koboldcpp" | "manual" | null = $state(null)
	let selectedOllamaModel = $state("")
	let installedModels: any[] = $state([])
	let isOllamaConnected = $state(false)

	// KoboldCpp connection state
	let isKoboldCppConnected = $state(false)
	let koboldcppLoadedModels: string[] = $state([])
	let selectedKoboldCppModel = $state("")
	let isCheckingKoboldCpp = $state(false)
	let koboldcppBaseUrl = $state("http://localhost:5001")

	// Summarization step state
	let wizardSummarizationLoading = $state(false)

	// Vectorization step state
	type ModelDef = {
		id: string
		name: string
		description: string
		dimensions: number
		sizeLabel: string
		tier: "fast" | "balanced" | "best"
	}
	let wizardVectorizationModels = $state<ModelDef[]>([])
	let wizardSelectedModel = $state("")
	let wizardVectorizationLoading = $state(false)
	let wizardVectorizationProgress = $state<{ status: string; percent?: number } | null>(null)

	// Card import state
	let wizardImportingCharacterCard = $state(false)
	let wizardImportingPersonaCard = $state(false)

	// Derived setup state
	let hasConnection = $derived(!!userCtx.user?.activeConnection)
	let hasCharacter = $derived(characters.length > 0)
	let hasPersona = $derived(personas.length > 0)

	// Wizard path drives welcome copy
	let wizardPath = $derived.by((): "admin-first-time" | "admin-existing" | "non-admin" => {
		if (!userCtx.user?.isAdmin) return "non-admin"
		if (connections.length === 0) return "admin-first-time"
		return "admin-existing"
	})

	// Step definitions
	type WizardStepType =
		| "welcome"
		| "connection-setup"
		| "summarization"
		| "vectorization"
		| "character"
		| "persona"
		| "create-chat"

	interface WizardStepDefinition {
		id: WizardStepType
		label: string
		requiresAdmin?: boolean
		isComplete: () => boolean
	}

	function buildWizardStepIds(): WizardStepType[] {
		const ids: WizardStepType[] = ["welcome"]
		if (userCtx.user?.isAdmin) {
			ids.push("connection-setup")
			ids.push("summarization")
			ids.push("vectorization")
		}
		ids.push("character")
		ids.push("persona")
		ids.push("create-chat")
		return ids
	}

	const allStepDefs: Record<WizardStepType, WizardStepDefinition> = {
		welcome:            { id: "welcome",          label: "Welcome",        isComplete: () => false },
		"connection-setup": { id: "connection-setup", label: "Connect",        requiresAdmin: true, isComplete: () => hasConnection },
		summarization:      { id: "summarization",    label: "Summarization",  requiresAdmin: true, isComplete: () => setupData?.summarizationStepComplete ?? false },
		vectorization:      { id: "vectorization",    label: "RAG",            requiresAdmin: true, isComplete: () => setupData?.ragStepComplete ?? false },
		character:          { id: "character",        label: "Character",      isComplete: () => hasCharacter },
		persona:            { id: "persona",          label: "Persona",        isComplete: () => hasPersona },
		"create-chat":      { id: "create-chat",      label: "First Chat",     isComplete: () => chats.length > 0 },
	}

	let wizardSteps = $derived(buildWizardStepIds().map((id) => allStepDefs[id]))

	let currentWizardStep = $derived(wizardSteps[wizardStep])
	let totalWizardSteps = $derived(wizardSteps.length)

	// All steps (excluding the non-completable welcome) must be done for the wizard to disappear
	let allStepsComplete = $derived(wizardSteps.slice(1).every(s => s.isComplete()))

	// Auto-position wizard to first incomplete step on initial data load
	$effect(() => {
		if (dataReady && !allStepsComplete && !_wizardInitialized) {
			_wizardInitialized = true
			// Set default user configs on first wizard show
			if (!userCtx.user?.activeSamplingConfig) socket.emit("samplingConfigs:setUserActive", { id: 1 })
			if (!userCtx.user?.activeContextConfig) socket.emit("contextConfigs:setUserActive", { id: 1 })
			if (!userCtx.user?.activePromptConfig) socket.emit("promptConfigs:setUserActive", { id: 1 })
			// Skip welcome if any step is already complete
			const anyDone = wizardSteps.slice(1).some(s => s.isComplete())
			if (anyDone) {
				const firstIncomplete = wizardSteps.findIndex((s, i) => i > 0 && !s.isComplete())
				if (firstIncomplete !== -1) wizardStep = firstIncomplete
			}
		}
	})

	// Vectorization model tiers for the wizard
	let fastModels = $derived(wizardVectorizationModels.filter((m) => m.tier === "fast"))
	let balancedModels = $derived(wizardVectorizationModels.filter((m) => m.tier === "balanced"))
	let bestModels = $derived(wizardVectorizationModels.filter((m) => m.tier === "best"))

	// Navigation
	function openPanel(key: string) {
		panelsCtx.openPanel({ key })
	}

	function nextWizardStep() {
		if (wizardStep < totalWizardSteps - 1) wizardStep++
	}

	function prevWizardStep() {
		if (wizardStep > 0) wizardStep--
	}

	function closeWizard() {
		wizardStep = 0
		connectionChoice = null
		wizardVectorizationProgress = null
		wizardVectorizationLoading = false
		wizardSummarizationLoading = false
		isKoboldCppConnected = false
		koboldcppLoadedModels = []
		selectedKoboldCppModel = ""
		isCheckingKoboldCpp = false
	}

	function markSetupComplete(step: "summarization" | "rag") {
		socket.emit("setup:markComplete", { step })
	}

	function startChatWithCharacter(character: Partial<SelectCharacter>) {
		if (!character.id) return
		const personaId = personas[0]?.id
		socket.emit("chats:create", {
			chat: {
				name: `Chat with ${character.nickname || character.name || "Character"}`,
				isGroup: false
			},
			characterIds: [character.id],
			personaIds: personaId ? [personaId] : [],
			characterPositions: { [character.id]: 0 }
		} as any)
	}

	function checkKoboldCppConnection() {
		isCheckingKoboldCpp = true
		socket.emit("koboldcpp:version", {})
	}

	function connectKoboldCppModel() {
		if (!selectedKoboldCppModel) return
		socket.emit("koboldcpp:connectModel", { modelName: selectedKoboldCppModel })
	}


	function checkOllamaConnection() {
		socket.emit("ollama:version", {})
	}

	function refreshOllamaModels() {
		socket.emit("ollama:modelsList", {})
	}

	function createSamplePersona() {
		socket.emit("personas:create", {
			persona: {
				name: "You",
				description:
					"This represents you in conversations. You can edit this later to add more details about yourself or create different personas for different types of chats.",
				isDefault: true
			} as any
		})
	}

	function toggleBanner() {
		socket.emit("userSettings:updateShowHomePageBanner", { enabled: false })
	}

	function enableSummarization() {
		wizardSummarizationLoading = true
		socket.emit("systemSettings:updateSummarizationEnabled", { enabled: true })
	}

	function configureRag() {
		if (!wizardSelectedModel) return
		wizardVectorizationLoading = true
		wizardVectorizationProgress = null
		// Sets the embedding model but does NOT enable vectorization
		socket.emit("vectorization:setModel", { modelName: wizardSelectedModel })
	}

	async function handleCharacterCardImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		wizardImportingCharacterCard = true
		const file = details.files[0]
		const reader = new FileReader()
		reader.onload = (e) => {
			const base64 = (e.target?.result as string)?.split(",")[1]
			if (base64) socket.emit("characters:importCard", { file: base64 })
		}
		reader.readAsDataURL(file)
	}

	async function handlePersonaCardImport(details: FileAcceptDetails) {
		if (!details.files || details.files.length === 0) return
		wizardImportingPersonaCard = true
		const file = details.files[0]
		const reader = new FileReader()
		reader.onload = (e) => {
			const base64 = (e.target?.result as string)?.split(",")[1]
			if (base64) socket.emit("personas:importCard", { file: base64 })
		}
		reader.readAsDataURL(file)
	}

	onMount(() => {
		socket.on("characters:list", (msg) => {
			characters = msg.characterList || []
			_charsLoaded = true
			if (!allStepsComplete && currentWizardStep?.id === "character" && characters.length > 0)
				nextWizardStep()
		})
		socket.on("personas:list", (msg) => {
			personas = msg.personaList || []
			_personasLoaded = true
			if (!allStepsComplete && currentWizardStep?.id === "persona" && personas.length > 0)
				nextWizardStep()
		})
		socket.on("chats:list", (msg) => {
			chats = msg.chatList || []
			_chatsLoaded = true
		})
		socket.on("connections:list", (msg) => {
			connections = msg.connectionsList || []
			_connectionsLoaded = true
		})
		socket.on("setup:get", (msg) => {
			setupData = msg.setup
			_setupLoaded = true
		})
		socket.on("setup:markComplete", (msg) => {
			if (msg.setup) setupData = msg.setup
		})

		socket.on("ollama:version", (message) => {
			isOllamaConnected = !!message.version
			if (isOllamaConnected && !allStepsComplete) refreshOllamaModels()
		})
		socket.on("ollama:modelsList", (message) => {
			installedModels = message.models || []
		})
		socket.on("ollama:connectModel", (message) => {
			if (message.success) nextWizardStep()
			else
				toaster.error({
					title: "Connection Failed",
					description: "Failed to connect to the Ollama model"
				})
		})

		// KoboldCpp listeners
		;(socket as any).on("koboldcpp:version", (message: any) => {
			isCheckingKoboldCpp = false
			isKoboldCppConnected = !!message.version
			if (isKoboldCppConnected && !allStepsComplete && connectionChoice === "koboldcpp") {
				socket.emit("koboldcpp:listModels", {})
			}
		})
		;(socket as any).on("koboldcpp:version:error", () => {
			isCheckingKoboldCpp = false
			isKoboldCppConnected = false
		})
		;(socket as any).on("koboldcpp:listModels", (message: any) => {
			koboldcppLoadedModels = message.models?.map((m: any) => m.filename ?? m.id ?? m) ?? []
			if (koboldcppLoadedModels.length > 0 && !selectedKoboldCppModel) {
				selectedKoboldCppModel = koboldcppLoadedModels[0]
			}
		})
		;(socket as any).on("koboldcpp:connectModel", (message: any) => {
			if (message.success && !allStepsComplete && currentWizardStep?.id === "connection-setup") {
				nextWizardStep()
			}
		})
		;(socket as any).on("koboldcpp:connectModel:error", (message: any) => {
			toaster.error({
				title: "KoboldCPP Connection Failed",
				description: message.error ?? "Could not connect to the model"
			})
		})
		socket.on("connections:create", (res) => {
			if (res.connection) {
				socket.emit("connections:setUserActive", { id: res.connection.id })
				toaster.success({
					title: "Connection Created",
					description: `Connected to ${res.connection.name}`
				})
				nextWizardStep()
			}
		})
		socket.on("characters:create", (res) => {
			if (res.character && !allStepsComplete) nextWizardStep()
		})
		socket.on("personas:create", (res) => {
			if (res.persona && !allStepsComplete) nextWizardStep()
		})
		socket.on("chats:create", (res) => {
			if (res.chat) {
				goto(`/chats/${res.chat.id}`)
			}
		})

		// Summarization enable response — also marks summarization step complete
		socket.on("systemSettings:updateSummarizationEnabled", (msg: any) => {
			wizardSummarizationLoading = false
			if (msg.enabled && currentWizardStep?.id === "summarization") {
				markSetupComplete("summarization")
				nextWizardStep()
			}
		})

		// RAG model configuration responses — marks RAG step complete but does NOT enable RAG
		socket.on("vectorization:listModels", (msg: any) => {
			wizardVectorizationModels = msg.models ?? []
			if (!wizardSelectedModel && msg.models?.length > 0) {
				const balancedModel = msg.models.find((m: ModelDef) => m.tier === "balanced")
				const fastModel = msg.models.find((m: ModelDef) => m.tier === "fast")
				wizardSelectedModel = balancedModel?.id ?? fastModel?.id ?? msg.models[0].id
			}
		})
		socket.on("vectorization:setModel", (msg: any) => {
			if (msg.success && wizardVectorizationLoading) {
				wizardVectorizationLoading = false
				wizardVectorizationProgress = null
				if (currentWizardStep?.id === "vectorization") {
					markSetupComplete("rag")
					nextWizardStep()
				}
			}
		})
		socket.on("vectorization:modelDownloadProgress", (msg: any) => {
			if (!wizardVectorizationLoading) return
			wizardVectorizationProgress = { status: msg.status, percent: msg.percent }
			if (msg.status === "ready") {
				wizardVectorizationLoading = false
				wizardVectorizationProgress = null
				if (currentWizardStep?.id === "vectorization") {
					markSetupComplete("rag")
					nextWizardStep()
				}
			}
		})
		socket.on("vectorization:setModel:error", (msg: any) => {
			wizardVectorizationLoading = false
			wizardVectorizationProgress = null
			toaster.error({ title: "RAG configuration failed", description: msg.error ?? "Unknown error" })
		})

		// Card imports from wizard
		socket.on("characters:importCard", (msg: any) => {
			wizardImportingCharacterCard = false
			if (msg.character) {
				toaster.success({
					title: `Imported ${msg.character.nickname || msg.character.name}!`
				})
				if (!allStepsComplete && currentWizardStep?.id === "character") nextWizardStep()
			}
		})
		;(socket as any).on("characters:importCard:error", (msg: any) => {
			wizardImportingCharacterCard = false
			toaster.error({
				title: "Import Failed",
				description: msg.error ?? "Could not import character card"
			})
		})
		socket.on("personas:importCard", (msg: any) => {
			wizardImportingPersonaCard = false
			if (msg.persona) {
				toaster.success({ title: `Imported ${msg.persona.name}!` })
				if (!allStepsComplete && currentWizardStep?.id === "persona") nextWizardStep()
			}
		})
		socket.on("personas:importCard:error", (msg: any) => {
			wizardImportingPersonaCard = false
			toaster.error({
				title: "Import Failed",
				description: msg.error ?? "Could not import persona card"
			})
		})

		// Library imports — advance wizard on success
		socket.on("characters:importFromLibrary", (msg: any) => {
			if (msg.character && !allStepsComplete && currentWizardStep?.id === "character") {
				showCharacterLibrary = false
				nextWizardStep()
			}
		})
		socket.on("personas:importFromLibrary", (msg: any) => {
			if (msg.persona && !allStepsComplete && currentWizardStep?.id === "persona") {
				showPersonaLibrary = false
				nextWizardStep()
			}
		})

		// Binding / node linker modals
		socket.on("bindingCheck:result", (data) => {
			if (data.orphanedBindings.length > 0) {
				bindingLinkerData = data
				bindingLinkerOpen = true
			}
		})
		socket.on("bindingCheck:nodeResult", (data) => {
			if (data.pendingBindings.length > 0) {
				nodeLinkerData = data
				nodeLinkerOpen = true
			}
		})

		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		socket.emit("chats:list", {})
		socket.emit("setup:get", {})
		if (userCtx.user?.isAdmin) {
			socket.emit("connections:list", {})
			socket.emit("vectorization:listModels", {})
		} else {
			_connectionsLoaded = true
		}
	})

	onDestroy(() => {
		socket.off("bindingCheck:result")
		socket.off("bindingCheck:nodeResult")
		socket.off("characters:list")
		socket.off("personas:list")
		socket.off("chats:list")
		socket.off("connections:list")
		socket.off("connections:create")
		socket.off("characters:create")
		socket.off("personas:create")
		socket.off("chats:create")
		socket.off("ollama:version")
		socket.off("ollama:modelsList")
		socket.off("ollama:connectModel")
		;(socket as any).off("koboldcpp:version")
		;(socket as any).off("koboldcpp:version:error")
		;(socket as any).off("koboldcpp:listModels")
		;(socket as any).off("koboldcpp:connectModel")
		;(socket as any).off("koboldcpp:connectModel:error")
		socket.off("systemSettings:updateSummarizationEnabled")
		socket.off("vectorization:listModels")
		socket.off("vectorization:setModel")
		socket.off("vectorization:modelDownloadProgress")
		socket.off("vectorization:setModel:error")
		socket.off("characters:importCard")
		;(socket as any).off("characters:importCard:error")
		socket.off("personas:importCard")
		socket.off("personas:importCard:error")
		socket.off("characters:importFromLibrary")
		socket.off("personas:importFromLibrary")
		socket.off("setup:get")
		socket.off("setup:markComplete")
	})
</script>

<svelte:head>
	<title>Serene Pub - Get Started</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

<!-- Page background content -->
<div class="flex flex-1 flex-col items-center justify-center gap-4 px-2 md:px-0">
	{#if userSettingsCtx.settings?.showHomePageBanner}
		<div class="relative w-full">
			<img
				src={(userSettingsCtx.settings?.darkMode !== undefined
					? userSettingsCtx.settings.darkMode
					: true) === false
					? "logo-w-text.png"
					: "logo-w-text-dark.png"}
				alt="Serene Pub Logo"
				class="bg-primary-500/25 w-full rounded-xl"
			/>
			<button
				class="text-primary-800 hover:text-primary-900 dark:text-primary-200 hover:dark:text-primary-100 absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/20 text-xl leading-none font-bold hover:bg-black/30"
				onclick={toggleBanner}
				title="Hide banner"
			>
				×
			</button>
		</div>
	{/if}

	<div class="preset-filled-warning-100-900 mx-auto w-full rounded-lg p-2 text-center text-sm">
		<strong>Serene Pub is in alpha!</strong>
		Expect bugs and rapid changes. This project is under heavy development.
	</div>

	<!-- Loading state while socket data arrives -->
	{#if !dataReady}
		<div class="preset-filled-surface-200-800 mx-auto w-full rounded-2xl p-10 text-center">
			<Icons.Loader size={40} class="text-primary-500 mx-auto mb-4 animate-spin" />
			<p class="text-muted-foreground">Loading…</p>
		</div>
	{/if}

	<!-- Main content — shown when all wizard steps are complete -->
	{#if dataReady && allStepsComplete}
		<div class="w-full">
			<h3 class="w-full text-xl">Characters</h3>
			<div class="grid grid-cols-1 justify-between gap-2 lg:grid-cols-2">
				{#each characters as character (character.id)}
					<SidebarListItem
						onclick={() => {
							panelsCtx.digest.chatCharacterId = character.id
							panelsCtx.openPanel({ key: "chats", toggle: false })
						}}
						contentTitle="Go to character chats"
						classes="!preset-filled-surface-200-800 transition-colors hover:!preset-filled-surface-300-700"
					>
						{#snippet content()}
							<div class="flex gap-2">
								<div class="h-[4em] min-h-[4em] w-[4em] min-w-[4em]">
									<Avatar char={character} />
								</div>
								<div class="gap2 flex flex-col">
									<div class="text-foreground text-left font-semibold">
										{character.nickname || character.name || "Unknown"}
									</div>
									<div class="text-muted-foreground line-clamp-2 text-sm">
										{character.description || "No description"}
									</div>
								</div>
							</div>
						{/snippet}
					</SidebarListItem>
				{/each}
			</div>
		</div>

		{#if chats.length > 0}
			<div class="w-full">
				<h3 class="w-full text-xl">Recent Chats</h3>
				<div class="grid grid-cols-1 justify-between gap-2 lg:grid-cols-2">
					{#each chats.slice(0, 6) as chat (chat.id)}
						<SidebarListItem
							onclick={() => goto(`/chats/${chat.id}`)}
							contentTitle="Open chat"
							classes="!preset-filled-surface-200-800 transition-colors hover:!preset-filled-surface-300-700"
						>
							{#snippet content()}
								<div class="flex items-center gap-2">
									{#if chat.isGroup}
										<Icons.Users size={20} class="text-primary-500 flex-shrink-0" />
									{:else}
										<Icons.MessageSquare size={20} class="text-primary-500 flex-shrink-0" />
									{/if}
									<div class="text-foreground font-semibold">
										{chat.name || "Untitled Chat"}
									</div>
								</div>
							{/snippet}
						</SidebarListItem>
					{/each}
				</div>
			</div>
		{/if}
	{/if}

	<!-- Wizard — shown until all steps are complete -->
	{#if dataReady && !allStepsComplete}
		<div class="preset-filled-surface-200-800 mx-auto w-full overflow-hidden rounded-2xl">

			<!-- Wizard header: step indicator -->
			<header class="border-surface-300-700 flex-shrink-0 border-b px-6 py-5">
				<div class="flex items-center justify-center gap-0">
					{#each wizardSteps as step, i}
						{#if i > 0}
							<div
								class="mx-1 h-0.5 w-8 flex-shrink-0 transition-colors {i <= wizardStep
									? 'bg-primary-500'
									: 'bg-surface-300-700'}"
							></div>
						{/if}
						<button
							class="flex flex-col items-center gap-1 flex-shrink-0"
							onclick={() => { if (i < wizardStep) wizardStep = i }}
							disabled={i >= wizardStep}
							title={i < wizardStep ? `Back to ${step.label}` : step.label}
						>
							<div
								class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all
								{i < wizardStep
									? 'bg-success-500 text-white scale-90'
									: i === wizardStep
										? 'bg-primary-500 text-white scale-110 shadow-md'
										: 'bg-surface-300-700 text-surface-400 scale-90'}"
							>
								{#if i < wizardStep}
									<Icons.Check size={14} />
								{:else}
									{i + 1}
								{/if}
							</div>
							<span
								class="hidden text-xs sm:block transition-opacity {i === wizardStep
									? 'font-semibold opacity-100'
									: 'opacity-40'}"
							>
								{step.label}
							</span>
						</button>
					{/each}
				</div>
			</header>

			<!-- Wizard body: scrollable step content -->
			<main class="flex-1 overflow-y-auto">
				{#key wizardStep}
					<div class="flex flex-col gap-6 p-8" transition:fade={{ duration: 120 }}>

						<!-- ══ WELCOME ══ -->
						{#if currentWizardStep?.id === "welcome"}
							<div class="text-center">
								<Icons.Sparkles size={60} class="text-primary-500 mx-auto mb-4" />
								<h2 class="mb-3 text-3xl font-bold">
									{#if wizardPath === "admin-first-time"}
										Welcome to Serene Pub!
									{:else if wizardPath === "admin-existing"}
										Welcome, Admin!
									{:else}
										Welcome!
									{/if}
								</h2>
								<p class="text-muted-foreground mx-auto max-w-sm text-base">
									{#if wizardPath === "admin-first-time"}
										Let's get your server set up and ready to chat. This only takes a few minutes.
									{:else if wizardPath === "admin-existing"}
										The server is already configured. Let's get your personal account set up so you can start chatting.
									{:else}
										An administrator has already set up the server. Let's get your account ready so you can start chatting.
									{/if}
								</p>
							</div>

						<!-- ══ CONNECTION SETUP ══ -->
						{:else if currentWizardStep?.id === "connection-setup"}
							{#if hasConnection}
								<!-- Already connected -->
								<div class="text-center">
									<Icons.CheckCircle size={60} class="text-success-500 mx-auto mb-4" />
									<h2 class="mb-3 text-3xl font-bold">Connected!</h2>
									<p class="text-muted-foreground">
										You're connected to <strong>{userCtx.user?.activeConnection?.name}</strong>.
									</p>
								</div>

							{:else if connectionChoice === null}
								<!-- Pick a path -->
								<div class="text-center">
									<Icons.Cable size={60} class="text-primary-500 mx-auto mb-4" />
									<h2 class="mb-3 text-3xl font-bold">Connect to an AI</h2>
									<p class="text-muted-foreground mb-6">
										Choose how you'd like to run your AI. All options are free and run locally on your server.
									</p>
								</div>
								<div class="grid gap-3">
									<!-- KoboldCpp -->
									<button
										class="card preset-filled-surface-400-600 flex items-start gap-4 p-5 text-left transition-transform hover:scale-[1.01] hover:preset-filled-surface-300-700"
										onclick={() => {
											connectionChoice = "koboldcpp"
											socket.emit("systemSettings:updateKoboldCppManagerEnabled", { enabled: true })
											socket.emit("systemSettings:updateOllamaManagerEnabled", { enabled: false })
										}}
									>
										<span class="mt-0.5 inline-block h-8 w-8 flex-shrink-0" style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;" aria-hidden="true"></span>
										<div>
											<div class="mb-1 font-bold">KoboldCPP <span class="text-xs font-normal opacity-60">— Easy</span></div>
											<p class="text-sm opacity-90">
												A highly performant engine fine-tuned for storytelling and roleplay. Download and manage automatically with Serene Pub.
											</p>
										</div>
									</button>
									<!-- Ollama -->
									<button
										class="card preset-filled-surface-400-600 flex items-start gap-4 p-5 text-left transition-transform hover:scale-[1.01] hover:preset-filled-surface-300-700"
										onclick={() => {
											connectionChoice = "ollama"
											socket.emit("systemSettings:updateOllamaManagerEnabled", { enabled: true })
											socket.emit("systemSettings:updateKoboldCppManagerEnabled", { enabled: false })
											checkOllamaConnection()
										}}
									>
										<OllamaIcon class="mt-0.5 h-8 w-8 flex-shrink-0" />
										<div>
											<div class="mb-1 font-bold">Ollama <span class="text-xs font-normal opacity-80">— Easy</span></div>
											<p class="text-sm opacity-90">
												Incredibly easy to install, seamless and managed entirely within Serene Pub. Search, download, and activate models in a few simple clicks.
											</p>
										</div>
									</button>
									<!-- Manual -->
									<button
										class="card preset-filled-surface-400-600 flex items-start gap-4 p-5 text-left transition-transform hover:scale-[1.01] hover:preset-filled-surface-300-700"
										onclick={() => {
											connectionChoice = "manual"
											socket.emit("systemSettings:updateKoboldCppManagerEnabled", { enabled: false })
											socket.emit("systemSettings:updateOllamaManagerEnabled", { enabled: false })
											panelsCtx.digest.tutorial = true
											openPanel("connections")
										}}
									>
										<Icons.Settings size={32} class="mt-0.5 flex-shrink-0" />
										<div>
											<div class="mb-1 font-bold">Manual Setup <span class="text-xs font-normal opacity-50">— Advanced</span></div>
											<p class="text-sm opacity-60">
												Configure OpenAI, LM Studio, Claude, LlamaCpp, or any other service yourself.
											</p>
										</div>
									</button>
								</div>

							{:else if connectionChoice === "manual"}
								<div class="text-center">
									<Icons.Cable size={60} class="text-primary-500 mx-auto mb-4" />
									<h2 class="mb-3 text-3xl font-bold">Waiting for Connection</h2>
									<p class="text-muted-foreground">
										Set up your connection in the Connections panel, then come back — this updates automatically when a connection is active.
									</p>
								</div>

							{:else if connectionChoice === "ollama"}
								{#if ollamaSettingsCtx.settings?.ollamaManagerEnabled}
									<div class="text-center">
										<OllamaIcon class="text-primary-500 mx-auto mb-4 h-14 w-14" />
										<h2 class="mb-3 text-3xl font-bold">Set Up with Ollama Manager</h2>
										<p class="text-muted-foreground">
											Open the Ollama Manager to download a model and connect to it. Come back here when done — this updates automatically.
										</p>
									</div>
								{:else}
									<div class="mb-4 text-center">
										<OllamaIcon class="text-primary-500 mx-auto mb-4 h-14 w-14" />
										<h2 class="mb-2 text-2xl font-bold">Set Up Ollama</h2>
									</div>
									<div class="bg-surface-500/10 rounded-xl p-4">
										<h4 class="mb-3 font-semibold">Quick setup:</h4>
										<ol class="list-inside list-decimal space-y-2 text-sm">
											<li>Download and install Ollama from <a href="https://ollama.com" target="_blank" rel="noreferrer" class="text-primary-500 hover:underline">ollama.com</a></li>
											<li>Open a terminal and run: <code class="bg-surface-500/20 ml-1 rounded px-2 py-0.5 text-xs">ollama pull llama3.2</code></li>
											<li>Come back here and select the model below</li>
										</ol>
									</div>
									<div>
										<label class="mb-2 block text-sm font-semibold" for="ollama-model">Choose a model:</label>
										<select id="ollama-model" class="select w-full" bind:value={selectedOllamaModel}>
											<option value="">Select a model…</option>
											<option value="llama3.2">Llama 3.2 (Recommended)</option>
											<option value="llama3.2:1b">Llama 3.2 1B (Faster, lighter)</option>
											<option value="qwen2.5">Qwen 2.5</option>
											<option value="mistral">Mistral 7B</option>
										</select>
									</div>
								{/if}

							{:else if connectionChoice === "koboldcpp"}
								{#if koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
									<div class="text-center">
										<span class="text-primary-500 mx-auto mb-4 block h-14 w-14" style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;" aria-hidden="true"></span>
										<h2 class="mb-3 text-3xl font-bold">Set Up with KoboldCPP Manager</h2>
										<p class="text-muted-foreground">
											Open the KoboldCPP Manager to load a model and connect to it. Come back here when done — this updates automatically.
										</p>
									</div>
								{:else}
									<div class="mb-4 text-center">
										<span class="text-primary-500 mx-auto mb-4 block h-14 w-14" style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;" aria-hidden="true"></span>
										<h2 class="mb-2 text-2xl font-bold">Set Up KoboldCPP</h2>
									</div>
									<div class="bg-surface-500/10 rounded-xl p-4">
										<h4 class="mb-3 font-semibold">Quick setup:</h4>
										<ol class="list-inside list-decimal space-y-2 text-sm">
											<li>Download KoboldCPP from <a href="https://github.com/LostRuins/koboldcpp/releases" target="_blank" rel="noreferrer" class="text-primary-500 hover:underline">GitHub</a></li>
											<li>Download a GGUF model (try <a href="https://huggingface.co/models?library=gguf" target="_blank" rel="noreferrer" class="text-primary-500 hover:underline">Hugging Face</a>)</li>
											<li>Launch KoboldCPP and load your model</li>
											<li>Enter the URL below and click Detect</li>
										</ol>
									</div>
									<div class="flex gap-2">
										<input
											class="input flex-1"
											type="text"
											bind:value={koboldcppBaseUrl}
											placeholder="http://localhost:5001"
										/>
										<button
											class="btn preset-filled-surface-400-600"
											onclick={checkKoboldCppConnection}
											disabled={isCheckingKoboldCpp}
										>
											{#if isCheckingKoboldCpp}
												<Icons.Loader size={14} class="animate-spin" />
											{:else}
												<Icons.Search size={14} />
											{/if}
											Detect
										</button>
									</div>
									{#if isKoboldCppConnected && koboldcppLoadedModels.length > 0}
										<div class="mt-4">
											<label class="mb-2 block text-sm font-semibold" for="kcpp-model">Loaded model:</label>
											<select id="kcpp-model" class="select w-full" bind:value={selectedKoboldCppModel}>
												{#each koboldcppLoadedModels as m}
													<option value={m}>{m}</option>
												{/each}
											</select>
										</div>
									{:else if isKoboldCppConnected && koboldcppLoadedModels.length === 0}
										<p class="mt-3 text-sm opacity-60">KoboldCPP is running but no models are loaded yet. Load a model in KoboldCPP and click Detect again.</p>
									{/if}
								{/if}
							{/if}

						<!-- ══ SUMMARIZATION ══ -->
						{:else if currentWizardStep?.id === "summarization"}
							<div class="text-center">
								<Icons.BookOpen size={60} class="text-primary-500 mx-auto mb-4" />
								<h2 class="mb-3 text-3xl font-bold">Help the AI Remember</h2>
								<p class="text-muted-foreground mx-auto max-w-sm">
									Manually summarize conversations to help the AI build a clearer picture of your story — you choose what gets captured and when.
								</p>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								<div class="bg-surface-500/10 rounded-xl p-4">
									<div class="mb-2 flex items-center gap-2 font-semibold">
										<Icons.Lightbulb size={16} class="text-primary-500" />
										What it does
									</div>
									<p class="text-sm opacity-75">
										You trigger summarization manually in a chat. Serene compresses selected messages into a compact record that the AI uses to stay aware of past events without running out of context.
									</p>
								</div>
								<div class="bg-surface-500/10 rounded-xl p-4">
									<div class="mb-2 flex items-center gap-2 font-semibold">
										<Icons.Zap size={16} class="text-warning-500" />
										Resource usage
									</div>
									<p class="text-sm opacity-75">
										Increases AI usage by around 30%. Summarization only runs when you manually trigger it in a chat, so you stay in control.
									</p>
								</div>
							</div>

						<!-- ══ VECTORIZATION ══ -->
						{:else if currentWizardStep?.id === "vectorization"}
							<div class="text-center">
								<Icons.Database size={60} class="text-primary-500 mx-auto mb-4" />
								<h2 class="mb-3 text-3xl font-bold">Supercharge Context with RAG</h2>
								<p class="text-muted-foreground mx-auto max-w-sm">
									Serene can search your character lore, world-building notes, and story history to automatically include the most relevant details in every message.
								</p>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								<div class="bg-surface-500/10 rounded-xl p-4">
									<div class="mb-2 flex items-center gap-2 font-semibold">
										<Icons.Search size={16} class="text-primary-500" />
										What it does
									</div>
									<p class="text-sm opacity-75">
										A small AI model understands the meaning of your lore. When you chat, Serene Pub finds the most relevant entries and quietly adds them to every message.
									</p>
								</div>
								<div class="bg-surface-500/10 rounded-xl p-4">
									<div class="mb-2 flex items-center gap-2 font-semibold">
										<Icons.Cpu size={16} class="text-success-500" />
										Resource usage
									</div>
									<p class="text-sm opacity-75">
										CPU only — runs a small model locally in the background. One-time download, then works silently without extra AI calls.
									</p>
								</div>
							</div>

							<!-- Model tier picker -->
							{#if wizardVectorizationModels.length > 0}
								<div>
									<p class="mb-3 text-sm font-semibold">Choose a model:</p>
									<div class="grid gap-2">
										{#if fastModels.length > 0}
											<button
												class="card flex items-start gap-3 p-4 text-left transition-all {wizardSelectedModel === fastModels[0].id
													? 'preset-filled-primary-500'
													: 'preset-filled-surface-400-600 hover:preset-filled-surface-300-700'}"
												onclick={() => (wizardSelectedModel = fastModels[0].id)}
											>
												<Icons.Zap size={20} class="mt-0.5 flex-shrink-0" />
												<div class="flex-1">
													<div class="font-semibold">Fast</div>
													<div class="text-sm opacity-75">{fastModels[0].name} · {fastModels[0].sizeLabel}</div>
													<div class="mt-1 text-xs opacity-60">Smallest download, lowest resource use</div>
												</div>
												{#if wizardSelectedModel === fastModels[0].id}
													<Icons.CheckCircle size={18} class="mt-0.5 flex-shrink-0" />
												{/if}
											</button>
										{/if}
										{#if balancedModels.length > 0}
											<button
												class="card flex items-start gap-3 p-4 text-left transition-all {wizardSelectedModel === balancedModels[0].id
													? 'preset-filled-primary-500'
													: 'preset-filled-surface-400-600 hover:preset-filled-surface-300-700'}"
												onclick={() => (wizardSelectedModel = balancedModels[0].id)}
											>
												<Icons.Scale size={20} class="mt-0.5 flex-shrink-0" />
												<div class="flex-1">
													<div class="font-semibold">Balanced <span class="text-xs opacity-75">— Recommended</span></div>
													<div class="text-sm opacity-75">{balancedModels[0].name} · {balancedModels[0].sizeLabel}</div>
													<div class="mt-1 text-xs opacity-60">Best balance of quality and resource use for most setups</div>
												</div>
												{#if wizardSelectedModel === balancedModels[0].id}
													<Icons.CheckCircle size={18} class="mt-0.5 flex-shrink-0" />
												{/if}
											</button>
										{/if}
										{#if bestModels.length > 0}
											<button
												class="card flex items-start gap-3 p-4 text-left transition-all {wizardSelectedModel === bestModels[0].id
													? 'preset-filled-primary-500'
													: 'preset-filled-surface-400-600 hover:preset-filled-surface-300-700'}"
												onclick={() => (wizardSelectedModel = bestModels[0].id)}
											>
												<Icons.Trophy size={20} class="mt-0.5 flex-shrink-0" />
												<div class="flex-1">
													<div class="font-semibold">Best Quality</div>
													<div class="text-sm opacity-75">{bestModels[0].name} · {bestModels[0].sizeLabel}</div>
													<div class="mt-1 text-xs opacity-60">Maximum accuracy, largest download</div>
												</div>
												{#if wizardSelectedModel === bestModels[0].id}
													<Icons.CheckCircle size={18} class="mt-0.5 flex-shrink-0" />
												{/if}
											</button>
										{/if}
									</div>
								</div>
							{:else}
								<div class="text-center opacity-50 text-sm">Loading available models…</div>
							{/if}

							<!-- Download progress -->
							{#if wizardVectorizationLoading}
								<div class="bg-surface-500/10 rounded-xl p-4">
									<div class="mb-2 flex items-center gap-2 text-sm font-semibold">
										<Icons.Loader size={14} class="animate-spin" />
										{wizardVectorizationProgress?.status === "downloading"
											? "Downloading model…"
											: wizardVectorizationProgress?.status === "loading"
												? "Loading model…"
												: "Setting up…"}
									</div>
									{#if wizardVectorizationProgress?.percent != null}
										<div class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full">
											<div
												class="bg-primary-500 h-full rounded-full transition-all"
												style="width: {wizardVectorizationProgress.percent}%"
											></div>
										</div>
										<p class="mt-1 text-right text-xs opacity-50">
											{Math.round(wizardVectorizationProgress.percent)}%
										</p>
									{/if}
								</div>
							{/if}

						<!-- ══ CHARACTER ══ -->
						{:else if currentWizardStep?.id === "character"}
							<div class="text-center">
								<Icons.Users size={60} class="text-primary-500 mx-auto mb-4" />
								<h2 class="mb-3 text-3xl font-bold">Add Your First Character</h2>
								<p class="text-muted-foreground mx-auto max-w-sm">
									Characters are the AI personalities you'll chat with. Add one to get started — you can always create more later.
								</p>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								<button
									class="card preset-filled-surface-400-600 flex flex-col items-start gap-2 p-5 text-left transition-transform hover:scale-[1.02] hover:preset-filled-surface-300-700"
									onclick={() => (showCharacterLibrary = true)}
								>
									<div class="flex items-center gap-2 font-bold">
										<Icons.Library size={20} class="text-primary-500" />
										Browse Library
									</div>
									<p class="text-sm opacity-75">
										Pick a ready-made character from the Serene Pub community library.
									</p>
								</button>
								{#if userCtx.user?.isAdmin}
								<button
									class="card preset-filled-surface-400-600 flex flex-col items-start gap-2 p-5 text-left transition-transform hover:scale-[1.02] hover:preset-filled-surface-300-700"
									onclick={() => {
										closeWizard()
										goto("/import")
									}}
								>
									<div class="flex items-center gap-2 font-bold">
										<Icons.FolderOpen size={20} class="text-primary-500" />
										Import from SillyTavern
									</div>
									<p class="text-sm opacity-75">
										Import characters, personas, and chats from an existing SillyTavern installation.
									</p>
								</button>
								{/if}
								<div class="card preset-tonal-surface flex flex-col gap-2 p-5">
									<div class="flex items-center gap-2 font-bold">
										<Icons.Upload size={20} class="text-primary-500" />
										Import from File
									</div>
									<p class="mb-1 text-sm opacity-75">
										Upload a character card (.png or .json).
									</p>
									{#if wizardImportingCharacterCard}
										<div class="flex items-center gap-2 text-sm">
											<Icons.Loader size={14} class="animate-spin" />
											Importing…
										</div>
									{:else}
										<FileUpload
											name="wizard-char-card"
											accept=".png,.apng,.jpeg,.jpg,.webp,.json"
											maxFiles={1}
											onFileAccept={handleCharacterCardImport}
											onFileReject={console.error}
											classes="w-full"
										/>
									{/if}
								</div>
								<button
									class="card preset-filled-surface-400-600 flex flex-col items-start gap-2 p-5 text-left transition-transform hover:scale-[1.02] hover:preset-filled-surface-300-700"
									onclick={() => (showCharacterCreator = true)}
								>
									<div class="flex items-center gap-2 font-bold">
										<Icons.UserPlus size={20} class="text-primary-500" />
										Create from Scratch
									</div>
									<p class="text-sm opacity-75">
										Design a custom character with a name, avatar, and personality.
									</p>
								</button>
							</div>

						<!-- ══ PERSONA ══ -->
						{:else if currentWizardStep?.id === "persona"}
							<div class="text-center">
								<Icons.UserCircle size={60} class="text-primary-500 mx-auto mb-4" />
								<h2 class="mb-3 text-3xl font-bold">Set Up Your Identity</h2>
								<p class="text-muted-foreground mx-auto max-w-sm">
									Your persona is how you appear in conversations. You can have different personas for different characters or moods.
								</p>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								<button
									class="card preset-filled-surface-400-600 flex flex-col items-start gap-2 p-5 text-left transition-transform hover:scale-[1.02] hover:preset-filled-surface-300-700"
									onclick={() => (showPersonaLibrary = true)}
								>
									<div class="flex items-center gap-2 font-bold">
										<Icons.Library size={20} class="text-primary-500" />
										Browse Library
									</div>
									<p class="text-sm opacity-75">
										Pick a persona from the Serene Pub library.
									</p>
								</button>
								<button
									class="card preset-filled-surface-400-600 flex flex-col items-start gap-2 p-5 text-left transition-transform hover:scale-[1.02] hover:preset-filled-surface-300-700"
									onclick={() => {
										closeWizard()
										goto("/import")
									}}
								>
									<div class="flex items-center gap-2 font-bold">
										<Icons.FolderOpen size={20} class="text-primary-500" />
										Import from SillyTavern
									</div>
									<p class="text-sm opacity-75">
										Import your personas from an existing SillyTavern installation.
									</p>
								</button>
								<div class="card preset-tonal-surface flex flex-col gap-2 p-5">
									<div class="flex items-center gap-2 font-bold">
										<Icons.Upload size={20} class="text-primary-500" />
										Import from File
									</div>
									<p class="mb-1 text-sm opacity-75">
										Upload a persona card (.png or .json).
									</p>
									{#if wizardImportingPersonaCard}
										<div class="flex items-center gap-2 text-sm">
											<Icons.Loader size={14} class="animate-spin" />
											Importing…
										</div>
									{:else}
										<FileUpload
											name="wizard-persona-card"
											accept=".png,.apng,.jpeg,.jpg,.webp,.json"
											maxFiles={1}
											onFileAccept={handlePersonaCardImport}
											onFileReject={console.error}
											classes="w-full"
										/>
									{/if}
								</div>
								<button
									class="card preset-filled-surface-400-600 flex flex-col items-start gap-2 p-5 text-left transition-transform hover:scale-[1.02] hover:preset-filled-surface-300-700"
									onclick={() => (showPersonaCreator = true)}
								>
									<div class="flex items-center gap-2 font-bold">
										<Icons.UserPlus size={20} class="text-primary-500" />
										Create from Scratch
									</div>
									<p class="text-sm opacity-75">
										Design a custom persona with a name and description.
									</p>
								</button>
							</div>
							<!-- Quick default option -->
							<div class="text-center">
								<p class="mb-2 text-sm opacity-50">Or, start simple:</p>
								<button
									class="btn preset-filled-surface-400-600 btn-sm"
									onclick={createSamplePersona}
								>
									<Icons.User size={14} />
									Use a "You" placeholder persona
								</button>
							</div>

						<!-- ══ CREATE CHAT ══ -->
						{:else if currentWizardStep?.id === "create-chat"}
							<div class="text-center">
								<Icons.MessageCircle size={60} class="text-primary-500 mx-auto mb-4" />
								<h2 class="mb-3 text-3xl font-bold">Start Your First Chat</h2>
								<p class="text-muted-foreground mx-auto max-w-sm">
									Pick a character to chat with. You can always come back and chat with others later.
								</p>
							</div>
							{#if characters.length > 0}
								<div class="grid gap-2 sm:grid-cols-2">
									{#each characters.slice(0, 6) as character (character.id)}
										<button
											class="card preset-filled-surface-400-600 flex items-center gap-3 p-4 text-left transition-all hover:preset-filled-surface-300-700"
											onclick={() => startChatWithCharacter(character)}
										>
											<div class="h-12 w-12 flex-shrink-0">
												<Avatar char={character} />
											</div>
											<div class="min-w-0 flex-1">
												<div class="truncate font-semibold">
													{character.nickname || character.name || "Unknown"}
												</div>
												<div class="text-muted-foreground line-clamp-1 text-sm">
													{character.description || "No description"}
												</div>
											</div>
											<Icons.ChevronRight size={16} class="flex-shrink-0 opacity-50" />
										</button>
									{/each}
								</div>
							{:else}
								<div class="text-center opacity-50 text-sm">
									No characters yet — go back to the Character step to add one first.
								</div>
							{/if}
						{/if}

					</div>
				{/key}
			</main>

			<!-- Wizard footer: navigation -->
			<footer class="border-surface-300-700 flex-shrink-0 border-t px-6 py-4">
				<div class="flex items-center justify-between gap-4">
					<!-- Left: back — goes to choice picker when in a connection sub-flow, else previous step -->
					{#if wizardStep > 0 || connectionChoice !== null}
						<button class="btn preset-filled-surface-400-600" onclick={() => {
							if (currentWizardStep?.id === "connection-setup" && connectionChoice !== null) {
								connectionChoice = null
							} else {
								prevWizardStep()
							}
						}}>
							<Icons.ChevronLeft size={16} />
							Back
						</button>
					{:else}
						<div></div>
					{/if}

					<!-- Right: step-specific primary action -->
					{#if currentWizardStep?.id === "welcome"}
						<button class="btn preset-filled-primary-500" onclick={nextWizardStep}>
							Get Started
							<Icons.ChevronRight size={16} />
						</button>

					{:else if currentWizardStep?.id === "connection-setup"}
						{#if hasConnection}
							<button class="btn preset-filled-primary-500" onclick={nextWizardStep}>
								Continue
								<Icons.ChevronRight size={16} />
							</button>
						{:else if connectionChoice === "ollama"}
							{#if ollamaSettingsCtx.settings?.ollamaManagerEnabled}
								<button
									class="btn preset-filled-primary-500"
									onclick={() => { panelsCtx.digest.tutorial = true; openPanel("ollama") }}
								>
									<OllamaIcon class="h-4 w-4" />
									Open Ollama Manager
								</button>
							{:else if selectedOllamaModel}
								<button
									class="btn preset-filled-primary-500"
									onclick={() => {
										socket.emit("connections:create", {
											connection: {
												name: `Ollama - ${selectedOllamaModel}`,
												type: CONNECTION_TYPE.OLLAMA,
												baseUrl: "http://localhost:11434",
												model: selectedOllamaModel
											}
										})
									}}
								>
									<Icons.Plug size={16} />
									Connect
								</button>
							{/if}
						{:else if connectionChoice === "koboldcpp"}
							{#if koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
								<button
									class="btn preset-filled-primary-500"
									onclick={() => { panelsCtx.digest.tutorial = true; openPanel("koboldcpp") }}
								>
									<span class="inline-block h-4 w-4" style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;" aria-hidden="true"></span>
									Open KoboldCPP Manager
								</button>
							{:else if isKoboldCppConnected && selectedKoboldCppModel}
								<button
									class="btn preset-filled-primary-500"
									onclick={connectKoboldCppModel}
								>
									<Icons.Plug size={16} />
									Connect
								</button>
							{/if}
						{:else if connectionChoice === "manual"}
							<button
								class="btn preset-filled-primary-500"
								onclick={() => { panelsCtx.digest.tutorial = true; openPanel("connections") }}
							>
								<Icons.ExternalLink size={16} />
								Open Connections Panel
							</button>
						{/if}

					{:else if currentWizardStep?.id === "summarization"}
						<div class="flex items-center gap-2">
							<button class="btn preset-filled-surface-400-600 btn-sm" onclick={() => { markSetupComplete("summarization"); nextWizardStep() }}>
								Skip for now
							</button>
							<button
								class="btn preset-filled-primary-500"
								onclick={enableSummarization}
								disabled={wizardSummarizationLoading}
							>
								{#if wizardSummarizationLoading}
									<Icons.Loader size={16} class="animate-spin" />
									Enabling…
								{:else}
									<Icons.BookOpen size={16} />
									Enable Summarization
								{/if}
							</button>
						</div>

					{:else if currentWizardStep?.id === "vectorization"}
						<div class="flex items-center gap-2">
							<button class="btn preset-filled-surface-400-600 btn-sm" onclick={() => { markSetupComplete("rag"); nextWizardStep() }}>
								Skip for now
							</button>
							<button
								class="btn preset-filled-primary-500"
								onclick={configureRag}
								disabled={wizardVectorizationLoading || !wizardSelectedModel}
							>
								{#if wizardVectorizationLoading}
									<Icons.Loader size={16} class="animate-spin" />
									Setting up…
								{:else}
									<Icons.Database size={16} />
									Save & Continue
								{/if}
							</button>
						</div>

					{:else if currentWizardStep?.id === "character"}
						<button class="btn preset-filled-surface-400-600 btn-sm" onclick={nextWizardStep}>
							Skip for now
						</button>

					{:else if currentWizardStep?.id === "persona"}
						<button class="btn preset-filled-surface-400-600 btn-sm" onclick={nextWizardStep}>
							Skip for now
						</button>

					{:else if currentWizardStep?.id === "create-chat"}
						<button class="btn preset-filled-surface-400-600 btn-sm" onclick={() => panelsCtx.openPanel({ key: "chats", toggle: false })}>
							<Icons.MessageSquare size={14} />
							Open Chats Panel
						</button>
					{/if}
				</div>
			</footer>
		</div>
	{/if}
</div>

<!-- Modals -->
<CharacterCreator
	bind:open={showCharacterCreator}
	onOpenChange={(e) => {
		showCharacterCreator = e.open
	}}
/>

<PersonaCreator
	bind:open={showPersonaCreator}
	onOpenChange={(e) => {
		showPersonaCreator = e.open
	}}
/>

<CharacterLibraryModal
	bind:open={showCharacterLibrary}
	onOpenChange={(e) => {
		showCharacterLibrary = e.open
	}}
/>

<PersonaLibraryModal
	bind:open={showPersonaLibrary}
	onOpenChange={(e) => {
		showPersonaLibrary = e.open
	}}
/>

{#if bindingLinkerData}
	<BindingLinkerModal
		bind:open={bindingLinkerOpen}
		lorebookId={bindingLinkerData.lorebookId}
		chatId={bindingLinkerData.chatId}
		orphanedBindings={bindingLinkerData.orphanedBindings}
		unboundEntities={bindingLinkerData.unboundEntities}
		onOpenChange={(e) => (bindingLinkerOpen = e.open)}
		onDone={() => (bindingLinkerData = null)}
	/>
{/if}

{#if nodeLinkerData}
	<NodeLinkerModal
		bind:open={nodeLinkerOpen}
		lorebookId={nodeLinkerData.lorebookId}
		pendingBindings={nodeLinkerData.pendingBindings}
		onOpenChange={(e) => (nodeLinkerOpen = e.open)}
		onDone={() => (nodeLinkerData = null)}
	/>
{/if}

<style lang="postcss">
	@reference "tailwindcss";
	ol {
		margin-left: 1em;
	}
</style>
