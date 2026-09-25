<script lang="ts">
	/**
	 * The models a runtime this pub manages has, as ROWS.
	 *
	 * ## What it replaces, and why one component replaces two
	 *
	 * `KoboldCppModelsTab` (875 lines) and `OllamaInstalledTab` (470) each drew
	 * their own card per model: the raw identifier as a two-line title, a
	 * `Size: / Modified: / Parameters:` table, and a green filled **Use for
	 * chat** beside a red filled **Delete** wrapping onto a second row. Two
	 * models fitted on screen out of four. They were the last surface still
	 * drawing the pre-2026-09-17 manager, and the 09-18 handover flagged them as
	 * "a restyle, not a rewire".
	 *
	 * They are one component now because they were never two ideas. Both list
	 * the same thing — `connection.models`, which `syncConnectionModels` fills
	 * for every endpoint including these two — and differ only in which socket
	 * event a menu item emits. That difference is four callbacks, not two files.
	 *
	 * ## Where the rows come from
	 *
	 * The connection's own `models[]` off the list, which since 2026-09-23
	 * carries `facts` — quantisation, size, context — so a row can say
	 * `Q4_K_M · 7 GB · 32k context` without a second request. The managers' own
	 * `ollama:modelsList` / `koboldcpp:listModels` are no longer read HERE: they
	 * answered the same question a sync already answered, from a different
	 * shape, which is how the two lists could disagree about what was installed.
	 *
	 * ⚠ **Delete lives in the `⋯` menu and nowhere else.** It is the one
	 * irreversible thing on this screen; a red filled button on every row put it
	 * under the thumb four times over.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import ModelRow, { type ModelRowAction } from "./ModelRow.svelte"
	import { modelDisplay } from "./modelDisplay"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"
	import { systemCapabilitiesForModel } from "./modelSystemDefaults"
	import { capabilityLabel } from "@serene-pub/sdk"

	type Row = Sockets.Connections.List.Row & { id: number }
	type ModelOf = Row["models"][number]

	interface Props {
		kind: "koboldcpp" | "ollama"
		/** The text connection. KoboldCPP's image row comes in beside it. */
		connection: Row | undefined
		/** KoboldCPP's image connection, when there is one. */
		imageConnection?: Row | undefined
		capabilityDefaults: Record<string, CapabilityDefaultRef | undefined>
		isAdmin: boolean
		onOpenModel: (connectionId: number, modelId: number) => void
		onGetModels: () => void
		onRefresh: () => void
	}
	let {
		kind,
		connection,
		imageConnection,
		capabilityDefaults,
		isAdmin,
		onOpenModel,
		onGetModels,
		onRefresh
	}: Props = $props()

	const socket = useTypedSocket()

	let query = $state("")
	let pendingDelete = $state<{ connectionId: number; model: ModelOf } | null>(
		null
	)

	const match = (m: ModelOf) => {
		const q = query.trim().toLowerCase()
		if (!q) return true
		const d = modelDisplay(m)
		return (
			d.name.toLowerCase().includes(q) ||
			m.model.toLowerCase().includes(q)
		)
	}

	const textModels = $derived((connection?.models ?? []).filter(match))
	const imageModels = $derived((imageConnection?.models ?? []).filter(match))

	function defaultsFor(connectionId: number, model: ModelOf): string[] {
		return systemCapabilitiesForModel(
			capabilityDefaults,
			connectionId,
			model.id
		).map((c) => capabilityLabel(c as any))
	}

	/**
	 * The menu for one row.
	 *
	 * ⚠ Every item here is an emit one of the two legacy tabs already made. This
	 * is a restyle of where they live, not a new capability — the only genuinely
	 * new thing is that Delete asks first for Ollama too, which it did before,
	 * and for KoboldCPP, which it also did. Nothing gained a confirmation it
	 * lacked and nothing lost one.
	 */
	function actionsFor(lane: "text" | "image"): ModelRowAction[] {
		const items: ModelRowAction[] = [
			{ id: "open", label: "Model settings", icon: "Settings2" }
		]
		if (kind === "koboldcpp")
			items.push({
				id: lane === "text" ? "toImage" : "toText",
				label:
					lane === "text"
						? "Move to image models"
						: "Move to text models",
				icon: "ArrowLeftRight"
			})
		if (kind === "ollama")
			items.push({
				id: "site",
				label: "View on ollama.com",
				icon: "ExternalLink"
			})
		if (isAdmin)
			items.push({
				id: "delete",
				label: "Delete from disk",
				icon: "Trash2",
				destructive: true
			})
		return items
	}

	function run(
		id: string,
		connectionId: number,
		model: ModelOf,
		lane: "text" | "image"
	) {
		switch (id) {
			case "open":
				onOpenModel(connectionId, model.id)
				return
			case "delete":
				pendingDelete = { connectionId, model }
				return
			case "site":
				window.open(
					`https://ollama.com/library/${encodeURIComponent(model.model.split(":")[0])}`,
					"_blank",
					"noopener"
				)
				return
			case "toImage":
			case "toText":
				socket.emit("koboldcpp:setModelKind", {
					filename: model.model,
					kind: id === "toImage" ? "image" : "text"
				})
				return
		}
	}

	function use(lane: "text" | "image", model: ModelOf) {
		if (kind === "ollama") {
			socket.emit("ollama:connectModel", {
				modelName: model.model
			} as any)
			return
		}
		if (lane === "image")
			socket.emit("koboldcpp:connectImageModel", {
				filename: model.model
			} as any)
		else
			socket.emit("koboldcpp:connectModel", {
				modelName: model.model
			} as any)
	}

	function confirmDelete() {
		const target = pendingDelete
		pendingDelete = null
		if (!target) return
		if (kind === "ollama")
			socket.emit("ollama:deleteModel", {
				modelName: target.model.model
			})
		else
			socket.emit("koboldcpp:deleteModel", {
				modelName: target.model.model
			})
	}

	const total = $derived(
		(connection?.models?.length ?? 0) +
			(imageConnection?.models?.length ?? 0)
	)
</script>

<div class="flex flex-col gap-3 py-3">
	{#if total > 0}
		<div class="flex shrink-0 items-center gap-2">
			<div class="min-w-0 flex-1">
				<label class="sr-only" for="managed-model-filter">
					Filter models
				</label>
				<input
					id="managed-model-filter"
					class="input"
					type="text"
					bind:value={query}
					placeholder={total === 1 ? "1 model" : `${total} models`}
				/>
			</div>
			<button
				type="button"
				class="btn preset-tonal-surface shrink-0"
				onclick={onRefresh}
				aria-label="Refresh model list"
			>
				<Icons.RefreshCw size={16} aria-hidden="true" />
			</button>
		</div>
	{/if}

	{#if !total}
		<div class="panel-card flex flex-col items-start gap-2">
			<p class="text-sm font-medium">No models yet</p>
			<p class="text-surface-600-400 text-xs">
				This runtime has nothing to load. Get one and it appears here.
			</p>
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500"
				onclick={onGetModels}
			>
				<Icons.Download size={15} aria-hidden="true" />
				Get a model
			</button>
		</div>
	{:else}
		{#if textModels.length}
			<section class="flex flex-col gap-1">
				{#if kind === "koboldcpp"}
					<h3 class="text-surface-600-400 px-0.5 text-xs font-medium">
						Text models
					</h3>
				{/if}
				{#each textModels as model (model.id)}
					{@const defaults = defaultsFor(connection!.id, model)}
					<ModelRow
						{model}
						defaultFor={defaults}
						canUse={!defaults.length}
						useLabel="Use for chat"
						actions={actionsFor("text")}
						onOpen={() => onOpenModel(connection!.id, model.id)}
						onUse={() => use("text", model)}
						onAction={(id) =>
							run(id, connection!.id, model, "text")}
					/>
				{/each}
			</section>
		{/if}

		{#if imageConnection && imageModels.length}
			<section class="flex flex-col gap-1">
				<h3 class="text-surface-600-400 px-0.5 text-xs font-medium">
					Image models
				</h3>
				{#each imageModels as model (model.id)}
					{@const defaults = defaultsFor(imageConnection.id, model)}
					<ModelRow
						{model}
						defaultFor={defaults}
						canUse={!defaults.length}
						useLabel="Use for images"
						actions={actionsFor("image")}
						onOpen={() => onOpenModel(imageConnection.id, model.id)}
						onUse={() => use("image", model)}
						onAction={(id) =>
							run(id, imageConnection.id, model, "image")}
					/>
				{/each}
			</section>
		{/if}

		{#if query && !textModels.length && !imageModels.length}
			<p class="text-surface-600-400 px-0.5 text-sm">Nothing matches.</p>
		{/if}

		<button
			type="button"
			class="border-surface-300-700 hover:preset-tonal-primary flex items-center gap-2.5 rounded-[10px] border border-dashed px-3 py-2.5 text-left"
			onclick={onGetModels}
		>
			<Icons.Download
				size={16}
				class="text-primary-500 shrink-0"
				aria-hidden="true"
			/>
			<span class="min-w-0 flex-1">
				<span class="block text-[13px] font-medium">
					Get another model
				</span>
				<span class="text-surface-600-400 block text-[11px]">
					Recommended lists and Hugging Face
				</span>
			</span>
			<Icons.ChevronRight
				size={15}
				class="text-surface-500 shrink-0"
				aria-hidden="true"
			/>
		</button>
	{/if}
</div>

<Dialog
	open={!!pendingDelete}
	onOpenChange={(e) => {
		if (!e.open) pendingDelete = null
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
				role="alertdialog"
			>
				<h2 class="funnel-display text-lg font-semibold">
					Delete this model?
				</h2>
				<p class="text-surface-600-400 text-sm">
					{pendingDelete
						? modelDisplay(pendingDelete.model).name
						: ""}
					is removed from this machine. The download can be repeated, but
					the file goes now.
				</p>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={() => (pendingDelete = null)}
					>
						Keep it
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						onclick={confirmDelete}
					>
						Delete from disk
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
