package com.doablink.orbit.permissions

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.doablink.orbit.api.OrbitApi
import com.doablink.orbit.home.HomeActivity
import com.doablink.orbit.workers.OrbitSync
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class ConsentActivity : AppCompatActivity() {
    private lateinit var message: TextView
    private val request = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val callLog = granted[Manifest.permission.READ_CALL_LOG] == true
        val contacts = granted[Manifest.permission.READ_CONTACTS] == true
        register(callLog, contacts)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        message = TextView(this)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 72, 48, 48)
            addView(TextView(this@ConsentActivity).apply {
                text = "Allow call history"
                textSize = 24f
            })
            addView(TextView(this@ConsentActivity).apply {
                text = "DoablinkOrbit reads this phone's call log and sends the number, time and duration to your CRM. It does not upload call recordings. Contacts are sent only if you allow them."
                setPadding(0, 16, 0, 24)
            })
            addView(Button(this@ConsentActivity).apply {
                text = "Allow and connect"
                setOnClickListener { ask() }
            })
            addView(message)
        }
        setContentView(layout)
    }

    private fun ask() {
        val permissions = mutableListOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        request.launch(permissions.toTypedArray())
    }

    private fun register(callLog: Boolean, contacts: Boolean) {
        if (!callLog) {
            message.text = "Call history was not allowed. Calling reports cannot be sent until you allow it."
            return
        }
        val prefs = getSharedPreferences("orbit", MODE_PRIVATE)
        val base = prefs.getString("apiBase", null)
        val access = intent.getStringExtra("accessToken")
        if (base.isNullOrBlank() || access.isNullOrBlank()) {
            message.text = "Sign in again before connecting this phone."
            return
        }
        message.text = "Connecting this phone…"
        lifecycleScope.launch {
            try {
                val token = withContext(Dispatchers.IO) {
                    OrbitApi(base).registerDevice(access, deviceId(), callLog, contacts)
                }
                prefs.edit()
                    .putString("deviceToken", token)
                    .putBoolean("contactsSync", contacts)
                    .putBoolean("callLogGranted", true)
                    .apply()
                OrbitSync.schedule(this@ConsentActivity)
                OrbitSync.now(this@ConsentActivity)
                startActivity(Intent(this@ConsentActivity, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
            } catch (error: Exception) {
                message.text = error.message ?: "This phone could not be connected"
            }
        }
    }

    private fun deviceId(): String {
        val prefs = getSharedPreferences("orbit", MODE_PRIVATE)
        val saved = prefs.getString("deviceId", null)
        if (!saved.isNullOrBlank()) return saved
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
        val id = if (androidId.isNullOrBlank()) UUID.randomUUID().toString() else androidId
        prefs.edit().putString("deviceId", id).apply()
        return id
    }
}
