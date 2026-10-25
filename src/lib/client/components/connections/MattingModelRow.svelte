<script lang="ts">
	/**
	 * The background remover, as one row in the Models view
	 * (DESIGN-image-generation, loadouts lane B1): the local matting model
	 * (`local_models`, modality `matting`; `server/localModels/matting.ts`)
	 * that cuts a picture's subject from its background.
	 *
	 * It is not a connection's model, so it is not in the flat list above;
	 * it downloads itself on first use. This row says where it stands —
	 * *Not downloaded* · *Downloading n%* · *On disk, 123 MB* · the error —
	 * and offers **Delete from disk** once it is there, asking first (an
	 * `alertdialog`, STYLE-GUIDE §6.6: filled error, it only takes away).
	 *
	 * Asked with `localModels:matting` on mount, and again every few seconds
	 * while a download runs: the server pushes no progress for it.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import { formatSize } from "./modelDisplay"

	type Matting = Sockets.LocalModels.Matting.Response

	let matting = $state<Matting | null>(null)
	let confirming = $state(false)
	let busy = $state(false)
	let error = $state<string | null>(null)

	/** The state, in words. */
	const stateLine = $derived.by(() => {
		if (!matting) return ""
		switch (matting.state) {
			case "not_downloaded":
				return "Not downloaded — it downloads the first time it is used"
			case "downloading":
				return matting.percent != null
					? `Downloading ${Math.round(matting.percent)}%`
					: "Downloading"
			case "on_disk": {
				const size = formatSize(matting.sizeBytes)
				return size ? `On disk, ${size}` : "On disk"
			}
			case "error":
				return matting.error ?? "Couldn't download"
		}
	})

	function ask() {
		typedSocketOrNull()?.emit("localModels:matting", {})
	}

	$effect(() => {
		const releases = [
			declareInterest<"localModels:matting">(
				"localModels:matting",
				(msg) => {
					matting = msg
					busy = false
				}
			),
			declareInterest<"localModels:mattingRemove">(
				"localModels:mattingRemove",
				(msg) => {
					busy = false
					if (!msg.removed) error = "Nothing was on disk to delete."
				}
			),
			declareInterest<"localModels:mattingRemove:error">(
				"localModels:mattingRemove:error",
				(msg) => {
					busy = false
					error = msg.error ?? "Couldn't delete it."
				}
			)
		]
		ask()
		return () => releases.forEach((release) => release())
	})

	// No progress is pushed for this download, so it is asked after.
	$effect(() => {
		if (matting?.state !== "downloading") return
		const timer = setInterval(ask, 3000)
		return () => clearInterval(timer)
	})

	function remove() {
		confirming = false
		busy = true
		error = null
		typedSocketOrNull()?.emit("localModels:mattingRemove", {})
	}
</script>

{#if matting}
	<section class="flex flex-col gap-1" aria-labelledby="models-matting">
		<ListGroupLabel id="models-matting" label="Background remover" />
		<div class="panel-card flex items-center gap-2">
			<div class="min-w-0 flex-1">
				<p class="truncate text-lead font-medium">{matting.name}</p>
				<p
					class="mt-0.5 truncate text-xs {matting.state === 'error'
						? 'text-error-600-400'
						: 'text-surface-600-400'}"
					aria-live="polite"
				>
					{stateLine}
				</p>
				{#if error}
					<p class="text-error-600-400 mt-0.5 text-xs">
						{error}
					</p>
				{/if}
			</div>
			{#if matting.state === "on_disk"}
				<button
					type="button"
					class="btn btn-sm text-error-600-400 hover:preset-tonal-error shrink-0"
					disabled={busy}
					onclick={() => (confirming = true)}
				>
					<Icons.Trash2 size={14} aria-hidden="true" />
					Delete from disk
				</button>
			{/if}
		</div>
	</section>
{/if}

<!-- An alertdialog (STYLE-GUIDE §6.6): answered, never dismissed by a click
     outside, and its confirm is filled error because it only takes away. -->
<Dialog
	open={confirming}
	role="alertdialog"
	closeOnInteractOutside={false}
	onOpenChange={(e) => {
		if (!e.open) confirming = false
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
			>
				<Dialog.Title
					class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					Delete the background remover?
				</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					{matting?.name ?? "The background remover"} is removed from
					this machine. It downloads again the next time a picture's
					background is removed.
				</Dialog.Description>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={() => (confirming = false)}
					>
						Keep it
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						onclick={remove}
					>
						Delete from disk
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
