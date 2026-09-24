package com.networkpeer.mobile.core.data

import com.networkpeer.mobile.core.model.ApprovalResult
import com.networkpeer.mobile.core.model.AppNotification
import com.networkpeer.mobile.core.model.ClientEvidenceReviewResponse
import com.networkpeer.mobile.core.model.ClientJobCancellation
import com.networkpeer.mobile.core.model.ClientJobDetail
import com.networkpeer.mobile.core.model.ClientJobPage
import com.networkpeer.mobile.core.model.ClientJobResolution
import com.networkpeer.mobile.core.model.EvidenceReservation
import com.networkpeer.mobile.core.model.EvidenceSummary
import com.networkpeer.mobile.core.model.FundingResult
import com.networkpeer.mobile.core.model.Job
import com.networkpeer.mobile.core.model.JobStatus
import com.networkpeer.mobile.core.model.MarkAllNotificationsReadResult
import com.networkpeer.mobile.core.model.NearbyJobsPage
import com.networkpeer.mobile.core.model.NotificationPage
import com.networkpeer.mobile.core.model.NetworkPeerApiException
import com.networkpeer.mobile.core.model.OtpRequestResult
import com.networkpeer.mobile.core.model.StoredSession
import com.networkpeer.mobile.core.model.SubmitWorkResult
import com.networkpeer.mobile.core.model.SyncPage
import com.networkpeer.mobile.core.model.UserRole
import com.networkpeer.mobile.core.model.WalletResponse
import com.networkpeer.mobile.core.model.WorkStatusResult
import com.networkpeer.mobile.core.model.WorkerJobDetail
import com.networkpeer.mobile.core.model.WorkerSyncPage
import com.networkpeer.mobile.core.model.QualityCheckResult
import com.networkpeer.mobile.core.model.ReviewQueueResponse
import com.networkpeer.mobile.core.model.WorkerSubmissionsResponse
import com.networkpeer.mobile.core.network.QualityTelemetryResult
import com.networkpeer.mobile.core.network.ReviewSubmissionBody
import com.networkpeer.mobile.core.network.ReviewSubmissionResult
import com.networkpeer.mobile.core.model.requireData
import com.networkpeer.mobile.core.network.ConfirmEvidenceBody
import com.networkpeer.mobile.core.network.CancelClientJobBody
import com.networkpeer.mobile.core.network.CreateJobBody
import com.networkpeer.mobile.core.network.DeregisterDeviceBody
import com.networkpeer.mobile.core.network.IdempotencyBody
import com.networkpeer.mobile.core.network.NetworkPeerApi
import com.networkpeer.mobile.core.network.RefreshTokenBody
import com.networkpeer.mobile.core.network.RegisterDeviceBody
import com.networkpeer.mobile.core.network.ReserveEvidenceBody
import com.networkpeer.mobile.core.network.SubmitWorkBody
import com.networkpeer.mobile.core.network.WorkStatusBody
import com.networkpeer.mobile.core.network.WorkerLocationBody
import com.networkpeer.mobile.core.network.NetworkPeerClient
import retrofit2.HttpException
import java.io.IOException
import java.util.concurrent.CancellationException

class AuthRepository(
    private val api: NetworkPeerApi,
    private val client: NetworkPeerClient,
    private val onLogout: ((String) -> Unit)? = null,
    private val deregisterDevice: (suspend (String) -> Unit)? = null,
) {
    /**
     * Requests a one-time code. The API takes only the address and the role
     * here; the role is stored with the challenge and is what the account is
     * created with on verify.
     *
     * fullName and mobileNumber remain in the signature so existing callers
     * keep compiling, but they are not sent: the request schema rejects them,
     * and they are only needed on verify, where a new account is created.
     */
    suspend fun requestEmailOtp(
        email: String,
        role: UserRole,
        @Suppress("UNUSED_PARAMETER") fullName: String? = null,
        @Suppress("UNUSED_PARAMETER") mobileNumber: String? = null,
    ): OtpRequestResult = apiCall {
        api.requestEmailOtp(
            com.networkpeer.mobile.core.network.EmailOtpRequestBody(
                email = email,
                role = role,
            )
        )
    }

    suspend fun verifyEmailOtp(
        email: String,
        otp: String,
        challengeId: String? = null,
        fullName: String? = null,
        mobileNumber: String? = null,
        // Accepted for source compatibility with existing callers. The role is
        // whatever the challenge was issued with, so it is not sent on verify.
        @Suppress("UNUSED_PARAMETER") role: UserRole = UserRole.WORKER,
    ): StoredSession {
        val pair = apiCall {
            api.verifyEmailOtp(
                com.networkpeer.mobile.core.network.EmailOtpVerifyBody(
                    email = email,
                    otp = otp,
                    challengeId = challengeId,
                    fullName = fullName,
                    mobileNumber = mobileNumber,
                )
            )
        }
        return StoredSession.from(pair).also(client.sessionStore::save)
    }

    suspend fun logout() {
        val session = client.sessionStore.current() ?: return
        var refreshFamilyRevoked = false
        try {
            // Refresh-token revocation must not wait for an expired access token
            // or best-effort device cleanup to complete.
            apiCall { api.logout(RefreshTokenBody(session.refreshToken)) }
            refreshFamilyRevoked = true
        } finally {
            val cancellation: CancellationException? = if (refreshFamilyRevoked) {
                try {
                    deregisterDevice?.invoke(session.user.id)
                    null
                } catch (failure: Throwable) {
                    if (failure !is CancellationException) {
                        // Device deregistration is best effort; local logout must still complete.
                    }
                    failure as? CancellationException
                }
            } else null
            if (client.sessionStore.clearIfCurrent(session) || client.sessionStore.current() == null) {
                onLogout?.invoke(session.user.id)
            }
            cancellation?.let { throw it }
        }
    }

    suspend fun getProfile(): com.networkpeer.mobile.core.model.UserProfile =
        apiCall { api.getProfile() }

    suspend fun updateProfile(body: com.networkpeer.mobile.core.model.UpdateProfileBody): com.networkpeer.mobile.core.model.UserProfile =
        apiCall { api.updateProfile(body) }
}


class MarketplaceRepository(
    private val api: NetworkPeerApi,
) {
    // NP-15: this list was seeded with hardcoded jobs -- real Bengaluru street
    // addresses, COMPLETED status, escrow RELEASED -- and merged into every
    // client's real job list, so the app showed finished work and released
    // money that did not exist. It now holds only jobs created in this session.
    private val localClientJobs = mutableListOf<Job>()
    private val customWorkerJobs = mutableListOf<com.networkpeer.mobile.core.model.WorkerJobSummary>()

    suspend fun clientJobs(
        status: JobStatus? = null,
        page: Int = 1,
        perPage: Int = DEFAULT_PAGE_SIZE,
    ): ClientJobPage = run {
        val res = apiCall { api.clientJobs(status, page, perPage) }
        val allJobs = (localClientJobs + res.items).distinctBy { it.id }
        val filtered = if (status != null) allJobs.filter { it.status == status } else allJobs
        ClientJobPage(items = filtered, total = filtered.size, page = 1, perPage = perPage)
    }

    suspend fun clientJob(jobId: String): ClientJobDetail = run {
        apiCall { api.clientJob(jobId) }
    }

    suspend fun createClientJob(body: CreateJobBody): Job = run {
        val created = apiCall { api.createClientJob(body) }
        localClientJobs.add(0, created)
        customWorkerJobs.add(0, com.networkpeer.mobile.core.model.WorkerJobSummary(
            id = created.id,
            title = created.title,
            description = created.description,
            category = created.category,
            priority = created.priority,
            budget_cents = created.budget_cents,
            currency = created.currency,
            created_at = created.created_at,
            distance_band = "1.0 KM · CENTRAL",
        ))
        created
    }

    suspend fun fundClientJob(jobId: String, idempotencyKey: String): FundingResult = run {
        apiCall { api.fundClientJob(jobId, IdempotencyBody(idempotencyKey)) }
    }

    suspend fun approveClientJob(jobId: String, idempotencyKey: String): ApprovalResult = run {
        apiCall { api.approveClientJob(jobId, IdempotencyBody(idempotencyKey)) }
    }

    suspend fun clientJobEvidence(jobId: String): ClientEvidenceReviewResponse = apiCall {
        api.clientJobEvidence(jobId)
    }

    suspend fun cancelClientJob(jobId: String, reason: String?): ClientJobCancellation = apiCall {
        api.cancelClientJob(jobId, CancelClientJobBody(reason?.trim()?.ifBlank { null }))
    }

    suspend fun completeClientJob(jobId: String): ClientJobResolution = apiCall {
        api.completeClientJob(jobId)
    }

    suspend fun disputeClientJob(jobId: String): ClientJobResolution = apiCall {
        api.disputeClientJob(jobId)
    }

    suspend fun clientWallet(): WalletResponse = run {
        apiCall { api.clientWallet() }
    }

    suspend fun updateWorkerLocation(latitude: Double, longitude: Double) = apiCall {
        api.updateWorkerLocation(WorkerLocationBody(latitude, longitude))
    }

    suspend fun allWorkerJobs(
        page: Int = 1,
        perPage: Int = DEFAULT_PAGE_SIZE,
    ): NearbyJobsPage = apiCall { api.allWorkerJobs(page, perPage) }

    suspend fun nearbyWorkerJobs(
        radiusKm: Int? = null,
        page: Int = 1,
        perPage: Int = DEFAULT_PAGE_SIZE,
    ): NearbyJobsPage = apiCall { api.nearbyWorkerJobs(radiusKm, page, perPage) }

    suspend fun workerJob(jobId: String): WorkerJobDetail = run {
        apiCall { api.workerJob(jobId) }
    }

    suspend fun acceptWorkerJob(jobId: String): WorkerJobDetail = run {
        apiCall { api.acceptWorkerJob(jobId) }
    }

    suspend fun workerWallet(): WalletResponse = run {
        apiCall { api.workerWallet() }
    }

    suspend fun advanceWorkStatus(jobId: String, status: JobStatus): WorkStatusResult = run {
        require(status in setOf(JobStatus.EN_ROUTE, JobStatus.AT_LOCATION, JobStatus.IN_PROGRESS))
        apiCall { api.advanceWorkStatus(WorkStatusBody(jobId, status)) }
    }

    suspend fun reserveEvidence(body: ReserveEvidenceBody): EvidenceReservation = run {
        apiCall { api.reserveEvidenceUpload(body) }
    }

    suspend fun confirmEvidence(mediaId: String): EvidenceSummary = run {
        apiCall { api.confirmEvidence(ConfirmEvidenceBody(mediaId)) }
    }

    suspend fun submitWork(jobId: String): SubmitWorkResult = run {
        apiCall { api.submitWork(SubmitWorkBody(jobId)) }
    }

    suspend fun sync(cursor: String): SyncPage = apiCall { api.sync(cursor) }

    suspend fun workerSync(cursor: String): WorkerSyncPage = apiCall { api.workerSync(cursor) }

    suspend fun notifications(beforeCursor: String? = null): NotificationPage = run {
        apiCall { api.notifications(beforeCursor) }
    }

    suspend fun markNotificationRead(notificationId: String): AppNotification = apiCall {
        api.markNotificationRead(notificationId)
    }

    suspend fun markAllNotificationsRead(): MarkAllNotificationsReadResult = apiCall {
        api.markAllNotificationsRead()
    }

    suspend fun registerDevice(token: String): com.networkpeer.mobile.core.model.DeviceRegistration = apiCall {
        api.registerDevice(RegisterDeviceBody(token = token, platform = "ANDROID"))
    }

    suspend fun deregisterDevice(token: String): com.networkpeer.mobile.core.model.DeviceDeregistration = apiCall {
        api.deregisterDevice(DeregisterDeviceBody(token))
    }

    suspend fun workerReviewQueue(jobId: String): ReviewQueueResponse = run {
        apiCall { api.workerReviewQueue(jobId) }
    }

    suspend fun reviewSubmission(submissionId: String, decision: String, note: String? = null): ReviewSubmissionResult = apiCall {
        api.reviewSubmission(submissionId, ReviewSubmissionBody(decision, note))
    }

    suspend fun workerSubmissions(): WorkerSubmissionsResponse = run {
        apiCall { api.workerSubmissions() }
    }

    suspend fun sendQualityTelemetry(checkResult: QualityCheckResult): QualityTelemetryResult = apiCall {
        api.sendQualityTelemetry(checkResult)
    }

    private companion object {
        const val DEFAULT_PAGE_SIZE = 20
    }
}

private suspend fun <T> apiCall(request: suspend () -> com.networkpeer.mobile.core.model.ApiEnvelope<T>): T = try {
    request().requireData()
} catch (error: HttpException) {
    throw NetworkPeerApiException("HTTP_${error.code()}", "The server rejected the request (${error.code()}).", error.code())
} catch (error: IOException) {
    throw NetworkPeerApiException("NETWORK_ERROR", "Cannot reach NetworkPeer. Check your connection and try again.")
}

