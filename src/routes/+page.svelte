<script lang="ts">
	import Avatar from "$lib/client/components/Avatar.svelte"
	import SidebarListItem from "$lib/client/components/SidebarListItem.svelte"
	import CharacterCreator from "$lib/client/components/modals/CharacterCreatorModal.svelte"
	import PersonaCreator from "$lib/client/components/modals/PersonaCreatorModal.svelte"
	import OllamaIcon from "$lib/client/components/icons/OllamaIcon.svelte"
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, onDestroy } from "svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

	let userCtx: UserCtx = $state(getContext("userCtx"))
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let userSettingsCtx: UserSettingsCtx = $state(getContext("userSettingsCtx"))
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	const socket = useTypedSocket()

	// Data for lists
	let characters: Partial<SelectCharacter>[] = $state([])
	let personas: Partial<SelectPersona>[] = $state([])
	let chats: Partial<SelectChat>[] = $state([])
	let connections: Sockets.Connections.List.Response["connectionsList"] =
		$state([])

	// Wizard state
	let showWizard = $state(false)
	let wizardStep = $state(0)
	let showCharacterCreator = $state(false)
	let showPersonaCreator = $state(false)

	// Connection choice state
	let connectionChoice: "quick" | "manual" | null = $state(null)
	let selectedOllamaModel = $state("")

	// Ollama manager state
	let installedModels: any[] = $state([])
	let isOllamaConnected = $state(false)

	// Track setup progress
	let hasConnection = $derived(!!userCtx.user?.activeConnection)
	let hasCharacter = $derived(characters.length > 0)
	let hasPersona = $derived(personas.length > 0)
	let hasChat = $derived(chats.length > 0)

	// Simple setup check - only requires connection + character + persona
	let isBasicSetup = $derived(hasConnection && hasCharacter && hasPersona)

	// Define wizard step types
	type WizardStepType =
		| "connection-choice"
		| "connection-setup"
		| "character"
		| "persona"
		| "chat"

	interface WizardStepDefinition {
		id: WizardStepType
		requiresAdmin?: boolean
		isComplete: () => boolean
	}

	// Build dynamic wizard steps based on user role
	let wizardSteps = $derived.by((): WizardStepDefinition[] => {
		const steps: WizardStepDefinition[] = []

		// Add admin-only steps first if user is admin
		if (userCtx.user?.isAdmin) {
			steps.push({
				id: "connection-choice",
				requiresAdmin: true,
				isComplete: () => false // Always show choice first
			})
			steps.push({
				id: "connection-setup",
				requiresAdmin: true,
				isComplete: () => hasConnection
			})
		}

		// Add common steps for all users
		steps.push({
			id: "character",
			isComplete: () => hasCharacter
		})
		steps.push({
			id: "persona",
			isComplete: () => hasPersona
		})
		steps.push({
			id: "chat",
			isComplete: () => true // Final step
		})

		return steps
	})

	// Current wizard step data
	let currentWizardStep = $derived(wizardSteps[wizardStep])

	// Total number of steps (dynamic)
	let totalWizardSteps = $derived(wizardSteps.length)

	// Determine current step based on what's completed
	let currentStep = $derived.by(() => {
		const firstIncompleteIndex = wizardSteps.findIndex(
			(step) => !step.isComplete()
		)
		return firstIncompleteIndex >= 0
			? firstIncompleteIndex
			: wizardSteps.length - 1
	})

	// Check if current wizard step is complete
	let isCurrentStepComplete = $derived(
		currentWizardStep?.isComplete() ?? false
	)

	// Full setup check (legacy)
	let isSetup = $derived.by(() => {
		return (
			userCtx.user?.activeSamplingConfig &&
			userCtx.user?.activeContextConfig &&
			userCtx.user?.activePromptConfig &&
			userCtx.user?.activeConnection &&
			characters.length > 0 &&
			personas.length > 0 &&
			chats.length > 0
		)
	})

	// Navigation functions
	function openPanel(key: string) {
		panelsCtx.openPanel({ key })
	}

	// Wizard functions
	function startWizard() {
		showWizard = true
		// Skip to the current incomplete step
		wizardStep = currentStep === wizardSteps.length - 1 ? 0 : currentStep
	}

	function nextWizardStep() {
		wizardStep++
	}

	function prevWizardStep() {
		if (wizardStep > 0) wizardStep--
	}

	function closeWizard() {
		showWizard = false
		wizardStep = 0
		connectionChoice = null
	}

	// Quick setup functions
	function handleQuickSetup() {
		if (!socket) return

		// Auto-set the default configs if not already set
		if (!userCtx.user?.activeSamplingConfig) {
			socket.emit("samplingConfigs:setUserActive", { id: 1 }) // Default
		}
		if (!userCtx.user?.activeContextConfig) {
			socket.emit("contextConfigs:setUserActive", { id: 1 }) // Default
		}
		if (!userCtx.user?.activePromptConfig) {
			socket.emit("promptConfigs:setUserActive", { id: 1 }) // Roleplay - Simple
		}

		// Start the wizard
		showWizard = true

		// If basic setup is complete, go directly to chat creation step
		if (isBasicSetup) {
			wizardStep = wizardSteps.findIndex((s) => s.id === "chat")
		} else {
			wizardStep =
				currentStep === wizardSteps.length - 1 ? 0 : currentStep
		}
	}

	function openAssistantChat() {
		// Navigate to assistant page - shows chat list or creates new chat
		goto("/assistant")
	}

	function connectToOllamaModel(modelName: string) {
		socket.emit("ollama:connectModel", { modelName: modelName })
	}

	function checkOllamaConnection() {
		socket.emit("ollama:version", {})
	}

	function refreshOllamaModels() {
		socket.emit("ollama:modelsList", {})
	}

	function createSamplePersona() {
		if (!socket) return

		const samplePersona = {
			name: "You",
			description:
				"This represents you in conversations. You can edit this later to add more details about yourself or create different personas for different types of chats.",
			isDefault: true
		}

		socket.emit("personas:create", { persona: samplePersona })
	}

	function finishQuickSetup() {
		toaster.success({
			title: "Welcome to Serene Pub!",
			description:
				"You're all set up and ready to start chatting with your characters."
		})
		closeWizard()
	}

	function toggleBanner() {
		const res: Sockets.UserSettings.UpdateShowHomePageBanner.Params = {
			enabled: false
		}
		socket.emit("userSettings:updateShowHomePageBanner", res)
	}

	// Listen for socket events
	onMount(() => {
		socket.on("characters:list", (msg) => {
			characters = msg.characterList || []
			// If we're in the wizard and just got characters, advance if needed
			if (
				showWizard &&
				currentWizardStep?.id === "character" &&
				characters.length > 0
			) {
				nextWizardStep()
			}
		})
		socket.on("personas:list", (msg) => {
			personas = msg.personaList || []
			// If we're in the wizard and just got personas, advance if needed
			if (
				showWizard &&
				currentWizardStep?.id === "persona" &&
				personas.length > 0
			) {
				nextWizardStep()
			}
		})
		socket.on("chats:list", (msg) => {
			chats = msg.chatList || []
		})
		socket.on("connections:list", (msg) => {
			connections = msg.connectionsList || []
		})

		// Handle Ollama manager events
		socket.on("ollama:version", (message) => {
			isOllamaConnected = !!message.version
			if (isOllamaConnected && showWizard) {
				refreshOllamaModels()
			}
		})

		socket.on("ollama:modelsList", (message) => {
			installedModels = message.models || []
		})

		socket.on("ollama:connectModel", (message) => {
			if (message.success) {
				nextWizardStep()
			} else {
				toaster.error({
					title: "Connection Failed",
					description: "Failed to connect to the Ollama model"
				})
			}
		})

		// Handle successful connection creation (fallback for manual setup)
		socket.on("connections:create", (res) => {
			if (res.connection) {
				// Auto-set as active connection
				socket.emit("connections:setUserActive", {
					id: res.connection.id
				})
				toaster.success({
					title: "Connection Created",
					description: `Successfully connected to ${res.connection.name}`
				})
				nextWizardStep()
			}
		})

		// Handle successful character creation
		socket.on("characters:create", (res) => {
			if (res.character) {
				// Server automatically emits updated list
				if (showWizard) {
					nextWizardStep()
				}
			}
		})

		// Handle successful persona creation
		socket.on("personas:create", (res) => {
			if (res.persona) {
				// Server automatically emits updated list
				if (showWizard) {
					nextWizardStep()
				}
			}
		})

		// Handle successful chat creation
		socket.on("chats:create", (res) => {
			if (res.chat) {
				// Close wizard if it's open
				if (showWizard) {
					closeWizard()
				}
				// Open the chat panel and navigate to the new chat
				panelsCtx.openPanel({ key: "chats", toggle: false })
			}
		})

		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		socket.emit("chats:list", {})
		if (userCtx.user?.isAdmin) {
			socket.emit("connections:list", {})
		}
	})

	onDestroy(() => {
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
	})
</script>

<svelte:head>
	<title>Serene Pub - Get Started</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

<div
	class="flex flex-1 flex-col items-center justify-center gap-4 px-2 md:px-0"
>
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

	<!-- Alpha disclaimer card below the logo -->
	<div
		class="preset-filled-warning-100-900 mx-auto w-full rounded-lg p-2 text-center text-sm"
	>
		<strong>Serene Pub is in alpha!</strong>
		Expect bugs and rapid changes. This project is under heavy development.
	</div>

	<!-- New User Welcome / Setup Wizard - Show if not fully setup OR wizard is running -->
	{#if !isSetup || showWizard}
		<div
			class="preset-filled-surface-200-800 mx-auto w-full rounded-xl p-8 text-center"
		>
			{#if !showWizard}
				<!-- Welcome Screen -->
				<div class="mb-6">
					<Icons.Sparkles
						size={48}
						class="text-primary-500 mx-auto mb-4"
					/>
					{#if isBasicSetup}
						<!-- Basic setup complete, need chat -->
						<h1 class="text-foreground mb-2 text-3xl font-bold">
							Ready to Start Chatting!
						</h1>
						<p class="text-muted-foreground text-lg">
							You have everything set up. Let's create your first
							chat to get started.
						</p>
					{:else}
						<!-- Initial setup needed -->
						<h1 class="text-foreground mb-2 text-3xl font-bold">
							Welcome to Serene Pub!
						</h1>
						<p class="text-muted-foreground text-lg">
							{#if userCtx.user?.isAdmin}
								We'll guide you through connecting to an AI
								service and creating your first character
							{:else}
								We'll guide you through creating your first
								character and persona to start chatting
							{/if}
						</p>
					{/if}
				</div>

				<!-- Quick Start -->
				<div class="mb-6">
					<button
						class="btn preset-filled-primary-500 btn-lg mb-4 px-8 py-4 text-lg"
						onclick={handleQuickSetup}
					>
						<Icons.Zap size={20} />
						{#if isBasicSetup}
							Create First Chat
						{:else}
							Quick Start ({totalWizardSteps} steps)
						{/if}
					</button>
				</div>
				<!-- Advanced Option -->
				<details class="mt-6">
					<summary
						class="cursor-pointer text-sm opacity-60 hover:opacity-100"
					>
						Advanced Setup (Manual Configuration)
					</summary>
					<div class="mt-4 space-y-3">
						{#if userCtx.user?.isAdmin}
							<button
								class="btn preset-tonal-surface btn-sm"
								onclick={() => {
									panelsCtx.digest.tutorial = true
									openPanel("connections")
								}}
							>
								<Icons.Cable size={16} /> Manage Connections
							</button>
						{/if}
						<button
							class="btn preset-tonal-surface btn-sm"
							onclick={() => {
								panelsCtx.digest.tutorial = true
								openPanel("characters")
							}}
						>
							<Icons.Users size={16} /> Manage Characters
						</button>
						<button
							class="btn preset-tonal-surface btn-sm"
							onclick={() => {
								panelsCtx.digest.tutorial = true
								openPanel("personas")
							}}
						>
							<Icons.User size={16} /> Manage Personas
						</button>
						<button
							class="btn preset-tonal-surface btn-sm"
							onclick={() => {
								panelsCtx.digest.tutorial = true
								openPanel("chats")
							}}
						>
							<Icons.MessageSquare size={16} /> Manage Chats
						</button>
					</div>
				</details>
			{:else}
				<!-- Setup Wizard -->
				<div class="mb-6">
					<h2 class="text-foreground mb-2 text-3xl font-bold">
						Quick Setup
					</h2>
					<div class="mb-4 flex gap-2">
						{#each wizardSteps as _, i}
							<div
								class="h-2 flex-1 rounded-full {i <= wizardStep
									? 'bg-primary-500'
									: 'bg-surface-400'}"
							></div>
						{/each}
					</div>
					<p class="text-muted-foreground text-lg">
						Step {wizardStep + 1} of {totalWizardSteps}
					</p>
				</div>

				<!-- Step Content -->
				<div class="mb-6 min-h-[300px]">
					{#if currentWizardStep?.id === "connection-choice"}
						<!-- Step 1: Choose AI Connection Method -->
						<Icons.Brain
							size={48}
							class="text-primary-500 mx-auto mb-4"
						/>
						<h3 class="mb-4 text-center text-xl font-bold">
							Connect to an AI Service
						</h3>
						<p class="mb-6 text-center text-sm opacity-75">
							Choose how you'd like to connect to an AI model for
							conversations
						</p>

						<div class="space-y-3">
							{#if systemSettingsCtx.settings?.ollamaManagerEnabled}
								<button
									class="btn preset-filled-primary-500 h-auto w-full flex-col gap-2 p-4"
									onclick={() => {
										connectionChoice = "quick"
										checkOllamaConnection()
										nextWizardStep()
									}}
								>
									<div class="flex items-center gap-2">
										<Icons.Zap size={20} />
										<strong>
											Quick Setup with Ollama Manager
										</strong>
									</div>
									<p class="text-sm opacity-90">
										Use the built-in Ollama manager to
										download and connect models
									</p>
								</button>
							{:else}
								<button
									class="btn preset-filled-primary-500 h-auto w-full flex-col gap-2 p-4"
									onclick={() => {
										connectionChoice = "quick"
										nextWizardStep()
									}}
								>
									<div class="flex items-center gap-2">
										<Icons.Zap size={20} />
										<strong>Quick Setup with Ollama</strong>
									</div>
									<p class="text-sm opacity-90">
										Download and use local AI models
										(Recommended for beginners)
									</p>
								</button>
							{/if}

							<button
								class="btn preset-tonal-surface h-auto w-full flex-col gap-2 p-4"
								onclick={() => {
									connectionChoice = "manual"
									panelsCtx.digest.tutorial = true
									openPanel("connections")
								}}
							>
								<div class="flex items-center gap-2">
									<Icons.Settings size={20} />
									<strong>Manual Setup</strong>
								</div>
								<p class="text-sm opacity-75">
									Configure OpenAI, LM Studio, or other
									services yourself
								</p>
							</button>
						</div>
					{:else if currentWizardStep?.id === "connection-setup"}
						<!-- Step 2: Ollama Setup -->
						{#if hasConnection}
							<!-- Connection Complete -->
							<Icons.CheckCircle
								size={48}
								class="text-success-500 mx-auto mb-4"
							/>
							<h3 class="mb-4 text-center text-xl font-bold">
								✅ AI Connection Complete!
							</h3>
							<p class="mb-6 text-center text-sm opacity-75">
								You're successfully connected to {userCtx.user
									?.activeConnection?.name}
							</p>

							<div class="text-center">
								<button
									class="btn preset-filled-primary-500 btn-lg"
									onclick={nextWizardStep}
								>
									<Icons.ArrowRight size={20} />
									Continue to Character Creation
								</button>
							</div>
						{:else if systemSettingsCtx.settings?.ollamaManagerEnabled}
							<!-- Ollama Manager Flow -->
							<OllamaIcon
								class="text-primary-500 mx-auto mb-4 h-12 w-12"
							/>
							<h3 class="mb-4 text-center text-xl font-bold">
								Use Ollama Manager
							</h3>
							<p class="mb-6 text-center text-sm opacity-75">
								Open the Ollama Manager to download models and
								connect to them
							</p>

							<div class="text-center">
								<button
									class="btn preset-filled-primary-500 btn-lg"
									onclick={() => {
										panelsCtx.digest.tutorial = true
										openPanel("ollama")
									}}
								>
									<OllamaIcon class="h-5 w-5" />
									Open Ollama Manager
								</button>

								<p class="mt-4 text-xs opacity-60">
									Come back to this wizard after connecting a
									model
								</p>
							</div>
						{:else}
							<!-- Manual Ollama Setup Flow -->
							<Icons.Download
								size={48}
								class="text-primary-500 mx-auto mb-4"
							/>
							<h3 class="mb-4 text-center text-xl font-bold">
								Set up Ollama
							</h3>
							<div class="space-y-4">
								<div class="bg-surface-500/20 rounded-lg p-4">
									<h4 class="mb-2 font-semibold">
										Quick Instructions:
									</h4>
									<ol
										class="list-inside list-decimal space-y-1 text-sm"
									>
										<li>
											Download Ollama from <a
												href="https://ollama.com"
												target="_blank"
												class="text-primary-500 hover:underline"
											>
												ollama.com
											</a>
										</li>
										<li>Install and run it</li>
										<li>Open terminal/command prompt</li>
										<li>
											Run: <code
												class="bg-surface-600 rounded px-2 py-1 text-xs"
											>
												ollama pull llama3.2
											</code>
										</li>
									</ol>
								</div>

								<div class="space-y-3">
									<label
										class="block text-sm font-semibold"
										for="ollama-model-select"
									>
										Choose a model:
									</label>
									<select
										id="ollama-model-select"
										class="select w-full"
										bind:value={selectedOllamaModel}
									>
										<option value="">
											Select a model...
										</option>
										<option value="llama3.2">
											Llama 3.2 (Recommended)
										</option>
										<option value="llama3.2:1b">
											Llama 3.2 1B (Faster, smaller)
										</option>
										<option value="qwen2.5">
											Qwen 2.5 (Alternative)
										</option>
										<option value="mistral">
											Mistral 7B
										</option>
									</select>
								</div>
							</div>
						{/if}
					{:else if currentWizardStep?.id === "character"}
						<!-- Step 3: Create Character -->
						{#if hasCharacter}
							<!-- Character Complete -->
							<Icons.CheckCircle
								size={48}
								class="text-success-500 mx-auto mb-4"
							/>
							<h3 class="mb-4 text-center text-xl font-bold">
								✅ Character Created!
							</h3>
							<p class="mb-6 text-center text-sm opacity-75">
								You have {characters.length} character{characters.length ===
								1
									? ""
									: "s"} ready to chat with
							</p>

							<div class="text-center">
								<button
									class="btn preset-filled-primary-500 btn-lg"
									onclick={nextWizardStep}
								>
									<Icons.ArrowRight size={20} />
									Continue to Persona Creation
								</button>
							</div>
						{:else}
							<Icons.Users
								size={48}
								class="text-primary-500 mx-auto mb-4"
							/>
							<h3 class="mb-4 text-center text-xl font-bold">
								Create The First Character to Chat With
							</h3>

							<div class="text-center">
								<button
									class="btn preset-filled-primary-500 btn-lg"
									onclick={() => {
										panelsCtx.digest.tutorial = true
										openPanel("characters")
									}}
								>
									<Icons.UserPlus size={20} />
									Open Characters Panel
								</button>
							</div>
						{/if}
					{:else if currentWizardStep?.id === "persona"}
						<!-- Step 4: Create Persona -->
						{#if hasPersona}
							<!-- Persona Complete -->
							<Icons.CheckCircle
								size={48}
								class="text-success-500 mx-auto mb-4"
							/>
							<h3 class="mb-4 text-center text-xl font-bold">
								✅ Persona Created!
							</h3>
							<p class="mb-6 text-center text-sm opacity-75">
								You have {personas.length} persona{personas.length ===
								1
									? ""
									: "s"} ready for conversations
							</p>

							<div class="text-center">
								<button
									class="btn preset-filled-primary-500 btn-lg"
									onclick={nextWizardStep}
								>
									<Icons.ArrowRight size={20} />
									Start Your First Chat
								</button>
							</div>
						{:else}
							<Icons.User
								size={48}
								class="text-primary-500 mx-auto mb-4"
							/>
							<h3 class="mb-4 text-center text-xl font-bold">
								Create Your Persona
							</h3>
							<p class="mb-6 text-center text-sm opacity-75">
								Your persona represents you in conversations
							</p>

							<div class="text-center">
								<button
									class="btn preset-filled-primary-500 btn-lg"
									onclick={() => {
										panelsCtx.digest.tutorial = true
										openPanel("personas")
									}}
								>
									<Icons.UserPlus size={20} />
									Open Personas Panel
								</button>
							</div>
						{/if}
					{:else if currentWizardStep?.id === "chat"}
						<!-- Step 5: Open Chat Interface -->
						<Icons.MessageCircle
							size={48}
							class="text-primary-500 mx-auto mb-4"
						/>
						<h3 class="mb-4 text-center text-xl font-bold">
							Ready to Chat!
						</h3>
						<p class="mb-6 text-center text-sm opacity-75">
							You're all set up! Let's open the chat interface
							where you can create your first conversation.
						</p>

						<div class="text-center">
							<button
								class="btn preset-filled-success-500 btn-lg"
								onclick={() => {
									panelsCtx.digest.tutorial = true
									openPanel("chats")
								}}
							>
								<Icons.MessageCircle size={20} />
								Open Chat Interface
							</button>
						</div>
					{/if}
				</div>

				<!-- Navigation -->
				<div class="flex justify-between">
					<button
						class="btn preset-tonal-surface"
						onclick={wizardStep === 0
							? closeWizard
							: prevWizardStep}
					>
						{wizardStep === 0 ? "Cancel" : "Previous"}
					</button>

					{#if currentWizardStep?.id === "connection-setup" && !systemSettingsCtx.settings?.ollamaManagerEnabled && !hasConnection}
						<button
							class="btn preset-filled-primary-500"
							onclick={() => {
								if (selectedOllamaModel && socket) {
									// Manual connection creation
									const newConnection = {
										name: `Ollama - ${selectedOllamaModel}`,
										type: CONNECTION_TYPE.OLLAMA,
										baseUrl: "http://localhost:11434",
										model: selectedOllamaModel,
										isEnabled: true
									}
									socket.emit("connections:create", {
										connection: newConnection
									})
								}
							}}
							disabled={!selectedOllamaModel}
						>
							Connect
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Character Creator Modal -->
	<CharacterCreator
		bind:open={showCharacterCreator}
		onOpenChange={(e) => {
			showCharacterCreator = e.open
			if (!e.open && hasCharacter && showWizard) {
				nextWizardStep()
			}
		}}
	/>

	<!-- Persona Creator Modal -->
	<PersonaCreator
		bind:open={showPersonaCreator}
		onOpenChange={(e) => {
			showPersonaCreator = e.open
			if (!e.open && hasPersona && showWizard) {
				nextWizardStep()
			}
		}}
	/>

	{#if isSetup}
		<div
			class="preset-filled-surface-200-800 mx-auto w-full rounded-xl p-6"
		>
			<h1 class="text-foreground mb-2 text-center text-3xl font-bold">
				You're All Set!
			</h1>
			<p class="text-muted-foreground mb-6 text-center">
				You can now start chatting with your characters.
			</p>
			<div class="flex flex-col items-center gap-3">
				<button
					class="btn preset-filled-primary-500"
					onclick={() =>
						panelsCtx.openPanel({ key: "chats", toggle: false })}
					disabled={panelsCtx.rightPanel == "chats"}
				>
					Start Chatting
				</button>
				<!-- Hidden for now -->
				<!-- <button
				class="btn preset-tonal-primary-500"
				onclick={openAssistantChat}
			>
				<Icons.MessageCircleQuestion size={20} />
				Ask the Assistant
			</button> -->
			</div>
		</div>

		<div class="w-full">
			<h3 class="w-full text-xl">Characters</h3>
			<div class="grid grid-cols-1 justify-between gap-2 lg:grid-cols-2">
				<!-- <div class="card preset-filled-surface-200-800 p-2">
					tEST
				</div> -->
				{#each characters as character (character.id)}
					<SidebarListItem
						onclick={() => {
							panelsCtx.digest.chatCharacterId = character.id
							panelsCtx.openPanel({
								key: "chats",
								toggle: false
							})
						}}
						contentTitle="Go to character chats"
						classes="!preset-filled-surface-200-800 transition-colors hover:!preset-filled-surface-300-700"
					>
						{#snippet content()}
							<div class="flex gap-2">
								<div
									class="h-[4em] min-h-[4em] w-[4em] min-w-[4em]"
								>
									<Avatar char={character} />
								</div>
								<div class="gap2 flex flex-col">
									<div
										class="text-foreground text-left font-semibold"
									>
										{character.nickname ||
											character.name ||
											"Unknown"}
									</div>
									<div
										class="text-muted-foreground line-clamp-2 text-sm"
									>
										{character.description ||
											"No description"}
									</div>
								</div>
							</div>
						{/snippet}
					</SidebarListItem>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "tailwindcss";
	ol {
		margin-left: 1em;
	}
</style>
