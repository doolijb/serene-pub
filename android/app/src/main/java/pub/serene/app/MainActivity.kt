package pub.serene.app

import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var serverCheckJob: Job? = null

    companion object {
        const val SERVER_URL = "http://localhost:3000"
        const val MAX_WAIT_TIME = 30000L // 30 seconds
        const val CHECK_INTERVAL = 500L // 500ms
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Setup WebView
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            allowContentAccess = true
        }
        
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                view.loadUrl(url)
                return true
            }
        }
        
        setContentView(webView)

        // Extract assets on first run
        val extractedMarker = File(filesDir, ".serene-extracted")
        if (!extractedMarker.exists()) {
            Toast.makeText(this, "Setting up Serene Pub...", Toast.LENGTH_LONG).show()
            extractAssets()
            extractedMarker.createNewFile()
        }

        // Start Node.js service
        startNodeService()

        // Wait for server to be ready
        waitForServerAndLoad()
    }

    private fun extractAssets() {
        try {
            val assetManager = assets
            val files = assetManager.list("serene-pub") ?: arrayOf()
            
            for (filename in files) {
                copyAssetFolder("serene-pub/$filename", filesDir.path)
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Error setting up: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun copyAssetFolder(srcPath: String, destPath: String) {
        try {
            val assetManager = assets
            val files = assetManager.list(srcPath)

            if (files.isNullOrEmpty()) {
                // It's a file, copy it
                copyAssetFile(srcPath, destPath)
            } else {
                // It's a folder, create it and copy contents
                val destFolder = File(destPath, srcPath.substringAfterLast("/"))
                if (!destFolder.exists()) {
                    destFolder.mkdirs()
                }
                for (file in files) {
                    copyAssetFolder("$srcPath/$file", destFolder.path)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun copyAssetFile(srcPath: String, destPath: String) {
        try {
            val inputStream = assets.open(srcPath)
            val fileName = srcPath.substringAfterLast("/")
            val outFile = File(destPath, fileName)
            
            outFile.parentFile?.mkdirs()
            val outputStream = FileOutputStream(outFile)

            inputStream.copyTo(outputStream)
            inputStream.close()
            outputStream.close()

            // Make node binary executable
            if (fileName == "node") {
                outFile.setExecutable(true)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startNodeService() {
        val intent = Intent(this, NodeService::class.java)
        intent.putExtra("dataDir", filesDir.path)
        startForegroundService(intent)
    }

    private fun waitForServerAndLoad() {
        var elapsedTime = 0L
        
        serverCheckJob = CoroutineScope(Dispatchers.IO).launch {
            while (elapsedTime < MAX_WAIT_TIME) {
                if (isServerReady()) {
                    withContext(Dispatchers.Main) {
                        webView.loadUrl(SERVER_URL)
                        Toast.makeText(
                            this@MainActivity,
                            "Serene Pub ready!",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                    return@launch
                }
                delay(CHECK_INTERVAL)
                elapsedTime += CHECK_INTERVAL
            }
            
            // Timeout
            withContext(Dispatchers.Main) {
                Toast.makeText(
                    this@MainActivity,
                    "Server startup timeout. Please restart the app.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun isServerReady(): Boolean {
        return try {
            val url = URL(SERVER_URL)
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 1000
            connection.requestMethod = "GET"
            connection.connect()
            val responseCode = connection.responseCode
            connection.disconnect()
            responseCode in 200..399
        } catch (e: Exception) {
            false
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serverCheckJob?.cancel()
        stopService(Intent(this, NodeService::class.java))
    }
}
