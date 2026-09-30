package com.networkpeer.mobile

import android.app.Application
import android.content.Context
import android.location.Location
import android.net.Uri
import androidx.lifecycle.ProcessLifecycleOwner
import com.stripe.android.PaymentConfiguration
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.networkpeer.mobile.core.data.AuthRepository
import com.networkpeer.mobile.core.data.DurableAppState
import com.networkpeer.mobile.core.data.MarketplaceRepository
import com.networkpeer.mobile.core.data.SyncRepository
import com.networkpeer.mobile.core.evidence.DurableEvidenceUploadQueue
import com.networkpeer.mobile.core.evidence.EvidenceUploadScheduler
import com.networkpeer.mobile.core.evidence.EvidenceUploader
import com.networkpeer.mobile.core.model.Point
import com.networkpeer.mobile.core.network.NetworkPeerClient
import com.networkpeer.mobile.core.notifications.FcmTokenRegistrar
import com.networkpeer.mobile.core.notifications.NetworkPeerNotifications
import com.networkpeer.mobile.core.realtime.RealtimeSyncManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.util.concurrent.CancellationException

class NetworkPeerApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        NetworkPeerNotifications.createChannel(this)
        if (container.client.configuration.stripeConfigured) {
            runCatching { PaymentConfiguration.init(this, container.client.configuration.stripePublishableKey) }
        }
        ProcessLifecycleOwner.get().lifecycle.addObserver(container.realtimeSyncManager)
        // An upload interrupted by the process dying used to resume only if the worker
        // reopened that exact job screen. Asking for a drain on every start is what
        // makes "the upload resumes even if I kill the app" true; the scheduler is a
        // no-op when the queue is empty.
        if (container.durableState.pendingEvidence.value.isNotEmpty()) {
            EvidenceUploadScheduler.schedule(this)
        }
    }
}

class AppContainer(context: Context) {
    private val applicationContext = context.applicationContext
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val client = NetworkPeerClient(applicationContext)
    val durableState = DurableAppState(applicationContext)
    val marketplaceRepository = MarketplaceRepository(client.api)
    val syncRepository = SyncRepository(marketplaceRepository, durableState, client.sessionStore)
    val evidenceUploader = EvidenceUploader(applicationContext.contentResolver, marketplaceRepository, client.uploadClient)
    val evidenceQueue = DurableEvidenceUploadQueue(applicationContext, evidenceUploader, durableState)
    val fcmTokenRegistrar = FcmTokenRegistrar(
        context = applicationContext,
        configuration = client.configuration,
        sessionStore = client.sessionStore,
        marketplaceRepository = marketplaceRepository,
        scope = applicationScope,
    )
    val authRepository = AuthRepository(
        api = client.api,
        client = client,
        onLogout = ::clearAccountData,
        deregisterDevice = fcmTokenRegistrar::deregisterForActiveUser,
    )
    val realtimeSyncManager = RealtimeSyncManager(
        configuration = client.configuration,
        sessionStore = client.sessionStore,
        syncRepository = syncRepository,
        scope = applicationScope,
    )
    private val locationClient = LocationServices.getFusedLocationProviderClient(applicationContext)
    private val _deepLinkedJobId = MutableStateFlow<String?>(null)
    val deepLinkedJobId = _deepLinkedJobId.asStateFlow()

    private val themePreferences = applicationContext.getSharedPreferences("networkpeer_theme", Context.MODE_PRIVATE)
    private val _themeMode = MutableStateFlow(themePreferences.getString("theme_mode", "system") ?: "system")
    val themeMode = _themeMode.asStateFlow()

    fun setThemeMode(mode: String) {
        _themeMode.value = mode
        themePreferences.edit().putString("theme_mode", mode).apply()
    }

    fun toggleTheme(isSystemDark: Boolean) {
        val current = _themeMode.value
        val effectiveDark = when (current) {
            "dark" -> true
            "light" -> false
            else -> isSystemDark
        }
        val next = if (effectiveDark) "light" else "dark"
        setThemeMode(next)
    }

    init {
        val initialUserId = client.sessionStore.current()?.user?.id
        durableState.activate(initialUserId)
        applicationScope.launch {
            var previousUserId = initialUserId
            client.sessionStore.session.collectLatest { session ->
                val userId = session?.user?.id
                if (previousUserId != null && previousUserId != userId) {
                    clearAccountData(previousUserId!!)
                }
                previousUserId = userId
                durableState.activate(userId)
                if (session == null) return@collectLatest
                fcmTokenRegistrar.registerWhenPossible()
                try {
                    syncRepository.reconcile(session.user.id)
                } catch (failure: CancellationException) {
                    throw failure
                } catch (_: Throwable) {
                    // Foreground UI and realtime recovery can retry a failed reconciliation.
                }
            }
        }
    }

    private fun clearAccountData(userId: String) {
        durableState.clearUserData(userId)
        NetworkPeerNotifications.cancelForAccount(applicationContext, userId)
    }

    fun handleDeepLink(uri: Uri?) {
        val jobId = uri
            ?.takeIf { it.scheme == "networkpeer" && it.host == "job" }
            ?.pathSegments
            ?.firstOrNull()
            ?.takeIf { it.isNotBlank() }
        if (jobId != null) _deepLinkedJobId.value = jobId
    }

    fun consumeDeepLink() {
        _deepLinkedJobId.value = null
    }

    fun reconcileFromPush(userId: String) {
        if (!client.sessionStore.isActiveUser(userId)) return
        applicationScope.launch {
            try {
                syncRepository.reconcile(userId)
            } catch (failure: CancellationException) {
                throw failure
            } catch (_: Throwable) {
                // Foreground and realtime recovery retry an unavailable sync API.
            }
        }
    }

    /**
     * Records a capture and asks for a background drain.
     *
     * Deliberately launched on applicationScope. The task screen used to await
     * `enqueueAndUpload` on its own `rememberCoroutineScope`, so a worker who took a
     * photo and went back to the feed cancelled their own upload. Nothing about
     * sending a file the camera has already written to local storage should depend on
     * a composable still being on screen.
     *
     * `onFailure` reports only the things that fail before the item is durable -- an
     * unreadable or oversized file. Once queued, failures belong to the queue and
     * surface per photo, not as a screen-level error.
     */
    fun queueEvidenceUpload(
        jobId: String,
        subtaskId: String,
        uri: Uri,
        attachLocation: Boolean,
        appOwnedUri: Boolean,
        onFailure: (Throwable) -> Unit,
    ) {
        applicationScope.launch {
            try {
                val location = if (attachLocation) {
                    currentOrLastLocation()?.let { Point.fromLatitudeLongitude(it.latitude, it.longitude) }
                } else {
                    null
                }
                evidenceQueue.enqueue(
                    jobId = jobId,
                    subtaskId = subtaskId,
                    uri = uri,
                    location = location,
                    appOwnedUri = appOwnedUri,
                )
                EvidenceUploadScheduler.schedule(applicationContext)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Throwable) {
                // The caller writes Compose state, which must not happen off the main
                // thread. applicationScope is Dispatchers.Default.
                withContext(Dispatchers.Main) { onFailure(failure) }
            }
        }
    }

    /** Re-drives the queue, for the retry affordance and on returning to a job. */
    fun kickEvidenceUploads() {
        if (evidenceQueue.hasRetryableWork()) EvidenceUploadScheduler.schedule(applicationContext)
    }

    /**
     * Clears one item's backoff and asks for a drain. Runs off the main thread because
     * DurableAppState persists with a synchronous SharedPreferences commit -- calling
     * this straight from a button's onClick would put that fsync back on the main
     * thread, which is the fault this change exists to remove.
     */
    fun retryEvidenceUpload(id: String) {
        applicationScope.launch {
            durableState.clearEvidenceBackoff(id)
            EvidenceUploadScheduler.schedule(applicationContext)
        }
    }

    suspend fun currentLocation(): Location? = currentOrLastLocation()

    suspend fun currentOrLastLocation(): Location? {
        val current = try {
            locationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null).await()
        } catch (_: Throwable) {
            null
        }
        if (current != null) return current
        return try {
            locationClient.lastLocation.await()
        } catch (_: Throwable) {
            null
        }
    }
}
