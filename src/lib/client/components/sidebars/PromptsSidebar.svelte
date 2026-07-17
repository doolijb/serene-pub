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

	// ── View state ───────────────────────────────────────────────────────────
	type View = "index" | "chat" | "chatWorld" | "world" | "character" | "scene"
	let view = $state<View>("index")

	const socket = useTypedSocket()
	let userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	// ── Chat Prompts state ───────────────────────────────────────────────────
	let chatList: Sockets.PromptConfigs.List.Response["promptConfigsList"] = $state([])
	let selectedChatId: number | undefined = $state(
		userSettingsCtx.settings?.activePromptConfigId || undefined
	)
	let chatConfig: Sockets.PromptConfigs.Get.Response["promptConfig"] = $state(
		{} as Sockets.PromptConfigs.Get.Response["promptConfig"]
	)
	let chatOriginal: Sockets.PromptConfigs.Get.Response["promptConfig"] = $state(
		{} as Sockets.PromptConfigs.Get.Response["promptConfig"]
	)
	let chatUnsaved = $derived(JSON.stringify(chatConfig) !== JSON.stringify(chatOriginal))

	let activeChatName = $derived.by(() => {
		const id = userSettingsCtx.settings?.activePromptConfigId ?? chatList[0]?.id
		return chatList.find((p) => p.id === id)?.name ?? null
	})

	// ── Chat Prompts: World state ────────────────────────────────────────────
	let chatWorldList: Sockets.ChatWorldPromptConfigs.List.Response["chatWorldPromptConfigsList"] =
		$state([])
	let selectedChatWorldId: number | undefined = $state(
		(userSettingsCtx.settings as any)?.activeChatWorldPromptConfigId || undefined
	)
	let chatWorldConfig: Sockets.ChatWorldPromptConfigs.Get.Response["chatWorldPromptConfig"] = $state(
		{} as Sockets.ChatWorldPromptConfigs.Get.Response["chatWorldPromptConfig"]
	)
	let chatWorldOriginal: Sockets.ChatWorldPromptConfigs.Get.Response["chatWorldPromptConfig"] = $state(
		{} as Sockets.ChatWorldPromptConfigs.Get.Response["chatWorldPromptConfig"]
	)
	let chatWorldUnsaved = $derived(JSON.stringify(chatWorldConfig) !== JSON.stringify(chatWorldOriginal))

	let activeChatWorldName = $derived.by(() => {
		const id = (userSettingsCtx.settings as any)?.activeChatWorldPromptConfigId ?? chatWorldList[0]?.id
		return chatWorldList.find((p) => p.id === id)?.name ?? null
	})

	// ── World Summarize state ─────────────────────────────────────────────────
	let worldList: Sockets.WorldSummarizeConfigs.List.Response["worldSummarizeConfigsList"] = $state([])
	let selectedWorldId: number | undefined = $state(undefined)
	let worldConfig: Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"] = $state(
		{} as Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"]
	)
	let worldOriginal: Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"] = $state(
		{} as Sockets.WorldSummarizeConfigs.Get.Response["worldSummarizeConfig"]
	)
	let worldUnsaved = $derived(JSON.stringify(worldConfig) !== JSON.stringify(worldOriginal))

	let activeWorldName = $derived.by(() => {
		const id = (userSettingsCtx.settings as any)?.activeSummarizeWorldConfigId ?? worldList[0]?.id
		return worldList.find((p) => p.id === id)?.name ?? null
	})

	// ── Character Summarize state ─────────────────────────────────────────────
	let characterList: Sockets.CharacterSummarizeConfigs.List.Response["characterSummarizeConfigsList"] =
		$state([])
	let selectedCharacterId: number | undefined = $state(undefined)
	let characterConfig: Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"] =
		$state({} as Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"])
	let characterOriginal: Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"] =
		$state({} as Sockets.CharacterSummarizeConfigs.Get.Response["characterSummarizeConfig"])
	let characterUnsaved = $derived(JSON.stringify(characterConfig) !== JSON.stringify(characterOriginal))

	let activeCharacterName = $derived.by(() => {
		const id = (userSettingsCtx.settings as any)?.activeSummarizeCharacterConfigId ?? characterList[0]?.id
		return characterList.find((p) => p.id === id)?.name ?? null
	})

	// ── Scene Summarize state ─────────────────────────────────────────────────
	let sceneList: Sockets.SceneSummarizeConfigs.List.Response["sceneSummarizeConfigsList"] = $state([])
	let selectedSceneId: number | undefined = $state(undefined)
	let sceneConfig: Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"] = $state(
		{} as Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"]
	)
	let sceneOriginal: Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"] = $state(
		{} as Sockets.SceneSummarizeConfigs.Get.Response["sceneSummarizeConfig"]
	)
	let sceneUnsaved = $derived(JSON.stringify(sceneConfig) !== JSON.stringify(sceneOriginal))

	let activeSceneName = $derived.by(() => {
		const id = (userSettingsCtx.settings as any)?.activeSummarizeSceneConfigId ?? sceneList[0]?.id
		return sceneList.find((p) => p.id === id)?.name ?? null
	})

	// ── Shared modal state ────────────────────────────────────────────────────
	let showNewNameModal = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// ── Connection / Sampling lists (for override pickers) ────────────────────
	let connectionsList: Sockets.Connections.List.Response["connectionsList"] = $state([])
	let samplingList: Sockets.SamplingConfigs.List.Response["samplingConfigsList"] = $state([])

	// ── Validation ────────────────────────────────────────────────────────────
	const nameSchema = z.object({ name: z.string().min(1, "Name is required").trim() })
	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})

	function currentName(): string {
		if (view === "chat") return chatConfig.name
		if (view === "chatWorld") return chatWorldConfig.name
		if (view === "world") return worldConfig.name
		if (view === "character") return characterConfig.name
		if (view === "scene") return sceneConfig.name
		return ""
	}

	function validateForm(): boolean {
		const result = nameSchema.safeParse({ name: currentName() })
		if (result.success) { validationErrors = {}; return true }
		const errors: ValidationErrors = {}
		result.error.errors.forEach((e) => { if (e.path.length > 0) errors[e.path[0] as string] = e.message })
		validationErrors = errors
		return false
	}

	// ── Unsaved guard ─────────────────────────────────────────────────────────
	function hasUnsaved(): boolean {
		if (view === "chat") return chatUnsaved
		if (view === "chatWorld") return chatWorldUnsaved
		if (view === "world") return worldUnsaved
		if (view === "character") return characterUnsaved
		if (view === "scene") return sceneUnsaved
		return false
	}

	async function checkUnsaved(): Promise<boolean> {
		if (!hasUnsaved()) return true
		showUnsavedChangesModal = true
		return new Promise<boolean>((resolve) => { confirmCloseSidebarResolve = resolve })
	}

	async function handleOnClose() { return checkUnsaved() }

	async function navigateBack() {
		if (await checkUnsaved()) { view = "index"; validationErrors = {} }
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false; confirmCloseSidebarResolve?.(true)
	}
	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false; confirmCloseSidebarResolve?.(false)
	}
	function handleUnsavedChangesModalOpenChange(e: OpenChangeDetails) {
		if (!e.open) { showUnsavedChangesModal = false; confirmCloseSidebarResolve?.(false) }
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

	async function handleChatWorldSelectChange(e: Event) {
		const newId = Number((e.target as HTMLSelectElement).value)
		if (newId === selectedChatWorldId) return
		if (chatWorldUnsaved && !(await checkUnsaved())) {
			;(e.target as HTMLSelectElement).value = String(selectedChatWorldId)
			return
		}
		selectedChatWorldId = newId
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

	// ── Chat actions ──────────────────────────────────────────────────────────
	function handleChatSave() {
		if (!validateForm()) return
		socket.emit("promptConfigs:update", { promptConfig: { ...chatConfig, id: chatConfig.id } })
	}
	function handleChatDelete() {
		if (!chatConfig.isImmutable) { socket.emit("promptConfigs:delete", { id: chatConfig.id }); selectedChatId = undefined }
	}
	function handleChatReset() { chatConfig = { ...chatOriginal } }
	function handleChatNew() { showNewNameModal = true }

	// ── Chat World actions ───────────────────────────────────────────────────
	function handleChatWorldSave() {
		if (!validateForm()) return
		socket.emit("chatWorldPromptConfigs:update", { chatWorldPromptConfig: { ...chatWorldConfig, id: chatWorldConfig.id } })
	}
	function handleChatWorldDelete() {
		if (!chatWorldConfig.isImmutable) { socket.emit("chatWorldPromptConfigs:delete", { id: chatWorldConfig.id }); selectedChatWorldId = undefined }
	}
	function handleChatWorldReset() { chatWorldConfig = { ...chatWorldOriginal } }
	function handleChatWorldNew() { showNewNameModal = true }

	// ── World actions ─────────────────────────────────────────────────────────
	function handleWorldSave() {
		if (!validateForm()) return
		socket.emit("worldSummarizeConfigs:update", { worldSummarizeConfig: { ...worldConfig, id: worldConfig.id } })
	}
	function handleWorldDelete() {
		if (!worldConfig.isImmutable) { socket.emit("worldSummarizeConfigs:delete", { id: worldConfig.id }); selectedWorldId = undefined }
	}
	function handleWorldReset() { worldConfig = { ...worldOriginal } }
	function handleWorldNew() { showNewNameModal = true }

	// ── Character actions ─────────────────────────────────────────────────────
	function handleCharacterSave() {
		if (!validateForm()) return
		socket.emit("characterSummarizeConfigs:update", { characterSummarizeConfig: { ...characterConfig, id: characterConfig.id } })
	}
	function handleCharacterDelete() {
		if (!characterConfig.isImmutable) { socket.emit("characterSummarizeConfigs:delete", { id: characterConfig.id }); selectedCharacterId = undefined }
	}
	function handleCharacterReset() { characterConfig = { ...characterOriginal } }
	function handleCharacterNew() { showNewNameModal = true }

	// ── Scene actions ─────────────────────────────────────────────────────────
	function handleSceneSave() {
		if (!validateForm()) return
		socket.emit("sceneSummarizeConfigs:update", { sceneSummarizeConfig: { ...sceneConfig, id: sceneConfig.id } })
	}
	function handleSceneDelete() {
		if (!sceneConfig.isImmutable) { socket.emit("sceneSummarizeConfigs:delete", { id: sceneConfig.id }); selectedSceneId = undefined }
	}
	function handleSceneReset() { sceneConfig = { ...sceneOriginal } }
	function handleSceneNew() { showNewNameModal = true }

	// ── New-name modal dispatch ───────────────────────────────────────────────
	function handleNewNameConfirm(name: string) {
		if (!name.trim()) return
		if (view === "chat") {
			const { id: _id, ...rest } = chatConfig
			socket.emit("promptConfigs:create", { promptConfig: { ...rest, name: name.trim(), isImmutable: false } })
		} else if (view === "chatWorld") {
			const { id: _id, ...rest } = chatWorldConfig
			socket.emit("chatWorldPromptConfigs:create", { chatWorldPromptConfig: { ...rest, name: name.trim(), isImmutable: false } })
		} else if (view === "world") {
			const { id: _id, ...rest } = worldConfig
			socket.emit("worldSummarizeConfigs:create", { worldSummarizeConfig: { ...rest, name: name.trim(), isImmutable: false } })
		} else if (view === "character") {
			const { id: _id, ...rest } = characterConfig
			socket.emit("characterSummarizeConfigs:create", { characterSummarizeConfig: { ...rest, name: name.trim(), isImmutable: false } })
		} else if (view === "scene") {
			const { id: _id, ...rest } = sceneConfig
			socket.emit("sceneSummarizeConfigs:create", { sceneSummarizeConfig: { ...rest, name: name.trim(), isImmutable: false } })
		}
		showNewNameModal = false
	}
	function handleNewNameCancel() { showNewNameModal = false }

	// ── Reactive: load config when selection changes ──────────────────────────
	$effect(() => { if (selectedChatId) socket.emit("promptConfigs:get", { id: selectedChatId }) })
	$effect(() => { if (selectedChatWorldId) socket.emit("chatWorldPromptConfigs:get", { id: selectedChatWorldId }) })
	$effect(() => { if (selectedWorldId) socket.emit("worldSummarizeConfigs:get", { id: selectedWorldId }) })
	$effect(() => { if (selectedCharacterId) socket.emit("characterSummarizeConfigs:get", { id: selectedCharacterId }) })
	$effect(() => { if (selectedSceneId) socket.emit("sceneSummarizeConfigs:get", { id: selectedSceneId }) })

	// ── Set default actions ────────────────────────────────────────────────────
	function handleChatSetDefault() {
		if (!selectedChatId) return
		socket.emit("promptConfigs:setUserActive", { id: selectedChatId })
	}
	function handleChatWorldSetDefault() {
		if (!selectedChatWorldId) return
		socket.emit("chatWorldPromptConfigs:setUserActive", { id: selectedChatWorldId })
	}
	function handleWorldSetDefault() {
		if (!selectedWorldId) return
		socket.emit("worldSummarizeConfigs:setUserActive", { id: selectedWorldId })
	}
	function handleCharacterSetDefault() {
		if (!selectedCharacterId) return
		socket.emit("characterSummarizeConfigs:setUserActive", { id: selectedCharacterId })
	}
	function handleSceneSetDefault() {
		if (!selectedSceneId) return
		socket.emit("sceneSummarizeConfigs:setUserActive", { id: selectedSceneId })
	}

	onMount(() => {
		// Chat listeners
		socket.on("promptConfigs:list", (msg: Sockets.PromptConfigs.List.Response) => {
			chatList = msg.promptConfigsList
			if (!selectedChatId && chatList.length > 0) {
				selectedChatId = userSettingsCtx.settings?.activePromptConfigId ?? chatList[0].id
			}
		})
		socket.on("promptConfigs:get", (msg: Sockets.PromptConfigs.Get.Response) => {
			if (msg.promptConfig.id !== selectedChatId) return
			chatConfig = { ...msg.promptConfig }; chatOriginal = { ...msg.promptConfig }
		})
		socket.on("promptConfigs:create", (msg: Sockets.PromptConfigs.Create.Response) => {
			selectedChatId = msg.promptConfig.id
		})
		socket.on("promptConfigs:update", (msg: Sockets.PromptConfigs.Update.Response) => {
			if (msg.promptConfig.id === chatConfig.id) {
				chatConfig = { ...msg.promptConfig }; chatOriginal = { ...msg.promptConfig }
				toaster.success({ title: "Prompt Config Updated" })
			}
		})

		// Chat World listeners
		socket.on("chatWorldPromptConfigs:list", (msg: Sockets.ChatWorldPromptConfigs.List.Response) => {
			chatWorldList = msg.chatWorldPromptConfigsList
			if (!selectedChatWorldId && chatWorldList.length > 0) {
				selectedChatWorldId = (userSettingsCtx.settings as any)?.activeChatWorldPromptConfigId ?? chatWorldList[0].id
			}
		})
		socket.on("chatWorldPromptConfigs:get", (msg: Sockets.ChatWorldPromptConfigs.Get.Response) => {
			if (msg.chatWorldPromptConfig.id !== selectedChatWorldId) return
			chatWorldConfig = { ...msg.chatWorldPromptConfig }; chatWorldOriginal = { ...msg.chatWorldPromptConfig }
		})
		socket.on("chatWorldPromptConfigs:create", (msg: Sockets.ChatWorldPromptConfigs.Create.Response) => {
			selectedChatWorldId = msg.chatWorldPromptConfig.id
		})
		socket.on("chatWorldPromptConfigs:update", (msg: Sockets.ChatWorldPromptConfigs.Update.Response) => {
			if (msg.chatWorldPromptConfig.id === chatWorldConfig.id) {
				chatWorldConfig = { ...msg.chatWorldPromptConfig }; chatWorldOriginal = { ...msg.chatWorldPromptConfig }
				toaster.success({ title: "World Prompt Config Updated" })
			}
		})

		// World listeners
		socket.on("worldSummarizeConfigs:list", (msg: Sockets.WorldSummarizeConfigs.List.Response) => {
			worldList = msg.worldSummarizeConfigsList
			if (!selectedWorldId && worldList.length > 0) {
				selectedWorldId = (userSettingsCtx.settings as any)?.activeSummarizeWorldConfigId ?? worldList[0].id
			}
		})
		socket.on("worldSummarizeConfigs:get", (msg: Sockets.WorldSummarizeConfigs.Get.Response) => {
			if (msg.worldSummarizeConfig.id !== selectedWorldId) return
			worldConfig = { ...msg.worldSummarizeConfig }; worldOriginal = { ...msg.worldSummarizeConfig }
		})
		socket.on("worldSummarizeConfigs:create", (msg: Sockets.WorldSummarizeConfigs.Create.Response) => {
			selectedWorldId = msg.worldSummarizeConfig.id
		})
		socket.on("worldSummarizeConfigs:update", (msg: Sockets.WorldSummarizeConfigs.Update.Response) => {
			if (msg.worldSummarizeConfig.id === worldConfig.id) {
				worldConfig = { ...msg.worldSummarizeConfig }; worldOriginal = { ...msg.worldSummarizeConfig }
				toaster.success({ title: "World Summarize Config Updated" })
			}
		})

		// Character listeners
		socket.on("characterSummarizeConfigs:list", (msg: Sockets.CharacterSummarizeConfigs.List.Response) => {
			characterList = msg.characterSummarizeConfigsList
			if (!selectedCharacterId && characterList.length > 0) {
				selectedCharacterId = (userSettingsCtx.settings as any)?.activeSummarizeCharacterConfigId ?? characterList[0].id
			}
		})
		socket.on("characterSummarizeConfigs:get", (msg: Sockets.CharacterSummarizeConfigs.Get.Response) => {
			if (msg.characterSummarizeConfig.id !== selectedCharacterId) return
			characterConfig = { ...msg.characterSummarizeConfig }; characterOriginal = { ...msg.characterSummarizeConfig }
		})
		socket.on("characterSummarizeConfigs:create", (msg: Sockets.CharacterSummarizeConfigs.Create.Response) => {
			selectedCharacterId = msg.characterSummarizeConfig.id
		})
		socket.on("characterSummarizeConfigs:update", (msg: Sockets.CharacterSummarizeConfigs.Update.Response) => {
			if (msg.characterSummarizeConfig.id === characterConfig.id) {
				characterConfig = { ...msg.characterSummarizeConfig }; characterOriginal = { ...msg.characterSummarizeConfig }
				toaster.success({ title: "Character Summarize Config Updated" })
			}
		})

		// Scene listeners
		socket.on("sceneSummarizeConfigs:list", (msg: Sockets.SceneSummarizeConfigs.List.Response) => {
			sceneList = msg.sceneSummarizeConfigsList
			if (!selectedSceneId && sceneList.length > 0) {
				selectedSceneId = (userSettingsCtx.settings as any)?.activeSummarizeSceneConfigId ?? sceneList[0].id
			}
		})
		socket.on("sceneSummarizeConfigs:get", (msg: Sockets.SceneSummarizeConfigs.Get.Response) => {
			if (msg.sceneSummarizeConfig.id !== selectedSceneId) return
			sceneConfig = { ...msg.sceneSummarizeConfig }; sceneOriginal = { ...msg.sceneSummarizeConfig }
		})
		socket.on("sceneSummarizeConfigs:create", (msg: Sockets.SceneSummarizeConfigs.Create.Response) => {
			selectedSceneId = msg.sceneSummarizeConfig.id
		})
		socket.on("sceneSummarizeConfigs:update", (msg: Sockets.SceneSummarizeConfigs.Update.Response) => {
			if (msg.sceneSummarizeConfig.id === sceneConfig.id) {
				sceneConfig = { ...msg.sceneSummarizeConfig }; sceneOriginal = { ...msg.sceneSummarizeConfig }
				toaster.success({ title: "Scene Summarize Config Updated" })
			}
		})

		// Set-default response listeners (just toast — userSettings:get updates context)
		socket.on("promptConfigs:setUserActive", () => {
			toaster.success({ title: "Default chat prompt updated" })
		})
		socket.on("promptConfigs:setUserActive:error", (msg: any) => {
			toaster.error({ title: msg?.error || "Failed to set default chat prompt" })
		})
		socket.on("chatWorldPromptConfigs:setUserActive", () => {
			toaster.success({ title: "Default World Response prompt updated" })
		})
		socket.on("chatWorldPromptConfigs:setUserActive:error", (msg: any) => {
			toaster.error({ title: msg?.error || "Failed to set default World Response prompt" })
		})
		socket.on("worldSummarizeConfigs:setUserActive", () => {
			toaster.success({ title: "Default world summarization updated" })
		})
		socket.on("characterSummarizeConfigs:setUserActive", () => {
			toaster.success({ title: "Default character summarization updated" })
		})
		socket.on("sceneSummarizeConfigs:setUserActive", () => {
			toaster.success({ title: "Default scene summarization updated" })
		})

		// Connection / sampling lists for override pickers
		socket.on("connections:list", (msg: Sockets.Connections.List.Response) => {
			connectionsList = msg.connectionsList
		})
		socket.on("samplingConfigs:list", (msg: Sockets.SamplingConfigs.List.Response) => {
			samplingList = msg.samplingConfigsList
		})

		// Initial fetches
		socket.emit("promptConfigs:list", {})
		socket.emit("chatWorldPromptConfigs:list", {})
		socket.emit("worldSummarizeConfigs:list", {})
		socket.emit("characterSummarizeConfigs:list", {})
		socket.emit("sceneSummarizeConfigs:list", {})
		socket.emit("connections:list", {})
		socket.emit("samplingConfigs:list", {})

		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("connections:list")
		socket.off("samplingConfigs:list")
		socket.off("promptConfigs:list")
		socket.off("promptConfigs:get")
		socket.off("promptConfigs:create")
		socket.off("promptConfigs:update")
		socket.off("promptConfigs:setUserActive")
		socket.off("chatWorldPromptConfigs:list")
		socket.off("chatWorldPromptConfigs:get")
		socket.off("chatWorldPromptConfigs:create")
		socket.off("chatWorldPromptConfigs:update")
		socket.off("chatWorldPromptConfigs:setUserActive")
		socket.off("worldSummarizeConfigs:list")
		socket.off("worldSummarizeConfigs:get")
		socket.off("worldSummarizeConfigs:create")
		socket.off("worldSummarizeConfigs:update")
		socket.off("worldSummarizeConfigs:setUserActive")
		socket.off("characterSummarizeConfigs:list")
		socket.off("characterSummarizeConfigs:get")
		socket.off("characterSummarizeConfigs:create")
		socket.off("characterSummarizeConfigs:update")
		socket.off("characterSummarizeConfigs:setUserActive")
		socket.off("sceneSummarizeConfigs:list")
		socket.off("sceneSummarizeConfigs:get")
		socket.off("sceneSummarizeConfigs:create")
		socket.off("sceneSummarizeConfigs:update")
		socket.off("sceneSummarizeConfigs:setUserActive")
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
				<div class="bg-primary-500/10 text-primary-500 mt-0.5 rounded-lg p-2 shrink-0">
					<Icons.MessageSquareText size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">Chat Prompts: Character</span>
						<Icons.ChevronRight size={16} class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">System instructions injected into every chat.</p>
					{#if activeChatName}
						<div class="mt-2 flex items-center gap-1.5">
							<Icons.CheckCircle size={12} class="text-success-500 shrink-0" />
							<span class="text-success-600 dark:text-success-400 truncate text-xs font-medium">{activeChatName}</span>
						</div>
					{/if}
				</div>
			</div>
		</button>

		<!-- Chat Prompts: World card -->
		<button
			class="card preset-tonal hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
			onclick={() => (view = "chatWorld")}
		>
			<div class="flex items-start gap-3">
				<div class="bg-primary-500/10 text-primary-500 mt-0.5 rounded-lg p-2 shrink-0">
					<Icons.CloudSun size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">Chat Prompts: World</span>
						<Icons.ChevronRight size={16} class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">System instructions for manually-triggered World Response narration.</p>
					{#if activeChatWorldName}
						<div class="mt-2 flex items-center gap-1.5">
							<Icons.CheckCircle size={12} class="text-success-500 shrink-0" />
							<span class="text-success-600 dark:text-success-400 truncate text-xs font-medium">{activeChatWorldName}</span>
						</div>
					{/if}
				</div>
			</div>
		</button>

		<!-- Summarize type cards — only shown when summarization is enabled -->
		{#if systemSettingsCtx.settings?.summarizationEnabled}
			{#each [
				{ v: "world" as const, label: "World Lore Summarization", desc: "System instructions for world lore summarization.", icon: Icons.Globe, activeName: activeWorldName },
				{ v: "character" as const, label: "Character Lore Summarization", desc: "System instructions for character lore summarization.", icon: Icons.User, activeName: activeCharacterName },
				{ v: "scene" as const, label: "Scene Summarization", desc: "System instructions for scene summarization.", icon: Icons.Film, activeName: activeSceneName }
			] as card}
				<button
					class="card preset-tonal hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
					onclick={() => (view = card.v)}
				>
					<div class="flex items-start gap-3">
						<div class="bg-primary-500/10 text-primary-500 mt-0.5 rounded-lg p-2 shrink-0">
							<card.icon size={20} />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between gap-2">
								<span class="font-semibold">{card.label}</span>
								<Icons.ChevronRight size={16} class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
							</div>
							<p class="text-muted-foreground mt-0.5 text-sm">{card.desc}</p>
							{#if card.activeName}
								<div class="mt-2 flex items-center gap-1.5">
									<Icons.CheckCircle size={12} class="text-success-500 shrink-0" />
									<span class="text-success-600 dark:text-success-400 truncate text-xs font-medium">{card.activeName}</span>
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
		<div class="border-b border-surface-200-800 px-4 py-3">
			<div class="flex items-center gap-2">
				<button class="btn btn-sm preset-filled-surface-400-600 p-2" onclick={navigateBack} title="Back" aria-label="Back to prompt types">
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">Chat Prompts: Character</h2>
			</div>
			<div class="mt-2 flex gap-2" role="toolbar" aria-label="Chat prompt config actions">
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleChatNew} title="Clone to new config"><Icons.Plus size={14} /> Clone</button>
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleChatReset} disabled={!chatUnsaved} title="Discard changes"><Icons.RefreshCcw size={14} /> Discard</button>
				<button type="button" class="btn btn-sm preset-tonal-error" onclick={handleChatDelete} disabled={!chatConfig || chatConfig.isImmutable} title="Delete config"><Icons.Trash2 size={14} /> Delete</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select class="select w-full" value={selectedChatId} onchange={handleChatSelectChange}>
					{#each chatList.filter((c) => c.isImmutable) as c}
						{@const isDefault = c.id === userSettingsCtx.settings?.activePromptConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name} *</option>
					{/each}
					{#each chatList.filter((c) => !c.isImmutable) as c}
						{@const isDefault = c.id === userSettingsCtx.settings?.activePromptConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name}</option>
					{/each}
				</select>
			</div>
			{#if chatConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button class="btn btn-sm preset-filled-success-500 flex-1" onclick={handleChatSave} disabled={!chatUnsaved}>
							<Icons.Save size={14} /> Update
						</button>
						<button class="btn btn-sm preset-filled-warning-500 shrink-0" onclick={handleChatSetDefault}
							disabled={!selectedChatId || selectedChatId === userSettingsCtx.settings?.activePromptConfigId}
							title={selectedChatId && selectedChatId === userSettingsCtx.settings?.activePromptConfigId ? "Already the default" : "Set as default"}>
							<Icons.Star size={14} /> Set Default
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="chatName">Name *</label>
						<input id="chatName" type="text" bind:value={chatConfig.name} class="input w-full {validationErrors.name ? 'border-error-500' : ''}" disabled={chatConfig.isImmutable}
							oninput={() => { if (validationErrors.name) { const { name, ...rest } = validationErrors; validationErrors = rest } }} />
						{#if validationErrors.name}<p class="text-error-500 text-sm" role="alert">{validationErrors.name}</p>{/if}
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="chatSystemPrompt">System Instructions</label>
						<textarea id="chatSystemPrompt" rows="15" bind:value={chatConfig.systemPrompt} class="textarea w-full" disabled={chatConfig.isImmutable}></textarea>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<p class="text-sm font-semibold">AI Override</p>
						<p class="text-muted-foreground text-xs">Overrides the system default connection and sampling for this template.</p>
						<ConnectionSamplingPicker
							{connectionsList}
							samplingList={samplingList}
							bind:connectionId={chatConfig.connectionId}
							bind:samplingConfigId={chatConfig.samplingConfigId}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

<!-- ── CHAT PROMPTS: WORLD EDITOR ─────────────────────────────────────────── -->
{:else if view === "chatWorld"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-b border-surface-200-800 px-4 py-3">
			<div class="flex items-center gap-2">
				<button class="btn btn-sm preset-filled-surface-400-600 p-2" onclick={navigateBack} title="Back" aria-label="Back to prompt types">
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">Chat Prompts: World</h2>
			</div>
			<div class="mt-2 flex gap-2" role="toolbar" aria-label="World prompt config actions">
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleChatWorldNew} title="Clone to new config"><Icons.Plus size={14} /> Clone</button>
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleChatWorldReset} disabled={!chatWorldUnsaved} title="Discard changes"><Icons.RefreshCcw size={14} /> Discard</button>
				<button type="button" class="btn btn-sm preset-tonal-error" onclick={handleChatWorldDelete} disabled={!chatWorldConfig || chatWorldConfig.isImmutable} title="Delete config"><Icons.Trash2 size={14} /> Delete</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select class="select w-full" value={selectedChatWorldId} onchange={handleChatWorldSelectChange}>
					{#each chatWorldList.filter((c) => c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeChatWorldPromptConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name} *</option>
					{/each}
					{#each chatWorldList.filter((c) => !c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeChatWorldPromptConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name}</option>
					{/each}
				</select>
			</div>
			{#if chatWorldConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button class="btn btn-sm preset-filled-success-500 flex-1" onclick={handleChatWorldSave} disabled={!chatWorldUnsaved}>
							<Icons.Save size={14} /> Update
						</button>
						<button class="btn btn-sm preset-filled-warning-500 shrink-0" onclick={handleChatWorldSetDefault}
							disabled={!selectedChatWorldId || selectedChatWorldId === (userSettingsCtx.settings as any)?.activeChatWorldPromptConfigId}
							title={selectedChatWorldId && selectedChatWorldId === (userSettingsCtx.settings as any)?.activeChatWorldPromptConfigId ? "Already the default" : "Set as default"}>
							<Icons.Star size={14} /> Set Default
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="chatWorldName">Name *</label>
						<input id="chatWorldName" type="text" bind:value={chatWorldConfig.name} class="input w-full {validationErrors.name ? 'border-error-500' : ''}" disabled={chatWorldConfig.isImmutable}
							oninput={() => { if (validationErrors.name) { const { name, ...rest } = validationErrors; validationErrors = rest } }} />
						{#if validationErrors.name}<p class="text-error-500 text-sm" role="alert">{validationErrors.name}</p>{/if}
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="chatWorldNarratorName">Display Name</label>
						<p class="text-muted-foreground text-xs">Shown in the chat instead of "The World" (e.g. "The Narrator", "Fate") when a message is generated with this config.</p>
						<input id="chatWorldNarratorName" type="text" bind:value={chatWorldConfig.narratorName} class="input w-full" disabled={chatWorldConfig.isImmutable} placeholder="The World" />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="chatWorldSystemPrompt">System Instructions</label>
						<p class="text-muted-foreground text-xs">Used when "The World" is manually triggered to narrate the environment, atmosphere, or side characters instead of a chat character.</p>
						<textarea id="chatWorldSystemPrompt" rows="15" bind:value={chatWorldConfig.systemPrompt} class="textarea w-full" disabled={chatWorldConfig.isImmutable}></textarea>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<p class="text-sm font-semibold">AI Override</p>
						<p class="text-muted-foreground text-xs">Overrides the system default connection and sampling for this template.</p>
						<ConnectionSamplingPicker
							{connectionsList}
							samplingList={samplingList}
							bind:connectionId={chatWorldConfig.connectionId}
							bind:samplingConfigId={chatWorldConfig.samplingConfigId}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

<!-- ── WORLD LORE SUMMARIZE EDITOR ───────────────────────────────────────── -->
{:else if view === "world"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-b border-surface-200-800 px-4 py-3">
			<div class="flex items-center gap-2">
				<button class="btn btn-sm preset-filled-surface-400-600 p-2" onclick={navigateBack} title="Back" aria-label="Back to prompt types">
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">World Lore Summarization</h2>
			</div>
			<div class="mt-2 flex gap-2" role="toolbar" aria-label="World lore summarization config actions">
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleWorldNew} title="Clone to new config"><Icons.Plus size={14} /> Clone</button>
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleWorldReset} disabled={!worldUnsaved} title="Discard changes"><Icons.RefreshCcw size={14} /> Discard</button>
				<button type="button" class="btn btn-sm preset-tonal-error" onclick={handleWorldDelete} disabled={!worldConfig || worldConfig.isImmutable} title="Delete config"><Icons.Trash2 size={14} /> Delete</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select class="select w-full" value={selectedWorldId} onchange={handleWorldSelectChange}>
					{#each worldList.filter((c) => c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeSummarizeWorldConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name} *</option>
					{/each}
					{#each worldList.filter((c) => !c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeSummarizeWorldConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name}</option>
					{/each}
				</select>
			</div>
			{#if worldConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button class="btn btn-sm preset-filled-success-500 flex-1" onclick={handleWorldSave} disabled={!worldUnsaved}>
							<Icons.Save size={14} /> Update
						</button>
						<button class="btn btn-sm preset-filled-warning-500 shrink-0" onclick={handleWorldSetDefault}
							disabled={!selectedWorldId || selectedWorldId === (userSettingsCtx.settings as any)?.activeSummarizeWorldConfigId}
							title={selectedWorldId && selectedWorldId === (userSettingsCtx.settings as any)?.activeSummarizeWorldConfigId ? "Already the default" : "Set as default"}>
							<Icons.Star size={14} /> Set Default
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="worldName">Name *</label>
						<input id="worldName" type="text" bind:value={worldConfig.name} class="input w-full {validationErrors.name ? 'border-error-500' : ''}" disabled={worldConfig.isImmutable}
							oninput={() => { if (validationErrors.name) { const { name, ...rest } = validationErrors; validationErrors = rest } }} />
						{#if validationErrors.name}<p class="text-error-500 text-sm" role="alert">{validationErrors.name}</p>{/if}
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="worldBatch">Batch Instructions</label>
						<p class="text-muted-foreground text-xs">Used during the drafting phase (per batch of messages).</p>
						<textarea id="worldBatch" rows="8" bind:value={worldConfig.batchSystemPrompt} class="textarea w-full" disabled={worldConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={worldConfig.batchConnectionId}
							bind:samplingConfigId={worldConfig.batchSamplingConfigId}
						/>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="worldSynth">Synthesis Instructions</label>
						<p class="text-muted-foreground text-xs">Used during the synthesis phase (merging all drafts).</p>
						<textarea id="worldSynth" rows="8" bind:value={worldConfig.synthSystemPrompt} class="textarea w-full" disabled={worldConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={worldConfig.synthConnectionId}
							bind:samplingConfigId={worldConfig.synthSamplingConfigId}
						/>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="worldName2">Title Generation Instructions</label>
						<p class="text-muted-foreground text-xs">Used when generating a title for the entry.</p>
						<textarea id="worldName2" rows="4" bind:value={worldConfig.nameSystemPrompt} class="textarea w-full" disabled={worldConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={worldConfig.nameConnectionId}
							bind:samplingConfigId={worldConfig.nameSamplingConfigId}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

<!-- ── CHARACTER LORE SUMMARIZE EDITOR ───────────────────────────────────── -->
{:else if view === "character"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-b border-surface-200-800 px-4 py-3">
			<div class="flex items-center gap-2">
				<button class="btn btn-sm preset-filled-surface-400-600 p-2" onclick={navigateBack} title="Back" aria-label="Back to prompt types">
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">Character Lore Summarization</h2>
			</div>
			<div class="mt-2 flex gap-2" role="toolbar" aria-label="Character lore summarization config actions">
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleCharacterNew} title="Clone to new config"><Icons.Plus size={14} /> Clone</button>
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleCharacterReset} disabled={!characterUnsaved} title="Discard changes"><Icons.RefreshCcw size={14} /> Discard</button>
				<button type="button" class="btn btn-sm preset-tonal-error" onclick={handleCharacterDelete} disabled={!characterConfig || characterConfig.isImmutable} title="Delete config"><Icons.Trash2 size={14} /> Delete</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select class="select w-full" value={selectedCharacterId} onchange={handleCharacterSelectChange}>
					{#each characterList.filter((c) => c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeSummarizeCharacterConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name} *</option>
					{/each}
					{#each characterList.filter((c) => !c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeSummarizeCharacterConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name}</option>
					{/each}
				</select>
			</div>
			{#if characterConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button class="btn btn-sm preset-filled-success-500 flex-1" onclick={handleCharacterSave} disabled={!characterUnsaved}>
							<Icons.Save size={14} /> Update
						</button>
						<button class="btn btn-sm preset-filled-warning-500 shrink-0" onclick={handleCharacterSetDefault}
							disabled={!selectedCharacterId || selectedCharacterId === (userSettingsCtx.settings as any)?.activeSummarizeCharacterConfigId}
							title={selectedCharacterId && selectedCharacterId === (userSettingsCtx.settings as any)?.activeSummarizeCharacterConfigId ? "Already the default" : "Set as default"}>
							<Icons.Star size={14} /> Set Default
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="charName">Name *</label>
						<input id="charName" type="text" bind:value={characterConfig.name} class="input w-full {validationErrors.name ? 'border-error-500' : ''}" disabled={characterConfig.isImmutable}
							oninput={() => { if (validationErrors.name) { const { name, ...rest } = validationErrors; validationErrors = rest } }} />
						{#if validationErrors.name}<p class="text-error-500 text-sm" role="alert">{validationErrors.name}</p>{/if}
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="charBatch">Batch Instructions</label>
						<p class="text-muted-foreground text-xs">Used during the drafting phase (per batch of messages).</p>
						<textarea id="charBatch" rows="8" bind:value={characterConfig.batchSystemPrompt} class="textarea w-full" disabled={characterConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={characterConfig.batchConnectionId}
							bind:samplingConfigId={characterConfig.batchSamplingConfigId}
						/>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="charSynth">Synthesis Instructions</label>
						<p class="text-muted-foreground text-xs">Used during the synthesis phase (merging all drafts).</p>
						<textarea id="charSynth" rows="8" bind:value={characterConfig.synthSystemPrompt} class="textarea w-full" disabled={characterConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={characterConfig.synthConnectionId}
							bind:samplingConfigId={characterConfig.synthSamplingConfigId}
						/>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="charName2">Title Generation Instructions</label>
						<p class="text-muted-foreground text-xs">Used when generating a title for the entry.</p>
						<textarea id="charName2" rows="4" bind:value={characterConfig.nameSystemPrompt} class="textarea w-full" disabled={characterConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={characterConfig.nameConnectionId}
							bind:samplingConfigId={characterConfig.nameSamplingConfigId}
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

<!-- ── SCENE SUMMARIZE EDITOR ─────────────────────────────────────────────── -->
{:else if view === "scene"}
	<div class="text-foreground flex h-full flex-col">
		<div class="border-b border-surface-200-800 px-4 py-3">
			<div class="flex items-center gap-2">
				<button class="btn btn-sm preset-filled-surface-400-600 p-2" onclick={navigateBack} title="Back" aria-label="Back to prompt types">
					<Icons.ChevronLeft size={16} />
				</button>
				<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">Scene Summarization</h2>
			</div>
			<div class="mt-2 flex gap-2" role="toolbar" aria-label="Scene summarization config actions">
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleSceneNew} title="Clone to new config"><Icons.Plus size={14} /> Clone</button>
				<button type="button" class="btn btn-sm preset-filled-surface-400-600" onclick={handleSceneReset} disabled={!sceneUnsaved} title="Discard changes"><Icons.RefreshCcw size={14} /> Discard</button>
				<button type="button" class="btn btn-sm preset-tonal-error" onclick={handleSceneDelete} disabled={!sceneConfig || sceneConfig.isImmutable} title="Delete config"><Icons.Trash2 size={14} /> Delete</button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mb-4">
				<select class="select w-full" value={selectedSceneId} onchange={handleSceneSelectChange}>
					{#each sceneList.filter((c) => c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeSummarizeSceneConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name} *</option>
					{/each}
					{#each sceneList.filter((c) => !c.isImmutable) as c}
						{@const isDefault = c.id === (userSettingsCtx.settings as any)?.activeSummarizeSceneConfigId}
						<option value={c.id}>{isDefault ? "★ " : ""}{c.name}</option>
					{/each}
				</select>
			</div>
			{#if sceneConfig?.id}
				<div class="flex flex-col gap-4">
					<div class="flex gap-2">
						<button class="btn btn-sm preset-filled-success-500 flex-1" onclick={handleSceneSave} disabled={!sceneUnsaved}>
							<Icons.Save size={14} /> Update
						</button>
						<button class="btn btn-sm preset-filled-warning-500 shrink-0" onclick={handleSceneSetDefault}
							disabled={!selectedSceneId || selectedSceneId === (userSettingsCtx.settings as any)?.activeSummarizeSceneConfigId}
							title={selectedSceneId && selectedSceneId === (userSettingsCtx.settings as any)?.activeSummarizeSceneConfigId ? "Already the default" : "Set as default"}>
							<Icons.Star size={14} /> Set Default
						</button>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-semibold" for="sceneName">Name *</label>
						<input id="sceneName" type="text" bind:value={sceneConfig.name} class="input w-full {validationErrors.name ? 'border-error-500' : ''}" disabled={sceneConfig.isImmutable}
							oninput={() => { if (validationErrors.name) { const { name, ...rest } = validationErrors; validationErrors = rest } }} />
						{#if validationErrors.name}<p class="text-error-500 text-sm" role="alert">{validationErrors.name}</p>{/if}
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="sceneBatch">Batch Instructions</label>
						<p class="text-muted-foreground text-xs">Used during the drafting phase (per batch of messages).</p>
						<textarea id="sceneBatch" rows="8" bind:value={sceneConfig.batchSystemPrompt} class="textarea w-full" disabled={sceneConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={sceneConfig.batchConnectionId}
							bind:samplingConfigId={sceneConfig.batchSamplingConfigId}
						/>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="sceneSynth">Synthesis Instructions</label>
						<p class="text-muted-foreground text-xs">Used during the synthesis phase (merging all drafts).</p>
						<textarea id="sceneSynth" rows="8" bind:value={sceneConfig.synthSystemPrompt} class="textarea w-full" disabled={sceneConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={sceneConfig.synthConnectionId}
							bind:samplingConfigId={sceneConfig.synthSamplingConfigId}
						/>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="sceneName2">Title Generation Instructions</label>
						<p class="text-muted-foreground text-xs">Used when generating a title for the entry.</p>
						<textarea id="sceneName2" rows="4" bind:value={sceneConfig.nameSystemPrompt} class="textarea w-full" disabled={sceneConfig.isImmutable}></textarea>
						<p class="text-muted-foreground mt-1 text-xs font-medium">AI Override</p>
						<ConnectionSamplingPicker
							connectionsList={connectionsList}
							samplingList={samplingList}
							bind:connectionId={sceneConfig.nameConnectionId}
							bind:samplingConfigId={sceneConfig.nameSamplingConfigId}
						/>
					</div>
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-3">
						<label class="text-sm font-semibold" for="sceneCharacterExtraction">Character Extraction Instructions</label>
						<p class="text-muted-foreground text-xs">Used when extracting participant and mentioned characters from the scene summary.</p>
						<textarea id="sceneCharacterExtraction" rows="6" bind:value={sceneConfig.characterExtractionSystemPrompt} class="textarea w-full" disabled={sceneConfig.isImmutable}></textarea>
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
	title={view === "chat" ? "New Prompt Config" : view === "chatWorld" ? "New World Prompt Config" : view === "world" ? "New World Lore Summarization Config" : view === "character" ? "New Character Lore Summarization Config" : "New Scene Summarization Config"}
	description="Your current settings will be copied."
/>
