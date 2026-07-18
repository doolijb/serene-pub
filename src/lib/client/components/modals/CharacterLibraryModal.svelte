<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		open: boolean
		onOpenChange?: (e: { open: boolean }) => void
	}

	let { open = $bindable(), onOpenChange }: Props = $props()

	const socket = useTypedSocket()

	let searchString = $state("")
	let libraryCharacters: Sockets.Characters.SearchLibrary.Response["characters"] = $state([])
	let isInitialLoading = $state(false)
	let isImporting = $state(false)
	let importingCharacterFile: string | null = $state(null)
	let selectedCharacter: Sockets.Characters.SearchLibrary.Response["characters"][0] | null = $state(null)
	let characterImageUrl = $state<string | null>(null)
	
	// Create debounced search with proper closure
	const debouncedFetchLibrary = (() => {
		let timeoutId: number | undefined
		return () => {
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId)
			}
			timeoutId = setTimeout(() => {
				timeoutId = undefined
				fetchLibrary(false)
			}, 300) as unknown as number
		}
	})()

	// Fetch characters on open (with empty search)
	$effect(() => {
		if (open) {
			fetchLibrary(true, "")
			selectedCharacter = null
			characterImageUrl = null
		}
	})

	// Load image when character is selected
	$effect(() => {
		if (selectedCharacter && selectedCharacter.file.endsWith('.png')) {
			const imageUrl = `https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${selectedCharacter.file}`
			characterImageUrl = imageUrl
		} else {
			characterImageUrl = null
		}
	})

	function fetchLibrary(showLoading: boolean = false, searchTerm: string = searchString) {
		if (showLoading) {
			isInitialLoading = true
		}
		socket.emit("characters:searchLibrary", { searchTerm })
	}

	function handleSearch() {
		fetchLibrary(false)
	}

	function handleCharacterClick(character: Sockets.Characters.SearchLibrary.Response["characters"][0]) {
		selectedCharacter = character
	}

	function handleBackToList() {
		selectedCharacter = null
		characterImageUrl = null
	}

	function handleImport(character: Sockets.Characters.SearchLibrary.Response["characters"][0]) {
		if (isImporting) return
		
		isImporting = true
		importingCharacterFile = character.file
		socket.emit("characters:importFromLibrary", { fileUrl: character.file })
	}

	function handleClose() {
		open = false
		selectedCharacter = null
		characterImageUrl = null
		onOpenChange?.({ open: false })
	}

	function getExcerpt(text: string, maxLength: number = 150): string {
		if (text.length <= maxLength) return text
		return text.substring(0, maxLength).trim() + "..."
	}

	// Socket event handlers
	socket.on("characters:searchLibrary", (msg: Sockets.Characters.SearchLibrary.Response) => {
		libraryCharacters = msg.characters
		isInitialLoading = false
	})

	socket.on("characters:searchLibrary:error", (msg: Sockets.ErrorResponse) => {
		toaster.error({ title: msg.error || "Failed to search library" })
		isInitialLoading = false
	})

	socket.on("characters:importFromLibrary", (msg: Sockets.Characters.ImportFromLibrary.Response) => {
		toaster.success({ title: `Imported ${msg.character.name} successfully!` })
		isImporting = false
		importingCharacterFile = null
		handleClose()
	})

	socket.on("characters:importFromLibrary:error", (msg: Sockets.ErrorResponse) => {
		toaster.error({ title: msg.error || "Failed to import character" })
		isImporting = false
		importingCharacterFile = null
	})

	// Group characters by category
	let categorizedCharacters = $derived.by(() => {
		const categories = new Map<string, typeof libraryCharacters>()
		
		for (const character of libraryCharacters) {
			const category = character.category || "Uncategorized"
			if (!categories.has(category)) {
				categories.set(category, [])
			}
			categories.get(category)!.push(character)
		}
		
		return Array.from(categories.entries()).sort((a, b) => a[0].localeCompare(b[0]))
	})
</script>

<Dialog {open} onOpenChange={(e) => { if (!e.open) handleClose() }}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
		<header class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				{#if selectedCharacter}
					<button class="btn btn-sm preset-filled-surface-400-600" onclick={handleBackToList} aria-label="Back to list">
						<Icons.ArrowLeft size={16} />
					</button>
				{:else}
					<Icons.Library class="w-5 h-5" />
				{/if}
				<h3 class="h3">{selectedCharacter ? selectedCharacter.name : "Character Library"}</h3>
			</div>
			<button class="btn btn-sm preset-filled-surface-400-600" onclick={handleClose} aria-label="Close">
				<Icons.X size={16} />
			</button>
		</header>

		<article class="space-y-4">
			{#if selectedCharacter}
				<!-- Detail View -->
				<div class="space-y-4">
					{#if characterImageUrl}
						<div class="flex justify-center">
							<img src={characterImageUrl} alt={selectedCharacter.name} class="max-w-sm max-h-96 rounded-lg shadow-lg" />
						</div>
					{/if}
					
					<div class="space-y-3">
						<div>
							<h4 class="h4 font-semibold mb-1">Description</h4>
							<p class="text-sm whitespace-pre-line">{selectedCharacter.description}</p>
						</div>

						{#if selectedCharacter.tags.length > 0}
							<div>
								<h4 class="h4 font-semibold mb-1">Tags</h4>
								<div class="flex flex-wrap gap-2">
									{#each selectedCharacter.tags as tag}
										<span class="badge variant-soft-primary text-xs">{tag}</span>
									{/each}
								</div>
							</div>
						{/if}

						<div class="grid grid-cols-2 gap-4 text-sm">
							<div>
								<span class="font-semibold">Author:</span> {selectedCharacter.author}
							</div>
							<div>
								<span class="font-semibold">Version:</span> {selectedCharacter.version}
							</div>
							<div>
								<span class="font-semibold">Spec:</span> {selectedCharacter.spec}
							</div>
							<div>
								<span class="font-semibold">Category:</span> {selectedCharacter.category}
							</div>
						</div>
					</div>
				</div>
			{:else}
				<!-- List View -->
				<!-- Search -->
				<div class="flex gap-2">
				<input
					type="text"
					bind:value={searchString}
					placeholder="Search characters..."
					class="input flex-1"
					oninput={debouncedFetchLibrary}
					onkeydown={(e) => e.key === "Enter" && handleSearch()}
				/>
				<button
					class="btn preset-filled-primary-500"
					onclick={handleSearch}
				>
					<Icons.Search class="w-4 h-4" />
					Search
				</button>
			</div>

			<!-- Results -->
				<div class="max-h-[60vh] min-h-[400px] overflow-y-auto space-y-4">
				{#if isInitialLoading}
					<div class="flex items-center justify-center py-8">
						<Icons.Loader class="w-8 h-8 animate-spin text-surface-500" />
					</div>
				{:else if libraryCharacters.length === 0}
					<div class="text-center py-8 text-surface-500">
						<Icons.Search class="w-12 h-12 mx-auto mb-2 opacity-50" />
						<p>No characters found</p>
					</div>
				{:else}
					{#each categorizedCharacters as [category, characters]}
						<div class="space-y-2">
							<h4 class="h4 font-semibold">{category}</h4>
							<div class="grid grid-cols-1 gap-2">
								{#each characters as character}
									<button
										class="card variant-ghost-surface p-4 flex items-start gap-4 text-left hover:variant-filled-surface transition-colors cursor-pointer w-full"
										onclick={() => handleCharacterClick(character)}
									>									{#if character.file.endsWith('.png')}
										<img
											src={`https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${character.file}`}
											alt={character.name}
											class="w-16 h-16 object-cover rounded-lg flex-shrink-0"
										/>
									{:else}
										<div class="w-16 h-16 bg-surface-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
											<Icons.User class="w-8 h-8 text-surface-500" />
										</div>
									{/if}										<div class="flex-1">
											<h5 class="h5 font-semibold">{character.name}</h5>
											<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
												{getExcerpt(character.description)}
											</p>
											<div class="text-xs text-surface-500 mt-2">
												by {character.author} • {character.spec}
											</div>
										</div>
										<Icons.ChevronRight class="w-5 h-5 text-surface-500 flex-shrink-0" />
									</button>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>
			{/if}
		</article>

		<footer class="flex justify-end gap-4">
			{#if selectedCharacter}
				<button
					class="btn preset-filled-primary-500"
					onclick={() => handleImport(selectedCharacter!)}
					disabled={isImporting}
				>
					{#if isImporting && importingCharacterFile === selectedCharacter.file}
						<Icons.Loader class="w-4 h-4 animate-spin" />
					{:else}
						<Icons.Download class="w-4 h-4" />
					{/if}
					Import Character
				</button>
			{/if}
			<button class="btn preset-filled-surface-500" onclick={handleClose}>
				Close
			</button>
		</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
