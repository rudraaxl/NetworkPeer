package com.networkpeer.mobile.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The palette is deliberately small and mostly colourless.
 *
 * A worker opens this app outdoors, one-handed, to answer three questions: what
 * is near me, what does it pay, and what do I do next. Colour earns its place
 * only when it answers one of those faster than type or spacing would. So the
 * interface is ink on paper; [accent] marks money and completion, [attention]
 * marks something waiting on the user, [danger] marks a failure, and nothing
 * else is coloured at all.
 *
 * The previous palette put its brand yellow on chips, search icons, banners,
 * price tags and the primary button at once. When everything is highlighted the
 * highlight stops meaning anything, and the eye has no idea where to land.
 */
@Immutable
data class NetworkPeerColors(
    /** Primary text, and the fill of the primary action. */
    val ink: Color,
    /** Secondary text: supporting lines, captions that still need to be read. */
    val inkMuted: Color,
    /** Tertiary text: placeholders, metadata, things the eye may skip. */
    val inkFaint: Color,
    /** Raised surfaces -- cards, sheets, the bars top and bottom. */
    val paper: Color,
    /** The page behind everything. */
    val canvas: Color,
    /** Quiet fills: inputs, unselected chips, avatars, icon wells. */
    val fill: Color,
    /** One-pixel separators and card borders. Never a shadow. */
    val hairline: Color,
    /** Money, earnings, completion. The only routinely coloured thing. */
    val accent: Color,
    /** Tinted ground beneath [accent]. */
    val accentSoft: Color,
    /** Waiting on the user: unfunded, expiring, action required. */
    val attention: Color,
    val attentionSoft: Color,
    /** Failed, rejected, destructive. */
    val danger: Color,
    val dangerSoft: Color,
    /** Text and icons drawn on top of [ink]. */
    val onInk: Color,
    /** True when the dark palette is in force. */
    val isDark: Boolean,
)

/**
 * Warm-shifted neutrals. A mathematically pure grey reads as an unset default;
 * a few degrees of warmth reads as chosen, and sits better against the teal.
 */
private val LightPalette = NetworkPeerColors(
    ink = Color(0xFF0B0C0E),
    inkMuted = Color(0xFF5B6167),
    inkFaint = Color(0xFF8E9299),
    paper = Color(0xFFFFFFFF),
    canvas = Color(0xFFF6F6F4),
    fill = Color(0xFFF0F0EC),
    hairline = Color(0xFFE4E4DF),
    accent = Color(0xFF0E7C6B),
    accentSoft = Color(0xFFE3F2EF),
    attention = Color(0xFF9A5B06),
    attentionSoft = Color(0xFFFCF1DF),
    danger = Color(0xFFB3261E),
    dangerSoft = Color(0xFFFCEBE9),
    onInk = Color(0xFFFFFFFF),
    isDark = false,
)

/**
 * Dark mode is not the light palette inverted. The primary action flips to a
 * light fill on a dark label -- the same "heaviest thing on screen" role that
 * black plays in daylight -- and the accent is lifted several steps, because
 * #0E7C6B on near-black falls below a readable contrast ratio.
 */
private val DarkPalette = NetworkPeerColors(
    ink = Color(0xFFF3F3F1),
    inkMuted = Color(0xFFA2A7AD),
    inkFaint = Color(0xFF73787E),
    paper = Color(0xFF17181B),
    canvas = Color(0xFF0C0D0F),
    fill = Color(0xFF212328),
    hairline = Color(0xFF2B2D32),
    accent = Color(0xFF3ECFB4),
    accentSoft = Color(0xFF10322C),
    attention = Color(0xFFE3A845),
    attentionSoft = Color(0xFF33260F),
    danger = Color(0xFFF2857D),
    dangerSoft = Color(0xFF3A1C1A),
    onInk = Color(0xFF0B0C0E),
    isDark = true,
)

internal fun networkPeerColors(dark: Boolean): NetworkPeerColors =
    if (dark) DarkPalette else LightPalette

/**
 * Reading the palette through a composition local means a composable never has
 * to ask whether the system is in dark mode. Every screen in the old build did
 * that by hand -- `if (isDark) Color(0xFF1E293B) else Color.White` appears
 * dozens of times -- which is how the two themes drifted apart.
 */
val LocalNetworkPeerColors = staticCompositionLocalOf { LightPalette }
