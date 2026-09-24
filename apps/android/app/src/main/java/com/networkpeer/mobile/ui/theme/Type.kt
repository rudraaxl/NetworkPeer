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
 *
 * The sizes come from a 1.2 scale anchored on a 17sp reading size. An earlier
 * version of this scale was set by eye against a 302px-wide mockup, which is
 * the classic way to get this wrong: text sized to look right in a small
 * picture of a phone is far too small on the phone. Measured against that
 * design it was 9% short at body sizes and 29% short at display sizes -- and
 * worse again on a device whose owner has reduced the display size, because
 * more dp fit across the screen and every sp shrinks against it.
 *
 * Display sizes moved most and reading sizes least, which is deliberate: a
 * heading's job is to be seen, a paragraph's is to be read, and 17sp is
 * already the right size to read.
 */
val NetworkPeerTypography = Typography(
    displayLarge = style(50, 54, FontWeight.ExtraBold, -1.5),
    displayMedium = style(42, 46, FontWeight.ExtraBold, -1.2),
    displaySmall = style(34, 39, FontWeight.ExtraBold, -0.9),

    headlineLarge = style(30, 36, FontWeight.Bold, -0.6),
    headlineMedium = style(28, 34, FontWeight.Bold, -0.5),
    headlineSmall = style(24, 30, FontWeight.Bold, -0.4),

    titleLarge = style(20, 26, FontWeight.Bold, -0.2),
    titleMedium = style(18, 24, FontWeight.SemiBold, -0.1),
    titleSmall = style(16, 22, FontWeight.SemiBold),

    bodyLarge = style(17, 25, FontWeight.Normal),
    bodyMedium = style(15, 22, FontWeight.Normal),
    bodySmall = style(14, 20, FontWeight.Normal),

    // labelLarge is the button label. Heavier than the body around it, because
    // the tap target should read as the heaviest thing in its region.
    labelLarge = style(17, 22, FontWeight.Bold),
    labelMedium = style(14, 18, FontWeight.SemiBold),
    labelSmall = style(12, 15, FontWeight.Bold, 0.7),
)

/**
 * Amounts are set with tabular figures so a column of them lines up on the
 * decimal, and at the heaviest weight available, because on nearly every screen
 * in this app the number is the thing the user actually came for.
 */
val MoneyLarge = style(34, 38, FontWeight.ExtraBold, -0.9).copy(fontFeatureSettings = "tnum")
val MoneyMedium = style(24, 28, FontWeight.ExtraBold, -0.4).copy(fontFeatureSettings = "tnum")
val MoneySmall = style(17, 22, FontWeight.Bold).copy(fontFeatureSettings = "tnum")
