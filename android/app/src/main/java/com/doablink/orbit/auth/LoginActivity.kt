package com.doablink.orbit.auth

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.doablink.orbit.api.OrbitApi
import com.doablink.orbit.home.HomeActivity
import com.doablink.orbit.permissions.ConsentActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("orbit", MODE_PRIVATE)
        if (!prefs.getString("deviceToken", null).isNullOrBlank()) {
            startActivity(Intent(this, HomeActivity::class.java))
            finish()
            return
        }
        val server = EditText(this).apply {
            hint = "Server, for example https://crm.example.com/api/v1"
            setText(prefs.getString("apiBase", ""))
        }
        val username = EditText(this).apply { hint = "Username" }
        val password = EditText(this).apply {
            hint = "Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val message = TextView(this)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 72, 48, 48)
            addView(TextView(this@LoginActivity).apply {
                text = "DoablinkOrbit"
                textSize = 28f
            })
            addView(TextView(this@LoginActivity).apply {
                text = "Sign in with your staff account. This phone will send its call log to the CRM."
                setPadding(0, 12, 0, 24)
            })
            addView(server)
            addView(username)
            addView(password)
            addView(Button(this@LoginActivity).apply {
                text = "Sign in"
                setOnClickListener {
                    message.text = "Signing in…"
                    signIn(server.text.toString().trim(), username.text.toString().trim(), password.text.toString(), message)
                }
            })
            addView(message)
        }
        setContentView(layout)
    }

    private fun signIn(base: String, username: String, password: String, message: TextView) {
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            message.text = "Enter the server address, including http:// or https://"
            return
        }
        if (username.isBlank() || password.isBlank()) {
            message.text = "Enter the username and password"
            return
        }
        lifecycleScope.launch {
            try {
                val access = withContext(Dispatchers.IO) { OrbitApi(base).login(username, password) }
                getSharedPreferences("orbit", MODE_PRIVATE).edit().putString("apiBase", base.trimEnd('/')).apply()
                startActivity(Intent(this@LoginActivity, ConsentActivity::class.java).putExtra("accessToken", access))
            } catch (error: Exception) {
                message.text = error.message ?: "Sign in failed"
            }
        }
    }
}
