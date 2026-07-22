<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface ExportablePersona {
		id: number
		name: string
		avatar?: string | null
	}

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		persona: ExportablePersona | null
		onConfirm: (options: { format: "json" | "png" }) => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		persona,
		onConfirm,
		onCancel
	}: Props = $props()

	function handleExportAsJson() {
		onConfirm({ format: "json" })
	}

	function handleExportAsPng() {
		onConfirm({ format: "png" })
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
				{#if persona}
					<div class="p-6">
						<h2 class="mb-2 text-lg font-bold">Export Persona</h2>
						<p class="mb-4">
							Choose the export format for "{persona.name}":
						</p>
						<div class="flex flex-col gap-3">
							<button
								class="btn preset-filled-primary-500 justify-start"
								onclick={handleExportAsJson}
							>
								<Icons.FileText size={20} aria-hidden="true" />
								<span>Export as JSON</span>
							</button>
							{#if persona.avatar}
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
									title="Persona has no avatar image"
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
