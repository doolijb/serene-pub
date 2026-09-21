<script lang="ts">
	/**
	 * A runtime this pub RUNS, as its connection's own view.
	 *
	 * The Ollama Manager and the KoboldCPP Manager used to be rail items and
	 * panels of their own, reached by an "Open … manager" door on a connection
	 * and gated by a switch in Settings → System that had to be found FIRST or
	 * the door opened onto a disabled screen. The 2026-09-17 concept ruling
	 * (R2) folds each of them into the connection it is about: tapping the
	 * KoboldCPP row in the index opens THIS, and this IS the manager.
	 *
	 * ## What is here, and what is borrowed
	 *
	 * The status card, the tab strip and the setup routing are this file's.
	 * Everything inside a tab is the manager's existing component, unchanged —
	 * `KoboldCppModelsTab`, `KoboldCppSettingsTab`, `OllamaInstalledTab` and
	 * the rest. The fold is a change of address, not a rewrite: a person who
	 * knew where the Text/Image toggle was still finds it where it was.
	 *
	 * The connection's OWN settings — name, form, notes, capabilities, stop
	 * scripts, Save/Reset — arrive as the `connectionSettings` snippet rather
	 * than as a dozen props. They are bound to the sidebar's draft, and a
	 * binding does not travel; the snippet does.
	 *
	 * ## Tabs, and the two that are not here
	 *
	 * Models · Get models · Downloads · Settings. "Get models" is a door to
	 * the one model finder (ruling R3) — the managers' old Available tabs are
	 * retired — and Downloads is the manager's own list until the one
	 * downloads view (R4) can be filtered by destination.
	 */
	import { getContext, onMount } from "svelte"
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { capabilityLabel } from "@serene-pub/sdk"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import PanelTabStrip from "$lib/client/components/panels/PanelTabStrip.svelte"
	import KoboldCppModelsTab from "$lib/client/components/koboldcppManager/KoboldCppModelsTab.svelte"
	import KoboldCppPerfTab from "$lib/client/components/koboldcppManager/KoboldCppPerfTab.svelte"
	import KoboldCppSettingsTab from "$lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte"
	import KoboldCppSetupScreen from "$lib/client/components/koboldcppManager/KoboldCppSetupScreen.svelte"
	import KoboldCppBinaryVariantPicker from "$lib/client/components/koboldcppManager/KoboldCppBinaryVariantPicker.svelte"
	import OllamaInstalledTab from "$lib/client/components/ollamaManager/OllamaInstalledTab.svelte"
	import OllamaSettingsTab from "$lib/client/components/ollamaManager/OllamaSettingsTab.svelte"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import { downloads } from "./downloads.svelte"
	import {
		capabilitiesServedBy,
		contextLabel,
		downloadSourcesFor,
		kcppExternalLine,
		kcppLoadedLine,
		kcppPerfLine,
		kcppProcessLine,
		managedLabel,
		managedStage,
		managedTabs,
		ollamaStatusLine,
		ollamaUnreachableSentence,
		removeConfirmation,
		type ManagedKind,
		type StatusDot
	} from "./managedConnectionView"

	interface Props {
		kind: ManagedKind
		/** The connection this view IS. */
		connectionId: number
		/** What somebody called it. Never shown without the service chip (R5). */
		title: string
		isAdmin: boolean
		/** Every transform's registered pair, for the Remove dialog's cost. */
		capabilityDefaults: Record<
			string,
			{ connectionId?: number | null } | undefined
		>
		/** This runtime's rows — KoboldCPP has two, text and image. */
		managedConnectionIds: readonly number[]
		onBack: () => void
		/** Open the model finder scoped to this connection (ruling R3). */
		onGetModels: (connectionId: number) => void
		/** The one downloads view across every destination (R4). */
		onOpenDownloads: () => void
		/** Ask the host for its models again. */
		onRefreshModels: () => void
		/** Switch the manager off and delete its rows. Confirmed here first. */
		onRemove: () => void
		/** Open another connection — the KoboldCPP image row, from the Image list. */
		onOpenConnection: (connectionId: number) => void
		/** The connection's own form, notes, capabilities and stop scripts. */
		connectionSettings?: Snippet
	}
	let {
		kind,
		connectionId,
		title,
		isAdmin,
		capabilityDefaults,
		managedConnectionIds,
		onBack,
		onGetModels,
		onOpenDownloads,
		onRefreshModels,
		onRemove,
		onOpenConnection,
		connectionSettings
	}: Props = $props()

	const socket = useTypedSocket()
	// Both contexts are provided by `Layout` unconditionally, not behind the
	// manager flags — which is what lets this view exist for a connection whose
	// manager has never been switched on.
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx") ?? { settings: undefined }
	)
	const ollamaSettingsCtx: OllamaSettingsCtx = $state(
		getContext("ollamaSettingsCtx") ?? { settings: undefined }
	)
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")

	const label = $derived(managedLabel(kind))
	const isKcpp = $derived(kind === "koboldcpp")

	// ── KoboldCPP: which screen, and what the process is doing ──────────────
	const managedMode = $derived(
		(koboldCppSettingsCtx.settings?.koboldCppManagedMode ?? null) as
			| "managed"
			| "external"
			| null
	)
	const isManaged = $derived(managedMode === "managed")
	const hasBinary = $derived(
		!!koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant
	)
	/** The picker was asked for by hand: Change binary, or a re-download. */
	let pickerRequested = $state(false)
	/**
	 * External mode has answered at least once this visit.
	 *
	 * Latched, and deliberately: it decides whether the view is on the
	 * URL-and-Test screen or on the tabs, and a momentary failure must not
	 * throw somebody out of the Settings tab they were typing in. The LATEST
	 * result is `externalReachable`, which is what the status card reads.
	 */
	let externalConnected = $state(false)
	let externalReachable = $state<boolean | null>(null)
	let kcppVersion = $state<string | null>(null)
	let isTesting = $state(false)

	let subStatus = $state<Sockets.KoboldCPP.SubprocessStatus.Response | null>(
		null
	)
	let resident = $state<
		Sockets.KoboldCPP.GetLoadedConfig.Response["config"] | null
	>(null)
	let perf = $state<Sockets.KoboldCPP.Perf.Response | null>(null)
	let starting = $state(false)
	let stopping = $state(false)
	let unloading = $state(false)
	let binaryUpdateAvailable = $state(false)

	// ── Ollama: is it up, and what is it holding ────────────────────────────
	let ollamaReachable = $state<boolean | null>(null)
	let ollamaVersion = $state<string | null>(null)
	let ollamaModelCount = $state<number | null>(null)
	let ollamaRunningCount = $state<number | null>(null)
	let ollamaUpdateAvailable = $state(false)

	// ── The address field, revealed by "Change address" ─────────────────────
	const savedAddress = $derived(
		isKcpp
			? (koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ?? "")
			: (ollamaSettingsCtx.settings?.ollamaManagerBaseUrl ?? "")
	)
	let showAddress = $state(false)
	let savingAddress = $state(false)
	/**
	 * Seeded at init AND re-synced by the effect below.
	 *
	 * The effect alone was the manager sidebars' pattern, and it leaves the
	 * field empty for the first render — which on the server is the only
	 * render there is, so the address screen shipped a blank box. Seeding here
	 * costs one read; the effect still carries a later settings push into the
	 * field, which is what makes a successful save resolve the dirty state.
	 */
	// svelte-ignore state_referenced_locally
	let addressField = $state(savedAddress)
	$effect(() => {
		addressField = savedAddress
	})

	const stage = $derived(
		managedStage(kind, {
			managedMode,
			hasBinary,
			pickerRequested,
			connected: externalConnected
		})
	)
	const tabs = $derived(managedTabs(stage))
	let tab = $state("models")

	// ── The status card's three lines ───────────────────────────────────────
	// The uptime is a clock, not a fact that arrives with a push: derived from
	// `startedAt` alone it froze at whatever it read when the last status
	// landed ("6s" for as long as the card stayed open). Ticked once a second
	// only while there is something running to count.
	let now = $state(Date.now())
	$effect(() => {
		const run = subStatus?.status
		if (run !== "running" && run !== "stopping") return
		const timer = setInterval(() => (now = Date.now()), 1000)
		return () => clearInterval(timer)
	})
	const processLine = $derived(
		kcppProcessLine(
			{
				status: subStatus?.status ?? null,
				pid: subStatus?.pid,
				startedAt: subStatus?.startedAt
			},
			now
		)
	)
	const loadedLine = $derived(kcppLoadedLine(resident?.resident))
	const perfLine = $derived(kcppPerfLine(perf))
	const externalLine = $derived(
		kcppExternalLine({
			connected: externalReachable === true,
			version: kcppVersion
		})
	)
	const ollamaLine = $derived(
		ollamaStatusLine({
			reachable: ollamaReachable,
			version: ollamaVersion,
			modelCount: ollamaModelCount,
			runningCount: ollamaRunningCount
		})
	)
	/** The one clause that is a fault rather than a state. */
	const processError = $derived(
		subStatus?.status === "crashed" ? (subStatus.lastError ?? null) : null
	)

	const DOT: Record<StatusDot, string> = {
		ok: "bg-success-500",
		pending: "bg-warning-500 animate-pulse",
		warning: "bg-warning-500",
		error: "bg-error-500",
		quiet: "bg-surface-400-600"
	}

	/** Files arriving for THIS runtime, for the Downloads tab's dot. */
	const sources = $derived(downloadSourcesFor(kind))
	const inFlightHere = $derived(
		downloads.items.filter(
			(item) =>
				sources.includes(item.source) &&
				(item.state === "in_flight" || item.state === "cancelling")
		).length
	)
	const tabStrip = $derived(
		tabs.map((t) => ({
			value: t.value,
			label: t.label,
			icon: ((Icons as any)[t.icon] as any) ?? Icons.Package,
			hasActivity: t.value === "downloads" && inFlightHere > 0
		}))
	)

	let showDetails = $state(false)
	let confirmRemove = $state(false)
	const removeCopy = $derived(
		removeConfirmation(
			kind,
			capabilitiesServedBy(managedConnectionIds, capabilityDefaults).map(
				(capability) => {
					try {
						return capabilityLabel(capability as any)
					} catch {
						return capability
					}
				}
			)
		)
	)

	// ── Presses ─────────────────────────────────────────────────────────────
	function startProcess() {
		starting = true
		socket.emit("koboldcpp:startSubprocess", {})
	}
	function stopProcess() {
		stopping = true
		socket.emit("koboldcpp:stopSubprocess", {})
	}
	function unloadModel() {
		unloading = true
		socket.emit("koboldcpp:unloadModel", {})
	}
	function testAddress() {
		isTesting = true
		if (isKcpp)
			socket.emit("koboldcpp:version", {
				baseUrl: addressField.trim() || undefined
			})
		else
			socket.emit("ollama:version", {
				baseUrl: addressField.trim() || undefined
			})
	}
	function saveAddress() {
		if (!addressField.trim()) {
			toaster.error({ title: "The address can't be empty" })
			return
		}
		savingAddress = true
		if (isKcpp)
			socket.emit("koboldcpp:setBaseUrl", {
				baseUrl: addressField.trim()
			})
		else socket.emit("ollama:setBaseUrl", { baseUrl: addressField.trim() })
	}
	/** Back to "managed or external?" — the setup screen chooses again. */
	function reconfigure() {
		socket.emit("koboldcpp:setManagedMode", { mode: null })
		externalConnected = false
		pickerRequested = false
	}
	function connectMyOwn() {
		socket.emit("koboldcpp:setManagedMode", { mode: "external" })
		externalConnected = false
	}
	/** Rename is the name field, which is where the name already lives. */
	function rename() {
		tab = "settings"
		setTimeout(() => document.getElementById("connection-name")?.focus(), 0)
	}

	// ── Answers ─────────────────────────────────────────────────────────────
	function handleSubprocessStatus(
		msg: Sockets.KoboldCPP.SubprocessStatus.Response
	) {
		subStatus = msg
		starting = false
		stopping = false
		if (msg.status === "running")
			socket.emit("koboldcpp:getLoadedConfig", {})
	}
	function handleGetSubprocessStatus(
		msg: Sockets.KoboldCPP.GetSubprocessStatus.Response
	) {
		handleSubprocessStatus(msg.status)
	}
	function handleLoadedConfig(
		msg: Sockets.KoboldCPP.GetLoadedConfig.Response
	) {
		resident = msg.config
	}
	function handlePerf(msg: Sockets.KoboldCPP.Perf.Response) {
		perf = msg
	}
	function handleStartError(msg: { error?: string }) {
		starting = false
		toaster.error({ title: "Couldn't start", description: msg?.error })
	}
	function handleStopSubprocess(
		msg: Sockets.KoboldCPP.StopSubprocess.Response
	) {
		stopping = false
		if (!msg.success)
			toaster.error({ title: "Couldn't stop", description: msg.error })
	}
	function handleUnloadModel(msg: Sockets.KoboldCPP.UnloadModel.Response) {
		unloading = false
		if (msg.success) resident = null
		else toaster.error({ title: "This build can't unload a model" })
	}
	function handleKcppVersion(msg: Sockets.KoboldCPP.Version.Response) {
		isTesting = false
		kcppVersion = msg.version ?? null
		externalReachable = !!msg.version
		if (msg.version) externalConnected = true
	}
	function handleKcppVersionError(msg: { error?: string }) {
		isTesting = false
		externalReachable = false
		if (managedMode === "external" && externalConnected)
			toaster.error({
				title: "Couldn't reach KoboldCPP",
				description: msg.error
			})
	}
	function handleKcppSetBaseUrl(msg: Sockets.KoboldCPP.SetBaseUrl.Response) {
		savingAddress = false
		if (msg.success) {
			toaster.success({ title: "Address updated" })
			showAddress = false
			testAddress()
		} else toaster.error({ title: "Couldn't save the address" })
	}
	function handleBinaryUpdate(
		msg: Sockets.KoboldCPP.CheckManagedBinaryUpdate.Response
	) {
		binaryUpdateAvailable = !!msg.isUpdateAvailable
	}
	function handleOllamaVersion(msg: Sockets.Ollama.Version.Response) {
		isTesting = false
		ollamaVersion = msg.version ?? null
		ollamaReachable = !!msg.version
	}
	function handleOllamaVersionError() {
		isTesting = false
		ollamaReachable = false
	}
	function handleOllamaModels(msg: Sockets.Ollama.ModelsList.Response) {
		ollamaModelCount = msg.models?.length ?? 0
	}
	function handleOllamaRunning(
		msg: Sockets.Ollama.ListRunningModels.Response
	) {
		ollamaRunningCount = msg.runningModels?.length ?? 0
	}
	function handleOllamaSetBaseUrl(msg: Sockets.Ollama.SetBaseUrl.Response) {
		savingAddress = false
		if (msg.success) {
			toaster.success({ title: "Address updated" })
			showAddress = false
			checkOllama()
		} else toaster.error({ title: "Couldn't save the address" })
	}
	function handleOllamaUpdate(
		msg: Sockets.Ollama.IsUpdateAvailable.Response
	) {
		ollamaUpdateAvailable = !!msg.isUpdateAvailable
	}

	function checkOllama() {
		isTesting = true
		socket.emit("ollama:version", {})
		socket.emit("ollama:modelsList", {})
		socket.emit("ollama:listRunningModels", {})
	}

	/**
	 * Every key this view holds, declared ABOVE the effects that emit.
	 *
	 * Effects run in creation order and a request flushes the pending interest
	 * sync, so a declaration made below either of the mount effects would miss
	 * the flush its own first reply rides on.
	 *
	 * `koboldcpp:` and `ollama:` are restricted (admin-only) interest, so a
	 * non-admin declares nothing rather than collecting a refusal per key —
	 * and the branch on `kind` means an Ollama connection never listens to a
	 * KoboldCPP process it has no card for.
	 */
	$effect(() => {
		if (!isAdmin || !isKcpp) return
		const releases = [
			declareInterest<"koboldcpp:subprocessStatus">(
				"koboldcpp:subprocessStatus",
				handleSubprocessStatus
			),
			declareInterest<"koboldcpp:getSubprocessStatus">(
				"koboldcpp:getSubprocessStatus",
				handleGetSubprocessStatus
			),
			declareInterest<"koboldcpp:getLoadedConfig">(
				"koboldcpp:getLoadedConfig",
				handleLoadedConfig
			),
			declareInterest<"koboldcpp:perf">("koboldcpp:perf", handlePerf),
			declareInterest<"koboldcpp:startSubprocess:error">(
				"koboldcpp:startSubprocess:error",
				handleStartError
			),
			declareInterest<"koboldcpp:stopSubprocess">(
				"koboldcpp:stopSubprocess",
				handleStopSubprocess
			),
			declareInterest<"koboldcpp:unloadModel">(
				"koboldcpp:unloadModel",
				handleUnloadModel
			),
			declareInterest<"koboldcpp:version">(
				"koboldcpp:version",
				handleKcppVersion
			),
			declareInterest<"koboldcpp:version:error">(
				"koboldcpp:version:error",
				handleKcppVersionError
			),
			declareInterest<"koboldcpp:setBaseUrl">(
				"koboldcpp:setBaseUrl",
				handleKcppSetBaseUrl
			),
			declareInterest<"koboldcpp:checkManagedBinaryUpdate">(
				"koboldcpp:checkManagedBinaryUpdate",
				handleBinaryUpdate
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})
	$effect(() => {
		if (!isAdmin || isKcpp) return
		const releases = [
			declareInterest<"ollama:version">(
				"ollama:version",
				handleOllamaVersion
			),
			declareInterest<"ollama:version:error">(
				"ollama:version:error",
				handleOllamaVersionError
			),
			declareInterest<"ollama:modelsList">(
				"ollama:modelsList",
				handleOllamaModels
			),
			declareInterest<"ollama:listRunningModels">(
				"ollama:listRunningModels",
				handleOllamaRunning
			),
			declareInterest<"ollama:setBaseUrl">(
				"ollama:setBaseUrl",
				handleOllamaSetBaseUrl
			),
			declareInterest<"ollama:isUpdateAvailable">(
				"ollama:isUpdateAvailable",
				handleOllamaUpdate
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})
	/**
	 * The downloads feeds, subscriber-counted in the store: the tray and this
	 * view are open together and the first to unmount must not blank the other.
	 */
	$effect(() => downloads.subscribe({ admin: isAdmin }))

	/**
	 * A tab opening another connection.
	 *
	 * `KoboldCppModelsTab`'s Image list is the only way to the
	 * `koboldcpp_managed_image` row — U1 hides it from the index, because one
	 * install is one row there. That tab navigates the way it always has, by
	 * writing `digest.connectionId` and opening the Connections view, and the
	 * sidebar only READS the digest when it mounts — so from inside an
	 * already-open Connections view the press did nothing at all. Consumed
	 * here instead, which is the one place that knows a managed view is open.
	 */
	$effect(() => {
		const wanted = panelsCtx?.digest?.connectionId
		if (wanted == null || !panelsCtx) return
		panelsCtx.digest.connectionId = undefined
		if (wanted !== connectionId) onOpenConnection(wanted)
	})

	/** The managed process, asked for once the view knows it has one. */
	$effect(() => {
		if (!isAdmin || !isKcpp || !isManaged) return
		socket.emit("koboldcpp:getSubprocessStatus", {})
		socket.emit("koboldcpp:getLoadedConfig", {})
		socket.emit("koboldcpp:perf", {})
		socket.emit("koboldcpp:checkManagedBinaryUpdate", {})
	})
	/** External mode has no process to ask about — only an address. */
	$effect(() => {
		if (!isAdmin || !isKcpp || managedMode !== "external") return
		if (externalReachable !== null) return
		testAddress()
	})

	onMount(() => {
		if (!isAdmin || isKcpp) return
		checkOllama()
		socket.emit("ollama:isUpdateAvailable", {})
	})
</script>

{#snippet statusDot(dot: StatusDot)}
	<span
		class="size-2 shrink-0 rounded-full {DOT[dot]}"
		aria-hidden="true"
	></span>
{/snippet}

{#snippet addressRow(placeholder: string)}
	<div class="flex flex-col gap-2">
		<label class="text-surface-600-400 text-xs" for="managed-address">
			Address
		</label>
		<div class="flex gap-2">
			<input
				id="managed-address"
				type="text"
				class="input min-w-0 flex-1"
				{placeholder}
				bind:value={addressField}
			/>
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				onclick={saveAddress}
				disabled={savingAddress}
			>
				{#if savingAddress}
					<Icons.Loader2 size={14} class="animate-spin" />
				{:else}
					<Icons.Save size={14} aria-hidden="true" />
				{/if}
				Save
			</button>
		</div>
	</div>
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-3 p-1">
	<PanelNavHeader
		{title}
		{onBack}
		backLabel="Back to connections"
		actionsLabel={label}
		primaryAction={serviceChip}
		{actions}
	/>

	<div class="flex min-h-0 flex-1 flex-col gap-3">
		<!-- ── The status card ──────────────────────────────────────────── -->
		<!-- Not before a binary is recorded: the process line would say
		     "Stopped" and offer Start with nothing on disk to start. -->
		{#if isKcpp && isManaged && hasBinary && processLine}
			<section class="panel-card flex flex-col gap-2" aria-label="Status">
				<div class="flex min-w-0 items-center gap-2">
					{@render statusDot(processLine.dot)}
					<span class="shrink-0 text-sm font-medium">
						{processLine.label}
					</span>
					{#if processLine.meta}
						<span
							class="text-surface-600-400 min-w-0 flex-1 truncate text-xs"
						>
							· {processLine.meta}
						</span>
					{:else}
						<span class="flex-1"></span>
					{/if}
					{#if subStatus?.status === "running" || subStatus?.status === "starting" || subStatus?.status === "stopping"}
						<button
							type="button"
							class="btn btn-sm preset-tonal shrink-0"
							onclick={stopProcess}
							disabled={stopping || subStatus?.isExternal}
							title={subStatus?.isExternal
								? "Serene Pub didn't start this one, so it can't stop it"
								: undefined}
						>
							{#if stopping}
								<Icons.Loader2 size={13} class="animate-spin" />
							{:else}
								<Icons.Square size={13} aria-hidden="true" />
							{/if}
							Stop
						</button>
					{:else}
						<button
							type="button"
							class="btn btn-sm preset-tonal shrink-0"
							onclick={startProcess}
							disabled={starting}
						>
							{#if starting}
								<Icons.Loader2 size={13} class="animate-spin" />
							{:else}
								<Icons.Play size={13} aria-hidden="true" />
							{/if}
							Start
						</button>
					{/if}
				</div>
				{#if processError}
					<p class="text-error-500 text-xs">{processError}</p>
				{/if}
				<div class="flex min-w-0 items-center gap-2">
					<Icons.Brain
						size={14}
						class="text-surface-500 shrink-0"
						aria-hidden="true"
					/>
					<span class="min-w-0 flex-1 truncate text-xs">
						{loadedLine.text}
					</span>
					{#if loadedLine.loaded}
						<button
							type="button"
							class="btn btn-sm hover:preset-tonal text-surface-400 shrink-0"
							onclick={unloadModel}
							disabled={unloading}
						>
							{#if unloading}
								<Icons.Loader2 size={12} class="animate-spin" />
							{:else}
								<Icons.LogOut size={12} aria-hidden="true" />
							{/if}
							Unload
						</button>
					{/if}
				</div>
				{#if perfLine}
					<div class="flex min-w-0 items-center gap-2">
						<Icons.Gauge
							size={14}
							class="text-surface-500 shrink-0"
							aria-hidden="true"
						/>
						<span
							class="text-surface-600-400 min-w-0 flex-1 truncate text-xs"
						>
							{perfLine}
						</span>
						<button
							type="button"
							class="btn btn-sm hover:preset-tonal text-surface-400 shrink-0"
							aria-expanded={showDetails}
							onclick={() => (showDetails = !showDetails)}
						>
							Details
							{#if showDetails}
								<Icons.ChevronUp size={12} aria-hidden="true" />
							{:else}
								<Icons.ChevronDown
									size={12}
									aria-hidden="true"
								/>
							{/if}
						</button>
					</div>
				{/if}
				{#if binaryUpdateAvailable}
					<div class="flex items-center gap-2">
						<span
							class="preset-tonal-primary rounded-full px-2 py-0.5 text-[11px]"
						>
							Update available
						</span>
						<button
							type="button"
							class="btn btn-sm preset-tonal"
							onclick={() => (pickerRequested = true)}
						>
							<Icons.Download size={13} aria-hidden="true" />
							Update
						</button>
					</div>
				{/if}
			</section>
			{#if showDetails}
				<div class="panel-card">
					<KoboldCppPerfTab isManaged={true} />
				</div>
			{/if}
		{:else if isKcpp && managedMode === "external" && stage === "tabs"}
			<section class="panel-card flex flex-col gap-2" aria-label="Status">
				<div class="flex min-w-0 items-center gap-2">
					{@render statusDot(externalLine.dot)}
					<span class="shrink-0 text-sm font-medium">
						{externalLine.label}
					</span>
					{#if externalLine.meta}
						<span class="text-surface-600-400 truncate text-xs">
							· {externalLine.meta}
						</span>
					{/if}
				</div>
				<p class="text-surface-600-400 truncate text-xs">
					{savedAddress || "http://localhost:5001"}
				</p>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class="btn btn-sm preset-tonal"
						onclick={testAddress}
						disabled={isTesting}
					>
						{#if isTesting}
							<Icons.Loader2 size={13} class="animate-spin" />
						{:else}
							<Icons.RefreshCw size={13} aria-hidden="true" />
						{/if}
						Test
					</button>
					<button
						type="button"
						class="btn btn-sm hover:preset-tonal text-surface-400"
						aria-expanded={showAddress}
						onclick={() => (showAddress = !showAddress)}
					>
						Change address
					</button>
				</div>
				{#if showAddress}
					{@render addressRow("http://localhost:5001")}
				{/if}
			</section>
		{:else if !isKcpp && ollamaLine}
			<section class="panel-card flex flex-col gap-2" aria-label="Status">
				<div class="flex min-w-0 items-center gap-2">
					{@render statusDot(ollamaLine.dot)}
					<span class="shrink-0 text-sm font-medium">
						{ollamaLine.label}
					</span>
					{#if ollamaLine.meta}
						<span
							class="text-surface-600-400 min-w-0 flex-1 truncate text-xs"
						>
							· {ollamaLine.meta}
						</span>
					{/if}
					{#if ollamaUpdateAvailable}
						<a
							class="preset-tonal-primary shrink-0 rounded-full px-2 py-0.5 text-[11px]"
							href="https://ollama.com/download"
							target="_blank"
							rel="noopener noreferrer"
						>
							Update available
						</a>
					{/if}
				</div>
				{#if ollamaReachable === false}
					<p class="text-surface-600-400 text-xs">
						{ollamaUnreachableSentence(savedAddress)}
					</p>
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							class="btn btn-sm preset-tonal"
							onclick={checkOllama}
							disabled={isTesting}
						>
							{#if isTesting}
								<Icons.Loader2 size={13} class="animate-spin" />
							{:else}
								<Icons.RefreshCw size={13} aria-hidden="true" />
							{/if}
							Check again
						</button>
						<button
							type="button"
							class="btn btn-sm hover:preset-tonal text-surface-400"
							aria-expanded={showAddress}
							onclick={() => (showAddress = !showAddress)}
						>
							Change address
						</button>
						<a
							class="text-primary-500 text-xs underline"
							href="https://ollama.com/download"
							target="_blank"
							rel="noopener noreferrer"
						>
							Get Ollama
							<Icons.ExternalLink
								size={11}
								class="inline"
								aria-hidden="true"
							/>
						</a>
					</div>
					{#if showAddress}
						{@render addressRow("http://localhost:11434")}
					{/if}
				{/if}
			</section>
		{/if}

		<!-- ── The screen, or the tabs ──────────────────────────────────── -->
		{#if stage === "kcpp-mode"}
			<div class="min-h-0 flex-1 overflow-y-auto">
				<KoboldCppSetupScreen
					onChooseManaged={() => (pickerRequested = true)}
					onChooseExternal={() => {}}
				/>
			</div>
		{:else if stage === "kcpp-binary"}
			<div class="min-h-0 flex-1 overflow-y-auto">
				<KoboldCppBinaryVariantPicker
					onDownloadStarted={() => {
						pickerRequested = false
						tab = "models"
					}}
				/>
			</div>
		{:else if stage === "kcpp-external-setup"}
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
				<p class="text-surface-600-400 text-sm">
					Point Serene Pub at the KoboldCPP you are already running.
				</p>
				{@render addressRow("http://localhost:5001")}
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class="btn btn-sm preset-tonal"
						onclick={testAddress}
						disabled={isTesting}
					>
						{#if isTesting}
							<Icons.Loader2 size={13} class="animate-spin" />
						{:else}
							<Icons.RefreshCw size={13} aria-hidden="true" />
						{/if}
						Test
					</button>
					<button
						type="button"
						class="btn btn-sm hover:preset-tonal text-surface-400"
						onclick={reconfigure}
					>
						Let Serene Pub run KoboldCPP
					</button>
				</div>
			</div>
		{:else}
			<PanelTabStrip
				tabs={tabStrip}
				bind:value={tab}
				ariaLabel="{label} sections"
				panelIdPrefix="managed-connection"
			/>
			<div class="min-h-0 flex-1 overflow-y-auto">
				<div
					id="managed-connection-models"
					role="tabpanel"
					aria-labelledby="managed-connection-models-tab"
					hidden={tab !== "models"}
				>
					{#if tab === "models"}
						{#if isKcpp}
							<KoboldCppModelsTab />
						{:else}
							<OllamaInstalledTab />
						{/if}
					{/if}
				</div>
				<div
					id="managed-connection-get"
					role="tabpanel"
					aria-labelledby="managed-connection-get-tab"
					hidden={tab !== "get"}
				>
					{#if tab === "get"}
						<div class="flex flex-col gap-2 py-4">
							<button
								type="button"
								class="btn preset-tonal w-full"
								onclick={() => onGetModels(connectionId)}
							>
								<Icons.Download size={16} aria-hidden="true" />
								Get a model
							</button>
							<p class="text-surface-600-400 text-xs">
								Recommended lists and Hugging Face, scoped to
								this connection.
							</p>
						</div>
					{/if}
				</div>
				<div
					id="managed-connection-downloads"
					role="tabpanel"
					aria-labelledby="managed-connection-downloads-tab"
					hidden={tab !== "downloads"}
				>
					{#if tab === "downloads"}
						<!-- A door, not a list: the downloads view is ONE list
						     across every destination (R4), so a per-manager copy
						     here would be the split the ruling removed. -->
						<div class="flex flex-col gap-2 py-4">
							<button
								type="button"
								class="btn preset-tonal w-full"
								onclick={onOpenDownloads}
							>
								<Icons.Download size={16} aria-hidden="true" />
								See downloads
							</button>
							<p class="text-surface-600-400 text-xs">
								Everything this pub is fetching, for every
								connection, in one list.
							</p>
						</div>
					{/if}
				</div>
				<div
					id="managed-connection-settings"
					role="tabpanel"
					aria-labelledby="managed-connection-settings-tab"
					hidden={tab !== "settings"}
				>
					{#if tab === "settings"}
						<div class="flex flex-col gap-3 py-4">
							{#if isKcpp}
								<KoboldCppSettingsTab
									{isManaged}
									onUpdateBinary={() =>
										(pickerRequested = true)}
								/>
							{:else}
								<OllamaSettingsTab />
							{/if}

							{@render connectionSettings?.()}

							<!-- The two ways out, at the foot where they
							     belong: dashed, because neither is a setting
							     and both leave this screen behind. -->
							<section
								class="border-surface-300-700 flex flex-col gap-3 rounded-[12px] border border-dashed p-4"
								aria-label="Leaving {label}"
							>
								{#if isKcpp && isManaged}
									<div
										class="flex min-w-0 items-center gap-2"
									>
										<span class="min-w-0 flex-1 text-sm">
											Connect to a KoboldCPP I run myself
										</span>
										<button
											type="button"
											class="btn btn-sm preset-tonal shrink-0"
											onclick={connectMyOwn}
										>
											Switch
										</button>
									</div>
								{/if}
								<div class="flex min-w-0 items-start gap-2">
									<span class="min-w-0 flex-1">
										<span
											class="text-error-500 block text-sm"
										>
											Remove {label} from this pub
										</span>
										<span
											class="text-surface-600-400 block text-xs"
										>
											{isKcpp
												? "Keeps downloaded models on disk."
												: "Ollama keeps running outside Serene Pub."}
										</span>
									</span>
									<button
										type="button"
										class="btn btn-sm preset-tonal-error shrink-0"
										onclick={() => (confirmRemove = true)}
									>
										<Icons.Trash2
											size={13}
											aria-hidden="true"
										/>
										Remove
									</button>
								</div>
							</section>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

{#snippet serviceChip()}
	<!-- Title and service chip travel together (R5): the title says which one
	     this is, the chip says what it IS. Teal-tonal for a runtime this pub
	     runs, the same chip `ConnectionRow` wears in the index. -->
	<span
		class="preset-tonal-tertiary shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
	>
		{label}
	</span>
{/snippet}

{#snippet actions()}
	<button type="button" class="popover-menu-btn btn" onclick={rename}>
		<Icons.Pencil size={16} aria-hidden="true" />
		Rename
	</button>
	<button
		type="button"
		class="popover-menu-btn btn"
		onclick={onRefreshModels}
	>
		<Icons.RefreshCw size={16} aria-hidden="true" />
		Refresh models
	</button>
	<button
		type="button"
		class="popover-menu-btn btn text-error-500"
		onclick={() => (confirmRemove = true)}
	>
		<Icons.Trash2 size={16} aria-hidden="true" />
		Remove {label} from this pub
	</button>
{/snippet}

<Dialog open={confirmRemove} onOpenChange={(e) => (confirmRemove = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-lg space-y-4 p-6 shadow-xl"
			>
				<Dialog.Title class="text-lg font-semibold">
					{removeCopy.title}
				</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					{removeCopy.body}
				</Dialog.Description>
				{#if removeCopy.cost}
					<p class="text-warning-500 text-sm">{removeCopy.cost}</p>
				{/if}
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal"
						onclick={() => (confirmRemove = false)}
					>
						Keep {label}
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						onclick={() => {
							confirmRemove = false
							onRemove()
						}}
					>
						{removeCopy.confirmLabel}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
