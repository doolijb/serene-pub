import { db } from "$lib/server/db"
import { eq, and, desc, isNull, or, like, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { z } from "zod"
import * as passphrase from "$lib/server/providers/users/passphrase"
import { cookies } from "$lib/server/auth"
import * as userTokens from "$lib/server/providers/users/tokens"
import { getUserConfigurations } from "../utils/getUserConfigurations"

// Passphrase validation schema
const passphraseSchema = z
	.string()
	.min(6, "Passphrase must be at least 6 characters long")
	.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
	.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
	.regex(
		/[^a-zA-Z0-9]/,
		"Passphrase must contain at least one special character"
	)

// Display name validation schema
const displayNameSchema = z
	.string()
	.min(3, "Display name must be at least 3 characters long")
	.max(50, "Display name must not exceed 50 characters")
	.trim()

export const usersGet: Handler<
	Sockets.Users.Get.Params,
	Sockets.Users.Get.Response
> = {
	event: "users:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const user = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId)
		})

		if (!user) {
			throw new Error("User not found")
		}

		// Get user configurations with fallback to system defaults
		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

		// Add active configs to user object for compatibility
		const userWithConfigs = {
			...user,
			activeConnection: connection,
			activeSamplingConfig: sampling,
			activeContextConfig: contextConfig,
			activePromptConfig: promptConfig
		}

		const res: Sockets.Users.Get.Response = { user: userWithConfigs }
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

		const user = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId)
		})

		if (!user) {
			console.error(`[usersCurrent] User with ID ${userId} not found`)
			emitToUser("users:current:error", { error: "User not found" })
			throw new Error("User not found")
		}

		// Get user configurations with fallback to system defaults
		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

		// Add active configs to user object for compatibility
		const userWithConfigs = {
			...user,
			activeConnection: connection,
			activeSamplingConfig: sampling,
			activeContextConfig: contextConfig,
			activePromptConfig: promptConfig
		}

		const res: Sockets.Users.Get.Response = { user: userWithConfigs }
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
		await usersGet.handler(socket, {}, emitToUser)
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
export async function user(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	const userId = socket.user!.id
	const user = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.id, userId)
	})

	if (!user) {
		throw new Error("User not found")
	}

	// Get user configurations with fallback to system defaults
	const { connection, sampling, contextConfig, promptConfig } =
		await getUserConfigurations(userId)

	// Add active configs to user object for compatibility
	const userWithConfigs = {
		...user,
		activeConnection: connection,
		activeSamplingConfig: sampling,
		activeContextConfig: contextConfig,
		activePromptConfig: promptConfig
	}

	socket.server
		.to("user_" + userId)
		.emit("users:current", { user: userWithConfigs })
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

		try {
			// Validate display name
			displayNameSchema.parse(params.displayName)
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errorMessage =
					error.errors[0]?.message || "Invalid display name"
				console.error(
					"[usersCurrentUpdateDisplayName] Validation error:",
					errorMessage
				)
				emitToUser("users:current:updateDisplayName:error", {
					error: errorMessage
				})
				throw new Error(errorMessage)
			}
		}

		try {
			// Update the user's display name
			await db
				.update(schema.users)
				.set({ displayName: params.displayName })
				.where(eq(schema.users.id, userId))

			const res: Sockets.Users.UpdateDisplayName.Response = {
				success: true,
				displayName: params.displayName
			}

			emitToUser("users:current:updateDisplayName", res)
			// Refresh current user data
			await usersCurrent.handler(socket, {}, emitToUser)
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

		// Validate required fields
		if (!params.username) {
			throw new Error("Username is required")
		}

		if (!params.passphrase) {
			throw new Error("Passphrase is required")
		}

		// Check if username already exists
		const existingUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.username, params.username)
		})

		if (existingUser) {
			throw new Error("Username already exists")
		}

		const [newUser] = await db
			.insert(schema.users)
			.values({
				username: params.username,
				displayName: params.displayName || null,
				isAdmin: params.isAdmin || false
			})
			.returning()

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

		// Check if user exists
		const targetUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, params.id)
		})

		if (!targetUser) {
			throw new Error("User not found")
		}

		// If username is being changed, check if it already exists
		if (params.username && params.username !== targetUser.username) {
			const existingUser = await db.query.users.findFirst({
				where: (u, { eq, and, ne }) =>
					and(eq(u.username, params.username), ne(u.id, params.id))
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
		if (params.isAdmin !== undefined) updateData.isAdmin = params.isAdmin

		const [updatedUser] = await db
			.update(schema.users)
			.set(updateData)
			.where(eq(schema.users.id, params.id))
			.returning()

		// Update passphrase if provided
		if (params.passphrase) {
			await passphrase.set({
				userId: String(params.id),
				passphrase: params.passphrase
			})
		}

		const res: Sockets.Users.Update.Response = { user: updatedUser }
		emitToUser("users:update", res)
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

		const res: Sockets.Users.Delete.Response = { success: true }
		emitToUser("users:delete", res)
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
