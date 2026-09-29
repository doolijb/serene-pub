<script lang="ts">
	import { docsHref } from "$lib/shared/utils/docsHref"
	/**
	 * Plugins — the admin surface for the plugin subsystem.
	 *
	 * Re-homed under the administration shell as designed (formerly
	 * `/pipelines/extensions`, which now redirects here). Admin
	 * only, checked here and again in every handler. Shows the installed set with
	 * the security/speed dial, the live sandbox monitor with a manual kill, and
	 * the hook-invocation log. An inert sandbox is surfaced, not hidden — with the
	 * flag off (the 0.6.0 release default) plugins are managed here but do not run.
	 */
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { getContext, onDestroy, onMount } from "svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { sameFormValue } from "$lib/client/forms/sameFormValue"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { hookOutcome, HOOK_OUTCOME_CLASS } from "./hookOutcome"
	import PluginSettingsFields from "$lib/client/components/settingsTabs/PluginSettingsFields.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `plugins:` is a
	// RESTRICTED interest family, and this context exists only inside the
	// admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()

	let plugins: Sockets.Plugins.PluginRow[] = $state([])
	let logs: Sockets.Plugins.LogRow[] = $state([])
	let active: Sockets.Plugins.ActiveRow[] = $state([])
	let sandboxEnabled = $state(false)
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

	// Named because the interest registry releases by handler reference — and
	// because it is the ONE listener path now, the leak these handlers were
	// named for (no teardown at all, a fresh set of listeners on every visit)
	// is gone with it.
	function handlePluginsList(res: Sockets.Plugins.List.Response) {
		plugins = res.plugins
		sandboxEnabled = res.sandboxEnabled
		loading = false
	}
	function handlePluginsLogs(res: Sockets.Plugins.Logs.Response) {
		logs = res.logs
	}
	function handlePluginsActive(res: Sockets.Plugins.Active.Response) {
		active = res.active
	}
	function handlePluginsPermissions(
		res: Sockets.Plugins.Permissions.Response
	) {
		permsByPlugin[res.pluginId] = res.permissions
		storageByPlugin[res.pluginId] = res.storage
	}
	function handlePluginsGetSettings(
		res: Sockets.Plugins.GetSettings.Response
	) {
		settingsByPlugin[res.pluginId] = res.settings
		settingsError[res.pluginId] = null
		// A fresh view drops every edit it now agrees with (the echo of the
		// save that just landed) and every secret (masked, so it can never
		// agree); an edit it does not agree with is still unsaved and stays.
		const draft = settingsDraft[res.pluginId]
		if (!draft) return
		const kept: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(draft)) {
			const saved = res.settings?.values?.[key]
			if (isSecretMask(saved) || sameFormValue(value, saved)) continue
			kept[key] = value
		}
		if (Object.keys(kept).length) settingsDraft[res.pluginId] = kept
		else delete settingsDraft[res.pluginId]
	}
	function handlePluginsSetSettingsError(
		res: Sockets.Plugins.SetSettings.Response
	) {
		if (res.error) settingsError[res.pluginId] = res.error
	}

	/**
	 * The three page-wide reads, each asked for and listened for in one, plus
	 * the refusal a settings save can come back with. All BARE — an installed
	 * set is the instance's — and all STANDING: `plugins:list` and
	 * `plugins:active` are re-asked by the poll below and re-emitted by the
	 * server after every write on this page, and `plugins:setSettings:error`
	 * answers a Save nothing here asked about.
	 *
	 * Declared here rather than in `onMount` so each key leaves ahead of its
	 * own request, and so the poll below only ever emits against keys that are
	 * already held.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"plugins:setSettings:error">(
				"plugins:setSettings:error",
				handlePluginsSetSettingsError
			),
			interest.requestWithInterest("plugins:list", {}, handlePluginsList),
			interest.requestWithInterest(
				"plugins:logs",
				{ limit: 100 },
				handlePluginsLogs
			),
			interest.requestWithInterest(
				"plugins:active",
				{},
				handlePluginsActive
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/**
	 * The open permissions panel's answer, SCOPED to the plugin it is about —
	 * `plugins:permissions#<pluginId>` — so a reply for another plugin does
	 * not land in a panel that is not open.
	 *
	 * An effect rather than `useInterest` because the key MOVES: `useInterest`
	 * reads its key once, and the selected plugin changes every time a panel
	 * is opened. The request goes out here too, after the declare, so the key
	 * is always the older of the two.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const pluginId = openPerms
		if (!pluginId) return
		const release = interest.declareInterest<"plugins:permissions">(
			interestKey("plugins:permissions", pluginId),
			handlePluginsPermissions
		)
		socket.emit("plugins:permissions", { pluginId })
		return release
	})

	/**
	 * The open settings panel's view, SCOPED the same way — and the same
	 * effect form for the same reason. A settings save answers ONLY through
	 * the cascaded `plugins:getSettings`, so the panel that can write holds
	 * this key for as long as it is open.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const pluginId = openSettings
		if (!pluginId) return
		const release = interest.declareInterest<"plugins:getSettings">(
			interestKey("plugins:getSettings", pluginId),
			handlePluginsGetSettings
		)
		socket.emit("plugins:getSettings", { pluginId })
		return release
	})

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		// The list rides the same poll as the monitor: `warm` is live truth
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
	function setBackend(
		p: Sockets.Plugins.PluginRow,
		backend: "quickjs" | "ses"
	) {
		socket.emit("plugins:setBackend", { pluginId: p.pluginId, backend })
	}
	function setSequential(p: Sockets.Plugins.PluginRow, sequential: boolean) {
		socket.emit("plugins:setSequential", {
			pluginId: p.pluginId,
			sequential
		})
	}
	function uninstall(p: Sockets.Plugins.PluginRow) {
		if (
			confirm(
				`Uninstall "${p.name}"? Its stored data is removed; its log history is kept.`
			)
		)
			socket.emit("plugins:uninstall", { pluginId: p.pluginId })
	}
	/** Drop the loaded copy; the plugin stays installed and reloads on the next call. */
	function unload(p: Sockets.Plugins.PluginRow) {
		socket.emit("plugins:unload", { pluginId: p.pluginId })
	}
	/**
	 * Ask the hook to stop itself: its `ctx.signal` fires and it winds down in
	 * its own frame — the transaction it opened, the files it made — and
	 * returns. Only a hook that is awaiting something can hear it, so a call
	 * that stays in the list below did not, and Kill is what is left.
	 */
	function abort(callId: number) {
		socket.emit("plugins:abort", { callId })
	}
	function kill(callId: number) {
		socket.emit("plugins:kill", { callId })
	}
	// Neither toggler emits: the scoped effects above send the request for
	// whichever plugin is open, so the key naming it is always declared first.
	function togglePerms(pluginId: string) {
		openPerms = openPerms === pluginId ? null : pluginId
	}
	/** Open (never close) the permissions panel — what the waiting badge does. */
	function openPermsFor(pluginId: string) {
		openPerms = pluginId
	}
	function toggleSettings(pluginId: string) {
		openSettings = openSettings === pluginId ? null : pluginId
	}
	/** A secret's stored value comes masked: `{ $secretSet: true }`. */
	const isSecretMask = (v: unknown) =>
		!!v && typeof v === "object" && "$secretSet" in (v as object)

	/**
	 * A field put back to its stored value leaves the draft, so the draft
	 * only ever holds real edits: it is what Save sends, what enables Save,
	 * and what the Admin view asks about before this section is left. A
	 * secret is never readable, so an emptied secret field is "not
	 * replacing it" and only Clear (`null`) or a typed value is an edit.
	 */
	function editSetting(pluginId: string, key: string, value: unknown) {
		const saved = settingsByPlugin[pluginId]?.values?.[key]
		const unchanged = isSecretMask(saved)
			? value === ""
			: sameFormValue(value, saved)
		const next = { ...(settingsDraft[pluginId] ?? {}) }
		if (unchanged) delete next[key]
		else next[key] = value
		if (Object.keys(next).length) settingsDraft[pluginId] = next
		else delete settingsDraft[pluginId]
	}
	adminUnsavedEdits(() =>
		Object.values(settingsDraft).some((d) => Object.keys(d).length > 0)
	)
	function saveSettings(pluginId: string) {
		const draft = settingsDraft[pluginId]
		if (!draft || !Object.keys(draft).length) return
		socket.emit("plugins:setSettings", { pluginId, values: draft })
	}
	function setPerm(pluginId: string, key: string, granted: boolean) {
		socket.emit("plugins:setPermission", { pluginId, key, granted })
	}
	/**
	 * The consent act. Until it runs, every permission this extension asked for
	 * is refused — it loads and runs, but reaches no storage, no network, no
	 * account resources and no events. Untick anything first: this puts into
	 * force exactly what is still ticked.
	 */
	function reviewPerms(pluginId: string) {
		socket.emit("plugins:reviewPermissions", { pluginId })
	}
	function fmtBytes(n: number | null | undefined): string {
		if (n == null) return "—"
		if (n >= 1024 * 1024)
			return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`
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

<div class="mx-auto flex w-full max-w-[1120px] flex-col gap-4">
	<AdminPageHeader
		title="Plugins"
		doc={docsHref("environment-variables", "feature-toggles")}
		purpose="Installed extensions: what each may do, its storage, the running sandbox and the log of hook calls."
	>
		{#if !loading && !sandboxEnabled}
			<!-- The one status line (STYLE-GUIDE §6.11): a dot plus words, and a
			     link to the fix. Installing and configuring still work. -->
			<p
				data-field="plugin-sandbox"
				class="text-surface-700-300 flex items-start gap-2 text-sm"
				role="status"
			>
				<span
					class="bg-surface-500 mt-1.5 size-2 shrink-0 rounded-full"
					aria-hidden="true"
				></span>
				<span>
					The plugin sandbox is off, so hooks do not run. You can still
					install and configure plugins.
					<a class="anchor" href="/docs/environment-variables#feature-toggles"
						>How to turn it on</a
					>
				</span>
			</p>
		{/if}
	</AdminPageHeader>

	<!-- Installed plugins: one well per extension, so a row reads the same in
	     the 400px dock and in Focus (no table to scroll sideways). -->
	<section class="panel-card flex flex-col gap-3">
		<h2 id="installed-plugins" class="text-sm font-medium">Installed</h2>
		{#if loading}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{:else if plugins.length === 0}
			<p class="text-surface-600-400 text-sm">No extensions installed.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each plugins as p (p.pluginId)}
					<li class="bg-surface-50-950 flex flex-col gap-3 rounded-[10px] p-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2 font-medium">
								{p.name}
								{#if p.needsReview}
									<button
										class="badge preset-tonal-warning text-xs"
										title="This extension has asked for permissions nobody has reviewed. They are refused until you do — open Permissions to decide."
										onclick={() => openPermsFor(p.pluginId)}
									>
										Needs review
									</button>
								{/if}
							</div>
							{#each p.componentRefusals ?? [] as r (r.slug)}
								<div class="text-error-700-300 text-xs">
									Component “{r.slug}” isn't offered — it was {r.reason}. Install a newer build of this extension.
								</div>
							{/each}
							{#if p.swaps}
								<div class="text-surface-600-400 text-xs">
									{p.swaps.total}
									{p.swaps.total === 1 ? "swap contribution" : "swap contributions"}{p.swaps.off
										? `, ${p.swaps.off} switched off`
										: ""}
									{#if p.swaps.genreId}
										·
										<a
											class="anchor"
											href="/admin/session-genres/{encodeURIComponent(p.swaps.genreId)}#swaps"
										>
											manage on the genre page
										</a>
									{/if}
								</div>
							{/if}
							<div class="text-surface-600-400 text-xs break-all">
								{p.pluginId} · v{p.version}
								{#if sandboxEnabled && p.enabled}
									{#if p.warm}
										<span
											class="text-success-600-400"
											title="A copy is loaded in its sandbox right now"
										>
											· loaded
										</span>
									{:else}
										<span title="Nothing loaded — the first hook call loads it">
											· idle
										</span>
									{/if}
								{/if}
							</div>
						</div>

						<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
							<div class="flex min-w-0 max-w-full flex-col gap-1">
								<span class="text-surface-600-400 text-xs" aria-hidden="true">Backend (security / speed)</span>
								<Select
									class="max-w-full"
									label="Backend (security / speed)"
									labelHidden
									options={p.backends.map((b) => ({
										value: b,
										label:
											b === "quickjs"
												? "WASM — max isolation (slower)"
												: "SES — faster (weaker isolation)"
									}))}
									value={p.backend}
									disabled={p.backends.length < 2}
									onValueChange={(v) => {
										if (v) setBackend(p, v === "ses" ? "ses" : "quickjs")
									}}
								/>
							</div>
							<label class="flex items-center gap-2" title="Concurrency">
								<input
									type="checkbox"
									class="checkbox"
									checked={p.sequential}
									onchange={(e) => setSequential(p, e.currentTarget.checked)}
								/>
								Sequential
							</label>
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									class="checkbox"
									checked={p.enabled}
									onchange={(e) => setEnabled(p, e.currentTarget.checked)}
								/>
								Enabled
							</label>
						</div>

						<div class="flex flex-wrap items-center gap-2">
							{#if sandboxEnabled && p.warm}
								<button
									class="btn btn-sm preset-tonal-surface"
									title="Drop the loaded copy and free its sandbox — it reloads on the next hook call"
									onclick={() => unload(p)}
								>
									Unload
								</button>
							{/if}
							{#if p.hasSettings}
								<button
									class="btn btn-sm preset-tonal-surface"
									aria-expanded={openSettings === p.pluginId}
									onclick={() => toggleSettings(p.pluginId)}
								>
									Settings
								</button>
							{/if}
							<button
								class="btn btn-sm preset-tonal-surface"
								aria-expanded={openPerms === p.pluginId}
								onclick={() => togglePerms(p.pluginId)}
							>
								Permissions
							</button>
							<div class="flex-1"></div>
							<button
								class="btn btn-sm preset-tonal-error"
								onclick={() => uninstall(p)}
							>
								Uninstall
							</button>
						</div>

						{#if openSettings === p.pluginId}
							{@const view = settingsByPlugin[p.pluginId]}
							<div class="bg-surface-100-900 flex flex-col gap-3 rounded-[10px] p-3">
								<div class="text-sm font-medium">Settings</div>
								{#if !view}
									<p class="text-surface-600-400 text-xs">Loading…</p>
								{:else}
									{#if view.state.state === "needs-configuration"}
										<p class="text-warning-700-300 text-xs">
											Waiting on {view.state.missing.join(", ")} — the extension is installed
											and listed, not broken.
										</p>
									{/if}
									<PluginSettingsFields
										schema={view.schema}
										values={view.values}
										draft={settingsDraft[p.pluginId] ?? {}}
										idPrefix={`plugin-setting-${p.pluginId}`}
										onEdit={(key, value) => editSetting(p.pluginId, key, value)}
										note={(_key, decl) =>
											decl?.scope === "user"
												? "The value for everyone. Each person can change it for themselves under Settings."
												: null}
									/>
									{#if view.orphaned.length}
										<p class="text-surface-600-400 text-xs">
											Kept from an earlier version (no longer declared):
											{view.orphaned.join(", ")}
										</p>
									{/if}
									{#if settingsError[p.pluginId]}
										<p class="text-error-600-400 text-xs">
											{settingsError[p.pluginId]}
										</p>
									{/if}
									<div>
										<button
											class="btn btn-sm preset-filled-primary-500"
											disabled={!Object.keys(settingsDraft[p.pluginId] ?? {}).length}
											onclick={() => saveSettings(p.pluginId)}
										>
											Save settings
										</button>
									</div>
								{/if}
							</div>
						{/if}

						{#if openPerms === p.pluginId}
							<div class="bg-surface-100-900 flex flex-col gap-2 rounded-[10px] p-3">
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
											aria-label="Storage override in MB"
											disabled={!sq.granted}
											class="input input-sm w-24"
											bind:value={quotaDraft[p.pluginId]}
											onkeydown={(e) => {
												if (e.key === "Enter")
													setStorageQuota(p.pluginId, quotaDraft[p.pluginId] ?? null)
											}}
										/>
										<button
											class="btn btn-sm preset-tonal-surface"
											disabled={!sq.granted}
											onclick={() =>
												setStorageQuota(p.pluginId, quotaDraft[p.pluginId] ?? null)}
										>
											Set override
										</button>
										<button
											class="btn btn-sm preset-tonal-surface"
											disabled={sq.overrideBytes == null}
											onclick={() => setStorageQuota(p.pluginId, null)}
										>
											Clear
										</button>
										{#if !sq.granted}
											{@const notYet = (permsByPlugin[p.pluginId] ?? []).some(
												(x) => x.key === "storage" && x.pending
											)}
											<span class="text-warning-700-300 text-xs">
												{notYet
													? "(storage not reviewed yet — approve it below to set a quota)"
													: "(storage denied — grant it to set a quota)"}
											</span>
										{/if}
									</div>
									<div class="text-surface-600-400 text-xs">
										Override band {fmtBytes(sq.minBytes)}–{fmtBytes(sq.maxBytes)}.
									</div>
								{/if}
								<div class="text-sm font-medium">Permissions</div>
								{#if (permsByPlugin[p.pluginId] ?? []).length === 0}
									<p class="text-surface-600-400 text-xs">
										This extension declares no permissions.
									</p>
								{:else}
									{@const pending = (permsByPlugin[p.pluginId] ?? []).filter(
										(x) => x.pending
									)}
									{#if pending.length}
										<p class="text-warning-700-300 text-xs">
											{pending.length} of {(permsByPlugin[p.pluginId] ?? []).length}
											{pending.length === 1 ? "permission is" : "permissions are"}
											waiting on you and refused meanwhile — the extension loads and
											runs, but reaches nothing it asked for. Untick anything you do not
											want, then approve.
										</p>
									{/if}
									{#each permsByPlugin[p.pluginId] as perm (perm.key)}
										<label class="flex flex-wrap items-center gap-2 text-sm">
											<input
												type="checkbox"
												class="checkbox"
												checked={perm.granted || perm.pending}
												onchange={(e) =>
													setPerm(p.pluginId, perm.key, e.currentTarget.checked)}
											/>
											<span>{perm.label}</span>
											{#if perm.pending}
												<span
													class="text-warning-700-300 text-xs"
													title="Requested but not in force — it starts working when you approve"
												>
													(requested — not in force)
												</span>
											{/if}
											{#if perm.accountAffecting}
												<span class="text-warning-700-300 text-xs">
													(affects user accounts)
												</span>
											{/if}
										</label>
									{/each}
									{#if pending.length}
										<div>
											<button
												class="btn btn-sm preset-filled-primary-500"
												onclick={() => reviewPerms(p.pluginId)}
											>
												Approve the ticked permissions
											</button>
										</div>
									{/if}
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Live sandbox monitor -->
	<section class="panel-card flex flex-col gap-3">
		<h2 id="running-plugins" class="text-sm font-medium">Running now</h2>
		{#if active.length === 0}
			<p class="text-surface-600-400 text-sm">Nothing running.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each active as a (a.callId)}
					<li
						class="bg-surface-50-950 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] p-3"
					>
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">
								{a.pluginName} · {a.hookName}{a.lifecycle ? " (lifecycle)" : ""}
							</div>
							<div class="text-surface-600-400 text-xs">
								{a.backend} · {a.user ?? "—"} · {elapsed(a.startedAt)}
							</div>
						</div>
						<div class="flex flex-wrap gap-2">
							<button
								class="btn btn-sm preset-tonal-surface"
								title="Ask the hook to stop itself and wind down"
								onclick={() => abort(a.callId)}
							>
								Ask to stop
							</button>
							<button
								class="btn btn-sm preset-tonal-error"
								onclick={() => kill(a.callId)}
							>
								Kill
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Hook invocation log -->
	<section class="panel-card flex flex-col gap-3">
		<div class="flex items-center justify-between gap-2">
			<h2 id="hook-calls" class="text-sm font-medium">Recent hook calls</h2>
			<button
				class="btn btn-sm preset-tonal-surface"
				onclick={() => socket.emit("plugins:logs", { limit: 100 })}
			>
				Refresh
			</button>
		</div>
		{#if logs.length === 0}
			<p class="text-surface-600-400 text-sm">No invocations logged yet.</p>
		{:else}
			<ul class="flex flex-col gap-1">
				{#each logs as l (l.id)}
					{@const o = hookOutcome(l)}
					<li class="bg-surface-50-950 flex flex-col gap-0.5 rounded-[10px] px-3 py-2 text-sm">
						<div class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-medium">{l.pluginName}</span>
							<span class="text-surface-700-300">{l.hookName}</span>
							<span class="text-surface-600-400 ml-auto text-xs"
								>{l.backend} · {l.mode} · {l.durationMs} ms</span
							>
						</div>
						<div class="text-xs break-words {HOOK_OUTCOME_CLASS[o.tone]}">
							{o.text}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
