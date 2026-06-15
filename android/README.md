# Android Build

## Keystore Setup for GitHub Actions

To enable signed APK builds in GitHub Actions, you need to set up the following secrets:

### 1. Generate a Keystore (one-time setup)

```bash
keytool -genkey -v -keystore release.keystore \
  -alias serene-pub \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass YourStorePassword \
  -keypass YourKeyPassword
```

Answer the prompts for your organization details.

### 2. Encode the Keystore to Base64

```bash
base64 -w 0 release.keystore > release.keystore.base64
```

### 3. Add Secrets to GitHub

Go to your repository settings → Secrets and variables → Actions → New repository secret

Add these secrets:

- **`ANDROID_KEYSTORE_BASE64`**: Paste the contents of `release.keystore.base64`
- **`ANDROID_KEYSTORE_PASSWORD`**: Your store password from step 1
- **`ANDROID_KEY_ALIAS`**: `serene-pub` (or whatever you used)
- **`ANDROID_KEY_PASSWORD`**: Your key password from step 1

### 4. Cleanup

```bash
rm release.keystore release.keystore.base64
```

**IMPORTANT:** Never commit the keystore files to git!

## Building Locally

### Prerequisites

- Node.js 20+
- Java JDK 17+

### Setup (first time only)

```bash
npm run android:setup
```

### Build Debug APK

```bash
# Build app first
npm run build

# Prepare Android assets
npm run android:prepare

# Build debug APK (no signing needed)
npm run android:build:debug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Build Release APK

For signed release builds, you need a keystore. Place `release.keystore` in `android/app/` and export environment variables:

```bash
export KEYSTORE_FILE=release.keystore
export KEYSTORE_PASSWORD=YourStorePassword
export KEY_ALIAS=serene-pub
export KEY_PASSWORD=YourKeyPassword

npm run android:full
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

### Full Build Command

```bash
npm run android:full
```

This runs: build → android:prepare → android:build

## Testing the APK

### Install on Device

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### View Logs

```bash
# View all logs
adb logcat

# Filter Node.js logs
adb logcat | grep NodeJS

# Filter app logs
adb logcat | grep "pub.serene"
```

## Architecture

The Android app:

1. **MainActivity.kt**: WebView wrapper, manages server lifecycle
2. **NodeService.kt**: Foreground service running Node.js process
3. **Assets**: Contains your entire Serene Pub build (node binary, app code, dependencies)

On first launch:
- Extracts all assets to app data directory (~500MB)
- Starts Node.js server on localhost:3000
- Opens WebView to localhost

## File Sizes

- APK size: ~80-100MB (compressed)
- Installed size: ~500MB
  - Node.js binary: ~40MB
  - node_modules: ~300MB
  - App code: ~50MB
  - Data/cache: grows with use

## Permissions

Required permissions (defined in AndroidManifest.xml):

- `INTERNET`: Network access
- `FOREGROUND_SERVICE`: Keep Node.js running
- `WAKE_LOCK`: Prevent CPU sleep during operations
- `CAMERA`: For character avatar uploads (optional)
- `READ/WRITE_EXTERNAL_STORAGE`: For file access on older Android versions

## Known Limitations

- Large app size due to Node.js + dependencies
- First launch is slow (asset extraction)
- Battery drain from Node.js process
- Minimum Android 8.0 (API 26) required
- ARM64 only (no x86/ARM32 support yet)

## Troubleshooting

### Gradle build fails

```bash
cd android
./gradlew clean
./gradlew assembleDebug --info
```

### App crashes on startup

Check logs: `adb logcat | grep "pub.serene"`

Common issues:
- Node binary not executable
- Assets not extracted properly
- Port 3000 already in use

### Server won't start

The app shows "Server startup timeout" if Node.js doesn't start within 30 seconds. Check:
- Logcat for error messages
- Available storage space
- Node.js binary exists at `/data/data/pub.serene.app/files/node`

## Adding to GitHub Release

The workflow automatically:

1. Builds the APK when you push a version tag
2. Signs it with your keystore (if configured)
3. Uploads to the GitHub release

Just push a tag:

```bash
git tag v0.5.0
git push origin v0.5.0
```

The APK will appear in the release as `serene-pub-0.5.0-android.apk`
