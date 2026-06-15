package pub.serene.app

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File

class NodeService : Service() {
    private var nodeProcess: Process? = null

    companion object {
        const val CHANNEL_ID = "serene_pub_service"
        const val NOTIFICATION_ID = 1
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val dataDir = intent?.getStringExtra("dataDir") ?: filesDir.path

        // Start foreground service
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Start Node.js server
        startNodeServer(dataDir)

        return START_STICKY
    }

    private fun startNodeServer(dataDir: String) {
        try {
            val nodeBinary = File(dataDir, "node")
            val appMain = File(dataDir, "build/index.js")

            if (!nodeBinary.exists() || !appMain.exists()) {
                throw Exception("Node binary or app not found")
            }

            val processBuilder = ProcessBuilder()
                .command(nodeBinary.absolutePath, appMain.absolutePath)
                .directory(File(dataDir))
                .redirectErrorStream(true)

            // Set environment variables
            val env = processBuilder.environment()
            env["NODE_ENV"] = "production"
            env["PORT"] = "3000"
            env["SERENE_PUB_DATA_DIR"] = dataDir

            nodeProcess = processBuilder.start()

            // Log output for debugging (optional)
            Thread {
                nodeProcess?.inputStream?.bufferedReader()?.useLines { lines ->
                    lines.forEach { line ->
                        android.util.Log.d("NodeJS", line)
                    }
                }
            }.start()

        } catch (e: Exception) {
            android.util.Log.e("NodeService", "Failed to start Node.js", e)
        }
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
        nodeProcess?.destroy()
        nodeProcess = null
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
