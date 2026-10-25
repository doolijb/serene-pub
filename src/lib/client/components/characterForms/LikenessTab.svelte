<script lang="ts">
	/**
	 * 🚧 The card form's **Likeness** tab (DESIGN-image-generation §5): how to
	 * draw this character — the **likeness image** a picture model is shown,
	 * the **likeness prompt** (a tag line of their look) and the **likeness
	 * negative** (UI: *Avoid*).
	 *
	 * Not the avatar (the image only *defaults* to it), not a sprite, not the
	 * description. Saved with the rest of the form: the draft is bound, and
	 * the form sends it beside the character (`likeness` on
	 * `characters:create` / `characters:update`).
	 *
	 * The gallery and the sprites are read here, the same requests the Gallery
	 * and Sprites tabs make, and only while this tab is on show. A new
	 * character has neither yet, so it can only use its avatar until saved.
	 */
	import * as Icons from "@lucide/svelte"
	import { SegmentedControl } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { mediaRevUrl } from "$lib/client/utils/media"
	import type { SpriteSetView } from "$lib/shared/sprites"

	export interface LikenessDraft {
		imageMediaId?: number
		prompt: string
		negative: string
	}

	interface Props {
		/** Absent while the character is being created. */
		characterId?: number
		/** Whether the tab is on show — the lists are read only then. */
		active: boolean
		/** The avatar as the form shows it, for the *Avatar* choice. */
		avatarUrl?: string
		likeness: LikenessDraft
	}

	let {
		characterId,
		active,
		avatarUrl,
		likeness = $bindable()
	}: Props = $props()

	const socket = useTypedSocket()

	type Source = "avatar" | "gallery" | "sprite"
	interface Tile {
		id: number
		src: string
		label: string
	}

	let galleryTiles = $state<Tile[]>([])
	let spriteTiles = $state<Tile[]>([])
	let galleryLoaded = $state(false)
	let spritesLoaded = $state(false)

	/** Where the picked image is from — read off the lists, never stored. */
	let pickedSource = $derived<Source>(
		likeness.imageMediaId === undefined
			? "avatar"
			: spriteTiles.some((t) => t.id === likeness.imageMediaId)
				? "sprite"
				: "gallery"
	)
	/** The choice on show; follows the stored pick until a person moves it. */
	let shownSource = $state<Source | null>(null)
	let source = $derived<Source>(shownSource ?? pickedSource)

	let picked = $derived(
		likeness.imageMediaId === undefined
			? null
			: ([...galleryTiles, ...spriteTiles].find(
					(t) => t.id === likeness.imageMediaId
				) ?? null)
	)
	let previewSrc = $derived(
		likeness.imageMediaId === undefined ? avatarUrl : picked?.src
	)

	const SOURCE_LABELS: Record<Source, string> = {
		avatar: "Avatar",
		gallery: "Gallery",
		sprite: "Sprite"
	}

	function handleGallery(msg: Sockets.Characters.ListGallery.Response) {
		if (msg.characterId !== characterId) return
		galleryLoaded = true
		galleryTiles = (msg.images ?? []).map((m) => ({
			id: m.id,
			src: m.thumbUrl,
			label: m.filename ?? "Gallery image"
		}))
	}

	function handleSprites(msg: Sockets.Characters.ListSprites.Response) {
		if (msg.characterId !== characterId) return
		spritesLoaded = true
		spriteTiles = spriteTilesOf(msg.sets ?? [])
	}

	/** Every sprite with an image, default set first, one tile per file. */
	function spriteTilesOf(sets: SpriteSetView[]): Tile[] {
		const seen = new Set<number>()
		const out: Tile[] = []
		for (const set of sets)
			for (const s of [...set.sprites].sort((a, b) =>
				a.label === b.label
					? a.position - b.position
					: a.label.localeCompare(b.label)
			)) {
				if (!s.media || seen.has(s.media.id)) continue
				seen.add(s.media.id)
				out.push({
					id: s.media.id,
					src: mediaRevUrl(s.media.uuid, s.media.rev),
					label: sets.length > 1 ? `${set.name} · ${s.label}` : s.label
				})
			}
		return out
	}

	$effect(() => {
		const id = characterId
		if (!active || id === undefined) return
		const releases = [
			declareInterest<any>(
				interestKey("characters:listGallery", id),
				handleGallery
			),
			declareInterest<any>(
				interestKey("characters:listSprites", id),
				handleSprites
			)
		]
		socket.emit("characters:listGallery", { characterId: id })
		socket.emit("characters:listSprites", { characterId: id })
		return () => {
			for (const release of releases) release()
		}
	})

	function chooseSource(next: Source) {
		shownSource = next
		if (next === "avatar") likeness.imageMediaId = undefined
	}

	function pick(tile: Tile) {
		likeness.imageMediaId = tile.id
	}

	// ── Describe from image (§5, D1) ─────────────────────────────────────
	// Shown only when a model that reads pictures is set up — the server's
	// answer to a probe — and only for a saved character. Fills the Likeness
	// prompt field; the person saves it with the rest of the form, or not.
	let describeAvailable = $state(false)
	let describing = $state(false)
	let describeError = $state<string | null>(null)

	function handleDescribe(msg: Sockets.Characters.DescribeLikeness.Response) {
		if (msg.characterId !== characterId) return
		describeAvailable = !!msg.available
		// Only the press made here fills the field, not another tab's.
		if (typeof msg.prompt === "string" && describing) {
			describing = false
			describeError = null
			likeness.prompt = msg.prompt
		}
	}

	function handleDescribeError(msg: Sockets.ErrorResponse & { characterId?: number }) {
		if (msg.characterId !== characterId || !describing) return
		describing = false
		describeError = msg.error ?? "Could not describe the picture."
	}

	$effect(() => {
		const id = characterId
		if (!active || id === undefined) return
		const releases = [
			declareInterest<any>(
				interestKey("characters:describeLikeness", id),
				handleDescribe
			),
			declareInterest<any>("characters:describeLikeness:error", handleDescribeError)
		]
		socket.emit("characters:describeLikeness", { characterId: id, probe: true })
		return () => {
			for (const release of releases) release()
		}
	})

	function describeFromImage() {
		if (characterId === undefined || describing) return
		describing = true
		describeError = null
		socket.emit("characters:describeLikeness", {
			characterId,
			// The picture the form shows: a pick, or the avatar (`null`).
			imageMediaId: likeness.imageMediaId ?? null
		})
	}

	let tiles = $derived(source === "sprite" ? spriteTiles : galleryTiles)
	let loaded = $derived(source === "sprite" ? spritesLoaded : galleryLoaded)
</script>

<section class="panel-card">
	<h2 class="mb-1 text-sm font-medium">Likeness image</h2>
	<p class="text-surface-600-400 mb-3 text-xs" id="likeness-image-hint">
		The picture an image model is shown so this character comes out looking
		like themselves. It starts as the avatar.
	</p>
	<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
		<div
			class="bg-surface-200-800 flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-base"
		>
			{#if previewSrc}
				<img
					src={previewSrc}
					alt="Likeness for this character"
					class="h-full w-full object-cover"
				/>
			{:else if likeness.imageMediaId !== undefined && (galleryLoaded || spritesLoaded)}
				<span class="text-surface-600-400 px-2 text-center text-xs">
					That image is gone. Pick another, or use the avatar.
				</span>
			{:else}
				<Icons.ScanFace
					size={32}
					class="text-surface-600-400"
					aria-hidden="true"
				/>
			{/if}
		</div>
		<div class="flex min-w-0 flex-1 flex-col gap-2">
			<SegmentedControl
				value={source}
				onValueChange={(d) => chooseSource((d.value ?? "avatar") as Source)}
				aria-describedby="likeness-image-hint"
			>
				<SegmentedControl.Label class="sr-only">
					Where the likeness image comes from
				</SegmentedControl.Label>
				<SegmentedControl.Control>
					<SegmentedControl.Indicator />
					{#each ["avatar", "gallery", "sprite"] as const as option (option)}
						<SegmentedControl.Item
							value={option}
							disabled={option !== "avatar" && characterId === undefined}
						>
							<SegmentedControl.ItemText>
								{SOURCE_LABELS[option]}
							</SegmentedControl.ItemText>
							<SegmentedControl.ItemHiddenInput />
						</SegmentedControl.Item>
					{/each}
				</SegmentedControl.Control>
			</SegmentedControl>
			{#if source === "avatar"}
				<p class="text-surface-600-400 text-xs">
					{#if characterId === undefined}
						Uses the avatar. Save the character to pick from its
						gallery or sprites instead.
					{:else}
						Uses the avatar, and follows it when the avatar changes.
					{/if}
				</p>
			{:else if !loaded}
				<p class="text-surface-600-400 text-xs">Loading…</p>
			{:else if tiles.length === 0}
				<p class="text-surface-600-400 text-xs">
					{source === "sprite"
						? "No sprites with images yet. Add them on the Sprites tab."
						: "No gallery images yet. Add them on the Gallery tab."}
				</p>
			{:else}
				<ul
					class="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2"
					aria-label={source === "sprite" ? "Sprites" : "Gallery images"}
				>
					{#each tiles as tile (tile.id)}
						{@const selected = tile.id === likeness.imageMediaId}
						<li>
							<button
								type="button"
								class="bg-surface-200-800 block aspect-square w-full overflow-hidden rounded-base"
								class:ring-2={selected}
								class:ring-primary-500={selected}
								class:ring-offset-2={selected}
								class:ring-offset-surface-50-950={selected}
								aria-pressed={selected}
								title={tile.label}
								onclick={() => pick(tile)}
							>
								<img
									src={tile.src}
									alt={tile.label}
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</section>

<section class="panel-card">
	<h2 class="mb-3 text-sm font-medium">How they look</h2>
	<div class="flex flex-col gap-4">
		<div class="flex flex-col">
			<label
				class="text-surface-600-400 mb-1.5 text-xs"
				for="charLikenessPrompt"
			>
				Likeness prompt
			</label>
			<input
				id="charLikenessPrompt"
				type="text"
				bind:value={likeness.prompt}
				class="input rounded-base"
				placeholder="adult woman, red braid, green cloak, freckles"
				aria-describedby="charLikenessPromptHint"
			/>
			<p id="charLikenessPromptHint" class="text-surface-600-400 mt-1 text-xs">
				A short list of what can be seen, separated by commas. This line
				does most of the work in every picture of them.
			</p>
			{#if describeAvailable && characterId !== undefined}
				<div class="mt-2 flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="btn btn-sm preset-tonal-primary"
						onclick={describeFromImage}
						disabled={describing}
						aria-describedby="charLikenessDescribeHint"
					>
						{#if describing}
							<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
							Describing…
						{:else}
							<Icons.Eye size={16} aria-hidden="true" />
							Describe from image
						{/if}
					</button>
					<span id="charLikenessDescribeHint" class="text-surface-600-400 text-xs">
						Writes the line from the likeness image. Save to keep it.
					</span>
				</div>
				{#if describeError}
					<p class="text-error-600-400 mt-1 text-xs" role="alert">
						{describeError}
					</p>
				{/if}
			{/if}
		</div>
		<div class="flex flex-col">
			<label
				class="text-surface-600-400 mb-1.5 text-xs"
				for="charLikenessNegative"
			>
				Avoid
			</label>
			<input
				id="charLikenessNegative"
				type="text"
				bind:value={likeness.negative}
				class="input rounded-base"
				placeholder="glasses, beard, modern clothes"
				aria-describedby="charLikenessNegativeHint"
			/>
			<p
				id="charLikenessNegativeHint"
				class="text-surface-600-400 mt-1 text-xs"
			>
				What should never show up in a picture of them. Optional.
			</p>
		</div>
	</div>
</section>
