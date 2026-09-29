<script lang="ts">
	/**
	 * **Change sprite** (DESIGN-sprites §6): a person picks the face one line
	 * shows. Self-contained — it asks for the speaker's sprites itself
	 * (`characters:listSprites`) and sends the pick itself
	 * (`sessionMessages:setSprite`), so the message menu only has to open it.
	 *
	 * The pick runs `core:spec/show-sprite`: receipted, emits `sprite-shown`,
	 * and a sprite picker never overwrites it afterwards.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { mediaRevUrl } from "$lib/client/utils/media"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import type { ShownSprite, SpriteSetView } from "$lib/shared/sprites"

	interface Props {
		open: boolean
		messageId: number
		characterId: number
		/** Shown in the copy when known. */
		characterName?: string
		/** What the line shows now, if anything. */
		current: ShownSprite | null
		onClose: () => void
	}

	let { open, messageId, characterId, characterName, current, onClose }: Props =
		$props()

	const socket = useTypedSocket()

	let sets = $state<SpriteSetView[]>([])
	let loading = $state(true)
	let setValue = $state<string | null>(null)
	let sending = $state(false)

	let activeSet = $derived(
		sets.find((s) => String(s.id) === setValue) ?? sets[0] ?? null
	)
	/** One tile per sprite label: its first variant with an image. */
	let tiles = $derived.by(() => {
		const byLabel = new Map<string, { label: string; src: string }>()
		for (const s of [...(activeSet?.sprites ?? [])].sort(
			(a, b) => a.position - b.position
		)) {
			if (!s.media || byLabel.has(s.label)) continue
			byLabel.set(s.label, {
				label: s.label,
				src: mediaRevUrl(s.media.uuid, s.media.rev)
			})
		}
		return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label))
	})

	function handleList(msg: Sockets.Characters.ListSprites.Response) {
		if (msg.characterId !== characterId) return
		loading = false
		sets = msg.sets
		const shown = current ? sets.find((s) => s.name === current.set) : null
		setValue = String((shown ?? sets[0])?.id ?? "")
	}

	function handleListError(msg: { characterId?: number }) {
		if (msg.characterId !== characterId) return
		loading = false
	}

	function handleResult(msg: Sockets.SessionMessages.SetSprite.Response) {
		if (!sending) return
		if (msg.sessionMessage && msg.sessionMessage.id !== messageId) return
		sending = false
		if (msg.error) toaster.error({ title: msg.error })
		else onClose()
	}

	$effect(() => {
		if (!open) return
		const id = characterId
		loading = true
		const releases = [
			declareInterest<any>(interestKey("characters:listSprites", id), handleList),
			declareInterest<any>("characters:listSprites:error", handleListError),
			declareInterest<any>("sessionMessages:setSprite", handleResult)
		]
		socket.emit("characters:listSprites", { characterId: id })
		return () => {
			for (const release of releases) release()
		}
	})

	function pick(label: string | null) {
		sending = true
		socket.emit("sessionMessages:setSprite", {
			id: messageId,
			sprite: label && activeSet ? { set: activeSet.name, label } : null
		})
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) onClose()
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 w-[min(95vw,560px)] space-y-4 p-6 shadow-xl"
			>
				<header class="flex items-center gap-3">
					<Icons.Drama class="h-5 w-5 shrink-0" aria-hidden="true" />
					<h2 class="text-lg font-bold">Change sprite</h2>
				</header>
				<p class="text-surface-600-400 text-sm">
					Choose the face {characterName ?? "the character"} shows on this line.
					The automatic picker won't change it afterwards.
				</p>

				{#if loading}
					<div class="flex justify-center py-6" role="status">
						<Icons.Loader2 class="h-6 w-6 animate-spin" aria-hidden="true" />
						<span class="sr-only">Loading sprites</span>
					</div>
				{:else if sets.length === 0}
					<p class="text-surface-600-400 text-sm">
						No sprites yet. Add some in the character's Sprites tab.
					</p>
				{:else}
					{#if sets.length > 1}
						<Select
							label="Sprite set"
							options={sets.map((s) => ({ value: String(s.id), label: s.name }))}
							bind:value={setValue}
						/>
					{/if}
					<ul
						class="grid max-h-[50vh] grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 overflow-y-auto"
					>
						{#each tiles as tile (tile.label)}
							{@const isCurrent =
								current?.set === activeSet?.name && current?.label === tile.label}
							<li>
								<button
									type="button"
									class="flex w-full flex-col items-center gap-1 rounded-lg border-2 p-1 text-xs
										{isCurrent
										? 'border-primary-500 preset-tonal-primary'
										: 'border-surface-300-700 hover:border-primary-500'}"
									aria-pressed={isCurrent}
									disabled={sending}
									onclick={() => pick(tile.label)}
								>
									<img
										src={tile.src}
										alt=""
										class="aspect-square w-full rounded object-cover"
										loading="lazy"
									/>
									<span class="w-full truncate">{tile.label}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<footer class="flex justify-between gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						disabled={sending || !current}
						onclick={() => pick(null)}
					>
						Show no sprite
					</button>
					<button type="button" class="btn preset-tonal-surface" onclick={onClose}>
						Cancel
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
