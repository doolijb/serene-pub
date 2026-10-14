<!--
	@component
	Pick who speaks: the session's characters, searchable, and — where it is
	wired — the narrator's row (a narrator genre's own turn, else Chat's
	narrate function). Presses go out through `onPickSpeaker` and
	`onNarratorRow`; the search is the caller's (`bind:pickSpeakerSearch`).
-->
<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { characterSummary } from "$lib/shared/characters/characterSummary"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"

	interface Props {
		open: boolean
		onOpenChange: (open: boolean) => void
		/** The session's cast. */
		sessionCharacters:
			| NonNullable<
					Sockets.Sessions.Get.Response["session"]
			  >["sessionCharacters"]
			| undefined
		pickSpeakerSearch: string
		/** The narrator's row is a narrator genre's own turn (`narrate`)… */
		narratorTurn: boolean
		/** …or Chat's narrate function; neither, no row. */
		narratorFunction: boolean
		/** The row's verdict, when it is the narrator's turn. */
		narratorRowChip: { disabled?: boolean; reason?: string } | undefined
		/** What the pipeline's own voice is called (R5) — a narrator genre's turn wears it. */
		ownVoice: string
		/** The narrator's resolved name — Chat's narrate function wears it. */
		narratorName: string
		onNarratorRow: (e: Event) => void
		onPickSpeaker: (characterId: number) => void
	}

	let {
		open,
		onOpenChange,
		sessionCharacters,
		pickSpeakerSearch = $bindable(),
		narratorTurn,
		narratorFunction,
		narratorRowChip,
		ownVoice,
		narratorName,
		onNarratorRow,
		onPickSpeaker
	}: Props = $props()
</script>

<Dialog {open} onOpenChange={(e) => onOpenChange(e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 relative max-h-[95dvh] w-[min(95vw,800px)] space-y-4 overflow-hidden p-4 shadow-xl"
			>
				<header class="mb-2 flex items-center justify-between">
					<h2 class="h2">Pick who speaks</h2>
					<button
						class="btn btn-sm"
						onclick={() => onOpenChange(false)}
					>
						<Icons.X size={20} />
					</button>
				</header>
				<!-- The narrator row (B8): only where it is wired — a narrator
				     genre's own turn (`narrate`), else Chat's narrate function. -->
				{#if narratorTurn || narratorFunction}
					<button
						class="border-surface-200-800 hover:bg-surface-200-800 mb-4 flex w-full items-center gap-3 rounded border p-2"
						class:opacity-60={narratorRowChip?.disabled}
						class:cursor-not-allowed={narratorRowChip?.disabled}
						aria-disabled={narratorRowChip?.disabled}
						title={narratorRowChip?.reason
							? `${narratorTurn ? ownVoice : narratorName} — ${narratorRowChip.reason}`
							: undefined}
						onclick={onNarratorRow}
					>
						<div
							class="bg-primary-500/10 text-primary-500 shrink-0 rounded-lg p-2"
						>
							<Icons.CloudSun size={20} />
						</div>
						<div class="flex-1 text-left">
							<!-- A narrator genre's turn is the own voice's (R5): the
							     Lair's reads "Castellan". Chat's narrate function
							     keeps the narrator's name. -->
							<div class="font-semibold">
								{narratorTurn ? ownVoice : narratorName}
							</div>
							<div class="text-surface-700-300 text-xs">
								{#if narratorRowChip?.reason}
									{narratorRowChip.reason}
								{:else if narratorTurn}
									Let {ownVoice} take the turn instead
								{:else}
									Narrate the environment, atmosphere, or side
									characters instead
								{/if}
							</div>
						</div>
					</button>
				{/if}
				<div class="mb-4">
					<PanelFilterInput
						bind:value={pickSpeakerSearch}
						placeholder="characters"
						count={sessionCharacters?.length ?? 0}
						aria-label="Search characters"
					/>
				</div>
				<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
					<div
						class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap"
					>
						{#each (sessionCharacters || []).filter((cc) => {
							const c = cc.character
							if (!c) return false
							const s = pickSpeakerSearch.trim().toLowerCase()
							if (!s) return true
							return c.name
									?.toLowerCase()
									.includes(s) || c.nickname
									?.toLowerCase()
									.includes(s) || c.description
									?.toLowerCase()
									.includes(s) || c.creatorNotes
									?.toLowerCase()
									.includes(s)
						}) as filtered}
							<div class="flex p-1 lg:basis-1/2">
								<button
									class="border-surface-200-800 hover:bg-surface-200-800 relative flex w-full gap-3 overflow-hidden rounded border p-2"
									onclick={() =>
										onPickSpeaker(filtered.character.id)}
								>
									<div class="w-fit shrink-0">
										<Avatar
											char={filtered.character}
											size="lg"
											decorative
										/>
									</div>
									<div
										class="relative flex w-0 min-w-0 flex-1 flex-col"
									>
										<div
											class="w-full truncate text-left font-semibold"
										>
											{filtered.character.nickname ||
												filtered.character.name}
										</div>
										<div
											class="text-surface-700-300 line-clamp-2 w-full text-left text-xs"
										>
											{characterSummary(filtered.character) || "No description"}
										</div>
									</div>
								</button>
							</div>
						{/each}
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
