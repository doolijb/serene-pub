<script lang="ts">
	/**
	 * Admin › Plugins › one extension: the change form (note 37, Django
	 * admin). Fieldsets:
	 *
	 * - **Plugin** — id, version, swaps (readonly); Enabled, Backend
	 *   (security / speed) and Sequential — the draft, saved by the save row.
	 * - **Settings** (12 §6) — the manifest's schema; only touched fields are
	 *   sent, and a secret is never readable (an emptied secret field is "not
	 *   replacing it"). Saved by the same save row.
	 * - **Permissions** and **Storage quota** — consent acts, and since the
 *   owner's ruling of 2026-10-02 ("levers wait for Save") part of the same
 *   form: ticks, the approval and the override are unsaved edits until
 *   Save, which sends each as its own write and waits for every answer.
 *
 * Delete is **Uninstall**, through the confirmation page. Unload (header)
	 * drops the loaded copy; the plugin reloads on the next hook call.
	 */
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		adminGoto as goto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { sameFormValue } from "$lib/client/forms/sameFormValue"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import {
		saveErrors,
		saveInSequence,
		saveSummary,
		type SaveStep
	} from "$lib/client/admin/sequentialSave"
	import PluginSettingsFields from "$lib/client/components/settingsTabs/PluginSettingsFields.svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import { backendWord, pluginStatus, pluginUninstall } from "./pluginsAdmin"

	type Row = Sockets.Plugins.PluginRow
	type Draft = { enabled: boolean; backend: "quickjs" | "ses"; sequential: boolean }
	/**
	 * The consent half of the form: each declared permission's tick, the
	 * approval of what is still waiting, and the storage override in MB.
	 */
	type Consent = { perms: Record<string, boolean>; approve: boolean; quotaMb: number | null }

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	const interest = getAdminInterestContext()
	const pluginId = $derived(adminPage.params.id ?? "")

	let plugins = $state<Row[]>([])
	let sandboxEnabled = $state(false)
	let loading = $state(true)
	const row = $derived(plugins.find((p) => p.pluginId === pluginId))

	let perms = $state<Sockets.Plugins.PermState[]>([])
	let storage = $state<Sockets.Plugins.StorageQuota | undefined>(undefined)
	let settings = $state<Sockets.Plugins.SettingsView | null>(null)
	/** Unsaved settings edits — only touched fields are ever sent. */
	let settingsDraft = $state<Record<string, unknown>>({})
	let settingsError = $state<string | null>(null)

	// ── the draft ───────────────────────────────────────────────────────
	const toDraft = (p: Row): Draft => ({ enabled: p.enabled, backend: p.backend, sequential: p.sequential })
	let draft = $state<Draft | undefined>(undefined)
	const edits = new UnsavedEdits(() => draft)
	$effect(() => {
		if (!row) return
		const next = toDraft(row)
		untrack(() => {
			if (draft === undefined) {
				draft = next
				edits.markSaved()
			} else edits.adoptSaved(next, (d) => (draft = d))
		})
	})
	const settingsDirty = $derived(Object.keys(settingsDraft).length > 0)

	const mbOf = (bytes: number | null | undefined) =>
		bytes == null ? null : Math.round((bytes / (1024 * 1024)) * 10) / 10
	const consentOf = (
		list: Sockets.Plugins.PermState[],
		sq: Sockets.Plugins.StorageQuota | undefined
	): Consent => ({
		perms: Object.fromEntries(list.map((x) => [x.key, x.granted || x.pending])),
		approve: false,
		quotaMb: mbOf(sq?.overrideBytes)
	})
	let consent = $state<Consent>({ perms: {}, approve: false, quotaMb: null })
	const consentEdits = new UnsavedEdits(() => consent)
	/** Each push of the permissions moves the saved snapshot; a clean form follows it. */
	function adoptConsent(list: Sockets.Plugins.PermState[], sq: Sockets.Plugins.StorageQuota | undefined) {
		const next = consentOf(list, sq)
		untrack(() => consentEdits.adoptSaved(next, (c) => (consent = structuredClone(c))))
	}

	const dirty = $derived(edits.dirty || settingsDirty || consentEdits.dirty)
	adminUnsavedEdits(() => dirty)

	// ── reads ───────────────────────────────────────────────────────────
	let pollTimer: ReturnType<typeof setInterval> | null = null
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.requestWithInterest("plugins:list", {}, (res) => {
				plugins = res.plugins
				sandboxEnabled = res.sandboxEnabled
				loading = false
			}),
			interest.declareInterest<"plugins:setSettings:error">("plugins:setSettings:error", (res) => {
				if (res.pluginId !== pluginId || !res.error) return
				// During a save the refusal is also that step's answer.
				settingsError = res.error
			}),
			interest.declareInterest<"plugins:uninstall">("plugins:uninstall", () => {
				if (!uninstalling) return
				uninstalling = false
				edits.forget()
				settingsDraft = {}
				toaster.success({ title: "Plugin uninstalled" })
				void goto("/admin/plugins", { replaceState: true })
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})
	/** Permissions and storage, SCOPED to this plugin (`plugins:permissions#<id>`). */
	$effect(() => {
		if (!userCtx.user?.isAdmin || !pluginId) return
		const release = interest.declareInterest<"plugins:permissions">(
			interestKey("plugins:permissions", pluginId),
			(res) => {
				perms = res.permissions
				storage = res.storage
				adoptConsent(res.permissions, res.storage)
			}
		)
		socket.emit("plugins:permissions", { pluginId })
		return release
	})
	/**
	 * The settings view, SCOPED the same way. A settings save answers ONLY
	 * through the cascaded `plugins:getSettings`, so it is also how a save
	 * from this page lands.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin || !pluginId || !row?.hasSettings) return
		const release = interest.declareInterest<"plugins:getSettings">(
			interestKey("plugins:getSettings", pluginId),
			handleSettings
		)
		socket.emit("plugins:getSettings", { pluginId })
		return release
	})
	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		// Not while saving: a save waits for the list to show each switch.
		pollTimer = setInterval(() => {
			if (!saving) socket.emit("plugins:list", {})
		}, 2000)
	})
	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer)
	})

	/** A secret's stored value comes masked: `{ $secretSet: true }`. */
	const isSecretMask = (v: unknown) => !!v && typeof v === "object" && "$secretSet" in (v as object)

	function handleSettings(res: Sockets.Plugins.GetSettings.Response) {
		settings = res.settings
		settingsError = null
		// A fresh view drops every edit it now agrees with (the echo of the
		// save that just landed) and every secret (masked, so it can never
		// agree); an edit it does not agree with is still unsaved and stays.
		const kept: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(settingsDraft)) {
			const saved = res.settings?.values?.[key]
			if (isSecretMask(saved) || sameFormValue(value, saved)) continue
			kept[key] = value
		}
		settingsDraft = kept
	}
	function editSetting(key: string, value: unknown) {
		const saved = settings?.values?.[key]
		const unchanged = isSecretMask(saved) ? value === "" : sameFormValue(value, saved)
		const next = { ...settingsDraft }
		if (unchanged) delete next[key]
		else next[key] = value
		settingsDraft = next
	}

	// ── save ────────────────────────────────────────────────────────────
	// The server takes each setting on its own verb, so Save sends the
	// difference one write at a time and waits for every answer before it
	// says "saved" (`saveInSequence`). The switches answer only through the
	// pushed list, so each waits for the list to show its new value; the
	// consent writes answer on this plugin's scoped permissions reply.
	let saving = $state(false)
	let formErrors = $state<string[]>([])

	/** The pushed list (or a switch's own reply) shows this plugin as wanted. */
	const listShows = (pred: (p: Row) => boolean) => (res: { plugins: Row[] }) => {
		const p = res.plugins?.find((x) => x.pluginId === pluginId)
		return !!p && pred(p)
	}
	const permissionsKey = () => interestKey("plugins:permissions", pluginId)
	const forThisPlugin = (e: unknown) => (e as { pluginId?: string })?.pluginId === pluginId

	async function save(intent: AdminSaveIntent) {
		if (!row || !draft || saving) return
		settingsError = null
		formErrors = []
		if (!dirty) return land(intent)
		const snap = $state.snapshot(draft) as Draft
		const want = $state.snapshot(consent) as Consent
		const savedConsent = consentOf(perms, storage)
		const name = row.name
		const steps: SaveStep[] = []

		// The three switches answer only through the pushed list.
		if (snap.backend !== row.backend)
			steps.push({
				label: "Backend",
				run: () =>
					awaitReply({
						socket,
						event: "plugins:setBackend",
						replyKey: "plugins:list",
						errorEvent: "plugins:setBackend:error",
						params: { pluginId, backend: snap.backend },
						match: listShows((p) => p.backend === snap.backend)
					})
			})
		if (snap.sequential !== row.sequential)
			steps.push({
				label: "Sequential",
				run: () =>
					awaitReply({
						socket,
						event: "plugins:setSequential",
						replyKey: "plugins:list",
						errorEvent: "plugins:setSequential:error",
						params: { pluginId, sequential: snap.sequential },
						match: listShows((p) => p.sequential === snap.sequential)
					})
			})
		if (snap.enabled !== row.enabled)
			steps.push({
				label: snap.enabled ? "Enable" : "Disable",
				run: () =>
					awaitReply({
						socket,
						event: "plugins:setEnabled",
						replyKey: "plugins:list",
						errorEvent: "plugins:setEnabled:error",
						params: { pluginId, enabled: snap.enabled },
						match: listShows((p) => p.enabled === snap.enabled)
					})
			})

		// A settings save answers only through this plugin's settings view.
		if (settingsDirty) {
			const values = $state.snapshot(settingsDraft)
			steps.push({
				label: "Settings",
				// The page's own settings listener takes the view it brings.
				run: () =>
					awaitReply({
						socket,
						event: "plugins:setSettings",
						replyKey: interestKey("plugins:getSettings", pluginId),
						errorEvent: "plugins:setSettings:error",
						params: { pluginId, values },
						match: forThisPlugin,
						matchError: forThisPlugin
					})
			})
		}

		// The consent writes answer on this plugin's scoped permissions reply.
		for (const perm of perms) {
			const tick = want.perms[perm.key]
			if (tick === undefined || tick === savedConsent.perms[perm.key]) continue
			steps.push({
				label: `${tick ? "Allow" : "Refuse"}: ${perm.label}`,
				run: () =>
					awaitReply({
						socket,
						event: "plugins:setPermission",
						replyKey: permissionsKey(),
						errorEvent: "plugins:setPermission:error",
						params: { pluginId, key: perm.key, granted: tick },
						match: (r) =>
							r.pluginId === pluginId &&
							r.permissions.find((x) => x.key === perm.key)?.granted === tick
					})
			})
		}
		if (want.approve)
			steps.push({
				label: "Approve the ticked permissions",
				run: () =>
					awaitReply({
						socket,
						event: "plugins:reviewPermissions",
						replyKey: permissionsKey(),
						errorEvent: "plugins:reviewPermissions:error",
						params: { pluginId },
						match: (r) => r.pluginId === pluginId && !r.permissions.some((x) => x.pending)
					})
			})
		if (storage && !sameFormValue(want.quotaMb, savedConsent.quotaMb)) {
			const mb = want.quotaMb
			const bytes = mb == null || !Number.isFinite(mb) || mb <= 0 ? null : Math.round(mb * 1024 * 1024)
			steps.push({
				label: "Storage quota",
				run: () =>
					awaitReply({
						socket,
						event: "plugins:setStorageQuota",
						replyKey: permissionsKey(),
						errorEvent: "plugins:setStorageQuota:error",
						params: { pluginId, bytes },
						match: (r) => r.pluginId === pluginId
					})
			})
		}

		saving = true
		const outcome = await saveInSequence(steps)
		saving = false
		// Every switch above answered through these two reads; ask once more
		// so the saved snapshot is what the server now holds.
		socket.emit("plugins:list", {})
		socket.emit("plugins:permissions", { pluginId })
		if (outcome.refused.length || outcome.skipped.length) {
			formErrors = saveErrors(outcome)
			toaster.warning({ title: saveSummary(outcome, name) })
			return
		}
		toaster.success({ title: saveSummary(outcome, name) })
		land(intent)
	}
	function land(intent: AdminSaveIntent) {
		if (intent === "save") void goto("/admin/plugins")
	}

	// ── acts that are not edits ─────────────────────────────────────────
	let uninstalling = false
	function uninstall() {
		uninstalling = true
		socket.emit("plugins:uninstall", { pluginId })
	}
	function fmtBytes(n: number | null | undefined): string {
		if (n == null) return "—"
		if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`
		return `${Math.round(n / 1024)} KB`
	}
	const pending = $derived(perms.filter((x) => x.pending))
</script>

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading plugin…
	</div>
{:else if !row || !draft}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">No plugin {pluginId} is installed.</p>
		<a href="/admin/plugins" class="btn btn-sm preset-tonal-surface">All plugins</a>
	</div>
{:else}
	{@const status = pluginStatus(row, sandboxEnabled)}
	<AdminChangeForm
		mode="change"
		title={row.name}
		noun="plugin"
		changelistHref="/admin/plugins"
		changelistLabel="Plugins"
		{dirty}
		{saving}
		addAnother={false}
		errors={[...formErrors, ...(settingsError && !formErrors.length ? [settingsError] : [])]}
		deletion={() => pluginUninstall([row!])}
		onDelete={uninstall}
		onSave={save}
	>
		{#snippet headerActions()}
			{#if sandboxEnabled && row!.warm}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					title="Drop the loaded copy and free its sandbox — it reloads on the next hook call"
					onclick={() => socket.emit("plugins:unload", { pluginId })}
				>
					<Icons.CircleStop size={16} aria-hidden="true" /> Unload
				</button>
			{/if}
		{/snippet}
		{#snippet headerExtra()}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5" title={status.title}>
					{status.label}
				</span>
				{#if row!.needsReview}
					<a class="preset-tonal-warning rounded-full px-2 py-0.5" href="#plugin-permissions">
						Permissions need review
					</a>
				{/if}
			</div>
		{/snippet}

		<AdminFieldset title="Plugin">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				<AdminField id="plugin-admin-id" label="Id" value={`${row.pluginId} · v${row.version}`} />
				<AdminField
					id="plugin-admin-backend"
					label="Backend (security / speed)"
					help={row.backends.length < 2 ? "This build offers one backend." : undefined}
				>
					<Select
						label="Backend (security / speed)"
						labelHidden
						options={row.backends.map((b) => ({
							value: b,
							label: b === "quickjs" ? "WASM — max isolation (slower)" : "SES — faster (weaker isolation)"
						}))}
						value={draft.backend}
						disabled={row.backends.length < 2}
						onValueChange={(v) => {
							if (v && draft) draft.backend = v === "ses" ? "ses" : "quickjs"
						}}
						describedBy={describedBy("plugin-admin-backend", false)}
					/>
				</AdminField>
			</div>
			<div class="flex flex-wrap gap-4">
				<label class="flex min-h-10 items-center gap-2 text-sm">
					<input type="checkbox" class="checkbox" bind:checked={draft.enabled} />
					Enabled
				</label>
				<label class="flex min-h-10 items-center gap-2 text-sm" title="One hook call at a time">
					<input type="checkbox" class="checkbox" bind:checked={draft.sequential} />
					Sequential (one hook call at a time)
				</label>
			</div>
			{#each row.componentRefusals ?? [] as r (r.slug)}
				<p class="text-error-700-300 text-xs">
					Component “{r.slug}” isn't offered — it was {r.reason}. Install a newer build of this extension.
				</p>
			{/each}
			{#if row.swaps}
				<p class="text-surface-600-400 text-xs">
					{row.swaps.total}
					{row.swaps.total === 1 ? "swap contribution" : "swap contributions"}{row.swaps.off
						? `, ${row.swaps.off} switched off`
						: ""}
					{#if row.swaps.genreId}
						·
						<a class="anchor" href="/admin/session-genres/{encodeURIComponent(row.swaps.genreId)}#swaps">
							manage on the genre page
						</a>
					{/if}
				</p>
			{/if}
		</AdminFieldset>

		{#if row.hasSettings}
			<AdminFieldset title="Settings" description="Saved with the save row. Only fields you change are sent.">
				{#if !settings}
					<p class="text-surface-600-400 text-xs">Loading…</p>
				{:else}
					{#if settings.state.state === "needs-configuration"}
						<p class="text-warning-700-300 text-xs">
							Waiting on {settings.state.missing.join(", ")} — the extension is installed and listed, not broken.
						</p>
					{/if}
					<PluginSettingsFields
						schema={settings.schema}
						values={settings.values}
						draft={settingsDraft}
						idPrefix={`plugin-setting-${pluginId}`}
						onEdit={editSetting}
						note={(_key, decl) =>
							decl?.scope === "user"
								? "The value for everyone. Each person can change it for themselves under Settings."
								: null}
					/>
					{#if settings.orphaned.length}
						<p class="text-surface-600-400 text-xs">
							Kept from an earlier version (no longer declared): {settings.orphaned.join(", ")}
						</p>
					{/if}
				{/if}
			</AdminFieldset>
		{/if}

		<AdminFieldset
			id="plugin-permissions"
			title="Permissions"
			description="Saved with the save row. A requested permission is refused until approved."
		>
			{#if perms.length === 0}
				<p class="text-surface-600-400 text-sm">This extension declares no permissions.</p>
			{:else}
				{#if pending.length}
					<p class="text-warning-700-300 text-xs">
						{pending.length} of {perms.length}
						{pending.length === 1 ? "permission is" : "permissions are"} waiting on you and refused meanwhile —
						the extension loads and runs, but reaches nothing it asked for. Untick anything you do not want,
						then approve and save.
					</p>
				{/if}
				<ul class="flex flex-col gap-1">
					{#each perms as perm (perm.key)}
						<li>
							<label class="flex min-h-9 flex-wrap items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="checkbox"
									bind:checked={consent.perms[perm.key]}
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
									<span class="text-warning-700-300 text-xs">(affects user accounts)</span>
								{/if}
							</label>
						</li>
					{/each}
				</ul>
				{#if pending.length}
					<!-- The consent act, held like every other edit until Save
					     (tonal: the save row owns the one filled primary). -->
					<div class="flex flex-wrap items-center gap-2">
						{#if consent.approve}
							<span class="preset-tonal-primary rounded-full px-2 py-0.5 text-xs">
								Approval ready — saved with the save row
							</span>
							<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (consent.approve = false)}>
								Undo
							</button>
						{:else}
							<button type="button" class="btn btn-sm preset-tonal-primary" onclick={() => (consent.approve = true)}>
								<Icons.ShieldCheck size={14} aria-hidden="true" />
								Approve the ticked permissions
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</AdminFieldset>

		{#if storage}
			{@const sq = storage}
			<AdminFieldset
				title="Storage quota"
				description="Saved with the save row. Override band {fmtBytes(sq.minBytes)}–{fmtBytes(sq.maxBytes)}; empty means the declared quota."
			>
				<p class="text-surface-600-400 text-xs">
					Enforced: <strong>{fmtBytes(sq.effectiveBytes)}</strong> · declared {fmtBytes(sq.declaredBytes)}
					{#if sq.overrideBytes != null}· override {fmtBytes(sq.overrideBytes)}{/if}
				</p>
				<div class="flex flex-wrap items-center gap-2 text-sm">
					<input
						type="number"
						min="0"
						step="any"
						placeholder="MB"
						aria-label="Storage override in MB"
						disabled={!sq.granted}
						class="input w-28"
						bind:value={consent.quotaMb}
					/>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						disabled={consent.quotaMb == null}
						onclick={() => (consent.quotaMb = null)}
					>
						Clear
					</button>
					{#if !sq.granted}
						<span class="text-warning-700-300 text-xs">
							{perms.some((x) => x.key === "storage" && x.pending)
								? "(storage not reviewed yet — approve it above to set a quota)"
								: "(storage denied — grant it to set a quota)"}
						</span>
					{/if}
				</div>
			</AdminFieldset>
		{/if}
	</AdminChangeForm>
{/if}
