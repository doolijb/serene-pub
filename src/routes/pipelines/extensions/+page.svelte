<script lang="ts">
	/**
	 * Extensions — the admin surface for the plugin subsystem.
	 *
	 * Interim home under the pipeline management page (re-homed under a dedicated
	 * admin route later; built self-contained so that move is a re-link). Admin
	 * only, checked here and again in every handler. Shows the installed set with
	 * the security/speed dial, the live runtime monitor with a manual kill, and
	 * the hook-invocation log. Inert-runtime is surfaced, not hidden — with the
	 * flag off (the 0.6.0 release default) plugins are managed here but do not run.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	let plugins: Sockets.Plugins.PluginRow[] = $state([])
	let logs: Sockets.Plugins.LogRow[] = $state([])
	let active: Sockets.Plugins.ActiveRow[] = $state([])
	let runtimeEnabled = $state(false)
	let loading = $state(true)
	let permsByPlugin = $state<Record<string, Sockets.Plugins.PermState[]>>({})
	let openPerms = $state<string | null>(null)
	let pollTimer: ReturnType<typeof setInterval> | null = null

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("plugins:list", (res: Sockets.Plugins.List.Response) => {
			plugins = res.plugins
			runtimeEnabled = res.runtimeEnabled
			loading = false
		})
		socket.on("plugins:logs", (res: Sockets.Plugins.Logs.Response) => {
			logs = res.logs
		})
		socket.on("plugins:active", (res: Sockets.Plugins.Active.Response) => {
			active = res.active
		})
		socket.on(
			"plugins:permissions",
			(res: Sockets.Plugins.Permissions.Response) => {
				permsByPlugin[res.pluginId] = res.permissions
			}
		)
		socket.emit("plugins:list", {})
		socket.emit("plugins:logs", { limit: 100 })
		socket.emit("plugins:active", {})
		pollTimer = setInterval(() => socket.emit("plugins:active", {}), 2000)
	})

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer)
	})

	function setEnabled(p: Sockets.Plugins.PluginRow, enabled: boolean) {
		socket.emit("plugins:setEnabled", { pluginId: p.pluginId, enabled })
	}
	function setBackend(p: Sockets.Plugins.PluginRow, backend: "quickjs" | "ses") {
		socket.emit("plugins:setBackend", { pluginId: p.pluginId, backend })
	}
	function setSequential(p: Sockets.Plugins.PluginRow, sequential: boolean) {
		socket.emit("plugins:setSequential", { pluginId: p.pluginId, sequential })
	}
	function uninstall(p: Sockets.Plugins.PluginRow) {
		if (confirm(`Uninstall "${p.name}"? Its stored data is removed; its log history is kept.`))
			socket.emit("plugins:uninstall", { pluginId: p.pluginId })
	}
	function kill(callId: number) {
		socket.emit("plugins:kill", { callId })
	}
	function togglePerms(pluginId: string) {
		openPerms = openPerms === pluginId ? null : pluginId
		if (openPerms) socket.emit("plugins:permissions", { pluginId })
	}
	function setPerm(pluginId: string, key: string, granted: boolean) {
		socket.emit("plugins:setPermission", { pluginId, key, granted })
	}
	function elapsed(startedAt: number): string {
		return `${Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10)}s`
	}
</script>

<div class="container mx-auto max-w-5xl space-y-6 p-4">
	<header class="flex items-center justify-between">
		<h1 class="h2">Extensions</h1>
		<a href="/pipelines" class="btn variant-soft btn-sm">← Pipelines</a>
	</header>

	{#if !runtimeEnabled}
		<aside class="card variant-soft-warning p-3 text-sm">
			The plugin <strong>runtime is disabled</strong> (<code>SP_PLUGINS_ENABLED</code>
			is not set). You can install and configure extensions here, but hooks do
			not run until it is enabled. 0.6.0 releases ship with it off.
		</aside>
	{/if}

	<!-- Installed plugins -->
	<section class="card p-4">
		<h2 class="h4 mb-3">Installed</h2>
		{#if loading}
			<p class="text-surface-500">Loading…</p>
		{:else if plugins.length === 0}
			<p class="text-surface-500">No extensions installed.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="table table-compact w-full">
					<thead>
						<tr>
							<th>Name</th>
							<th>Backend (security / speed)</th>
							<th>Concurrency</th>
							<th>Enabled</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each plugins as p (p.pluginId)}
							<tr>
								<td>
									<div class="font-medium">{p.name}</div>
									<div class="text-xs text-surface-500">{p.pluginId} · v{p.version}</div>
								</td>
								<td>
									<select
										class="select select-sm"
										value={p.backend}
										disabled={p.backends.length < 2}
										onchange={(e) =>
											setBackend(p, e.currentTarget.value === "ses" ? "ses" : "quickjs")}
									>
										{#each p.backends as b}
											<option value={b}
												>{b === "quickjs"
													? "WASM — max isolation (slower)"
													: "SES — faster (weaker isolation)"}</option
											>
										{/each}
									</select>
								</td>
								<td>
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											class="checkbox"
											checked={p.sequential}
											onchange={(e) => setSequential(p, e.currentTarget.checked)}
										/>
										Sequential
									</label>
								</td>
								<td>
									<input
										type="checkbox"
										class="checkbox"
										checked={p.enabled}
										onchange={(e) => setEnabled(p, e.currentTarget.checked)}
									/>
								</td>
								<td class="text-right whitespace-nowrap">
									<button
										class="btn btn-sm variant-soft"
										onclick={() => togglePerms(p.pluginId)}
									>
										Permissions
									</button>
									<button class="btn btn-sm variant-soft-error" onclick={() => uninstall(p)}>
										Uninstall
									</button>
								</td>
							</tr>
							{#if openPerms === p.pluginId}
								<tr>
									<td colspan="5">
										<div class="space-y-1 p-2">
											<div class="text-sm font-medium">Permissions (admin deny)</div>
											{#if (permsByPlugin[p.pluginId] ?? []).length === 0}
												<p class="text-surface-500 text-xs">
													This extension declares no permissions.
												</p>
											{:else}
												{#each permsByPlugin[p.pluginId] as perm (perm.key)}
													<label class="flex items-center gap-2 text-sm">
														<input
															type="checkbox"
															class="checkbox"
															checked={perm.granted}
															onchange={(e) =>
																setPerm(p.pluginId, perm.key, e.currentTarget.checked)}
														/>
														<span>{perm.label}</span>
														{#if perm.accountAffecting}
															<span class="text-warning-600 text-xs"
																>(affects user accounts)</span
															>
														{/if}
													</label>
												{/each}
											{/if}
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<!-- Live runtime monitor -->
	<section class="card p-4">
		<h2 class="h4 mb-3">Running now</h2>
		{#if active.length === 0}
			<p class="text-surface-500 text-sm">Nothing running.</p>
		{:else}
			<table class="table table-compact w-full">
				<thead>
					<tr><th>Extension</th><th>Hook</th><th>Backend</th><th>User</th><th>Elapsed</th><th></th></tr>
				</thead>
				<tbody>
					{#each active as a (a.callId)}
						<tr>
							<td>{a.pluginName}</td>
							<td>{a.hookName}{a.lifecycle ? " (startup)" : ""}</td>
							<td>{a.backend}</td>
							<td>{a.user ?? "—"}</td>
							<td>{elapsed(a.startedAt)}</td>
							<td class="text-right">
								<button class="btn btn-sm variant-soft-error" onclick={() => kill(a.callId)}>
									Kill
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<!-- Hook invocation log -->
	<section class="card p-4">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="h4">Recent hook calls</h2>
			<button class="btn btn-sm variant-soft" onclick={() => socket.emit("plugins:logs", { limit: 100 })}>
				Refresh
			</button>
		</div>
		{#if logs.length === 0}
			<p class="text-surface-500 text-sm">No invocations logged yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="table table-compact w-full text-sm">
					<thead>
						<tr><th>Extension</th><th>Hook</th><th>Backend</th><th>Mode</th><th>ms</th><th>Outcome</th></tr>
					</thead>
					<tbody>
						{#each logs as l (l.id)}
							<tr>
								<td>{l.pluginName}</td>
								<td>{l.hookName}</td>
								<td>{l.backend}</td>
								<td>{l.mode}</td>
								<td>{l.durationMs}</td>
								<td class={l.ok ? "text-success-600" : "text-error-600"}>
									{l.outcome}{l.reason ? `: ${l.reason}` : ""}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
