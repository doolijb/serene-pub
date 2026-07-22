import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import type { AuthenticatedSocket } from "./auth"
import { listCardSources, cachedCardDetail } from "$lib/server/cardSources"
import { encryptToken } from "$lib/server/utils/tokenCrypto"
import { isUnsafeCharacterBrowsingEnabled } from "$lib/server/utils"
import {
	getSessionCookie,
	invalidateSession
} from "$lib/server/cardSources/charaVault/session"

async function isCharaVaultConfigured(): Promise<boolean> {
	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { charaVaultEmail: true, charaVaultEncryptedToken: true }
	})
	return !!(settings?.charaVaultEmail && settings?.charaVaultEncryptedToken)
}

export const cardSourcesCapabilities: Handler<
	Sockets.CardSources.Capabilities.Params,
	Sockets.CardSources.Capabilities.Response
> = {
	event: "cardSources:capabilities",
	handler: async (socket, params, emitToUser) => {
		try {
			const charaVaultConnected = await isCharaVaultConfigured()
			const res: Sockets.CardSources.Capabilities.Response = {
				unsafeBrowsingEnabled: isUnsafeCharacterBrowsingEnabled(),
				sources: listCardSources().map((s) => ({
					id: s.id,
					label: s.label,
					description: s.description,
					url: s.url,
					supportsPersonas: s.supports("persona")
				})),
				charaVaultConnected
			}
			emitToUser("cardSources:capabilities", res)
			return res
		} catch (error: any) {
			console.error("Card source capabilities error:", error)
			emitToUser("cardSources:capabilities:error", {
				error: "Failed to fetch card source capabilities"
			})
			throw error
		}
	}
}

export const cardSourcesCharaVaultConnect: Handler<
	Sockets.CardSources.CharaVaultConnect.Params,
	Sockets.CardSources.CharaVaultConnect.Response
> = {
	event: "cardSources:charaVault:connect",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			const { ciphertext, iv, authTag } = encryptToken(params.token)

			await db
				.update(schema.systemSettings)
				.set({
					charaVaultEmail: params.email,
					charaVaultEncryptedToken: ciphertext,
					charaVaultTokenIv: iv,
					charaVaultTokenAuthTag: authTag
				})
				.where(eq(schema.systemSettings.id, 1))

			invalidateSession()
			const cookie = await getSessionCookie()

			if (!cookie) {
				// Verification failed — don't leave a credential that doesn't
				// actually work saved as if it were connected.
				await db
					.update(schema.systemSettings)
					.set({
						charaVaultEmail: null,
						charaVaultEncryptedToken: null,
						charaVaultTokenIv: null,
						charaVaultTokenAuthTag: null
					})
					.where(eq(schema.systemSettings.id, 1))

				emitToUser("cardSources:charaVault:connect:error", {
					error: "Could not sign in to CharaVault with that email and App Password."
				})
				throw new Error("CharaVault login verification failed")
			}

			const res: Sockets.CardSources.CharaVaultConnect.Response = {
				success: true
			}
			emitToUser("cardSources:charaVault:connect", res)
			return res
		} catch (error: any) {
			console.error("CharaVault connect error:", error)
			if (!error?.message?.includes("verification failed")) {
				emitToUser("cardSources:charaVault:connect:error", {
					error:
						error.message || "Failed to connect CharaVault account"
				})
			}
			throw error
		}
	}
}

export const cardSourcesCharaVaultDisconnect: Handler<
	Sockets.CardSources.CharaVaultDisconnect.Params,
	Sockets.CardSources.CharaVaultDisconnect.Response
> = {
	event: "cardSources:charaVault:disconnect",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			await db
				.update(schema.systemSettings)
				.set({
					charaVaultEmail: null,
					charaVaultEncryptedToken: null,
					charaVaultTokenIv: null,
					charaVaultTokenAuthTag: null
				})
				.where(eq(schema.systemSettings.id, 1))

			invalidateSession()

			const res: Sockets.CardSources.CharaVaultDisconnect.Response = {
				success: true
			}
			emitToUser("cardSources:charaVault:disconnect", res)
			return res
		} catch (error: any) {
			console.error("CharaVault disconnect error:", error)
			emitToUser("cardSources:charaVault:disconnect:error", {
				error: "Failed to disconnect CharaVault account"
			})
			throw error
		}
	}
}

export const cardSourcesCharaVaultStatus: Handler<
	Sockets.CardSources.CharaVaultStatus.Params,
	Sockets.CardSources.CharaVaultStatus.Response
> = {
	event: "cardSources:charaVault:status",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			const settings = await db.query.systemSettings.findFirst({
				where: eq(schema.systemSettings.id, 1),
				columns: {
					charaVaultEmail: true,
					charaVaultEncryptedToken: true
				}
			})

			const hasCredential = !!(
				settings?.charaVaultEmail && settings?.charaVaultEncryptedToken
			)
			// A saved credential isn't the same as a working one — actually
			// attempt (or reuse a cached) login so "Connected" reflects real
			// auth health rather than just "something is saved". Login
			// failures (bad/revoked credential, corrupt token, CharaVault
			// unreachable) are reported here as simply disconnected rather
			// than surfaced as a status-fetch error — the admin only cares
			// whether requests will actually authenticate.
			let connected = false
			if (hasCredential) {
				try {
					connected = !!(await getSessionCookie())
				} catch {
					connected = false
				}
			}

			const res: Sockets.CardSources.CharaVaultStatus.Response = {
				connected,
				email: settings?.charaVaultEmail ?? null
			}
			emitToUser("cardSources:charaVault:status", res)
			return res
		} catch (error: any) {
			console.error("CharaVault status error:", error)
			emitToUser("cardSources:charaVault:status:error", {
				error: "Failed to fetch CharaVault status"
			})
			throw error
		}
	}
}

export const cardSourcesCardDetail: Handler<
	Sockets.CardSources.CardDetail.Params,
	Sockets.CardSources.CardDetail.Response
> = {
	event: "cardSources:cardDetail",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const detail = await cachedCardDetail(params.source, params.ref, {
				userId: socket.user!.id
			})
			const res: Sockets.CardSources.CardDetail.Response = {
				...detail,
				requestId: params.requestId
			}
			emitToUser("cardSources:cardDetail", res)
			return res
		} catch (error: any) {
			console.error("Card detail fetch error:", error)
			emitToUser("cardSources:cardDetail:error", {
				error: error.message || "Failed to fetch card detail",
				requestId: params.requestId
			})
			throw error
		}
	}
}

export function registerCardSourceHandlers(
	socket: AuthenticatedSocket,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: AuthenticatedSocket,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, cardSourcesCapabilities, emitToUser)
	register(socket, cardSourcesCharaVaultConnect, emitToUser)
	register(socket, cardSourcesCharaVaultDisconnect, emitToUser)
	register(socket, cardSourcesCharaVaultStatus, emitToUser)
	register(socket, cardSourcesCardDetail, emitToUser)
}
