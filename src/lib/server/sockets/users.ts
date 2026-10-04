import { db } from "$lib/server/db"
import { eq, and, desc, isNull, or, like, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { isUniqueViolation } from "$lib/server/db/errors"
import type { Handler } from "$lib/shared/events"
import { z } from "zod"
import { passphraseSchema } from "$lib/shared/validation/passphrase"
import { displayNameSchema } from "$lib/shared/validation/displayName"
import * as passphrase from "$lib/server/providers/users/passphrase"
import { cookies } from "$lib/server/auth"
import * as userTokens from "$lib/server/providers/users/tokens"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"

/**
 * Enforce the one passphrase rule (`passphraseSchema`) on the server. The
 * forms check it too, but a socket client can send anything — and the max
 * length bounds the PBKDF2 cost an attacker-supplied passphrase can force the
 * server to pay. Throws the rule's own first message.
 */
function assertPassphraseRule(raw: string): string {
	const parsed = passphraseSchema.safeParse(raw)
	if (!parsed.success) {
		throw new Error(parsed.error.issues[0]?.message ?? "Invalid passphrase")
	}
	return parsed.data
}

/**
 * The account-management handlers (list/create/update/delete) exist only when
 * accounts do. With accounts off the instance is single-user: there is no
 * roster to manage, and the admin Users page hides — but the socket surface
 * must refuse too, not just the UI. Self-scoped handlers (users:current:*)
 * stay live either way; the sole user still owns their profile.
 */
async function requireAccountsEnabled() {
	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { isAccountsEnabled: true }
	})
	if (!settings?.isAccountsEnabled)
		throw new Error("Accounts are disabled on this pub.")
}


/**
 * The signed-in user's own row.
 *
 * One read behind both `users:get` and `users:current`, split out so the
 * cascades that refresh them — here, and in four other config families — can be
 * handed the BUILDER rather than a handler. Both events are gated, so a theme
 * change or an active-config switch made from a surface that shows no user
 * profile pays for no re-read at all. Skipping the emit alone would save
 * nothing; the query is the cost.
 *
 * ⚠ Columns only — no `with`. That is what keeps this payload free of the
 * passphrase and TOTP rows, which live in their own tables (`passphrases`,
 * `user_totp`) and are joined by relations this deliberately does not ask for.
 */
async function loadUserRow(userId: number) {
	const user = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.id, userId)
	})
	if (!user) throw new Error("User not found")
	return user
}

/** `users:get`'s payload. See `loadUserRow`. */
export async function buildUsersGet(
	userId: number
): Promise<Sockets.Users.Get.Response> {
	return { user: await loadUserRow(userId) }
}

/**
 * `users:current`'s payload — the same row under the other event name.
 *
 * Two builders rather than one shared alias because the gate keys on the EVENT:
 * a call site that says which event it is refreshing is the one thing that keeps
 * the two from being cascaded interchangeably.
 */
export async function buildUsersCurrent(
	userId: number
): Promise<Sockets.Users.Get.Response> {
	return { user: await loadUserRow(userId) }
}

export const usersGet: Handler<
	Sockets.Users.Get.Params,
	Sockets.Users.Get.Response
> = {
	event: "users:get",
	handler: async (socket, params, emitToUser) => {
		const res = await buildUsersGet(socket.user!.id)
		emitToUser("users:get", res)
		return res
	}
}

export const usersCurrent: Handler<
	Sockets.Users.Get.Params,
	Sockets.Users.Get.Response
> = {
	event: "users:current",
	handler: async (socket, params, emitToUser) => {
		// Get the authenticated user from socket (set by auth middleware)
		const userId = socket.user!.id

		if (!userId) {
			console.error(
				"[usersCurrent] No authenticated user found on socket"
			)
			emitToUser("users:current:error", { error: "Not authenticated" })
			throw new Error("Not authenticated")
		}

		let res: Sockets.Users.Get.Response
		try {
			res = await buildUsersCurrent(userId)
		} catch (error) {
			console.error(`[usersCurrent] User with ID ${userId} not found`)
			emitToUser("users:current:error", { error: "User not found" })
			throw error
		}

		emitToUser("users:current", res)
		return res
	}
}

export const usersSetTheme: Handler<
	Sockets.Users.SetTheme.Params,
	Sockets.Users.SetTheme.Response
> = {
	event: "users:setTheme",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { theme, darkMode } = params

		if (!theme) {
			console.error("[setTheme] No theme provided")
			emitToUser("users:setTheme:error", { error: "No theme provided" })
			throw new Error("No theme provided")
		}

		await db
			.update(schema.users)
			.set({ theme, darkMode })
			.where(eq(schema.users.id, userId))

		const res: Sockets.Users.SetTheme.Response = {}
		emitToUser("users:setTheme", res)
		// Lazy: only a surface showing the user row wants it re-read. See
		// `loadUserRow`.
		await emitToUser("users:get", () => buildUsersGet(userId))
		return res
	}
}

export const usersCurrentSetPassphrase: Handler<
	Sockets.Users.SetPassphrase.Params,
	Sockets.Users.SetPassphrase.Response
> = {
	event: "users:current:setPassphrase",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		if (!userId) {
			console.error(
				"[usersCurrentSetPassphrase] No authenticated user found on socket"
			)
			emitToUser("users:current:setPassphrase:error", {
				error: "Not authenticated"
			})
			throw new Error("Not authenticated")
		}

		// This handler is only meant for first-time setup — the client only
		// emits it when it has no passphrase yet. usersCurrentChangePassphrase
		// is the path that verifies a current passphrase before replacing it;
		// without this check, anyone with momentary access to an already-
		// authenticated session (a stolen cookie, XSS, an unlocked device)
		// could silently overwrite an existing passphrase with no knowledge
		// of the old one — permanent account takeover from transient access.
		const existingPassphrase = await db.query.passphrases.findFirst({
			where: (p, { and, eq, isNull }) =>
				and(eq(p.userId, userId), isNull(p.invalidatedAt))
		})
		if (existingPassphrase) {
			const res: Sockets.Users.SetPassphrase.Response = {
				success: false,
				message:
					"Passphrase already set. Use change passphrase instead."
			}
			emitToUser("users:current:setPassphrase:error", res)
			throw new Error("Passphrase already set.")
		}

		try {
			// Validate passphrase
			passphraseSchema.parse(params.passphrase)
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errorMessage = error.errors
					.map((e) => e.message)
					.join(", ")
				const res: Sockets.Users.SetPassphrase.Response = {
					success: false,
					message: errorMessage
				}
				emitToUser("users:current:setPassphrase", res)
				return res
			}
			throw error
		}

		// Set the new passphrase using the existing provider
		await passphrase.set({
			userId: userId.toString(),
			passphrase: params.passphrase
		})

		const res: Sockets.Users.SetPassphrase.Response = {
			success: true,
			message: "Passphrase set successfully"
		}
		emitToUser("users:current:setPassphrase", res)

		// Revoke every token AND every live socket for this user — setting a
		// passphrase on a previously-unsecured account should invalidate every
		// session that existed before the account had any credential at all.
		// Must come after the emitToUser above: the caller shares this same
		// user room, so disconnecting first would cut them off before they
		// see their own action succeeded.
		await userTokens.expireAll({ userId: userId.toString() })
		socket.io.to("user_" + userId).disconnectSockets(true)

		return res
	}
}

export const usersCurrentHasPassphrase: Handler<
	Sockets.Users.HasPassphrase.Params,
	Sockets.Users.HasPassphrase.Response
> = {
	event: "users:current:hasPassphrase",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		if (!userId) {
			console.error(
				"[usersCurrentHasPassphrase] No authenticated user found on socket"
			)
			emitToUser("users:current:hasPassphrase:error", {
				error: "Not authenticated"
			})
			throw new Error("Not authenticated")
		}

		try {
			// Check if user has a current (non-invalidated) passphrase
			const currentPassphrase = await db.query.passphrases.findFirst({
				where: (p, { eq, and, isNull }) =>
					and(eq(p.userId, userId), isNull(p.invalidatedAt)),
				orderBy: (p, { desc }) => [desc(p.createdAt)]
			})

			const res: Sockets.Users.HasPassphrase.Response = {
				hasPassphrase: !!currentPassphrase
			}
			emitToUser("users:current:hasPassphrase", res)
			return res
		} catch (error) {
			console.error("[usersCurrentHasPassphrase] Database error:", error)
			emitToUser("users:current:hasPassphrase:error", {
				error: "Database error checking passphrase"
			})
			throw error
		}
	}
}

// Legacy functions for compatibility
/**
 * Push the caller's own user row — the cascade five other config families use
 * after a write that changes what the row says (active configs, theme).
 *
 * ⚠ This emitted RAW until 2026-09-15: `socket.server.to("user_" + userId)`,
 * straight past `emitToUser` and therefore past both `redactConnections` and the
 * interest gate. It was the only emit in `sockets/` that did. It now goes the
 * way everything else goes, in the lazy form, so the read is paid only for a
 * client that is showing the row.
 *
 * Recipients are unchanged: `emitToUser` addresses the same `user_<id>` room,
 * narrowing to the interested SOCKETS in it once `users:current` is gated.
 *
 * One behaviour change, deliberate: a missing row throws inside the thunk, where
 * `evaluate` logs it. Raised from here instead, it turns a caller's finished
 * write into an `{event}:error`. The row belongs to the authenticated socket and
 * deleting a user force-disconnects their sockets, so the case needs the account
 * to vanish mid-request — and a successful write reported as a failure is not
 * the better answer to that.
 */
export async function user(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	const userId = socket.user!.id
	await emitToUser("users:current", () => buildUsersCurrent(userId))
}

export async function setTheme(
	socket: any,
	message: { theme: string; darkMode: boolean },
	emitToUser: (event: string, data: any) => void
) {
	await usersSetTheme.handler(socket, message, emitToUser)
}

export const usersCurrentUpdateDisplayName: Handler<
	Sockets.Users.UpdateDisplayName.Params,
	Sockets.Users.UpdateDisplayName.Response
> = {
	event: "users:current:updateDisplayName",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		if (!userId) {
			console.error(
				"[usersCurrentUpdateDisplayName] No authenticated user found on socket"
			)
			emitToUser("users:current:updateDisplayName:error", {
				error: "Not authenticated"
			})
			throw new Error("Not authenticated")
		}

		// Trimmed; empty clears the name, so the app falls back to the username.
		const parsed = displayNameSchema.safeParse(params.displayName ?? "")
		if (!parsed.success) {
			const errorMessage =
				parsed.error.errors[0]?.message || "Invalid display name"
			emitToUser("users:current:updateDisplayName:error", {
				error: errorMessage
			})
			throw new Error(errorMessage)
		}
		const displayName = parsed.data

		try {
			await db
				.update(schema.users)
				.set({ displayName })
				.where(eq(schema.users.id, userId))

			const res: Sockets.Users.UpdateDisplayName.Response = {
				success: true,
				displayName
			}

			emitToUser("users:current:updateDisplayName", res)
			// Refresh current user data — lazily, for the reason given on
			// `loadUserRow`.
			await emitToUser("users:current", () => buildUsersCurrent(userId))
			return res
		} catch (error: any) {
			console.error(
				"[usersCurrentUpdateDisplayName] Database error:",
				error
			)
			emitToUser("users:current:updateDisplayName:error", {
				error: "Failed to update display name"
			})
			throw error
		}
	}
}

export const usersCurrentChangePassphrase: Handler<
	Sockets.Users.ChangePassphrase.Params,
	Sockets.Users.ChangePassphrase.Response
> = {
	event: "users:current:changePassphrase",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		if (!userId) {
			console.error(
				"[usersCurrentChangePassphrase] No authenticated user found on socket"
			)
			emitToUser("users:current:changePassphrase:error", {
				error: "Not authenticated"
			})
			throw new Error("Not authenticated")
		}

		// A hijacked session (XSS, momentarily-stolen cookie) could otherwise
		// brute-force the real plaintext passphrase purely to harvest it for
		// credential-reuse against other services — reuse the same
		// rate-limit service /api/login uses, namespaced separately so it
		// doesn't share a budget with IP-based login limiting.
		const rateLimitKey = `changePassphrase:${userId}`
		if (loginRateLimit.isRateLimited(rateLimitKey)) {
			emitToUser("users:current:changePassphrase:error", {
				error: "Too many attempts. Please wait a moment and try again."
			})
			throw new Error("Rate limited")
		}
		// Recorded immediately, before the expensive passphrase.validate()
		// await below — recording only after that await let concurrent
		// requests all pass the isRateLimited check above before any of
		// them recorded an attempt. clearRateLimit() on success (below)
		// still resets the bucket, so a normal single successful change is
		// unaffected.
		loginRateLimit.recordFailedAttempt(rateLimitKey)

		try {
			// Validate current passphrase first
			const isCurrentValid = await passphrase.validate({
				userId: userId.toString(),
				passphrase: params.currentPassphrase
			})

			if (!isCurrentValid) {
				console.error(
					"[usersCurrentChangePassphrase] Invalid current passphrase"
				)
				emitToUser("users:current:changePassphrase:error", {
					error: "Current passphrase is incorrect"
				})
				throw new Error("Invalid current passphrase")
			}
			loginRateLimit.clearRateLimit(rateLimitKey)

			// Validate new passphrase format
			passphraseSchema.parse(params.newPassphrase)
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errorMessage =
					error.errors[0]?.message || "Invalid new passphrase"
				console.error(
					"[usersCurrentChangePassphrase] New passphrase validation error:",
					errorMessage
				)
				emitToUser("users:current:changePassphrase:error", {
					error: errorMessage
				})
				throw new Error(errorMessage)
			}
			// Re-throw other errors (like invalid current passphrase)
			throw error
		}

		try {
			// Set the new passphrase
			await passphrase.set({
				userId: userId.toString(),
				passphrase: params.newPassphrase
			})

			const res: Sockets.Users.ChangePassphrase.Response = {
				success: true,
				message: "Passphrase changed successfully"
			}

			emitToUser("users:current:changePassphrase", res)

			// Revoke every token AND every live socket for this user — a stolen
			// session surviving a passphrase change (up to
			// USER_TOKEN_EXPIRATION_HOURS on the token, indefinitely on an
			// already-open socket, since socket.user is only ever set at
			// connect time) would completely undermine passphrase rotation as
			// an incident-response action. Must come after the emitToUser
			// above: the caller shares this same user room, so disconnecting
			// first would cut them off before they see their own action
			// succeeded.
			await userTokens.expireAll({ userId: userId.toString() })
			socket.io.to("user_" + userId).disconnectSockets(true)

			return res
		} catch (error: any) {
			console.error(
				"[usersCurrentChangePassphrase] Failed to set new passphrase:",
				error
			)
			emitToUser("users:current:changePassphrase:error", {
				error: "Failed to change passphrase"
			})
			throw error
		}
	}
}

export const usersCurrentLogout: Handler<
	Sockets.Users.Logout.Params,
	Sockets.Users.Logout.Response
> = {
	event: "users:current:logout",
	handler: async (socket, params, emitToUser) => {
		try {
			// If user is authenticated, clean up socket state
			if (socket.user) {
				socket.leave(`user_${socket.user.id}`)
				socket.user = undefined
				socket.isAuthenticated = false
			}

			// Note: We cannot directly delete HTTP-only cookies from socket handlers
			// The client should make a request to /api/logout to clear the cookie
			const res: Sockets.Users.Logout.Response = {
				success: true
			}

			emitToUser("users:current:logout", res)
			// Every subsequent event on this socket would otherwise hit a
			// non-null-assertion TypeError on the now-cleared socket.user
			// (caught generically by register(), but ungracefully) and the
			// connection stays registered in the user_${id} room indefinitely.
			socket.disconnect(true)
			return res
		} catch (error: any) {
			console.error("[usersCurrentLogout] Logout error:", error)
			emitToUser("users:current:logout:error", { error: "Logout failed" })
			throw error
		}
	}
}

export const usersList: Handler<
	Sockets.Users.List.Params,
	Sockets.Users.List.Response
> = {
	event: "users:list",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await requireAccountsEnabled()
		const currentUserId = socket.user!.id

		// Get current user to check admin status
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, currentUserId)
		})

		if (!currentUser) {
			throw new Error("User not found")
		}

		// Build base query
		let whereCondition = (u: any, { eq, and, or, like }: any) => {
			let conditions = [eq(u.isDeleted, false)]

			// Add search filter if provided
			if (params.search) {
				const searchPattern = `%${params.search.toLowerCase()}%`
				conditions.push(
					or(
						like(u.username, searchPattern),
						like(u.displayName, searchPattern)
					)
				)
			}

			return conditions.length > 1 ? and(...conditions) : conditions[0]
		}

		const users = await db.query.users.findMany({
			where: whereCondition,
			orderBy: (u, { asc }) => [asc(u.username)]
		})

		const res: Sockets.Users.List.Response = { users }
		emitToUser("users:list", res)
		return res
	}
}

/** The refusal for a username already in use — by the pre-check or the index. */
const USERNAME_TAKEN = "Username already exists"

export const usersCreate: Handler<
	Sockets.Users.Create.Params,
	Sockets.Users.Create.Response
> = {
	event: "users:create",
	handler: async (socket, params, emitToUser) => {
		const currentUserId = socket.user!.id

		// Get current user to check admin status
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, currentUserId)
		})

		if (!currentUser || !currentUser.isAdmin) {
			throw new Error("Admin privileges required")
		}
		await requireAccountsEnabled()

		// Validate required fields
		if (!params.username) {
			throw new Error("Username is required")
		}

		if (!params.passphrase) {
			throw new Error("Passphrase is required")
		}
		// Before the insert: a refused passphrase must not leave behind an
		// account with no passphrase at all.
		assertPassphraseRule(params.passphrase)

		// Check if username already exists
		const existingUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.username, params.username)
		})

		// Emitted as well as thrown: the wrapper's own catch would otherwise
		// answer "An error occurred…", and this is a refusal the admin can act
		// on. Both paths below say the same sentence.
		if (existingUser) {
			emitToUser("users:create:error", { error: USERNAME_TAKEN })
			throw new Error(USERNAME_TAKEN)
		}

		// The findFirst check above is a friendly pre-check, not the real
		// guard — two concurrent creates for the same username could both
		// pass it before either insert commits. users.username now has a DB
		// unique constraint as the actual backstop; translate its violation
		// into the same friendly message rather than letting a raw
		// constraint-violation error surface.
		let newUser: typeof schema.users.$inferSelect
		try {
			;[newUser] = await db
				.insert(schema.users)
				.values({
					username: params.username,
					displayName: params.displayName || null,
					// Never on creation (27 §5). An account nobody has signed
					// into yet is an unproven claim about who holds it — a
					// mistyped username or an intercepted invite would hand
					// over the instance. Promote after their first sign-in.
					isAdmin: false
				})
				.returning()
		} catch (err) {
			// The SQLSTATE is on the driver error, under drizzle's wrapper.
			if (isUniqueViolation(err)) {
				emitToUser("users:create:error", { error: USERNAME_TAKEN })
				throw new Error(USERNAME_TAKEN)
			}
			throw err
		}

		// Set passphrase (required for creation)
		await passphrase.set({
			userId: String(newUser.id),
			passphrase: params.passphrase,
			createOnly: true
		})

		const res: Sockets.Users.Create.Response = { user: newUser }
		emitToUser("users:create", res)
		return res
	}
}

export const usersUpdate: Handler<
	Sockets.Users.Update.Params,
	Sockets.Users.Update.Response
> = {
	event: "users:update",
	handler: async (socket, params, emitToUser) => {
		const currentUserId = socket.user!.id

		// Get current user to check admin status
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, currentUserId)
		})

		if (!currentUser || !currentUser.isAdmin) {
			throw new Error("Admin privileges required")
		}
		await requireAccountsEnabled()

		// Check if user exists
		const targetUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, params.id)
		})

		if (!targetUser) {
			throw new Error("User not found")
		}

		// Empty means "leave it unchanged" (the edit form sends nothing when
		// the field is blank). Checked before any write so a refused
		// passphrase does not half-apply the rest of the edit.
		if (params.passphrase) assertPassphraseRule(params.passphrase)

		// If username is being changed, check if it already exists
		if (params.username && params.username !== targetUser.username) {
			// Narrowed to a local so the type stays `string` (not `string |
			// undefined`) once captured by the where callback below — TS does
			// not retain the outer `if` narrowing of `params.username` across
			// the callback boundary.
			const newUsername = params.username
			const existingUser = await db.query.users.findFirst({
				where: (u, { eq, and, ne }) =>
					and(eq(u.username, newUsername), ne(u.id, params.id))
			})

			if (existingUser) {
				throw new Error("Username already exists")
			}
		}

		// Build update data
		const updateData: any = {}
		if (params.username !== undefined) updateData.username = params.username
		if (params.displayName !== undefined)
			updateData.displayName = params.displayName
		if (params.isAdmin !== undefined) {
			// Promotion is gated on the account having been signed into at
			// least once (27 §5). Demotion is always allowed — removing
			// privilege is the safe direction and must never be blocked.
			if (params.isAdmin) {
				const target = await db.query.users.findFirst({
					where: eq(schema.users.id, params.id),
					columns: { lastLoginAt: true, username: true }
				})
				if (!target?.lastLoginAt) {
					throw new Error(
						`"${target?.username ?? "That user"}" has never signed in. ` +
							"They must sign in once before they can be made an administrator."
					)
				}
			}
			updateData.isAdmin = params.isAdmin
		}

		// A passphrase-only edit has no row fields to write; drizzle refuses an
		// empty `.set()`.
		const [updatedUser] =
			Object.keys(updateData).length > 0
				? await db
						.update(schema.users)
						.set(updateData)
						.where(eq(schema.users.id, params.id))
						.returning()
				: [targetUser]

		// Update passphrase if provided
		if (params.passphrase) {
			await passphrase.set({
				userId: String(params.id),
				passphrase: params.passphrase
			})
		}

		const res: Sockets.Users.Update.Response = { user: updatedUser }
		emitToUser("users:update", res)

		// socket.user is only ever set at connect time and never
		// re-validated — without forcing a reconnect here, a demoted (or
		// promoted) user's already-open socket keeps using its stale cached
		// isAdmin indefinitely, on every one of the ~90+ admin-gated
		// handlers across the app that check it. Must come after the
		// emitToUser above: when an admin demotes themselves, caller and
		// target share this same user room, so disconnecting first would
		// cut them off before they see their own action succeeded.
		if (params.isAdmin !== undefined) {
			socket.io.to("user_" + params.id).disconnectSockets(true)
		}

		// An admin-initiated passphrase reset must invalidate the target's
		// existing session token too, not just force a reconnect — otherwise
		// the same already-issued token (still valid for up to
		// USER_TOKEN_EXPIRATION_HOURS) just re-authenticates immediately,
		// defeating the standard incident-response use of this action
		// ("reset this compromised account's passphrase"). Mirrors
		// usersCurrentChangePassphrase's own revocation.
		if (params.passphrase) {
			await userTokens.expireAll({ userId: String(params.id) })
			socket.io.to("user_" + params.id).disconnectSockets(true)
		}
		return res
	}
}

export const usersDelete: Handler<
	Sockets.Users.Delete.Params,
	Sockets.Users.Delete.Response
> = {
	event: "users:delete",
	handler: async (socket, params, emitToUser) => {
		const currentUserId = socket.user!.id

		// Get current user to check admin status
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, currentUserId)
		})

		if (!currentUser || !currentUser.isAdmin) {
			throw new Error("Admin privileges required")
		}
		await requireAccountsEnabled()

		// Check if user exists
		const targetUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, params.id)
		})

		if (!targetUser) {
			throw new Error("User not found")
		}

		// Prevent deleting yourself
		if (params.id === currentUserId) {
			throw new Error("Cannot delete your own account")
		}

		// Soft delete the user
		await db
			.update(schema.users)
			.set({ isDeleted: true })
			.where(eq(schema.users.id, params.id))

		// Revoke every active session immediately — without this, a token
		// issued before the delete stays valid (and authenticate() didn't
		// check isDeleted either, see the fix there) for up to
		// USER_TOKEN_EXPIRATION_HOURS, letting a "deleted" user keep sessionting.
		await db
			.delete(schema.userTokens)
			.where(eq(schema.userTokens.userId, params.id))

		const res: Sockets.Users.Delete.Response = { success: true }
		emitToUser("users:delete", res)

		// Token revocation above prevents the deleted user from
		// reconnecting, but does nothing about a socket they already have
		// open — force it closed too, same reasoning as usersUpdate's
		// isAdmin-change disconnect above.
		socket.io.to("user_" + params.id).disconnectSockets(true)
		return res
	}
}

// Registration function for all user handlers
export function registerUserHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, usersGet, emitToUser)
	register(socket, usersCurrent, emitToUser)
	register(socket, usersSetTheme, emitToUser)
	register(socket, usersCurrentSetPassphrase, emitToUser)
	register(socket, usersCurrentHasPassphrase, emitToUser)
	register(socket, usersCurrentUpdateDisplayName, emitToUser)
	register(socket, usersCurrentChangePassphrase, emitToUser)
	register(socket, usersCurrentLogout, emitToUser)
	register(socket, usersList, emitToUser)
	register(socket, usersCreate, emitToUser)
	register(socket, usersUpdate, emitToUser)
	register(socket, usersDelete, emitToUser)
}
