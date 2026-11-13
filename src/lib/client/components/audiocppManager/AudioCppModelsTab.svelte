<script lang="ts">
	/**
	 * audio.cpp's Models tab: the packages it SERVES (on disk or arriving),
	 * grouped Speech / Transcription, then audio family. Getting more is the
	 * Models view's **Get a model** dialog, opened by the **Get more…** door.
	 * Admin-only (the parent
	 * gates). Self-contained: it asks for the list on mount and keeps it fresh
	 * from the replies and the download progress push.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { getContext, onMount } from "svelte"
	import { openInModels } from "$lib/client/admin/railDoors"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onConnect, useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		KNOWN_FAMILIES,
		TASK_LABELS,
		arrivingLabel,
		audioFamilyLabel,
		getMoreFinder,
		groupPackages,
		precisionLabel,
		servedRows,
		hasKnownFamily,
		rowActions,
		sizeLabel,
		vramHint,
		type PackageRow,
		type PackageTask
	} from "./audiocppPackages"

	interface Props {
		/** The audio.cpp connection the Get more… door names. */
		connectionId?: number
	}
	let { connectionId }: Props = $props()

	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")
	function getMore() {
		openInModels(panelsCtx, { finder: getMoreFinder(connectionId) })
	}

	const socket = useTypedSocket()

	type Progress =
		Sockets.AudioCpp.PackageDownloadProgress.PackageDownloadState

	let rows = $state<PackageRow[]>([])
	let loaded = $state(false)
	let failed = $state(false)
	let progress = $state<Record<string, Progress>>({})
	let confirmingRemove = $state<string | null>(null)

	const served = $derived(
		servedRows(
			rows,
			new Set(
				Object.keys(progress).filter((id) => !progress[id].isDone)
			)
		)
	)
	const groups = $derived(groupPackages(served))

	function relist() {
		socket.emit("audiocpp:listPackages", {})
	}
	function replaceRow(next: PackageRow | undefined) {
		if (!next) return
		rows = rows.map((r) => (r.id === next.id ? next : r))
	}

	useInterest<"audiocpp:listPackages">("audiocpp:listPackages", (res) => {
		rows = res.packages ?? []
		loaded = true
		failed = false
	})
	useInterest<"audiocpp:listPackages:error">(
		"audiocpp:listPackages:error",
		() => {
			failed = true
			loaded = true
		}
	)
	useInterest<"audiocpp:packageDownloadProgress">(
		"audiocpp:packageDownloadProgress",
		(res) => {
			const next = res?.downloads ?? {}
			const finished = Object.values(next).some((d) => d.isDone)
			const wasArriving = Object.keys(progress).length > 0
			progress = next
			if (finished || (wasArriving && Object.keys(next).length === 0))
				relist()
		}
	)
	useInterest<"audiocpp:downloadPackage">("audiocpp:downloadPackage", relist)
	useInterest<"audiocpp:cancelPackageDownload">(
		"audiocpp:cancelPackageDownload",
		relist
	)
	useInterest<"audiocpp:removePackage">("audiocpp:removePackage", relist)
	useInterest<"audiocpp:setPackageEnabled">(
		"audiocpp:setPackageEnabled",
		(res) => replaceRow(res?.package)
	)
	useInterest<"audiocpp:confirmFamily">("audiocpp:confirmFamily", (res) => {
		replaceRow(res?.package)
		// A confirmed package may have moved folder; ask again for the truth.
		relist()
	})

	onMount(relist)
	// There is no "get progress" request: after a reconnect the list says
	// which packages are `downloading`, and the pushes resume (lane B).
	$effect(() => onConnect(relist))

	// Rows shown as arriving even before the list catches up.
	const arrivingOf = (r: PackageRow) =>
		progress[r.id] && !progress[r.id].isDone ? progress[r.id] : undefined

	function run(row: PackageRow, action: string) {
		if (action === "enable" || action === "disable") {
			socket.emit("audiocpp:setPackageEnabled", {
				id: row.id,
				enabled: action === "enable"
			})
		} else if (action === "confirm-family") {
			openConfirm(row)
		}
	}

	// Confirm family dialog
	let confirmRow = $state<PackageRow | null>(null)
	let familyInput = $state("")
	let taskInput = $state<PackageTask>("tts")
	function openConfirm(row: PackageRow) {
		confirmRow = row
		// "unknown" is lane B's word for no match, never a family to confirm.
		familyInput = hasKnownFamily(row) ? row.family : ""
		taskInput = row.task
	}
	function submitConfirm() {
		const row = confirmRow
		const family = familyInput.trim()
		if (!row?.localDir || !family) return
		socket.emit("audiocpp:confirmFamily", {
			localDir: row.localDir,
			family,
			task: taskInput
		})
		confirmRow = null
	}
	const TASKS: PackageTask[] = ["tts", "asr", "vdes"]
</script>

<div class="flex flex-col gap-4 p-3">
	<p class="text-surface-600-400 text-sm">
		Enabling or disabling a model restarts audio.cpp, because its
		configuration is rewritten.
	</p>

	{#if !loaded}
		<p class="text-surface-600-400 text-sm">Loading models…</p>
	{:else if failed && rows.length === 0}
		<p class="text-surface-600-400 text-sm">
			Could not load the model list.
			<button type="button" class="anchor" onclick={relist}>Try again</button>
		</p>
	{:else if served.length === 0}
		<p class="text-surface-600-400 text-sm" data-empty>
			Nothing downloaded yet. Speech and transcription models you get
			appear here.
		</p>
	{/if}

	<div>
		<button
			type="button"
			class="btn btn-sm preset-tonal"
			data-get-more
			onclick={getMore}
		>
			Get more…
		</button>
	</div>

	{#each groups as group (group.key)}
		<section class="flex flex-col gap-2" data-group={group.key}>
			<h3 class="text-base font-semibold">{group.label}</h3>
			{#each group.families as bucket (bucket.family)}
				<div class="flex flex-col gap-1" data-family={bucket.family}>
					<h4 class="text-surface-600-400 text-sm font-medium">
						{bucket.label}
					</h4>
					<ul class="flex flex-col gap-1">
						{#each bucket.rows as row (row.id)}
							{@const acts = rowActions(row)}
							{@const arriving = arrivingOf(row)}
							{@const effective = arriving ? "downloading" : row.state}
							<li
								class="bg-surface-100-900 flex flex-wrap items-start justify-between gap-2 rounded-md p-2"
								data-package={row.id}
							>
								<!-- A real basis, so a narrow dock wraps the actions
								     under the row instead of squeezing its words. -->
								<div class="flex min-w-0 flex-[1_1_14rem] flex-col gap-1">
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-medium">{row.name}</span>
										{#if row.variant}
											<span class="text-surface-600-400 text-sm">
												{row.variant}
											</span>
										{/if}
										{#if precisionLabel(row)}
											<span class="chip preset-tonal text-xs" data-precision>
												{precisionLabel(row)}
											</span>
										{/if}
										{#if row.task === "vdes"}
											<span class="chip preset-tonal text-xs">
												{TASK_LABELS.vdes}
											</span>
										{/if}
										{#if row.license}
											<span class="chip preset-tonal text-xs">
												{row.license}
											</span>
										{/if}
										{#if row.confidence !== "listed"}
											<span class="chip preset-tonal-warning text-xs">
												{row.confidence}
											</span>
										{/if}
									</div>
									<p class="text-surface-600-400 text-xs">
										{[sizeLabel(row), vramHint(row)]
											.filter(Boolean)
											.join(" · ")}
										{#if row.state === "enabled"}
											· Enabled
										{:else if row.state === "downloaded"}
											· Downloaded
										{/if}
									</p>
									{#if row.recommended && row.reason}
										<p class="text-primary-ink text-xs">{row.reason}</p>
									{/if}
									{#if acts.note}
										<p class="text-surface-600-400 text-xs">{acts.note}</p>
									{/if}
									{#if confirmingRemove === row.id}
										<p class="text-sm">
											Remove {row.name} from disk?
											<button
												type="button"
												class="btn btn-sm preset-filled-error-500"
												onclick={() => {
													socket.emit("audiocpp:removePackage", {
														id: row.id
													})
													confirmingRemove = null
												}}
											>
												Remove
											</button>
											<button
												type="button"
												class="btn btn-sm preset-tonal"
												onclick={() => (confirmingRemove = null)}
											>
												Keep it
											</button>
										</p>
									{/if}
								</div>
								<div class="flex items-center gap-2">
									{#if effective === "downloading"}
										<span class="text-sm" data-arriving>
											Arriving{#if arrivingLabel(arriving)}
												· {arrivingLabel(arriving)}{/if}
										</span>
										<button
											type="button"
											class="btn btn-sm preset-tonal"
											onclick={() =>
												socket.emit("audiocpp:cancelPackageDownload", {
													id: row.id
												})}
										>
											Cancel
										</button>
									{:else}
										{#if acts.primary}
											<button
												type="button"
												class="btn btn-sm preset-outlined-surface-500"
												onclick={() => run(row, acts.primary!.action)}
											>
												{acts.primary.label}
											</button>
										{/if}
										{#if acts.canRemove && confirmingRemove !== row.id}
											<button
												type="button"
												class="btn btn-sm preset-tonal"
												onclick={() => (confirmingRemove = row.id)}
											>
												Remove
											</button>
										{/if}
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</section>
	{/each}
</div>

<Dialog
	open={confirmRow !== null}
	onOpenChange={(e) => {
		if (!e.open) confirmRow = null
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
				class="card bg-surface-100-900 w-full max-w-lg space-y-4 p-6 shadow-xl"
			>
				<Dialog.Title class="text-lg font-semibold">
					Confirm family
				</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					{confirmRow?.name}: tell Serene Pub which audio family this is and
					what it does. audio.cpp refuses a wrong family.
				</Dialog.Description>
				<label class="flex flex-col gap-1 text-sm">
					Audio family
					<input
						class="input"
						list="acpp-families"
						bind:value={familyInput}
					/>
					<datalist id="acpp-families">
						{#each KNOWN_FAMILIES as f (f)}
							<option value={f}>{audioFamilyLabel(f)}</option>
						{/each}
					</datalist>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					What it does
					<select class="select" bind:value={taskInput}>
						{#each TASKS as t (t)}
							<option value={t}>{TASK_LABELS[t]}</option>
						{/each}
					</select>
				</label>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal"
						onclick={() => (confirmRow = null)}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						disabled={!familyInput.trim() || !confirmRow?.localDir}
						onclick={submitConfirm}
					>
						Confirm family
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
