/**
 * What Admin › Users says about accounts, pure so it is tested
 * (`usersAdmin.test.ts`): the role words, and what deleting accounts does.
 *
 * Deleting an account is a **deactivation** (`users:delete` marks the row
 * deleted, revokes its sign-in tokens and closes its open sockets); what the
 * person made stays on the instance. Your own account is kept — the server
 * refuses it.
 */
import { deletionFor, type AdminDeletion } from "$lib/client/components/admin/changelist"

type User = Pick<SelectUser, "id" | "username" | "displayName" | "isAdmin">

export const USER_NOUN = { singular: "user", plural: "users" }

export function roleWord(u: Pick<SelectUser, "isAdmin">): string {
	return u.isAdmin ? "Administrator" : "Member"
}

export function userDeletion(rows: readonly User[], selfId: number | null | undefined): AdminDeletion {
	return deletionFor(rows, {
		noun: USER_NOUN,
		label: (u) => u.username,
		protect: (u) => (u.id === selfId ? "you cannot delete your own account" : null),
		related: (u) => [
			{
				label: "Signed out",
				items: ["every device it is signed in on"]
			},
			...(u.isAdmin ? [{ label: "Loses", items: ["administrator rights"] }] : [])
		],
		consequence: (going) =>
			`${going.length === 1 ? "The account" : "The accounts"} can no longer sign in; what ${going.length === 1 ? "it" : "they"} made stays on the pub`
	})
}

/** Three words, three digits and a symbol: easy to read aloud, passes the rule. */
export function randomPassphrase(rand: () => number = Math.random): string {
	const words = [
		"Apple", "Banana", "Cherry", "Dragon", "Eagle", "Forest", "Galaxy", "Harbor",
		"Island", "Jungle", "Knight", "Lotus", "Mountain", "Nebula", "Ocean", "Phoenix",
		"Quartz", "River", "Shadow", "Thunder", "Unicorn", "Valley", "Wizard", "Zenith"
	]
	const pick = () => words[Math.floor(rand() * words.length)]
	const digits = Math.floor(rand() * 900) + 100
	const special = "!@#$%^&*"[Math.floor(rand() * 8)]
	return `${pick()}-${pick()}-${pick()}${digits}${special}`
}
