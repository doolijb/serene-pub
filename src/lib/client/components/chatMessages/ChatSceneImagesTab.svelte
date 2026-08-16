<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onMount } from "svelte"

	interface EntityInfo {
		type: "character" | "persona"
		id: number
		name: string
		avatar: string | null | undefined
		entity: SelectCharacter | SelectPersona
	}

	interface Props {
		chatCharacters: (SelectChatCharacter & { character: SelectCharacter })[]
		chatPersonas: (SelectChatPersona & { persona: SelectPersona })[]
		leftImage: string | null
		rightImage: string | null
	}

	let {
		chatCharacters = [],
		chatPersonas = [],
		leftImage = $bindable(null),
		rightImage = $bindable(null)
	}: Props = $props()

	const socket = useTypedSocket()

	// Flat, deduplicated entity list for display
	let entities = $derived<EntityInfo[]>([
		...chatCharacters.map((cc) => ({
			type: "character" as const,
			id: cc.character.id,
			name: (cc.character as any).nickname || cc.character.name,
			avatar: cc.character.avatar,
			entity: cc.character
		})),
		...chatPersonas.map((cp) => ({
			type: "persona" as const,
			id: cp.persona.id,
			name: cp.persona.name,
			avatar: cp.persona.avatar,
			entity: cp.persona
		}))
	])

	// Expanded entity key and gallery cache
	let expandedKey = $state<string | null>(null)
	let galleryCache = $state<Record<string, string[]>>({})
	let pendingGalleryKey = $state<string | null>(null)
	let brokenPaths = $state(new Set<string>())

	function entityKey(e: EntityInfo): string {
		return `${e.type}:${e.id}`
	}

	function toggleGallery(e: EntityInfo) {
		const key = entityKey(e)
		if (expandedKey === key) {
			expandedKey = null
			return
		}
		expandedKey = key
		if (!galleryCache[key]) {
			pendingGalleryKey = key
			if (e.type === "character") {
				socket.emit("characters:listGallery", { characterId: e.id })
			} else {
				socket.emit("personas:listGallery", { personaId: e.id })
			}
		}
	}

	function setLeft(src: string) {
		leftImage = src
	}
	function setRight(src: string) {
		rightImage = src
	}
	function clearLeft() {
		leftImage = null
	}
	function clearRight() {
		rightImage = null
	}

	onMount(() => {
		const charHandler = (data: Sockets.Characters.ListGallery.Response) => {
			if (pendingGalleryKey?.startsWith("character:")) {
				galleryCache = {
					...galleryCache,
					[pendingGalleryKey]: data.images
				}
				pendingGalleryKey = null
			}
		}
		const personaHandler = (
			data: Sockets.Personas.ListGallery.Response
		) => {
			if (pendingGalleryKey?.startsWith("persona:")) {
				galleryCache = {
					...galleryCache,
					[pendingGalleryKey]: data.images
				}
				pendingGalleryKey = null
			}
		}

		socket.on("characters:listGallery", charHandler)
		socket.on("personas:listGallery", personaHandler)

		return () => {
			socket.off("characters:listGallery", charHandler)
			socket.off("personas:listGallery", personaHandler)
		}
	})
</script>

<div class="space-y-3 p-1">
	<!-- Current selections preview -->
	{#if leftImage || rightImage}
		<div class="flex gap-3">
			<!-- Left -->
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<span
					class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
				>
					Left
				</span>
				{#if leftImage}
					<div class="relative">
						<img
							src={leftImage}
							alt="Left character"
							class="border-surface-300-700 h-20 w-full rounded border object-cover"
						/>
						<button
							class="btn-icon preset-filled-error-500 absolute -top-1 -right-1 h-5 min-h-0 w-5 p-0 text-xs"
							onclick={clearLeft}
							title="Clear left image"
						>
							<Icons.X size={10} />
						</button>
					</div>
				{:else}
					<div
						class="border-surface-300-700 text-surface-700-300 flex h-20 items-center justify-center rounded border border-dashed text-xs"
					>
						None
					</div>
				{/if}
			</div>
			<!-- Right -->
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<span
					class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
				>
					Right
				</span>
				{#if rightImage}
					<div class="relative">
						<img
							src={rightImage}
							alt="Right character"
							class="border-surface-300-700 h-20 w-full rounded border object-cover"
						/>
						<button
							class="btn-icon preset-filled-error-500 absolute -top-1 -right-1 h-5 min-h-0 w-5 p-0 text-xs"
							onclick={clearRight}
							title="Clear right image"
						>
							<Icons.X size={10} />
						</button>
					</div>
				{:else}
					<div
						class="border-surface-300-700 text-surface-700-300 flex h-20 items-center justify-center rounded border border-dashed text-xs"
					>
						None
					</div>
				{/if}
			</div>
		</div>
		<hr class="border-surface-300-700" />
	{/if}

	<!-- Entity list -->
	{#if entities.length === 0}
		<p class="text-surface-700-300 text-sm">
			No characters or personas in this chat.
		</p>
	{:else}
		<div class="space-y-1">
			{#each entities as e (entityKey(e))}
				{@const key = entityKey(e)}
				{@const isExpanded = expandedKey === key}
				{@const galleryImages = galleryCache[key] ?? []}
				{@const isLoadingGallery = pendingGalleryKey === key}
				{@const isLeft = !!e.avatar && leftImage === e.avatar}
				{@const isRight = !!e.avatar && rightImage === e.avatar}

				<div
					class="border-surface-300-700 overflow-hidden rounded-lg border"
				>
					<!-- Entity row -->
					<div class="flex items-center gap-2 px-2 py-1.5">
						<!-- Avatar. Sized via the prop rather than the previous
						     `scale-75` transform, which only scaled the paint and
						     still reserved the full 4em of layout width. -->
						<Avatar char={e.entity} size="w-12 h-12" />
						<!-- Name -->
						<span
							class="min-w-0 flex-1 truncate text-sm font-medium"
						>
							{e.name}
						</span>
						<!-- Controls -->
						<div class="flex shrink-0 gap-1">
							{#if e.avatar}
								<button
									class="btn btn-sm px-2 py-1 text-xs {isLeft
										? 'preset-filled-primary-500'
										: 'preset-tonal-primary'}"
									onclick={() =>
										isLeft
											? clearLeft()
											: setLeft(e.avatar!)}
									title={isLeft ? "Unpin left" : "Pin left"}
								>
									<Icons.PanelLeft size={12} />
									Left
								</button>
								<button
									class="btn btn-sm px-2 py-1 text-xs {isRight
										? 'preset-filled-secondary-500'
										: 'preset-tonal-secondary'}"
									onclick={() =>
										isRight
											? clearRight()
											: setRight(e.avatar!)}
									title={isRight
										? "Unpin right"
										: "Pin right"}
								>
									Right
									<Icons.PanelRight size={12} />
								</button>
							{/if}
							<button
								class="btn btn-sm preset-filled-surface-400-600 px-2 py-1 text-xs {isExpanded
									? 'preset-filled-surface-500'
									: ''}"
								onclick={() => toggleGallery(e)}
								title={isExpanded
									? "Hide gallery"
									: "Show gallery"}
							>
								{#if isLoadingGallery}
									<Icons.Loader
										size={12}
										class="animate-spin"
									/>
								{:else}
									<Icons.Images size={12} />
									<Icons.ChevronDown
										size={10}
										class="transition-transform {isExpanded
											? 'rotate-180'
											: ''}"
									/>
								{/if}
							</button>
						</div>
					</div>

					<!-- Gallery thumbnails (expanded) -->
					{#if isExpanded}
						<div
							class="border-surface-300-700 bg-surface-50-950 border-t p-2"
						>
							{#if isLoadingGallery}
								<div
									class="text-surface-700-300 flex items-center gap-2 text-xs"
								>
									<Icons.Loader
										size={12}
										class="animate-spin"
									/>
									Loading…
								</div>
							{:else if galleryImages.length === 0}
								<p class="text-surface-700-300 text-xs">
									No gallery images.
								</p>
							{:else}
								<div class="flex flex-wrap gap-1.5">
									{#each galleryImages as imgPath}
										{#if !brokenPaths.has(imgPath)}
											<div class="group relative">
												<img
													src={imgPath}
													alt=""
													class="h-14 w-14 cursor-pointer rounded border-2 object-cover {leftImage ===
													imgPath
														? 'border-primary-500'
														: rightImage === imgPath
															? 'border-secondary-500'
															: 'border-surface-300-700'}"
													onerror={() => {
														brokenPaths = new Set([
															...brokenPaths,
															imgPath
														])
													}}
												/>
												<!-- Pin overlay buttons on hover -->
												<div
													class="absolute inset-0 flex items-center justify-center gap-0.5 rounded bg-black/60 max-lg:opacity-100 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
												>
													<button
														class="btn btn-sm h-6 min-h-0 px-1.5 py-0 text-xs {leftImage ===
														imgPath
															? 'preset-filled-primary-500'
															: 'preset-tonal-primary'}"
														onclick={() =>
															leftImage ===
															imgPath
																? clearLeft()
																: setLeft(
																		imgPath
																	)}
														title={leftImage ===
														imgPath
															? "Unpin left"
															: "Pin left"}
													>
														<Icons.PanelLeft
															size={10}
														/>
													</button>
													<button
														class="btn btn-sm h-6 min-h-0 px-1.5 py-0 text-xs {rightImage ===
														imgPath
															? 'preset-filled-secondary-500'
															: 'preset-tonal-secondary'}"
														onclick={() =>
															rightImage ===
															imgPath
																? clearRight()
																: setRight(
																		imgPath
																	)}
														title={rightImage ===
														imgPath
															? "Unpin right"
															: "Pin right"}
													>
														<Icons.PanelRight
															size={10}
														/>
													</button>
												</div>
											</div>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
