import crypto from "crypto"
import { and, asc, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { passphraseSchema } from "$lib/shared/validation/passphrase"
import { set as setPassphrase } from "$lib/server/providers/users/passphrase/set"
import { isAndroidWrapper } from "$lib/server/utils"

/**
 * Account recovery through the environment — plan 26 §10, tier 3.
 *
 * The case this exists for is the one nothing in-app can rescue: the sole
 * admin, locked out, with no second admin to ask. Filesystem (or compose-file)
 * access *is* the authentication here, exactly as it is for `ALLOWED_ORIGINS=*`
 * — anyone who can set these variables could already edit the database
 * directly, so refusing to build it wins nothing and strands real people.
 *
 * Environment rather than a CLI because the people who need it are
 * disproportionately running Docker, where editing a compose file is easy and
 * running a one-off command inside a container that may not stay up is not.
 */

export const ENV_ADMIN_USERNAME = "SERENE_PUB_ADMIN_USERNAME"
export const ENV_ADMIN_PASSWORD = "SERENE_PUB_ADMIN_PASSWORD"
export const ENV_ENABLE_ACCOUNTS = "SERENE_PUB_ENABLE_ACCOUNTS"
export const ENV_RECOVERY_KEY = "SERENE_PUB_RECOVERY_KEY"
export const ENV_RECOVERY_PASSWORD = "SERENE_PUB_RECOVERY_PASSWORD"

function hashKey(key: string): string {
	return crypto.createHash("sha256").update(key.trim()).digest("hex")
}

/**
 * The account these variables act on: the lowest-id admin that still exists.
 *
 * Not `id: 1`. This codebase has already been bitten by addressing seeded rows
 * by id — see db/defaults.ts — and an instance restored from a backup, or one
 * whose original admin was deleted, has no guarantee about which id is the
 * admin.
 */
async function findTargetAdmin() {
	return await db.query.users.findFirst({
		where: and(
			eq(schema.users.isAdmin, true),
			eq(schema.users.isDeleted, false)
		),
		orderBy: [asc(schema.users.id)]
	})
}

function validatePassword(raw: string, varName: string): string | null {
	const result = passphraseSchema.safeParse(raw)
	if (result.success) return result.data
	// Refuse rather than silently setting a weak password: if `.env` could set
	// something the UI rejects, the break-glass would be a way to weaken an
	// account rather than recover one.
	console.error(
		`[recovery] ${varName} was ignored — ${result.error.issues[0]?.message}`
	)
	return null
}

/**
 * First-boot seeding. Applies only while the admin has never had a passphrase
 * at all, which is a far more robust definition of "first boot" than a flag or
 * a row count — it stays correct across a restored backup or a wiped meta.json.
 */
async function applyFirstBootCredentials(): Promise<boolean> {
	const username = process.env[ENV_ADMIN_USERNAME]?.trim()
	const password = process.env[ENV_ADMIN_PASSWORD]
	if (!username && !password) return false

	const admin = await findTargetAdmin()
	if (!admin) return false

	const existing = await db.query.passphrases.findFirst({
		where: eq(schema.passphrases.userId, admin.id)
	})
	if (existing) return false

	if (username && username !== admin.username) {
		const taken = await db.query.users.findFirst({
			where: eq(schema.users.username, username)
		})
		if (taken) {
			console.error(
				`[recovery] ${ENV_ADMIN_USERNAME} was ignored — "${username}" is already taken.`
			)
		} else {
			await db
				.update(schema.users)
				.set({ username })
				.where(eq(schema.users.id, admin.id))
			console.log(`[recovery] admin username set to "${username}"`)
		}
	}

	if (password) {
		const valid = validatePassword(password, ENV_ADMIN_PASSWORD)
		if (valid) {
			await setPassphrase({ userId: String(admin.id), passphrase: valid })
			console.log(
				`[recovery] initial password set for admin "${username ?? admin.username}" from ${ENV_ADMIN_PASSWORD}`
			)
			await maybeEnableAccounts()
		}
	}
	return true
}

/**
 * Turn accounts on at first boot, for an unattended deployment.
 *
 * Off unless `SERENE_PUB_ENABLE_ACCOUNTS` is truthy, and **only** reached from
 * the first-boot path above after a valid `SERENE_PUB_ADMIN_PASSWORD` has
 * actually been set. That coupling is the point rather than a convenience:
 * enabling accounts is a one-way change, so doing it without a working password
 * would produce an instance with a login wall and no credential to pass it —
 * recoverable only through the break-glass variables below.
 *
 * Never on Android, which is single-user by design.
 */
async function maybeEnableAccounts(): Promise<void> {
	const raw = process.env[ENV_ENABLE_ACCOUNTS]?.trim().toLowerCase()
	if (!raw || raw === "false" || raw === "0") return

	if (isAndroidWrapper()) {
		console.warn(
			`[recovery] ${ENV_ENABLE_ACCOUNTS} ignored — the Android app is single-user.`
		)
		return
	}

	await db
		.update(schema.systemSettings)
		.set({ isAccountsEnabled: true })
		.where(eq(schema.systemSettings.id, 1))
	console.log(
		`[recovery] user accounts enabled at first boot via ${ENV_ENABLE_ACCOUNTS}`
	)
}

/**
 * The one-time-use reset.
 *
 * A bare "set the password from an env var" would revert whatever the user
 * later chose on every restart, and would only stop doing so once somebody
 * remembered to delete the variable — which nobody does. Pairing the reset with
 * an operator-chosen key makes it self-expiring: the key is recorded when
 * applied, and a key that matches the recorded one is ignored forever after.
 * Resetting again means choosing a *new* key.
 */
async function applyRecoveryKey(): Promise<boolean> {
	const key = process.env[ENV_RECOVERY_KEY]?.trim()
	const password = process.env[ENV_RECOVERY_PASSWORD]
	if (!key || !password) return false

	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1)
	})
	if (!settings) return false

	const keyHash = hashKey(key)
	if (settings.recoveryKeyHash === keyHash) {
		// Already spent. The variables can sit in .env inertly, which is the
		// entire point of keying the reset.
		return false
	}

	const valid = validatePassword(password, ENV_RECOVERY_PASSWORD)
	if (!valid) return false

	const admin = await findTargetAdmin()
	if (!admin) {
		console.error("[recovery] no admin account to recover.")
		return false
	}

	await setPassphrase({ userId: String(admin.id), passphrase: valid })

	// The key clears the second factor too. A password reset alone does not
	// rescue someone who lost their authenticator *and* their recovery codes —
	// they would sign in with the new password and stop at the code prompt,
	// still locked out. A break-glass is reached for when someone cannot get in
	// at all, not when they are picky about why.
	const totp = await db.query.userTotp.findFirst({
		where: eq(schema.userTotp.userId, admin.id)
	})
	if (totp) {
		await db
			.delete(schema.userTotpRecoveryCodes)
			.where(eq(schema.userTotpRecoveryCodes.userId, admin.id))
		await db
			.delete(schema.userTotp)
			.where(eq(schema.userTotp.userId, admin.id))
	}

	// Every existing session for this account is revoked. Whoever was holding
	// one was authenticated under credentials that no longer exist, and the
	// person running a break-glass is usually doing it because they suspect
	// exactly that.
	await db
		.delete(schema.userTokens)
		.where(eq(schema.userTokens.userId, admin.id))

	await db
		.update(schema.systemSettings)
		.set({ recoveryKeyHash: keyHash })
		.where(eq(schema.systemSettings.id, 1))

	// Loud on purpose. A break-glass should be usable, obvious after the fact,
	// and never quiet.
	console.warn(
		`[recovery] ⚠ Password reset for admin "${admin.username}" via ${ENV_RECOVERY_KEY}.` +
			(totp ? " Two-factor authentication was also cleared." : "") +
			` All sessions revoked. This key is now spent — remove ${ENV_RECOVERY_KEY} and ${ENV_RECOVERY_PASSWORD} from your environment.`
	)
	return true
}

/**
 * Runs as a startup task, before anything that can expose this instance.
 * Failures are logged and never fatal — a malformed recovery variable must not
 * stop an instance that is otherwise fine from booting.
 */
export async function applyEnvironmentRecovery(): Promise<void> {
	await applyFirstBootCredentials()
	await applyRecoveryKey()
}
