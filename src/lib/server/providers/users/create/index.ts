import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"

/**
 * Creates a new user.
 * @param tx - The database transaction. Defaults to `db`.
 * @param username - The username of the new user.
 * @param isAdmin - Whether the new user is an admin. Defaults to `false`.
 * @returns The created user.
 */
export async function create({
	tx = db,
	username,
	isAdmin = false
}: {
	tx?: typeof db
	username: string
	isAdmin?: boolean
}) {
	// Create user
	const [createdUser] = await tx
		.insert(schema.users)
		.values({
			username,
			isAdmin
		})
		.returning()

	return createdUser
}
