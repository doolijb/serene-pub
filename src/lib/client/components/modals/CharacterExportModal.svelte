<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import Select from "$lib/client/components/inputs/Select.svelte"

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
			format: "json" | "png" | "charx"
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

	// Lorebooks bound to this character (via lorebookBindings, NOT the same
	// as character.lorebookId) — candidates for the optional "embed a
	// lorebook" export picker.
	let exportableLorebooks: Sockets.Lorebooks.BindingsForCharacter.Response["lorebooks"] =
		$state([])
	let selectedExportLorebookId: number | null = $state(null)

	function handleLorebooksBindingsForCharacter(
		message: Sockets.Lorebooks.BindingsForCharacter.Response
	) {
		if (!character || message.characterId !== character.id) return
		exportableLorebooks = message.lorebooks
	}

	function handleLorebooksBindingsForCharacterError(
		msg: Sockets.ErrorResponse
	) {
		toaster.error({
			title: msg.error || "Failed to fetch lorebooks for this character"
		})
	}

	/**
	 * The one request this modal makes, asked for and listened for in one:
	 * `requestWithInterest` declares the reply's key and THEN emits, on the
	 * same socket and in that order, so the interest sync can never be
	 * overtaken by the request that needs it.
	 *
	 * BARE — `lorebooks:bindingsForCharacter` has no entry in `SCOPED_EVENTS`,
	 * so a `#<id>` key would match no payload at all; the handler's own
	 * `message.characterId !== character.id` check stays the filter. Held only
	 * while the modal is open on a character, released when either changes,
	 * which is what re-running this effect does.
	 */
	$effect(() => {
		if (!open || !character) return
		selectedExportLorebookId = null
		exportableLorebooks = []
		return requestWithInterest(
			"lorebooks:bindingsForCharacter",
			{ characterId: character.id },
			handleLorebooksBindingsForCharacter
		)
	})

	/** Standing for the modal's life, and BARE — errors are never scoped. */
	useInterest<"lorebooks:bindingsForCharacter:error">(
		"lorebooks:bindingsForCharacter:error",
		handleLorebooksBindingsForCharacterError
	)

	function handleExportAsJson() {
		onConfirm({ format: "json", lorebookId: selectedExportLorebookId })
	}

	function handleExportAsPng() {
		onConfirm({ format: "png", lorebookId: selectedExportLorebookId })
	}

	/** CHARX is the one format that carries the character's sprites. */
	function handleExportAsCharx() {
		onConfirm({ format: "charx", lorebookId: selectedExportLorebookId })
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
						<h2 class="mb-2 text-lg font-bold">Export character</h2>
						<p class="mb-4">
							Choose the export format for "{character.nickname ||
								character.name}". Sprites travel in CHARX only.
						</p>
						{#if exportableLorebooks.length > 0}
							<Select
								label="Include a lorebook (optional)"
								class="mb-4 text-sm"
								options={[
									{ value: "", label: "None" },
									...exportableLorebooks.map((lb) => ({
										value: String(lb.id),
										label: lb.name
									}))
								]}
								bind:value={
									() =>
										selectedExportLorebookId == null
											? ""
											: String(selectedExportLorebookId),
									(v) =>
										(selectedExportLorebookId = v
											? Number(v)
											: null)
								}
							/>
						{/if}
						<div class="flex flex-col gap-3">
							<button
								class="btn preset-filled-primary-500 justify-start"
								onclick={handleExportAsJson}
							>
								<Icons.FileText size={20} aria-hidden="true" />
								<span>Export as JSON</span>
							</button>
							<button
								class="btn preset-filled-primary-500 justify-start"
								onclick={handleExportAsCharx}
							>
								<Icons.FileArchive size={20} aria-hidden="true" />
								<span>Export as CHARX, with sprites</span>
							</button>
							{#if avatarSrc(character)}
								<button
									class="btn preset-filled-primary-500 justify-start"
									onclick={handleExportAsPng}
								>
									<Icons.FileImage
										size={20}
										aria-hidden="true"
									/>
									<span>Export as PNG card</span>
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
									<span>Export as PNG card (no avatar)</span>
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
