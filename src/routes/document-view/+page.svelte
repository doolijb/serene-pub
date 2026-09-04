<script lang="ts">
	/**
	 * Document View home — an accessible analogue of the main onboarding
	 * wizard (src/routes/+page.svelte). Rather than a bespoke step-by-step
	 * wizard UI, this shows a simple checklist of the same setup steps (same
	 * gating/admin rules, same completion signals) with links out to the
	 * relevant dedicated Document View page for each — consistent with
	 * "everything gets its own page" rather than duplicating a second wizard
	 * UI. Once every step is complete, shows a plain dashboard instead.
	 */
	import { getContext, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	const userCtx: UserCtx = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let isAdmin = $derived(!!userCtx.user?.isAdmin)
	// A CHAT default being registered, not a connection row existing. Nothing
	// picks a connection because it exists, so a saved-but-unregistered one
	// cannot answer a message — and this checklist's whole job is to say
	// whether the instance is ready to.
	let hasConnection = $derived(
		systemSettingsCtx.capabilityDefaults?.["text->text"]?.connectionId !=
			null
	)

	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let personas: Sockets.Personas.List.Response["personaList"] = $state([])
	let sessions: Sockets.Sessions.List.Response["sessionList"] = $state([])
	let setupData: {
		summarizationStepComplete: boolean
		ragStepComplete: boolean
	} | null = $state(null)
	let loaded = $state(false)

	let hasCharacter = $derived(characters.length > 0)
	let hasPersona = $derived(personas.length > 0)
	let hasSession = $derived(sessions.length > 0)

	interface Step {
		id: string
		label: string
		description: string
		done: boolean
		href?: string
		// Where "Review" should go once the step is done, if different from
		// `href` (which for persona/character/session points at their "new"
		// creation form — reusing that for Review would drop a returning
		// user straight into a blank form instead of showing what they
		// already made).
		doneHref?: string
		skippable?: "summarization" | "rag"
	}
	let steps = $derived.by((): Step[] => {
		const list: Step[] = []
		if (isAdmin) {
			list.push({
				id: "connection",
				label: "Connect to an AI service",
				description:
					"Add a connection (Ollama, KoboldCPP, or an API) and set it as your default.",
				done: hasConnection,
				href: "/document-view/connections"
			})
		}
		list.push({
			id: "persona",
			label: "Create a persona",
			description: "A persona represents you in conversations.",
			done: hasPersona,
			href: "/document-view/personas/new",
			doneHref: "/document-view/personas"
		})
		list.push({
			id: "character",
			label: "Create a character",
			description:
				"Characters are the AI personalities you'll session with.",
			done: hasCharacter,
			href: "/document-view/characters/new",
			doneHref: "/document-view/characters"
		})
		list.push({
			id: "session",
			label: "Start your first session",
			description: "Pick a character and begin a conversation.",
			done: hasSession,
			href: "/document-view/sessions/new",
			doneHref: "/document-view/sessions"
		})
		if (isAdmin) {
			list.push({
				id: "summarization",
				label: "Summarization (optional)",
				description:
					"Generate lore summaries from session history. Can be configured later in System Settings.",
				done: setupData?.summarizationStepComplete ?? false,
				skippable: "summarization"
			})
			list.push({
				id: "rag",
				label: "Retrieval-augmented context / embeddings (optional)",
				description:
					"Powers smarter recall of lore and history. Can be configured later in System Settings.",
				done: setupData?.ragStepComplete ?? false,
				skippable: "rag"
			})
		}
		return list
	})
	let allStepsComplete = $derived(loaded && steps.every((s) => s.done))

	function skipStep(step: "summarization" | "rag") {
		socket.emit("setup:markComplete", { step })
	}

	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characters = msg.characterList || []
	}
	function handlePersonasList(msg: Sockets.Personas.List.Response) {
		personas = msg.personaList || []
	}
	function handleSessionsList(msg: Sockets.Sessions.List.Response) {
		sessions = msg.sessionList || []
		loaded = true
	}
	function handleSetupGet(msg: any) {
		setupData = msg.setup
	}
	function handleSetupMarkComplete(msg: any) {
		if (msg.setup) setupData = msg.setup
	}

	onMount(() => {
		socket.on("characters:list", handleCharactersList)
		socket.on("personas:list", handlePersonasList)
		socket.on("sessions:list", handleSessionsList)
		socket.on("setup:get", handleSetupGet)
		socket.on("setup:markComplete", handleSetupMarkComplete)
		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		socket.emit("sessions:list", {})
		socket.emit("setup:get", {})
		return () => {
			socket.off("characters:list", handleCharactersList)
			socket.off("personas:list", handlePersonasList)
			socket.off("sessions:list", handleSessionsList)
			socket.off("setup:get", handleSetupGet)
			socket.off("setup:markComplete", handleSetupMarkComplete)
		}
	})
</script>

<svelte:head>
	<title>Home — Document View — Serene Pub</title>
</svelte:head>

<h1>Home</h1>

{#if !loaded}
	<p>Loading…</p>
{:else if !allStepsComplete}
	<p>Let's get your account set up. Complete each step below.</p>
	<ul class="a11y-list">
		{#each steps as step (step.id)}
			<li class="a11y-list-item">
				<h2>
					{step.done ? "✓ " : ""}{step.label}
				</h2>
				<p>{step.description}</p>
				<div class="a11y-list-item-actions">
					{#if step.href && !step.done}
						<a href={step.href} class="a11y-btn">
							Go to {step.label}
						</a>
					{:else if step.doneHref || step.href}
						<a
							href={step.doneHref || step.href}
							class="a11y-btn a11y-btn-secondary"
						>
							Review
						</a>
					{/if}
					{#if step.skippable && !step.done}
						<button
							type="button"
							class="a11y-btn a11y-btn-secondary"
							onclick={() => skipStep(step.skippable!)}
						>
							Skip for now
						</button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<p>
		Welcome back{userCtx.user?.displayName
			? `, ${userCtx.user.displayName}`
			: ""}.
	</p>

	<h2>Recent Sessions</h2>
	{#if sessions.length === 0}
		<p>
			No sessions yet. <a href="/document-view/sessions/new">
				Start a new session
			</a>
			.
		</p>
	{:else}
		<ul class="a11y-list">
			{#each sessions.slice(0, 5) as session (session.id)}
				<li class="a11y-list-item">
					<h3>
						<a href="/document-view/sessions/{session.id}">
							{session.name}
						</a>
					</h3>
				</li>
			{/each}
		</ul>
		<p><a href="/document-view/sessions">View all sessions</a></p>
	{/if}

	<h2>Quick Links</h2>
	<ul class="a11y-list">
		<li class="a11y-list-item">
			<a href="/document-view/characters">Characters</a>
		</li>
		<li class="a11y-list-item">
			<a href="/document-view/personas">Personas</a>
		</li>
		<li class="a11y-list-item">
			<a href="/document-view/sessions/new">Start a new session</a>
		</li>
	</ul>
{/if}
