package com.networkpeer.mobile.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.BusinessCenter
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Engineering
import androidx.compose.material.icons.outlined.FlashOn
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.draw.clip
import com.networkpeer.mobile.core.model.UpdateProfileBody
import com.networkpeer.mobile.core.model.AuthUser
import com.networkpeer.mobile.core.model.StoredSession
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.networkpeer.mobile.AppContainer
import com.networkpeer.mobile.R
import com.networkpeer.mobile.core.model.JobStatus
import com.networkpeer.mobile.core.model.NetworkPeerApiException
import com.networkpeer.mobile.core.model.UserRole
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import com.networkpeer.mobile.ui.components.NpBanner
import com.networkpeer.mobile.ui.components.NpCard
import com.networkpeer.mobile.ui.components.NpEmptyState
import com.networkpeer.mobile.ui.components.NpPill
import com.networkpeer.mobile.ui.components.NpTopBar
import com.networkpeer.mobile.ui.components.Tone
import com.networkpeer.mobile.ui.theme.Space
import com.networkpeer.mobile.ui.theme.np
import com.networkpeer.mobile.ui.screens.AuthFlow

@Composable
fun NetworkPeerApp(container: AppContainer) {
    val session by container.client.sessionStore.session.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when {
            !container.client.configuration.apiConfigured -> MissingConfigurationScreen()
            session == null -> AuthFlow(container)
            else -> {
                val activeSession = requireNotNull(session)
                key(activeSession.user.id, activeSession.user.role) {
                    ReleaseAuthenticatedApp(container, activeSession)
                }
            }
        }
    }
}

@Composable
private fun MissingConfigurationScreen() {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        BrandMark()
        Spacer(Modifier.height(28.dp))
        Text(
            stringResource(R.string.configuration_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(R.string.configuration_body),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(18.dp))
        InlineNotice(stringResource(R.string.configuration_api_label), Tone.Neutral)
    }
}

// RoleSelectionCard and AuthScreen lived here: a single screen that held
// the role picker, the email field, the OTP field, the name and mobile
// fields and a tab bar switching between register and sign in, all at once.
// It is replaced by ui/screens/AuthFlow.kt, which asks one question per
// screen in the order the API requires them.

@Composable
internal fun BrandMark(compact: Boolean = false) {
    // A wordmark, not a logo tile. The gradient square this replaces was the
    // single most-saturated object on every screen, which put the app's own
    // name in permanent competition with whatever the user came to do.
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(if (compact) 26.dp else 34.dp)
                .background(color = MaterialTheme.np.ink, shape = RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "N",
                color = MaterialTheme.np.onInk,
                style = if (compact) {
                    MaterialTheme.typography.labelMedium
                } else {
                    MaterialTheme.typography.titleMedium
                },
            )
        }
        Spacer(Modifier.width(Space.sm))
        Text(
            text = stringResource(R.string.networkpeer),
            style = if (compact) {
                MaterialTheme.typography.titleMedium
            } else {
                MaterialTheme.typography.titleLarge
            },
            color = MaterialTheme.np.ink,
        )
    }
}

@Composable
internal fun BackHeader(title: String, onBack: () -> Unit) {
    NpTopBar(title = title, onBack = onBack)
}

@Composable
internal fun LoadingCard(message: String) {
    NpCard {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            CircularProgressIndicator(
                Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.np.inkMuted,
            )
            Spacer(Modifier.width(Space.md))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.np.inkMuted,
            )
        }
    }
}

@Composable
internal fun EmptyCard(title: String, body: String) {
    NpEmptyState(title = title, message = body, icon = Icons.Outlined.Work)
}

/**
 * Severity is carried by [Tone] rather than by a colour the caller picks, so
 * two screens reporting the same kind of thing cannot disagree about what it
 * looks like -- which they previously did.
 */
@Composable
internal fun InlineNotice(message: String, tone: Tone = Tone.Neutral) {
    NpBanner(message = message, tone = tone)
}

@Composable
internal fun StatusPill(status: JobStatus) {
    val tone = when (status) {
        JobStatus.COMPLETED, JobStatus.APPROVED -> Tone.Positive
        JobStatus.CANCELLED, JobStatus.DISPUTED -> Tone.Danger
        // Anything the user still has to act on, including an unfunded job.
        JobStatus.FUNDING, JobStatus.IN_PROGRESS, JobStatus.AT_LOCATION -> Tone.Attention
        else -> Tone.Neutral
    }
    NpPill(label = statusLabel(status), tone = tone)
}

@Composable
internal fun statusLabel(status: JobStatus): String = stringResource(
    when (status) {
        JobStatus.FUNDING -> R.string.status_funding
        JobStatus.POSTED -> R.string.status_posted
        JobStatus.ASSIGNED -> R.string.status_assigned
        JobStatus.EN_ROUTE -> R.string.status_en_route
        JobStatus.AT_LOCATION -> R.string.status_at_location
        JobStatus.IN_PROGRESS -> R.string.status_in_progress
        JobStatus.SUBMITTED -> R.string.status_submitted
        JobStatus.APPROVED -> R.string.status_approved
        JobStatus.COMPLETED -> R.string.status_completed
        JobStatus.CANCELLED -> R.string.status_cancelled
        JobStatus.DISPUTED -> R.string.status_disputed
    },
)

internal fun friendlyError(context: Context, failure: Throwable): String {
    val logCode = (failure as? NetworkPeerApiException)?.let { "${it.code}/${it.statusCode} " } ?: ""
    android.util.Log.e("NetworkPeer", "API error: $logCode${failure.message}", failure)
    return when (failure) {
        is NetworkPeerApiException -> {
            // The API writes these for the person reading them: "We need your
            // current location before you can accept work", "This job is
            // outside the distance you have chosen to work within". Replacing
            // them with a sentence built from the status code is how a worker
            // with a stale GPS fix came to be told they had already taken the
            // job -- and how an upload that failed on a missing S3 permission
            // showed up as a bare 500. Use what the server said.
            val fromServer = failure.message.takeIf {
                it.isNotBlank() && !it.startsWith("The server rejected the request")
            }
            fromServer ?: when {
                failure.statusCode == 401 ->
                    "Invalid verification code. Please check the 6-digit code sent to your email."
                failure.statusCode == 403 -> "You are not allowed to do that."
                failure.statusCode == 404 -> "The requested profile or resource could not be found."
                failure.statusCode == 429 -> "Too many attempts. Please wait a minute and try again."
                failure.statusCode in 500..599 ->
                    "Service temporarily unavailable. Please try again shortly."
                else -> "Unable to complete request. Please check your connection and try again."
            }
        }
        else -> context.getString(R.string.generic_request_error)
    }
}


internal fun formatMoney(cents: Long, currency: String): String {
    if (currency.equals("INR", ignoreCase = true)) {
        return "₹${"%,.2f".format(Locale.US, cents / 100.0)}"
    }
    val formatter = NumberFormat.getCurrencyInstance(Locale.getDefault())
    return runCatching {
        formatter.currency = Currency.getInstance(currency)
        formatter.format(cents / 100.0)
    }.getOrElse { "$currency ${"%.2f".format(Locale.US, cents / 100.0)}" }
}
