<script lang="ts">
	/**
	 * The scripts page — the fourth paradigm's management view (18 §4d).
	 *
	 * Grouped by *type* (content scope, then operation), never by pipeline: a
	 * script is a statement about text or candidates or context, not about
	 * which pipeline runs it, and one row may be attached anywhere its type is
	 * accepted. `usedBy` on every row answers the question the delete button
	 * raises, before it is asked.
	 *
	 * The in/out lists are first-class UI on purpose (18 §6a): what a script
	 * reads and what it may rewrite is the audit surface — a person checking a
	 * chain reads the declarations, not the source. In-but-not-out is
	 * read-only; a verdict type (`text/stop`) has no outs at all, because its
	 * return is consumed by the hook and never merges downstream.
	 *
	 * Admin-only, checked here and again in every handler. The check here is
	 * for the person; the check in the handler is the one that matters.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)

	/** One editor open at a time — script bodies are large. */
	let openRow = $state<number | null>(null)
	/** Unsaved edits per row, so switching rows cannot cross them. */
	let drafts = $state<
		Record<
			number,
			{
				name: string
				source: string
				varsIn: string[]
				varsOut: string[]
			}
		>
	>({})

	type Script = Sockets.Pipelines.Scripts.Script
	type ScriptType = Sockets.Pipelines.Scripts.ScriptType

	/**
	 * Content scopes in registration order, each with its types; types carry
	 * their rows. Derived, so a plugin's scope appears the moment its first
	 * type is registered — the page has no list of its own to keep in step.
	 */
	const groups = $derived.by(() => {
		const types = view.types ?? []
		const scripts = view.scripts ?? []
		const byScope = new Map<
			string,
			Array<{ type: ScriptType; rows: Script[] }>
		>()
		for (const type of types) {
			const rows = scripts.filter((s) => s.typeId === type.typeId)
			const list = byScope.get(type.content) ?? []
			list.push({ type, rows })
			byScope.set(type.content, list)
		}
		return [...byScope.entries()]
	})

	const scopeLabel = (content: string) =>
		content.charAt(0).toUpperCase() + content.slice(1)

	function toggle(row: Script) {
		if (openRow === row.id) {
			openRow = null
			return
		}
		openRow = row.id
		if (!drafts[row.id])
			drafts[row.id] = {
				name: row.name,
				source: row.source,
				varsIn: [...row.varsIn],
				varsOut: [...row.varsOut]
			}
	}

	const draftFor = (row: Script) =>
		drafts[row.id] ?? {
			name: row.name,
			source: row.source,
			varsIn: row.varsIn,
			varsOut: row.varsOut
		}

	const sameVars = (a: string[], b: string[]) =>
		a.length === b.length && a.every((v, i) => v === b[i])

	const dirty = (row: Script) => {
		const d = drafts[row.id]
		return (
			!!d &&
			(d.name !== row.name ||
				d.source !== row.source ||
				!sameVars(d.varsIn, row.varsIn) ||
				!sameVars(d.varsOut, row.varsOut))
		)
	}

	function save(row: Script) {
		const d = drafts[row.id]
		if (!d) return
		socket.emit("pipelines:updateScript", {
			id: row.id,
			name: d.name,
			source: d.source,
			varsIn: d.varsIn,
			varsOut: d.varsOut
		})
		delete drafts[row.id]
	}

	function revert(row: Script) {
		delete drafts[row.id]
		openRow = null
	}

	/** Enabled is not a draft: a toggle that waits for Save reads as broken. */
	function setEnabled(row: Script, enabled: boolean) {
		socket.emit("pipelines:updateScript", { id: row.id, enabled })
	}

	function remove(row: Script) {
		if (
			!confirm(
				row.usedBy.length
					? `'${row.name}' is still in a chain — ${row.usedBy.join(", ")}. ` +
							`The server will refuse until it is removed there. Try anyway?`
					: `Delete '${row.name}'? Nothing is using it.`
			)
		)
			return
		socket.emit("pipelines:deleteScript", { id: row.id })
	}

	/* --- the in/out toggles -------------------------------------------- */

	/**
	 * The declared I/O is chosen from a **fixed** set, never typed — ruled
	 * 2026-08-23. Reads offer the type's in-ports plus the extras some hook
	 * actually supplies; rewrites offer the out-ports. A name outside those
	 * sets is a declaration nothing will ever satisfy, and the server refuses
	 * it anyway — the toggles just make the legal space *be* the UI.
	 */
	const readChoices = (type: ScriptType) => [
		...type.varsIn,
		...type.extras.filter((e) => !type.varsIn.includes(e))
	]

	function toggleVar(row: Script, which: "in" | "out", value: string) {
		const d = drafts[row.id] ?? {
			name: row.name,
			source: row.source,
			varsIn: [...row.varsIn],
			varsOut: [...row.varsOut]
		}
		const list = which === "in" ? d.varsIn : d.varsOut
		const next = list.includes(value)
			? list.filter((v) => v !== value)
			: [...list, value]
		if (which === "in") d.varsIn = next
		else d.varsOut = next
		drafts[row.id] = d
	}

	/* --- sharing (18 §2, U-S7) ---------------------------------------- */

	/**
	 * The import review: parsed client-side for the *preview* — per-script
	 * opt-in, source visible, unknown types flagged — and re-validated
	 * server-side on submit, which is the copy that counts.
	 */
	type ImportItem = {
		name: string
		type: string
		typeName: string
		blastRadius: string
		known: boolean
		reads: string[]
		writes: string[]
		source: string
		checked: boolean
	}
	let importOpen = $state(false)
	let importText = $state("")
	let importError = $state<string | null>(null)
	let importItems = $state<ImportItem[] | null>(null)

	const exportIds = (ids: number[]) =>
		socket.emit("pipelines:exportScripts", { ids })

	function openImport() {
		importOpen = true
		importText = ""
		importItems = null
		importError = null
	}

	function parseImport() {
		importItems = null
		importError = null
		let raw: unknown
		try {
			raw = JSON.parse(importText)
		} catch {
			importError = "That is not JSON."
			return
		}
		const entries = Array.isArray((raw as any)?.scripts)
			? ((raw as any).scripts as unknown[])
			: [raw]
		const types = new Map(
			(view.types ?? []).map((t) => [t.typeId, t] as const)
		)
		const items: ImportItem[] = []
		for (const e of entries) {
			const item = e as Record<string, unknown> | null
			if (
				!item ||
				typeof item.type !== "string" ||
				typeof item.name !== "string" ||
				typeof item.source !== "string"
			) {
				importError =
					"Expected {type, name, source, in, out} entries — one, or a scripts@1 pack."
				return
			}
			const known = types.get(item.type)
			items.push({
				name: item.name,
				type: item.type,
				typeName: known?.name ?? item.type,
				blastRadius: known?.blastRadius ?? "",
				known: !!known,
				reads: Array.isArray(item.in) ? (item.in as string[]) : [],
				writes: Array.isArray(item.out) ? (item.out as string[]) : [],
				source: item.source,
				// Unknown types cannot land here — refused server-side too —
				// so the box starts unchecked and stays disabled.
				checked: !!known
			})
		}
		importItems = items
	}

	function importFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = () => {
			importText = String(reader.result ?? "")
			parseImport()
		}
		reader.readAsText(file)
	}

	function submitImport() {
		if (!importItems) return
		let raw: unknown
		try {
			raw = JSON.parse(importText)
		} catch {
			return
		}
		const accept = importItems
			.map((item, index) => (item.checked ? index : -1))
			.filter((index) => index >= 0)
		socket.emit("pipelines:importScripts", { artifact: raw, accept })
	}

	/* --- socket wiring ------------------------------------------------ */

	const WRITE_EVENTS = [
		"pipelines:createScript",
		"pipelines:cloneScript",
		"pipelines:updateScript",
		"pipelines:deleteScript"
	] as const

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on(
			"pipelines:scripts",
			(res: Sockets.Pipelines.Scripts.Response) => {
				view = res
				loading = false
			}
		)
		socket.on("pipelines:scripts:error", (res: { error?: string }) => {
			if (res.error) toaster.error({ title: res.error })
			loading = false
		})
		for (const event of WRITE_EVENTS) {
			socket.on(event, (res: Sockets.Pipelines.ScriptWrite.Response) => {
				if (res.scripts) view = res.scripts
			})
			socket.on(`${event}:error` as any, (res: { error?: string }) => {
				if (res.error) toaster.error({ title: res.error })
			})
		}
		socket.on(
			"pipelines:exportScripts",
			(res: Sockets.Pipelines.ScriptShare.ExportResponse) => {
				if (res.blob && res.filename)
					downloadBlob(res as { blob: unknown; filename: string })
			}
		)
		socket.on(
			"pipelines:exportScripts:error",
			(res: { error?: string }) => {
				if (res.error) toaster.error({ title: res.error })
			}
		)
		socket.on(
			"pipelines:importScripts",
			(res: Sockets.Pipelines.ScriptShare.ImportResponse) => {
				if (res.scripts) view = res.scripts
				importOpen = false
				const skippedForReal = (res.report?.skipped ?? []).filter(
					(s) => s.reason !== "not selected"
				)
				toaster.success({
					title: `Imported ${res.report?.imported.length ?? 0} script${
						(res.report?.imported.length ?? 0) === 1 ? "" : "s"
					}`,
					...(skippedForReal.length
						? {
								description: skippedForReal
									.map((s) => `${s.name}: ${s.reason}`)
									.join(" · ")
							}
						: {})
				})
			}
		)
		socket.on(
			"pipelines:importScripts:error",
			(res: { error?: string }) => {
				if (res.error) toaster.error({ title: res.error })
			}
		)
		socket.emit("pipelines:scripts", {})
	})

	onDestroy(() => {
		socket.off("pipelines:scripts")
		socket.off("pipelines:scripts:error")
		for (const event of WRITE_EVENTS) {
			socket.off(event)
			socket.off(`${event}:error` as any)
		}
		socket.off("pipelines:exportScripts")
		socket.off("pipelines:exportScripts:error")
		socket.off("pipelines:importScripts")
		socket.off("pipelines:importScripts:error")
	})
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
	<header class="flex items-center gap-3">
		<Icons.SquareCode size={24} class="shrink-0" />
		<div class="min-w-0 flex-1">
			<h1 class="text-2xl font-semibold">Scripts</h1>
			<p class="text-muted text-sm">
				Typed text that transforms a run — grouped by what it operates
				on, usable by any pipeline that accepts its type.
			</p>
		</div>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			onclick={openImport}
		>
			<Icons.Upload size={16} /> Import
		</button>
		<a class="btn btn-sm preset-tonal-surface" href="/pipelines">
			<Icons.ArrowLeft size={16} /> Pipelines
		</a>
	</header>

	{#if loading}
		<p class="text-muted text-sm">Loading…</p>
	{:else if !groups.length}
		<EmptyState
			icon={Icons.SquareCode}
			message="No script types are registered. Core registers its own at startup, so an empty list usually means the type registry refused to sync — check the server log for a bootstrap warning."
		/>
	{:else}
		{#each groups as [content, entries] (content)}
			<section class="flex flex-col gap-3">
				<h2 class="text-lg font-semibold">{scopeLabel(content)}</h2>
				{#each entries as { type, rows } (type.typeId)}
					<div
						class="card bg-surface-100-800 flex flex-col gap-2 p-3"
					>
						<div class="flex flex-wrap items-center gap-2">
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium">
									{type.name}
								</span>
								<span
									class="text-muted block truncate font-mono text-xs"
								>
									{type.typeId}
								</span>
							</span>
							<span
								class="preset-tonal-warning shrink-0 rounded-full px-2 py-0.5 text-xs"
								title="What a script of this type is able to do"
							>
								{type.blastRadius}
							</span>
							{#if rows.length}
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface shrink-0"
									title="Export these as one pack"
									onclick={() =>
										exportIds(rows.map((r) => r.id))}
								>
									<Icons.Download size={14} />
								</button>
							{/if}
							<button
								type="button"
								class="btn btn-sm preset-tonal-primary shrink-0"
								onclick={() =>
									socket.emit("pipelines:createScript", {
										typeId: type.typeId
									})}
							>
								<Icons.Plus size={14} /> New
							</button>
						</div>
						{#if type.description}
							<p class="text-muted text-xs">{type.description}</p>
						{/if}

						{#if !rows.length}
							<p class="text-muted text-xs italic">
								Nothing authored yet.
							</p>
						{/if}
						{#each rows as row (row.id)}
							{@const d = draftFor(row)}
							<div
								class="border-surface-200-700 rounded-lg border p-2"
							>
								<div class="flex items-center gap-2">
									<button
										type="button"
										class="flex min-w-0 flex-1 items-center gap-2 text-left"
										onclick={() => toggle(row)}
									>
										<Icons.ChevronRight
											size={14}
											class="shrink-0 transition-transform {openRow ===
											row.id
												? 'rotate-90'
												: ''}"
										/>
										<span
											class="truncate font-medium {row.enabled
												? ''
												: 'opacity-50'}"
										>
											{row.name}
										</span>
										{#if row.isImmutable}
											<Icons.Lock
												size={12}
												class="shrink-0"
											/>
										{/if}
									</button>
									<label
										class="text-muted flex shrink-0 items-center gap-1 text-xs"
										title="A disabled script keeps its place in every chain and does nothing."
									>
										<input
											type="checkbox"
											class="checkbox"
											checked={row.enabled}
											disabled={row.isImmutable}
											onchange={(e) =>
												setEnabled(
													row,
													e.currentTarget.checked
												)}
										/>
										Enabled
									</label>
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface shrink-0"
										title="Export"
										onclick={() => exportIds([row.id])}
									>
										<Icons.Download size={14} />
									</button>
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface shrink-0"
										title="Duplicate"
										onclick={() =>
											socket.emit(
												"pipelines:cloneScript",
												{ id: row.id }
											)}
									>
										<Icons.Copy size={14} />
									</button>
									{#if !row.isImmutable}
										<button
											type="button"
											class="btn btn-sm preset-tonal-surface shrink-0"
											title="Delete"
											onclick={() => remove(row)}
										>
											<Icons.Trash2 size={14} />
										</button>
									{/if}
								</div>

								<!-- The audit line: what it reads, what it may
								     rewrite — legible without opening the source. -->
								<p class="text-muted mt-1 pl-6 text-xs">
									<Icons.Eye size={11} class="inline" />
									reads {row.varsIn.join(", ") || "nothing"}
									{#if type.semantics === "transform"}
										· <Icons.Pencil
											size={11}
											class="inline"
										/>
										rewrites {row.varsOut.join(", ") ||
											"nothing"}
									{:else}
										· returns a verdict — never rewrites
									{/if}
								</p>
								<p class="text-muted mt-1 pl-6 text-xs">
									{#if row.usedBy.length}
										<Icons.Link2 size={11} class="inline" />
										Used by {row.usedBy.join(", ")}
									{:else}
										<Icons.Unlink
											size={11}
											class="inline"
										/>
										Not attached to any chain
									{/if}
								</p>

								{#if openRow === row.id}
									<div class="mt-3 space-y-3 pl-6">
										{#if row.isImmutable}
											<p class="text-muted text-xs">
												<Icons.Lock
													size={11}
													class="inline"
												/>
												One of the scripts Serene Pub ships.
												Duplicate it to make it yours.
											</p>
										{:else}
											<label
												class="flex flex-col gap-1 text-xs font-medium"
											>
												Name
												<input
													type="text"
													class="input w-full"
													value={d.name}
													oninput={(e) =>
														(drafts[row.id] = {
															...draftFor(row),
															name: e
																.currentTarget
																.value
														})}
												/>
											</label>
										{/if}

										<!-- Fixed sets, not freeform: the toggles
										     *are* the legal space — ports plus the
										     extras a hook supplies for reads, the
										     out-ports for rewrites. A name nothing
										     supplies cannot be declared here, which
										     is the rule the server enforces anyway. -->
										{#snippet toggles(
											which: "in" | "out",
											label: string,
											choices: string[],
											selected: string[]
										)}
											<div
												class="flex flex-col gap-1 text-xs font-medium"
											>
												{label}
												<div
													class="flex flex-wrap items-center gap-1"
												>
													{#each choices as value (value)}
														{@const on =
															selected.includes(
																value
															)}
														<button
															type="button"
															class="{on
																? 'preset-filled-primary-500'
																: 'preset-tonal-surface opacity-60'} rounded-full px-2 py-0.5 font-mono"
															disabled={row.isImmutable}
															title={on
																? "Declared — click to remove"
																: "Not declared — click to add"}
															onclick={() =>
																toggleVar(
																	row,
																	which,
																	value
																)}
														>
															{value}
														</button>
													{/each}
												</div>
											</div>
										{/snippet}

										{@render toggles(
											"in",
											"Reads (in)",
											readChoices(type),
											d.varsIn
										)}
										{#if type.semantics === "transform"}
											{@render toggles(
												"out",
												"Rewrites (out)",
												type.varsOut,
												d.varsOut
											)}
											<p class="text-muted text-xs">
												A variable that is read but not
												declared under rewrites is
												read-only — the script sees it
												and cannot change what flows on.
												Extras a hook supplies are
												read-only by construction.
											</p>
										{:else}
											<p class="text-muted text-xs">
												A verdict script returns a stop
												index the hook consumes. It has
												no rewrites to declare.
											</p>
										{/if}

										<label
											class="flex flex-col gap-1 text-xs font-medium"
										>
											Source
											<textarea
												class="textarea w-full font-mono text-xs"
												rows={row.isImmutable ? 4 : 10}
												readonly={row.isImmutable}
												spellcheck="false"
												value={d.source}
												oninput={(e) =>
													(drafts[row.id] = {
														...draftFor(row),
														source: e.currentTarget
															.value
													})}
											></textarea>
										</label>

										{#if !row.isImmutable && dirty(row)}
											<div class="flex gap-2">
												<button
													type="button"
													class="btn btn-sm preset-filled-primary-500"
													onclick={() => save(row)}
												>
													<Icons.Save size={14} /> Save
												</button>
												<button
													type="button"
													class="btn btn-sm preset-tonal-surface"
													onclick={() => revert(row)}
												>
													Cancel
												</button>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/each}
			</section>
		{/each}

		<p class="text-muted text-xs">
			<Icons.Info size={12} class="inline" />
			Scripts run in a sandbox with no network, no storage, and the run's own
			seeded randomness. Attach them to steps in a pipeline's configuration,
			or attach stop scripts to a connection in its settings — every application
			lands in the run's receipt, per link.
		</p>
	{/if}

	{#if importOpen}
		<!-- The import review (18 §2, U-S7): per-script opt-in, source shown
		     with the same prominence as anything else — a pack is no longer
		     inert data, and this screen is where that fact is made visible. -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		>
			<div
				class="card bg-surface-100-800 flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto p-4"
			>
				<div class="flex items-center gap-2">
					<Icons.Upload size={18} class="shrink-0" />
					<h2 class="flex-1 text-lg font-semibold">Import scripts</h2>
					<button
						type="button"
						class="btn-icon btn-icon-sm preset-tonal-surface"
						title="Close"
						onclick={() => (importOpen = false)}
					>
						<Icons.X size={14} />
					</button>
				</div>

				{#if !importItems}
					<p class="text-muted text-sm">
						Paste a script artifact, or pick a file — a single
						script or a pack. You will review each one before
						anything lands.
					</p>
					<input
						type="file"
						accept=".json,application/json"
						class="input"
						onchange={importFile}
					/>
					<textarea
						class="textarea w-full font-mono text-xs"
						rows="8"
						spellcheck="false"
						placeholder={'{ "serenePub": "scripts@1", "scripts": [...] }'}
						bind:value={importText}
					></textarea>
					{#if importError}
						<p class="text-error-500 text-sm">{importError}</p>
					{/if}
					<button
						type="button"
						class="btn preset-filled-primary-500"
						disabled={!importText.trim()}
						onclick={parseImport}
					>
						Review
					</button>
				{:else}
					{#each importItems as item, index (index)}
						<div
							class="border-surface-200-700 flex flex-col gap-1 rounded-lg border p-2"
						>
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									class="checkbox"
									disabled={!item.known}
									bind:checked={item.checked}
								/>
								<span
									class="min-w-0 flex-1 truncate font-medium"
								>
									{item.name}
								</span>
								{#if item.known}
									<span
										class="preset-tonal-warning shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
									>
										{item.blastRadius || item.typeName}
									</span>
								{:else}
									<span
										class="preset-tonal-error shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
										title="This build registers no such script type, so it could never be attached anywhere."
									>
										unknown type
									</span>
								{/if}
							</label>
							<p class="text-muted pl-6 text-xs">
								<Icons.Eye size={11} class="inline" />
								reads {item.reads.join(", ") || "nothing"} ·
								<Icons.Pencil size={11} class="inline" />
								rewrites {item.writes.join(", ") || "nothing"}
								{#if !item.known}
									· <span class="font-mono">{item.type}</span>
								{/if}
							</p>
							<details class="pl-6">
								<summary
									class="text-muted cursor-pointer text-xs"
								>
									Source
								</summary>
								<pre
									class="bg-surface-200-700 mt-1 max-h-48 overflow-auto rounded p-2 font-mono text-xs">{item.source}</pre>
							</details>
						</div>
					{/each}
					<div class="flex gap-2">
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={!importItems.some((i) => i.checked)}
							onclick={submitImport}
						>
							Import {importItems.filter((i) => i.checked).length}
							selected
						</button>
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={() => (importItems = null)}
						>
							Back
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
