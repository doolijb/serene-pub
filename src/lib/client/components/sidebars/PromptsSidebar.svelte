<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PromptConfigUnsavedChangesModal from "../modals/PromptConfigUnsavedChangesModal.svelte"
	import ConnectionSamplingPicker from "../ConnectionSamplingPicker.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	/**
	 * These tables are an archive, so this panel reads and nothing else.
	 *
	 * Superseded by `pipeline_context_templates` and `pipeline_prompts`;
	 * nothing in 0.6 builds a prompt from any of them. The rows are kept so a
	 * year of somebody's tuning survives the upgrade, and they go with the
	 * tables in a later release.
	 *
	 * A constant rather than a prop, because there is no caller who should be
	 * able to pass `false` — the socket refuses every write to these
	 * namespaces regardless (`server/sockets/legacyArchive.ts`), and a panel
	 * that could re-enable its own Save button would only be offering an action
	 * the server is going to refuse. This is the courtesy; that is the rule.
	 *
	 * Selection, navigation and scrolling stay live: the whole point of keeping
	 * the panel is being able to *look* at what you had.
	 */
	const READ_ONLY = true

	// ── View state ───────────────────────────────────────────────────────────
	type View =
		| "index"
		| "chat"
		| "narrator"
		| "world"
		| "character"
		| "scene"
		| "graph"
	let view = $state<View>("index")

	const socket = useTypedSocket()
	let userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	// ── Chat Prompts state ───────────────────────────────────────────────────
	let chatList: Sockets.PromptConfigs.List.Response["promptConfigsList"] =
		$state([])
	let selectedChatId: number | undefined = $state(
		userSettingsCtx.settings?.activePromptConfigId || undefined
	)
	let chatConfig: Sockets.PromptConfigs.Get.Response["promptConfig"] = $state(
		{} as Sockets.PromptConfigs.Get.Response["promptConfig"]
	)
	let chatOriginal: Sockets.PromptConfigs.Get.Response["promptConfig"] =
		$state({} as Sockets.PromptConfigs.Get.Response["promptConfig"])
	let chatUnsaved = $derived(
		JSON.stringify(chatConfig) !== JSON.stringify(chatOriginal)
	)

	let activeChatName = $derived.by(() => {
		const id =
			userSettingsCtx.settings?.activePromptConfigId ?? chatList[0]?.id
		return chatList.find((p) => p.id === id)?.name ?? null
	})

	// ── Chat Prompts: Narrator state ─────────────────────────────────────────
	let narratorPromptList: Sockets.NarratorPromptConfigs.List.Response["narratorPromptConfigsList"] =
		$state([])
	let selectedNarratorId: number | undefined = $state(
		userSettingsCtx.settings?.activeNarratorPromptConfigId || undefined
	)
	let narratorConfig: Sockets.NarratorPromptConfigs.Get.Response["narratorPromptConfig"] =
		$state(
			{} as Sockets.NarratorPromptConfigs.Get.Response["narratorPromptConfig"]
		)
	let narratorOriginal: Sockets.NarratorPromptConfigs.Get.Response["narratorPromptConfig"] =
		$state(
			{} as Sockets.NarratorPromptConfigs.Get.Response["narratorPromptConfig"]
		)
	let narratorUnsaved = $derived(
		JSON.stringify(narratorConfig) !== JSON.stringify(narratorOriginal)
	)

	let activeNarratorName = $derived.by(() => {
		const id =
			userSettingsCtx.settings?.activeNarratorPromptConfigId ??
			narratorPromptList[0]?.id
		return narratorPromptList.find((p) => p.id === id)?.name ?? null
	})

	// ── World Summarize state ─────────────────────────────────────────────────
	let worldList: Sockets.WorldSummarizeConfigs.List.Response["worldSummarizeConfigsList"] =
		$state([])
	let selectedWorldId: number | undefined = $state(undefined)
	let worldConfig: Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"] =
		$state(
			{} as Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"]
		)
	let worldOriginal: Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"] =
		$state(
			{} as Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"]
		)
	let worldUnsaved = $derived(
		JSON.stringify(worldConfig) !== JSON.stringify(worldOriginal)
	)

	let activeWorldName = $derived.by(() => {
		const id =
			userSettingsCtx.settings?.activeSummarizeWorldConfigId ??
			worldList[0]?.id
		return worldList.find((p) => p.id === id)?.name ?? null
	})

	// ── Character Summarize state ─────────────────────────────────────────────
	let characterList: Sockets.CharacterSummarizeConfigs.List.Response["characterSummarizeConfigsList"] =
		$state([])
	let selectedCharacterId: number | undefined = $state(undefined)
	let characterConfig: Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"] =
		$state(
			{} as Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"]
		)
	let characterOriginal: Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"] =
		$state(
			{} as Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"]
		)
	let characterUnsaved = $derived(
		JSON.stringify(characterConfig) !== JSON.stringify(characterOriginal)
	)

	let activeCharacterName = $derived.by(() => {
		const id =
			userSettingsCtx.settings?.activeSummarizeCharacterConfigId ??
			characterList[0]?.id
		return characterList.find((p) => p.id === id)?.name ?? null
	})

	// ── Scene Summarize state ─────────────────────────────────────────────────
	let sceneList: Sockets.SceneSummarizeConfigs.List.Response["sceneSummarizeConfigsList"] =
		$state([])
	let selectedSceneId: number | undefined = $state(undefined)
	let sceneConfig: Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"] =
		$state(
			{} as Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"]
		)
	let sceneOriginal: Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"] =
		$state(
			{} as Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"]
		)
	let sceneUnsaved = $derived(
		JSON.stringify(sceneConfig) !== JSON.stringify(sceneOriginal)
	)

	let activeSceneName = $derived.by(() => {
		const id =
			userSettingsCtx.settings?.activeSummarizeSceneConfigId ??
			sceneList[0]?.id
		return sceneList.find((p) => p.id === id)?.name ?? null
	})

	// ── Graph Build state ─────────────────────────────────────────────────────
	//
	// Unlike every other config here the active selection is SYSTEM-wide
	// (systemSettings.defaultGraphBuildConfigId), not per-user, so the "default"
	// marker reads from a local value the list response carries rather than from
	// userSettingsCtx.
	let graphList: Sockets.GraphBuildConfigs.List.Response["graphBuildConfigsList"] =
		$state([])
	let defaultGraphBuildConfigId: number | null = $state(null)
	let selectedGraphId: number | undefined = $state(undefined)
	let graphConfig: Sockets.GraphBuildConfigs.Get.Response["graphBuildConfig"] =
		$state({} as Sockets.GraphBuildConfigs.Get.Response["graphBuildConfig"])
	let graphOriginal: Sockets.GraphBuildConfigs.Get.Response["graphBuildConfig"] =
		$state({} as Sockets.GraphBuildConfigs.Get.Response["graphBuildConfig"])
	let graphUnsaved = $derived(
		JSON.stringify(graphConfig) !== JSON.stringify(graphOriginal)
	)
	let activeGraphName = $derived.by(() => {
		const id = defaultGraphBuildConfigId ?? graphList[0]?.id
		return graphList.find((p) => p.id === id)?.name ?? null
	})

	// ── Shared modal state ────────────────────────────────────────────────────
	let showNewNameModal = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// ── Connection / Sampling lists (for override pickers) ────────────────────
	let connectionsList: Sockets.Connections.List.Response["connectionsList"] =
		$state([])
	let samplingList: Sockets.SamplingConfigs.List.Response["samplingConfigsList"] =
		$state([])

	// ── Validation ────────────────────────────────────────────────────────────
	const nameSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})
	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})

	function currentName(): string {
		if (view === "chat") return chatConfig.name
		if (view === "narrator") return narratorConfig.name
		if (view === "world") return worldConfig.name
		if (view === "character") return characterConfig.name
		if (view === "scene") return sceneConfig.name
		if (view === "graph") return graphConfig.name
		return ""
	}

	function validateForm(): boolean {
		const result = nameSchema.safeParse({ name: currentName() })
		if (result.success) {
			validationErrors = {}
			return true
		}
		const errors: ValidationErrors = {}
		result.error.errors.forEach((e) => {
			if (e.path.length > 0) errors[e.path[0] as string] = e.message
		})
		validationErrors = errors
		return false
	}

	// ── Unsaved guard ─────────────────────────────────────────────────────────
	function hasUnsaved(): boolean {
		if (view === "chat") return chatUnsaved
		if (view === "narrator") return narratorUnsaved
		if (view === "world") return worldUnsaved
		if (view === "character") return characterUnsaved
		if (view === "scene") return sceneUnsaved
		if (view === "graph") return graphUnsaved
		return false
	}

	async function checkUnsaved(): Promise<boolean> {
		if (!hasUnsaved()) return true
		showUnsavedChangesModal = true
		return new Promise<boolean>((resolve) => {
			confirmCloseSidebarResolve = resolve
		})
	}

	async function handleOnClose() {
		return checkUnsaved()
	}

	async function navigateBack() {
		if (await checkUnsaved()) {
			view = "index"
			validationErrors = {}
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		confirmCloseSidebarResolve?.(true)
	}
	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		confirmCloseSidebarResolve?.(false)
	}
	function handleUnsavedChangesModalOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			confirmCloseSidebarResolve?.(false)
		}
	}

	// ── Guard selection changes against unsaved edits ─────────────────────────
	async function handleChatSelectChange(e: Event) {
		const newId = Number((e.target as HTMLSelectElement).value)
		if (newId === selectedChatId) return
		if (chatUnsaved && !(await checkUnsaved())) {
			// Revert the DOM select back to the current selection
			;(e.target as HTMLSelectElement).value = String(selectedChatId)
			return
		}
		selectedChatId = newId
	}

	async function handleNarratorSelectChange(e: Event) {
		const newId = Number((e.target as HTMLSelectElement).value)
		if (newId === selectedNarratorId) return
		if (narratorUnsaved && !(await checkUnsaved())) {
			;(e.target as HTMLSelectElement).value = String(selectedNarratorId)
			return
		}
		selectedNarratorId = newId
	}

	async function handleWorldSelectChange(e: Event) {
		const newId = Number((e.target as HTMLSelectElement).value)
		if (newId === selectedWorldId) return
		if (worldUnsaved && !(await checkUnsaved())) {
			;(e.target as HTMLSelectElement).value = String(selectedWorldId)
			return
		}
		selectedWorldId = newId
	}

	async function handleCharacterSelectChange(e: Event) {
		const newId = Number((e.target as HTMLSelectElement).value)
		if (newId === selectedCharacterId) return
		if (characterUnsaved && !(await checkUnsaved())) {
			;(e.target as HTMLSelectElement).value = String(selectedCharacterId)
			return
		}
		selectedCharacterId = newId
	}

	async function handleSceneSelectChange(e: Event) {
		const newId = Number((e.target as HTMLSelectElement).value)
		if (newId === selectedSceneId) return
		if (sceneUnsaved && !(await checkUnsaved())) {
			;(e.target as HTMLSelectElement).value = String(selectedSceneId)
			return
		}
		selectedSceneId = newId
	}

	async function handleGraphSelectChange(e: Event) {
		const newId = Number((e.target as HTMLSelectElement).value)
		if (newId === selectedGraphId) return
		if (graphUnsaved && !(await checkUnsaved())) {
			;(e.target as HTMLSelectElement).value = String(selectedGraphId)
			return
		}
		selectedGraphId = newId
	}

	// ── Chat actions ──────────────────────────────────────────────────────────
	function handleChatSave() {
		if (!validateForm()) return
		socket.emit("promptConfigs:update", {
			promptConfig: { ...chatConfig, id: chatConfig.id }
		})
	}
	function handleChatDelete() {
		if (!chatConfig.isImmutable) {
			socket.emit("promptConfigs:delete", { id: chatConfig.id })
			selectedChatId = undefined
		}
	}
	function handleChatReset() {
		chatConfig = { ...chatOriginal }
	}
	function handleChatNew() {
		showNewNameModal = true
	}

	// ── Narrator actions ─────────────────────────────────────────────────────
	function handleNarratorSave() {
		if (!validateForm()) return
		socket.emit("narratorPromptConfigs:update", {
			narratorPromptConfig: { ...narratorConfig, id: narratorConfig.id }
		})
	}
	function handleNarratorDelete() {
		if (!narratorConfig.isImmutable) {
			socket.emit("narratorPromptConfigs:delete", {
				id: narratorConfig.id
			})
			selectedNarratorId = undefined
		}
	}
	function handleNarratorReset() {
		narratorConfig = { ...narratorOriginal }
	}
	function handleNarratorNew() {
		showNewNameModal = true
	}

	// ── World actions ─────────────────────────────────────────────────────────
	function handleWorldSave() {
		if (!validateForm()) return
		socket.emit("worldSummarizeConfigs:update", {
			worldSummarizeConfig: { ...worldConfig, id: worldConfig.id }
		})
	}
	function handleWorldDelete() {
		if (!worldConfig.isImmutable) {
			socket.emit("worldSummarizeConfigs:delete", { id: worldConfig.id })
			selectedWorldId = undefined
		}
	}
	function handleWorldReset() {
		worldConfig = { ...worldOriginal }
	}
	function handleWorldNew() {
		showNewNameModal = true
	}

	// ── Character actions ─────────────────────────────────────────────────────
	function handleCharacterSave() {
		if (!validateForm()) return
		socket.emit("characterSummarizeConfigs:update", {
			characterSummarizeConfig: {
				...characterConfig,
				id: characterConfig.id
			}
		})
	}
	function handleCharacterDelete() {
		if (!characterConfig.isImmutable) {
			socket.emit("characterSummarizeConfigs:delete", {
				id: characterConfig.id
			})
			selectedCharacterId = undefined
		}
	}
	function handleCharacterReset() {
		characterConfig = { ...characterOriginal }
	}
	function handleCharacterNew() {
		showNewNameModal = true
	}

	// ── Scene actions ─────────────────────────────────────────────────────────
	function handleSceneSave() {
		if (!validateForm()) return
		socket.emit("sceneSummarizeConfigs:update", {
			sceneSummarizeConfig: { ...sceneConfig, id: sceneConfig.id }
		})
	}
	function handleSceneDelete() {
		if (!sceneConfig.isImmutable) {
			socket.emit("sceneSummarizeConfigs:delete", { id: sceneConfig.id })
			selectedSceneId = undefined
		}
	}
	function handleSceneReset() {
		sceneConfig = { ...sceneOriginal }
	}
	function handleSceneNew() {
		showNewNameModal = true
	}

	// ── Graph Build actions ───────────────────────────────────────────────────
	function handleGraphSave() {
		if (!validateForm()) return
		socket.emit("graphBuildConfigs:update", {
			graphBuildConfig: { ...graphConfig, id: graphConfig.id }
		})
	}
	function handleGraphDelete() {
		if (!graphConfig.isImmutable) {
			socket.emit("graphBuildConfigs:delete", { id: graphConfig.id })
			selectedGraphId = undefined
		}
	}
	function handleGraphReset() {
		graphConfig = { ...graphOriginal }
	}
	function handleGraphNew() {
		showNewNameModal = true
	}
	function handleGraphSetDefault() {
		if (!selectedGraphId) return
		socket.emit("graphBuildConfigs:setDefault", { id: selectedGraphId })
	}

	// ── New-name modal dispatch ───────────────────────────────────────────────
	function handleNewNameConfirm(name: string) {
		if (!name.trim()) return
		if (view === "chat") {
			const { id: _id, ...rest } = chatConfig
			socket.emit("promptConfigs:create", {
				promptConfig: { ...rest, name: name.trim(), isImmutable: false }
			})
		} else if (view === "narrator") {
			const { id: _id, ...rest } = narratorConfig
			socket.emit("narratorPromptConfigs:create", {
				narratorPromptConfig: {
					...rest,
					name: name.trim(),
					isImmutable: false
				}
			})
		} else if (view === "world") {
			const { id: _id, ...rest } = worldConfig
			socket.emit("worldSummarizeConfigs:create", {
				worldSummarizeConfig: {
					...rest,
					name: name.trim(),
					isImmutable: false
				}
			})
		} else if (view === "character") {
			const { id: _id, ...rest } = characterConfig
			socket.emit("characterSummarizeConfigs:create", {
				characterSummarizeConfig: {
					...rest,
					name: name.trim(),
					isImmutable: false
				}
			})
		} else if (view === "scene") {
			const { id: _id, ...rest } = sceneConfig
			socket.emit("sceneSummarizeConfigs:create", {
				sceneSummarizeConfig: {
					...rest,
					name: name.trim(),
					isImmutable: false
				}
			})
		} else if (view === "graph") {
			const { id: _id, ...rest } = graphConfig
			socket.emit("graphBuildConfigs:create", {
				graphBuildConfig: {
					...rest,
					name: name.trim(),
					isImmutable: false
				}
			})
		}
		showNewNameModal = false
	}
	function handleNewNameCancel() {
		showNewNameModal = false
	}

	// ── Reactive: load config when selection changes ──────────────────────────
	$effect(() => {
		if (selectedChatId)
			socket.emit("promptConfigs:get", { id: selectedChatId })
	})
	$effect(() => {
		if (selectedNarratorId)
			socket.emit("narratorPromptConfigs:get", { id: selectedNarratorId })
	})
	$effect(() => {
		if (selectedWorldId)
			socket.emit("worldSummarizeConfigs:get", { id: selectedWorldId })
	})
	$effect(() => {
		if (selectedCharacterId)
			socket.emit("characterSummarizeConfigs:get", {
				id: selectedCharacterId
			})
	})
	$effect(() => {
		if (selectedSceneId)
			socket.emit("sceneSummarizeConfigs:get", { id: selectedSceneId })
	})
	$effect(() => {
		if (selectedGraphId)
			socket.emit("graphBuildConfigs:get", { id: selectedGraphId })
	})

	// ── Set default actions ────────────────────────────────────────────────────
	function handleChatSetDefault() {
		if (!selectedChatId) return
		socket.emit("promptConfigs:setUserActive", { id: selectedChatId })
	}
	function handleNarratorSetDefault() {
		if (!selectedNarratorId) return
		socket.emit("narratorPromptConfigs:setUserActive", {
			id: selectedNarratorId
		})
	}
	function handleWorldSetDefault() {
		if (!selectedWorldId) return
		socket.emit("worldSummarizeConfigs:setUserActive", {
			id: selectedWorldId
		})
	}
	function handleCharacterSetDefault() {
		if (!selectedCharacterId) return
		socket.emit("characterSummarizeConfigs:setUserActive", {
			id: selectedCharacterId
		})
	}
	function handleSceneSetDefault() {
		if (!selectedSceneId) return
		socket.emit("sceneSummarizeConfigs:setUserActive", {
			id: selectedSceneId
		})
	}

	// Named handlers (not inline in onMount) so cleanup can pass the exact
	// same reference to .off() — a no-arg .off() call removes *every*
	// listener for that event, not just this component's. Two of these
	// (the ":setUserActive:error" pair) previously had no cleanup call at
	// all, leaking unconditionally on every unmount.
	function handlePromptConfigsList(msg: Sockets.PromptConfigs.List.Response) {
		chatList = msg.promptConfigsList
		if (!selectedChatId && chatList.length > 0) {
			selectedChatId =
				userSettingsCtx.settings?.activePromptConfigId ?? chatList[0].id
		}
	}
	function handlePromptConfigsGet(msg: Sockets.PromptConfigs.Get.Response) {
		if (msg.promptConfig.id !== selectedChatId) return
		chatConfig = { ...msg.promptConfig }
		chatOriginal = { ...msg.promptConfig }
	}
	function handlePromptConfigsCreate(
		msg: Sockets.PromptConfigs.Create.Response
	) {
		selectedChatId = msg.promptConfig.id
	}
	function handlePromptConfigsUpdate(
		msg: Sockets.PromptConfigs.Update.Response
	) {
		if (msg.promptConfig.id === chatConfig.id) {
			chatConfig = { ...msg.promptConfig }
			chatOriginal = { ...msg.promptConfig }
			toaster.success({ title: "Prompt Config Updated" })
		}
	}

	function handleNarratorPromptConfigsList(
		msg: Sockets.NarratorPromptConfigs.List.Response
	) {
		narratorPromptList = msg.narratorPromptConfigsList
		if (!selectedNarratorId && narratorPromptList.length > 0) {
			selectedNarratorId =
				userSettingsCtx.settings?.activeNarratorPromptConfigId ??
				narratorPromptList[0].id
		}
	}
	function handleNarratorPromptConfigsGet(
		msg: Sockets.NarratorPromptConfigs.Get.Response
	) {
		if (msg.narratorPromptConfig.id !== selectedNarratorId) return
		narratorConfig = { ...msg.narratorPromptConfig }
		narratorOriginal = { ...msg.narratorPromptConfig }
	}
	function handleNarratorPromptConfigsCreate(
		msg: Sockets.NarratorPromptConfigs.Create.Response
	) {
		selectedNarratorId = msg.narratorPromptConfig.id
	}
	function handleNarratorPromptConfigsUpdate(
		msg: Sockets.NarratorPromptConfigs.Update.Response
	) {
		if (msg.narratorPromptConfig.id === narratorConfig.id) {
			narratorConfig = { ...msg.narratorPromptConfig }
			narratorOriginal = { ...msg.narratorPromptConfig }
			toaster.success({ title: "Narrator Prompt Config Updated" })
		}
	}

	function handleWorldSummarizeConfigsList(
		msg: Sockets.WorldSummarizeConfigs.List.Response
	) {
		worldList = msg.worldSummarizeConfigsList
		if (!selectedWorldId && worldList.length > 0) {
			selectedWorldId =
				userSettingsCtx.settings?.activeSummarizeWorldConfigId ??
				worldList[0].id
		}
	}
	function handleWorldSummarizeConfigsGet(
		msg: Sockets.WorldSummarizeConfigs.Get.Response
	) {
		if (msg.worldSummarizeConfig.id !== selectedWorldId) return
		worldConfig = { ...msg.worldSummarizeConfig }
		worldOriginal = { ...msg.worldSummarizeConfig }
	}
	function handleWorldSummarizeConfigsCreate(
		msg: Sockets.WorldSummarizeConfigs.Create.Response
	) {
		selectedWorldId = msg.worldSummarizeConfig.id
	}
	function handleWorldSummarizeConfigsUpdate(
		msg: Sockets.WorldSummarizeConfigs.Update.Response
	) {
		if (msg.worldSummarizeConfig.id === worldConfig.id) {
			worldConfig = { ...msg.worldSummarizeConfig }
			worldOriginal = { ...msg.worldSummarizeConfig }
			toaster.success({ title: "World Summarize Config Updated" })
		}
	}

	function handleCharacterSummarizeConfigsList(
		msg: Sockets.CharacterSummarizeConfigs.List.Response
	) {
		characterList = msg.characterSummarizeConfigsList
		if (!selectedCharacterId && characterList.length > 0) {
			selectedCharacterId =
				userSettingsCtx.settings?.activeSummarizeCharacterConfigId ??
				characterList[0].id
		}
	}
	function handleCharacterSummarizeConfigsGet(
		msg: Sockets.CharacterSummarizeConfigs.Get.Response
	) {
		if (msg.characterSummarizeConfig.id !== selectedCharacterId) return
		characterConfig = { ...msg.characterSummarizeConfig }
		characterOriginal = { ...msg.characterSummarizeConfig }
	}
	function handleCharacterSummarizeConfigsCreate(
		msg: Sockets.CharacterSummarizeConfigs.Create.Response
	) {
		selectedCharacterId = msg.characterSummarizeConfig.id
	}
	function handleCharacterSummarizeConfigsUpdate(
		msg: Sockets.CharacterSummarizeConfigs.Update.Response
	) {
		if (msg.characterSummarizeConfig.id === characterConfig.id) {
			characterConfig = { ...msg.characterSummarizeConfig }
			characterOriginal = { ...msg.characterSummarizeConfig }
			toaster.success({
				title: "Character Summarize Config Updated"
			})
		}
	}

	function handleSceneSummarizeConfigsList(
		msg: Sockets.SceneSummarizeConfigs.List.Response
	) {
		sceneList = msg.sceneSummarizeConfigsList
		if (!selectedSceneId && sceneList.length > 0) {
			selectedSceneId =
				userSettingsCtx.settings?.activeSummarizeSceneConfigId ??
				sceneList[0].id
		}
	}
	function handleSceneSummarizeConfigsGet(
		msg: Sockets.SceneSummarizeConfigs.Get.Response
	) {
		if (msg.sceneSummarizeConfig.id !== selectedSceneId) return
		sceneConfig = { ...msg.sceneSummarizeConfig }
		sceneOriginal = { ...msg.sceneSummarizeConfig }
	}
	function handleSceneSummarizeConfigsCreate(
		msg: Sockets.SceneSummarizeConfigs.Create.Response
	) {
		selectedSceneId = msg.sceneSummarizeConfig.id
	}
	function handleSceneSummarizeConfigsUpdate(
		msg: Sockets.SceneSummarizeConfigs.Update.Response
	) {
		if (msg.sceneSummarizeConfig.id === sceneConfig.id) {
			sceneConfig = { ...msg.sceneSummarizeConfig }
			sceneOriginal = { ...msg.sceneSummarizeConfig }
			toaster.success({ title: "Scene Summarize Config Updated" })
		}
	}

	// Set-default response listeners (just toast — userSettings:get updates context)
	function handlePromptConfigsSetUserActive() {
		toaster.success({ title: "Default chat prompt updated" })
	}
	function handlePromptConfigsSetUserActiveError(msg: any) {
		toaster.error({
			title: msg?.error || "Failed to set default chat prompt"
		})
	}
	function handleNarratorPromptConfigsSetUserActive() {
		toaster.success({ title: "Default Narrator prompt updated" })
	}
	function handleNarratorPromptConfigsSetUserActiveError(msg: any) {
		toaster.error({
			title: msg?.error || "Failed to set default Narrator prompt"
		})
	}
	function handleWorldSummarizeConfigsSetUserActive() {
		toaster.success({ title: "Default world summarization updated" })
	}
	function handleCharacterSummarizeConfigsSetUserActive() {
		toaster.success({
			title: "Default character summarization updated"
		})
	}
	function handleSceneSummarizeConfigsSetUserActive() {
		toaster.success({ title: "Default scene summarization updated" })
	}

	function handleGraphBuildConfigsList(
		msg: Sockets.GraphBuildConfigs.List.Response
	) {
		graphList = msg.graphBuildConfigsList
		defaultGraphBuildConfigId = msg.defaultGraphBuildConfigId ?? null
		if (!selectedGraphId && graphList.length > 0) {
			selectedGraphId = defaultGraphBuildConfigId ?? graphList[0].id
		}
	}
	function handleGraphBuildConfigsGet(
		msg: Sockets.GraphBuildConfigs.Get.Response
	) {
		if (msg.graphBuildConfig.id !== selectedGraphId) return
		graphConfig = { ...msg.graphBuildConfig }
		graphOriginal = { ...msg.graphBuildConfig }
	}
	function handleGraphBuildConfigsCreate(
		msg: Sockets.GraphBuildConfigs.Create.Response
	) {
		selectedGraphId = msg.graphBuildConfig.id
	}
	function handleGraphBuildConfigsUpdate(
		msg: Sockets.GraphBuildConfigs.Update.Response
	) {
		if (msg.graphBuildConfig.id === graphConfig.id) {
			graphConfig = { ...msg.graphBuildConfig }
			graphOriginal = { ...msg.graphBuildConfig }
			toaster.success({ title: "Graph Build Config Updated" })
		}
	}
	function handleGraphBuildConfigsSetDefault(
		msg: Sockets.GraphBuildConfigs.SetDefault.Response
	) {
		defaultGraphBuildConfigId = msg.defaultGraphBuildConfigId
		toaster.success({ title: "Default Graph Build Config Set" })
	}

	// Connection / sampling lists for override pickers
	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connectionsList = msg.connectionsList
	}
	function handleSamplingConfigsListForPickers(
		msg: Sockets.SamplingConfigs.List.Response
	) {
		samplingList = msg.samplingConfigsList
	}

	onMount(() => {
		// Chat listeners
		socket.on("promptConfigs:list", handlePromptConfigsList)
		socket.on("promptConfigs:get", handlePromptConfigsGet)
		socket.on("promptConfigs:create", handlePromptConfigsCreate)
		socket.on("promptConfigs:update", handlePromptConfigsUpdate)

		// Narrator listeners
		socket.on("narratorPromptConfigs:list", handleNarratorPromptConfigsList)
		socket.on("narratorPromptConfigs:get", handleNarratorPromptConfigsGet)
		socket.on(
			"narratorPromptConfigs:create",
			handleNarratorPromptConfigsCreate
		)
		socket.on(
			"narratorPromptConfigs:update",
			handleNarratorPromptConfigsUpdate
		)

		// World listeners
		socket.on("worldSummarizeConfigs:list", handleWorldSummarizeConfigsList)
		socket.on("worldSummarizeConfigs:get", handleWorldSummarizeConfigsGet)
		socket.on(
			"worldSummarizeConfigs:create",
			handleWorldSummarizeConfigsCreate
		)
		socket.on(
			"worldSummarizeConfigs:update",
			handleWorldSummarizeConfigsUpdate
		)

		// Character listeners
		socket.on(
			"characterSummarizeConfigs:list",
			handleCharacterSummarizeConfigsList
		)
		socket.on(
			"characterSummarizeConfigs:get",
			handleCharacterSummarizeConfigsGet
		)
		socket.on(
			"characterSummarizeConfigs:create",
			handleCharacterSummarizeConfigsCreate
		)
		socket.on(
			"characterSummarizeConfigs:update",
			handleCharacterSummarizeConfigsUpdate
		)

		// Graph Build listeners
		socket.on("graphBuildConfigs:list", handleGraphBuildConfigsList)
		socket.on("graphBuildConfigs:get", handleGraphBuildConfigsGet)
		socket.on("graphBuildConfigs:create", handleGraphBuildConfigsCreate)
		socket.on("graphBuildConfigs:update", handleGraphBuildConfigsUpdate)
		socket.on(
			"graphBuildConfigs:setDefault",
			handleGraphBuildConfigsSetDefault
		)

		// Scene listeners
		socket.on("sceneSummarizeConfigs:list", handleSceneSummarizeConfigsList)
		socket.on("sceneSummarizeConfigs:get", handleSceneSummarizeConfigsGet)
		socket.on(
			"sceneSummarizeConfigs:create",
			handleSceneSummarizeConfigsCreate
		)
		socket.on(
			"sceneSummarizeConfigs:update",
			handleSceneSummarizeConfigsUpdate
		)

		socket.on(
			"promptConfigs:setUserActive",
			handlePromptConfigsSetUserActive
		)
		socket.on(
			"promptConfigs:setUserActive:error",
			handlePromptConfigsSetUserActiveError
		)
		socket.on(
			"narratorPromptConfigs:setUserActive",
			handleNarratorPromptConfigsSetUserActive
		)
		socket.on(
			"narratorPromptConfigs:setUserActive:error",
			handleNarratorPromptConfigsSetUserActiveError
		)
		socket.on(
			"worldSummarizeConfigs:setUserActive",
			handleWorldSummarizeConfigsSetUserActive
		)
		socket.on(
			"characterSummarizeConfigs:setUserActive",
			handleCharacterSummarizeConfigsSetUserActive
		)
		socket.on(
			"sceneSummarizeConfigs:setUserActive",
			handleSceneSummarizeConfigsSetUserActive
		)

		socket.on("connections:list", handleConnectionsList)
		socket.on("samplingConfigs:list", handleSamplingConfigsListForPickers)

		// Initial fetches
		socket.emit("promptConfigs:list", {})
		socket.emit("narratorPromptConfigs:list", {})
		socket.emit("worldSummarizeConfigs:list", {})
		socket.emit("characterSummarizeConfigs:list", {})
		socket.emit("sceneSummarizeConfigs:list", {})
		socket.emit("graphBuildConfigs:list", {})
		socket.emit("connections:list", {})
		socket.emit("samplingConfigs:list", {})

		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("connections:list", handleConnectionsList)
		socket.off("samplingConfigs:list", handleSamplingConfigsListForPickers)
		socket.off("promptConfigs:list", handlePromptConfigsList)
		socket.off("promptConfigs:get", handlePromptConfigsGet)
		socket.off("promptConfigs:create", handlePromptConfigsCreate)
		socket.off("promptConfigs:update", handlePromptConfigsUpdate)
		socket.off(
			"promptConfigs:setUserActive",
			handlePromptConfigsSetUserActive
		)
		socket.off(
			"promptConfigs:setUserActive:error",
			handlePromptConfigsSetUserActiveError
		)
		socket.off(
			"narratorPromptConfigs:list",
			handleNarratorPromptConfigsList
		)
		socket.off("narratorPromptConfigs:get", handleNarratorPromptConfigsGet)
		socket.off(
			"narratorPromptConfigs:create",
			handleNarratorPromptConfigsCreate
		)
		socket.off(
			"narratorPromptConfigs:update",
			handleNarratorPromptConfigsUpdate
		)
		socket.off(
			"narratorPromptConfigs:setUserActive",
			handleNarratorPromptConfigsSetUserActive
		)
		socket.off(
			"narratorPromptConfigs:setUserActive:error",
			handleNarratorPromptConfigsSetUserActiveError
		)
		socket.off(
			"worldSummarizeConfigs:list",
			handleWorldSummarizeConfigsList
		)
		socket.off("worldSummarizeConfigs:get", handleWorldSummarizeConfigsGet)
		socket.off(
			"worldSummarizeConfigs:create",
			handleWorldSummarizeConfigsCreate
		)
		socket.off(
			"worldSummarizeConfigs:update",
			handleWorldSummarizeConfigsUpdate
		)
		socket.off(
			"worldSummarizeConfigs:setUserActive",
			handleWorldSummarizeConfigsSetUserActive
		)
		socket.off(
			"characterSummarizeConfigs:list",
			handleCharacterSummarizeConfigsList
		)
		socket.off(
			"characterSummarizeConfigs:get",
			handleCharacterSummarizeConfigsGet
		)
		socket.off(
			"characterSummarizeConfigs:create",
			handleCharacterSummarizeConfigsCreate
		)
		socket.off(
			"characterSummarizeConfigs:update",
			handleCharacterSummarizeConfigsUpdate
		)
		socket.off(
			"characterSummarizeConfigs:setUserActive",
			handleCharacterSummarizeConfigsSetUserActive
		)
		socket.off(
			"sceneSummarizeConfigs:list",
			handleSceneSummarizeConfigsList
		)
		socket.off("sceneSummarizeConfigs:get", handleSceneSummarizeConfigsGet)
		socket.off("graphBuildConfigs:list", handleGraphBuildConfigsList)
		socket.off("graphBuildConfigs:get", handleGraphBuildConfigsGet)
		socket.off("graphBuildConfigs:create", handleGraphBuildConfigsCreate)
		socket.off("graphBuildConfigs:update", handleGraphBuildConfigsUpdate)
		socket.off(
			"graphBuildConfigs:setDefault",
			handleGraphBuildConfigsSetDefault
		)
		socket.off(
			"sceneSummarizeConfigs:create",
			handleSceneSummarizeConfigsCreate
		)
		socket.off(
			"sceneSummarizeConfigs:update",
			handleSceneSummarizeConfigsUpdate
		)
		socket.off(
			"sceneSummarizeConfigs:setUserActive",
			handleSceneSummarizeConfigsSetUserActive
		)
	})
</script>

<!-- ── INDEX VIEW ─────────────────────────────────────────────────────────── -->
{#if view === "index"}
	<div class="text-foreground flex h-full flex-col gap-3 p-4">
		<p class="text-muted-foreground text-sm">
			Select a prompt type to view and edit its configurations.
		</p>

		<!-- Chat Prompts card -->
		<button
			class="card preset-tonal hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
			onclick={() => (view = "chat")}
		>
			<div class="flex items-start gap-3">
				<div
					class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
				>
					<Icons.MessageSquareText size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">
							Chat Prompts: Character
						</span>
						<Icons.ChevronRight
							size={16}
							class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
						/>
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						System instructions injected into every chat.
					</p>
					{#if activeChatName}
						<div class="mt-2 flex items-center gap-1.5">
							<Icons.CheckCircle
								size={12}
								class="text-success-500 shrink-0"
							/>
							<span
								class="text-success-600 dark:text-success-400 truncate text-xs font-medium"
							>
								{activeChatName}
							</span>
						</div>
					{/if}
				</div>
			</div>
		</button>

		<!-- Chat Prompts: Narrator card -->
		<button
			class="card preset-tonal hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
			onclick={() => (view = "narrator")}
		>
			<div class="flex items-start gap-3">
				<div
					class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
				>
					<Icons.CloudSun size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">
							Chat Prompts: Narrator
						</span>
						<Icons.ChevronRight
							size={16}
							class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
						/>
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						System instructions for manually-triggered Narrator
						responses.
					</p>
					{#if activeNarratorName}
						<div class="mt-2 flex items-center gap-1.5">
							<Icons.CheckCircle
								size={12}
								class="text-success-500 shrink-0"
							/>
							<span
								class="text-success-600 dark:text-success-400 truncate text-xs font-medium"
							>
								{activeNarratorName}
							</span>
						</div>
					{/if}
				</div>
			</div>
		</button>

		<!-- Summarize type cards — only shown when summarization is enabled -->
		{#if systemSettingsCtx.settings?.summarizationEnabled}
			{#each [{ v: "world" as const, label: "World Lore Summarization", desc: "System instructions for world lore summarization.", icon: Icons.Globe, activeName: activeWorldName }, { v: "character" as const, label: "Character Lore Summarization", desc: "System instructions for character lore summarization.", icon: Icons.User, activeName: activeCharacterName }, { v: "scene" as const, label: "Scene Summarization", desc: "System instructions for scene summarization.", icon: Icons.Film, activeName: activeSceneName }, { v: "graph" as const, label: "Narrative Graph Build", desc: "Per-step instructions and model overrides for building the relationship graph.", icon: Icons.Share2, activeName: activeGraphName }] as card}
				<button
					class="card preset-tonal hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
					onclick={() => (view = card.v)}
				>
					<div class="flex items-start gap-3">
						<div
							class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
						>
							<card.icon size={20} />
						</div>
						<div class="min-w-0 flex-1">
							<div
								class="flex items-center justify-between gap-2"
							>
								<span class="font-semibold">{card.label}</span>
								<Icons.ChevronRight
									size={16}
									class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
								/>
							</div>
							<p class="text-muted-foreground mt-0.5 text-sm">
								{card.desc}
							</p>
							{#if card.activeName}
								<div class="mt-2 flex items-center gap-1.5">
									<Icons.CheckCircle
										size={12}
										class="text-success-500 shrink-0"
									/>
									<span
										class="text-success-600 dark:text-success-400 truncate text-xs font-medium"
									>
										{card.activeName}
									</span>
								</div>
							{/if}
						</div>
					</div>
				</button>
			{/each}
		{/if}
	</div>

	<!-- ── CHAT PROMPTS EDITOR ────────────────────────────────────────────────── -->
{:else if view === "chat"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-surface-200-800 border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-2"
					onclick={navigateBack}
					title="Back"
					aria-label="Back to prompt types"
				>
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
					Chat Prompts: Character
				</h2>
			</div>
			<div
				class="mt-2 flex gap-2"
				role="toolbar"
				aria-label="Chat prompt config actions"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleChatNew}
					disabled={READ_ONLY}
					title="Clone to new config"
					aria-label="Clone to new config"
				>
					<Icons.Plus size={14} /> Clone
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleChatReset}
					disabled={!chatUnsaved}
					title="Discard changes"
					aria-label="Discard changes"
				>
					<Icons.RefreshCcw size={14} /> Discard
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					onclick={handleChatDelete}
					disabled={READ_ONLY ||
						!chatConfig ||
						chatConfig.isImmutable}
					title="Delete config"
					aria-label="Delete config"
				>
					<Icons.Trash2 size={14} /> Delete
				</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select
					class="select w-full"
					value={selectedChatId}
					onchange={handleChatSelectChange}
				>
					{#each chatList.filter((c) => c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings?.activePromptConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name} *
						</option>
					{/each}
					{#each chatList.filter((c) => !c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings?.activePromptConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name}
						</option>
					{/each}
				</select>
			</div>
			{#if chatConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-success-500 flex-1"
							onclick={handleChatSave}
							disabled={READ_ONLY || !chatUnsaved}
						>
							<Icons.Save size={14} /> Update
						</button>
						<button
							class="btn btn-sm preset-filled-warning-500 shrink-0"
							onclick={handleChatSetDefault}
							disabled={READ_ONLY ||
								!selectedChatId ||
								selectedChatId ===
									userSettingsCtx.settings
										?.activePromptConfigId}
							title={selectedChatId &&
							selectedChatId ===
								userSettingsCtx.settings?.activePromptConfigId
								? "Already the default"
								: "Set as default"}
							aria-label={selectedChatId &&
							selectedChatId ===
								userSettingsCtx.settings?.activePromptConfigId
								? "Already the default"
								: "Set as default"}
						>
							<Icons.Star
								size={14}
								fill={selectedChatId &&
								selectedChatId ===
									userSettingsCtx.settings
										?.activePromptConfigId
									? "currentColor"
									: "none"}
							/>
							{selectedChatId &&
							selectedChatId ===
								userSettingsCtx.settings?.activePromptConfigId
								? "Default"
								: "Set Default"}
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="promptConfigChatName"
						>
							Name *
						</label>
						<input
							readonly={READ_ONLY}
							id="promptConfigChatName"
							type="text"
							bind:value={chatConfig.name}
							class="input w-full {validationErrors.name
								? 'border-error-500'
								: ''}"
							disabled={chatConfig.isImmutable}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.name}<p
								class="text-error-500 text-sm"
								role="alert"
							>
								{validationErrors.name}
							</p>{/if}
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="chatSystemPrompt"
						>
							System Instructions
						</label>
						<textarea
							readonly={READ_ONLY}
							id="chatSystemPrompt"
							rows="15"
							bind:value={chatConfig.systemPrompt}
							class="textarea w-full"
							disabled={chatConfig.isImmutable}
						></textarea>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="chatPostHistoryInstructions"
						>
							Post-History Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Reinforces the System Instructions above, placed
							right before the character generates instead of at
							the top of the prompt — much harder for the model to
							drift away from after a long conversation history.
							Optional.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="chatPostHistoryInstructions"
							rows="4"
							bind:value={chatConfig.postHistoryInstructions}
							class="textarea w-full"
							disabled={chatConfig.isImmutable}
							placeholder="e.g. Remember: stay in character and keep responding to {'{{'}personaNames{'}}'}."
						></textarea>
					</div>
					<div class="flex gap-2">
						<div class="flex flex-1 flex-col gap-1">
							<label
								class="text-sm font-semibold"
								for="chatPostHistoryDepth"
							>
								Post-History Depth
							</label>
							<p class="text-muted-foreground text-xs">
								Messages back from the last message to place the
								reminder at. 0 = right after the last message.
							</p>
							<input
								readonly={READ_ONLY}
								id="chatPostHistoryDepth"
								class="input w-full"
								type="number"
								min="0"
								bind:value={chatConfig.postHistoryDepth}
								disabled={chatConfig.isImmutable}
							/>
						</div>
						<div class="flex flex-1 flex-col gap-1">
							<label
								class="text-sm font-semibold"
								for="chatPostHistoryTokenTrigger"
							>
								Post-History Token Trigger
							</label>
							<p class="text-muted-foreground text-xs">
								Minimum chat history tokens before the reminder
								is included. 0 = always included.
							</p>
							<input
								readonly={READ_ONLY}
								id="chatPostHistoryTokenTrigger"
								class="input w-full"
								type="number"
								min="0"
								bind:value={chatConfig.postHistoryTokenTrigger}
								disabled={chatConfig.isImmutable}
							/>
						</div>
					</div>
					<div
						class="border-surface-200-800 flex flex-col gap-2 border-t pt-3"
					>
						<p class="text-sm font-semibold">AI Override</p>
						<p class="text-muted-foreground text-xs">
							Overrides the system default connection and sampling
							for this template.
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={chatConfig.connectionId}
							bind:samplingConfigId={chatConfig.samplingConfigId}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- ── CHAT PROMPTS: NARRATOR EDITOR ──────────────────────────────────────── -->
{:else if view === "narrator"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-surface-200-800 border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-2"
					onclick={navigateBack}
					title="Back"
					aria-label="Back to prompt types"
				>
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
					Chat Prompts: Narrator
				</h2>
			</div>
			<div
				class="mt-2 flex gap-2"
				role="toolbar"
				aria-label="Narrator prompt config actions"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleNarratorNew}
					disabled={READ_ONLY}
					title="Clone to new config"
					aria-label="Clone to new config"
				>
					<Icons.Plus size={14} /> Clone
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleNarratorReset}
					disabled={!narratorUnsaved}
					title="Discard changes"
					aria-label="Discard changes"
				>
					<Icons.RefreshCcw size={14} /> Discard
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					onclick={handleNarratorDelete}
					disabled={READ_ONLY ||
						!narratorConfig ||
						narratorConfig.isImmutable}
					title="Delete config"
					aria-label="Delete config"
				>
					<Icons.Trash2 size={14} /> Delete
				</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select
					class="select w-full"
					value={selectedNarratorId}
					onchange={handleNarratorSelectChange}
				>
					{#each narratorPromptList.filter((c) => c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeNarratorPromptConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name} *
						</option>
					{/each}
					{#each narratorPromptList.filter((c) => !c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeNarratorPromptConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name}
						</option>
					{/each}
				</select>
			</div>
			{#if narratorConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-success-500 flex-1"
							onclick={handleNarratorSave}
							disabled={READ_ONLY || !narratorUnsaved}
						>
							<Icons.Save size={14} /> Update
						</button>
						<button
							class="btn btn-sm preset-filled-warning-500 shrink-0"
							onclick={handleNarratorSetDefault}
							disabled={READ_ONLY ||
								!selectedNarratorId ||
								selectedNarratorId ===
									userSettingsCtx.settings
										?.activeNarratorPromptConfigId}
							title={selectedNarratorId &&
							selectedNarratorId ===
								userSettingsCtx.settings
									?.activeNarratorPromptConfigId
								? "Already the default"
								: "Set as default"}
							aria-label={selectedNarratorId &&
							selectedNarratorId ===
								userSettingsCtx.settings
									?.activeNarratorPromptConfigId
								? "Already the default"
								: "Set as default"}
						>
							<Icons.Star
								size={14}
								fill={selectedNarratorId &&
								selectedNarratorId ===
									userSettingsCtx.settings
										?.activeNarratorPromptConfigId
									? "currentColor"
									: "none"}
							/>
							{selectedNarratorId &&
							selectedNarratorId ===
								userSettingsCtx.settings
									?.activeNarratorPromptConfigId
								? "Default"
								: "Set Default"}
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="promptConfigNarratorName"
						>
							Name *
						</label>
						<input
							readonly={READ_ONLY}
							id="promptConfigNarratorName"
							type="text"
							bind:value={narratorConfig.name}
							class="input w-full {validationErrors.name
								? 'border-error-500'
								: ''}"
							disabled={narratorConfig.isImmutable}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.name}<p
								class="text-error-500 text-sm"
								role="alert"
							>
								{validationErrors.name}
							</p>{/if}
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="promptConfigNarratorDisplayName"
						>
							Display Name
						</label>
						<p class="text-muted-foreground text-xs">
							Shown in the chat instead of "Narrator" (e.g. "The
							World", "Fate") when a message is generated with
							this config.
						</p>
						<input
							readonly={READ_ONLY}
							id="promptConfigNarratorDisplayName"
							type="text"
							bind:value={narratorConfig.narratorName}
							class="input w-full"
							disabled={narratorConfig.isImmutable}
							placeholder="Narrator"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="narratorSystemPrompt"
						>
							System Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used when the Narrator is manually triggered to
							narrate the environment, atmosphere, or side
							characters instead of a chat character.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="narratorSystemPrompt"
							rows="15"
							bind:value={narratorConfig.systemPrompt}
							class="textarea w-full"
							disabled={narratorConfig.isImmutable}
						></textarea>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="narratorPostHistoryInstructions"
						>
							Post-History Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Reinforces the instructions above, placed right
							before the Narrator generates instead of at the top
							of the prompt — much harder for the model to drift
							away from after a long conversation history.
							Optional, but recommended if the Narrator keeps
							slipping into writing dialogue/actions for chat
							characters despite the System Instructions above.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="narratorPostHistoryInstructions"
							rows="4"
							bind:value={narratorConfig.postHistoryInstructions}
							class="textarea w-full"
							disabled={narratorConfig.isImmutable}
							placeholder="e.g. Remember: narrate only. Do not write dialogue or actions for {'{{'}characterNames{'}}'} or {'{{'}personaNames{'}}'}."
						></textarea>
					</div>
					<div class="flex gap-2">
						<div class="flex flex-1 flex-col gap-1">
							<label
								class="text-sm font-semibold"
								for="narratorPostHistoryDepth"
							>
								Post-History Depth
							</label>
							<p class="text-muted-foreground text-xs">
								Messages back from the last message to place the
								reminder at. 0 = right after the last message.
							</p>
							<input
								readonly={READ_ONLY}
								id="narratorPostHistoryDepth"
								class="input w-full"
								type="number"
								min="0"
								bind:value={narratorConfig.postHistoryDepth}
								disabled={narratorConfig.isImmutable}
							/>
						</div>
						<div class="flex flex-1 flex-col gap-1">
							<label
								class="text-sm font-semibold"
								for="narratorPostHistoryTokenTrigger"
							>
								Post-History Token Trigger
							</label>
							<p class="text-muted-foreground text-xs">
								Minimum chat history tokens before the reminder
								is included. 0 = always included.
							</p>
							<input
								readonly={READ_ONLY}
								id="narratorPostHistoryTokenTrigger"
								class="input w-full"
								type="number"
								min="0"
								bind:value={
									narratorConfig.postHistoryTokenTrigger
								}
								disabled={narratorConfig.isImmutable}
							/>
						</div>
					</div>
					<div
						class="border-surface-200-800 flex flex-col gap-2 border-t pt-3"
					>
						<p class="text-sm font-semibold">AI Override</p>
						<p class="text-muted-foreground text-xs">
							Overrides the system default connection and sampling
							for this template.
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={narratorConfig.connectionId}
							bind:samplingConfigId={
								narratorConfig.samplingConfigId
							}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- ── WORLD LORE SUMMARIZE EDITOR ───────────────────────────────────────── -->
{:else if view === "world"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-surface-200-800 border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-2"
					onclick={navigateBack}
					title="Back"
					aria-label="Back to prompt types"
				>
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
					World Lore Summarization
				</h2>
			</div>
			<div
				class="mt-2 flex gap-2"
				role="toolbar"
				aria-label="World lore summarization config actions"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleWorldNew}
					disabled={READ_ONLY}
					title="Clone to new config"
					aria-label="Clone to new config"
				>
					<Icons.Plus size={14} /> Clone
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleWorldReset}
					disabled={!worldUnsaved}
					title="Discard changes"
					aria-label="Discard changes"
				>
					<Icons.RefreshCcw size={14} /> Discard
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					onclick={handleWorldDelete}
					disabled={READ_ONLY ||
						!worldConfig ||
						worldConfig.isImmutable}
					title="Delete config"
					aria-label="Delete config"
				>
					<Icons.Trash2 size={14} /> Delete
				</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select
					class="select w-full"
					value={selectedWorldId}
					onchange={handleWorldSelectChange}
				>
					{#each worldList.filter((c) => c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeSummarizeWorldConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name} *
						</option>
					{/each}
					{#each worldList.filter((c) => !c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeSummarizeWorldConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name}
						</option>
					{/each}
				</select>
			</div>
			{#if worldConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-success-500 flex-1"
							onclick={handleWorldSave}
							disabled={READ_ONLY || !worldUnsaved}
						>
							<Icons.Save size={14} /> Update
						</button>
						<button
							class="btn btn-sm preset-filled-warning-500 shrink-0"
							onclick={handleWorldSetDefault}
							disabled={READ_ONLY ||
								!selectedWorldId ||
								selectedWorldId ===
									userSettingsCtx.settings
										?.activeSummarizeWorldConfigId}
							title={selectedWorldId &&
							selectedWorldId ===
								userSettingsCtx.settings
									?.activeSummarizeWorldConfigId
								? "Already the default"
								: "Set as default"}
							aria-label={selectedWorldId &&
							selectedWorldId ===
								userSettingsCtx.settings
									?.activeSummarizeWorldConfigId
								? "Already the default"
								: "Set as default"}
						>
							<Icons.Star
								size={14}
								fill={selectedWorldId &&
								selectedWorldId ===
									userSettingsCtx.settings
										?.activeSummarizeWorldConfigId
									? "currentColor"
									: "none"}
							/>
							{selectedWorldId &&
							selectedWorldId ===
								userSettingsCtx.settings
									?.activeSummarizeWorldConfigId
								? "Default"
								: "Set Default"}
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="promptConfigWorldName"
						>
							Name *
						</label>
						<input
							readonly={READ_ONLY}
							id="promptConfigWorldName"
							type="text"
							bind:value={worldConfig.name}
							class="input w-full {validationErrors.name
								? 'border-error-500'
								: ''}"
							disabled={worldConfig.isImmutable}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.name}<p
								class="text-error-500 text-sm"
								role="alert"
							>
								{validationErrors.name}
							</p>{/if}
					</div>
					<div
						class="border-surface-200-800 flex flex-col gap-2 border-t pt-3"
					>
						<label class="text-sm font-semibold" for="worldBatch">
							Batch Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used during the drafting phase (per batch of
							messages).
						</p>
						<textarea
							readonly={READ_ONLY}
							id="worldBatch"
							rows="8"
							bind:value={worldConfig.batchSystemPrompt}
							class="textarea w-full"
							disabled={worldConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={worldConfig.batchConnectionId}
							bind:samplingConfigId={
								worldConfig.batchSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold" for="worldSynth">
							Synthesis Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used during the synthesis phase (merging all
							drafts).
						</p>
						<textarea
							readonly={READ_ONLY}
							id="worldSynth"
							rows="8"
							bind:value={worldConfig.synthSystemPrompt}
							class="textarea w-full"
							disabled={worldConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={worldConfig.synthConnectionId}
							bind:samplingConfigId={
								worldConfig.synthSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold" for="worldName2">
							Title Generation Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used when generating a title for the entry.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="worldName2"
							rows="4"
							bind:value={worldConfig.nameSystemPrompt}
							class="textarea w-full"
							disabled={worldConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={worldConfig.nameConnectionId}
							bind:samplingConfigId={
								worldConfig.nameSamplingConfigId
							}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- ── CHARACTER LORE SUMMARIZE EDITOR ───────────────────────────────────── -->
{:else if view === "character"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-surface-200-800 border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-2"
					onclick={navigateBack}
					title="Back"
					aria-label="Back to prompt types"
				>
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
					Character Lore Summarization
				</h2>
			</div>
			<div
				class="mt-2 flex gap-2"
				role="toolbar"
				aria-label="Character lore summarization config actions"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleCharacterNew}
					disabled={READ_ONLY}
					title="Clone to new config"
					aria-label="Clone to new config"
				>
					<Icons.Plus size={14} /> Clone
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleCharacterReset}
					disabled={!characterUnsaved}
					title="Discard changes"
					aria-label="Discard changes"
				>
					<Icons.RefreshCcw size={14} /> Discard
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					onclick={handleCharacterDelete}
					disabled={READ_ONLY ||
						!characterConfig ||
						characterConfig.isImmutable}
					title="Delete config"
					aria-label="Delete config"
				>
					<Icons.Trash2 size={14} /> Delete
				</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select
					class="select w-full"
					value={selectedCharacterId}
					onchange={handleCharacterSelectChange}
				>
					{#each characterList.filter((c) => c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeSummarizeCharacterConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name} *
						</option>
					{/each}
					{#each characterList.filter((c) => !c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeSummarizeCharacterConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name}
						</option>
					{/each}
				</select>
			</div>
			{#if characterConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-success-500 flex-1"
							onclick={handleCharacterSave}
							disabled={READ_ONLY || !characterUnsaved}
						>
							<Icons.Save size={14} /> Update
						</button>
						<button
							class="btn btn-sm preset-filled-warning-500 shrink-0"
							onclick={handleCharacterSetDefault}
							disabled={READ_ONLY ||
								!selectedCharacterId ||
								selectedCharacterId ===
									userSettingsCtx.settings
										?.activeSummarizeCharacterConfigId}
							title={selectedCharacterId &&
							selectedCharacterId ===
								userSettingsCtx.settings
									?.activeSummarizeCharacterConfigId
								? "Already the default"
								: "Set as default"}
							aria-label={selectedCharacterId &&
							selectedCharacterId ===
								userSettingsCtx.settings
									?.activeSummarizeCharacterConfigId
								? "Already the default"
								: "Set as default"}
						>
							<Icons.Star
								size={14}
								fill={selectedCharacterId &&
								selectedCharacterId ===
									userSettingsCtx.settings
										?.activeSummarizeCharacterConfigId
									? "currentColor"
									: "none"}
							/>
							{selectedCharacterId &&
							selectedCharacterId ===
								userSettingsCtx.settings
									?.activeSummarizeCharacterConfigId
								? "Default"
								: "Set Default"}
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="promptConfigCharName"
						>
							Name *
						</label>
						<input
							readonly={READ_ONLY}
							id="promptConfigCharName"
							type="text"
							bind:value={characterConfig.name}
							class="input w-full {validationErrors.name
								? 'border-error-500'
								: ''}"
							disabled={characterConfig.isImmutable}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.name}<p
								class="text-error-500 text-sm"
								role="alert"
							>
								{validationErrors.name}
							</p>{/if}
					</div>
					<div
						class="border-surface-200-800 flex flex-col gap-2 border-t pt-3"
					>
						<label class="text-sm font-semibold" for="charBatch">
							Batch Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used during the drafting phase (per batch of
							messages).
						</p>
						<textarea
							readonly={READ_ONLY}
							id="charBatch"
							rows="8"
							bind:value={characterConfig.batchSystemPrompt}
							class="textarea w-full"
							disabled={characterConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={
								characterConfig.batchConnectionId
							}
							bind:samplingConfigId={
								characterConfig.batchSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold" for="charSynth">
							Synthesis Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used during the synthesis phase (merging all
							drafts).
						</p>
						<textarea
							readonly={READ_ONLY}
							id="charSynth"
							rows="8"
							bind:value={characterConfig.synthSystemPrompt}
							class="textarea w-full"
							disabled={characterConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={
								characterConfig.synthConnectionId
							}
							bind:samplingConfigId={
								characterConfig.synthSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold" for="charName2">
							Title Generation Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used when generating a title for the entry.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="charName2"
							rows="4"
							bind:value={characterConfig.nameSystemPrompt}
							class="textarea w-full"
							disabled={characterConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={characterConfig.nameConnectionId}
							bind:samplingConfigId={
								characterConfig.nameSamplingConfigId
							}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- ── SCENE SUMMARIZE EDITOR ─────────────────────────────────────────────── -->
{:else if view === "scene"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-surface-200-800 border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-2"
					onclick={navigateBack}
					title="Back"
					aria-label="Back to prompt types"
				>
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
					Scene Summarization
				</h2>
			</div>
			<div
				class="mt-2 flex gap-2"
				role="toolbar"
				aria-label="Scene summarization config actions"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleSceneNew}
					disabled={READ_ONLY}
					title="Clone to new config"
					aria-label="Clone to new config"
				>
					<Icons.Plus size={14} /> Clone
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleSceneReset}
					disabled={!sceneUnsaved}
					title="Discard changes"
					aria-label="Discard changes"
				>
					<Icons.RefreshCcw size={14} /> Discard
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					onclick={handleSceneDelete}
					disabled={READ_ONLY ||
						!sceneConfig ||
						sceneConfig.isImmutable}
					title="Delete config"
					aria-label="Delete config"
				>
					<Icons.Trash2 size={14} /> Delete
				</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select
					class="select w-full"
					value={selectedSceneId}
					onchange={handleSceneSelectChange}
				>
					{#each sceneList.filter((c) => c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeSummarizeSceneConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name} *
						</option>
					{/each}
					{#each sceneList.filter((c) => !c.isImmutable) as c}
						{@const isDefault =
							c.id ===
							userSettingsCtx.settings
								?.activeSummarizeSceneConfigId}
						<option value={c.id}>
							{isDefault ? "★ " : ""}{c.name}
						</option>
					{/each}
				</select>
			</div>
			{#if sceneConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-success-500 flex-1"
							onclick={handleSceneSave}
							disabled={READ_ONLY || !sceneUnsaved}
						>
							<Icons.Save size={14} /> Update
						</button>
						<button
							class="btn btn-sm preset-filled-warning-500 shrink-0"
							onclick={handleSceneSetDefault}
							disabled={READ_ONLY ||
								!selectedSceneId ||
								selectedSceneId ===
									userSettingsCtx.settings
										?.activeSummarizeSceneConfigId}
							title={selectedSceneId &&
							selectedSceneId ===
								userSettingsCtx.settings
									?.activeSummarizeSceneConfigId
								? "Already the default"
								: "Set as default"}
							aria-label={selectedSceneId &&
							selectedSceneId ===
								userSettingsCtx.settings
									?.activeSummarizeSceneConfigId
								? "Already the default"
								: "Set as default"}
						>
							<Icons.Star
								size={14}
								fill={selectedSceneId &&
								selectedSceneId ===
									userSettingsCtx.settings
										?.activeSummarizeSceneConfigId
									? "currentColor"
									: "none"}
							/>
							{selectedSceneId &&
							selectedSceneId ===
								userSettingsCtx.settings
									?.activeSummarizeSceneConfigId
								? "Default"
								: "Set Default"}
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="promptConfigSceneName"
						>
							Name *
						</label>
						<input
							readonly={READ_ONLY}
							id="promptConfigSceneName"
							type="text"
							bind:value={sceneConfig.name}
							class="input w-full {validationErrors.name
								? 'border-error-500'
								: ''}"
							disabled={sceneConfig.isImmutable}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.name}<p
								class="text-error-500 text-sm"
								role="alert"
							>
								{validationErrors.name}
							</p>{/if}
					</div>
					<div
						class="border-surface-200-800 flex flex-col gap-2 border-t pt-3"
					>
						<label class="text-sm font-semibold" for="sceneBatch">
							Batch Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used during the drafting phase (per batch of
							messages).
						</p>
						<textarea
							readonly={READ_ONLY}
							id="sceneBatch"
							rows="8"
							bind:value={sceneConfig.batchSystemPrompt}
							class="textarea w-full"
							disabled={sceneConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={sceneConfig.batchConnectionId}
							bind:samplingConfigId={
								sceneConfig.batchSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold" for="sceneSynth">
							Synthesis Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used during the synthesis phase (merging all
							drafts).
						</p>
						<textarea
							readonly={READ_ONLY}
							id="sceneSynth"
							rows="8"
							bind:value={sceneConfig.synthSystemPrompt}
							class="textarea w-full"
							disabled={sceneConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={sceneConfig.synthConnectionId}
							bind:samplingConfigId={
								sceneConfig.synthSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold" for="sceneName2">
							Title Generation Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used when generating a title for the entry.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="sceneName2"
							rows="4"
							bind:value={sceneConfig.nameSystemPrompt}
							class="textarea w-full"
							disabled={sceneConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={sceneConfig.nameConnectionId}
							bind:samplingConfigId={
								sceneConfig.nameSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label
							class="text-sm font-semibold"
							for="sceneCharacterExtraction"
						>
							Character Extraction Instructions
						</label>
						<p class="text-muted-foreground text-xs">
							Used when extracting participant and mentioned
							characters from the scene summary.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="sceneCharacterExtraction"
							rows="6"
							bind:value={
								sceneConfig.characterExtractionSystemPrompt
							}
							class="textarea w-full"
							disabled={sceneConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={
								sceneConfig.characterExtractionConnectionId
							}
							bind:samplingConfigId={
								sceneConfig.characterExtractionSamplingConfigId
							}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>
{:else if view === "graph"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-surface-200-800 border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 p-2"
					onclick={navigateBack}
					title="Back"
					aria-label="Back to prompt types"
				>
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
					Narrative Graph Build
				</h2>
			</div>
			<div
				class="mt-2 flex gap-2"
				role="toolbar"
				aria-label="Graph build config actions"
			>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleGraphNew}
					disabled={READ_ONLY}
					title="Clone to new config"
					aria-label="Clone to new config"
				>
					<Icons.Plus size={14} /> Clone
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={handleGraphReset}
					disabled={!graphUnsaved}
					title="Discard changes"
					aria-label="Discard changes"
				>
					<Icons.RefreshCcw size={14} /> Discard
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					onclick={handleGraphDelete}
					disabled={READ_ONLY ||
						!graphConfig ||
						graphConfig.isImmutable}
					title="Delete config"
					aria-label="Delete config"
				>
					<Icons.Trash2 size={14} /> Delete
				</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select
					class="select w-full"
					value={selectedGraphId}
					onchange={handleGraphSelectChange}
				>
					{#each graphList.filter((c) => c.isImmutable) as c}
						{@const isDefault = c.id === defaultGraphBuildConfigId}
						<option value={c.id}>
							{isDefault ? "\u2605 " : ""}{c.name} *
						</option>
					{/each}
					{#each graphList.filter((c) => !c.isImmutable) as c}
						{@const isDefault = c.id === defaultGraphBuildConfigId}
						<option value={c.id}>
							{isDefault ? "\u2605 " : ""}{c.name}
						</option>
					{/each}
				</select>
			</div>
			{#if graphConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-success-500 flex-1"
							onclick={handleGraphSave}
							disabled={READ_ONLY || !graphUnsaved}
						>
							<Icons.Save size={14} /> Update
						</button>
						<button
							class="btn btn-sm preset-filled-warning-500 shrink-0"
							onclick={handleGraphSetDefault}
							disabled={READ_ONLY ||
								!selectedGraphId ||
								selectedGraphId === defaultGraphBuildConfigId}
							title={selectedGraphId === defaultGraphBuildConfigId
								? "Already the default"
								: "Set as default"}
							aria-label={selectedGraphId ===
							defaultGraphBuildConfigId
								? "Already the default"
								: "Set as default"}
						>
							<Icons.Star
								size={14}
								fill={selectedGraphId ===
								defaultGraphBuildConfigId
									? "currentColor"
									: "none"}
							/>
							{selectedGraphId === defaultGraphBuildConfigId
								? "Default"
								: "Set Default"}
						</button>
					</div>
					{#if graphConfig.isImmutable}
						<p
							class="preset-tonal-warning rounded-xl p-2 text-xs"
							role="note"
						>
							This is a built-in config. Its instructions are
							re-applied on every restart, so they cannot be
							edited here — clone it to change them. The model and
							sampling overrides below stay editable.
						</p>
					{/if}
					<div class="flex flex-col gap-1">
						<label
							class="text-sm font-semibold"
							for="promptConfigGraphName"
						>
							Name *
						</label>
						<input
							readonly={READ_ONLY}
							id="promptConfigGraphName"
							type="text"
							bind:value={graphConfig.name}
							class="input w-full {validationErrors.name
								? 'border-error-500'
								: ''}"
							disabled={graphConfig.isImmutable}
							oninput={() => {
								if (validationErrors.name) {
									const { name, ...rest } = validationErrors
									validationErrors = rest
								}
							}}
						/>
						{#if validationErrors.name}<p
								class="text-error-500 text-sm"
								role="alert"
							>
								{validationErrors.name}
							</p>{/if}
					</div>
					<p
						class="text-muted-foreground border-surface-200-800 border-t pt-3 text-xs"
					>
						A build runs these steps in order. Each may use its own
						model and sampling profile — extraction steps benefit
						from a low-temperature profile, while the description
						step writes prose.
					</p>
					<div class="flex flex-col gap-2">
						<label
							class="text-sm font-semibold"
							for="graphnodeResolution"
						>
							Node Resolution
						</label>
						<p class="text-muted-foreground text-xs">
							Decides whether a name refers to a character already
							in the graph or to a new one. Errs toward creating a
							new node — a duplicate is visible in review, a wrong
							merge silently fuses two identities.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="graphnodeResolution"
							rows="8"
							bind:value={graphConfig.nodeResolutionSystemPrompt}
							class="textarea w-full"
							disabled={graphConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={
								graphConfig.nodeResolutionConnectionId
							}
							bind:samplingConfigId={
								graphConfig.nodeResolutionSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label
							class="text-sm font-semibold"
							for="graphperspective"
						>
							Character Perspective
						</label>
						<p class="text-muted-foreground text-xs">
							The main pass: reads a scene and extracts the
							relationships one character holds toward the others.
							Runs once per present character, so it dominates a
							build's cost.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="graphperspective"
							rows="12"
							bind:value={graphConfig.perspectiveSystemPrompt}
							class="textarea w-full"
							disabled={graphConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={
								graphConfig.perspectiveConnectionId
							}
							bind:samplingConfigId={
								graphConfig.perspectiveSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label
							class="text-sm font-semibold"
							for="graphnodeDescription"
						>
							Node Description
						</label>
						<p class="text-muted-foreground text-xs">
							Writes the two-sentence introduction for a newly
							discovered character. This one returns prose rather
							than JSON, so it is the only step not sent under a
							JSON constraint.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="graphnodeDescription"
							rows="6"
							bind:value={graphConfig.nodeDescriptionSystemPrompt}
							class="textarea w-full"
							disabled={graphConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={
								graphConfig.nodeDescriptionConnectionId
							}
							bind:samplingConfigId={
								graphConfig.nodeDescriptionSamplingConfigId
							}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label
							class="text-sm font-semibold"
							for="graphstateDetection"
						>
							State Detection
						</label>
						<p class="text-muted-foreground text-xs">
							Detects when a character reaches a new lifecycle
							state (deceased, missing, departed) during a scene.
							Biased toward omission.
						</p>
						<textarea
							readonly={READ_ONLY}
							id="graphstateDetection"
							rows="10"
							bind:value={graphConfig.stateDetectionSystemPrompt}
							class="textarea w-full"
							disabled={graphConfig.isImmutable}
						></textarea>
						<p
							class="text-muted-foreground mt-1 text-xs font-medium"
						>
							AI Override
						</p>
						<ConnectionSamplingPicker
							{connectionsList}
							{samplingList}
							bind:connectionId={
								graphConfig.stateDetectionConnectionId
							}
							bind:samplingConfigId={
								graphConfig.stateDetectionSamplingConfigId
							}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<PromptConfigUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
<NewNameModal
	open={showNewNameModal}
	onOpenChange={(e) => (showNewNameModal = e.open)}
	onConfirm={handleNewNameConfirm}
	onCancel={handleNewNameCancel}
	title={view === "chat"
		? "New Prompt Config"
		: view === "narrator"
			? "New Narrator Prompt Config"
			: view === "world"
				? "New World Lore Summarization Config"
				: view === "character"
					? "New Character Lore Summarization Config"
					: view === "scene"
						? "New Scene Summarization Config"
						: "New Narrative Graph Build Config"}
	description="Your current settings will be copied."
/>
