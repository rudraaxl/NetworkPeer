package com.networkpeer.mobile.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.sp
import com.networkpeer.mobile.R

/**
 * Plus Jakarta Sans, bundled at five weights. See THIRD_PARTY_NOTICES.md.
 *
 * Declaring a family rather than overriding the platform default matters for
 * Devanagari: this family has no Devanagari glyphs, so Hindi text falls through
 * to Android's own fallback chain instead of rendering as empty boxes.
 */
val PlusJakarta = FontFamily(
    Font(R.font.plus_jakarta_sans_400, FontWeight.Normal),
    Font(R.font.plus_jakarta_sans_500, FontWeight.Medium),
    Font(R.font.plus_jakarta_sans_600, FontWeight.SemiBold),
    Font(R.font.plus_jakarta_sans_700, FontWeight.Bold),
    Font(R.font.plus_jakarta_sans_800, FontWeight.ExtraBold),
)

/**
 * Trim the extra leading Android adds above the first line and below the last.
 * Without this, a heading sitting in a Row never optically aligns with the icon
 * or the price beside it, and no amount of padding fixes it.
 */
private val Trim = LineHeightStyle(
    alignment = LineHeightStyle.Alignment.Center,
    trim = LineHeightStyle.Trim.Both,
)

private fun style(
    size: Int,
    lineHeight: Int,
    weight: FontWeight,
    tracking: Double = 0.0,
) = TextStyle(
    fontFamily = PlusJakarta,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    fontWeight = weight,
    letterSpacing = tracking.sp,
    lineHeightStyle = Trim,
)

/**
 * Large text is set tight and heavy; small text is set loose and light. That
 * single rule is most of what separates a typeset screen from a default one.
 * Negative tracking on the display sizes stops big headings looking gappy, and
 * the positive tracking on [Typography.labelSmall] is there because that style
 * is always set in caps, where letters need air.
 */
val NetworkPeerTypography = Typography(
    displayLarge = style(40, 44, FontWeight.ExtraBold, -1.2),
    displayMedium = style(32, 37, FontWeight.ExtraBold, -0.8),
    displaySmall = style(28, 33, FontWeight.ExtraBold, -0.6),

    headlineLarge = style(24, 30, FontWeight.Bold, -0.4),
    headlineMedium = style(22, 28, FontWeight.Bold, -0.3),
    headlineSmall = style(20, 26, FontWeight.Bold, -0.2),

    titleLarge = style(18, 24, FontWeight.Bold, -0.1),
    titleMedium = style(16, 22, FontWeight.SemiBold),
    titleSmall = style(14, 20, FontWeight.SemiBold),

    bodyLarge = style(16, 24, FontWeight.Normal),
    bodyMedium = style(14, 21, FontWeight.Normal),
    bodySmall = style(13, 19, FontWeight.Normal),

    // labelLarge is the button label. Heavier than the body around it, because
    // the tap target should read as the heaviest thing in its region.
    labelLarge = style(15, 20, FontWeight.Bold),
    labelMedium = style(13, 16, FontWeight.SemiBold),
    labelSmall = style(11, 14, FontWeight.Bold, 0.6),
)

/**
 * Amounts are set with tabular figures so a column of them lines up on the
 * decimal, and at the heaviest weight available, because on nearly every screen
 * in this app the number is the thing the user actually came for.
 */
val MoneyLarge = style(28, 32, FontWeight.ExtraBold, -0.6).copy(fontFeatureSettings = "tnum")
val MoneyMedium = style(20, 24, FontWeight.ExtraBold, -0.3).copy(fontFeatureSettings = "tnum")
val MoneySmall = style(15, 20, FontWeight.Bold).copy(fontFeatureSettings = "tnum")
