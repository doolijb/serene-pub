<script lang="ts">
	/**
	 * Admin › Plugins: the changelist (note 37, Django admin) of installed
	 * extensions — status, review, backend, version — with bulk Enable,
	 * Disable and Uninstall (a confirmation page: stored data goes, the log
	 * history stays). A row opens its change form at `/admin/plugins/<id>`:
	 * backend, concurrency, settings, permissions and storage.
	 *
	 * Below the list, two instance-wide panels (Django's "Recent actions"):
	 * **Running now** — the live sandbox monitor with Ask to stop and Kill —
	 * and **Recent hook calls**. An inert sandbox is surfaced, not hidden: with
	 * the flag off (the 0.6.0 release default) plugins are managed here but
	 * do not run. Admin only, checked here and again in every handler.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import type {
		AdminBulkAction,
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import { hookOutcome, HOOK_OUTCOME_CLASS } from "./hookOutcome"
	import { PLUGIN_NOUN, backendWord, pluginStatus, pluginUninstall } from "./pluginsAdmin"
	import { awaitReply } from "$lib/client/utils/awaitReply"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `plugins:` is a
	// RESTRICTED interest family.
	const interest = getAdminInterestContext()

	type Row = Sockets.Plugins.PluginRow
	let plugins = $state<Row[]>([])
	let logs = $state<Sockets.Plugins.LogRow[]>([])
	let active = $state<Sockets.Plugins.ActiveRow[]>([])
	let sandboxEnabled = $state(false)
	let loading = $state(true)
	let pollTimer: ReturnType<typeof setInterval> | null = null

	/* ── install a package from a file (PLAN-pipeline-canvas-and-genre-authoring P5) ── */
	let fileInput = $state<HTMLInputElement | null>(null)
	let installing = $state(false)
	let installNote = $state<{ tone: "ok" | "error"; text: string } | null>(null)
	const MAX_PACKAGE_BYTES = 8 * 1024 * 1024

	const toBase64 = (file: File) =>
		new Promise<string>((resolve, reject) => {
			const reader = new FileReader()
			reader.onerror = () => reject(new Error("The file could not be read."))
			reader.onload = () => {
				const url = String(reader.result ?? "")
				resolve(url.slice(url.indexOf(",") + 1))
			}
			reader.readAsDataURL(file)
		})

	async function installFromFile(file: File) {
		installNote = null
		if (file.size > MAX_PACKAGE_BYTES) {
			installNote = { tone: "error", text: `${file.name} is over the 8 MiB a package may be.` }
			return
		}
		installing = true
		try {
			const bytes = await toBase64(file)
			const res = (await awaitReply({
				socket,
				event: "plugins:installPackage",
				errorEvent: "plugins:installPackage:error",
				params: { filename: file.name, bytes },
				match: (r) => typeof r?.pluginId === "string",
				timeoutMs: 120_000
			})) as Sockets.Plugins.InstallPackage.Response
			const counts = `${res.specs.length} ${res.specs.length === 1 ? "pipeline" : "pipelines"}, ${res.genres.length} ${res.genres.length === 1 ? "genre" : "genres"}, ${res.configs.length} ${res.configs.length === 1 ? "configuration" : "configurations"}, ${res.files} ${res.files === 1 ? "file" : "files"}`
			installNote = res.warnings.length
				? { tone: "error", text: `${res.pluginId} installed (${counts}) with ${res.warnings.length} ${res.warnings.length === 1 ? "warning" : "warnings"}: ${res.warnings.join(" · ")}` }
				: { tone: "ok", text: `${res.pluginId} installed: ${counts}. It lands switched off; open it to turn it on.` }
			if (res.plugins) plugins = res.plugins
			socket.emit("plugins:list", {})
		} catch (e) {
			installNote = { tone: "error", text: e instanceof Error ? e.message : "The package was refused." }
		} finally {
			installing = false
			if (fileInput) fileInput.value = ""
		}
	}

	/**
	 * The three page-wide reads, each asked for and listened for in one. All
	 * BARE — an installed set is the instance's — and STANDING: `list` and
	 * `active` are re-asked by the poll and re-emitted after every write.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.requestWithInterest("plugins:list", {}, (res) => {
				plugins = res.plugins
				sandboxEnabled = res.sandboxEnabled
				loading = false
			}),
			interest.requestWithInterest("plugins:logs", { limit: 100 }, (res) => {
				logs = res.logs
			}),
			interest.requestWithInterest("plugins:active", {}, (res) => {
				active = res.active
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		// `warm` is live truth that changes as hooks fire, and a stale badge
		// reads as a stuck unload: the list rides the monitor's poll.
		pollTimer = setInterval(() => {
			socket.emit("plugins:active", {})
			socket.emit("plugins:list", {})
		}, 2000)
	})
	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer)
	})

	const columns: AdminChangelistColumn<Row>[] = $derived([
		{ key: "name", label: "Name", primary: true, text: (p) => p.name, sortValue: (p) => p.name },
		{
			key: "status",
			label: "Status",
			custom: true,
			text: (p) => pluginStatus(p, sandboxEnabled).label,
			sortValue: (p) => pluginStatus(p, sandboxEnabled).order
		},
		{
			key: "review",
			label: "Permissions",
			text: (p) => (p.needsReview ? "Needs review" : "Reviewed"),
			sortValue: (p) => (p.needsReview ? 0 : 1)
		},
		{ key: "backend", label: "Backend", text: (p) => backendWord(p.backend), sortValue: (p) => p.backend },
		{
			key: "id",
			label: "Id",
			text: (p) => `${p.pluginId} · v${p.version}`,
			sortValue: (p) => p.pluginId,
			class: "font-mono text-xs",
			hideWhenStacked: true
		}
	])

	const filters: AdminChangelistFilter<Row>[] = [
		{
			key: "enabled",
			label: "Status",
			values: (p) => (p.enabled ? "enabled" : "disabled"),
			optionLabel: (v) => (v === "enabled" ? "Enabled" : "Disabled"),
			order: ["enabled", "disabled"]
		},
		{
			key: "review",
			label: "Permissions",
			values: (p) => (p.needsReview ? "pending" : "reviewed"),
			optionLabel: (v) => (v === "pending" ? "Needs review" : "Reviewed"),
			order: ["pending", "reviewed"]
		},
		{ key: "backend", label: "Backend", values: (p) => p.backend, optionLabel: backendWord }
	]

	function setEnabled(selected: Row[], enabled: boolean) {
		for (const p of selected.filter((p) => p.enabled !== enabled))
			socket.emit("plugins:setEnabled", { pluginId: p.pluginId, enabled })
	}
	const bulkActions: AdminBulkAction<Row>[] = [
		{ key: "enable", label: "Enable selected plugins", icon: Icons.Power, run: (s) => setEnabled(s, true) },
		{ key: "disable", label: "Disable selected plugins", icon: Icons.PowerOff, run: (s) => setEnabled(s, false) },
		{
			key: "uninstall",
			label: "Uninstall selected plugins…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (s) => pluginUninstall(s),
			run: (s) => {
				for (const p of s) socket.emit("plugins:uninstall", { pluginId: p.pluginId })
			}
		}
	]

	const DOT: Record<string, string> = {
		loaded: "bg-success-500",
		idle: "bg-success-500/50",
		enabled: "bg-success-500",
		disabled: "bg-surface-400-600"
	}
	const elapsed = (startedAt: number) =>
		`${Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10)}s`
</script>

<div class="flex min-w-0 flex-col gap-4">
	<AdminChangelist
		title="Plugins"
		doc={docsHref("environment-variables", "feature-toggles")}
		purpose="Installed extensions: what each may do and how it runs. Open one for its settings, permissions and storage."
		rows={plugins}
		rowKey={(p) => p.pluginId}
		{columns}
		{filters}
		{bulkActions}
		{loading}
		noun={PLUGIN_NOUN}
		searchText={(p) => `${p.name} ${p.pluginId} ${p.version}`}
		rowHref={(p) => `/admin/plugins/${encodeURIComponent(p.pluginId)}`}
		defaultSort="name"
		emptyIcon={Icons.Puzzle}
		emptyMessage="No extensions installed."
	>
		{#snippet headerExtra()}
			<div class="flex flex-wrap items-center gap-2">
				<input
					bind:this={fileInput}
					type="file"
					accept=".zip,application/zip"
					class="sr-only"
					aria-label="Choose a package file"
					onchange={(e) => {
						const f = (e.currentTarget as HTMLInputElement).files?.[0]
						if (f) void installFromFile(f)
					}}
				/>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					disabled={installing}
					title="A content-only package: a zip in the dist/plugin layout, as Export as plugin writes"
					onclick={() => fileInput?.click()}
				>
					<Icons.PackagePlus size={14} /> {installing ? "Installing…" : "Install a package…"}
				</button>
				{#if installNote}
					<p class="flex items-start gap-2 text-sm {installNote.tone === 'error' ? 'text-error-600-400' : 'text-surface-700-300'}" role="status">
						<span class="mt-1.5 size-2 shrink-0 rounded-full {installNote.tone === 'error' ? 'bg-error-500' : 'bg-success-500'}" aria-hidden="true"></span>
						<span>{installNote.text}</span>
					</p>
				{/if}
			</div>
			{#if !loading && !sandboxEnabled}
				<!-- The one status line (§6.11): a dot plus words and the fix. -->
				<p
					data-field="plugin-sandbox"
					class="text-surface-700-300 flex items-start gap-2 text-sm"
					role="status"
				>
					<span class="bg-surface-500 mt-1.5 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
					<span>
						The plugin sandbox is off, so hooks do not run. You can still install and configure plugins.
						<a class="anchor" href="/docs/environment-variables#feature-toggles">How to turn it on</a>
					</span>
				</p>
			{/if}
		{/snippet}
		{#snippet cell(row, col)}
			{#if col.key === "status"}
				{@const s = pluginStatus(row, sandboxEnabled)}
				<span class="inline-flex items-center gap-1.5" title={s.title}>
					<span class="size-2 shrink-0 rounded-full {DOT[s.key]}" aria-hidden="true"></span>
					{s.label}
				</span>
			{/if}
		{/snippet}
	</AdminChangelist>

	<AdminFieldset id="running-plugins" title="Running now" description="Hook calls in their sandbox at this moment.">
		{#if active.length === 0}
			<p class="text-surface-600-400 text-sm">Nothing running.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each active as a (a.callId)}
					<li class="bg-surface-50-950 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-base p-3">
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">
								{a.pluginName} · {a.hookName}{a.lifecycle ? " (lifecycle)" : ""}
							</div>
							<div class="text-surface-600-400 text-xs">
								{a.backend} · {a.user ?? "—"} · {elapsed(a.startedAt)}
							</div>
						</div>
						<div class="flex flex-wrap gap-2">
							<!-- Ask first: the hook's ctx.signal fires and it winds
							     down in its own frame. Only a hook awaiting something
							     hears it; Kill is what is left. -->
							<button
								type="button"
								class="btn btn-sm preset-tonal-warning"
								title="Ask the hook to stop itself and wind down"
								onclick={() => socket.emit("plugins:abort", { callId: a.callId })}
							>
								Ask to stop
							</button>
							<button
								type="button"
								class="btn btn-sm preset-tonal-error"
								onclick={() => socket.emit("plugins:kill", { callId: a.callId })}
							>
								Kill
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</AdminFieldset>

	<AdminFieldset id="hook-calls" title="Recent hook calls">
		{#snippet aside()}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface shrink-0"
				onclick={() => socket.emit("plugins:logs", { limit: 100 })}
			>
				<Icons.RefreshCw size={14} aria-hidden="true" /> Refresh
			</button>
		{/snippet}
		{#if logs.length === 0}
			<p class="text-surface-600-400 text-sm">No invocations logged yet.</p>
		{:else}
			<ul class="flex flex-col gap-1">
				{#each logs as l (l.id)}
					{@const o = hookOutcome(l)}
					<li class="bg-surface-50-950 flex flex-col gap-0.5 rounded-base px-3 py-2 text-sm">
						<div class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-medium">{l.pluginName}</span>
							<span class="text-surface-700-300">{l.hookName}</span>
							<span class="text-surface-600-400 ml-auto text-xs">
								{l.backend} · {l.mode} · {l.durationMs} ms
							</span>
						</div>
						<div class="text-xs break-words {HOOK_OUTCOME_CLASS[o.tone]}">{o.text}</div>
					</li>
				{/each}
			</ul>
		{/if}
	</AdminFieldset>
</div>
