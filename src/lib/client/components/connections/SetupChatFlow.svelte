<script lang="ts">
	/**
	 * **Set up chat** — Runtime → Model → Done, as a stepper dialog.
	 *
	 * Concept ruling, U5 (2026-09-17). The one job that blocks play is chat,
	 * and the first-run card's "KoboldCPP, run by Serene Pub" door and the
	 * status strip's gold **Set up chat** both open this. Before it, the same
	 * intention was four screens: switch a manager on in Settings, create its
	 * connection, find the binary picker, find a model somewhere else, then go
	 * to Admin → Defaults and say which one answers.
	 *
	 * A wizard with no address, so a dialog and never a place (design
	 * 2026-10-09 C.1): it opens over the index and closing it leaves the index
	 * where it was. "Point Serene Pub at it instead" and **Open KoboldCPP**
	 * close it and open that connection; **Start a session** closes it and
	 * opens Sessions.
	 *
	 * ## Nothing here is new
	 *
	 * The Runtime step IS the managed view's binary picker; the Model step IS
	 * the model finder, scoped to chat and to this KoboldCPP; the default is
	 * chosen through the sidebar's one `chooseJobModel` every other surface
	 * uses (C.3). This component owns the title, the step dots and the
	 * decision of which step shows — and that decision is `setupChatFlow.ts`,
	 * pure and tested.
	 *
	 * ## Derived, never stored
	 *
	 * The step is read off the facts every render: whether the managed text
	 * connection exists, whether a mode and binary are recorded, whether a
	 * model is present, whether a chat default is set. Close the sidebar with
	 * a download running and come back: the flow is on the step the pub is
	 * actually at. A runtime installed through the managed view instead counts
	 * exactly the same.
	 *
	 * ## The one side effect
	 *
	 * When the first model lands and no chat default is registered, that pair
	 * becomes the model for Chat replies — once per opening, and only while
	 * nothing is set. A pub that already answers with something is never
	 * re-pointed; the Done step says out loud what happened ("Gemma 3 is now
	 * the model for Chat replies.").
	 *
	 * ⚠ Every side effect waits for `open`: the dialog's root stays mounted
	 * while it is closed, and a flow that installed KoboldCPP because the
	 * sidebar mounted would be a flow nobody opened.
	 *
	 * ⚠ The flow chooses managed mode on entry when none is chosen: the door
	 * that opens it says "installed and run by Serene Pub". "Manage it myself"
	 * is offered as a link to the managed view, which has both choices.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import KoboldCppBinaryVariantPicker from "$lib/client/components/koboldcppManager/KoboldCppBinaryVariantPicker.svelte"
	import ModelFinderView from "./ModelFinderView.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import type { JobPair } from "./jobPicker"
	import {
		SETUP_CHAT_STEPS,
		doneSentence,
		findKcppTextConnection,
		firstModelToRegister,
		setupChatStep,
		type SetupChatFacts
	} from "./setupChatFlow"

	const CHAT = "text->text"

	interface Props {
		/** The stepper is on screen. */
		open: boolean
		connections: readonly {
			/** The wire row's id is optional in type only; a listed row has one. */
			id?: number
			type?: string | null
			name?: string | null
			models: readonly {
				id: number
				name: string
				missingSince?: string | null
				enabled?: boolean
				satisfiableCapabilities?: readonly string[] | null
			}[]
		}[]
		/** Switch the KoboldCPP manager on and create its connection when
		 * none exists (the same `enableManager` the Add menu uses). */
		onEnsureRuntime: () => void
		/** The sidebar's one `chooseJobModel`. */
		onChooseJobModel: (job: string, pair: JobPair) => void
		/**
		 * Close the stepper and open this connection — the managed view, for
		 * the person who wants External mode, and Done's Open KoboldCPP.
		 */
		onOpenConnection: (connectionId: number) => void
		onClose: () => void
		/** Close the stepper and leave for Sessions, when the shell offers it. */
		onOpenSessions?: () => void
	}
	let {
		open,
		connections,
		onEnsureRuntime,
		onChooseJobModel,
		onOpenConnection,
		onClose,
		onOpenSessions
	}: Props = $props()

	const socket = useTypedSocket()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx") ?? { settings: undefined }
	)
	const systemSettingsCtx:
		| {
				capabilityDefaults?: Record<
					string,
					| {
							connectionId: number
							connectionModelId?: number | null
					  }
					| undefined
				>
		  }
		| undefined = getContext("systemSettingsCtx")

	// ── The facts ───────────────────────────────────────────────────────────

	const connection = $derived(
		findKcppTextConnection(
			connections.filter(
				(c): c is typeof c & { id: number } => c.id != null
			)
		)
	)
	const managedMode = $derived(
		(koboldCppSettingsCtx.settings?.koboldCppManagedMode ?? null) as
			| "managed"
			| "external"
			| null
	)
	const facts = $derived<SetupChatFacts>({
		connection,
		managedMode,
		hasBinary:
			!!koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant,
		chatDefault: systemSettingsCtx?.capabilityDefaults?.[CHAT] ?? null
	})
	const step = $derived(setupChatStep(facts))
	const stepIndex = $derived(
		SETUP_CHAT_STEPS.findIndex((s) => s.value === step)
	)

	// ── Entry: the runtime exists and has a mode ────────────────────────────

	/**
	 * Asked ONCE per opening, not per list push: `enableManager` is idempotent
	 * on the flag but a create is not, and the list answers a beat later.
	 */
	let ensured = false
	let modeAsked = false
	let registerAsked = false
	let registeredName = $state<string | null>(null)
	$effect(() => {
		if (open) return
		// Closed: the next opening asks again from the facts it finds.
		ensured = false
		modeAsked = false
		registerAsked = false
		registeredName = null
	})
	$effect(() => {
		if (!open || ensured) return
		ensured = true
		if (!connection) onEnsureRuntime()
	})
	/**
	 * The door said "run by Serene Pub", so managed mode is chosen for the
	 * person — once the connection exists, and only while nothing is chosen.
	 */
	$effect(() => {
		if (!open || modeAsked || !connection || managedMode !== null) return
		modeAsked = true
		socket.emit("koboldcpp:setManagedMode", { mode: "managed" })
	})

	// ── The one side effect: the first model becomes the chat model ─────────

	$effect(() => {
		if (!open || registerAsked) return
		const pair = firstModelToRegister(facts)
		if (!pair) return
		registerAsked = true
		registeredName = pair.model.name
		onChooseJobModel(CHAT, pair)
	})

	const sentence = $derived(doneSentence(facts, registeredName))
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) onClose()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 flex h-[min(90vh,720px)] w-full max-w-2xl flex-col gap-3 p-6 shadow-xl"
			>
				{#if open}
					<header class="flex shrink-0 items-center gap-2">
						<Dialog.Title
							class="min-w-0 flex-1 [font-family:var(--typo-heading--font-family)] text-lg font-semibold"
						>
							Set up chat
						</Dialog.Title>
						<Dialog.CloseTrigger
							class="btn-icon btn-icon-sm hover:preset-tonal shrink-0"
							aria-label="Close"
						>
							<Icons.X size={16} aria-hidden="true" />
						</Dialog.CloseTrigger>
					</header>
					{@render steps()}
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

{#snippet steps()}
	<!-- The three dots. `aria-current` on the live one; the others are
	     labels, not doors — a step is reached by finishing the one before. -->
	<ol
		class="flex shrink-0 items-center gap-2 text-xs"
		aria-label="Setup steps"
	>
		{#each SETUP_CHAT_STEPS as item, i (item.value)}
			{@const state =
				i < stepIndex ? "done" : i === stepIndex ? "current" : "ahead"}
			<li
				class="flex items-center gap-1.5 {state === 'ahead'
					? 'text-surface-600-400'
					: ''}"
				aria-current={state === "current" ? "step" : undefined}
			>
				<span
					class="grid size-5 place-items-center rounded-full text-meta {state ===
					'current'
						? 'preset-tonal-primary ring-primary-500 ring-1'
						: state === 'done'
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
					aria-hidden="true"
				>
					{#if state === "done"}
						<Icons.Check size={12} />
					{:else}
						{i + 1}
					{/if}
				</span>
				<span class:font-medium={state === "current"}>
					{item.label}
				</span>
			</li>
			{#if i < SETUP_CHAT_STEPS.length - 1}
				<li class="bg-surface-300-700 h-px w-4" aria-hidden="true"></li>
			{/if}
		{/each}
	</ol>

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
		{#if step === "runtime"}
			{#if !connection}
				<LoadingState message="Adding KoboldCPP…" showMessage />
			{:else}
				<p class="text-surface-600-400 text-sm">
					KoboldCPP runs models on this machine. Pick the build for
					your hardware and it downloads and starts on its own.
				</p>
				<KoboldCppBinaryVariantPicker onDownloadStarted={() => {}} />
				<p class="text-surface-600-400 text-xs">
					Already running KoboldCPP yourself?
					<button
						type="button"
						class="anchor"
						onclick={() => onOpenConnection(connection.id)}
					>
						Point Serene Pub at it instead
					</button>
				</p>
			{/if}
		{:else if step === "model" && connection}
			<p class="text-surface-600-400 shrink-0 text-sm">
				KoboldCPP is installed. Now get one model that can chat — the
				first to land fills the Reply loadout.
			</p>
			<div class="flex min-h-0 flex-1 flex-col">
				<ModelFinderView
					embedded
					capability={CHAT}
					connectionId={connection.id}
				/>
			</div>
		{:else if step === "done" && connection}
			<section
				class="panel-card flex flex-col items-center gap-3 py-6 text-center"
			>
				<span
					class="preset-tonal-primary grid size-12 place-items-center rounded-full"
					aria-hidden="true"
				>
					<Icons.Check size={22} />
				</span>
				<h3
					class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					Chat is set up
				</h3>
				<p class="text-surface-600-400 text-sm" role="status">
					{sentence}
				</p>
				<div class="flex flex-wrap justify-center gap-2 pt-1">
					{#if onOpenSessions}
						<button
							type="button"
							class="btn preset-filled-primary-500"
							onclick={onOpenSessions}
						>
							<Icons.MessageSquare size={16} aria-hidden="true" />
							Start a session
						</button>
					{/if}
					<button
						type="button"
						class="btn preset-tonal"
						onclick={() => onOpenConnection(connection.id)}
					>
						Open KoboldCPP
					</button>
				</div>
			</section>
			<p class="text-surface-600-400 px-0.5 text-xs">
				The Images, Embeddings and Entities loadouts can be filled later
				in the Loadouts view.
			</p>
		{/if}
	</div>
{/snippet}
