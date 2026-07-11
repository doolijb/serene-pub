<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		open: boolean
		onOpenChange?: (e: { open: boolean }) => void
	}

	let { open = $bindable(), onOpenChange }: Props = $props()

	const socket = useTypedSocket()

	let searchString = $state("")
	let libraryPersonas: Sockets.Personas.SearchLibrary.Response["personas"] = $state([])
	let isInitialLoading = $state(false)
	let isImporting = $state(false)
	let importingPersonaFile: string | null = $state(null)
	let selectedPersona: Sockets.Personas.SearchLibrary.Response["personas"][0] | null = $state(null)
	let personaImageUrl = $state<string | null>(null)
	
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

	// Fetch personas on open (with empty search)
	$effect(() => {
		if (open) {
			fetchLibrary(true, "")
			selectedPersona = null
			personaImageUrl = null
		}
	})

	// Load image when persona is selected
	$effect(() => {
		if (selectedPersona && selectedPersona.file.endsWith('.png')) {
			const imageUrl = `https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${selectedPersona.file}`
			personaImageUrl = imageUrl
		} else {
			personaImageUrl = null
		}
	})

	function fetchLibrary(showLoading: boolean = false, searchTerm: string = searchString) {
		if (showLoading) {
			isInitialLoading = true
		}
		socket.emit("personas:searchLibrary", { searchTerm })
	}

	function handleSearch() {
		fetchLibrary(false)
	}

	function handlePersonaClick(persona: Sockets.Personas.SearchLibrary.Response["personas"][0]) {
		selectedPersona = persona
	}

	function handleBackToList() {
		selectedPersona = null
		personaImageUrl = null
	}

	function handleImport(persona: Sockets.Personas.SearchLibrary.Response["personas"][0]) {
		if (isImporting) return
		
		isImporting = true
		importingPersonaFile = persona.file
		socket.emit("personas:importFromLibrary", { fileUrl: persona.file })
	}

	function handleClose() {
		open = false
		selectedPersona = null
		personaImageUrl = null
		onOpenChange?.({ open: false })
	}

	function getExcerpt(text: string, maxLength: number = 150): string {
		if (text.length <= maxLength) return text
		return text.substring(0, maxLength).trim() + "..."
	}

	// Socket event handlers
	socket.on("personas:searchLibrary", (msg: Sockets.Personas.SearchLibrary.Response) => {
		libraryPersonas = msg.personas
		isInitialLoading = false
	})

	socket.on("personas:searchLibrary:error", (msg: Sockets.ErrorResponse) => {
		toaster.error({ title: msg.error || "Failed to search library" })
		isInitialLoading = false
	})

	socket.on("personas:importFromLibrary", (msg: Sockets.Personas.ImportFromLibrary.Response) => {
		toaster.success({ title: `Imported ${msg.persona.name} successfully!` })
		isImporting = false
		importingPersonaFile = null
		handleClose()
	})

	socket.on("personas:importFromLibrary:error", (msg: Sockets.ErrorResponse) => {
		toaster.error({ title: msg.error || "Failed to import persona" })
		isImporting = false
		importingPersonaFile = null
	})

	// Group personas by category
	let categorizedPersonas = $derived.by(() => {
		const categories = new Map<string, typeof libraryPersonas>()
		
		for (const persona of libraryPersonas) {
			const category = persona.category || "Uncategorized"
			if (!categories.has(category)) {
				categories.set(category, [])
			}
			categories.get(category)!.push(persona)
		}
		
		return Array.from(categories.entries()).sort((a, b) => a[0].localeCompare(b[0]))
	})
</script>

<Modal {open} onOpenChange={(e) => { if (!e.open) handleClose() }} contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" backdropClasses="backdrop-blur-sm">
	{#snippet content()}
		<header class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				{#if selectedPersona}
					<button class="btn btn-sm preset-filled-surface-400-600" onclick={handleBackToList} aria-label="Back to list">
						<Icons.ArrowLeft size={16} />
					</button>
				{:else}
					<Icons.Library class="w-5 h-5" />
				{/if}
				<h3 class="h3">{selectedPersona ? selectedPersona.name : "Persona Library"}</h3>
			</div>
			<button class="btn btn-sm preset-filled-surface-400-600" onclick={handleClose} aria-label="Close">
				<Icons.X size={16} />
			</button>
		</header>

		<article class="space-y-4">
			{#if selectedPersona}
				<!-- Detail View -->
				<div class="space-y-4">
					{#if personaImageUrl}
						<div class="flex justify-center">
							<img src={personaImageUrl} alt={selectedPersona.name} class="max-w-sm max-h-96 rounded-lg shadow-lg" />
						</div>
					{/if}
					
					<div class="space-y-3">
						<div>
							<h4 class="h4 font-semibold mb-1">Description</h4>
							<p class="text-sm whitespace-pre-line">{selectedPersona.description}</p>
						</div>

						{#if selectedPersona.tags.length > 0}
							<div>
								<h4 class="h4 font-semibold mb-1">Tags</h4>
								<div class="flex flex-wrap gap-2">
									{#each selectedPersona.tags as tag}
										<span class="badge variant-soft-primary text-xs">{tag}</span>
									{/each}
								</div>
							</div>
						{/if}

						<div class="grid grid-cols-2 gap-4 text-sm">
							<div>
								<span class="font-semibold">Author:</span> {selectedPersona.author}
							</div>
							<div>
								<span class="font-semibold">Version:</span> {selectedPersona.version}
							</div>
							<div>
								<span class="font-semibold">Spec:</span> {selectedPersona.spec}
							</div>
							<div>
								<span class="font-semibold">Category:</span> {selectedPersona.category}
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
					placeholder="Search personas..."
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
				{:else if libraryPersonas.length === 0}
					<div class="text-center py-8 text-surface-500">
						<Icons.Search class="w-12 h-12 mx-auto mb-2 opacity-50" />
						<p>No personas found</p>
					</div>
				{:else}
					{#each categorizedPersonas as [category, personas]}
						<div class="space-y-2">
							<h4 class="h4 font-semibold">{category}</h4>
							<div class="grid grid-cols-1 gap-2">
								{#each personas as persona}
									<button
										class="card variant-ghost-surface p-4 flex items-start gap-4 text-left hover:variant-filled-surface transition-colors cursor-pointer w-full"
										onclick={() => handlePersonaClick(persona)}
									>
										{#if persona.file.endsWith('.png')}
											<img
												src={`https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${persona.file}`}
												alt={persona.name}
												class="w-16 h-16 object-cover rounded-lg flex-shrink-0"
											/>
										{:else}
											<div class="w-16 h-16 bg-surface-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
												<Icons.User class="w-8 h-8 text-surface-500" />
											</div>
										{/if}
										<div class="flex-1">
											<h5 class="h5 font-semibold">{persona.name}</h5>
											<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
												{getExcerpt(persona.description)}
											</p>
											<div class="text-xs text-surface-500 mt-2">
												by {persona.author} • {persona.spec}
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
		{#if selectedPersona}
			<button
				class="btn preset-filled-primary-500"
				onclick={() => handleImport(selectedPersona!)}
				disabled={isImporting}
			>
				{#if isImporting && importingPersonaFile === selectedPersona.file}
					<Icons.Loader class="w-4 h-4 animate-spin" />
				{:else}
					<Icons.Download class="w-4 h-4" />
				{/if}
				Import Persona
			</button>
		{/if}
		<button class="btn preset-filled-surface-500" onclick={handleClose}>
			Close
		</button>
	</footer>
	{/snippet}
</Modal>
