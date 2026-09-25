<script lang="ts">
	/**
	 * The character's **Sprites** tab (DESIGN-sprites §7): its sprite sets, and
	 * in each set its sprites grouped by sprite label, variants side by side.
	 *
	 * Reads `characters:listSprites`; every write answers with the whole list,
	 * so this panel never merges a delta — it replaces `sets` on each reply.
	 * The family is scoped on `characterId` (SCOPED_EVENTS), so the interest
	 * keys are re-declared when the panel is pointed at another character.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { mediaRevUrl } from "$lib/client/utils/media"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		spriteLabelFromFilename,
		normalizeSpriteName,
		type SpriteSetView,
		type SpriteView
	} from "$lib/shared/sprites"

	interface Props {
		characterId: number
		characterName: string
		isOwner: boolean
	}

	let { characterId, characterName, isOwner }: Props = $props()

	const socket = useTypedSocket()

	let sets = $state<SpriteSetView[]>([])
	let isLoading = $state(true)
	let pendingUploads = $state(0)
	let activeSetValue = $state<string | null>(null)

	let activeSet = $derived(
		sets.find((s) => String(s.id) === activeSetValue) ?? sets[0] ?? null
	)
	let setOptions = $derived(
		sets.map((s) => ({
			value: String(s.id),
			label: s.isDefault ? `${s.name} (default)` : s.name
		}))
	)

	/** The active set's sprites grouped by label, labels alphabetical. */
	let groups = $derived.by(() => {
		const by = new Map<string, SpriteView[]>()
		for (const sprite of activeSet?.sprites ?? []) {
			const list = by.get(sprite.label) ?? []
			list.push(sprite)
			by.set(sprite.label, list)
		}
		return [...by.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([label, sprites]) => ({
				label,
				sprites: sprites.sort((a, b) => a.position - b.position)
			}))
	})
	let imageCount = $derived(
		(activeSet?.sprites ?? []).filter((s) => s.media).length
	)

	// ── Upload ────────────────────────────────────────────────────────────
	let bulkInput: HTMLInputElement
	let slotInput: HTMLInputElement
	/** The label a slot or "add variant" upload goes to. */
	let slotLabel = $state<string | null>(null)

	async function sendFile(file: File, label: string) {
		if (!file.type.startsWith("image/")) {
			toaster.error({ title: `${file.name} is not an image` })
			return
		}
		pendingUploads++
		const buffer = await file.arrayBuffer()
		socket.emit("characters:uploadSprite", {
			characterId,
			setId: activeSet?.id,
			label,
			imageFile: new Uint8Array(buffer) as any,
			filename: file.name
		})
	}

	/** Several files at once, each labelled by its filename (SillyTavern's rule). */
	async function handleBulk(e: Event) {
		const input = e.target as HTMLInputElement
		const files = [...(input.files ?? [])]
		input.value = ""
		for (const file of files) {
			const label = spriteLabelFromFilename(file.name)
			if (!label) continue
			await sendFile(file, label)
		}
	}

	function uploadInto(label: string) {
		slotLabel = label
		slotInput?.click()
	}

	async function handleSlot(e: Event) {
		const input = e.target as HTMLInputElement
		const file = input.files?.[0]
		input.value = ""
		if (!file || !slotLabel) return
		await sendFile(file, slotLabel)
		slotLabel = null
	}

	function addStandardSet() {
		socket.emit("characters:addStandardSprites", {
			characterId,
			setId: activeSet?.id
		})
	}

	// ── Sprite actions ───────────────────────────────────────────────────
	let menuOpenFor = $state<number | null>(null)

	function makePrimary(label: string, sprite: SpriteView) {
		menuOpenFor = null
		const group = groups.find((g) => g.label === label)
		if (!group || !activeSet) return
		const ids = [sprite.id, ...group.sprites.filter((s) => s.id !== sprite.id).map((s) => s.id)]
		socket.emit("characters:reorderSprites", {
			characterId,
			setId: activeSet.id,
			label,
			spriteIds: ids
		})
	}

	function moveTo(sprite: SpriteView, setId: number) {
		menuOpenFor = null
		socket.emit("characters:updateSprite", {
			characterId,
			spriteId: sprite.id,
			setId
		})
	}

	// Relabel: one small dialog, used for a single sprite.
	let relabelFor = $state<SpriteView | null>(null)
	let relabelText = $state("")
	function openRelabel(sprite: SpriteView) {
		menuOpenFor = null
		relabelFor = sprite
		relabelText = sprite.label
	}
	function confirmRelabel() {
		const label = normalizeSpriteName(relabelText)
		if (!relabelFor || !label) return
		socket.emit("characters:updateSprite", {
			characterId,
			spriteId: relabelFor.id,
			label
		})
		relabelFor = null
	}

	let deleteFor = $state<SpriteView | null>(null)
	function openDelete(sprite: SpriteView) {
		menuOpenFor = null
		deleteFor = sprite
	}
	function confirmDelete() {
		if (!deleteFor) return
		socket.emit("characters:deleteSprite", {
			characterId,
			spriteId: deleteFor.id
		})
		deleteFor = null
	}

	// ── Set actions ──────────────────────────────────────────────────────
	let setMenuOpen = $state(false)
	/** "new" | "rename" | null — one name dialog serves both. */
	let nameDialog = $state<"new" | "rename" | null>(null)
	let nameText = $state("")
	let deleteSetOpen = $state(false)

	function openNewSet() {
		setMenuOpen = false
		nameText = ""
		nameDialog = "new"
	}
	function openRenameSet() {
		setMenuOpen = false
		nameText = activeSet?.name ?? ""
		nameDialog = "rename"
	}
	function confirmName() {
		const name = normalizeSpriteName(nameText)
		if (!name) return
		if (nameDialog === "new") {
			pendingNewSet = name
			socket.emit("characters:createSpriteSet", { characterId, name })
		} else if (nameDialog === "rename" && activeSet) {
			socket.emit("characters:updateSpriteSet", {
				characterId,
				setId: activeSet.id,
				name
			})
		}
		nameDialog = null
	}
	/** A set just created, selected when its list arrives. */
	let pendingNewSet = $state<string | null>(null)

	function makeDefault() {
		setMenuOpen = false
		if (!activeSet) return
		socket.emit("characters:updateSpriteSet", {
			characterId,
			setId: activeSet.id,
			makeDefault: true
		})
	}
	function confirmDeleteSet() {
		deleteSetOpen = false
		if (!activeSet) return
		socket.emit("characters:deleteSpriteSet", {
			characterId,
			setId: activeSet.id
		})
	}

	// ── Replies ──────────────────────────────────────────────────────────
	function handleList(msg: Sockets.Characters.ListSprites.Response) {
		if (msg.characterId !== characterId) return
		isLoading = false
		sets = msg.sets
		if (pendingNewSet) {
			const made = sets.find((s) => s.name === pendingNewSet)
			if (made) activeSetValue = String(made.id)
			pendingNewSet = null
		}
		if (!sets.some((s) => String(s.id) === activeSetValue)) {
			activeSetValue = sets[0] ? String(sets[0].id) : null
		}
	}
	function handleUploaded(msg: Sockets.Characters.UploadSprite.Response) {
		if (msg.characterId !== characterId) return
		pendingUploads = Math.max(0, pendingUploads - 1)
		handleList(msg)
	}
	function handleStandard(msg: Sockets.Characters.AddStandardSprites.Response) {
		if (msg.characterId !== characterId) return
		handleList(msg)
		toaster.success({
			title:
				msg.added > 0
					? `Added ${msg.added} empty sprites`
					: "The standard set is already here"
		})
	}
	function handleError(msg: { error?: string; characterId?: number }) {
		if (msg.characterId !== characterId) return
		// A failed list must not leave the spinner up forever.
		isLoading = false
		toaster.error({ title: msg.error || "That did not work" })
	}
	function handleUploadError(msg: { error?: string; characterId?: number }) {
		if (msg.characterId !== characterId) return
		pendingUploads = Math.max(0, pendingUploads - 1)
		handleError(msg)
	}

	const LIST_EVENTS = [
		"characters:listSprites",
		"characters:createSpriteSet",
		"characters:updateSpriteSet",
		"characters:deleteSpriteSet",
		"characters:updateSprite",
		"characters:deleteSprite",
		"characters:reorderSprites"
	] as const

	/** The `:error` twins, named literally so each is findable where it is heard. */
	const LIST_ERROR_EVENTS = [
		"characters:listSprites:error",
		"characters:createSpriteSet:error",
		"characters:updateSpriteSet:error",
		"characters:deleteSpriteSet:error",
		"characters:updateSprite:error",
		"characters:deleteSprite:error",
		"characters:reorderSprites:error"
	] as const

	/**
	 * Every reply is standing, not one-shot: another tab's edit to this
	 * character arrives as the same list. Declared in one effect so pointing
	 * the panel at another character releases the old keys as it takes the new.
	 * The `:error` twins are never gated and stay bare; `handleError` filters
	 * them on `characterId`.
	 */
	$effect(() => {
		const id = characterId
		isLoading = true
		sets = []
		const releases: (() => void)[] = [
			...LIST_EVENTS.map((event) =>
				declareInterest<any>(interestKey(event, id), handleList)
			),
			declareInterest<any>(
				interestKey("characters:uploadSprite", id),
				handleUploaded
			),
			declareInterest<any>(
				interestKey("characters:addStandardSprites", id),
				handleStandard
			),
			...LIST_ERROR_EVENTS.map((event) =>
				declareInterest<any>(event, handleError)
			),
			declareInterest<any>("characters:uploadSprite:error", handleUploadError),
			declareInterest<any>("characters:addStandardSprites:error", handleError)
		]
		socket.emit("characters:listSprites", { characterId: id })
		return () => {
			for (const release of releases) release()
		}
	})

	// ── Test a line ──────────────────────────────────────────────────────
	/**
	 * What the automatic picker would choose for a line, in the set on
	 * screen — the line alone, with no previous face to stick to.
	 */
	let testText = $state("")
	let testResult = $state<Sockets.Characters.TestSprite.Response | null>(null)
	let testing = $state(false)
	function runTest() {
		const text = testText.trim()
		if (!text) return
		testing = true
		socket.emit("characters:testSprite", {
			characterId,
			setId: activeSet?.id,
			text
		})
	}
	function handleTest(msg: Sockets.Characters.TestSprite.Response) {
		if (msg.characterId !== characterId) return
		testing = false
		testResult = msg
	}
	$effect(() => {
		const release = declareInterest<any>(
			interestKey("characters:testSprite", characterId),
			handleTest
		)
		return release
	})

	const thumb = (sprite: SpriteView) =>
		sprite.media ? mediaRevUrl(sprite.media.uuid, sprite.media.rev) : null
</script>

<div class="space-y-3">
	{#if isOwner}
		<input
			bind:this={bulkInput}
			type="file"
			accept="image/*"
			multiple
			class="hidden"
			onchange={handleBulk}
		/>
		<input
			bind:this={slotInput}
			type="file"
			accept="image/*"
			class="hidden"
			onchange={handleSlot}
		/>
	{/if}

	{#if isLoading}
		<div class="flex items-center justify-center py-6" role="status">
			<Icons.Loader2 class="text-surface-500 h-6 w-6 animate-spin" />
			<span class="sr-only">Loading sprites</span>
		</div>
	{:else if sets.length === 0}
		<EmptyState
			icon={Icons.Drama}
			message={isOwner
				? `Give ${characterName} a face for each mood, outfit or pose. Images are labelled by their file names.`
				: `${characterName} has no sprites.`}
			ctaLabel={isOwner ? "Upload images" : undefined}
			onCta={isOwner ? () => bulkInput?.click() : undefined}
		/>
		{#if isOwner}
			<p class="text-surface-500 text-center text-xs">
				Or
				<button type="button" class="anchor" onclick={addStandardSet}>
					start from the standard set
				</button>
				of 28 empty emotions.
			</p>
		{/if}
	{:else}
		<div class="flex flex-wrap items-end gap-2">
			<Select
				label="Sprite set"
				options={setOptions}
				bind:value={activeSetValue}
				class="min-w-40 flex-1"
			/>
			{#if isOwner}
				<Popover
					open={setMenuOpen}
					onOpenChange={(e) => (setMenuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn btn-sm preset-tonal-surface"
						aria-label="Sprite set options"
					>
						<Icons.EllipsisVertical size={16} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-primary-200-800 w-[min(90vw,220px)] space-y-3 p-3 shadow-xl"
							>
								<header class="popover-menu-title">
									<Icons.Layers size={16} aria-hidden="true" />
									<p>Sprite set</p>
								</header>
								<article class="flex flex-col gap-2">
									<button
										type="button"
										class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
										onclick={openNewSet}
									>
										<Icons.Plus size={16} aria-hidden="true" />
										<span>New set</span>
									</button>
									<button
										type="button"
										class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
										onclick={openRenameSet}
									>
										<Icons.Pencil size={16} aria-hidden="true" />
										<span>Rename set</span>
									</button>
									{#if activeSet && !activeSet.isDefault}
										<button
											type="button"
											class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
											onclick={makeDefault}
										>
											<Icons.Star size={16} aria-hidden="true" />
											<span>Make default</span>
										</button>
									{/if}
									<button
										type="button"
										class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
										onclick={() => {
											setMenuOpen = false
											addStandardSet()
										}}
									>
										<Icons.ListPlus size={16} aria-hidden="true" />
										<span>Add the standard set</span>
									</button>
									<button
										type="button"
										class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
										onclick={() => {
											setMenuOpen = false
											deleteSetOpen = true
										}}
									>
										<Icons.Trash2 size={16} aria-hidden="true" />
										<span>Delete set</span>
									</button>
								</article>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					onclick={() => bulkInput?.click()}
					disabled={pendingUploads > 0}
				>
					{#if pendingUploads > 0}
						<Icons.Loader2 size={16} class="animate-spin" aria-hidden="true" />
					{:else}
						<Icons.Upload size={16} aria-hidden="true" />
					{/if}
					Upload
				</button>
			{/if}
		</div>

		<p class="text-surface-500 text-xs">
			{groups.length} labels, {imageCount} images. Uploaded images are labelled
			by file name: <code>joy.png</code> and <code>joy-2.png</code> are both
			"joy".
		</p>

		{#if groups.length === 0}
			<EmptyState
				icon={Icons.Drama}
				message="This set is empty."
				ctaLabel={isOwner ? "Upload images" : undefined}
				onCta={isOwner ? () => bulkInput?.click() : undefined}
			/>
		{:else}
			<ul class="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
				{#each groups as group (group.label)}
					<li class="panel-card space-y-1.5 p-2">
						<p class="truncate text-sm font-medium" title={group.label}>
							{group.label}
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each group.sprites as sprite (sprite.id)}
								{@const src = thumb(sprite)}
								<div
									class="border-surface-300-700 relative h-16 w-16 overflow-hidden rounded-md border"
								>
									{#if src}
										<img
											{src}
											alt="{group.label} sprite"
											class="h-full w-full object-cover"
											loading="lazy"
										/>
									{:else if isOwner}
										<button
											type="button"
											class="text-surface-500 hover:text-primary-500 flex h-full w-full items-center justify-center border-2 border-dashed"
											onclick={() => uploadInto(group.label)}
											aria-label="Upload an image for {group.label}"
										>
											<Icons.ImagePlus size={20} aria-hidden="true" />
										</button>
									{:else}
										<div
											class="text-surface-500 flex h-full w-full items-center justify-center"
											aria-label="No image yet"
										>
											<Icons.ImageOff size={18} aria-hidden="true" />
										</div>
									{/if}

									{#if isOwner}
										<div class="absolute top-0.5 right-0.5">
											<Popover
												open={menuOpenFor === sprite.id}
												onOpenChange={(e) =>
													(menuOpenFor = e.open ? sprite.id : null)}
												positioning={{ placement: "bottom-end" }}
											>
												<Popover.Trigger
													class="bg-surface-950/60 hover:bg-primary-600-400 rounded-full p-0.5 text-white"
													aria-label="Options for this {group.label} sprite"
												>
													<Icons.EllipsisVertical class="h-3 w-3" />
												</Popover.Trigger>
												<Portal>
													<Popover.Positioner class="z-[1000]!">
														<Popover.Content
															class="card bg-primary-200-800 w-[min(90vw,220px)] space-y-3 p-3 shadow-xl"
														>
															<header class="popover-menu-title">
																<Icons.Drama size={16} aria-hidden="true" />
																<p>{group.label}</p>
															</header>
															<article class="flex flex-col gap-2">
																{#if sprite.position > 0 || group.sprites[0].id !== sprite.id}
																	<button
																		type="button"
																		class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
																		onclick={() => makePrimary(group.label, sprite)}
																	>
																		<Icons.ArrowUpToLine size={16} aria-hidden="true" />
																		<span>Make first</span>
																	</button>
																{/if}
																<button
																	type="button"
																	class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
																	onclick={() => {
																		menuOpenFor = null
																		uploadInto(group.label)
																	}}
																>
																	<Icons.ImagePlus size={16} aria-hidden="true" />
																	<span>{sprite.media ? "Add a variant" : "Upload an image"}</span>
																</button>
																<button
																	type="button"
																	class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
																	onclick={() => openRelabel(sprite)}
																>
																	<Icons.Tag size={16} aria-hidden="true" />
																	<span>Change label</span>
																</button>
																{#each sets.filter((s) => s.id !== activeSet?.id) as other (other.id)}
																	<button
																		type="button"
																		class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
																		onclick={() => moveTo(sprite, other.id)}
																	>
																		<Icons.FolderInput size={16} aria-hidden="true" />
																		<span>Move to {other.name}</span>
																	</button>
																{/each}
																<button
																	type="button"
																	class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
																	onclick={() => openDelete(sprite)}
																>
																	<Icons.Trash2 size={16} aria-hidden="true" />
																	<span>Delete</span>
																</button>
															</article>
														</Popover.Content>
													</Popover.Positioner>
												</Portal>
											</Popover>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<section class="panel-card space-y-2 p-3" aria-labelledby="sprite-test-title">
			<h3 id="sprite-test-title" class="text-sm font-medium">Try a line</h3>
			<p class="text-surface-500 text-xs">
				See which sprite a reply like this would show. Replies choose a sprite
				automatically when an embedding model is loaded.
			</p>
			<form
				class="flex gap-2"
				onsubmit={(e) => {
					e.preventDefault()
					runTest()
				}}
			>
				<label class="sr-only" for="sprite-test-line">A line to test</label>
				<input
					id="sprite-test-line"
					class="input min-w-0 flex-1"
					type="text"
					bind:value={testText}
					placeholder="I can't believe you came back for me."
				/>
				<button
					type="submit"
					class="btn preset-tonal-primary"
					disabled={testing || !testText.trim()}
				>
					{#if testing}
						<Icons.Loader2 size={16} class="animate-spin" aria-hidden="true" />
					{/if}
					Try it
				</button>
			</form>
			{#if testResult}
				<p class="text-sm" role="status">
					{#if testResult.pick}
						Shows <strong>{testResult.pick.label}</strong>
						(similarity {testResult.pick.score.toFixed(2)}{#if testResult.pick.runnerUp},
							then {testResult.pick.runnerUp.label}
							{testResult.pick.runnerUp.score.toFixed(2)}{/if}).
					{:else}
						{testResult.reason ?? "No sprite would be chosen."}
					{/if}
				</p>
			{/if}
		</section>
	{/if}
</div>

<!-- One name dialog for a new set and a rename. -->
<Dialog
	open={nameDialog !== null}
	onOpenChange={(e) => {
		if (!e.open) nameDialog = null
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 w-full max-w-sm space-y-4 p-6 shadow-xl">
				<h2 class="text-lg font-bold">
					{nameDialog === "new" ? "New sprite set" : "Rename sprite set"}
				</h2>
				<form
					class="space-y-4"
					onsubmit={(e) => {
						e.preventDefault()
						confirmName()
					}}
				>
					<label class="label">
						<span class="label-text">Name</span>
						<input
							class="input"
							type="text"
							bind:value={nameText}
							placeholder="armour, winter, young"
							maxlength={64}
						/>
					</label>
					{#if nameDialog === "rename"}
						<p class="text-surface-500 text-xs">
							Cast members in a lorebook choose a set by name. Any that chose
							"{activeSet?.name}" will show the default set until they are
							pointed at the new name.
						</p>
					{/if}
					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={() => (nameDialog = null)}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							disabled={!normalizeSpriteName(nameText)}
						>
							{nameDialog === "new" ? "Create" : "Rename"}
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<Dialog
	open={relabelFor !== null}
	onOpenChange={(e) => {
		if (!e.open) relabelFor = null
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 w-full max-w-sm space-y-4 p-6 shadow-xl">
				<h2 class="text-lg font-bold">Change label</h2>
				<form
					class="space-y-4"
					onsubmit={(e) => {
						e.preventDefault()
						confirmRelabel()
					}}
				>
					<label class="label">
						<span class="label-text">Sprite label</span>
						<input
							class="input"
							type="text"
							bind:value={relabelText}
							placeholder="joy, swimsuit, sleeping"
							maxlength={64}
						/>
					</label>
					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={() => (relabelFor = null)}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn preset-filled-primary-500"
							disabled={!normalizeSpriteName(relabelText)}
						>
							Save
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<Dialog
	open={deleteFor !== null}
	onOpenChange={(e) => {
		if (!e.open) deleteFor = null
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 max-w-sm space-y-4 p-6 shadow-xl">
				<header class="flex items-center gap-3">
					<Icons.Trash2 class="text-error-500 h-5 w-5 shrink-0" aria-hidden="true" />
					<h2 class="text-lg font-bold">Delete sprite</h2>
				</header>
				<p class="text-surface-600-400 text-sm">
					Delete this "{deleteFor?.label}" sprite? This cannot be undone. Lines
					that showed it fall back to another sprite, or the avatar.
				</p>
				<footer class="flex justify-end gap-2">
					<button class="btn preset-tonal-surface" onclick={() => (deleteFor = null)}>
						Cancel
					</button>
					<button class="btn preset-filled-error-500" onclick={confirmDelete}>
						<Icons.Trash2 class="h-4 w-4" aria-hidden="true" />
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<Dialog
	open={deleteSetOpen}
	onOpenChange={(e) => (deleteSetOpen = e.open)}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 max-w-sm space-y-4 p-6 shadow-xl">
				<header class="flex items-center gap-3">
					<Icons.Trash2 class="text-error-500 h-5 w-5 shrink-0" aria-hidden="true" />
					<h2 class="text-lg font-bold">Delete sprite set</h2>
				</header>
				<p class="text-surface-600-400 text-sm">
					Delete "{activeSet?.name}" and its {activeSet?.sprites.length ?? 0}
					sprites? This cannot be undone.
					{#if activeSet?.isDefault && sets.length > 1}
						Make another set the default first.
					{/if}
				</p>
				<footer class="flex justify-end gap-2">
					<button class="btn preset-tonal-surface" onclick={() => (deleteSetOpen = false)}>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={confirmDeleteSet}
						disabled={activeSet?.isDefault && sets.length > 1}
					>
						<Icons.Trash2 class="h-4 w-4" aria-hidden="true" />
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
