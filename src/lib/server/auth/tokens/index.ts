import crypto from "crypto"
import { getCryptoSecretKey } from "$lib/server/db"

export { V3 as paseto } from "paseto"
export * from "./decryptLocalToken"
export * from "./generateLocalToken"

export const secretKey = crypto
	.createHash("sha256")
	.update(getCryptoSecretKey())
	.digest("base64")
	.slice(0, 32)
