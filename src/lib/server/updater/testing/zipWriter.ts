/**
 * Test-only: build a stored (uncompressed) zip byte for byte, with exactly
 * the names, Unix modes and symlinks a test asks for — including the hostile
 * ones a real archiver would refuse to write.
 */
import zlib from "node:zlib"

export interface ZipEntrySpec {
	name: string
	/** File content, or a symlink's target. Omit for a directory. */
	data?: string | Buffer
	/** Full Unix mode including the type bits; defaults by kind. */
	mode?: number
	/** Write no Unix attributes at all (an archive made on Windows). */
	dos?: boolean
}

export const MODE_FILE = 0o100644
export const MODE_EXEC = 0o100755
export const MODE_DIR = 0o040755
export const MODE_LINK = 0o120777

export function buildZip(entries: ZipEntrySpec[]): Buffer {
	const locals: Buffer[] = []
	const centrals: Buffer[] = []
	let offset = 0
	for (const e of entries) {
		const name = Buffer.from(e.name, "utf8")
		const data = e.data === undefined ? Buffer.alloc(0) : Buffer.from(e.data)
		const crc = zlib.crc32(data) >>> 0
		const isDir = e.data === undefined
		const mode = e.mode ?? (isDir ? MODE_DIR : MODE_FILE)

		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0x0800, 6) // UTF-8 names
		local.writeUInt16LE(0, 8)
		local.writeUInt16LE(0, 10)
		local.writeUInt16LE(0x21, 12)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(data.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(name.length, 26)
		local.writeUInt16LE(0, 28)
		locals.push(local, name, data)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(e.dos ? 20 : (3 << 8) | 20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0x0800, 8)
		central.writeUInt16LE(0, 10)
		central.writeUInt16LE(0, 12)
		central.writeUInt16LE(0x21, 14)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(data.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(name.length, 28)
		central.writeUInt16LE(0, 30)
		central.writeUInt16LE(0, 32)
		central.writeUInt16LE(0, 34)
		central.writeUInt16LE(0, 36)
		central.writeUInt32LE(e.dos ? (isDir ? 0x10 : 0) : ((mode << 16) >>> 0), 38)
		central.writeUInt32LE(offset, 42)
		centrals.push(central, name)

		offset += local.length + name.length + data.length
	}
	const cd = Buffer.concat(centrals)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(entries.length, 8)
	end.writeUInt16LE(entries.length, 10)
	end.writeUInt32LE(cd.length, 12)
	end.writeUInt32LE(offset, 16)
	return Buffer.concat([...locals, cd, end])
}
