<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import { getContext } from "svelte"
	import {
		resolvePickedFolder,
		startImportSession,
		stageFilesToServer,
		type FolderPickResult
	} from "$lib/client/utils/sillyTavernFolderImport"
	import { SILLYTAVERN_DIRS } from "$lib/shared/utils/sillyTavernPaths"
	import { importCompletionOf, type ImportCompletion } from "./importCompletion"

	const userCtx: UserCtx = getContext("userCtx")
	const socket = useTypedSocket()
	const interest = getInterestContext()

	// Settings' Import section (owner note 23, 2026-10-02): this was the
	// standalone /import page, and is now a section of the Settings view,
	// shown only to an admin (SettingsSidebar draws the tab for one alone;
	// the server refuses every `import:` verb for anyone else regardless).

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
		sessions: Array<{
			filename: string
			name: string
			characterNames: string[]
			isGroup: boolean
			selected: boolean
			disabled: boolean
			disabledReason?: string
		}>
		groupSessions: Array<{
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
	let importComplete = $state<{
		/** How the import ended, as the heading and its icon say it. */
		completion: ImportCompletion
		message: string
		/** Why it stopped before it finished, when it did. */
		stoppedBecause?: string
		errors?: string[]
		/** What did not finish for an item that did land (plan A13). */
		warnings?: string[]
	} | null>(null)

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
					"Couldn't find characters, sessions, groups, worlds, or settings.json in the selected folder. Please select your SillyTavern (or SillyTavern-Launcher) folder."
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
			importSessionId = await startImportSession()
			await stageFilesToServer(
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
					error instanceof Error
						? error.message
						: "Failed to upload files"
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

		socket.emit("import:sillytavern:scan", {
			importSessionId,
			deferredSessionPaths: pickedFolder.deferredFiles.map(
				(f) => f.relativePath
			)
		})
	}

	// Toggle individual item selection
	function toggleSelection(
		category:
			| "characters"
			| "personas"
			| "sessions"
			| "groupSessions"
			| "lorebooks",
		index: number
	) {
		if (!scanResults) return

		const item = scanResults[category][index]
		if (item && !item.disabled) {
			item.selected = !item.selected
			scanResults = { ...scanResults }

			// Re-validate session dependencies
			validateSessionDependencies()
		}
	}

	// Toggle all in category
	function toggleAllInCategory(
		category:
			| "characters"
			| "personas"
			| "sessions"
			| "groupSessions"
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

		// Re-validate session dependencies
		if (
			category === "characters" ||
			category === "sessions" ||
			category === "groupSessions"
		) {
			validateSessionDependencies()
		}
	}

	// Validate session dependencies
	function validateSessionDependencies() {
		if (!scanResults) return

		const selectedCharacters = new Set(
			scanResults.characters.filter((c) => c.selected).map((c) => c.name)
		)

		// Validate individual sessions
		scanResults.sessions.forEach((session) => {
			const missingCharacters = session.characterNames.filter(
				(name) => !selectedCharacters.has(name)
			)

			if (missingCharacters.length > 0) {
				session.disabled = true
				session.selected = false
				session.disabledReason = `Missing character(s): ${missingCharacters.join(", ")}`
			} else {
				session.disabled = false
				session.disabledReason = undefined
			}
		})

		// Validate group sessions
		scanResults.groupSessions.forEach((session) => {
			const missingCharacters = session.memberNames.filter(
				(name) => !selectedCharacters.has(name)
			)

			if (missingCharacters.length > 0) {
				session.disabled = true
				session.selected = false
				session.disabledReason = `Missing character(s): ${missingCharacters.join(", ")}`
			} else {
				session.disabled = false
				session.disabledReason = undefined
			}
		})

		scanResults = { ...scanResults }
	}

	// Import data
	async function importData() {
		if (
			!scanResults ||
			!confirmImport ||
			!pickedFolder ||
			!importSessionId ||
			!socket
		) {
			return
		}

		isImporting = true
		uploadProgress = null

		const selectedData = {
			characters: scanResults.characters.filter((c) => c.selected),
			personas: scanResults.personas.filter((p) => p.selected),
			sessions: scanResults.sessions.filter((c) => c.selected),
			groupSessions: scanResults.groupSessions.filter((g) => g.selected),
			lorebooks: scanResults.lorebooks.filter((l) => l.selected)
		}

		// Only now upload SillyTavern chat history — the chats (under ST's own
		// `chats/` folder) the user selected, plus all of ST's `group chats/`
		// if any group is selected (mapping a selected group to its exact
		// history filename requires re-parsing its JSON, so we just upload
		// the whole small set). The folder names are SillyTavern's (R5).
		const selectedSessionPaths = new Set(
			selectedData.sessions.map(
				(c) => `${SILLYTAVERN_DIRS.chats}/${c.filename}`
			)
		)
		const wantsGroupSessionHistory = selectedData.groupSessions.length > 0
		const filesToUpload = pickedFolder.deferredFiles.filter(
			(f) =>
				selectedSessionPaths.has(f.relativePath) ||
				(wantsGroupSessionHistory &&
					f.relativePath.startsWith(
						`${SILLYTAVERN_DIRS.groupChats}/`
					))
		)

		try {
			await stageFilesToServer(
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
					error instanceof Error
						? error.message
						: "Failed to upload files"
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

	// The scan's and the import's answers, both BARE — an import is the
	// instance's, not one session's — and both STANDING: each is the reply to
	// a button this page presses much later, so the key is held for as long as
	// the page is. The registry releases both when the page is destroyed,
	// which is also what fixed the leak these named handlers were written for.
	function handleImportSillytavernScan(
		message: SocketEventMap["import:sillytavern:scan"]["response"]
	) {
		isScanning = false
		if (scanTimeout) {
			clearTimeout(scanTimeout)
			scanTimeout = null
		}

		if (message.success && message.data) {
			scanResults = message.data
			const total =
				message.data.characters.length +
				message.data.personas.length +
				message.data.sessions.length +
				message.data.groupSessions.length +
				message.data.lorebooks.length
			if (total === 0) {
				toaster.warning({
					title: "Nothing found",
					description:
						"The directory was found but contained no importable data. Make sure you're pointing at your SillyTavern root (or SillyTavern-Launcher) folder."
				})
			} else {
				toaster.success({
					title: "Scan completed",
					description: `Found ${message.data.characters.length} characters, ${message.data.personas.length} personas, ${message.data.sessions.length + message.data.groupSessions.length} sessions, ${message.data.lorebooks.length} lorebooks`
				})
			}
		} else {
			toaster.error({
				title: "Scan failed",
				description: message.error || "Failed to scan directory"
			})
		}
	}
	interest.useInterest<"import:sillytavern:scan">(
		"import:sillytavern:scan",
		handleImportSillytavernScan
	)

	function handleImportSillytavernExecute(
		message: SocketEventMap["import:sillytavern:execute"]["response"]
	) {
		isImporting = false
		if (importTimeout) {
			clearTimeout(importTimeout)
			importTimeout = null
		}

		if (message.success) {
			const completion = importCompletionOf(message.conclusion ?? "complete")
			const toast = {
				title: completion.toast,
				description: message.message || "Data imported successfully"
			}
			if (completion.tone === "success") toaster.success(toast)
			else toaster.warning(toast)
			importComplete = {
				completion,
				message: message.message || "Data imported successfully",
				stoppedBecause: message.stoppedBecause,
				errors: message.errors,
				warnings: message.warnings
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
	}
	interest.useInterest<"import:sillytavern:execute">(
		"import:sillytavern:execute",
		handleImportSillytavernExecute
	)
</script>

{#if userCtx.user?.isAdmin}
	<div class="flex flex-col gap-4">
		<!-- The section's name is PanelSectionTitle's ("Import"); this says
		     what it imports from. -->
		<div>
			<h3 class="text-sm font-medium">From SillyTavern</h3>
			<p class="text-surface-600-400 mt-1 text-sm">
				Import your characters, personas, sessions, and lorebooks
				from SillyTavern.
			</p>
		</div>

		<div class="flex flex-col gap-6">
			{#if importComplete}
				<!-- Import complete Confirmation -->
				<div class="rounded p-6 text-center">
					{#if importComplete.completion.tone === "success"}
						<Icons.CheckCircle
							size={48}
							class="text-success-500 mx-auto mb-4"
						/>
					{:else}
						<Icons.AlertTriangle
							size={48}
							class="text-warning-500 mx-auto mb-4"
						/>
					{/if}
					<h3 class="mb-2 text-lg font-semibold">
						{importComplete.completion.heading}
					</h3>
					<p class="text-surface-700-300 mb-4 text-sm">
						{importComplete.message}
					</p>
					{#if importComplete.stoppedBecause}
						<div
							class="bg-warning-200-800 border-warning-500 mb-4 rounded border-l-4 p-3 text-left"
						>
							<p class="text-sm">
								<span class="font-semibold">It stopped before it finished:</span>
								{importComplete.stoppedBecause}
							</p>
						</div>
					{/if}
					{#if importComplete.errors?.length}
						<div
							class="bg-warning-200-800 border-warning-500 mb-4 rounded border-l-4 p-3 text-left"
						>
							<p class="mb-1 text-sm font-semibold">
								{importComplete.errors.length} item{importComplete
									.errors.length !== 1
									? "s"
									: ""} had errors:
							</p>
							<ul
								class="list-inside list-disc space-y-0.5 text-xs"
							>
								{#each importComplete.errors as error}
									<li>{error}</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if importComplete.warnings?.length}
						<div
							class="bg-warning-200-800 border-warning-500 mb-4 rounded border-l-4 p-3 text-left"
						>
							<p class="mb-1 text-sm font-semibold">
								Imported, with {importComplete.warnings.length} thing{importComplete
									.warnings.length !== 1
									? "s"
									: ""} left unfinished:
							</p>
							<ul
								class="list-inside list-disc space-y-0.5 text-xs"
							>
								{#each importComplete.warnings as warning}
									<li>{warning}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<div class="flex justify-center gap-2">
						<button
							type="button"
							class="btn preset-filled-primary-500"
							onclick={importAnother}
						>
							<Icons.FolderOpen size={16} />
							Import another folder
						</button>
					</div>
				</div>
			{:else}
				<!-- Important Notes -->
				<div
					class="bg-warning-200-800 border-warning-500 rounded border-l-4 p-4"
				>
					<h3 class="mb-2 flex items-center gap-2 font-semibold">
						<Icons.AlertTriangle
							size={20}
							class="text-warning-500"
						/>
						Important information
					</h3>
					<ul
						class="text-surface-700 dark:text-surface-300 list-inside list-disc space-y-1 text-sm"
					>
						<li>
							<strong>What's imported:</strong>
							Characters and their expression sprites, personas and
							their avatars, chats (including group chats), and
							lorebooks (SillyTavern's World Info)
						</li>
						<li>
							<strong>What's NOT imported:</strong>
							The links between chat branches and checkpoints (each
							branch imports as its own session), a group's earlier
							chats (only its current one imports), chat backgrounds,
							extensions data
						</li>
						<li>
							<strong>Chats become sessions:</strong>
							Both individual and group chats are imported into
							Serene Pub's unified session system
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
						{pickedFolder
							? "Change folder"
							: "Choose SillyTavern Folder"}
					</button>
					{#if pickedFolder}
						<p class="text-success-600-400 text-sm">
							Found {pickedFolder.files.length} relevant file{pickedFolder
								.files.length !== 1
								? "s"
								: ""} ({pickedFolder.scanFiles.length} to scan now,
							{pickedFolder.deferredFiles.length} chat history file{pickedFolder
								.deferredFiles.length !== 1
								? "s"
								: ""} uploaded only for what you select to import)
						</p>
					{/if}
					<p class="text-surface-700-300 text-xs">
						Everything is read by your browser and uploaded —
						nothing is read from the server's filesystem. Select
						your SillyTavern (or SillyTavern-Launcher) folder.
						Requires a Chromium-based browser or a recent version of
						Firefox.
					</p>

					{#if uploadProgress}
						<div class="bg-surface-200-800 rounded p-2">
							<p
								class="text-surface-600 dark:text-surface-400 text-xs"
							>
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
							Process data
						{/if}
					</button>
				</div>

				<!-- Scan results -->
				{#if scanResults}
					<div class="bg-surface-200-800 rounded p-4">
						<h3 class="mb-4 text-lg font-semibold">Scan results</h3>

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
									onclick={() =>
										toggleAllInCategory("characters")}
								>
									Toggle all
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
												toggleSelection(
													"characters",
													index
												)}
										/>
										<span class="text-sm">
											{character.name}
										</span>
										<span
											class="text-surface-700-300 ml-auto text-xs"
										>
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
									onclick={() =>
										toggleAllInCategory("personas")}
								>
									Toggle all
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
												toggleSelection(
													"personas",
													index
												)}
										/>
										<span class="text-sm">
											{persona.name}
										</span>
									</label>
								{/each}
							</div>
						</div>

						<!-- Individual sessions -->
						<div class="mb-6">
							<div class="mb-2 flex items-center justify-between">
								<h4 class="font-semibold">
									Individual sessions ({scanResults.sessions.filter(
										(c) => c.selected
									).length}/{scanResults.sessions.length})
								</h4>
								<button
									type="button"
									class="btn btn-sm preset-tonal-primary-500"
									onclick={() =>
										toggleAllInCategory("sessions")}
								>
									Toggle all
								</button>
							</div>
							<div class="max-h-48 space-y-1 overflow-y-auto">
								{#each scanResults.sessions as session, index}
									<label
										class="flex cursor-pointer items-center gap-2 rounded p-1"
										class:hover:bg-surface-300-700={!session.disabled}
										class:opacity-50={session.disabled}
									>
										<input
											type="checkbox"
											class="checkbox"
											checked={session.selected}
											disabled={session.disabled}
											onchange={() =>
												toggleSelection(
													"sessions",
													index
												)}
										/>
										<div class="flex flex-1 flex-col">
											<span class="text-sm">
												{session.name}
											</span>
											<span
												class="text-surface-700-300 text-xs"
											>
												Character: {session.characterNames.join(
													", "
												)}
											</span>
											{#if session.disabledReason}
												<span
													class="text-error-500 text-xs"
												>
													{session.disabledReason}
												</span>
											{/if}
										</div>
									</label>
								{/each}
							</div>
						</div>

						<!-- Group sessions -->
						<div class="mb-6">
							<div class="mb-2 flex items-center justify-between">
								<h4 class="font-semibold">
									Group sessions ({scanResults.groupSessions.filter(
										(g) => g.selected
									).length}/{scanResults.groupSessions
										.length})
								</h4>
								<button
									type="button"
									class="btn btn-sm preset-tonal-primary-500"
									onclick={() =>
										toggleAllInCategory("groupSessions")}
								>
									Toggle all
								</button>
							</div>
							<div class="max-h-48 space-y-1 overflow-y-auto">
								{#each scanResults.groupSessions as session, index}
									<label
										class="flex cursor-pointer items-center gap-2 rounded p-1"
										class:hover:bg-surface-300-700={!session.disabled}
										class:opacity-50={session.disabled}
									>
										<input
											type="checkbox"
											class="checkbox"
											checked={session.selected}
											disabled={session.disabled}
											onchange={() =>
												toggleSelection(
													"groupSessions",
													index
												)}
										/>
										<div class="flex flex-1 flex-col">
											<span class="text-sm">
												{session.name}
											</span>
											<span
												class="text-surface-700-300 text-xs"
											>
												Members: {session.memberNames.join(
													", "
												)}
											</span>
											{#if session.disabledReason}
												<span
													class="text-error-500 text-xs"
												>
													{session.disabledReason}
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
									onclick={() =>
										toggleAllInCategory("lorebooks")}
								>
									Toggle all
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
												toggleSelection(
													"lorebooks",
													index
												)}
										/>
										<span class="text-sm">
											{lorebook.name}
										</span>
										<span
											class="text-surface-700-300 ml-auto text-xs"
										>
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
									onCheckedChange={(e) =>
										(confirmImport = e.checked)}
								>
									<Switch.Control
										class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
									>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.HiddenInput />
									<Switch.Label class="font-semibold">
										I understand this will import the
										selected data into Serene Pub
									</Switch.Label>
								</Switch>
							</div>

							<button
								type="button"
								class="btn preset-filled-primary-500"
								onclick={importData}
								disabled={!confirmImport || isImporting}
							>
								{#if isImporting}
									<Icons.Loader2
										size={16}
										class="animate-spin"
									/>
									{uploadProgress
										? `Uploading... ${uploadProgress.staged}/${uploadProgress.total}`
										: "Importing..."}
								{:else}
									<Icons.Download size={16} />
									Import selected data
								{/if}
							</button>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
