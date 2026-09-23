package com.networkpeer.mobile.ui.screens

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.BusinessCenter
import androidx.compose.material.icons.outlined.Engineering
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.networkpeer.mobile.AppContainer
import com.networkpeer.mobile.R
import com.networkpeer.mobile.core.model.UserRole
import com.networkpeer.mobile.ui.BrandMark
import com.networkpeer.mobile.ui.components.NpBanner
import com.networkpeer.mobile.ui.components.NpPrimaryButton
import com.networkpeer.mobile.ui.components.NpTextAction
import com.networkpeer.mobile.ui.components.NpTextField
import com.networkpeer.mobile.ui.components.Tone
import com.networkpeer.mobile.ui.friendlyError
import com.networkpeer.mobile.ui.theme.Size
import com.networkpeer.mobile.ui.theme.Space
import com.networkpeer.mobile.ui.theme.np
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding

/**
 * Sign-in and registration.
 *
 * The shape of these screens is dictated by the API, not by preference. A code
 * is requested with `POST /auth/email-otp/request {email, role}` and redeemed
 * with `POST /auth/email-otp/verify {email, otp, full_name?, mobile_number?}`.
 * The role is bound to the challenge when the code is issued and is rejected
 * on verify -- so the role has to be chosen *before* the email is sent, which
 * is exactly why the welcome screen asks for it first rather than burying it
 * in a form. The account is created on verify if the address is new, which is
 * why registering and signing in reach the same two endpoints and differ only
 * in whether a name and mobile number are collected.
 */

private enum class AuthMode { REGISTER, SIGN_IN }

private sealed interface AuthStep {
    data object Welcome : AuthStep
    data class Email(val role: UserRole, val mode: AuthMode) : AuthStep
    data class Code(
        val role: UserRole,
        val mode: AuthMode,
        val email: String,
        val challengeId: String,
        val otpLength: Int,
        val developmentOtp: String?,
    ) : AuthStep
}

@Composable
fun AuthFlow(container: AppContainer) {
    var step by rememberSaveable(
        stateSaver = androidx.compose.runtime.saveable.Saver(
            save = { s: AuthStep ->
                when (s) {
                    is AuthStep.Welcome -> arrayListOf("welcome")
                    is AuthStep.Email -> arrayListOf("email", s.role.name, s.mode.name)
                    is AuthStep.Code -> arrayListOf(
                        "code", s.role.name, s.mode.name, s.email,
                        s.challengeId, s.otpLength.toString(), s.developmentOtp ?: "",
                    )
                }
            },
            restore = { v: ArrayList<String> ->
                when (v.first()) {
                    "email" -> AuthStep.Email(UserRole.valueOf(v[1]), AuthMode.valueOf(v[2]))
                    "code" -> AuthStep.Code(
                        UserRole.valueOf(v[1]), AuthMode.valueOf(v[2]), v[3], v[4],
                        v[5].toIntOrNull() ?: 6, v[6].ifBlank { null },
                    )
                    else -> AuthStep.Welcome
                }
            },
        ),
    ) { mutableStateOf<AuthStep>(AuthStep.Welcome) }

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.np.canvas)
            // The window is edge to edge, so these screens keep themselves
            // clear of the status bar, the navigation bar and the keyboard.
            // The authenticated app gets this from its Scaffold; this tree has
            // no Scaffold, which is why its back arrow sat over the clock.
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        when (val current = step) {
            is AuthStep.Welcome -> WelcomeScreen(
                onChoose = { role, mode -> step = AuthStep.Email(role, mode) },
            )

            is AuthStep.Email -> EmailScreen(
                container = container,
                role = current.role,
                mode = current.mode,
                onBack = { step = AuthStep.Welcome },
                onCodeSent = { email, challengeId, otpLength, devOtp ->
                    step = AuthStep.Code(
                        role = current.role,
                        mode = current.mode,
                        email = email,
                        challengeId = challengeId,
                        otpLength = otpLength,
                        developmentOtp = devOtp,
                    )
                },
            )

            is AuthStep.Code -> CodeScreen(
                container = container,
                state = current,
                onBack = { step = AuthStep.Email(current.role, current.mode) },
            )
        }
    }
}

// --------------------------------------------------------------- welcome

@Composable
private fun WelcomeScreen(onChoose: (UserRole, AuthMode) -> Unit) {
    val c = MaterialTheme.np
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Space.xl),
    ) {
        Spacer(Modifier.height(Space.xxl))
        BrandMark()

        Spacer(Modifier.height(Space.xxl))
        Text(
            text = stringResource(R.string.welcome_headline),
            style = MaterialTheme.typography.displaySmall,
            color = c.ink,
        )
        Spacer(Modifier.height(Space.md))
        Text(
            text = stringResource(R.string.welcome_body),
            style = MaterialTheme.typography.bodyLarge,
            color = c.inkMuted,
        )

        Spacer(Modifier.height(Space.xxl))
        Text(
            text = stringResource(R.string.welcome_pick_role).uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = c.inkFaint,
        )
        Spacer(Modifier.height(Space.md))

        // The role is a real fork in the product, not a preference: it decides
        // which half of the marketplace the account belongs to and cannot be
        // changed after the code is sent. So it is asked plainly, once, here.
        RoleChoice(
            icon = Icons.Outlined.Engineering,
            title = stringResource(R.string.role_worker_title),
            body = stringResource(R.string.role_worker_body),
            onClick = { onChoose(UserRole.WORKER, AuthMode.REGISTER) },
        )
        Spacer(Modifier.height(Space.md))
        RoleChoice(
            icon = Icons.Outlined.BusinessCenter,
            title = stringResource(R.string.role_client_title),
            body = stringResource(R.string.role_client_body),
            onClick = { onChoose(UserRole.CLIENT, AuthMode.REGISTER) },
        )

        Spacer(Modifier.height(Space.xl))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.welcome_have_account),
                style = MaterialTheme.typography.bodyMedium,
                color = c.inkMuted,
            )
            NpTextAction(
                label = stringResource(R.string.sign_in_tab),
                // Signing in still needs a role, because the code is issued
                // against one. WORKER is the app's own audience; a client who
                // signs in here reaches the same account either way, since the
                // role on an existing account is not reassigned by a new code.
                onClick = { onChoose(UserRole.WORKER, AuthMode.SIGN_IN) },
            )
        }
        Spacer(Modifier.height(Space.xxl))
    }
}

@Composable
private fun RoleChoice(
    icon: ImageVector,
    title: String,
    body: String,
    onClick: () -> Unit,
) {
    val c = MaterialTheme.np
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.paper, shape)
            .border(Size.hairline, c.hairline, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(Space.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .background(c.fill, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = c.ink, modifier = Modifier.size(Size.iconLarge))
        }
        Spacer(Modifier.width(Space.lg))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = c.ink)
            Spacer(Modifier.height(2.dp))
            Text(body, style = MaterialTheme.typography.bodySmall, color = c.inkMuted)
        }
    }
}

// ----------------------------------------------------------------- email

@Composable
private fun EmailScreen(
    container: AppContainer,
    role: UserRole,
    mode: AuthMode,
    onBack: () -> Unit,
    onCodeSent: (email: String, challengeId: String, otpLength: Int, devOtp: String?) -> Unit,
) {
    val c = MaterialTheme.np
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val valid = email.trim().let { it.contains('@') && it.substringAfter('@').contains('.') }

    AuthScaffold(
        onBack = onBack,
        title = if (mode == AuthMode.REGISTER) {
            stringResource(R.string.auth_create_title)
        } else {
            stringResource(R.string.auth_signin_title)
        },
        subtitle = stringResource(R.string.auth_email_subtitle),
    ) {
        NpTextField(
            value = email,
            onValueChange = { email = it; error = null },
            label = stringResource(R.string.email_address),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            enabled = !sending,
        )

        if (error != null) {
            Spacer(Modifier.height(Space.lg))
            NpBanner(message = error!!, tone = Tone.Danger)
        }

        Spacer(Modifier.height(Space.xl))
        NpPrimaryButton(
            label = stringResource(R.string.auth_send_code),
            enabled = valid,
            loading = sending,
            onClick = {
                scope.launch {
                    sending = true
                    error = null
                    try {
                        val result = container.authRepository.requestEmailOtp(
                            email = email.trim(),
                            role = role,
                        )
                        onCodeSent(
                            email.trim(),
                            result.challengeId,
                            result.otpLength,
                            result.developmentOtp,
                        )
                    } catch (failure: Throwable) {
                        error = friendlyError(context, failure)
                    } finally {
                        sending = false
                    }
                }
            },
        )

        Spacer(Modifier.height(Space.lg))
        Text(
            text = stringResource(R.string.auth_email_note),
            style = MaterialTheme.typography.bodySmall,
            color = c.inkFaint,
        )
    }
}

// ------------------------------------------------------------------ code

private const val RESEND_COOLDOWN_SECONDS = 30

@Composable
private fun CodeScreen(
    container: AppContainer,
    state: AuthStep.Code,
    onBack: () -> Unit,
) {
    val c = MaterialTheme.np
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var code by rememberSaveable { mutableStateOf("") }
    var fullName by rememberSaveable { mutableStateOf("") }
    var mobile by rememberSaveable { mutableStateOf("") }
    var verifying by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var challengeId by rememberSaveable { mutableStateOf(state.challengeId) }
    var secondsLeft by remember { mutableIntStateOf(RESEND_COOLDOWN_SECONDS) }

    LaunchedEffect(challengeId) {
        secondsLeft = RESEND_COOLDOWN_SECONDS
        while (secondsLeft > 0) {
            delay(1_000)
            secondsLeft -= 1
        }
    }

    val registering = state.mode == AuthMode.REGISTER
    val codeComplete = code.length >= 4
    val nameOk = !registering || fullName.trim().length >= 2

    AuthScaffold(
        onBack = onBack,
        title = stringResource(R.string.auth_code_title),
        subtitle = stringResource(R.string.auth_code_subtitle, state.email),
    ) {
        NpTextField(
            value = code,
            onValueChange = { input ->
                // The server accepts 4-8 digits; anything else is a typo, and
                // filtering here keeps the keyboard from producing a body the
                // strict schema will reject with a flat 400.
                code = input.filter(Char::isDigit).take(8)
                error = null
            },
            label = stringResource(R.string.auth_code_label, state.otpLength),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            enabled = !verifying,
        )

        // Present only outside production, where the API echoes the code back
        // so a tester without inbox access can still get through.
        state.developmentOtp?.let { dev ->
            Spacer(Modifier.height(Space.md))
            NpBanner(
                message = stringResource(R.string.auth_development_code, dev),
                tone = Tone.Attention,
            )
        }

        if (registering) {
            Spacer(Modifier.height(Space.lg))
            NpTextField(
                value = fullName,
                onValueChange = { fullName = it },
                label = stringResource(R.string.full_name),
                enabled = !verifying,
            )
            Spacer(Modifier.height(Space.lg))
            NpTextField(
                value = mobile,
                onValueChange = { mobile = it },
                label = stringResource(R.string.mobile_number_optional),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                enabled = !verifying,
            )
        }

        if (error != null) {
            Spacer(Modifier.height(Space.lg))
            NpBanner(message = error!!, tone = Tone.Danger)
        }

        Spacer(Modifier.height(Space.xl))
        NpPrimaryButton(
            label = if (registering) {
                stringResource(R.string.auth_create_account)
            } else {
                stringResource(R.string.auth_sign_in_action)
            },
            enabled = codeComplete && nameOk,
            loading = verifying,
            onClick = {
                scope.launch {
                    verifying = true
                    error = null
                    try {
                        container.authRepository.verifyEmailOtp(
                            email = state.email,
                            otp = code,
                            challengeId = challengeId,
                            fullName = fullName.trim().ifBlank { null },
                            mobileNumber = mobile.trim().ifBlank { null },
                        )
                        // A stored session makes NetworkPeerApp swap this whole
                        // tree for the authenticated app; nothing to do here.
                    } catch (failure: Throwable) {
                        error = friendlyError(context, failure)
                    } finally {
                        verifying = false
                    }
                }
            },
        )

        Spacer(Modifier.height(Space.lg))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (secondsLeft > 0) {
                Text(
                    text = stringResource(R.string.auth_resend_in, secondsLeft),
                    style = MaterialTheme.typography.bodySmall,
                    color = c.inkFaint,
                )
            } else {
                NpTextAction(
                    label = stringResource(R.string.resend_code),
                    onClick = {
                        scope.launch {
                            error = null
                            try {
                                val result = container.authRepository.requestEmailOtp(
                                    email = state.email,
                                    role = state.role,
                                )
                                // A resend issues a new challenge; redeeming
                                // against the old id would fail as expired.
                                challengeId = result.challengeId
                                code = ""
                            } catch (failure: Throwable) {
                                error = friendlyError(context, failure)
                            }
                        }
                    },
                )
            }
        }
    }
}

// -------------------------------------------------------------- scaffold

@Composable
private fun AuthScaffold(
    onBack: () -> Unit,
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    val c = MaterialTheme.np
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Space.sm, vertical = Space.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = stringResource(R.string.back),
                    tint = c.ink,
                    modifier = Modifier.size(Size.iconLarge),
                )
            }
        }
        Column(Modifier.padding(horizontal = Space.xl)) {
            Spacer(Modifier.height(Space.lg))
            Text(title, style = MaterialTheme.typography.displaySmall, color = c.ink)
            Spacer(Modifier.height(Space.sm))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = c.inkMuted)
            Spacer(Modifier.height(Space.xxl))
            content()
            Spacer(Modifier.height(Space.xxl))
        }
    }
}
