<script lang="ts">
	/**
	 * Admin › Users: the add and change form for one account (Django admin's
	 * user change form). Fieldsets:
	 *
	 * - **Account** — username, display name.
	 * - **Permissions** — Administrator. Only an account someone has signed
	 *   into can be promoted (27 §5): until then it is an unproven claim about
	 *   who holds it. The server refuses regardless; the field says why.
	 * - **Passphrase** — set one (required on add; blank keeps the current
	 *   one), with Generate and Copy.
	 * - **Two-factor** (change only) — clear a lost second factor.
	 *
	 * Saved with `users:create` / `users:update`, the same events and server
	 * rules as the Users panel's `UserForm`; Delete is `users:delete`, a
	 * deactivation (your own account has no Delete).
	 */
	import { getContext, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { adminGoto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		passphraseSchema,
		PASSPHRASE_RULE_HINT
	} from "$lib/shared/validation/passphrase"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import { randomPassphrase, roleWord, userDeletion } from "./usersAdmin"

	interface Props {
		/** Absent → the add form. */
		user?: SelectUser
	}
	let { user }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: UserCtx = getContext("userCtx")
	const isSelf = $derived(!!user && user.id === userCtx?.user?.id)
	const mode = $derived(user ? "change" : "add") as "add" | "change"

	type Draft = {
		username: string
		displayName: string
		isAdmin: boolean
		passphrase: string
		confirm: string
	}
	const toDraft = (u: SelectUser | undefined): Draft => ({
		username: u?.username ?? "",
		displayName: u?.displayName ?? "",
		isAdmin: u?.isAdmin ?? false,
		passphrase: "",
		confirm: ""
	})
	let draft = $state<Draft>(untrack(() => toDraft(user)))
	const edits = new UnsavedEdits(() => draft)
	edits.markSaved()
	adminUnsavedEdits(() => edits.dirty)
	// Another tab's save: a clean form follows the row, an edited one keeps its edits.
	$effect(() => {
		const next = toDraft(user)
		untrack(() => edits.adoptSaved(next, (d) => (draft = d)))
	})

	const canPromote = $derived(!!user?.lastLoginAt)
	let show = $state(false)

	// ── validation ──────────────────────────────────────────────────────
	let usernameError = $state<string | null>(null)
	let passphraseError = $state<string | null>(null)
	let formErrors = $state<string[]>([])
	function validate(): boolean {
		usernameError = draft.username.trim() ? null : "A user needs a username."
		passphraseError = null
		if (mode === "add" && !draft.passphrase)
			passphraseError = "A new account needs a passphrase."
		else if (draft.passphrase) {
			if (draft.passphrase !== draft.confirm) passphraseError = "The two passphrases differ."
			else {
				const r = passphraseSchema.safeParse(draft.passphrase)
				if (!r.success) passphraseError = r.error.errors[0]?.message ?? "That passphrase is too weak."
			}
		}
		return !usernameError && !passphraseError
	}

	// ── save ────────────────────────────────────────────────────────────
	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	function save(intent: AdminSaveIntent) {
		formErrors = []
		if (!validate()) return
		if (mode === "change" && !edits.dirty) return land(intent, user!.id)
		saving = true
		pendingIntent = intent
		const base = {
			username: draft.username.trim(),
			displayName: draft.displayName.trim() || undefined,
			isAdmin: draft.isAdmin
		}
		if (user)
			socket.emit("users:update", {
				id: user.id,
				...base,
				passphrase: draft.passphrase || undefined
			})
		else socket.emit("users:create", { ...base, passphrase: draft.passphrase })
	}
	function land(intent: AdminSaveIntent, id: number) {
		if (intent === "save") void adminGoto("/admin/users")
		else if (intent === "another") void adminGoto("/admin/users/new")
		else if (mode === "add") void adminGoto(`/admin/users/${id}`, { replaceState: true })
	}
	function saved(u: SelectUser) {
		const intent = pendingIntent
		if (!intent) return
		pendingIntent = null
		saving = false
		draft = toDraft(u)
		edits.markSaved()
		toaster.success({ title: `Saved ${u.username}` })
		socket.emit("users:list", {})
		land(intent, u.id)
	}
	function refused(res: { error?: string }) {
		if (!pendingIntent) return
		pendingIntent = null
		saving = false
		const error = res.error ?? "The account was not saved."
		if (/username/i.test(error)) usernameError = error
		else if (/passphrase/i.test(error)) passphraseError = error
		else formErrors = [error]
	}
	useInterest<"users:create">("users:create", (res) => {
		if (mode === "add") saved(res.user)
	})
	useInterest<"users:update">("users:update", (res) => {
		if (user && res.user.id === user.id) saved(res.user)
	})
	useInterest<"users:create:error">("users:create:error", refused)
	useInterest<"users:update:error">("users:update:error", refused)

	// ── delete ──────────────────────────────────────────────────────────
	let deleting = false
	function remove() {
		if (!user || isSelf) return
		deleting = true
		socket.emit("users:delete", { id: user.id })
	}
	useInterest<"users:delete">("users:delete", () => {
		if (!deleting) return
		deleting = false
		edits.forget()
		toaster.success({ title: "Account deleted" })
		socket.emit("users:list", {})
		void adminGoto("/admin/users", { replaceState: true })
	})
	useInterest<"users:delete:error">("users:delete:error", (res) => {
		if (!deleting) return
		deleting = false
		formErrors = [res.error ?? "The account was not deleted."]
	})

	// ── passphrase helpers ──────────────────────────────────────────────
	function generate() {
		const p = randomPassphrase()
		draft.passphrase = p
		draft.confirm = p
		show = true
		passphraseError = null
	}
	async function copy() {
		try {
			await navigator.clipboard.writeText(draft.passphrase)
			toaster.success({ title: "Passphrase copied" })
		} catch {
			toaster.error({ title: "Could not reach the clipboard. Select the text and copy it." })
		}
	}

	// ── two-factor ──────────────────────────────────────────────────────
	let clearingTotp = $state(false)
	function clearTotp() {
		if (!user) return
		if (
			!confirm(
				"Clear two-factor authentication for this user and sign out all of their sessions?"
			)
		)
			return
		clearingTotp = true
		socket.emit("totp:adminClear", { userId: user.id })
	}

	const title = $derived(
		mode === "add" ? "Add user" : draft.username.trim() || user?.username || "User"
	)
</script>

<AdminChangeForm
	{mode}
	{title}
	purpose={mode === "add"
		? "A new account starts as a member. Give the person the passphrase; they can change it after signing in."
		: undefined}
	noun="user"
	changelistHref="/admin/users"
	changelistLabel="Users"
	dirty={edits.dirty}
	{saving}
	errors={formErrors}
	fieldErrors={{ "user-admin-username": usernameError, "user-admin-passphrase": passphraseError }}
	deletion={user && !isSelf ? () => userDeletion([user!], userCtx?.user?.id) : undefined}
	onDelete={user && !isSelf ? remove : undefined}
	onSave={save}
>
	{#snippet headerExtra()}
		{#if user}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
					{roleWord(user)}
				</span>
				{#if isSelf}
					<span class="preset-tonal-primary rounded-full px-2 py-0.5">You</span>
				{/if}
				<span class="text-surface-600-400">
					{user.lastLoginAt
						? `Last signed in ${new Date(user.lastLoginAt).toLocaleString()}`
						: "Never signed in"}
				</span>
			</div>
		{/if}
	{/snippet}

	<AdminFieldset title="Account">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField
				id="user-admin-username"
				label="Username"
				required
				error={usernameError}
				help="What the person types to sign in. Unique on this pub."
			>
				<input
					id="user-admin-username"
					class="input"
					type="text"
					autocomplete="off"
					bind:value={draft.username}
					aria-invalid={!!usernameError}
					aria-describedby={describedBy("user-admin-username", !!usernameError)}
				/>
			</AdminField>
			<AdminField
				id="user-admin-display"
				label="Display name"
				help="Shown instead of the username where there is room. Optional."
			>
				<input
					id="user-admin-display"
					class="input"
					type="text"
					bind:value={draft.displayName}
					aria-describedby={describedBy("user-admin-display", false)}
				/>
			</AdminField>
		</div>
	</AdminFieldset>

	<AdminFieldset title="Permissions">
		<AdminField
			id="user-admin-admin"
			label="Role"
			help={!canPromote && !draft.isAdmin
				? mode === "add"
					? "New accounts start as members. Once this person has signed in for the first time, you can make them an administrator here."
					: "This account has never been signed into. It can be made an administrator once someone has signed in at least once."
				: draft.isAdmin && !user?.isAdmin
					? "Administrators can change everything on this pub, including other accounts. Saving makes it so."
					: "Administrators manage the pub: connections, pipelines, accounts."}
		>
			<label class="flex min-h-10 items-center gap-2 text-sm">
				<input
					id="user-admin-admin"
					type="checkbox"
					class="checkbox"
					bind:checked={draft.isAdmin}
					disabled={!canPromote && !draft.isAdmin}
					aria-describedby={describedBy("user-admin-admin", false)}
				/>
				Administrator
			</label>
		</AdminField>
	</AdminFieldset>

	<AdminFieldset
		title="Passphrase"
		description={mode === "add" ? undefined : "Leave both empty to keep the current passphrase."}
	>
		{#snippet aside()}
			<div class="flex shrink-0 gap-2">
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={generate}>
					<Icons.Dices size={14} aria-hidden="true" /> Generate
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={copy}
					disabled={!draft.passphrase}
				>
					<Icons.Copy size={14} aria-hidden="true" /> Copy
				</button>
			</div>
		{/snippet}
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField
				id="user-admin-passphrase"
				label={mode === "add" ? "Passphrase" : "New passphrase"}
				required={mode === "add"}
				error={passphraseError}
				help={PASSPHRASE_RULE_HINT}
			>
				<div class="relative">
					<input
						id="user-admin-passphrase"
						class="input w-full pr-10"
						type={show ? "text" : "password"}
						autocomplete="new-password"
						bind:value={draft.passphrase}
						aria-invalid={!!passphraseError}
						aria-describedby={describedBy("user-admin-passphrase", !!passphraseError)}
					/>
					<button
						type="button"
						class="text-surface-600-400 hover:text-surface-950-50 absolute top-1/2 right-2 -translate-y-1/2"
						aria-label={show ? "Hide passphrase" : "Show passphrase"}
						onclick={() => (show = !show)}
					>
						{#if show}<Icons.EyeOff size={18} />{:else}<Icons.Eye size={18} />{/if}
					</button>
				</div>
			</AdminField>
			<AdminField id="user-admin-confirm" label="Confirm passphrase">
				<input
					id="user-admin-confirm"
					class="input"
					type={show ? "text" : "password"}
					autocomplete="new-password"
					bind:value={draft.confirm}
				/>
			</AdminField>
		</div>
	</AdminFieldset>

	{#if user}
		<AdminFieldset
			title="Two-factor authentication"
			description="If this person has lost both their authenticator and their recovery codes, clearing their second factor lets them sign in with their passphrase alone. Every device they are signed in on is signed out at the same time."
		>
			<div>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					disabled={clearingTotp}
					onclick={clearTotp}
				>
					Clear two-factor for this user
				</button>
			</div>
		</AdminFieldset>
	{/if}
</AdminChangeForm>
