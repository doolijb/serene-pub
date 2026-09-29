<script lang="ts">
	/**
	 * Everything this pub is fetching, in ONE list.
	 *
	 * Concept ruling R4 (2026-09-17). Before it, a download was only visible on
	 * the screen that started it: a GGUF pulled from the KoboldCPP manager left
	 * no trace on the Connections index, an Ollama pull left none on either,
	 * and the local ONNX cache reported itself on a third screen again. "Why is
	 * nothing happening" and "it is downloading" were two panels apart.
	 *
	 * The reconciliation is not here — it is in `downloads.svelte.ts`, which
	 * turns four differently-shaped feeds into one `DownloadItem` list. This
	 * view reads that list and nothing else, which is why it has no branch on
	 * where a row came from beyond the tile it wears.
	 *
	 * ## Bytes, never time (ruling R7)
	 *
	 * A bar and a byte count. No estimate, no rate, no "about 4 minutes left" —
	 * every one of those is a lie about a download whose throughput is another
	 * program's problem.
	 *
	 * ## What is deliberately absent
	 *
	 * - **"layer 3 of 12"** on an Ollama pull. The server's map does carry a
	 *   per-blob breakdown, but `ollamaItems` sums it into one line on purpose
	 *   (a person pulling `llama3.1:8b` is fetching one thing), so the count is
	 *   not on the item this view reads and is not invented here.
	 * - **Retry** on a failed row. Re-issuing a download needs the parameters
	 *   it was started with — a URL and a filename for KoboldCPP, a tag for
	 *   Ollama — and the progress feeds carry none of them. A Retry built from
	 *   a guess would start the wrong file.
	 * - **"Finished today"**. Nothing in these feeds is timestamped, and the
	 *   two manager histories live as long as the server process does, so the
	 *   word would be a claim the data cannot back.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import {
		downloads,
		type DownloadItem,
		type DownloadSource
	} from "./downloads.svelte"
	import { formatProgress } from "./modelManagement"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"

	interface Props {
		onBack: () => void
		/** Inside another view that owns the header: no nav header here. */
		embedded?: boolean
	}
	let { onBack, embedded = false }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user?: SelectUser } | undefined = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	const systemSettingsCtx:
		| {
				capabilityDefaults?: Record<
					string,
					CapabilityDefaultRef | undefined
				>
		  }
		| undefined = getContext("systemSettingsCtx")

	/**
	 * The list, held for as long as this view is mounted.
	 *
	 * Subscriber-counted in the store: the index's tray is very likely holding
	 * the same three feeds beside this view, and a release that emptied them
	 * on the first unmount would blank the other one.
	 */
	$effect(() => downloads.subscribe({ admin: isAdmin }))

	/**
	 * The connections, for ONE question: is a finished KoboldCPP file a TEXT
	 * model, and is it already the chat default?
	 *
	 * The feeds carry no kind, so "Use for chat" is offered only once the
	 * finished file has appeared as a model on the managed TEXT connection —
	 * which is the sync saying what the file is. A button that has not
	 * appeared yet is the safe failure direction; one offered over an image
	 * checkpoint is not.
	 */
	let connectionsList = $state<Sockets.Connections.List.Row[]>([])
	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connectionsList = msg.connectionsList ?? []
		downloads.setOnnx(connectionsList)
	}
	$effect(() =>
		declareInterest<"connections:list">(
			"connections:list",
			handleConnectionsList
		)
	)
	$effect(() => {
		socket.emit("connections:list", {})
	})

	const items = $derived(downloads.items)
	const inFlight = $derived(
		items.filter((i) => i.state === "in_flight" || i.state === "cancelling")
	)
	const finished = $derived(downloads.finished)
	const failed = $derived(downloads.failed)
	const empty = $derived(!items.length)

	const TILE: Record<DownloadSource, string> = {
		koboldcpp: "Cpu",
		"koboldcpp-binary": "Box",
		ollama: "Server",
		onnx: "HardDrive"
	}
	function tileIcon(source: DownloadSource) {
		return ((Icons as any)[TILE[source]] as any) ?? Icons.Download
	}

	/** Bytes as one unit for both halves, chosen by the size of the thing. */
	function progressText(item: DownloadItem): string | null {
		const unit =
			item.totalBytes != null && item.totalBytes >= 1_000_000_000
				? "GB"
				: "MB"
		return formatProgress(item.downloadedBytes, item.totalBytes, unit)
	}

	function percentOf(item: DownloadItem): number | null {
		if (item.percent != null) return item.percent
		if (!item.totalBytes) return null
		return ((item.downloadedBytes ?? 0) / item.totalBytes) * 100
	}

	/**
	 * The (connection, model) a finished KoboldCPP file became, or null.
	 *
	 * ⚠ `koboldcpp:<filename>` is the item id and the FILENAME is what
	 * `koboldcpp:connectModel` wants — the same string `KoboldCppModelsTab`
	 * passes from its own list, not the repo name on the row.
	 */
	function kcppTextModel(item: DownloadItem) {
		if (item.source !== "koboldcpp") return null
		const filename = item.id.slice("koboldcpp:".length)
		for (const connection of connectionsList) {
			if (connection.type !== CONNECTION_TYPE.KOBOLDCPP_MANAGED) continue
			const model = (connection.models ?? []).find(
				(m) => m.model === filename
			)
			if (model && connection.id != null)
				return { connectionId: connection.id, model, filename }
		}
		return null
	}

	function isChatDefault(connectionId: number, modelId: number) {
		const def = systemSettingsCtx?.capabilityDefaults?.["text->text"]
		return (
			def?.connectionId === connectionId &&
			def?.connectionModelId === modelId
		)
	}

	function useForChat(filename: string) {
		socket.emit("koboldcpp:connectModel", { modelName: filename })
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-3 p-1">
	{#if !embedded}
		<PanelNavHeader
			title="Downloads"
			{onBack}
			backLabel="Back to connections"
			actionsLabel="Downloads"
			menuItems={[
				{
					label: "Clear finished",
					icon: Icons.Eraser,
					disabled: !finished.length && !failed.length,
					onSelect: () => downloads.clearFinished()
				}
			]}
		/>
	{/if}

	{#if empty}
		<!-- One sentence. Nothing is arriving, which is not a problem to
		     solve, so there is no icon and no button (STYLE-GUIDE §6.7). -->
		<p class="text-surface-600-400 text-sm">Nothing is downloading.</p>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
			{#if inFlight.length}
				<section class="flex flex-col gap-1.5">
					<span class="text-surface-600-400 text-xs">
						In flight · {inFlight.length}
					</span>
					{#each inFlight as item (item.id)}
						{@const Tile = tileIcon(item.source)}
						{@const percent = percentOf(item)}
						{@const text = progressText(item)}
						<div class="flex min-h-11 items-center gap-2">
							<span
								class="preset-tonal-warning grid size-8 shrink-0 place-items-center rounded-lg"
								aria-hidden="true"
							>
								<Tile size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span
									class="block truncate text-[15px] font-medium"
								>
									{item.name}
								</span>
								<span
									class="text-surface-600-400 flex min-w-0 items-center gap-1.5 text-xs"
								>
									<span class="shrink-0 truncate">
										{item.destinationLabel}{text
											? ` · ${text}`
											: ""}
									</span>
									<span
										class="bg-surface-300-700 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
										role="progressbar"
										aria-label={`Downloading ${item.name}`}
										aria-valuenow={percent ?? undefined}
										aria-valuemin={0}
										aria-valuemax={100}
									>
										<span
											class="bg-warning-500 block h-full rounded-full transition-[width]"
											style={`width: ${Math.round(percent ?? 0)}%`}
										></span>
									</span>
								</span>
							</span>
							<button
								type="button"
								class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0 text-xs"
								disabled={item.state === "cancelling"}
								onclick={() => downloads.cancel(item)}
								aria-label={`Cancel — ${item.name}`}
							>
								{item.state === "cancelling"
									? "Cancelling"
									: "Cancel"}
							</button>
						</div>
					{/each}
				</section>
			{/if}

			{#if finished.length}
				<section class="flex flex-col gap-1.5">
					<span class="text-surface-600-400 text-xs">
						Finished · {finished.length}
					</span>
					{#each finished as item (item.id)}
						{@const Tile = tileIcon(item.source)}
						{@const chat = kcppTextModel(item)}
						<div class="flex min-h-11 items-center gap-2">
							<span
								class="preset-tonal-success grid size-8 shrink-0 place-items-center rounded-lg"
								aria-hidden="true"
							>
								<Tile size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="flex min-w-0 items-center gap-1.5">
									<span
										class="min-w-0 truncate text-[15px] font-medium"
									>
										{item.name}
									</span>
									<span
										class="preset-tonal-success shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
									>
										Done
									</span>
								</span>
								<span
									class="text-surface-600-400 block truncate text-xs"
								>
									{item.destinationLabel}
								</span>
							</span>
							{#if chat && !isChatDefault(chat.connectionId, chat.model.id)}
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
									onclick={() => useForChat(chat.filename)}
									aria-label={`Use ${item.name} for chat`}
								>
									Use for chat
								</button>
							{/if}
						</div>
					{/each}
				</section>
			{/if}

			{#if failed.length}
				<section class="flex flex-col gap-1.5">
					<span class="text-surface-600-400 text-xs">
						Failed · {failed.length}
					</span>
					{#each failed as item (item.id)}
						{@const Tile = tileIcon(item.source)}
						<div class="flex min-h-11 items-center gap-2">
							<span
								class="preset-tonal-warning grid size-8 shrink-0 place-items-center rounded-lg"
								aria-hidden="true"
							>
								<Tile size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span
									class="block truncate text-[15px] font-medium"
								>
									{item.name}
								</span>
								<!-- The host's own sentence, unedited: it names
								     the thing that actually refused. -->
								<span
									class="text-surface-600-400 block truncate text-xs"
								>
									{item.error ??
										`${item.destinationLabel} stopped this one`}
								</span>
							</span>
						</div>
					{/each}
				</section>
			{/if}

			<p class="text-surface-600-400 shrink-0 text-xs">
				One list for every destination. Cancel stops after the current
				file; nothing is deleted for you.
			</p>
		</div>
	{/if}
</div>

