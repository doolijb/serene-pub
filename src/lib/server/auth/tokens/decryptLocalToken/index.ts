import { paseto, secretKey } from "../index.js"

export async function decryptLocalToken({
	token
}: {
	token: string
}): Promise<Record<string, unknown>> {
	return await paseto.decrypt(token, secretKey)
}
