package com.networkpeer.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.unit.dp

/**
 * A four-step spacing scale. Everything on a screen sits on one of these, so
 * gaps stay related to one another instead of being guessed per composable.
 */
object Space {
    /** Between an icon and its label; inside a pill. */
    val xs = 4.dp
    /** Between stacked lines of a single idea. */
    val sm = 8.dp
    /** Between distinct elements in a group. */
    val md = 12.dp
    /** Card padding, and the gap between cards. */
    val lg = 16.dp
    /** Screen gutter, and the gap between sections. */
    val xl = 24.dp
    /** Above a section that starts a new subject. */
    val xxl = 32.dp
}

/** Standard heights, so tap targets do not vary screen to screen. */
object Size {
    val button = 52.dp
    val buttonCompact = 40.dp
    val field = 52.dp
    val icon = 20.dp
    val iconLarge = 24.dp
    val avatar = 40.dp
    val bottomBar = 64.dp
    val hairline = 1.dp
}

private val NetworkPeerShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

/**
 * Material's scheme is filled in from the same palette so that any stock
 * component still lands on brand, but application code should prefer
 * [MaterialTheme.np] -- the roles below are a lossy fit. Material assumes
 * `primary` is a hue; here it is the colour of ink, which is why
 * `primaryContainer` has to carry the accent instead.
 */
private fun schemeFrom(c: NetworkPeerColors) = if (c.isDark) {
    darkColorScheme(
        primary = c.ink,
        onPrimary = c.onInk,
        primaryContainer = c.accentSoft,
        onPrimaryContainer = c.accent,
        secondary = c.accent,
        onSecondary = c.onInk,
        secondaryContainer = c.fill,
        onSecondaryContainer = c.ink,
        tertiary = c.attention,
        onTertiary = c.onInk,
        background = c.canvas,
        onBackground = c.ink,
        surface = c.paper,
        onSurface = c.ink,
        surfaceVariant = c.fill,
        onSurfaceVariant = c.inkMuted,
        outline = c.hairline,
        outlineVariant = c.hairline,
        error = c.danger,
        onError = c.onInk,
        errorContainer = c.dangerSoft,
        onErrorContainer = c.danger,
        scrim = c.canvas,
    )
} else {
    lightColorScheme(
        primary = c.ink,
        onPrimary = c.onInk,
        primaryContainer = c.accentSoft,
        onPrimaryContainer = c.accent,
        secondary = c.accent,
        onSecondary = c.onInk,
        secondaryContainer = c.fill,
        onSecondaryContainer = c.ink,
        tertiary = c.attention,
        onTertiary = c.onInk,
        background = c.canvas,
        onBackground = c.ink,
        surface = c.paper,
        onSurface = c.ink,
        surfaceVariant = c.fill,
        onSurfaceVariant = c.inkMuted,
        outline = c.hairline,
        outlineVariant = c.hairline,
        error = c.danger,
        onError = c.onInk,
        errorContainer = c.dangerSoft,
        onErrorContainer = c.danger,
        scrim = c.ink,
    )
}

@Composable
fun NetworkPeerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = networkPeerColors(darkTheme)
    CompositionLocalProvider(LocalNetworkPeerColors provides colors) {
        MaterialTheme(
            colorScheme = schemeFrom(colors),
            typography = NetworkPeerTypography,
            shapes = NetworkPeerShapes,
            content = content,
        )
    }
}

/** The palette, read without any composable having to know the theme mode. */
val MaterialTheme.np: NetworkPeerColors
    @Composable
    @ReadOnlyComposable
    get() = LocalNetworkPeerColors.current
