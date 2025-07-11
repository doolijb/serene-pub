import { db } from "$lib/server/db"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export async function user(socket: any, message: Sockets.User.Call, emitToUser: (event: string, data: any) => void) {
    const userId = 1 // Replace with actual user id
    const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, userId),
        with: {
            activeConnection: true,
            activeSamplingConfig: true,
            activeContextConfig: true,
            activePromptConfig: true
        }
    })
    socket.server.to("user_" + userId).emit("user", { user })
}

const getUser = user

export async function setTheme(socket: any, message: Sockets.SetTheme.Call, emitToUser: (event: string, data: any) => void) {
    const userId = 1 // Replace with actual user id
    const { theme, darkMode } = message

    if (!theme) {
        console.error("[setTheme] No theme provided")
        return
    }

    await db.update(schema.users)
        .set({ theme, darkMode })
        .where(eq(schema.users.id, userId))

    const res: Sockets.SetTheme.Response = {}
    emitToUser("setTheme", res)
    await getUser(socket, {}, emitToUser)
}