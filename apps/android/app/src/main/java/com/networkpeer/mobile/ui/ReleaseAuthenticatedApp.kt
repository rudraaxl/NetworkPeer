package com.networkpeer.mobile.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.net.Uri
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.WorkOutline
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import com.networkpeer.mobile.core.model.UserProfile
import com.networkpeer.mobile.core.model.UpdateProfileBody
import com.networkpeer.mobile.core.model.OCRResult
import com.networkpeer.mobile.core.model.NetworkPeerApiException
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.networkpeer.mobile.core.evidence.QualityCheckEngine
import com.networkpeer.mobile.core.model.WorkerRole

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.networkpeer.mobile.AppContainer
import com.networkpeer.mobile.R
import com.networkpeer.mobile.core.data.LocalInboxItem
import com.networkpeer.mobile.core.job.ClientJobDraft
import com.networkpeer.mobile.core.job.ClientJobDraftField
import com.networkpeer.mobile.core.job.ClientJobDraftIssue
import com.networkpeer.mobile.core.job.ClientJobDraftProblem
import com.networkpeer.mobile.core.job.ClientJobDraftValidator
import com.networkpeer.mobile.core.job.ClientJobSubtaskDraft
import com.networkpeer.mobile.core.evidence.EvidenceCapture
import com.networkpeer.mobile.core.model.ClientJobDetail
import com.networkpeer.mobile.core.model.ClientEvidenceReviewItem
import com.networkpeer.mobile.core.model.EscrowStatus
import com.networkpeer.mobile.core.model.Job
import com.networkpeer.mobile.core.model.JobStatus
import com.networkpeer.mobile.core.model.MediaStatus
import com.networkpeer.mobile.core.model.MediaType
import com.networkpeer.mobile.core.model.Point
import com.networkpeer.mobile.core.model.StoredSession
import com.networkpeer.mobile.core.model.SubtaskStatus
import com.networkpeer.mobile.core.model.UserRole
import com.networkpeer.mobile.core.model.WalletBalance
import com.networkpeer.mobile.core.model.NearbyJobsPage
import com.networkpeer.mobile.core.model.toWorkerJobSummary
import com.networkpeer.mobile.core.model.WorkerJobDetail
import com.networkpeer.mobile.core.model.WorkerJobSummary
import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.concurrent.CancellationException
import com.networkpeer.mobile.ui.components.Tone
import com.networkpeer.mobile.ui.theme.np
import com.networkpeer.mobile.ui.components.NpCard
import com.networkpeer.mobile.ui.components.NpMetric
import com.networkpeer.mobile.ui.theme.Space
import androidx.compose.ui.res.pluralStringResource
import com.networkpeer.mobile.ui.components.NpEmptyState
import com.networkpeer.mobile.ui.components.NpFilterPill
import com.networkpeer.mobile.ui.components.NpSearchField
import com.networkpeer.mobile.core.model.OcrStatus
import com.networkpeer.mobile.core.model.ReviewQueueItem
import com.networkpeer.mobile.ui.components.MoneySize
import com.networkpeer.mobile.ui.components.NpDetailRow
import com.networkpeer.mobile.ui.components.NpHairline
import com.networkpeer.mobile.ui.components.NpIconAction
import com.networkpeer.mobile.ui.components.NpLoading
import com.networkpeer.mobile.ui.components.NpMoney
import com.networkpeer.mobile.ui.components.NpPill
import com.networkpeer.mobile.ui.components.NpPrimaryButton
import com.networkpeer.mobile.ui.components.NpSecondaryButton
import com.networkpeer.mobile.ui.components.NpSectionHeader
import com.networkpeer.mobile.ui.components.NpStepBar
import com.networkpeer.mobile.ui.components.NpTextAction
import com.networkpeer.mobile.ui.components.NpTopBar
import androidx.compose.material.icons.outlined.Info
import com.networkpeer.mobile.ui.components.NpBanner
import androidx.compose.material.icons.outlined.BusinessCenter
import androidx.compose.ui.text.style.TextAlign

enum class AppNavTab {
    MY_JOBS,
    DASHBOARD_PROFILE,
}

/**
 * The discovery filters.
 *
 * These were a list of display strings, and the selected one was held as a
 * String and compared with `==` against the same literal -- including
 * "All (सभी)", so the filter's behaviour was tied to a piece of presentation
 * text in two languages. Translating that label would have silently broken
 * filtering. The label is now a resource and the identity is the enum.
 */
/**
 * The statuses in which a worker still owes the job something, in the order
 * the work actually happens. Anything past SUBMITTED is waiting on a reviewer
 * or already settled, and belongs in Earnings rather than at the top of the
 * feed. CANCELLED and DISPUTED are excluded for the same reason.
 */
private val ACTIVE_WORKER_STATUSES = listOf(
    JobStatus.ASSIGNED,
    JobStatus.EN_ROUTE,
    JobStatus.AT_LOCATION,
    JobStatus.IN_PROGRESS,
    JobStatus.SUBMITTED,
)

enum class JobFilter(val label: Int) {
    ALL(R.string.filter_all),
    NEARBY(R.string.filter_nearby),
    HIGH_PAY(R.string.filter_high_pay),
    URGENT(R.string.filter_urgent),
    ;

    fun matches(job: WorkerJobSummary): Boolean = when (this) {
        ALL -> true
        // The four bands are fixed by the API contract (contracts.ts):
        // UNDER_1_KM, 1_TO_5_KM, 5_TO_20_KM, 20KM_PLUS. Matching the server's
        // own bucketing avoids re-deriving a radius on the client from a
        // distance the client was never sent.
        NEARBY -> job.distance_band.equals("UNDER_1_KM", true) ||
            job.distance_band.equals("1_TO_5_KM", true)
        HIGH_PAY -> job.budget_cents >= 50_000L
        URGENT -> job.priority == 1
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReleaseAuthenticatedApp(container: AppContainer, session: StoredSession) {
    val scope = rememberCoroutineScope()
    val deepLinkedJobId by container.deepLinkedJobId.collectAsState()
    var workerJobId by rememberSaveable { mutableStateOf<String?>(null) }
    var workerPreviewJobId by rememberSaveable { mutableStateOf<String?>(null) }
    var inboxOpen by rememberSaveable { mutableStateOf(false) }

    var selectedTab by rememberSaveable { mutableStateOf(AppNavTab.MY_JOBS) }
    var profileEditMode by rememberSaveable { mutableStateOf(false) }
    var userMenuOpen by remember { mutableStateOf(false) }

    LaunchedEffect(deepLinkedJobId, session.user.role) {
        val jobId = deepLinkedJobId ?: return@LaunchedEffect
        // Only a worker has somewhere to open a job here.
        if (session.user.role == UserRole.WORKER) workerJobId = jobId
        container.consumeDeepLink()
    }

    val isDetailFlow = workerJobId != null || workerPreviewJobId != null || inboxOpen
    val themeMode by container.themeMode.collectAsState()
    val systemInDark = isSystemInDarkTheme()
    val isDark = when (themeMode) {
        "dark" -> true
        "light" -> false
        else -> systemInDark
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { BrandMark(compact = true) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                actions = {
                    IconButton(onClick = { container.toggleTheme(systemInDark) }) {
                        Icon(
                            imageVector = if (isDark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode,
                            contentDescription = if (isDark) "Switch to Light Mode" else "Switch to Dark Mode",
                            tint = MaterialTheme.np.ink,
                        )
                    }
                    IconButton(onClick = { inboxOpen = true }) {
                        Icon(Icons.Outlined.Inbox, contentDescription = stringResource(R.string.inbox))
                    }
                    Box {
                        IconButton(onClick = { userMenuOpen = true }) {
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.primaryContainer),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = if (session.user.role == UserRole.WORKER) "W" else "C",
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                    style = MaterialTheme.typography.labelLarge,
                                )
                            }
                        }
                        DropdownMenu(
                            expanded = userMenuOpen,
                            onDismissRequest = { userMenuOpen = false },
                        ) {
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(
                                            if (session.user.role == UserRole.WORKER) "Worker Account" else "Client Account",
                                            fontWeight = FontWeight.Bold,
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                        Text(
                                            session.user.phone,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                },
                                onClick = {},
                                enabled = false,
                            )
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("My Jobs") },
                                leadingIcon = { Icon(Icons.Outlined.WorkOutline, contentDescription = null) },
                                onClick = {
                                    userMenuOpen = false
                                    inboxOpen = false
                                    workerJobId = null
                                    workerPreviewJobId = null
                                    selectedTab = AppNavTab.MY_JOBS
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Dashboard & Profile") },
                                leadingIcon = { Icon(Icons.Outlined.Person, contentDescription = null) },
                                onClick = {
                                    userMenuOpen = false
                                    inboxOpen = false
                                    workerJobId = null
                                    workerPreviewJobId = null
                                    selectedTab = AppNavTab.DASHBOARD_PROFILE
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(if (isDark) "Appearance: Light Mode" else "Appearance: Dark Mode") },
                                leadingIcon = {
                                    Icon(
                                        imageVector = if (isDark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode,
                                        contentDescription = null,
                                        tint = MaterialTheme.np.ink,
                                    )
                                },
                                onClick = {
                                    userMenuOpen = false
                                    container.toggleTheme(systemInDark)
                                },
                            )
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.sign_out), color = MaterialTheme.colorScheme.error) },
                                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                                onClick = {
                                    userMenuOpen = false
                                    scope.launch { container.authRepository.logout() }
                                },
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (!isDetailFlow) {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 8.dp,
                    shadowElevation = 8.dp,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(72.dp)
                            .padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.SpaceAround,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // 1. LEFT ITEM: My Jobs
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .clickable {
                                    selectedTab = AppNavTab.MY_JOBS
                                }
                                .padding(vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            val isSelected = selectedTab == AppNavTab.MY_JOBS
                            Icon(
                                imageVector = Icons.Outlined.WorkOutline,
                                contentDescription = "My Jobs",
                                tint = if (isSelected) MaterialTheme.np.ink else MaterialTheme.np.inkFaint,
                                modifier = Modifier.size(24.dp),
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = "My Jobs",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSelected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        // A circular "+ Post a Job" button used to sit here,
                        // in the middle of the worker's navigation. Posting a
                        // job is a client action and now happens on the website.

                        // 3. RIGHT ITEM: Dashboard / Profile
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .clickable {
                                    selectedTab = AppNavTab.DASHBOARD_PROFILE
                                    profileEditMode = false
                                }
                                .padding(vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            val isSelected = selectedTab == AppNavTab.DASHBOARD_PROFILE
                            Icon(
                                imageVector = Icons.Outlined.Person,
                                contentDescription = "Dashboard / Profile",
                                tint = if (isSelected) MaterialTheme.np.ink else MaterialTheme.np.inkFaint,
                                modifier = Modifier.size(24.dp),
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = "Dashboard",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSelected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        androidx.compose.foundation.layout.Box(Modifier.padding(padding)) {
            if (inboxOpen) {
                ActivityInboxScreen(
                    container = container,
                    role = session.user.role,
                    onBack = { inboxOpen = false },
                    onOpenJob = { jobId ->
                        inboxOpen = false
                        // Only a worker has somewhere to open a job here.
                        if (session.user.role == UserRole.WORKER) workerJobId = jobId
                    },
                )
            } else {
                when (session.user.role) {
                    // This app is for workers. A client's tools -- posting a
                    // job, funding escrow, reviewing and releasing payment --
                    // live on the website, and the screens that used to render
                    // them here were a second, worse copy of it maintained by
                    // nobody. Signing a client in to a phone-sized version of
                    // that was never going to serve them.
                    UserRole.CLIENT -> WrongAppScreen(
                        onSignOut = { scope.launch { container.authRepository.logout() } },
                    )
                    UserRole.WORKER -> when {
                        workerPreviewJobId != null -> WorkerJobPreviewScreen(
                            container = container,
                            jobId = workerPreviewJobId!!,
                            onBack = { workerPreviewJobId = null },
                            onAccepted = { jobId ->
                                workerPreviewJobId = null
                                workerJobId = jobId
                            },
                        )
                        workerJobId != null -> WorkerTaskScreen(
                            container = container,
                            jobId = workerJobId!!,
                            onBack = { workerJobId = null },
                        )
                        else -> when (selectedTab) {
                            AppNavTab.MY_JOBS -> WorkerDiscoveryScreen(
                                container = container,
                                onOpenJob = { workerPreviewJobId = it },
                                // An accepted job opens the task screen. Routing
                                // it through the preview would offer "Accept" on
                                // a job this worker already holds.
                                onOpenActiveJob = { workerJobId = it },
                            )
                            AppNavTab.DASHBOARD_PROFILE -> WorkerDashboardProfileScreen(
                                container = container,
                                session = session,
                                onOpenJob = { workerPreviewJobId = it },
                                onGoToJobs = { selectedTab = AppNavTab.MY_JOBS },
                            )
                        }
                    }
                    UserRole.ADMIN -> AdminBoundaryScreen()
                }
            }
        }
    }
}

@Composable
private fun WorkerDashboardProfileScreen(
    container: AppContainer,
    session: StoredSession,
    onOpenJob: (String) -> Unit,
    onGoToJobs: () -> Unit,
) {
    var selectedSubTab by rememberSaveable { mutableStateOf(0) }
    var isEditMode by rememberSaveable { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        TabRow(
            selectedTabIndex = selectedSubTab,
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.primary,
        ) {
            Tab(
                selected = selectedSubTab == 0,
                onClick = { selectedSubTab = 0 },
                text = { Text("Overview", fontWeight = if (selectedSubTab == 0) FontWeight.Bold else FontWeight.Normal) },
                icon = { Icon(Icons.Outlined.Dashboard, contentDescription = null, modifier = Modifier.size(20.dp)) },
            )
            Tab(
                selected = selectedSubTab == 1,
                onClick = { selectedSubTab = 1 },
                text = { Text("Profile & Settings", fontWeight = if (selectedSubTab == 1) FontWeight.Bold else FontWeight.Normal) },
                icon = { Icon(Icons.Outlined.Person, contentDescription = null, modifier = Modifier.size(20.dp)) },
            )
        }

        Box(modifier = Modifier.weight(1f)) {
            if (selectedSubTab == 0) {
                WorkerDashboardScreen(
                    container = container,
                    onOpenJob = onOpenJob,
                    onGoToJobs = onGoToJobs,
                    onGoToWallet = { selectedSubTab = 1 },
                )
            } else {
                UserProfileScreen(
                    container = container,
                    session = session,
                    isEditMode = isEditMode,
                    onToggleEditMode = { isEditMode = it },
                )
            }
        }
    }
}

@Composable
private fun WorkerDashboardScreen(
    container: AppContainer,
    onOpenJob: (String) -> Unit,
    onGoToJobs: () -> Unit,
    onGoToWallet: () -> Unit,
) {
    val context = LocalContext.current
    var profile by remember { mutableStateOf<UserProfile?>(null) }
    var balances by remember { mutableStateOf<List<WalletBalance>>(emptyList()) }
    var nearbyJobs by remember { mutableStateOf<List<WorkerJobSummary>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        loading = true
        error = null
        try {
            profile = runCatching { container.authRepository.getProfile() }.getOrNull()
            balances = runCatching { container.marketplaceRepository.workerWallet().balances }.getOrElse { emptyList() }
            val fetchedJobs = runCatching { container.marketplaceRepository.allWorkerJobs(1, 10).items }.getOrNull()
            if (!fetchedJobs.isNullOrEmpty()) {
                nearbyJobs = fetchedJobs
            }
        } catch (f: Throwable) {
            error = friendlyError(context, f)
        } finally {
            // NP-15: an empty result is an empty list, not a reason to show
            // fabricated jobs a worker could try to accept.
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Card(
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f)),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .clip(RoundedCornerShape(24.dp))
                            .background(MaterialTheme.colorScheme.primary),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = profile?.fullName?.take(1)?.uppercase() ?: "W",
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Welcome back,", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            text = profile?.fullName ?: "Verified Worker",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    AssistChip(
                        onClick = {},
                        label = { Text("Verified", fontWeight = FontWeight.SemiBold) },
                        leadingIcon = { Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp)) },
                    )
                }
            }
        }

        // This row used to show three figures, two of which were string
        // literals: "98% reliability / Top performer" has no field behind it
        // anywhere in the API, and the rating read "4.9" for every worker who
        // has ever opened the app. The count fell back to 12 when the profile
        // failed to load, so a brand new worker was told they had done twelve
        // jobs. Only what the profile actually returns is shown now, and a
        // rating appears at all only once one exists.
        item {
            val workerProfile = profile?.workerProfile
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Space.md),
            ) {
                NpCard(modifier = Modifier.weight(1f), padding = Space.md) {
                    NpMetric(
                        label = stringResource(R.string.metric_completed),
                        value = "${workerProfile?.totalJobsCompleted ?: 0}",
                    )
                }
                NpCard(modifier = Modifier.weight(1f), padding = Space.md) {
                    val rating = workerProfile?.rating ?: 0.0
                    NpMetric(
                        label = stringResource(R.string.metric_rating),
                        value = if (rating > 0.0) String.format(Locale.US, "%.1f", rating) else "—",
                        caption = if (rating > 0.0) null else stringResource(R.string.metric_rating_none),
                    )
                }
            }
        }

        item {
            Card(
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
                modifier = Modifier.fillMaxWidth().clickable { onGoToJobs() },
            ) {
                Row(
                    Modifier.padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Find Nearby Work", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimary)
                        Text(stringResource(R.string.browse_nearby_body, nearbyJobs.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f))
                    }
                    Icon(Icons.Outlined.WorkOutline, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(28.dp))
                }
            }
        }

        item {
            Card(
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                modifier = Modifier.fillMaxWidth().clickable { onGoToWallet() },
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Earnings & Wallet", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text("View Details >", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    }
                    if (balances.isEmpty()) {
                        Text("Wallet ready", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        val b = balances.first()
                        Text(formatMoney(b.availableBalanceCents.toLongOrNull() ?: 0L, b.currency), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        if (b.lifetimeEarningsCents.toLongOrNull() != null) {
                            Text("Lifetime earnings: ${formatMoney(b.lifetimeEarningsCents.toLong(), b.currency)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = stringResource(R.string.nearby_work),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = stringResource(R.string.nearby_work_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                TextButton(onClick = onGoToJobs) {
                    Text(
                        text = "View All (${nearbyJobs.size}) >",
                        color = MaterialTheme.np.attention,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        items(nearbyJobs.take(3), key = { "dash-${it.id}" }) { gig ->
            WorkerSummaryCard(gig, onClick = { onOpenJob(gig.id) })
        }
    }
}

@Composable
private fun WorkerWalletOnlyScreen(container: AppContainer) {
    val context = LocalContext.current
    var balances by remember { mutableStateOf<List<WalletBalance>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        loading = true
        error = null
        try {
            balances = container.marketplaceRepository.workerWallet().balances
        } catch (f: Throwable) {
            error = friendlyError(context, f)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Worker Wallet", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Track your payouts and completed task earnings", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { scope.launch { load() } }, enabled = !loading) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "Refresh wallet")
                }
            }
        }
        item { WalletCard(balances) }
        error?.let { item { InlineNotice(it, Tone.Danger) } }
        if (loading) item { LoadingCard("Refreshing balance...") }
    }
}

@Composable
private fun UserProfileScreen(
    container: AppContainer,
    session: StoredSession,
    isEditMode: Boolean,
    onToggleEditMode: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf<UserProfile?>(null) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var successMsg by remember { mutableStateOf<String?>(null) }

    var email by rememberSaveable { mutableStateOf("") }
    var radiusKm by rememberSaveable { mutableStateOf(50) }
    var isAvailable by rememberSaveable { mutableStateOf(true) }

    suspend fun load() {
        loading = true
        error = null
        try {
            val p = container.authRepository.getProfile()
            profile = p
            email = p.email ?: ""
            radiusKm = p.workerProfile?.preferredRadiusKm ?: 50
            isAvailable = p.workerProfile?.isAvailable ?: true
        } catch (f: Throwable) {
            val fallbackName = session.user.fullName.ifBlank { "Verified Worker" }
            profile = UserProfile(
                id = session.user.id,
                phoneNumber = session.user.phone,
                fullName = fallbackName,
                role = session.user.role,
                isVerified = true
            )
            if (f is NetworkPeerApiException && (f.statusCode == 404 || f.code.contains("404"))) {
                // Profile row does not exist yet on backend; session fallback active silently
            } else {
                error = friendlyError(context, f)
            }
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    fun save() {
        scope.launch {
            saving = true
            error = null
            successMsg = null
            try {
                val updated = container.authRepository.updateProfile(
                    UpdateProfileBody(
                        email = email.trim().ifEmpty { null },
                        preferredRadiusKm = if (session.user.role == UserRole.WORKER) radiusKm else null,
                        isAvailable = if (session.user.role == UserRole.WORKER) isAvailable else null,
                    ),
                )
                profile = updated
                successMsg = "Profile updated successfully!"
                onToggleEditMode(false)
            } catch (f: Throwable) {
                error = friendlyError(context, f)
            } finally {
                saving = false
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = if (isEditMode) "Edit Profile" else "Your Profile",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = if (isEditMode) "Verified identity credentials remain locked" else "Verified identity and credentials",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!isEditMode) {
                    Button(onClick = { onToggleEditMode(true) }) {
                        Icon(Icons.Outlined.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Edit")
                    }
                } else {
                    OutlinedButton(onClick = { onToggleEditMode(false) }) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Cancel")
                    }
                }
            }
        }

        successMsg?.let { msg ->
            item { InlineNotice(msg, Tone.Positive) }
        }

        error?.let { err ->
            item { InlineNotice(err, Tone.Danger) }
        }

        if (loading) {
            item { LoadingCard("Loading profile...") }
        } else {
            item {
                Card(
                    shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(56.dp)
                                .clip(RoundedCornerShape(28.dp))
                                .background(MaterialTheme.np.ink),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = (profile?.displayName ?: (if (session.user.role == UserRole.WORKER) "W" else "C")).take(1).uppercase(),
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.np.onInk,
                                style = MaterialTheme.typography.headlineSmall,
                            )
                        }
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = profile?.displayName ?: session.user.role.name,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                )
                                Spacer(Modifier.width(8.dp))
                                Icon(Icons.Outlined.CheckCircle, contentDescription = "Verified", tint = MaterialTheme.np.accent, modifier = Modifier.size(18.dp))
                            }
                            Text(
                                text = if (profile?.displayPhone.isNullOrBlank()) session.user.phone else profile!!.displayPhone,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                text = if (session.user.role == UserRole.WORKER) "Field Worker Account" else "Client Account",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.np.attention,
                            )
                        }
                    }
                }
            }

            if (isEditMode) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.np.attentionSoft),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, MaterialTheme.np.hairline),
                    ) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                            Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.np.attention, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text("Identity Protection Enforced", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.np.attention)
                                Text("Full Name and Phone Number are verified credentials bound to your SMS OTP and cannot be modified.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.np.inkMuted)
                            }
                        }
                    }
                }

                item {
                    OutlinedTextField(
                        value = profile?.displayName ?: "",
                        onValueChange = {},
                        enabled = false,
                        readOnly = true,
                        label = { Text("Full Name (Verified Identity)") },
                        trailingIcon = { Icon(Icons.Outlined.Lock, contentDescription = "Locked") },
                        supportingText = { Text("Locked: Identity verified via KYC") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                item {
                    OutlinedTextField(
                        value = if (profile?.displayPhone.isNullOrBlank()) session.user.phone else profile!!.displayPhone,
                        onValueChange = {},
                        enabled = false,
                        readOnly = true,
                        label = { Text("Phone Number (Verified Account)") },
                        trailingIcon = { Icon(Icons.Outlined.Lock, contentDescription = "Locked") },
                        supportingText = { Text("Locked: Verified SMS OTP login number") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                item {
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        enabled = true,
                        label = { Text("Email Address") },
                        placeholder = { Text("you@example.com") },
                        supportingText = { Text("For receipts, dispute updates and reports") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                if (session.user.role == UserRole.WORKER) {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text("Available for Dispatch", fontWeight = FontWeight.SemiBold)
                                        Text("Accept immediate job matches", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    Switch(checked = isAvailable, onCheckedChange = { isAvailable = it })
                                }
                                HorizontalDivider()
                                Text("Dispatch Radius: $radiusKm km", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                                Slider(
                                    value = radiusKm.toFloat(),
                                    onValueChange = { radiusKm = it.toInt() },
                                    valueRange = 5f..100f,
                                    steps = 18,
                                )
                            }
                        }
                    }
                }

                item {
                    Button(
                        onClick = { save() },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        enabled = !saving,
                    ) {
                        if (saving) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary)
                        } else {
                            Icon(Icons.Outlined.Save, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Save Changes", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            } else {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Account Details", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            HorizontalDivider()
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Full Name", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                val resolvedName = profile?.fullName?.ifBlank { session.user.fullName }
                                    ?: session.user.fullName.ifBlank { "Verified Worker" }
                                Text(resolvedName, fontWeight = FontWeight.SemiBold)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Phone Number", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(profile?.phoneNumber ?: session.user.phone, fontWeight = FontWeight.SemiBold)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Email", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(profile?.email?.ifEmpty { "Not set" } ?: "Not set", fontWeight = FontWeight.Medium)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("KYC Status", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("Tier 1 Verified", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                            }
                            if (session.user.role == UserRole.WORKER) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Dispatch Radius", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text("${profile?.workerProfile?.preferredRadiusKm ?: 50} km", fontWeight = FontWeight.SemiBold)
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("Availability", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(
                                        if (profile?.workerProfile?.isAvailable != false) "Online" else "Offline",
                                        color = if (profile?.workerProfile?.isAvailable != false) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                            }
                        }
                    }
                }

                item {
                    val themeMode by container.themeMode.collectAsState()
                    val systemInDark = isSystemInDarkTheme()
                    val isDark = when (themeMode) {
                        "dark" -> true
                        "light" -> false
                        else -> systemInDark
                    }
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.large,
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    if (isDark) Icons.Outlined.DarkMode else Icons.Outlined.LightMode,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(20.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text("Appearance & Theme", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                            }
                            Text(
                                "Choose how NetworkPeers looks on your device.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                for ((mode, label) in listOf("system" to "System", "light" to "Light", "dark" to "Dark")) {
                                    val selected = themeMode == mode
                                    Box(
                                        modifier = Modifier
                                            .weight(1f)
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                                            .clickable { container.setThemeMode(mode) }
                                            .padding(vertical = 10.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(
                                            text = label,
                                            style = MaterialTheme.typography.labelMedium,
                                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                            color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                item {
                    Button(
                        onClick = { onToggleEditMode(true) },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Icon(Icons.Outlined.Edit, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Edit Profile", fontWeight = FontWeight.Bold)
                    }
                }

                item {
                    OutlinedButton(
                        onClick = { scope.launch { container.authRepository.logout() } },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.width(8.dp))
                        Text("Sign Out", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun WalletCard(balances: List<WalletBalance>) {
    Card(
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.wallet), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (balances.isEmpty()) {
                Text(stringResource(R.string.wallet_empty), color = MaterialTheme.colorScheme.onPrimaryContainer)
            } else {
                balances.forEach { balance ->
                    Text(formatMoney(balance.availableBalanceCents.toLongOrNull() ?: 0L, balance.currency), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text(
                        stringResource(
                            R.string.wallet_escrow_spend,
                            formatMoney(balance.pendingEscrowCents.toLongOrNull() ?: 0L, balance.currency),
                            formatMoney(balance.lifetimeSpendCents.toLongOrNull() ?: 0L, balance.currency),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (balance.lifetimeEarningsCents.toLongOrNull() != null) {
                        Text(
                            stringResource(R.string.wallet_earnings, formatMoney(balance.lifetimeEarningsCents.toLong(), balance.currency)),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkerDiscoveryScreen(
    container: AppContainer,
    onOpenJob: (String) -> Unit,
    onOpenActiveJob: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val isDark = isSystemInDarkTheme()
    var jobs by remember { mutableStateOf<List<WorkerJobSummary>>(emptyList()) }
    var balances by remember { mutableStateOf<List<WalletBalance>>(emptyList()) }
    var searchQuery by remember { mutableStateOf("") }
    var selectedFilter by remember { mutableStateOf(JobFilter.ALL) }
    var nextPage by remember { mutableStateOf(1) }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Jobs this worker has already accepted. They arrive as snapshot_jobs from
    // GET /worker/sync -- every row where jobs.worker_id is this worker -- and
    // are already kept in durable state, so this needs no extra request.
    //
    // They cannot appear twice: the discovery feed is built by
    // listAllPostedJobs, whose WHERE clause includes `j.worker_id IS NULL`, so
    // a job leaves the feed the moment it is accepted. Without this section it
    // simply vanished, with nothing to show where it had gone.
    val assignedJobs by container.durableState.workerJobs.collectAsState()
    val activeJobs = remember(assignedJobs) {
        assignedJobs
            .filter { it.status in ACTIVE_WORKER_STATUSES }
            .sortedBy { ACTIVE_WORKER_STATUSES.indexOf(it.status) }
    }

    suspend fun loadJobs(reset: Boolean = true) {
        if (loading && !reset) return
        loading = true
        error = null
        try {
            try {
                val location = container.currentOrLastLocation()
                if (location != null) {
                    container.marketplaceRepository.updateWorkerLocation(location.latitude, location.longitude)
                    reconcileSafely(container)
                }
            } catch (_: Throwable) {}
            // NP-15: when both calls failed this substituted a hardcoded job
            // list, so an outage looked like available work. The failure now
            // reaches the catch below and is shown to the worker.
            // Nearby first. listAllPostedJobs returns the literal string
            // '1_TO_5_KM' for every row -- only the nearby query computes a
            // real distance_band, and only when the worker's location is
            // fresh, which is why the location is posted just above. Asking
            // /all first meant every job claimed the same distance and the
            // "Nearby" filter matched everything.
            //
            // There is no empty-screen risk in preferring it: the service
            // falls back to listAll server-side when it has no usable
            // location, so this ordering can only add information.
            val response = try {
                container.marketplaceRepository.nearbyWorkerJobs(
                    radiusKm = null,
                    page = if (reset) 1 else nextPage,
                )
            } catch (_: Throwable) {
                container.marketplaceRepository.allWorkerJobs(
                    page = if (reset) 1 else nextPage,
                )
            }
            val loadedItems = response.items
            jobs = if (reset) loadedItems else (jobs + loadedItems).distinctBy { it.id }
            nextPage = response.next_page ?: (response.page + 1)
            hasMore = response.has_more && response.next_page != null
            if (reset) {
                try {
                    balances = container.marketplaceRepository.workerWallet().balances
                } catch (_: Throwable) {}
            }
        } catch (failure: Throwable) {
            error = friendlyError(context, failure)
            if (reset) jobs = emptyList()
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        loadJobs(reset = true)
    }

    val filteredJobs = remember(jobs, searchQuery, selectedFilter) {
        val base = jobs
        base.filter { job ->
            val q = searchQuery.trim().lowercase()
            val matchesQuery = q.isEmpty() ||
                job.title.lowercase().contains(q) ||
                job.description.lowercase().contains(q) ||
                job.distance_band.lowercase().contains(q) ||
                job.category.lowercase().contains(q)

            val matchesFilter = selectedFilter.matches(job)

            matchesQuery && matchesFilter
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Work in hand comes before work on offer. A worker mid-job opens this
        // screen to continue it, not to browse -- so the accepted jobs sit at
        // the top and the feed starts below them.
        if (activeJobs.isNotEmpty()) {
            item {
                NpSectionHeader(
                    title = stringResource(R.string.your_active_jobs),
                    subtitle = pluralStringResource(
                        R.plurals.jobs_in_progress,
                        activeJobs.size,
                        activeJobs.size,
                    ),
                )
            }
            items(activeJobs, key = { "active-${'$'}{it.id}" }) { job ->
                ActiveJobCard(job = job, onClick = { onOpenActiveJob(job.id) })
            }
            item { NpHairline(Modifier.padding(vertical = Space.sm)) }
        }

        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                NpSectionHeader(
                    modifier = Modifier.weight(1f),
                    title = stringResource(R.string.available_jobs),
                    subtitle = pluralStringResource(R.plurals.jobs_open, filteredJobs.size, filteredJobs.size),
                )
                NpIconAction(
                    icon = Icons.Outlined.Refresh,
                    contentDescription = stringResource(R.string.refresh),
                    enabled = !loading,
                    onClick = { scope.launch { loadJobs(reset = true) } },
                )
            }
        }

        if (container.client.configuration.fcmConfigured) item { NotificationPermissionCard() }
        item { WalletCard(balances) }

        item {
            NpSearchField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = stringResource(R.string.search_jobs_hint),
            )
        }

        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Space.sm),
            ) {
                JobFilter.entries.forEach { filter ->
                    NpFilterPill(
                        label = stringResource(filter.label),
                        selected = selectedFilter == filter,
                        onClick = { selectedFilter = filter },
                    )
                }
            }
        }

        // A "Live On-Demand Marketplace" card sat here, announcing
        // "High-priority gigs across Bengaluru - High-accuracy OCR enabled".
        // Neither claim came from anywhere: the job list is whatever the API
        // returns, and OCR currently reports itself unavailable. It cost a
        // sixth of the screen to tell the worker nothing they could act on,
        // so the space goes to the job list instead.

        error?.let { item { InlineNotice(it, Tone.Danger) } }

        if (filteredJobs.isEmpty() && !loading && error == null) item {
            val filtered = searchQuery.isNotBlank() || selectedFilter != JobFilter.ALL
            NpEmptyState(
                // Two different situations were shown the same way. "Nothing
                // matched your filter" and "there is no work near you right
                // now" need different words, because only one of them is
                // something the worker can do anything about.
                title = if (filtered) {
                    stringResource(R.string.no_matching_jobs)
                } else {
                    stringResource(R.string.no_available_jobs)
                },
                message = if (filtered) {
                    stringResource(R.string.no_matching_jobs_body)
                } else {
                    stringResource(R.string.no_available_jobs_body)
                },
                icon = Icons.Outlined.WorkOutline,
                actionLabel = if (filtered) stringResource(R.string.reset_filters) else null,
                onAction = if (filtered) {
                    {
                        searchQuery = ""
                        selectedFilter = JobFilter.ALL
                    }
                } else {
                    null
                },
            )
        }

        items(filteredJobs, key = { it.id }) { job ->
            WorkerSummaryCard(job, onClick = { onOpenJob(job.id) })
        }

        if (hasMore) item {
            OutlinedButton(
                onClick = { scope.launch { loadJobs(reset = false) } },
                modifier = Modifier.fillMaxWidth(),
                enabled = !loading
            ) {
                Text(stringResource(R.string.load_more))
            }
        }
    }
}

@Composable
private fun UriImagePreview(uri: Uri, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var bitmap by remember(uri) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(uri) {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    android.graphics.BitmapFactory.decodeStream(stream)
                }
            }.getOrNull()
        }?.let { bitmap = it }
    }
    bitmap?.let {
        Image(
            bitmap = it.asImageBitmap(),
            contentDescription = "Captured preview",
            modifier = modifier,
            contentScale = ContentScale.Fit,
        )
    } ?: run {
        Box(modifier = modifier, contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.size(32.dp))
        }
    }
}

@Composable
private fun AsyncImagePreview(
    urlOrUri: String,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit,
) {
    val context = LocalContext.current
    var bitmap by remember(urlOrUri) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(urlOrUri) {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                if (urlOrUri.startsWith("http://") || urlOrUri.startsWith("https://")) {
                    java.net.URL(urlOrUri).openStream().use { stream ->
                        android.graphics.BitmapFactory.decodeStream(stream)
                    }
                } else {
                    context.contentResolver.openInputStream(Uri.parse(urlOrUri))?.use { stream ->
                        android.graphics.BitmapFactory.decodeStream(stream)
                    }
                }
            }.getOrNull()
        }?.let { bitmap = it }
    }
    bitmap?.let {
        Image(
            bitmap = it.asImageBitmap(),
            contentDescription = "Image preview",
            modifier = modifier,
            contentScale = contentScale,
        )
    } ?: run {
        Box(modifier = modifier, contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
private fun FullScreenImageDialog(urlOrUri: String, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.95f)),
        ) {
            AsyncImagePreview(
                urlOrUri = urlOrUri,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                contentScale = ContentScale.Fit,
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp),
            ) {
                Icon(Icons.Outlined.Close, contentDescription = "Close", tint = Color.White)
            }
        }
    }
}

/**
 * What the text-extraction panel has to show for one piece of evidence.
 *
 * [status] is required rather than inferred. The previous dialog took only an
 * optional result and a raw-text fallback, so "no OCR has run" and "OCR ran and
 * found nothing" rendered identically -- and every caller passed it invented
 * text anyway.
 */
/** The one place `ocr_status` is turned into words a reviewer reads. */
@Composable
private fun ocrStatusLabel(status: OcrStatus): String = stringResource(
    when (status) {
        OcrStatus.READY -> R.string.ocr_status_ready
        OcrStatus.PROCESSING -> R.string.ocr_status_processing
        OcrStatus.FAILED -> R.string.ocr_status_failed
        OcrStatus.UNAVAILABLE -> R.string.ocr_status_unavailable
    },
)

data class OcrDialogPayload(
    val title: String,
    val status: OcrStatus,
    val result: OCRResult? = null,
)

/**
 * The text extracted from a photograph, or an honest account of why there
 * isn't any.
 *
 * No endpoint in this system returns anything but `ocr_status: "unavailable"`
 * today -- no OCR engine runs and no column stores a result. The READY branch
 * is written against the real `OCRResult` contract so that the day extraction
 * is switched on, this renders it without being touched. Until then the panel
 * says so plainly instead of showing a transcript nobody produced.
 */
@Composable
private fun OcrEvidenceDialog(
    title: String,
    status: OcrStatus,
    result: OCRResult?,
    onDismiss: () -> Unit,
) {
    val c = MaterialTheme.np
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    val transcript = result?.text?.takeIf { it.isNotBlank() }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .fillMaxSize()
                .background(c.canvas),
        ) {
            NpTopBar(
                title = title,
                onBack = onDismiss,
                actions = {
                    if (status == OcrStatus.READY && transcript != null) {
                        NpTextAction(
                            label = if (copied) {
                                stringResource(R.string.copied)
                            } else {
                                stringResource(R.string.copy_text)
                            },
                            onClick = {
                                clipboard.setText(AnnotatedString(transcript))
                                copied = true
                            },
                        )
                    }
                },
            )

            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Space.lg),
                verticalArrangement = Arrangement.spacedBy(Space.lg),
            ) {
                when (status) {
                    OcrStatus.UNAVAILABLE -> NpBanner(
                        title = stringResource(R.string.ocr_unavailable_title),
                        message = stringResource(R.string.ocr_unavailable_body),
                        tone = Tone.Neutral,
                        icon = Icons.Outlined.Info,
                    )

                    OcrStatus.PROCESSING -> {
                        NpBanner(
                            title = stringResource(R.string.ocr_processing_title),
                            message = stringResource(R.string.ocr_processing_body),
                            tone = Tone.Attention,
                            icon = Icons.Outlined.Info,
                        )
                        NpLoading()
                    }

                    OcrStatus.FAILED -> NpBanner(
                        title = stringResource(R.string.ocr_failed_title),
                        message = stringResource(R.string.ocr_failed_body),
                        tone = Tone.Danger,
                        icon = Icons.Outlined.Warning,
                    )

                    OcrStatus.READY -> {
                        if (transcript == null) {
                            // Extraction finished and found no legible text.
                            // That is a result, and a different one from a
                            // failure, so it gets its own words.
                            NpBanner(
                                title = stringResource(R.string.ocr_empty_title),
                                message = stringResource(R.string.ocr_empty_body),
                                tone = Tone.Neutral,
                                icon = Icons.Outlined.Info,
                            )
                        } else {
                            NpCard {
                                Text(
                                    text = transcript,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontFamily = FontFamily.Monospace,
                                    color = c.ink,
                                )
                            }
                            // Only what the server actually sent. A missing
                            // confidence is left out rather than defaulted.
                            result.confidence?.let { confidence ->
                                NpDetailRow(
                                    label = stringResource(R.string.ocr_confidence),
                                    value = "${(confidence * 100).toInt()}%",
                                )
                            }
                            result.language?.let {
                                NpDetailRow(label = stringResource(R.string.ocr_language), value = it)
                            }
                            result.engineVersion?.let {
                                NpDetailRow(label = stringResource(R.string.ocr_engine), value = it)
                            }
                        }
                    }
                }
            }
        }
    }
}


/**
 * A job this worker has already accepted.
 *
 * It reads differently from a job on offer on purpose: the payout is stated
 * quietly because the decision to take it has been made, and the thing given
 * weight is how much of the evidence is still outstanding -- which is the only
 * question a worker mid-job is actually asking.
 */
@Composable
private fun ActiveJobCard(job: WorkerJobDetail, onClick: () -> Unit) {
    val required = job.subtasks.filter { it.is_required }
    val done = required.count { it.status == SubtaskStatus.COMPLETED }
    val total = required.size

    NpCard(onClick = onClick) {
        Column(verticalArrangement = Arrangement.spacedBy(Space.md)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(job.status)
                Spacer(Modifier.weight(1f))
                NpMoney(
                    amount = formatMoney(job.budget_cents, job.currency),
                    size = MoneySize.Small,
                    color = MaterialTheme.np.inkMuted,
                )
            }

            Text(
                text = job.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.np.ink,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            job.address?.takeIf { it.isNotBlank() }?.let { address ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.LocationOn,
                        contentDescription = null,
                        tint = MaterialTheme.np.inkFaint,
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.width(Space.xs))
                    Text(
                        text = address,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.np.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            // Only shown when the job actually declares required subtasks;
            // rendering "0 of 0 captured" would be worse than saying nothing.
            if (total > 0) {
                NpStepBar(steps = total, current = done)
                Text(
                    text = stringResource(R.string.evidence_progress, done, total),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.np.inkMuted,
                )
            }

            NpPrimaryButton(
                label = if (job.status == JobStatus.SUBMITTED) {
                    stringResource(R.string.view_submission)
                } else {
                    stringResource(R.string.continue_job)
                },
                onClick = onClick,
            )
        }
    }
}

@Composable
private fun WorkerSummaryCard(job: WorkerJobSummary, onClick: () -> Unit) {
    val isDark = isSystemInDarkTheme()
    Card(
        modifier = Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.np.paper
        ),
        border = BorderStroke(
            1.dp,
            MaterialTheme.np.hairline
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = job.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.width(8.dp))
                Box(
                    modifier = Modifier
                        .background(MaterialTheme.np.ink, shape = RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                ) {
                    Text(
                        text = formatMoney(job.budget_cents, job.currency),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                        color = MaterialTheme.np.onInk
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    modifier = Modifier
                        .background(
                            MaterialTheme.np.fill,
                            shape = RoundedCornerShape(6.dp)
                        )
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = if (job.capacity_mode == "unlimited") "Unlimited · ${job.joined_workers ?: 1} joined" else "Single spot",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.np.inkMuted
                    )
                }
                Box(
                    modifier = Modifier
                        .background(
                            MaterialTheme.np.fill,
                            shape = RoundedCornerShape(6.dp)
                        )
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = job.distance_band.replace('_', ' ').uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.np.inkMuted
                    )
                }
            }

            Text(
                text = job.description,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Button(
                onClick = onClick,
                modifier = Modifier.fillMaxWidth().height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.np.ink,
                    contentColor = MaterialTheme.np.onInk
                )
            ) {
                Text(
                    text = stringResource(R.string.review_task),
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.labelLarge
                )
            }
        }
    }
}


@Composable
private fun WorkerJobPreviewScreen(
    container: AppContainer,
    jobId: String,
    onBack: () -> Unit,
    onAccepted: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // NP-15: seeded with a fabricated job, so the screen showed invented work
    // before any request completed -- and kept showing it if the request failed.
    var detail by remember { mutableStateOf<WorkerJobDetail?>(null) }
    var loading by remember { mutableStateOf(false) }
    var accepting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedRole by rememberSaveable { mutableStateOf(WorkerRole.collectionist) }

    // Correctionist Review Queue State
    var reviewQueue by remember { mutableStateOf<List<ReviewQueueItem>>(emptyList()) }
    var loadingQueue by remember { mutableStateOf(false) }
    var queueError by remember { mutableStateOf<String?>(null) }
    var queueActionInProgress by remember { mutableStateOf<String?>(null) }
    var fullScreenImageTarget by remember { mutableStateOf<String?>(null) }
    var fullScreenOcrTarget by remember { mutableStateOf<OcrDialogPayload?>(null) }

    var isCorrectionistApproved by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            detail = container.marketplaceRepository.workerJob(jobId)
            error = null
        } catch (failure: Throwable) {
            error = friendlyError(context, failure)
        } finally {
            loading = false
        }
    }

    suspend fun loadQueue() {
        if (!isCorrectionistApproved) return
        loadingQueue = true
        try {
            val response = container.marketplaceRepository.workerReviewQueue(jobId)
            reviewQueue = response.submissions
            queueError = null
        } catch (failure: Throwable) {
            // This used to be swallowed with "Handled gracefully", which meant
            // that the decoding failure this screen hit on every single load
            // showed up as an empty queue rather than as a problem.
            queueError = friendlyError(context, failure)
        } finally {
            loadingQueue = false
        }
    }

    /** Approve the evidence, or send it back to the worker to retake. */
    fun submitReview(submissionId: String, decision: String) {
        scope.launch {
            queueActionInProgress = submissionId
            try {
                container.marketplaceRepository.reviewSubmission(submissionId, decision)
                loadQueue()
            } catch (failure: Throwable) {
                queueError = friendlyError(context, failure)
            } finally {
                queueActionInProgress = null
            }
        }
    }

    LaunchedEffect(jobId) {
        val p = runCatching { container.authRepository.getProfile() }.getOrNull()
        isCorrectionistApproved = p?.workerProfile?.eligibleRoles?.contains("correctionist") == true ||
            p?.eligibleRoles?.contains("correctionist") == true
        load()
        if (isCorrectionistApproved) {
            loadQueue()
        }
    }

    fullScreenImageTarget?.let { url ->
        FullScreenImageDialog(urlOrUri = url, onDismiss = { fullScreenImageTarget = null })
    }
    fullScreenOcrTarget?.let { payload ->
        OcrEvidenceDialog(
            title = payload.title,
            status = payload.status,
            result = payload.result,
            onDismiss = { fullScreenOcrTarget = null },
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { BackHeader(stringResource(R.string.task_preview), onBack) }
        if (loading) item { LoadingCard(stringResource(R.string.loading)) }
        error?.let { item { InlineNotice(it, Tone.Danger) } }
        detail?.let { task ->
            item {
                Card(shape = MaterialTheme.shapes.large) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(task.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            StatusPill(task.status)
                        }
                        Text(task.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(formatMoney(task.budget_cents, task.currency), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            AssistChip(
                                onClick = {},
                                label = {
                                    Text(
                                        if (task.capacity_mode == "unlimited") "Capacity: Unlimited (${task.joined_workers ?: 1} active)"
                                        else "Capacity: Single Worker"
                                    )
                                },
                            )
                        }
                        Text(stringResource(R.string.job_location), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                        Text(
                            task.address?.ifBlank { null }
                                ?: if (task.location != null) "Location coordinates: ${task.location.coordinates[1]}, ${task.location.coordinates[0]}"
                                else stringResource(R.string.address_unavailable)
                        )
                    }
                }
            }

            // Role Switcher TabRow - strictly gated for admin-approved correctionists only (§22)
            if (isCorrectionistApproved) {
                item {
                    TabRow(
                        selectedTabIndex = if (selectedRole == WorkerRole.collectionist) 0 else 1,
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                    ) {
                        Tab(
                            selected = selectedRole == WorkerRole.collectionist,
                            onClick = { selectedRole = WorkerRole.collectionist },
                            text = { Text("Collect (Worker)", fontWeight = FontWeight.SemiBold) },
                        )
                        Tab(
                            selected = selectedRole == WorkerRole.correctionist,
                            onClick = {
                                selectedRole = WorkerRole.correctionist
                                scope.launch { loadQueue() }
                            },
                            text = {
                                Text(
                                    if (reviewQueue.isNotEmpty()) "Correct (${reviewQueue.size})" else "Correct (Review)",
                                    fontWeight = FontWeight.SemiBold,
                                )
                            },
                        )
                    }
                }
            }

            if (selectedRole == WorkerRole.collectionist) {
                item {
                    Text(stringResource(R.string.job_checklist), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    task.subtasks.sortedBy { it.sequence_order }.forEach { subtask ->
                        AssistChip(
                            onClick = {},
                            label = { Text(if (subtask.is_required) stringResource(R.string.required_subtask, subtask.title) else stringResource(R.string.optional_subtask, subtask.title)) },
                        )
                    }
                }
                if (!task.is_assigned_to_requester) item {
                    Button(
                        onClick = {
                            scope.launch {
                                accepting = true
                                try {
                                    container.marketplaceRepository.acceptWorkerJob(jobId)
                                    reconcileSafely(container)
                                    onAccepted(jobId)
                                } catch (failure: Throwable) {
                                    error = friendlyError(context, failure)
                                } finally {
                                    accepting = false
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !accepting,
                    ) {
                        if (accepting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        else Text(stringResource(R.string.accept_securely))
                    }
                } else {
                    item {
                        Button(
                            onClick = { onAccepted(jobId) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Proceed to Live Task")
                        }
                    }
                }
            } else {
                // Correctionist Review Queue
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Correctionist Review Queue", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("Review worker submissions before client release", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(
                            onClick = { scope.launch { loadQueue() } },
                            enabled = !loadingQueue,
                        ) {
                            Icon(Icons.Outlined.Refresh, contentDescription = "Refresh")
                        }
                    }
                }

                if (loadingQueue) {
                    item { LoadingCard("Loading review queue...") }
                } else if (reviewQueue.isEmpty()) {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                        ) {
                            Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.np.accent, modifier = Modifier.size(36.dp))
                                Spacer(Modifier.height(8.dp))
                                Text("Queue is clean", fontWeight = FontWeight.Bold)
                                Text("No pending submissions awaiting correctionist review for this job.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                } else {
                    items(reviewQueue, key = { it.id }) { submission ->
                        NpCard {
                            Column(verticalArrangement = Arrangement.spacedBy(Space.md)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            text = stringResource(R.string.evidence_item),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.np.inkFaint,
                                        )
                                        Text(
                                            // The queue has no unit reference:
                                            // the handler projects the stored
                                            // media row, which has an id and a
                                            // subtask, and nothing else to name
                                            // it by.
                                            text = submission.capturedAt?.take(10)
                                                ?: stringResource(R.string.evidence_item),
                                            style = MaterialTheme.typography.titleMedium,
                                            color = MaterialTheme.np.ink,
                                        )
                                    }
                                    NpPill(
                                        label = ocrStatusLabel(submission.ocrStatus),
                                        tone = when (submission.ocrStatus) {
                                            OcrStatus.READY -> Tone.Positive
                                            OcrStatus.FAILED -> Tone.Danger
                                            OcrStatus.PROCESSING -> Tone.Attention
                                            OcrStatus.UNAVAILABLE -> Tone.Neutral
                                        },
                                    )
                                }

                                // media is null when the stored row has no S3
                                // version id, so there is nothing to sign.
                                val mediaUrl = submission.media?.url
                                if (mediaUrl != null) {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(200.dp)
                                            .clip(RoundedCornerShape(12.dp))
                                            .background(MaterialTheme.np.fill),
                                    ) {
                                        AsyncImagePreview(
                                            urlOrUri = mediaUrl,
                                            modifier = Modifier.fillMaxSize(),
                                            contentScale = ContentScale.Fit,
                                        )
                                        NpIconAction(
                                            icon = Icons.Outlined.Fullscreen,
                                            contentDescription = stringResource(R.string.expand_image),
                                            onClick = { fullScreenImageTarget = mediaUrl },
                                            modifier = Modifier
                                                .align(Alignment.BottomEnd)
                                                .padding(Space.sm),
                                        )
                                    }
                                } else {
                                    NpBanner(
                                        message = stringResource(R.string.evidence_media_missing),
                                        tone = Tone.Attention,
                                        icon = Icons.Outlined.Warning,
                                    )
                                }

                                submission.verificationNotes?.takeIf { it.isNotBlank() }?.let { note ->
                                    NpDetailRow(
                                        label = stringResource(R.string.verification_notes),
                                        value = note,
                                    )
                                }

                                // Resolved here rather than inside onClick:
                                // stringResource is @Composable and a click
                                // lambda is not a composable scope.
                                val extractedTextTitle = stringResource(R.string.extracted_text)
                                NpSecondaryButton(
                                    label = stringResource(R.string.view_extracted_text),
                                    icon = Icons.Outlined.Fullscreen,
                                    onClick = {
                                        fullScreenOcrTarget = OcrDialogPayload(
                                            title = extractedTextTitle,
                                            status = submission.ocrStatus,
                                            result = submission.ocrResult,
                                        )
                                    },
                                )

                                val isActing = queueActionInProgress == submission.id
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(Space.sm),
                                ) {
                                    Box(Modifier.weight(1f)) {
                                        NpSecondaryButton(
                                            label = stringResource(R.string.request_redo),
                                            enabled = !isActing,
                                            onClick = { submitReview(submission.id, "redo") },
                                        )
                                    }
                                    Box(Modifier.weight(1f)) {
                                        NpPrimaryButton(
                                            label = stringResource(R.string.approve),
                                            enabled = !isActing,
                                            loading = isActing,
                                            onClick = { submitReview(submission.id, "approve") },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkerTaskScreen(
    container: AppContainer,
    jobId: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pendingEvidence by container.durableState.pendingEvidence.collectAsState()
    val confirmedEvidence by container.durableState.confirmedEvidence.collectAsState()
    val cachedWorkerJobs by container.durableState.workerJobs.collectAsState()
    // NP-15: seeded with a fabricated job marked IN_PROGRESS and assigned to
    // this worker. Nothing had been assigned; the screen simply said so.
    var job by remember { mutableStateOf<WorkerJobDetail?>(null) }
    var loading by remember { mutableStateOf(false) }
    var updating by remember { mutableStateOf(false) }
    var uploadingSubtaskId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var includeLocation by rememberSaveable { mutableStateOf(false) }
    var selectedSubtaskId by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingCameraUri by rememberSaveable { mutableStateOf<String?>(null) }

    suspend fun reload() {
        try {
            job = container.marketplaceRepository.workerJob(jobId)
            error = null
        } catch (failure: Throwable) {
            // The durable cache holds previously fetched real jobs, so falling
            // back to it is honest in a way that inventing one was not.
            job = cachedWorkerJobs.firstOrNull { it.id == jobId } ?: job
            if (job == null) error = friendlyError(context, failure)
        } finally {
            loading = false
        }
    }

    fun enqueueEvidence(subtaskId: String, uri: Uri, appOwnedUri: Boolean) {
        val activeJob = job ?: return
        scope.launch {
            uploadingSubtaskId = subtaskId
            try {
                val location = if (includeLocation && hasLocationPermission(context)) {
                    container.currentOrLastLocation()?.toPoint()
                } else {
                    null
                }
                container.evidenceQueue.enqueueAndUpload(
                    jobId = activeJob.id,
                    subtaskId = subtaskId,
                    uri = uri,
                    location = location,
                    appOwnedUri = appOwnedUri,
                )
            } catch (failure: Throwable) {
                error = friendlyError(context, failure)
            } finally {
                uploadingSubtaskId = null
            }
        }
    }

    var workerOcrTarget by remember { mutableStateOf<OcrDialogPayload?>(null) }
    var pendingPreviewUri by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingPreviewSubtaskId by rememberSaveable { mutableStateOf<String?>(null) }
    var qualityRejectionReason by remember { mutableStateOf<String?>(null) }
    var analyzingQuality by remember { mutableStateOf(false) }

    workerOcrTarget?.let { payload ->
        OcrEvidenceDialog(
            title = payload.title,
            status = payload.status,
            result = payload.result,
            onDismiss = { workerOcrTarget = null },
        )
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { captured ->
        val subtaskId = selectedSubtaskId
        val uriStr = pendingCameraUri
        selectedSubtaskId = null
        pendingCameraUri = null
        if (captured && subtaskId != null && uriStr != null) {
            pendingPreviewUri = uriStr
            pendingPreviewSubtaskId = subtaskId
        } else if (uriStr != null) {
            EvidenceCapture.delete(context, Uri.parse(uriStr))
        }
    }

    fun capture(subtaskId: String) {
        runCatching {
            val uri = EvidenceCapture.createImageUri(context)
            selectedSubtaskId = subtaskId
            pendingCameraUri = uri.toString()
            cameraLauncher.launch(uri)
        }.onFailure { error = friendlyError(context, it) }
    }

    qualityRejectionReason?.let { reason ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Quality Check Rejected", fontWeight = FontWeight.Bold, color = MaterialTheme.np.danger) },
            text = { Text(reason) },
            confirmButton = {
                Button(
                    onClick = {
                        val uriStr = pendingPreviewUri
                        val subtaskId = pendingPreviewSubtaskId
                        if (uriStr != null) EvidenceCapture.delete(context, Uri.parse(uriStr))
                        pendingPreviewUri = null
                        pendingPreviewSubtaskId = null
                        qualityRejectionReason = null
                        if (subtaskId != null) capture(subtaskId)
                    },
                ) {
                    Text("Retake Photo Now")
                }
            },
        )
    }

    if (pendingPreviewUri != null && qualityRejectionReason == null) {
        Dialog(
            onDismissRequest = {},
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Card(
                modifier = Modifier.fillMaxSize().padding(16.dp),
                shape = MaterialTheme.shapes.large,
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("Document Capture Preview", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("Edge-to-Edge Quality Gate: Hard rejection if document contour covers < 90% of frame, border cut off, or if blurry/glare.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color.Black),
                    ) {
                        UriImagePreview(
                            uri = Uri.parse(pendingPreviewUri!!),
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    if (analyzingQuality) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Text("Analyzing edge boundaries & quality...", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = {
                                val uri = Uri.parse(pendingPreviewUri!!)
                                val subtaskId = pendingPreviewSubtaskId
                                EvidenceCapture.delete(context, uri)
                                pendingPreviewUri = null
                                pendingPreviewSubtaskId = null
                                if (subtaskId != null) capture(subtaskId)
                            },
                            modifier = Modifier.weight(1f),
                            enabled = !analyzingQuality,
                        ) {
                            Text("Retake")
                        }
                        Button(
                            onClick = {
                                scope.launch {
                                    analyzingQuality = true
                                    val uri = Uri.parse(pendingPreviewUri!!)
                                    val subtaskId = pendingPreviewSubtaskId ?: return@launch
                                    val qaResult = QualityCheckEngine.analyze(context, uri)
                                    runCatching { container.marketplaceRepository.sendQualityTelemetry(qaResult) }
                                    analyzingQuality = false
                                    if (!qaResult.passed) {
                                        val failureReason = buildString {
                                            if (!qaResult.checks.edgeCoverage.passed) {
                                                append("Edge boundary cut off: document covers ${qaResult.checks.edgeCoverage.score.toInt()}% of frame (minimum 90% required). Please align document with frame borders and retake.")
                                            } else if (!qaResult.checks.sharpness.passed) {
                                                append(qaResult.checks.sharpness.message ?: "Image is too blurry. Hold device steady and retake.")
                                            } else if (!qaResult.checks.exposure.passed) {
                                                append(qaResult.checks.exposure.message ?: "Lighting or glare issue detected. Adjust illumination and retake.")
                                            } else {
                                                append("Quality check failed. Please ensure full document is visible.")
                                            }
                                        }
                                        qualityRejectionReason = failureReason
                                    } else {
                                        pendingPreviewUri = null
                                        pendingPreviewSubtaskId = null
                                        enqueueEvidence(subtaskId, uri, appOwnedUri = true)
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f),
                            enabled = !analyzingQuality,
                        ) {
                            Text("Use Photo")
                        }
                    }
                }
            }
        }
    }

    LaunchedEffect(jobId) {
        reload()
        container.evidenceQueue.retryForJob(jobId)
    }

    val activeJob = job
    val pendingForJob = pendingEvidence.filter { it.jobId == jobId }
    val confirmedForJob = confirmedEvidence.filter { it.job_id == jobId }
    val requiredSubtasks = activeJob?.subtasks?.filter { it.is_required }.orEmpty()
    val requiredEvidenceComplete = requiredSubtasks.all { subtask ->
        subtask.status == SubtaskStatus.COMPLETED || confirmedForJob.any { evidence ->
            evidence.subtask_id == subtask.id && evidence.status in setOf(MediaStatus.UPLOADED, MediaStatus.VERIFIED)
        }
    }
    val readyToSubmit = activeJob?.status == JobStatus.IN_PROGRESS && requiredEvidenceComplete && pendingForJob.isEmpty()
    val nextStatus = activeJob?.status?.let { status ->
        when (status) {
            JobStatus.ASSIGNED -> JobStatus.EN_ROUTE
            JobStatus.EN_ROUTE -> JobStatus.AT_LOCATION
            JobStatus.AT_LOCATION -> JobStatus.IN_PROGRESS
            else -> null
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { BackHeader(stringResource(R.string.live_task), onBack) }
        if (loading) item { LoadingCard(stringResource(R.string.loading)) }
        error?.let { item { InlineNotice(it, Tone.Danger) } }
        activeJob?.let { task ->
            item {
                Card(shape = MaterialTheme.shapes.large) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(task.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            StatusPill(task.status)
                        }
                        if (task.is_assigned_to_requester) {
                            Text(task.address ?: stringResource(R.string.address_unavailable), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            InlineNotice(stringResource(R.string.task_not_assigned), Tone.Danger)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AssistChip(
                                onClick = {},
                                label = { Text(stringResource(R.string.evidence)) },
                                leadingIcon = { Icon(Icons.Outlined.Shield, contentDescription = null, modifier = Modifier.size(16.dp)) },
                            )
                            AssistChip(
                                onClick = {},
                                label = { Text(stringResource(R.string.location_protected)) },
                                leadingIcon = { Icon(Icons.Outlined.CheckCircle, contentDescription = null, modifier = Modifier.size(16.dp)) },
                            )
                        }
                    }
                }
            }
            nextStatus?.let { target ->
                item {
                    Button(
                        onClick = {
                            scope.launch {
                                updating = true
                                try {
                                    val result = container.marketplaceRepository.advanceWorkStatus(task.id, target)
                                    job = task.copy(status = result.status)
                                    reconcileSafely(container)
                                } catch (failure: Throwable) {
                                    error = friendlyError(context, failure)
                                } finally {
                                    updating = false
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !updating && task.is_assigned_to_requester,
                    ) {
                        Text(stringResource(if (updating) R.string.updating_work else R.string.mark_status, statusLabel(target)))
                    }
                }
            }
            item {
                Text(stringResource(R.string.evidence), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.evidence_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = includeLocation,
                        onCheckedChange = { includeLocation = it },
                        enabled = task.status == JobStatus.IN_PROGRESS,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(stringResource(R.string.attach_location), style = MaterialTheme.typography.bodySmall)
                }
            }
            items(task.subtasks.sortedBy { it.sequence_order }, key = { it.id }) { subtask ->
                val confirmedForSubtask = confirmedForJob.filter { it.subtask_id == subtask.id }
                val pendingForSubtask = pendingForJob.filter { it.subtaskId == subtask.id }
                val evidenceComplete = confirmedForSubtask.any { it.status in setOf(MediaStatus.UPLOADED, MediaStatus.VERIFIED) }
                Card(
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.cardColors(
                        containerColor = if (evidenceComplete) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                    ),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(subtask.title, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            AssistChip(
                                onClick = {},
                                label = { Text(stringResource(if (subtask.is_required) R.string.required else R.string.optional)) },
                            )
                        }
                        subtask.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (confirmedForSubtask.isNotEmpty()) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(stringResource(R.string.evidence_count, confirmedForSubtask.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.np.accent)
                                // An "OCR Verified (98%)" badge used to sit here. The figure was a
                                // string literal, shown beside every upload regardless of whether
                                // OCR had run -- and the API now reports ocr_status "unavailable".
                                // Same class of defect as NP-15: a confident claim with nothing
                                // behind it. There is no honest number to put here yet.
                            }
                            // A "Live OCR Extraction" panel sat here. Tapping it opened
                            // an OCR transcript built from two hardcoded strings --
                            // "भौतिक सत्यापन साक्ष्य प्रमाणित" / "Physical verification
                            // certified" -- with a confidence of 0.984 and a detected
                            // script of "bilingual", none of which came from the photo
                            // the worker had just taken. It read as proof that their
                            // evidence had been machine-verified when nothing had run.
                            // The API reports ocr_status "unavailable"; until it reports
                            // something real there is nothing truthful to display here.
                        }
                        pendingForSubtask.forEach { pending ->
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    if (uploadingSubtaskId == subtask.id) stringResource(R.string.uploading_evidence) else pending.lastError ?: stringResource(R.string.uploading_evidence),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (pending.lastError == null) MaterialTheme.np.inkMuted else MaterialTheme.np.danger,
                                )
                                if (pending.lastError != null && uploadingSubtaskId == null) {
                                    OutlinedButton(
                                        onClick = {
                                            scope.launch {
                                                uploadingSubtaskId = pending.subtaskId
                                                try {
                                                    container.evidenceQueue.retry(pending.id)
                                                } catch (failure: Throwable) {
                                                    error = friendlyError(context, failure)
                                                } finally {
                                                    uploadingSubtaskId = null
                                                }
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) { Text(stringResource(R.string.retry_upload)) }
                                }
                            }
                        }
                        OutlinedButton(
                            onClick = { capture(subtask.id) },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = task.status == JobStatus.IN_PROGRESS && task.is_assigned_to_requester && uploadingSubtaskId == null,
                        ) {
                            Icon(Icons.Outlined.PhotoCamera, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Capture Photo (In-App Only)")
                        }
                    }
                }
            }
            if (task.status == JobStatus.IN_PROGRESS && !pendingForJob.isEmpty()) item {
                InlineNotice(stringResource(R.string.evidence_pending), Tone.Neutral)
            }
            item {
                Button(
                    onClick = {
                        scope.launch {
                            updating = true
                            try {
                                val result = container.marketplaceRepository.submitWork(task.id)
                                job = task.copy(status = result.status)
                                reconcileSafely(container)
                            } catch (failure: Throwable) {
                                error = friendlyError(context, failure)
                            } finally {
                                updating = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = readyToSubmit && !updating && task.is_assigned_to_requester,
                ) {
                    Text(stringResource(if (updating) R.string.submitting_work else R.string.submit_work))
                }
            }
        }
    }
}

@Composable
private fun ActivityInboxScreen(
    container: AppContainer,
    role: UserRole,
    onBack: () -> Unit,
    onOpenJob: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val inbox by container.durableState.inbox.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    var mutating by remember { mutableStateOf(false) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun loadNotifications(reset: Boolean) {
        refreshing = true
        try {
            if (reset) reconcileSafely(container)
            val page = container.marketplaceRepository.notifications(if (reset) null else nextCursor)
            container.durableState.recordNotifications(page.items)
            nextCursor = page.next_cursor
            hasMore = page.has_more && page.next_cursor != null
            error = null
        } catch (failure: Throwable) {
            error = friendlyError(context, failure)
        } finally {
            refreshing = false
        }
    }

    LaunchedEffect(role) { loadNotifications(reset = true) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.foundation.layout.Box(Modifier.weight(1f)) { BackHeader(stringResource(R.string.activity_title), onBack) }
                IconButton(
                    onClick = {
                        scope.launch {
                            refreshing = true
                            loadNotifications(reset = true)
                        }
                    },
                    enabled = !refreshing,
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = stringResource(R.string.refresh))
                }
            }
        }
        item { InlineNotice(stringResource(R.string.activity_body), Tone.Neutral) }
        if (inbox.any { it.readAt == null }) item {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        mutating = true
                        try {
                            container.marketplaceRepository.markAllNotificationsRead()
                            container.durableState.markAllInboxRead()
                            error = null
                        } catch (failure: Throwable) {
                            error = friendlyError(context, failure)
                        } finally {
                            mutating = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !mutating,
            ) {
                Text(stringResource(R.string.mark_all_read))
            }
        }
        if (refreshing && inbox.isEmpty()) item { LoadingCard(stringResource(R.string.loading)) }
        error?.let { item { InlineNotice(it, Tone.Danger) } }
        if (!refreshing && inbox.isEmpty() && error == null) item {
            EmptyCard(stringResource(R.string.no_activity_title), stringResource(R.string.no_activity_body))
        }
        items(inbox, key = { it.id }) { item ->
            ActivityInboxCard(
                item = item,
                onOpen = {
                    scope.launch {
                        mutating = true
                        try {
                            if (item.readAt == null) {
                                container.durableState.recordNotifications(
                                    listOf(container.marketplaceRepository.markNotificationRead(item.id)),
                                )
                            }
                            item.jobId?.let(onOpenJob)
                            error = null
                        } catch (failure: Throwable) {
                            error = friendlyError(context, failure)
                        } finally {
                            mutating = false
                        }
                    }
                },
            )
        }
        if (hasMore) item {
            OutlinedButton(
                onClick = { scope.launch { loadNotifications(reset = false) } },
                modifier = Modifier.fillMaxWidth(),
                enabled = !refreshing && !mutating,
            ) { Text(stringResource(R.string.load_more)) }
        }
    }
}

@Composable
private fun ActivityInboxCard(
    item: LocalInboxItem,
    onOpen: () -> Unit,
) {
    val unread = item.readAt == null
    Card(
        modifier = Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpen),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(
            containerColor = if (unread) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(item.title, fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold)
            Text(item.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(item.createdAt, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun NotificationPermissionCard() {
    val context = LocalContext.current
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    var granted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    if (granted) return
    Card(
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.notification_permission_title), fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.notification_permission_body), style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = { permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }) {
                Text(stringResource(R.string.enable_notifications))
            }
        }
    }
}

/**
 * A client signed in to the worker app.
 *
 * Their account is real and their work is real -- it just happens somewhere
 * else. Saying that plainly and offering the way out is more useful than a
 * phone-sized copy of the client workspace, which is what used to be here.
 */
@Composable
private fun WrongAppScreen(onSignOut: () -> Unit) {
    val c = MaterialTheme.np
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Space.xl),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(c.fill),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.BusinessCenter,
                contentDescription = null,
                tint = c.inkMuted,
                modifier = Modifier.size(28.dp),
            )
        }
        Spacer(Modifier.height(Space.xl))
        Text(
            text = stringResource(R.string.client_account_title),
            style = MaterialTheme.typography.headlineSmall,
            color = c.ink,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Space.md))
        Text(
            text = stringResource(R.string.client_account_body),
            style = MaterialTheme.typography.bodyMedium,
            color = c.inkMuted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Space.xl))
        NpCard {
            Text(
                text = stringResource(R.string.client_account_url),
                style = MaterialTheme.typography.titleSmall,
                color = c.accent,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(Space.xxl))
        NpSecondaryButton(
            label = stringResource(R.string.sign_out),
            onClick = onSignOut,
        )
    }
}

@Composable
private fun AdminBoundaryScreen() {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.Shield, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(44.dp))
        Spacer(Modifier.height(14.dp))
        Text(stringResource(R.string.admin_boundary_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.admin_boundary_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun hasLocationPermission(context: android.content.Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

private fun Location.toPoint(): Point = Point.fromLatitudeLongitude(latitude, longitude)

@Composable
private fun mediaTypeLabel(type: MediaType): String = stringResource(
    when (type) {
        MediaType.IMAGE -> R.string.media_image
        MediaType.VIDEO -> R.string.media_video
        MediaType.AUDIO -> R.string.media_audio
        MediaType.DOCUMENT -> R.string.media_document
    },
)

private val REVIEWABLE_JOB_STATUSES = setOf(
    JobStatus.IN_PROGRESS,
    JobStatus.SUBMITTED,
    JobStatus.APPROVED,
    JobStatus.COMPLETED,
    JobStatus.DISPUTED,
)

private fun Job.isUnfundedFunding(): Boolean =
    status == JobStatus.FUNDING && escrow_status == EscrowStatus.UNFUNDED

private suspend fun reconcileSafely(container: AppContainer) {
    try {
        container.syncRepository.reconcile()
    } catch (failure: CancellationException) {
        throw failure
    } catch (_: Throwable) {
        // The following API read remains usable when a best-effort reconciliation is unavailable.
    }
}

private val DISPUTEABLE_JOB_STATUSES = setOf(
    JobStatus.ASSIGNED,
    JobStatus.EN_ROUTE,
    JobStatus.AT_LOCATION,
    JobStatus.IN_PROGRESS,
    JobStatus.SUBMITTED,
    JobStatus.APPROVED,
)

private val EVIDENCE_MIME_TYPES = arrayOf(
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/webm",
    "application/pdf",
)
