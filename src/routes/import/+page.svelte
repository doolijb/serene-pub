<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { goto } from "$app/navigation"
	import { getContext } from "svelte"
	import {
		resolvePickedFolder,
		startImportSession,
		stageFilesToServer,
		type FolderPickResult
	} from "$lib/client/utils/sillyTavernFolderImport"

	const userCtx: UserCtx = getContext("userCtx")
	const socket = useTypedSocket()

	if (!userCtx.user?.isAdmin) goto("/")

	// Navigation back to settings
	function goBack() {
		goto("/")
	}

	function importAnother() {
		importComplete = null
	}

	// State
	let folderInputEl: HTMLInputElement | undefined = $state()
	let pickedFolder = $state<FolderPickResult | null>(null)
	let importSessionId = $state<string | null>(null)
	let uploadProgress = $state<{ staged: number; total: number } | null>(null)
	let isScanning = $state(false)
	let isImporting = $state(false)
	let scanResults = $state<{
		characters: Array<{
			filename: string
			name: string
			selected: boolean
			disabled?: boolean
		}>
		personas: Array<{ name: string; selected: boolean; disabled?: boolean }>
		chats: Array<{
			filename: string
			name: string
			characterNames: string[]
			isGroup: boolean
			selected: boolean
			disabled: boolean
			disabledReason?: string
		}>
		groupChats: Array<{
			filename: string
			name: string
			memberNames: string[]
			selected: boolean
			disabled: boolean
			disabledReason?: string
		}>
		lorebooks: Array<{
			filename: string
			name: string
			selected: boolean
			disabled?: boolean
		}>
	} | null>(null)
	let confirmImport = $state(false)
	let importComplete = $state<{ message: string; errors?: string[] } | null>(
		null
	)

	function triggerFolderPicker() {
		folderInputEl?.click()
	}

	function handleFolderSelected(e: Event) {
		const files = (e.target as HTMLInputElement).files
		if (!files || files.length === 0) return

		const result = resolvePickedFolder(files)
		if (!result || result.files.length === 0) {
			toaster.error({
				title: "No SillyTavern data found",
				description:
					"Couldn't find characters, chats, groups, worlds, or settings.json in the selected folder. Please select your SillyTavern (or SillyTavern-Launcher) folder."
			})
			pickedFolder = null
			;(e.target as HTMLInputElement).value = ""
			return
		}

		pickedFolder = result
		scanResults = null
		importSessionId = null
	}

	let scanTimeout: ReturnType<typeof setTimeout> | null = null
	let importTimeout: ReturnType<typeof setTimeout> | null = null

	// Upload the metadata-bearing subset of the picked folder, then scan it
	async function scanFolder() {
		if (!pickedFolder || !socket) return

		isScanning = true
		scanResults = null
		uploadProgress = null

		try {
			importSessionId = await startImportSession(socket)
			await stageFilesToServer(
				socket,
				importSessionId,
				pickedFolder.scanFiles,
				(staged, total) => (uploadProgress = { staged, total })
			)
			uploadProgress = null
		} catch (error) {
			isScanning = false
			uploadProgress = null
			toaster.error({
				title: "Upload failed",
				description:
					error instanceof Error ? error.message : "Failed to upload files"
			})
			return
		}

		if (scanTimeout) clearTimeout(scanTimeout)
		scanTimeout = setTimeout(() => {
			if (isScanning) {
				isScanning = false
				toaster.error({
					title: "Scan timed out",
					description: "The server did not respond. Please try again."
				})
			}
		}, 30000)

		socket.emit("import:sillytavern:scan", { importSessionId })
	}

	// Toggle individual item selection
	function toggleSelection(
		category:
			| "characters"
			| "personas"
			| "chats"
			| "groupChats"
			| "lorebooks",
		index: number
	) {
		if (!scanResults) return

		const item = scanResults[category][index]
		if (item && !item.disabled) {
			item.selected = !item.selected
			scanResults = { ...scanResults }

			// Re-validate chat dependencies
			validateChatDependencies()
		}
	}

	// Toggle all in category
	function toggleAllInCategory(
		category:
			| "characters"
			| "personas"
			| "chats"
			| "groupChats"
			| "lorebooks"
	) {
		if (!scanResults) return

		const items = scanResults[category]
		const allSelected = items.every(
			(item) => item.selected || item.disabled
		)

		items.forEach((item) => {
			if (!item.disabled) {
				item.selected = !allSelected
			}
		})

		scanResults = { ...scanResults }

		// Re-validate chat dependencies
		if (
			category === "characters" ||
			category === "chats" ||
			category === "groupChats"
		) {
			validateChatDependencies()
		}
	}

	// Validate chat dependencies
	function validateChatDependencies() {
		if (!scanResults) return

		const selectedCharacters = new Set(
			scanResults.characters.filter((c) => c.selected).map((c) => c.name)
		)

		// Validate individual chats
		scanResults.chats.forEach((chat) => {
			const missingCharacters = chat.characterNames.filter(
				(name) => !selectedCharacters.has(name)
			)

			if (missingCharacters.length > 0) {
				chat.disabled = true
				chat.selected = false
				chat.disabledReason = `Missing character(s): ${missingCharacters.join(", ")}`
			} else {
				chat.disabled = false
				chat.disabledReason = undefined
			}
		})

		// Validate group chats
		scanResults.groupChats.forEach((chat) => {
			const missingCharacters = chat.memberNames.filter(
				(name) => !selectedCharacters.has(name)
			)

			if (missingCharacters.length > 0) {
				chat.disabled = true
				chat.selected = false
				chat.disabledReason = `Missing character(s): ${missingCharacters.join(", ")}`
			} else {
				chat.disabled = false
				chat.disabledReason = undefined
			}
		})

		scanResults = { ...scanResults }
	}

	// Import data
	async function importData() {
		if (!scanResults || !confirmImport || !pickedFolder || !importSessionId || !socket) {
			return
		}

		isImporting = true
		uploadProgress = null

		const selectedData = {
			characters: scanResults.characters.filter((c) => c.selected),
			personas: scanResults.personas.filter((p) => p.selected),
			chats: scanResults.chats.filter((c) => c.selected),
			groupChats: scanResults.groupChats.filter((g) => g.selected),
			lorebooks: scanResults.lorebooks.filter((l) => l.selected)
		}

		// Only now upload chat history — individual chats the user selected,
		// plus all group chat history if any group chat is selected (mapping
		// a selected group to its exact history filename requires re-parsing
		// its JSON, so we just upload the whole small "group chats/" set).
		const selectedChatPaths = new Set(
			selectedData.chats.map((c) => `chats/${c.filename}`)
		)
		const wantsGroupChatHistory = selectedData.groupChats.length > 0
		const filesToUpload = pickedFolder.deferredFiles.filter(
			(f) =>
				selectedChatPaths.has(f.relativePath) ||
				(wantsGroupChatHistory && f.relativePath.startsWith("group chats/"))
		)

		try {
			await stageFilesToServer(
				socket,
				importSessionId,
				filesToUpload,
				(staged, total) => (uploadProgress = { staged, total })
			)
			uploadProgress = null
		} catch (error) {
			isImporting = false
			uploadProgress = null
			toaster.error({
				title: "Upload failed",
				description:
					error instanceof Error ? error.message : "Failed to upload files"
			})
			return
		}

		if (importTimeout) clearTimeout(importTimeout)
		importTimeout = setTimeout(() => {
			if (isImporting) {
				isImporting = false
				toaster.error({
					title: "Import timed out",
					description: "The server did not respond. Please try again."
				})
			}
		}, 300000)

		socket.emit("import:sillytavern:execute", {
			importSessionId,
			selectedData
		})
	}

	// Socket listeners
	socket.on("import:sillytavern:scan", (message) => {
		isScanning = false
		if (scanTimeout) { clearTimeout(scanTimeout); scanTimeout = null }

		if (message.success && message.data) {
			scanResults = message.data
			const total =
				message.data.characters.length +
				message.data.personas.length +
				message.data.chats.length +
				message.data.groupChats.length +
				message.data.lorebooks.length
			if (total === 0) {
				toaster.warning({
					title: "Nothing found",
					description: "The directory was found but contained no importable data. Make sure you're pointing at your SillyTavern root (or SillyTavern-Launcher) folder."
				})
			} else {
				toaster.success({
					title: "Scan completed",
					description: `Found ${message.data.characters.length} characters, ${message.data.personas.length} personas, ${message.data.chats.length + message.data.groupChats.length} chats, ${message.data.lorebooks.length} lorebooks`
				})
			}
		} else {
			toaster.error({
				title: "Scan failed",
				description: message.error || "Failed to scan directory"
			})
		}
	})

	socket.on("import:sillytavern:execute", (message) => {
		isImporting = false
		if (importTimeout) { clearTimeout(importTimeout); importTimeout = null }

		if (message.success) {
			toaster.success({
				title: "Import completed",
				description: message.message || "Data imported successfully"
			})
			importComplete = {
				message: message.message || "Data imported successfully",
				errors: message.errors
			}
			// Reset the picker/scan state so "Import Another" starts fresh
			scanResults = null
			pickedFolder = null
			importSessionId = null
			confirmImport = false
		} else {
			toaster.error({
				title: "Import failed",
				description: message.error || "Failed to import data"
			})
		}
	})
</script>

{#if userCtx.user?.isAdmin}
<div class="container mx-auto max-w-4xl p-6 preset-tonal rounded-lg shadow-md mt-4">
	<!-- Header with Back Button -->
	<div class="mb-6 flex items-center gap-4">
		<button
			type="button"
			class="btn preset-filled-surface-500"
			onclick={goBack}
			aria-label="Go back to home"
		>
			<Icons.ArrowLeft size={20} />
		</button>
		<div class="flex-1">
			<h1 class="text-2xl font-bold">Import from SillyTavern</h1>
			<p class="text-surface-700-300 mt-1 text-sm">
				Import your characters, personas, chats, and lorebooks from
				SillyTavern.
			</p>
		</div>
	</div>

	<div class="flex flex-col gap-6">
		{#if importComplete}
			<!-- Import Complete Confirmation -->
			<div class="rounded p-6 text-center">
				<Icons.CheckCircle size={48} class="text-success-500 mx-auto mb-4" />
				<h2 class="mb-2 text-xl font-bold">Import Complete</h2>
				<p class="text-surface-700-300 mb-4 text-sm">{importComplete.message}</p>
				{#if importComplete.errors?.length}
					<div
						class="bg-warning-200-800 border-warning-500 mb-4 rounded border-l-4 p-3 text-left"
					>
						<p class="mb-1 text-sm font-semibold">
							{importComplete.errors.length} item{importComplete.errors
								.length !== 1
								? "s"
								: ""} had errors:
						</p>
						<ul class="list-inside list-disc space-y-0.5 text-xs">
							{#each importComplete.errors as error}
								<li>{error}</li>
							{/each}
						</ul>
					</div>
				{/if}
				<div class="flex justify-center gap-2">
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={goBack}
					>
						<Icons.ArrowLeft size={16} />
						Back to Settings
					</button>
					<button
						type="button"
						class="btn preset-filled-surface-400-600"
						onclick={importAnother}
					>
						<Icons.FolderOpen size={16} />
						Import Another Folder
					</button>
				</div>
			</div>
		{:else}
		<!-- Important Notes -->
		<div
			class="bg-warning-200-800 border-warning-500 rounded border-l-4 p-4"
		>
			<h3 class="mb-2 flex items-center gap-2 font-semibold">
				<Icons.AlertTriangle size={20} class="text-warning-500" />
				Important Information
			</h3>
			<ul
				class="text-surface-700 dark:text-surface-300 list-inside list-disc space-y-1 text-sm"
			>
				<li>
					<strong>What's imported:</strong>
					Characters, personas, chats (including group chats), and lorebooks
				</li>
				<li>
					<strong>What's NOT imported:</strong>
					Branching narratives/chat trees, chat backgrounds, user avatars,
					extensions data
				</li>
				<li>
					<strong>Chat format:</strong>
					Both individual and group chats are imported into Serene Pub's
					unified chat system
				</li>
				<li>
					<strong>Swipes:</strong>
					Alternative message variations are preserved in metadata
				</li>
			</ul>
		</div>

		<!-- Folder Selection -->
		<div class="flex flex-col gap-2">
			<label class="font-semibold">SillyTavern Folder</label>
			<input
				type="file"
				bind:this={folderInputEl}
				onchange={handleFolderSelected}
				webkitdirectory
				multiple
				class="hidden"
				disabled={isScanning || isImporting}
			/>
			<button
				type="button"
				class="btn preset-tonal-primary w-fit"
				onclick={triggerFolderPicker}
				disabled={isScanning || isImporting}
			>
				<Icons.FolderOpen size={16} />
				{pickedFolder ? "Change Folder" : "Choose SillyTavern Folder"}
			</button>
			{#if pickedFolder}
				<p class="text-success-600-400 text-sm">
					Found {pickedFolder.files.length} relevant file{pickedFolder
						.files.length !== 1
						? "s"
						: ""} ({pickedFolder.scanFiles.length} to scan now, {pickedFolder
						.deferredFiles.length} chat log file{pickedFolder
						.deferredFiles.length !== 1
						? "s"
						: ""} uploaded only for what you select to import)
				</p>
			{/if}
			<p class="text-surface-700-300 text-xs">
				Everything is read by your browser and uploaded — nothing is
				read from the server's filesystem. Select your SillyTavern (or
				SillyTavern-Launcher) folder. Requires a Chromium-based browser
				or a recent version of Firefox.
			</p>

			{#if uploadProgress}
				<div class="bg-surface-200-800 rounded p-2">
					<p class="text-surface-600 dark:text-surface-400 text-xs">
						Uploading files... {uploadProgress.staged}/{uploadProgress.total}
					</p>
					<div
						class="bg-surface-300-700 mt-1 h-1.5 w-full overflow-hidden rounded-full"
					>
						<div
							class="bg-primary-500 h-full transition-all"
							style="width: {(uploadProgress.staged /
								uploadProgress.total) *
								100}%"
						></div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Scan Button -->
		<div>
			<button
				type="button"
				class="btn preset-filled-secondary-500"
				onclick={scanFolder}
				disabled={!pickedFolder || isScanning || isImporting}
			>
				{#if isScanning}
					<Icons.Loader2 size={16} class="animate-spin" />
					{uploadProgress ? "Uploading..." : "Processing..."}
				{:else}
					<Icons.Brain size={16} />
					Process Data
				{/if}
			</button>
		</div>

		<!-- Scan Results -->
		{#if scanResults}
			<div class="bg-surface-200-800 rounded p-4">
				<h3 class="mb-4 text-lg font-semibold">Scan Results</h3>

				<!-- Characters -->
				<div class="mb-6">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="font-semibold">
							Characters ({scanResults.characters.filter(
								(c) => c.selected
							).length}/{scanResults.characters.length})
						</h4>
						<button
							type="button"
							class="btn btn-sm preset-tonal-primary-500"
							onclick={() => toggleAllInCategory("characters")}
						>
							Toggle All
						</button>
					</div>
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each scanResults.characters as character, index}
							<label
								class="hover:bg-surface-300-700 flex cursor-pointer items-center gap-2 rounded p-1"
							>
								<input
									type="checkbox"
									class="checkbox"
									checked={character.selected}
									onchange={() =>
										toggleSelection("characters", index)}
								/>
								<span class="text-sm">{character.name}</span>
								<span class="text-surface-700-300 ml-auto text-xs">
									{character.filename}
								</span>
							</label>
						{/each}
					</div>
				</div>

				<!-- Personas -->
				<div class="mb-6">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="font-semibold">
							Personas ({scanResults.personas.filter(
								(p) => p.selected
							).length}/{scanResults.personas.length})
						</h4>
						<button
							type="button"
							class="btn btn-sm preset-tonal-primary-500"
							onclick={() => toggleAllInCategory("personas")}
						>
							Toggle All
						</button>
					</div>
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each scanResults.personas as persona, index}
							<label
								class="hover:bg-surface-300-700 flex cursor-pointer items-center gap-2 rounded p-1"
							>
								<input
									type="checkbox"
									class="checkbox"
									checked={persona.selected}
									onchange={() =>
										toggleSelection("personas", index)}
								/>
								<span class="text-sm">{persona.name}</span>
							</label>
						{/each}
					</div>
				</div>

				<!-- Individual Chats -->
				<div class="mb-6">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="font-semibold">
							Individual Chats ({scanResults.chats.filter(
								(c) => c.selected
							).length}/{scanResults.chats.length})
						</h4>
						<button
							type="button"
							class="btn btn-sm preset-tonal-primary-500"
							onclick={() => toggleAllInCategory("chats")}
						>
							Toggle All
						</button>
					</div>
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each scanResults.chats as chat, index}
							<label
								class="flex cursor-pointer items-center gap-2 rounded p-1"
								class:hover:bg-surface-300-700={!chat.disabled}
								class:opacity-50={chat.disabled}
							>
								<input
									type="checkbox"
									class="checkbox"
									checked={chat.selected}
									disabled={chat.disabled}
									onchange={() =>
										toggleSelection("chats", index)}
								/>
								<div class="flex flex-1 flex-col">
									<span class="text-sm">{chat.name}</span>
									<span class="text-surface-700-300 text-xs">
										Character: {chat.characterNames.join(
											", "
										)}
									</span>
									{#if chat.disabledReason}
										<span class="text-error-500 text-xs">
											{chat.disabledReason}
										</span>
									{/if}
								</div>
							</label>
						{/each}
					</div>
				</div>

				<!-- Group Chats -->
				<div class="mb-6">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="font-semibold">
							Group Chats ({scanResults.groupChats.filter(
								(g) => g.selected
							).length}/{scanResults.groupChats.length})
						</h4>
						<button
							type="button"
							class="btn btn-sm preset-tonal-primary-500"
							onclick={() => toggleAllInCategory("groupChats")}
						>
							Toggle All
						</button>
					</div>
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each scanResults.groupChats as chat, index}
							<label
								class="flex cursor-pointer items-center gap-2 rounded p-1"
								class:hover:bg-surface-300-700={!chat.disabled}
								class:opacity-50={chat.disabled}
							>
								<input
									type="checkbox"
									class="checkbox"
									checked={chat.selected}
									disabled={chat.disabled}
									onchange={() =>
										toggleSelection("groupChats", index)}
								/>
								<div class="flex flex-1 flex-col">
									<span class="text-sm">{chat.name}</span>
									<span class="text-surface-700-300 text-xs">
										Members: {chat.memberNames.join(", ")}
									</span>
									{#if chat.disabledReason}
										<span class="text-error-500 text-xs">
											{chat.disabledReason}
										</span>
									{/if}
								</div>
							</label>
						{/each}
					</div>
				</div>

				<!-- Lorebooks -->
				<div class="mb-6">
					<div class="mb-2 flex items-center justify-between">
						<h4 class="font-semibold">
							Lorebooks ({scanResults.lorebooks.filter(
								(l) => l.selected
							).length}/{scanResults.lorebooks.length})
						</h4>
						<button
							type="button"
							class="btn btn-sm preset-tonal-primary-500"
							onclick={() => toggleAllInCategory("lorebooks")}
						>
							Toggle All
						</button>
					</div>
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each scanResults.lorebooks as lorebook, index}
							<label
								class="hover:bg-surface-300-700 flex cursor-pointer items-center gap-2 rounded p-1"
							>
								<input
									type="checkbox"
									class="checkbox"
									checked={lorebook.selected}
									onchange={() =>
										toggleSelection("lorebooks", index)}
								/>
								<span class="text-sm">{lorebook.name}</span>
								<span class="text-surface-700-300 ml-auto text-xs">
									{lorebook.filename}
								</span>
							</label>
						{/each}
					</div>
				</div>

				<!-- Import Confirmation -->
				<div class="border-surface-400-600 mt-6 border-t pt-4">
					<div class="mb-4 flex items-center gap-2">
						<Switch
							name="confirm-import"
							checked={confirmImport}
							onCheckedChange={(e) => (confirmImport = e.checked)}
						>
							<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
						</Switch>
						<label for="confirm-import" class="font-semibold">
							I understand this will import the selected data into
							Serene Pub
						</label>
					</div>

					<button
						type="button"
						class="btn preset-filled-success-500"
						onclick={importData}
						disabled={!confirmImport || isImporting}
					>
						{#if isImporting}
							<Icons.Loader2 size={16} class="animate-spin" />
							{uploadProgress
								? `Uploading... ${uploadProgress.staged}/${uploadProgress.total}`
								: "Importing..."}
						{:else}
							<Icons.Download size={16} />
							Import Selected Data
						{/if}
					</button>
				</div>
			</div>
		{/if}
		{/if}
	</div>
</div>
{/if}
