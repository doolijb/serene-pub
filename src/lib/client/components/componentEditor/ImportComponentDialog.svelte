<script lang="ts">
	/**
	 * Import a component (C6, P7): a share file (`.component.json`), or one
	 * bare `.svelte` / `.ts` / `.js` file picked, dropped or pasted.
	 *
	 * Two steps, and nothing is stored before the second. The file goes to
	 * `components:importPreview`, and the dialog shows what it would bring:
	 * its files, framework and entry, what it was cloned from, the scopes it
	 * asks for, the compiled module it carries and whether that verifies, how
	 * it will run here, the compile here when there is a compiler, and the
	 * slug it will take when its own is in use. Import sends the same file to
	 * `components:import` and opens the new component's editor. It arrives
	 * switched off with its scopes unreviewed, and the dialog says so first.
	 *
	 * Replies reach every tab of this admin that declared the verb, so the
	 * dialog takes one only while it is waiting for it (`componentShare.ts`).
	 */
	// The Admin view's router: an admin address moves its section rather than
	// navigating away from whatever page sits under the view.
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		CHOOSE,
		IMPORT_LANDS_TEXT,
		PASTED_DEFAULT_NAME,
		SHARE_FILE_ACCEPT,
		importSummaryView,
		onImportError,
		onImportReply,
		onPreviewError,
		onPreviewReply,
		pastedInput,
		readShareFile,
		type ImportPhase,
		type ShareInputResult
	} from "./componentShare"

	interface Props {
		open: boolean
		/** Core's components, to tell whether a clone's original has moved on here. */
		coreComponents?: readonly { slug: string; sourceHash: string }[]
	}

	let { open = $bindable(), coreComponents = [] }: Props = $props()

	const socket = useTypedSocket()
	const interest = getAdminInterestContext()

	let phase = $state<ImportPhase>(CHOOSE)
	let problem = $state<string | null>(null)
	let pasteOpen = $state(false)
	let pasteText = $state("")
	let pasteName = $state("")
	let dropping = $state(false)
	let fileInput = $state<HTMLInputElement | null>(null)

	let view = $derived(
		phase.kind === "ready" || phase.kind === "importing" ? importSummaryView(phase.summary, coreComponents) : null
	)
	let summary = $derived(phase.kind === "ready" || phase.kind === "importing" ? phase.summary : null)
	const text = (v: unknown) => i18nTextIn(v) ?? ""

	function reset() {
		phase = CHOOSE
		problem = null
		dropping = false
	}

	$effect(() => {
		if (!open) return
		reset()
		const releases = [
			interest.declareInterest<"components:importPreview">("components:importPreview", (res) => {
				const next = onPreviewReply(phase, res)
				if (next) phase = next
			}),
			interest.declareInterest<"components:importPreview:error">("components:importPreview:error", (res) => {
				const next = onPreviewError(phase, res)
				if (next) phase = next
			}),
			interest.declareInterest<"components:import">("components:import", (res) => {
				const done = onImportReply(phase, res)
				if (!done) return
				phase = CHOOSE
				open = false
				toaster.success({
					title: `Imported ${text(done.label)}${done.renamedFrom ? ` as a copy (${res.component.slug})` : ""}`,
					description: done.compiled
						? "It is off, and its scopes wait for your review. Switch it on here when you are ready."
						: "It is off, its scopes wait for your review, and it does not compile yet. See Problems."
				})
				goto(`/admin/components/${done.id}${done.compiled ? "?tab=widget" : "?tab=problems"}`)
			}),
			interest.declareInterest<"components:import:error">("components:import:error", (res) => {
				const next = onImportError(phase, res)
				if (next) phase = next
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function send(result: ShareInputResult) {
		if (!result.ok) {
			problem = result.problem
			return
		}
		problem = null
		phase = { kind: "previewing", input: result.input }
		socket.emit("components:importPreview", result.input)
	}

	async function takeFile(file: File | null | undefined) {
		if (!file || phase.kind === "previewing" || phase.kind === "importing") return
		send(await readShareFile(file))
	}

	function onPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		input.value = ""
		takeFile(file)
	}

	function onDrop(e: DragEvent) {
		e.preventDefault()
		dropping = false
		const files = e.dataTransfer?.files
		if (files && files.length > 1) {
			problem = "Drop one file at a time."
			return
		}
		takeFile(files?.[0])
	}

	function previewPasted() {
		send(pastedInput(pasteText, pasteName))
	}

	function confirmImport() {
		if (phase.kind !== "ready" || !view?.canImport) return
		phase = { kind: "importing", input: phase.input, summary: phase.summary }
		socket.emit("components:import", phase.input)
	}

	const toneClass = (tone: string) =>
		tone === "error"
			? "text-error-700-300"
			: tone === "warning"
				? "text-warning-700-300"
				: tone === "quiet"
					? "text-surface-600-400"
					: ""
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto p-5 shadow-xl"
			>
				<header class="flex items-start justify-between gap-3">
					<div>
						<Dialog.Title class="text-lg font-semibold">Import a component</Dialog.Title>
						<Dialog.Description class="text-surface-600-400 text-sm">
							{#if summary}
								Check what it brings. Nothing is stored until you import it.
							{:else}
								A share file (<code>.component.json</code>), or one <code>.svelte</code>, <code>.ts</code> or <code>.js</code> file.
							{/if}
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger class="btn-icon btn-icon-sm hover:preset-tonal" aria-label="Close">
						<Icons.X size={16} />
					</Dialog.CloseTrigger>
				</header>

				{#if phase.kind === "choose" || phase.kind === "previewing" || (phase.kind === "refused" && !phase.input)}
					<div
						class="drop-zone"
						class:dropping
						role="group"
						aria-label="Choose or drop a file"
						ondragover={(e) => {
							e.preventDefault()
							dropping = true
						}}
						ondragleave={() => (dropping = false)}
						ondrop={onDrop}
					>
						{#if phase.kind === "previewing"}
							<p class="flex items-center gap-2 text-sm" role="status">
								<Icons.LoaderCircle size={16} class="animate-spin" /> Reading {phase.input.filename}…
							</p>
						{:else}
							<Icons.FileUp size={24} class="text-surface-600-400" aria-hidden="true" />
							<button type="button" class="btn btn-sm preset-tonal-primary" onclick={() => fileInput?.click()}>
								<Icons.FolderOpen size={14} /> Choose a file
							</button>
							<p class="text-surface-600-400 text-xs">Or drop it here. Up to 4 MiB.</p>
						{/if}
						<input
							bind:this={fileInput}
							type="file"
							class="sr-only"
							tabindex="-1"
							aria-hidden="true"
							accept={SHARE_FILE_ACCEPT}
							onchange={onPicked}
						/>
						{#if dropping}
							<div class="drop-hint bg-surface-100-900" aria-hidden="true">Drop to import this file</div>
						{/if}
					</div>

					{#if phase.kind !== "previewing"}
						<div class="flex flex-col gap-2">
							<button
								type="button"
								class="text-surface-700-300 flex items-center gap-1 self-start text-sm hover:underline"
								aria-expanded={pasteOpen}
								onclick={() => (pasteOpen = !pasteOpen)}
							>
								{#if pasteOpen}<Icons.ChevronDown size={14} />{:else}<Icons.ChevronRight size={14} />{/if}
								Paste one source file
							</button>
							{#if pasteOpen}
								<label class="flex flex-col gap-1 text-sm">
									<span>File name</span>
									<input
										class="input font-mono text-sm"
										type="text"
										placeholder={PASTED_DEFAULT_NAME}
										bind:value={pasteName}
										spellcheck="false"
										autocomplete="off"
									/>
									<span class="text-surface-600-400 text-xs">It names the component, and .svelte or .ts / .js says which framework it uses.</span>
								</label>
								<label class="flex flex-col gap-1 text-sm">
									<span>Source</span>
									<textarea
										class="textarea min-h-40 font-mono text-xs"
										bind:value={pasteText}
										spellcheck="false"
										placeholder="Paste the whole file here"
									></textarea>
								</label>
								<button
									type="button"
									class="btn btn-sm preset-tonal-primary self-end"
									onclick={previewPasted}
									disabled={!pasteText.trim()}
								>
									<Icons.Eye size={14} /> Preview
								</button>
							{/if}
						</div>
					{/if}
				{/if}

				{#if problem}
					<p class="text-error-700-300 text-sm" role="alert">{problem}</p>
				{/if}

				{#if phase.kind === "refused"}
					<div class="banner banner-error" role="alert">
						<Icons.CircleAlert size={16} class="shrink-0" />
						<p class="flex-1">{phase.message}</p>
					</div>
				{/if}

				{#if summary && view}
					<section class="summary flex flex-col gap-3 text-sm" aria-label="What this import brings">
						<div>
							<p class="text-[15px] font-medium">{text(summary.label)}</p>
							<p class="text-surface-600-400 font-mono text-xs">
								{summary.importAs} · {summary.framework} · entry {summary.entry}
							</p>
						</div>

						{#if view.rename}
							<div class="banner banner-primary" role="status">
								<Icons.Copy size={16} class="shrink-0" />
								<p class="flex-1">{view.rename}</p>
							</div>
						{/if}

						<dl class="summary-grid">
							<dt class="text-surface-600-400">Runs</dt>
							<dd class={toneClass(view.runs.tone)}>{view.runs.text}</dd>
							<dt class="text-surface-600-400">Compiled module</dt>
							<dd class={toneClass(view.verify.tone)}>{view.verify.text}</dd>
							{#if view.basedOn}
								<dt class="text-surface-600-400">Based on</dt>
								<dd class={view.basedOn.drift === "changed" ? "text-warning-700-300" : ""}>{view.basedOn.text}</dd>
							{/if}
							<dt class="text-surface-600-400">Scopes</dt>
							<dd>
								{#if view.scopes.length}
									<span class="flex flex-wrap gap-1">
										{#each view.scopes as s (s)}
											<span class="preset-tonal-warning rounded-full px-2 py-0.5 font-mono text-xs">{s}</span>
										{/each}
									</span>
									<span class="text-surface-600-400 mt-1 block text-xs">Each one needs your review, and is refused until then.</span>
								{:else}
									<span class="text-surface-600-400">None: it reads nothing from sessions.</span>
								{/if}
							</dd>
							<dt class="text-surface-600-400">Files</dt>
							<dd>
								<ul class="flex flex-col gap-0.5">
									{#each view.files as f (f.path)}
										<li class="flex items-baseline gap-2 font-mono text-xs">
											<span class="min-w-0 flex-1 truncate">{f.path}{f.entry ? " (entry)" : ""}</span>
											<span class="text-surface-600-400 shrink-0">{f.size}</span>
										</li>
									{/each}
								</ul>
								{#if view.files.length > 1}
									<span class="text-surface-600-400 text-xs">{view.files.length} files, {view.totalSize}</span>
								{/if}
							</dd>
						</dl>

						{#if view.compile}
							{#if view.compile.ok}
								<p class="flex items-center gap-2">
									<Icons.CircleCheck size={16} class="text-success-600-400 shrink-0" /> It compiles here.
								</p>
							{:else}
								<div class="flex flex-col gap-1" role="status">
									<p class="text-error-700-300 flex items-center gap-2 font-medium">
										<Icons.CircleAlert size={16} class="shrink-0" />
										It does not compile here ({view.compile.problems.length}
										{view.compile.problems.length === 1 ? "problem" : "problems"}). It can still be imported and fixed in the editor; until then sessions show it as missing.
									</p>
									<ul class="flex flex-col gap-1">
										{#each view.compile.problems as p, i (i)}
											<li class="text-xs">
												{#if p.place}<span class="font-mono">{p.place}</span>{" — "}{/if}{p.text}
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						{/if}

						{#if view.canImport}
							<p class="text-surface-600-400 flex items-start gap-2 text-xs">
								<Icons.ShieldAlert size={14} class="mt-0.5 shrink-0" />
								{IMPORT_LANDS_TEXT}
							</p>
						{/if}
					</section>
				{/if}

				<footer class="flex flex-wrap justify-end gap-2">
					{#if summary || phase.kind === "refused"}
						<button type="button" class="btn btn-sm preset-tonal-surface" onclick={reset} disabled={phase.kind === "importing"}>
							Choose another file
						</button>
					{/if}
					<Dialog.CloseTrigger class="btn btn-sm preset-tonal-surface">Cancel</Dialog.CloseTrigger>
					{#if summary && view?.canImport}
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500"
							onclick={confirmImport}
							disabled={phase.kind === "importing"}
						>
							{#if phase.kind === "importing"}<Icons.LoaderCircle size={14} class="animate-spin" />{:else}<Icons.PackagePlus size={14} />{/if}
							Import
						</button>
					{/if}
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<style>
	.drop-zone {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 140px;
		padding: 16px;
		border: 1px dashed color-mix(in oklab, var(--color-surface-500) 45%, transparent);
		border-radius: 12px;
	}
	.drop-zone.dropping {
		border-color: color-mix(in oklab, var(--color-primary-500) 70%, transparent);
	}
	.drop-hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed color-mix(in oklab, var(--color-primary-500) 70%, transparent);
		border-radius: 12px;
		font-weight: 500;
		pointer-events: none;
	}
	.summary-grid {
		display: grid;
		grid-template-columns: minmax(7rem, max-content) minmax(0, 1fr);
		gap: 6px 12px;
	}
	.summary-grid dt {
		font-size: 13px;
	}
	.summary-grid dd {
		margin: 0;
		min-width: 0;
	}
	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 14px;
	}
	.banner-error {
		background: color-mix(in oklab, var(--color-error-500) 14%, transparent);
	}
	.banner-primary {
		background: color-mix(in oklab, var(--color-primary-500) 14%, transparent);
	}
	.summary {
		container-type: inline-size;
	}
	@container (max-width: 480px) {
		.summary-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
