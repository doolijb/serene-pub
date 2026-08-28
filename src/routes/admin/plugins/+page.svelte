<script lang="ts">
	/**
	 * Plugins — the admin surface for the plugin subsystem.
	 *
	 * Re-homed under the administration shell as designed (formerly
	 * `/pipelines/extensions`, which now redirects here). Admin
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
	let storageByPlugin = $state<
		Record<string, Sockets.Plugins.StorageQuota | undefined>
	>({})
	/** Per-plugin storage-override input draft (MB), bound to the quota field. */
	let quotaDraft = $state<Record<string, number | null>>({})
	let openPerms = $state<string | null>(null)
	let pollTimer: ReturnType<typeof setInterval> | null = null

	/* --- plugin settings (12 §6) -------------------------------------- */

	/** The fetched view per plugin: schema, masked values, config state. */
	let settingsByPlugin = $state<
		Record<string, Sockets.Plugins.SettingsView | null>
	>({})
	let openSettings = $state<string | null>(null)
	/** Unsaved edits, per plugin — only touched fields are ever sent. */
	let settingsDraft = $state<Record<string, Record<string, unknown>>>({})
	let settingsError = $state<Record<string, string | null>>({})

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
				storageByPlugin[res.pluginId] = res.storage
			}
		)
		socket.on(
			"plugins:getSettings",
			(res: Sockets.Plugins.GetSettings.Response) => {
				settingsByPlugin[res.pluginId] = res.settings
				settingsError[res.pluginId] = null
				// A fresh view supersedes the draft: it either reflects the
				// save that just landed, or the panel was just opened.
				delete settingsDraft[res.pluginId]
			}
		)
		socket.on(
			"plugins:setSettings:error",
			(res: Sockets.Plugins.SetSettings.Response) => {
				if (res.error) settingsError[res.pluginId] = res.error
			}
		)
		socket.emit("plugins:list", {})
		socket.emit("plugins:logs", { limit: 100 })
		socket.emit("plugins:active", {})
		// The list rides the same poll as the monitor: `warm` is runtime truth
		// that changes as hooks fire, and a stale badge reads as a stuck unload.
		pollTimer = setInterval(() => {
			socket.emit("plugins:active", {})
			socket.emit("plugins:list", {})
		}, 2000)
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
	/** Drop the loaded copy; the plugin stays installed and reloads on the next call. */
	function unload(p: Sockets.Plugins.PluginRow) {
		socket.emit("plugins:unload", { pluginId: p.pluginId })
	}
	function kill(callId: number) {
		socket.emit("plugins:kill", { callId })
	}
	function togglePerms(pluginId: string) {
		openPerms = openPerms === pluginId ? null : pluginId
		if (openPerms) socket.emit("plugins:permissions", { pluginId })
	}
	function toggleSettings(pluginId: string) {
		openSettings = openSettings === pluginId ? null : pluginId
		if (openSettings) socket.emit("plugins:getSettings", { pluginId })
	}
	function editSetting(pluginId: string, key: string, value: unknown) {
		settingsDraft[pluginId] = {
			...(settingsDraft[pluginId] ?? {}),
			[key]: value
		}
	}
	function saveSettings(pluginId: string) {
		const draft = settingsDraft[pluginId]
		if (!draft || !Object.keys(draft).length) return
		socket.emit("plugins:setSettings", { pluginId, values: draft })
	}
	/** The value a control shows: the draft's if touched, else the stored one. */
	function settingValue(pluginId: string, key: string): unknown {
		const d = settingsDraft[pluginId]
		if (d && key in d) return d[key]
		return settingsByPlugin[pluginId]?.values?.[key]
	}
	const fieldLabel = (key: string, decl: any): string =>
		typeof decl?.label === "string"
			? decl.label
			: (decl?.label?.en ?? key)
	const fieldDescription = (decl: any): string | null =>
		typeof decl?.description === "string"
			? decl.description
			: (decl?.description?.en ?? null)
	function setPerm(pluginId: string, key: string, granted: boolean) {
		socket.emit("plugins:setPermission", { pluginId, key, granted })
	}
	function fmtBytes(n: number | null | undefined): string {
		if (n == null) return "—"
		if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`
		return `${Math.round(n / 1024)} KB`
	}
	/** Apply an override typed in MB, or clear it (mb = null). */
	function setStorageQuota(pluginId: string, mb: number | null) {
		const bytes =
			mb == null || !Number.isFinite(mb) || mb <= 0
				? null
				: Math.round(mb * 1024 * 1024)
		socket.emit("plugins:setStorageQuota", { pluginId, bytes })
	}
	function elapsed(startedAt: number): string {
		return `${Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10)}s`
	}
</script>

<div class="max-w-5xl space-y-6">
	<header class="flex items-center justify-between">
		<div>
			<h2 class="text-lg font-semibold">Plugins</h2>
			<p class="text-surface-600-400 text-sm">
				Installed extensions: permissions, storage, runtime monitor,
				and the hook-invocation log.
			</p>
		</div>
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
			<p class="text-surface-600-400">Loading…</p>
		{:else if plugins.length === 0}
			<p class="text-surface-600-400">No extensions installed.</p>
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
									<div class="text-xs text-surface-600-400">
										{p.pluginId} · v{p.version}
										{#if runtimeEnabled && p.enabled}
											{#if p.warm}
												<span
													class="text-success-600"
													title="A copy is loaded in its sandbox right now"
												>
													· loaded
												</span>
											{:else}
												<span
													title="Nothing loaded — the first hook call loads it"
												>
													· idle
												</span>
											{/if}
										{/if}
									</div>
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
									{#if runtimeEnabled && p.warm}
										<button
											class="btn btn-sm variant-soft"
											title="Drop the loaded copy and free its sandbox — it reloads on the next hook call"
											onclick={() => unload(p)}
										>
											Unload
										</button>
									{/if}
									{#if p.hasSettings}
										<button
											class="btn btn-sm variant-soft"
											onclick={() => toggleSettings(p.pluginId)}
										>
											Settings
										</button>
									{/if}
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
							{#if openSettings === p.pluginId}
								{@const view = settingsByPlugin[p.pluginId]}
								<tr>
									<td colspan="5">
										<div class="space-y-3 p-2">
											<div class="text-sm font-medium">Settings</div>
											{#if !view}
												<p class="text-surface-600-400 text-xs">Loading…</p>
											{:else}
												{#if view.state.state === "needs-configuration"}
													<p class="text-warning-600 text-xs">
														Waiting on {view.state.missing.join(", ")} — the
														extension is installed and listed, not broken.
													</p>
												{/if}
												{#each Object.entries(view.schema) as [key, decl] (key)}
													<label class="flex flex-col gap-1 text-sm">
														<span class="font-medium">
															{fieldLabel(key, decl)}
															{#if decl.required}
																<span class="text-warning-600">*</span>
															{/if}
														</span>
														{#if fieldDescription(decl)}
															<span class="text-surface-600-400 text-xs">
																{fieldDescription(decl)}
															</span>
														{/if}
														{#if decl.type === "secret"}
															{@const set = (settingsByPlugin[p.pluginId]?.values?.[key] as any)?.$secretSet}
															<div class="flex items-center gap-2">
																<input
																	type="password"
																	class="input input-sm max-w-xs"
																	placeholder={set
																		? "•••••• (set — type to replace)"
																		: "not set"}
																	value={typeof settingValue(p.pluginId, key) === "string"
																		? (settingValue(p.pluginId, key) as string)
																		: ""}
																	oninput={(e) =>
																		editSetting(p.pluginId, key, e.currentTarget.value)}
																/>
																{#if set}
																	<button
																		class="btn btn-sm variant-soft"
																		title="Clear the stored secret"
																		onclick={() => editSetting(p.pluginId, key, null)}
																	>
																		Clear
																	</button>
																{/if}
															</div>
														{:else if decl.type === "boolean"}
															<input
																type="checkbox"
																class="checkbox"
																checked={!!settingValue(p.pluginId, key)}
																onchange={(e) =>
																	editSetting(p.pluginId, key, e.currentTarget.checked)}
															/>
														{:else if decl.type === "enum"}
															<select
																class="select select-sm max-w-xs"
																value={settingValue(p.pluginId, key) ?? ""}
																onchange={(e) =>
																	editSetting(p.pluginId, key, e.currentTarget.value)}
															>
																{#each decl.of ?? [] as opt}
																	<option value={opt}>{opt}</option>
																{/each}
															</select>
														{:else if decl.type === "number" || decl.type === "integer"}
															<input
																type="number"
																class="input input-sm max-w-xs"
																step={decl.type === "integer" ? "1" : "any"}
																min={decl.min}
																max={decl.max}
																value={settingValue(p.pluginId, key) ?? ""}
																oninput={(e) => {
																	const n = Number(e.currentTarget.value)
																	editSetting(
																		p.pluginId,
																		key,
																		Number.isFinite(n) ? n : undefined
																	)
																}}
															/>
														{:else if decl.type === "string[]"}
															<input
																type="text"
																class="input input-sm"
																placeholder="comma-separated"
																value={Array.isArray(settingValue(p.pluginId, key))
																	? (settingValue(p.pluginId, key) as string[]).join(", ")
																	: ""}
																oninput={(e) =>
																	editSetting(
																		p.pluginId,
																		key,
																		e.currentTarget.value
																			.split(",")
																			.map((s) => s.trim())
																			.filter(Boolean)
																	)}
															/>
														{:else if decl.type === "text"}
															<textarea
																class="textarea text-sm"
																rows="3"
																value={String(settingValue(p.pluginId, key) ?? "")}
																oninput={(e) =>
																	editSetting(p.pluginId, key, e.currentTarget.value)}
															></textarea>
														{:else}
															<input
																type="text"
																class="input input-sm"
																value={String(settingValue(p.pluginId, key) ?? "")}
																oninput={(e) =>
																	editSetting(p.pluginId, key, e.currentTarget.value)}
															/>
														{/if}
													</label>
												{/each}
												{#if view.orphaned.length}
													<p class="text-surface-600-400 text-xs">
														Kept from an earlier version (no longer declared):
														{view.orphaned.join(", ")}
													</p>
												{/if}
												{#if settingsError[p.pluginId]}
													<p class="text-error-600 text-xs">
														{settingsError[p.pluginId]}
													</p>
												{/if}
												<div>
													<button
														class="btn btn-sm variant-soft"
														disabled={!Object.keys(settingsDraft[p.pluginId] ?? {}).length}
														onclick={() => saveSettings(p.pluginId)}
													>
														Save settings
													</button>
												</div>
											{/if}
										</div>
									</td>
								</tr>
							{/if}
							{#if openPerms === p.pluginId}
								<tr>
									<td colspan="5">
										<div class="space-y-1 p-2">
											{#if storageByPlugin[p.pluginId]}
												{@const sq = storageByPlugin[p.pluginId]!}
												<div class="text-sm font-medium">Storage quota</div>
												<div class="flex flex-wrap items-center gap-2 text-sm">
													<span class="text-surface-600-400 text-xs">
														Enforced: <strong>{fmtBytes(sq.effectiveBytes)}</strong>
														· declared {fmtBytes(sq.declaredBytes)}
														{#if sq.overrideBytes != null}
															· override {fmtBytes(sq.overrideBytes)}
														{/if}
													</span>
													<input
														type="number"
														min="0"
														step="1"
														placeholder="MB"
														disabled={!sq.granted}
														class="input input-sm w-24"
														bind:value={quotaDraft[p.pluginId]}
														onkeydown={(e) => {
															if (e.key === "Enter")
																setStorageQuota(
																	p.pluginId,
																	quotaDraft[p.pluginId] ?? null
																)
														}}
													/>
													<button
														class="btn btn-sm variant-soft"
														disabled={!sq.granted}
														onclick={() =>
															setStorageQuota(
																p.pluginId,
																quotaDraft[p.pluginId] ?? null
															)}
													>
														Set override
													</button>
													<button
														class="btn btn-sm variant-soft"
														disabled={sq.overrideBytes == null}
														onclick={() => setStorageQuota(p.pluginId, null)}
													>
														Clear
													</button>
													{#if !sq.granted}
														<span class="text-warning-600 text-xs">
															(storage denied — grant it to set a quota)
														</span>
													{/if}
												</div>
												<div class="text-surface-600-400 text-xs">
													Override band {fmtBytes(sq.minBytes)}–{fmtBytes(sq.maxBytes)}.
												</div>
											{/if}
											<div class="text-sm font-medium">Permissions (admin deny)</div>
											{#if (permsByPlugin[p.pluginId] ?? []).length === 0}
												<p class="text-surface-600-400 text-xs">
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
			<p class="text-surface-600-400 text-sm">Nothing running.</p>
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
			<p class="text-surface-600-400 text-sm">No invocations logged yet.</p>
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
