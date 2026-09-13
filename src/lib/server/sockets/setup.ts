import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"

interface SetupData {
	ragStepComplete: boolean
}

/** The wizard steps whose completion is the server's to remember. */
type SetupStep = "rag"

async function getOrCreate(userId: number): Promise<SetupData> {
	const existing = await db.query.setup.findFirst({
		where: eq(schema.setup.userId, userId)
	})
	if (existing) return existing
	const [created] = await db
		.insert(schema.setup)
		.values({ userId })
		.returning()
	return created
}

export const setupGet: Handler<Record<string, never>, { setup: SetupData }> = {
	event: "setup:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getOrCreate(userId)
		const res = {
			setup: {
				ragStepComplete: row.ragStepComplete
			}
		}
		emitToUser("setup:get", res)
		return res
	}
}

export const setupMarkComplete: Handler<
	{ step: SetupStep },
	{ setup: SetupData }
> = {
	event: "setup:markComplete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		// An unrecognised step is refused, never taken for the one step there
		// is: a forged value must not flip a flag whose step was never run.
		if (params.step !== "rag") {
			throw new Error("Invalid setup step.")
		}
		const updates = { ragStepComplete: true }

		await db
			.insert(schema.setup)
			.values({ userId, ...updates })
			.onConflictDoUpdate({
				target: schema.setup.userId,
				set: updates
			})

		const row = await getOrCreate(userId)
		const res = {
			setup: {
				ragStepComplete: row.ragStepComplete
			}
		}
		emitToUser("setup:markComplete", res)
		return res
	}
}

export function registerSetupHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, setupGet, emitToUser)
	register(socket, setupMarkComplete, emitToUser)
}
