<!--
	View-only image lightbox for a character/persona's gallery — used both
	from EntityGalleryTab.svelte (editing a character/persona) and from a
	session message avatar click. Clicking a thumbnail only swaps the large
	preview; it never sets the avatar. Setting an avatar is a separate,
	already-correct action that lives in EntityGalleryTab.svelte (its own
	"Set as Avatar" control, wired to characters:setAvatar/personas:setAvatar)
	— keep it that way. Mixing "browse images" and "change my avatar" into
	one click here was flagged and rejected as an anti-pattern: a user
	casually looking at a character's gallery in session shouldn't risk
	silently changing their avatar.
-->
<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onMount } from "svelte"

	interface Entity {
		type: "character" | "persona"
		id: number
		name: string
		avatarMediaId?: number | null
		avatar?: string | null
	}

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		entity?: Entity | null
		// Single-image mode — e.g. a session message's inline image. Bypasses
		// the gallery fetch entirely and hides the thumbnail strip.
		image?: string | null
	}

	let {
		open = $bindable(),
		onOpenChange,
		entity = null,
		image = null
	}: Props = $props()

	const socket = useTypedSocket()
	let images = $state<Sockets.Media[]>([])
	let selectedSrc = $state<string | null>(null)
	let loading = $state(false)
	let brokenIds = $state(new Set<number>())
	// Track which entity ID we requested so we can discard stale responses
	let pendingId = $state<number | null>(null)

	// Fetch gallery whenever modal opens or entity changes
	$effect(() => {
		if (!open) {
			// Reset on close so neither mode's state leaks into this
			// instance's next open, regardless of which mode was active.
			selectedSrc = null
			images = []
			loading = false
			brokenIds = new Set()
			pendingId = null
			return
		}
		// entity takes precedence if a caller somehow sets both — the two
		// current call sites never do, but this makes the precedence
		// explicit rather than accidental.
		if (entity) {
			images = []
			brokenIds = new Set()
			// The large view wants the original, not the 320px thumbnail.
			selectedSrc = avatarSrc(entity, { full: true }) ?? null
			loading = true
			pendingId = entity.id
			if (entity.type === "character") {
				socket.emit("characters:listGallery", {
					characterId: entity.id
				})
			} else {
				socket.emit("personas:listGallery", { personaId: entity.id })
			}
		} else if (image) {
			selectedSrc = image
			images = []
			loading = false
		}
	})

	onMount(() => {
		const charHandler = (data: Sockets.Characters.ListGallery.Response) => {
			if (
				!open ||
				entity?.type !== "character" ||
				entity.id !== pendingId ||
				data.characterId !== entity.id
			)
				return
			// No "ensure the avatar is in the list" step any more: an avatar
			// IS a media row stamped with this character's id, so the gallery
			// query already returns it (28 §2 — role is a pointer, not a
			// separate place to store an image).
			images = data.images
			loading = false
		}

		const personaHandler = (
			data: Sockets.Personas.ListGallery.Response
		) => {
			if (
				!open ||
				entity?.type !== "persona" ||
				entity.id !== pendingId ||
				data.personaId !== entity.id
			)
				return
			images = data.images
			loading = false
		}

		socket.on("characters:listGallery", charHandler)
		socket.on("personas:listGallery", personaHandler)

		return () => {
			socket.off("characters:listGallery", charHandler)
			socket.off("personas:listGallery", personaHandler)
		}
	})
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 flex max-h-[92vh] w-[min(95vw,1000px)] flex-col space-y-4 border p-4 shadow-xl"
			>
				<header class="flex shrink-0 items-center justify-between">
					<h2 class="h2">
						{entity?.name ?? (image ? "Image" : "Avatar")}
					</h2>
					<button
						class="btn btn-sm"
						onclick={() => onOpenChange({ open: false })}
					>
						<Icons.X size={20} />
					</button>
				</header>

				<article
					class="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto"
				>
					<!-- Main image -->
					{#if selectedSrc}
						<img
							src={selectedSrc}
							alt={entity?.name ?? (image ? "Image" : "Avatar")}
							class="border-surface-300-700 max-h-[72vh] max-w-full shrink-0 rounded-lg border object-contain"
						/>
					{:else}
						<div class="text-surface-700-300 py-12 text-sm">
							No image available.
						</div>
					{/if}

					<!-- Gallery strip — never rendered in single-image mode -->
					{#if entity && loading}
						<div
							class="text-surface-700-300 flex shrink-0 items-center gap-2 text-sm"
						>
							<Icons.Loader size={16} class="animate-spin" />
							Loading gallery…
						</div>
					{:else if entity && images.length > 0}
						<div class="flex w-full shrink-0 flex-wrap gap-2">
							{#each images as img (img.id)}
								{#if !brokenIds.has(img.id)}
									<button
										class="overflow-hidden rounded border-2 transition-colors {selectedSrc ===
										img.url
											? 'border-primary-500'
											: 'border-surface-300-700 hover:border-surface-500'}"
										onclick={() => (selectedSrc = img.url)}
										title="View"
									>
										<!-- Strip uses the thumbnail; clicking
										     swaps the large view to the
										     original. -->
										<img
											src={img.thumbUrl}
											alt=""
											class="h-16 w-16 object-cover"
											loading="lazy"
											onerror={() => {
												brokenIds = new Set([
													...brokenIds,
													img.id
												])
											}}
										/>
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</article>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
