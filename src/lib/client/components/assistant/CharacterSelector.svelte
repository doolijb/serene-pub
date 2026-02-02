<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	interface CharacterResult {
		id: number
		name: string
		nickname: string | null
		description: string | null
		avatar: string | null
	}

	interface Props {
		chatId: number
		messageId: number
		reasoning: string
		results: CharacterResult[]
		onSelect: () => void
	}

	let { chatId, messageId, reasoning, results, onSelect }: Props = $props()

	const socket = useTypedSocket()

	// Auto-select if only one result
	$effect(() => {
		if (results.length === 1) {
			selectCharacter(results[0].id)
		}
	})

	function selectCharacter(characterId: number) {
		// Send selection to server (using raw emit since it's not in typed socket yet)
		;(socket as any).emit("assistant:selectFunctionResults", {
			chatId,
			selectedIds: [characterId],
			type: "characters"
		})

		// Notify parent
		onSelect()
	}
</script>

<div class="card variant-ghost-surface space-y-4 p-4">
	<div class="space-y-2">
		<h3 class="h4">Assistant Thinking</h3>
		<p class="text-sm opacity-80">{reasoning}</p>
	</div>

	{#if results.length > 1}
		<div class="space-y-2">
			<h4 class="h5">Select a Character</h4>
			<div class="grid grid-cols-1 gap-2">
				{#each results as character}
					<button
						class="btn variant-ghost-surface justify-start"
						onclick={() => selectCharacter(character.id)}
					>
						<div class="flex w-full items-center gap-3">
							{#if character.avatar}
								<img
									src={character.avatar}
									alt={character.name}
									class="h-10 w-10 rounded-full object-cover"
								/>
							{:else}
								<div
									class="bg-surface-500 flex h-10 w-10 items-center justify-center rounded-full"
								>
									<span class="text-lg">
										{character.name.charAt(0)}
									</span>
								</div>
							{/if}
							<div class="flex-1 text-left">
								<div class="font-semibold">
									{character.name}
								</div>
								{#if character.nickname}
									<div class="text-xs opacity-70">
										"{character.nickname}"
									</div>
								{/if}
								{#if character.description}
									<div
										class="line-clamp-1 text-xs opacity-60"
									>
										{character.description}
									</div>
								{/if}
							</div>
						</div>
					</button>
				{/each}
			</div>
		</div>
	{:else if results.length === 0}
		<div class="alert variant-ghost-warning">
			<p>No characters found matching the search.</p>
		</div>
	{/if}
</div>
