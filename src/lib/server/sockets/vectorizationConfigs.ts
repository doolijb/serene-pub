import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { setEmbeddingTtlMinutes } from "$lib/server/embedding/index"

export const vectorizationConfigGetHandler: Handler<
	Sockets.VectorizationConfig.Get.Params,
	Sockets.VectorizationConfig.Get.Response
> = {
	event: "vectorizationConfig:get",
	handler: async (_socket, _params, emitToUser) => {
		// apiKey deliberately excluded — the client never reads it from this
		// event (only from the admin-gated vectorization:listModels), so any
		// authenticated non-admin user could otherwise read the plaintext
		// embedding-provider API key straight off this response.
		const config = await db.query.vectorizationConfigs.findFirst({
			where: eq(schema.vectorizationConfigs.id, 1),
			columns: { apiKey: false }
		})
		const res: Sockets.VectorizationConfig.Get.Response = {
			config: config ?? { embeddingModelTtlMinutes: 5 }
		}
		emitToUser("vectorizationConfig:get", res)
		return res
	}
}

export const vectorizationConfigUpdateHandler: Handler<
	Sockets.VectorizationConfig.Update.Params,
	Sockets.VectorizationConfig.Update.Response
> = {
	event: "vectorizationConfig:update",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await db
			.update(schema.vectorizationConfigs)
			.set({ embeddingModelTtlMinutes: params.embeddingModelTtlMinutes })
			.where(eq(schema.vectorizationConfigs.id, 1))
		setEmbeddingTtlMinutes(params.embeddingModelTtlMinutes)
		const res: Sockets.VectorizationConfig.Update.Response = {
			success: true
		}
		emitToUser("vectorizationConfig:update", res)
		await vectorizationConfigGetHandler.handler(socket, {}, emitToUser)
		return res
	}
}

export function registerVectorizationConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, vectorizationConfigGetHandler, emitToUser)
	register(socket, vectorizationConfigUpdateHandler, emitToUser)
}
