#!/usr/bin/env node

/**
 * Build script for Android APK
 * Prepares Serene Pub bundle and packages it into Android assets
 */

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootDir = path.resolve(__dirname, "..")
const androidDir = path.join(rootDir, "android")
const assetsDir = path.join(androidDir, "app/src/main/assets/serene-pub")
const buildDir = path.join(rootDir, "build")
const nodeModulesDir = path.join(rootDir, "node_modules")
const staticDir = path.join(rootDir, "static")
const drizzleDir = path.join(rootDir, "drizzle")

console.log("🤖 Building Serene Pub for Android...")

// 1. Clean assets directory
if (fs.existsSync(assetsDir)) {
    console.log("Cleaning assets directory...")
    fs.rmSync(assetsDir, { recursive: true, force: true })
}
fs.mkdirSync(assetsDir, { recursive: true })

// 2. Copy build output
console.log("Copying build files...")
copyRecursive(buildDir, path.join(assetsDir, "build"))

// 3. Copy node_modules (production only)
console.log("Copying node_modules...")
copyRecursive(nodeModulesDir, path.join(assetsDir, "node_modules"))

// 4. Copy static assets
console.log("Copying static files...")
copyRecursive(staticDir, path.join(assetsDir, "static"))

// 5. Copy drizzle migrations
console.log("Copying database migrations...")
copyRecursive(drizzleDir, path.join(assetsDir, "drizzle"))

// 6. Download and copy Node.js binary for Android ARM64
console.log("Downloading Node.js binary for Android ARM64...")
const nodeVersion = "v20.13.1"
const nodeUrl = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-linux-arm64.tar.xz`
const tempDir = path.join(rootDir, "temp-node-android")

if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
}

try {
    // Download Node.js
    execSync(`curl -L -o ${tempDir}/node.tar.xz ${nodeUrl}`, { stdio: "inherit" })
    
    // Extract
    execSync(`tar -xf ${tempDir}/node.tar.xz -C ${tempDir}`, { stdio: "inherit" })
    
    // Copy binary
    const nodeBinaryPath = path.join(tempDir, `node-${nodeVersion}-linux-arm64/bin/node`)
    fs.copyFileSync(nodeBinaryPath, path.join(assetsDir, "node"))
    
    // Make executable
    fs.chmodSync(path.join(assetsDir, "node"), 0o755)
    
    console.log("✅ Node.js binary copied")
} catch (error) {
    console.error("Error downloading Node.js:", error)
    process.exit(1)
} finally {
    // Cleanup
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
    }
}

// 7. Create package.json for runtime
const runtimePackage = {
    type: "module",
    name: "serene-pub-android",
    version: "0.5.0",
    private: true
}
fs.writeFileSync(
    path.join(assetsDir, "package.json"),
    JSON.stringify(runtimePackage, null, 2)
)

console.log("\n✅ Assets prepared successfully!")
console.log("\nNext steps:")
console.log("  cd android")
console.log("  ./gradlew assembleRelease")
console.log("\nOr for debug:")
console.log("  ./gradlew assembleDebug")

// Helper function
function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`Warning: ${src} does not exist, skipping...`)
        return
    }

    const stats = fs.statSync(src)
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true })
        }
        const entries = fs.readdirSync(src, { withFileTypes: true })
        for (const entry of entries) {
            copyRecursive(
                path.join(src, entry.name),
                path.join(dest, entry.name)
            )
        }
    } else {
        fs.copyFileSync(src, dest)
    }
}
