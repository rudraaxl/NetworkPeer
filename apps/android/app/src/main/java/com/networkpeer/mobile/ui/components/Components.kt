package com.networkpeer.mobile.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.networkpeer.mobile.ui.theme.MoneyLarge
import com.networkpeer.mobile.ui.theme.MoneyMedium
import com.networkpeer.mobile.ui.theme.MoneySmall
import com.networkpeer.mobile.ui.theme.Size
import com.networkpeer.mobile.ui.theme.Space
import com.networkpeer.mobile.ui.theme.np

/**
 * The vocabulary every screen is built from.
 *
 * Before this existed, each screen decided for itself what a card, a button or
 * a status badge looked like, and the answers drifted: four corner radii, three
 * shades of grey for the same border, and a colour literal at nearly every call
 * site. Anything here that two screens share now has exactly one definition.
 */

/** What a piece of state means, which is what decides its colour. */
enum class Tone {
    /** Ordinary information. Grey. */
    Neutral,

    /** Money, success, completion. Teal. */
    Positive,

    /** Waiting on the user. Amber. */
    Attention,

    /** Failed or destructive. Red. */
    Danger,
}

private class ToneColors(val fg: Color, val bg: Color)

@Composable
private fun toneColors(tone: Tone): ToneColors {
    val c = MaterialTheme.np
    return when (tone) {
        Tone.Neutral -> ToneColors(c.inkMuted, c.fill)
        Tone.Positive -> ToneColors(c.accent, c.accentSoft)
        Tone.Attention -> ToneColors(c.attention, c.attentionSoft)
        Tone.Danger -> ToneColors(c.danger, c.dangerSoft)
    }
}

// ---------------------------------------------------------------- structure

/** The page ground. Every screen starts with one. */
@Composable
fun NpScreen(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.np.canvas),
    ) { content() }
}

/**
 * A one-pixel rule. This app separates things with hairlines and surface tone
 * rather than shadows, which keeps a long scroll from looking quilted.
 */
@Composable
fun NpHairline(modifier: Modifier = Modifier) {
    HorizontalDivider(
        modifier = modifier,
        thickness = Size.hairline,
        color = MaterialTheme.np.hairline,
    )
}

/**
 * A raised surface. Bordered, not shadowed: at this radius a drop shadow reads
 * as a Material default, and stacking twenty of them down a scroll is noise.
 */
@Composable
fun NpCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: Dp = Space.lg,
    content: @Composable () -> Unit,
) {
    val c = MaterialTheme.np
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.paper)
            .border(Size.hairline, c.hairline, shape)
            .then(
                if (onClick != null) {
                    Modifier.clickable(role = Role.Button, onClick = onClick)
                } else {
                    Modifier
                },
            )
            .padding(padding),
    ) {
        content()
    }
}

/**
 * A screen title with an optional trailing action.
 *
 * The eyebrow is set in caps at [MaterialTheme.typography] labelSmall and is
 * for the category a screen belongs to, never for a second sentence of prose.
 */
@Composable
fun NpSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    eyebrow: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val c = MaterialTheme.np
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            if (eyebrow != null) {
                Text(
                    text = eyebrow.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = c.inkFaint,
                )
                Spacer(Modifier.height(Space.xs))
            }
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                color = c.ink,
            )
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = c.inkMuted,
                )
            }
        }
        if (action != null) {
            Spacer(Modifier.width(Space.sm))
            action()
        }
    }
}

/** A back arrow, a title, and whatever belongs on the right. */
@Composable
fun NpTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    actions: (@Composable () -> Unit)? = null,
) {
    val c = MaterialTheme.np
    Column(modifier.fillMaxWidth().background(c.paper)) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .padding(horizontal = Space.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "Back",
                        tint = c.ink,
                        modifier = Modifier.size(Size.iconLarge),
                    )
                }
            } else {
                Spacer(Modifier.width(Space.sm))
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = c.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            actions?.invoke()
        }
        NpHairline()
    }
}

// ------------------------------------------------------------------ actions

/**
 * The primary action: full width, ink-filled, one per screen.
 *
 * It is deliberately the heaviest object in view. A worker standing in front of
 * a shop needs to find "I've arrived" without reading the screen, and weight is
 * what makes that possible in sunlight.
 */
@Composable
fun NpPrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    val c = MaterialTheme.np
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.fillMaxWidth().height(Size.button),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = c.ink,
            contentColor = c.onInk,
            disabledContainerColor = c.fill,
            disabledContentColor = c.inkFaint,
        ),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Space.lg),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = c.onInk,
            )
            Spacer(Modifier.width(Space.sm))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(Size.icon))
            Spacer(Modifier.width(Space.sm))
        }
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

/** The alternative to the primary action. Outlined, never a second filled button. */
@Composable
fun NpSecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val c = MaterialTheme.np
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().height(Size.button),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(Size.hairline, c.hairline),
        colors = ButtonDefaults.buttonColors(
            containerColor = c.paper,
            contentColor = c.ink,
            disabledContainerColor = c.paper,
            disabledContentColor = c.inkFaint,
        ),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(Size.icon))
            Spacer(Modifier.width(Space.sm))
        }
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

/** A destructive confirmation. Red only here and in [NpBanner]. */
@Composable
fun NpDangerButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val c = MaterialTheme.np
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().height(Size.button),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(Size.hairline, c.danger.copy(alpha = 0.35f)),
        colors = ButtonDefaults.buttonColors(
            containerColor = c.dangerSoft,
            contentColor = c.danger,
            disabledContainerColor = c.fill,
            disabledContentColor = c.inkFaint,
        ),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

/** An inline text action, for "See all" and the like. */
@Composable
fun NpTextAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Neutral,
) {
    val color = if (tone == Tone.Neutral) MaterialTheme.np.ink else toneColors(tone).fg
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Space.sm, vertical = Space.xs),
    )
}

/** A compact square icon action sitting on [MaterialTheme.np] fill. */
@Composable
fun NpIconAction(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val c = MaterialTheme.np
    Box(
        modifier
            .size(Size.buttonCompact)
            .clip(RoundedCornerShape(12.dp))
            .background(c.fill)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = if (enabled) c.ink else c.inkFaint,
            modifier = Modifier.size(Size.icon),
        )
    }
}

// ------------------------------------------------------------------- status

/**
 * A state label. Small, pill-shaped, and coloured by meaning rather than by
 * whichever accent was to hand -- so "Funded" and "Paid" are the same green
 * everywhere, and the user learns the colour once.
 */
@Composable
fun NpPill(
    label: String,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Neutral,
    icon: ImageVector? = null,
) {
    val t = toneColors(tone)
    Row(
        modifier
            .clip(CircleShape)
            .background(t.bg)
            .padding(horizontal = Space.sm, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = t.fg, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(Space.xs))
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = t.fg,
            maxLines = 1,
        )
    }
}

/** A selectable filter. Ink when on, quiet fill when off -- no third state. */
@Composable
fun NpFilterPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = MaterialTheme.np
    Box(
        modifier
            .clip(CircleShape)
            .background(if (selected) c.ink else c.fill)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Space.md, vertical = Space.sm),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) c.onInk else c.inkMuted,
            maxLines = 1,
        )
    }
}

/**
 * An amount. Always tabular, always the accent when it is money the user is
 * owed or has earned, so a column of payouts scans without being read.
 */
@Composable
fun NpMoney(
    amount: String,
    modifier: Modifier = Modifier,
    size: MoneySize = MoneySize.Medium,
    color: Color? = null,
) {
    val style: TextStyle = when (size) {
        MoneySize.Large -> MoneyLarge
        MoneySize.Medium -> MoneyMedium
        MoneySize.Small -> MoneySmall
    }
    Text(
        text = amount,
        style = style,
        color = color ?: MaterialTheme.np.ink,
        modifier = modifier,
        maxLines = 1,
    )
}

enum class MoneySize { Large, Medium, Small }

/** A labelled figure, for the three-across statistic rows. */
@Composable
fun NpMetric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    valueColor: Color? = null,
) {
    val c = MaterialTheme.np
    Column(modifier) {
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = c.inkFaint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(Space.sm))
        Text(
            text = value,
            style = MoneyMedium,
            color = valueColor ?: c.ink,
            maxLines = 1,
        )
        if (caption != null) {
            Spacer(Modifier.height(2.dp))
            Text(
                text = caption,
                style = MaterialTheme.typography.bodySmall,
                color = c.inkMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * An inline message. Tone carries the severity, so the text does not have to
 * open with "Error:" or "Warning:" to be understood.
 */
@Composable
fun NpBanner(
    message: String,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Neutral,
    title: String? = null,
    icon: ImageVector? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val t = toneColors(tone)
    val c = MaterialTheme.np
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(t.bg)
            .padding(Space.md),
        verticalAlignment = Alignment.Top,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = t.fg, modifier = Modifier.size(Size.icon))
            Spacer(Modifier.width(Space.md))
        }
        Column(Modifier.weight(1f)) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = t.fg)
                Spacer(Modifier.height(2.dp))
            }
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = if (title != null) c.inkMuted else t.fg,
            )
            if (action != null) {
                Spacer(Modifier.height(Space.sm))
                action()
            }
        }
    }
}

/**
 * Progress through a fixed sequence of steps, as filled segments.
 *
 * A numeric "step 3 of 5" tells the user where they are; a bar also tells them
 * how much is left, which is the part that decides whether they carry on.
 */
@Composable
fun NpStepBar(
    steps: Int,
    current: Int,
    modifier: Modifier = Modifier,
) {
    val c = MaterialTheme.np
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.xs)) {
        repeat(steps) { index ->
            Box(
                Modifier
                    .weight(1f)
                    .height(4.dp)
                    .clip(CircleShape)
                    .background(
                        when {
                            index < current -> c.accent
                            index == current -> c.ink
                            else -> c.hairline
                        },
                    ),
            )
        }
    }
}

// --------------------------------------------------------------------- rows

/** A tappable settings-style row: icon, label, optional value, chevron. */
@Composable
fun NpListRow(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    value: String? = null,
    tone: Tone = Tone.Neutral,
) {
    val c = MaterialTheme.np
    val labelColor = if (tone == Tone.Danger) c.danger else c.ink
    Row(
        modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Space.lg, vertical = Space.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(
                icon,
                contentDescription = null,
                tint = if (tone == Tone.Danger) c.danger else c.inkMuted,
                modifier = Modifier.size(Size.icon),
            )
            Spacer(Modifier.width(Space.md))
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = labelColor,
            modifier = Modifier.weight(1f),
        )
        if (value != null) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                color = c.inkMuted,
            )
            Spacer(Modifier.width(Space.sm))
        }
        Icon(
            Icons.Outlined.ChevronRight,
            contentDescription = null,
            tint = c.inkFaint,
            modifier = Modifier.size(Size.icon),
        )
    }
}

/** A label/value pair for detail screens. */
@Composable
fun NpDetailRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
) {
    val c = MaterialTheme.np
    Row(
        modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = c.inkMuted,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(Space.lg))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = valueColor ?: c.ink,
            modifier = Modifier.weight(1.4f),
        )
    }
}

/** The circular initial used wherever a person is named. */
@Composable
fun NpAvatar(
    initial: String,
    modifier: Modifier = Modifier,
    size: Dp = Size.avatar,
) {
    val c = MaterialTheme.np
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(c.ink),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initial.take(1).uppercase(),
            style = MaterialTheme.typography.titleMedium,
            color = c.onInk,
        )
    }
}

// ------------------------------------------------------------------- inputs

@Composable
private fun npFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = MaterialTheme.np.ink,
    unfocusedBorderColor = MaterialTheme.np.hairline,
    focusedContainerColor = MaterialTheme.np.paper,
    unfocusedContainerColor = MaterialTheme.np.paper,
    disabledContainerColor = MaterialTheme.np.fill,
    focusedTextColor = MaterialTheme.np.ink,
    unfocusedTextColor = MaterialTheme.np.ink,
    cursorColor = MaterialTheme.np.ink,
    focusedLabelColor = MaterialTheme.np.inkMuted,
    unfocusedLabelColor = MaterialTheme.np.inkMuted,
    focusedPlaceholderColor = MaterialTheme.np.inkFaint,
    unfocusedPlaceholderColor = MaterialTheme.np.inkFaint,
    errorBorderColor = MaterialTheme.np.danger,
    errorLabelColor = MaterialTheme.np.danger,
)

/** A search box. One per screen, and never beside a second filter control. */
@Composable
fun NpSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    val c = MaterialTheme.np
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth().height(Size.field),
        placeholder = { Text(placeholder, style = MaterialTheme.typography.bodyMedium) },
        textStyle = MaterialTheme.typography.bodyMedium,
        leadingIcon = {
            Icon(
                Icons.Outlined.Search,
                contentDescription = null,
                tint = c.inkFaint,
                modifier = Modifier.size(Size.icon),
            )
        },
        trailingIcon = if (value.isEmpty()) {
            null
        } else {
            {
                IconButton(onClick = { onValueChange("") }) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Clear search",
                        tint = c.inkMuted,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
        colors = npFieldColors(),
    )
}

/** A labelled text input. */
@Composable
fun NpTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    supportingText: String? = null,
    isError: Boolean = false,
    singleLine: Boolean = true,
    minLines: Int = 1,
    enabled: Boolean = true,
    keyboardOptions: androidx.compose.foundation.text.KeyboardOptions =
        androidx.compose.foundation.text.KeyboardOptions.Default,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val c = MaterialTheme.np
    Column(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text(label, style = MaterialTheme.typography.bodyMedium) },
            placeholder = placeholder?.let {
                { Text(it, style = MaterialTheme.typography.bodyMedium) }
            },
            textStyle = MaterialTheme.typography.bodyLarge,
            singleLine = singleLine,
            minLines = minLines,
            enabled = enabled,
            isError = isError,
            keyboardOptions = keyboardOptions,
            trailingIcon = trailingIcon,
            shape = RoundedCornerShape(14.dp),
            colors = npFieldColors(),
        )
        if (supportingText != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = supportingText,
                style = MaterialTheme.typography.bodySmall,
                color = if (isError) c.danger else c.inkMuted,
                modifier = Modifier.padding(horizontal = Space.xs),
            )
        }
    }
}

// -------------------------------------------------------------------- empty

/**
 * Nothing here, and what to do about it.
 *
 * An empty state without an action is a dead end, so [actionLabel] is the
 * normal case and its absence the exception.
 */
@Composable
fun NpEmptyState(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val c = MaterialTheme.np
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Space.xl, vertical = Space.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (icon != null) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(c.fill),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = c.inkFaint,
                    modifier = Modifier.size(Size.iconLarge),
                )
            }
            Spacer(Modifier.height(Space.lg))
        }
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            color = c.ink,
        )
        Spacer(Modifier.height(Space.sm))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = c.inkMuted,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(Space.xl))
            NpSecondaryButton(
                label = actionLabel,
                onClick = onAction,
                modifier = Modifier.width(220.dp),
            )
        }
    }
}

/** A centred spinner for a screen that has nothing to show yet. */
@Composable
fun NpLoading(modifier: Modifier = Modifier) {
    Box(
        modifier.fillMaxWidth().padding(vertical = Space.xxl),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(28.dp),
            strokeWidth = 2.5.dp,
            color = MaterialTheme.np.inkMuted,
        )
    }
}
