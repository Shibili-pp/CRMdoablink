package com.doablink.orbit.shell

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

class AppActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var progress: ProgressBar
    private lateinit var offline: LinearLayout
    private lateinit var assetLoader: WebViewAssetLoader
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var documentStart = false
    private var prompting = false
    private var askedThisStart = false
    private var registerAttempted = false
    private var lastSeen = ""
    private val chunks = HashMap<String, Array<String?>>()
    private val watcher = Handler(Looper.getMainLooper())
    private val watchTick = object : Runnable {
        override fun run() {
            if (isFinishing || !::webView.isInitialized) return
            webView.evaluateJavascript("(function(){try{return sessionStorage.getItem('orbit_access')||''}catch(e){return ''}})()") { raw ->
                handleSession(jsString(raw))
            }
            watcher.postDelayed(this, 2000)
        }
    }

    private val files = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback
        fileCallback = null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        prompting = false
        val callLog = granted[Manifest.permission.READ_CALL_LOG] == true
        val contacts = granted[Manifest.permission.READ_CONTACTS] == true
        PhoneLink.prefs(this).edit().putBoolean("callLogGranted", callLog).putBoolean("contactsSync", contacts).apply()
        if (!callLog) {
            toast("Call history was not allowed. Calling Analytics cannot read this phone until you allow it.")
            return@registerForActivityResult
        }
        val access = PhoneLink.prefs(this).getString("webAccess", null)
        if (access.isNullOrBlank()) {
            toast("Call history is allowed. Sign in and this phone will sync.")
            return@registerForActivityResult
        }
        if (PhoneLink.prefs(this).getString("deviceToken", null).isNullOrBlank()) connect(access, contacts)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PhoneLink.ensureApi(this)
        webView = WebView(this)
        swipe = SwipeRefreshLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            setOnRefreshListener {
                webView.evaluateJavascript("(function(){try{return !!document.querySelector('.alert-lock,.hour-lock')}catch(e){return false}})()") { raw ->
                    if (raw == "true") {
                        isRefreshing = false
                    } else {
                        webView.reload()
                    }
                }
            }
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
        }
        offline = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 72, 48, 48)
            visibility = View.GONE
            setBackgroundColor(0xFFF6F8FB.toInt())
            addView(TextView(this@AppActivity).apply {
                text = "DoablinkOrbit could not be opened. Check the internet connection and try again."
                textSize = 16f
            })
            addView(Button(this@AppActivity).apply {
                text = "Try again"
                setOnClickListener {
                    visibility = View.GONE
                    swipe.visibility = View.VISIBLE
                    webView.loadUrl(PhoneLink.WEB)
                }
            })
        }
        val root = FrameLayout(this).apply {
            addView(swipe, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            addView(progress, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 12))
            addView(offline, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        setContentView(root)
        prepareWeb()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
        if (!PhoneLink.prefs(this).getString("deviceToken", null).isNullOrBlank()) PhoneLink.showPhoneSettings(this)
        webView.loadUrl(PhoneLink.WEB)
    }

    override fun onResume() {
        super.onResume()
        if (!askedThisStart) {
            askedThisStart = true
            window.decorView.post { ensureCallLogPermission() }
        }
        watcher.removeCallbacks(watchTick)
        watcher.post(watchTick)
    }

    override fun onPause() {
        watcher.removeCallbacks(watchTick)
        CookieManager.getInstance().flush()
        super.onPause()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun prepareWeb() {
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(PhoneLink.HOST)
            .addPathHandler("/", SpaAssetsHandler())
            .build()
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        webView.setBackgroundColor(0xFFF6F8FB.toInt())
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = true
            allowFileAccess = false
            allowContentAccess = true
            userAgentString = "$userAgentString DoablinkOrbitApp/0.3.3"
        }
        webView.addJavascriptInterface(Bridge(), "OrbitNative")
        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        webView.setDownloadListener { url, userAgent, contentDisposition, mime, _ ->
            val request = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mime)
                .addRequestHeader("User-Agent", userAgent)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, contentDisposition, mime))
            CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            toast("Downloading")
        }
        documentStart = try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(webView, PhoneLink.BOOT, setOf("${PhoneLink.WEB}*"))
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    private inner class SpaAssetsHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val relative = path.trimStart('/').substringBefore('?').substringBefore('#').ifBlank { "index.html" }
            val assetPath = "www/$relative"
            val stream = try {
                assets.open(assetPath)
            } catch (_: IOException) {
                if (relative.contains('.') && !relative.endsWith(".html")) return null
                try {
                    assets.open("www/index.html")
                } catch (_: IOException) {
                    return null
                }
            }
            val mime = when {
                assetPath.endsWith(".html") -> "text/html"
                assetPath.endsWith(".js") -> "text/javascript"
                assetPath.endsWith(".css") -> "text/css"
                assetPath.endsWith(".json") || assetPath.endsWith(".webmanifest") -> "application/json"
                assetPath.endsWith(".png") -> "image/png"
                assetPath.endsWith(".svg") -> "image/svg+xml"
                assetPath.endsWith(".woff2") -> "font/woff2"
                else -> "application/octet-stream"
            }
            return WebResourceResponse(mime, "UTF-8", stream)
        }
    }

    private fun showOffline() {
        swipe.isRefreshing = false
        progress.visibility = View.GONE
        swipe.visibility = View.GONE
        offline.visibility = View.VISIBLE
    }

    private fun handleSession(token: String) {
        val clean = token.trim()
        val prefs = PhoneLink.prefs(this)
        if (clean.isEmpty()) {
            if (lastSeen.isNotEmpty()) prefs.edit().remove("webAccess").apply()
            lastSeen = ""
            return
        }
        prefs.edit().putString("webAccess", clean).apply()
        val sub = PhoneLink.subject(clean)
        val linked = prefs.getString("linkedSub", null)
        val hasDevice = !prefs.getString("deviceToken", null).isNullOrBlank()
        val callGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED
        if (!callGranted) {
            lastSeen = clean
            if (!prompting) ensureCallLogPermission()
            return
        }
        if (hasDevice && linked != null && sub != null && linked != sub) {
            if (clean != lastSeen && !prompting) offerSwitch(clean)
            lastSeen = clean
            return
        }
        lastSeen = clean
        if (hasDevice) {
            if (linked == null && sub != null) prefs.edit().putString("linkedSub", sub).apply()
            return
        }
        if (!registerAttempted && !prompting) {
            registerAttempted = true
            connect(clean, ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED)
        }
    }

    private fun ensureCallLogPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) return
        if (prompting) return
        val asked = PhoneLink.prefs(this).getBoolean("permissionAsked", false)
        if (asked && !shouldShowRequestPermissionRationale(Manifest.permission.READ_CALL_LOG)) {
            prompting = true
            AlertDialog.Builder(this)
                .setTitle("Allow call history")
                .setMessage("Calling Analytics needs this phone's call history. Open settings and allow Call logs, Contacts and Notifications.")
                .setPositiveButton("Open settings") { _, _ ->
                    prompting = false
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }
                .setNegativeButton("Not now") { _, _ -> prompting = false }
                .setOnCancelListener { prompting = false }
                .show()
            return
        }
        prompting = true
        PhoneLink.prefs(this).edit().putBoolean("permissionAsked", true).apply()
        askPermissions()
    }

    private fun jsString(raw: String?): String {
        if (raw.isNullOrBlank() || raw == "null") return ""
        return try {
            org.json.JSONArray("[$raw]").getString(0)
        } catch (_: Exception) {
            ""
        }
    }

    private fun offerSwitch(access: String) {
        prompting = true
        AlertDialog.Builder(this)
            .setTitle("Connect this login")
            .setMessage("This phone is still syncing call history for the previous employee. Connect it to the account you just opened?")
            .setPositiveButton("Connect") { _, _ ->
                prompting = false
                connect(access, PhoneLink.prefs(this).getBoolean("contactsSync", false))
            }
            .setNegativeButton("Keep the previous phone") { _, _ -> prompting = false }
            .setOnCancelListener { prompting = false }
            .show()
    }

    private fun askPermissions() {
        val requested = mutableListOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33) requested.add(Manifest.permission.POST_NOTIFICATIONS)
        permissions.launch(requested.toTypedArray())
    }

    private fun connect(access: String, contacts: Boolean) {
        prompting = true
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { PhoneLink.register(this@AppActivity, access, true, contacts) }
                toast("Call history will sync to Calling Analytics")
            } catch (error: Exception) {
                toast(error.message ?: "This phone could not connect call history")
            } finally {
                prompting = false
            }
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            toast("This link could not be opened")
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            return assetLoader.shouldInterceptRequest(request.url)
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            progress.visibility = View.VISIBLE
            if (!documentStart && url.contains(PhoneLink.HOST)) {
                view.evaluateJavascript(PhoneLink.BOOT, null)
            }
        }

        override fun onPageFinished(view: WebView, url: String) {
            swipe.isRefreshing = false
            progress.visibility = View.GONE
            offline.visibility = View.GONE
            swipe.visibility = View.VISIBLE
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme?.lowercase().orEmpty()
            if (scheme == "tel") {
                try {
                    startActivity(Intent(Intent.ACTION_DIAL, uri))
                } catch (_: Exception) {
                    toast("The phone dialer could not be opened")
                }
                return true
            }
            if (scheme == "mailto" || scheme == "sms" || scheme == "smsto") {
                openExternal(uri)
                return true
            }
            if (scheme == "intent") {
                try {
                    startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME))
                } catch (_: Exception) {
                    toast("This link could not be opened")
                }
                return true
            }
            if (scheme == "http" || scheme == "https") {
                val host = uri.host?.lowercase().orEmpty()
                if (host == PhoneLink.HOST || host.endsWith("googleapis.com") || host.endsWith("gstatic.com")) return false
                openExternal(uri)
                return true
            }
            return false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showOffline()
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            // Bundled SPA assets are served locally; ignore HTTP errors from the live host.
            if (request.isForMainFrame && request.url.host != PhoneLink.HOST && errorResponse.statusCode >= 400) {
                showOffline()
            }
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                files.launch(params.createIntent())
                true
            } catch (_: Exception) {
                fileCallback = null
                callback.onReceiveValue(null)
                toast("No app can choose this file")
                true
            }
        }
    }

    private inner class Bridge {
        @android.webkit.JavascriptInterface
        fun savedAccess(): String {
            val host = runCatching { Uri.parse(webView.url ?: "").host }.getOrNull()
            if (!host.isNullOrBlank() && host != PhoneLink.HOST) return ""
            return PhoneLink.prefs(this@AppActivity).getString("webAccess", "") ?: ""
        }

        @android.webkit.JavascriptInterface
        fun onSession(token: String) {
            runOnUiThread { handleSession(token) }
        }

        @android.webkit.JavascriptInterface
        fun shareText(text: String) {
            runOnUiThread {
                try {
                    Share.text(this@AppActivity, text)
                } catch (error: Exception) {
                    toast(error.message ?: "WhatsApp could not be opened")
                }
            }
        }

        @android.webkit.JavascriptInterface
        fun shareFile(name: String, dataUrl: String) {
            runOnUiThread {
                try {
                    Share.file(this@AppActivity, name, dataUrl)
                } catch (error: Exception) {
                    toast(error.message ?: "The Excel file could not be shared")
                }
            }
        }

        @android.webkit.JavascriptInterface
        fun downloadChunk(id: String, name: String, index: Int, total: Int, part: String) {
            if (total <= 0 || total > 80 || index < 0 || index >= total) return
            val full = synchronized(chunks) {
                val bucket = chunks.getOrPut(id) { arrayOfNulls(total) }
                if (bucket.size != total) return
                bucket[index] = part
                if (bucket.any { it == null }) return
                chunks.remove(id)
                bucket.joinToString("")
            }
            try {
                val saved = Downloads.save(this@AppActivity, name, full)
                runOnUiThread { toast("Saved $saved to Downloads") }
            } catch (error: Exception) {
                runOnUiThread { toast(error.message ?: "The file could not be saved") }
            }
        }
    }
}
