<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { goto } from "$app/navigation"

	const socket = useTypedSocket()

	// Navigation back to settings
	function goBack() {
		goto("/")
	}

	// State
	let directoryPath = $state("")
	let isScanning = $state(false)
	let isImporting = $state(false)
	let scanResults = $state<{
		characters: Array<{ filename: string; name: string; selected: boolean }>
		personas: Array<{ name: string; selected: boolean }>
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
		lorebooks: Array<{ filename: string; name: string; selected: boolean }>
	} | null>(null)
	let confirmImport = $state(false)

	// Directory validation helper
	function validateDirectoryPath() {
		if (!directoryPath.trim()) {
			return false
		}
		return true
	}

	// Common SillyTavern paths
	const commonPaths = [
		"/home/$USER/SillyTavern",
		"C:\\Users\\$USERNAME\\SillyTavern",
		"/opt/SillyTavern",
		"~/SillyTavern"
	]

	function useCommonPath(pathTemplate: string) {
		directoryPath = pathTemplate
	}

	// Scan directory
	async function scanDirectory() {
		if (!validateDirectoryPath()) {
			toaster.error({
				title: "Invalid directory path",
				description: "Please enter a valid SillyTavern directory path"
			})
			return
		}

		isScanning = true
		scanResults = null

		socket?.emit("import:sillytavern:scan", {
			directoryPath: directoryPath.trim()
		})
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
		if (!scanResults || !confirmImport || !validateDirectoryPath()) {
			return
		}

		isImporting = true

		const selectedData = {
			characters: scanResults.characters.filter((c) => c.selected),
			personas: scanResults.personas.filter((p) => p.selected),
			chats: scanResults.chats.filter((c) => c.selected),
			groupChats: scanResults.groupChats.filter((g) => g.selected),
			lorebooks: scanResults.lorebooks.filter((l) => l.selected)
		}

		socket?.emit("import:sillytavern:execute", {
			directoryPath: directoryPath.trim(),
			selectedData
		})
	}

	// Socket listeners
	socket.on("import:sillytavern:scan", (message) => {
		isScanning = false

		if (message.success && message.data) {
			scanResults = message.data
			toaster.success({
				title: "Scan completed",
				description: `Found ${message.data.characters.length} characters, ${message.data.personas.length} personas, ${message.data.chats.length + message.data.groupChats.length} chats, ${message.data.lorebooks.length} lorebooks`
			})
		} else {
			toaster.error({
				title: "Scan failed",
				description: message.error || "Failed to scan directory"
			})
		}
	})

	socket.on("import:sillytavern:execute", (message) => {
		isImporting = false

		if (message.success) {
			toaster.success({
				title: "Import completed",
				description: message.message || "Data imported successfully"
			})
			// Reset state
			scanResults = null
			directoryPath = ""
			confirmImport = false
		} else {
			toaster.error({
				title: "Import failed",
				description: message.error || "Failed to import data"
			})
		}
	})
</script>

<div class="container mx-auto max-w-4xl p-6">
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
			<p class="text-surface-500 mt-1 text-sm">
				Import your characters, personas, chats, and lorebooks from
				SillyTavern.
			</p>
		</div>
	</div>

	<div class="flex flex-col gap-6">
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

		<!-- Directory Selection -->
		<div class="flex flex-col gap-2">
			<label class="font-semibold">SillyTavern Directory Path</label>
			<input
				type="text"
				class="input"
				bind:value={directoryPath}
				placeholder="/path/to/SillyTavern"
				disabled={isScanning || isImporting}
			/>
			<p class="text-surface-500 text-xs">
				Enter the full path to your SillyTavern installation directory
				(contains 'data' folder).
			</p>

			<!-- Common paths helper -->
			<div class="bg-surface-200-800 rounded p-3">
				<p
					class="text-surface-600 dark:text-surface-400 mb-2 text-xs font-semibold"
				>
					Common SillyTavern locations:
				</p>
				<div class="flex flex-wrap gap-2">
					{#each commonPaths as pathTemplate}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface-500"
							onclick={() => useCommonPath(pathTemplate)}
							disabled={isScanning || isImporting}
						>
							<Icons.MapPin size={12} />
							<span class="font-mono text-xs">
								{pathTemplate}
							</span>
						</button>
					{/each}
				</div>
				<p class="text-surface-500 mt-2 text-xs">
					Click a common path to use it, then edit as needed (replace
					$USER or $USERNAME with your actual username)
				</p>
			</div>
		</div>

		<!-- Scan Button -->
		<div>
			<button
				type="button"
				class="btn preset-filled-secondary-500"
				onclick={scanDirectory}
				disabled={!directoryPath || isScanning || isImporting}
			>
				{#if isScanning}
					<Icons.Loader2 size={16} class="animate-spin" />
					Scanning...
				{:else}
					<Icons.Search size={16} />
					Scan Directory
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
								<span class="text-surface-500 ml-auto text-xs">
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
									<span class="text-surface-500 text-xs">
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
									<span class="text-surface-500 text-xs">
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
								<span class="text-surface-500 ml-auto text-xs">
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
						/>
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
							Importing...
						{:else}
							<Icons.Download size={16} />
							Import Selected Data
						{/if}
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
