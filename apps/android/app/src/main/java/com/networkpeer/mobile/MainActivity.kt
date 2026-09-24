package com.networkpeer.mobile

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.networkpeer.mobile.ui.NetworkPeerApp
import com.networkpeer.mobile.ui.theme.NetworkPeerTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // targetSdk 36 means Android 15 and later draw this window edge to edge
        // whether or not it asks to. Declaring it makes that explicit and, more
        // importantly, makes the insets available to compose so screens can pad
        // themselves. Without this the sign-in screens drew their back arrow on
        // top of the system clock.
        enableEdgeToEdge()
        val container = (application as NetworkPeerApplication).container
        container.handleDeepLink(intent?.data)
        setContent {
            val themeMode by container.themeMode.collectAsState()
            val systemInDark = isSystemInDarkTheme()
            val isDark = when (themeMode) {
                "dark" -> true
                "light" -> false
                else -> systemInDark
            }

            // The system draws the clock and battery into our window, so their
            // colour is ours to set. It has to follow the in-app theme rather
            // than the device's, because the two can disagree: the app's own
            // toggle switched the palette to light and left white system icons
            // on a white ground, invisible.
            val view = LocalView.current
            if (!view.isInEditMode) {
                SideEffect {
                    val window = (view.context as Activity).window
                    WindowCompat.getInsetsController(window, view).apply {
                        isAppearanceLightStatusBars = !isDark
                        isAppearanceLightNavigationBars = !isDark
                    }
                }
            }

            NetworkPeerTheme(darkTheme = isDark) {
                NetworkPeerApp(container)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        (application as NetworkPeerApplication).container.handleDeepLink(intent.data)
    }
}
