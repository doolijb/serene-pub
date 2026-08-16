import { tokens } from "$lib/server/auth"

export async function generateLocalToken({
	payload,
	expiresIn
}: {
	payload: Record<string, unknown>
	expiresIn?: string
}): Promise<string> {
	return await tokens.paseto.encrypt(payload, tokens.secretKey, {
		expiresIn
	})
}
