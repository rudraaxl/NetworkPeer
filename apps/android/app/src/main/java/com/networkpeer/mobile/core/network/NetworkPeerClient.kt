package com.networkpeer.mobile.core.network

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.networkpeer.mobile.BuildConfig
import com.networkpeer.mobile.core.model.StoredSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

private const val SKIP_AUTHORIZATION_HEADER = "X-NetworkPeer-Skip-Authorization"

data class NetworkPeerPublicConfiguration(
    val apiBaseUrl: String,
    val apiConfigured: Boolean,
    val stripePublishableKey: String,
    val stripeConfigured: Boolean,
    val realtimeUrl: String,
    val realtimeConfigured: Boolean,
    val realtimeSecureTransportRequired: Boolean,
    val realtimeOrigin: String,
    val fcmConfigured: Boolean,
)

class SecureSessionStore(context: Context) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "networkpeer.secure.session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    private val _session = MutableStateFlow(readFromDisk())
    val session = _session.asStateFlow()

    @Synchronized
    fun current(): StoredSession? = _session.value

    @Synchronized
    fun save(next: StoredSession) {
        saveInternal(next)
    }

    /** Saves a refresh result only when it still belongs to the session that requested it. */
    @Synchronized
    fun replaceIfCurrent(expected: StoredSession, next: StoredSession): Boolean {
        if (_session.value != expected) return false
        saveInternal(next)
        return true
    }

    @Synchronized
    fun clearIfCurrent(expected: StoredSession): Boolean {
        if (_session.value != expected) return false
        clearInternal()
        return true
    }

    @Synchronized
    fun isActiveUser(userId: String): Boolean = _session.value?.user?.id == userId

    /** Prevents a completed request from writing state after a different account is selected. */
    @Synchronized
    fun updateIfActiveUser(userId: String, update: () -> Boolean): Boolean {
        if (_session.value?.user?.id != userId) return false
        return update()
    }

    private fun saveInternal(next: StoredSession) {
        preferences.edit().putString(SESSION_KEY, json.encodeToString(StoredSession.serializer(), next)).commit()
        _session.value = next
    }

    private fun clearInternal() {
        preferences.edit().remove(SESSION_KEY).commit()
        _session.value = null
    }

    private fun readFromDisk(): StoredSession? = runCatching {
        preferences.getString(SESSION_KEY, null)?.let { json.decodeFromString(StoredSession.serializer(), it) }
    }.getOrNull()

    private companion object {
        const val SESSION_KEY = "session"
    }
}

private data class AuthenticatedRequestSession(val value: StoredSession)

private class AccessTokenInterceptor(
    private val sessionStore: SecureSessionStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        if (original.header(SKIP_AUTHORIZATION_HEADER) == "true") {
            return chain.proceed(original.newBuilder().removeHeader(SKIP_AUTHORIZATION_HEADER).build())
        }
        val session = sessionStore.current()
        val request = session?.takeIf { it.accessToken.isNotBlank() }?.let {
            original.newBuilder()
                .header("Authorization", "Bearer ${it.accessToken}")
                .tag(AuthenticatedRequestSession::class.java, AuthenticatedRequestSession(it))
                .build()
        } ?: original
        return chain.proceed(request)
    }
}

private class RefreshTokenAuthenticator(
    private val sessionStore: SecureSessionStore,
    private val refreshApi: TokenRefreshApi,
) : Authenticator {
    private val refreshLock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null
        val requestSession = response.request.tag(AuthenticatedRequestSession::class.java)?.value ?: return null

        // Local, fallback, or demo sessions do not rotate via remote Cognito
        val isLocalSession = requestSession.refreshToken.startsWith("refresh_") ||
            requestSession.accessToken.startsWith("token_") ||
            requestSession.accessToken.startsWith("demo-") ||
            requestSession.user.id.startsWith("usr_")
        if (isLocalSession) {
            return null
        }

        // Refresh tokens rotate after one use, so every 401 must observe the same critical section.
        return synchronized(refreshLock) {
            val current = sessionStore.current() ?: return@synchronized null
            if (current.user.id != requestSession.user.id) return@synchronized null

            // A prior request refreshed this account while this one was waiting. Reuse its access
            // token rather than sending the previous one-time refresh token again.
            if (current != requestSession) {
                return@synchronized current
                    .takeIf { it.accessToken != requestSession.accessToken }
                    ?.let { retry(response, it) }
            }

            val refreshResponse = runCatching {
                refreshApi.refresh(RefreshTokenBody(requestSession.refreshToken)).execute()
            }.getOrNull() ?: return@synchronized null

            val body = refreshResponse.body()
            val pair = body?.data?.takeIf { refreshResponse.isSuccessful && body.success }
            if (pair == null) {
                if ((refreshResponse.code() == 401 || refreshResponse.code() == 403) && !isLocalSession) {
                    // Do not let a stale response clear a session selected while refresh was in flight.
                    sessionStore.clearIfCurrent(requestSession)
                }
                return@synchronized null
            }

            val updated = StoredSession.from(pair)
            if (updated.user.id != requestSession.user.id) return@synchronized null
            if (sessionStore.replaceIfCurrent(requestSession, updated)) return@synchronized retry(response, updated)

            val latest = sessionStore.current()
            latest
                ?.takeIf {
                    it.user.id == requestSession.user.id && it.accessToken != requestSession.accessToken
                }
                ?.let { retry(response, it) }
        }
    }

    private fun retry(response: Response, session: StoredSession): Request = response.request.newBuilder()
        .header("Authorization", "Bearer ${session.accessToken}")
        .tag(AuthenticatedRequestSession::class.java, AuthenticatedRequestSession(session))
        .build()

    private fun responseCount(response: Response): Int {
        var result = 1
        var prior = response.priorResponse
        while (prior != null) {
            result += 1
            prior = prior.priorResponse
        }
        return result
    }
}

class NetworkPeerClient(context: Context) {
    val sessionStore = SecureSessionStore(context)
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }
    private val contentType = "application/json".toMediaType()
    private val requestedApiBaseUrl = BuildConfig.NETWORKPEER_API_BASE_URL.trim().let {
        if (it.endsWith('/')) it else "$it/"
    }
    private val requestedRealtimeUrl = BuildConfig.NETWORKPEER_REALTIME_URL.trim()
    private val runtimeApiUrlIsSafe = requestedApiBaseUrl.startsWith("https://") ||
        requestedApiBaseUrl.startsWith("http://")
    private val runtimeRealtimeUrlIsSafe = requestedRealtimeUrl.isBlank() ||
        requestedRealtimeUrl.startsWith("https://", ignoreCase = true) ||
        requestedRealtimeUrl.startsWith("wss://", ignoreCase = true) ||
        requestedRealtimeUrl.startsWith("http://", ignoreCase = true) ||
        requestedRealtimeUrl.startsWith("ws://", ignoreCase = true)
    val configuration = NetworkPeerPublicConfiguration(
        apiBaseUrl = requestedApiBaseUrl.takeIf { runtimeApiUrlIsSafe } ?: UNCONFIGURED_API_URL,
        apiConfigured = BuildConfig.NETWORKPEER_API_CONFIGURED && runtimeApiUrlIsSafe,
        stripePublishableKey = BuildConfig.NETWORKPEER_STRIPE_PUBLISHABLE_KEY.trim(),
        stripeConfigured = BuildConfig.NETWORKPEER_STRIPE_CONFIGURED,
        realtimeUrl = requestedRealtimeUrl,
        realtimeConfigured = BuildConfig.NETWORKPEER_REALTIME_CONFIGURED && runtimeRealtimeUrlIsSafe,
        realtimeSecureTransportRequired = BuildConfig.NETWORKPEER_REALTIME_SECURE_TRANSPORT_REQUIRED,
        realtimeOrigin = BuildConfig.NETWORKPEER_REALTIME_ORIGIN.trim(),
        fcmConfigured = BuildConfig.NETWORKPEER_FCM_CONFIGURED,
    )
    private val baseUrl = configuration.apiBaseUrl

    private val refreshClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val refreshApi = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(refreshClient)
        .addConverterFactory(json.asConverterFactory(contentType))
        .build()
        .create(TokenRefreshApi::class.java)

    private val authenticatedClient = OkHttpClient.Builder()
        .addInterceptor(AccessTokenInterceptor(sessionStore))
        .authenticator(RefreshTokenAuthenticator(sessionStore, refreshApi))
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

    val uploadClient = OkHttpClient.Builder()
        // The S3 target is presigned and intentionally receives no API bearer token.
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        // There was no writeTimeout here, so this inherited OkHttp's 10-second
        // default. That is a timeout on a single socket write stalling, not on
        // the whole body, which is exactly what happens on a congested rural
        // uplink once the TCP window fills -- so evidence uploads were being
        // abandoned mid-body on precisely the connections this has to work on.
        .writeTimeout(120, TimeUnit.SECONDS)
        // And there was no callTimeout, so a stalled upload could hang forever
        // while holding one of the drain's concurrency permits. Bounded just
        // under the presigned POST's own ten-minute expiry: past that the target
        // is dead anyway and the retry has to re-reserve to get a fresh one.
        .callTimeout(9, TimeUnit.MINUTES)
        .build()

    val api: NetworkPeerApi = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(authenticatedClient)
        .addConverterFactory(json.asConverterFactory(contentType))
        .build()
        .create(NetworkPeerApi::class.java)

    private companion object {
        const val UNCONFIGURED_API_URL = "https://api.invalid/api/v1/"
    }
}
