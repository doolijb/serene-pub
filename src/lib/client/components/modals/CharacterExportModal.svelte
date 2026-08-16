<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { onMount } from "svelte"

	interface ExportableCharacter {
		id: number
		name: string
		nickname?: string | null
		avatar?: string | null
	}

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		character: ExportableCharacter | null
		onConfirm: (options: {
			format: "json" | "png"
			lorebookId: number | null
		}) => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		character,
		onConfirm,
		onCancel
	}: Props = $props()

	const socket = useTypedSocket()

	// Lorebooks bound to this character (via lorebookBindings, NOT the same
	// as character.lorebookId) — candidates for the optional "embed a
	// lorebook" export picker.
	let exportableLorebooks: Sockets.Lorebooks.BindingsForCharacter.Response["lorebooks"] =
		$state([])
	let selectedExportLorebookId: number | null = $state(null)

	$effect(() => {
		if (open && character) {
			selectedExportLorebookId = null
			exportableLorebooks = []
			socket.emit("lorebooks:bindingsForCharacter", {
				characterId: character.id
			})
		}
	})

	onMount(() => {
		socket.on(
			"lorebooks:bindingsForCharacter",
			(message: Sockets.Lorebooks.BindingsForCharacter.Response) => {
				if (!character || message.characterId !== character.id) return
				exportableLorebooks = message.lorebooks
			}
		)
		socket.on(
			"lorebooks:bindingsForCharacter:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title:
						msg.error ||
						"Failed to fetch lorebooks for this character"
				})
			}
		)

		return () => {
			socket.off("lorebooks:bindingsForCharacter")
			socket.off("lorebooks:bindingsForCharacter:error")
		}
	})

	function handleExportAsJson() {
		onConfirm({ format: "json", lorebookId: selectedExportLorebookId })
	}

	function handleExportAsPng() {
		onConfirm({ format: "png", lorebookId: selectedExportLorebookId })
	}
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
				class="card bg-surface-100-900 w-[min(95vw,560px)] space-y-4 p-4 shadow-xl"
			>
				{#if character}
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Export Character</h2>
						<p class="mb-4">
							Choose the export format for "{character.nickname ||
								character.name}":
						</p>
						{#if exportableLorebooks.length > 0}
							<label
								class="mb-4 block text-sm"
								for="export-lorebook-select"
							>
								<span class="mb-1 block font-semibold">
									Include a lorebook (optional)
								</span>
								<select
									id="export-lorebook-select"
									class="select w-full"
									bind:value={selectedExportLorebookId}
								>
									<option value={null}>None</option>
									{#each exportableLorebooks as lb}
										<option value={lb.id}>{lb.name}</option>
									{/each}
								</select>
							</label>
						{/if}
						<div class="flex flex-col gap-3">
							<button
								class="btn preset-filled-primary-500 justify-start"
								onclick={handleExportAsJson}
							>
								<Icons.FileText size={20} aria-hidden="true" />
								<span>Export as JSON</span>
							</button>
							{#if character.avatar}
								<button
									class="btn preset-filled-primary-500 justify-start"
									onclick={handleExportAsPng}
								>
									<Icons.FileImage
										size={20}
										aria-hidden="true"
									/>
									<span>Export as PNG Card</span>
								</button>
							{:else}
								<button
									class="btn preset-filled-surface-500 justify-start"
									disabled
									title="Character has no avatar image"
								>
									<Icons.FileImage
										size={20}
										aria-hidden="true"
									/>
									<span>Export as PNG Card (No Avatar)</span>
								</button>
							{/if}
						</div>
						<div class="mt-4 flex justify-end gap-2">
							<button
								class="btn preset-filled-surface-500"
								onclick={onCancel}
							>
								Cancel
							</button>
						</div>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
