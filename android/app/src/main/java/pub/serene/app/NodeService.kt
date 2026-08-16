package pub.serene.app

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class NodeService : Service() {
    // node::Start() (see NodeBridge/node-bridge.cpp) runs Node in-process —
    // unlike the old spawned-subprocess model, it cannot safely be invoked a
    // second time within the same OS process (global V8/libuv init state).
    // This guards against a duplicate service (re)start ever attempting
    // that; the only supported way to restart Node is a full app-process
    // restart, which naturally gets a fresh process and resets this flag.
    // See MainActivity's recovery UI.
    private val nodeStarted = AtomicBoolean(false)

    companion object {
        const val CHANNEL_ID = "serene_pub_service"
        const val NOTIFICATION_ID = 1
        const val ACTION_NODE_PROCESS_DIED = "pub.serene.app.NODE_PROCESS_DIED"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val dataDir = intent?.getStringExtra("dataDir") ?: filesDir.path

        // startForeground() must be called within seconds of the service
        // starting, or Android kills it — do this first, synchronously, before
        // any of the (potentially slow) extraction/startup work below. This is
        // also why MainActivity calls startForegroundService() immediately in
        // onCreate() rather than after extraction finishes: Android's
        // background-foreground-service-launch restrictions can revoke a
        // process's eligibility to start a NEW foreground service if too much
        // time passes first ("startForegroundService() not allowed due to
        // mAllowStartForeground false") — starting it right away sidesteps that
        // entirely, and extraction/Node startup happen after, in the background,
        // now that the service itself is already safely running.
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)

        Thread {
            // The marker stores the versionCode it was extracted from, not just
            // whether extraction ever happened — a plain boolean marker would
            // permanently skip re-extraction after the very first install,
            // silently serving stale bundled assets (JS, migrations, this
            // polyfill, etc.) forever across app updates, since `adb install -r`
            // and the Play Store both preserve app-private storage across
            // updates rather than wiping it.
            val extractedMarker = File(filesDir, ".serene-extracted")
            val currentVersionCode = try {
                val info = packageManager.getPackageInfo(packageName, 0)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    info.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    info.versionCode.toLong()
                }
            } catch (e: Exception) {
                -1L
            }
            val extractedVersionCode = if (extractedMarker.exists()) {
                extractedMarker.readText().trim().toLongOrNull()
            } else {
                null
            }
            // Even when the version matches, don't trust the marker blindly —
            // re-check that the entrypoint extraction is actually supposed to
            // produce still exists. Without this, a marker written after a
            // previously incomplete/broken extraction (e.g. copying from a
            // missing or stale source directory, which silently no-ops rather
            // than throwing) would wedge the app in that broken state forever,
            // since nothing else would ever prompt another extraction attempt
            // at the same versionCode.
            val entrypointMissing = !File(filesDir, "build/index.js").exists()

            val ready = if (extractedVersionCode != currentVersionCode || entrypointMissing) {
                val success = extractAssets()
                if (success) extractedMarker.writeText(currentVersionCode.toString())
                success
            } else {
                true
            }

            if (ready) {
                startNodeServer(dataDir)
            } else {
                sendBroadcast(Intent(ACTION_NODE_PROCESS_DIED).setPackage(packageName))
            }
        }.start()

        return START_STICKY
    }

    /**
     * Extracts the app bundle (SvelteKit build, node_modules, static files,
     * drizzle migrations) from assets/ into app-private storage. Node itself
     * is NOT part of this — it's embedded in-process via NodeBridge/
     * node-bridge.cpp (a native library, System.loadLibrary()'d, never
     * extracted or exec'd as a standalone file).
     *
     * Deletes each top-level bundled entry's previous copy first, so a
     * version upgrade can't leave stale files behind (e.g. a JS chunk that
     * no longer exists in the new bundle) sitting alongside the fresh ones —
     * only files that are also present under assets/serene-pub/ are touched,
     * never app-private data like the PGlite database under filesDir/data.
     */
    private fun extractAssets(): Boolean {
        return try {
            val files = assets.list("serene-pub") ?: arrayOf()
            for (filename in files) {
                File(filesDir, filename).deleteRecursively()
                copyAssetFolder("serene-pub/$filename", filesDir.path)
            }
            // copyAssetFolder doesn't throw on a source with zero entries (e.g.
            // an empty or missing "build" asset directory), so a broken APK
            // build could otherwise "succeed" here having copied nothing of
            // substance — verify the one file that actually matters instead
            // of trusting the copy loop's completion alone.
            val entrypointExists = File(filesDir, "build/index.js").exists()
            if (!entrypointExists) {
                android.util.Log.e(
                    "NodeService",
                    "Asset extraction completed but build/index.js is missing — bundled APK assets are incomplete"
                )
            }
            entrypointExists
        } catch (e: Exception) {
            android.util.Log.e("NodeService", "Asset extraction failed", e)
            false
        }
    }

    private fun copyAssetFolder(srcPath: String, destPath: String) {
        val files = assets.list(srcPath)

        if (files.isNullOrEmpty()) {
            copyAssetFile(srcPath, destPath)
        } else {
            val destFolder = File(destPath, srcPath.substringAfterLast("/"))
            if (!destFolder.exists()) {
                destFolder.mkdirs()
            }
            for (file in files) {
                copyAssetFolder("$srcPath/$file", destFolder.path)
            }
        }
    }

    private fun copyAssetFile(srcPath: String, destPath: String) {
        val inputStream = assets.open(srcPath)
        val fileName = srcPath.substringAfterLast("/")
        val outFile = File(destPath, fileName)

        outFile.parentFile?.mkdirs()
        val outputStream = FileOutputStream(outFile)

        inputStream.copyTo(outputStream)
        inputStream.close()
        outputStream.close()
    }

    private fun startNodeServer(dataDir: String) {
        if (!nodeStarted.compareAndSet(false, true)) {
            android.util.Log.w(
                "NodeService",
                "startNodeServer() called again in the same process — ignoring " +
                    "(node::Start() cannot safely run twice in one process)"
            )
            return
        }

        val appMain = File(dataDir, "build/index.js")
        val intlPolyfill = File(dataDir, "android-intl-polyfill.cjs")
        if (!appMain.exists()) {
            android.util.Log.e("NodeService", "App entrypoint not found: ${appMain.absolutePath}")
            sendBroadcast(Intent(ACTION_NODE_PROCESS_DIED).setPackage(packageName))
            return
        }

        // argv[0] is conventionally the program name — Node never touches the
        // filesystem for it, it's just what process.argv[0] reports. --require
        // preloads the Intl polyfill (see android-intl-polyfill.cjs) before the
        // main script runs, since nodejs-mobile's Android Node build has no
        // Intl global at all.
        val arguments = arrayOf("node", "--require", intlPolyfill.absolutePath, appMain.absolutePath)
        val envVars = arrayOf(
            "NODE_ENV=production",
            "PORT=3000",
            "SERENE_PUB_DATA_DIR=$dataDir",
            // Lets the server know it's running inside this wrapper, so it can hide
            // features that don't make sense here (managed local model runners that
            // need a binary we don't/can't bundle, on-device embedding models, etc.)
            "SERENE_PUB_PLATFORM=android",
            // The WebView only ever needs to reach this same device — bind both the
            // main app server and the socket server to loopback only, not 0.0.0.0
            // (the default), so this phone doesn't expose an unauthenticated HTTP +
            // WebSocket server to the rest of whatever Wi-Fi network it's on.
            "HOST=127.0.0.1",
            // Server startup normally shells out to xdg-open/open/start to launch
            // a system browser tab — meaningless here (the WebView already shows
            // the page) and fatal: there's no xdg-open binary on Android, and the
            // resulting ENOENT is an unhandled child_process 'error' event, which
            // crashes the whole in-process Node runtime. Same convention Docker
            // already uses (see DOCKER.md) to disable this, despite the confusing
            // name — "1" means "disable", not "enable".
            "SERENE_AUTO_OPEN=1"
        )

        Thread {
            // node::Start() runs Node's event loop in-process and BLOCKS this
            // thread until that loop exits — a clean shutdown, an uncaught
            // exception, or the process being torn down all surface as this
            // call returning, so a return (of any exit code) is treated the
            // same as the old subprocess model treated process.waitFor().
            val exitCode = try {
                NodeBridge.startNodeWithArguments(arguments, envVars)
            } catch (e: Throwable) {
                android.util.Log.e("NodeService", "Node runtime crashed", e)
                -1
            }
            android.util.Log.w("NodeService", "Node event loop exited with code $exitCode")
            sendBroadcast(Intent(ACTION_NODE_PROCESS_DIED).setPackage(packageName))
        }.start()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Serene Pub Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps Serene Pub running in the background"
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Serene Pub")
            .setContentText("Server running")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        // There's no clean way to stop an in-process node::Start() call from
        // the outside (no Process/waitFor() to signal) — Android tearing
        // down this Service's process on app exit is what actually stops
        // Node. This mirrors nodejs-mobile's own stance: Node is started
        // once per process lifetime and torn down with the process.
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
