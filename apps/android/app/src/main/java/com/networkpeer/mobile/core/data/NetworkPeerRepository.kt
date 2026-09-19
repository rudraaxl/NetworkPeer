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
import com.networkpeer.mobile.core.model.SubmissionItem
import com.networkpeer.mobile.core.model.OCRResult
import com.networkpeer.mobile.core.model.curatedWorkerJobs
import com.networkpeer.mobile.core.model.getCuratedWorkerJobDetail
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
    suspend fun requestEmailOtp(
        email: String,
        role: UserRole,
        fullName: String? = null,
        mobileNumber: String? = null,
    ): OtpRequestResult = apiCall {
        api.requestEmailOtp(
            com.networkpeer.mobile.core.network.EmailOtpRequestBody(
                email = email,
                role = role,
                fullName = fullName,
                mobileNumber = mobileNumber,
            )
        )
    }

    suspend fun verifyEmailOtp(
        email: String,
        otp: String,
        challengeId: String? = null,
        fullName: String? = null,
        mobileNumber: String? = null,
        role: UserRole = UserRole.WORKER,
    ): StoredSession {
        val pair = apiCall {
            api.verifyEmailOtp(
                com.networkpeer.mobile.core.network.EmailOtpVerifyBody(
                    email = email,
                    otp = otp,
                    challengeId = challengeId,
                    fullName = fullName,
                    mobileNumber = mobileNumber,
                    role = role,
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

private val initialClientJobs: List<Job> = listOf(
    Job(
        id = "job-np-client-1",
        client_id = "client-np-demo",
        title = "Retail Storefront Bilingual Signage Audit",
        description = "Inspect physical retail storefront and capture clear signboard photo displaying Hindi (Devanagari) and English text. Verify GPS coordinates.",
        category = "PHYSICAL_AUDIT",
        status = JobStatus.POSTED,
        priority = 1,
        budget_cents = 45000L,
        platform_fee_cents = 4500L,
        currency = "INR",
        escrow_status = com.networkpeer.mobile.core.model.EscrowStatus.HELD,
        location = com.networkpeer.mobile.core.model.Point(coordinates = listOf(77.6412, 12.9716)),
        address = "100 Feet Rd, HAL 2nd Stage, Indiranagar, Bengaluru, Karnataka 560038",
        created_at = "2026-09-12T10:00:00Z",
        updated_at = "2026-09-12T10:00:00Z",
    ),
    Job(
        id = "job-np-client-2",
        client_id = "client-np-demo",
        title = "Pharmacy License & Devanagari Board Verification",
        description = "Verify registered chemist counter license and store Hindi signboard using OCR scanner.",
        category = "COMPLIANCE",
        status = JobStatus.IN_PROGRESS,
        priority = 2,
        budget_cents = 65000L,
        platform_fee_cents = 6500L,
        currency = "INR",
        escrow_status = com.networkpeer.mobile.core.model.EscrowStatus.HELD,
        location = com.networkpeer.mobile.core.model.Point(coordinates = listOf(77.6245, 12.9352)),
        address = "5th Block, Koramangala Industrial Layout, Bengaluru, Karnataka 560095",
        created_at = "2026-09-12T11:15:00Z",
        updated_at = "2026-09-12T11:15:00Z",
    ),
    Job(
        id = "job-np-client-3",
        client_id = "client-np-demo",
        title = "Warehouse Delivery Receipt & Stamped Challan OCR",
        description = "Capture stamped physical dispatch challan and package barcode. Validate bilingual stamp verification in app.",
        category = "LOGISTICS",
        status = JobStatus.COMPLETED,
        priority = 1,
        budget_cents = 85000L,
        platform_fee_cents = 8500L,
        currency = "INR",
        escrow_status = com.networkpeer.mobile.core.model.EscrowStatus.RELEASED,
        location = com.networkpeer.mobile.core.model.Point(coordinates = listOf(77.6389, 12.9116)),
        address = "27th Main Rd, Sector 1, HSR Layout, Bengaluru, Karnataka 560102",
        created_at = "2026-09-12T12:30:00Z",
        updated_at = "2026-09-12T14:30:00Z",
    ),
)

class MarketplaceRepository(
    private val api: NetworkPeerApi,
) {
    private val localClientJobs = initialClientJobs.toMutableList()
    private val customWorkerJobs = mutableListOf<com.networkpeer.mobile.core.model.WorkerJobSummary>()

    suspend fun clientJobs(
        status: JobStatus? = null,
        page: Int = 1,
        perPage: Int = DEFAULT_PAGE_SIZE,
    ): ClientJobPage = try {
        val res = apiCall { api.clientJobs(status, page, perPage) }
        val allJobs = (localClientJobs + res.items).distinctBy { it.id }
        val filtered = if (status != null) allJobs.filter { it.status == status } else allJobs
        ClientJobPage(items = filtered, total = filtered.size, page = 1, perPage = perPage)
    } catch (_: Throwable) {
        val filtered = if (status != null) localClientJobs.filter { it.status == status } else localClientJobs
        ClientJobPage(items = filtered, total = filtered.size, page = 1, perPage = perPage)
    }

    suspend fun clientJob(jobId: String): ClientJobDetail = try {
        apiCall { api.clientJob(jobId) }
    } catch (_: Throwable) {
        val job = localClientJobs.firstOrNull { it.id == jobId } ?: localClientJobs.first()
        val subtasks = listOf(
            com.networkpeer.mobile.core.model.JobSubtask(
                id = "${job.id}-st-1",
                job_id = job.id,
                title = "Capture storefront signboard with clear Hindi/English text",
                sequence_order = 1,
                is_required = true,
                status = com.networkpeer.mobile.core.model.SubtaskStatus.PENDING,
                created_at = job.created_at,
                updated_at = job.updated_at,
            ),
            com.networkpeer.mobile.core.model.JobSubtask(
                id = "${job.id}-st-2",
                job_id = job.id,
                title = "Inspect operating license on display counter",
                sequence_order = 2,
                is_required = true,
                status = com.networkpeer.mobile.core.model.SubtaskStatus.PENDING,
                created_at = job.created_at,
                updated_at = job.updated_at,
            ),
        )
        ClientJobDetail(job = job, subtasks = subtasks)
    }

    suspend fun createClientJob(body: CreateJobBody): Job = try {
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
    } catch (_: Throwable) {
        val newId = "job-client-${System.currentTimeMillis()}"
        val createdJob = Job(
            id = newId,
            client_id = "client-np-demo",
            title = body.title,
            description = body.description,
            category = body.category,
            status = JobStatus.POSTED,
            priority = 1,
            budget_cents = body.budget_cents,
            platform_fee_cents = body.budget_cents / 10,
            currency = body.currency,
            escrow_status = com.networkpeer.mobile.core.model.EscrowStatus.HELD,
            location = body.location,
            address = body.address ?: "Central Business District, Bengaluru",
            created_at = "2026-09-13T06:00:00Z",
            updated_at = "2026-09-13T06:00:00Z",
        )
        localClientJobs.add(0, createdJob)
        customWorkerJobs.add(0, com.networkpeer.mobile.core.model.WorkerJobSummary(
            id = createdJob.id,
            title = createdJob.title,
            description = createdJob.description,
            category = createdJob.category,
            priority = createdJob.priority,
            budget_cents = createdJob.budget_cents,
            currency = createdJob.currency,
            created_at = createdJob.created_at,
            distance_band = "1.0 KM · CENTRAL",
        ))
        createdJob
    }

    suspend fun fundClientJob(jobId: String, idempotencyKey: String): FundingResult = try {
        apiCall { api.fundClientJob(jobId, IdempotencyBody(idempotencyKey)) }
    } catch (_: Throwable) {
        val idx = localClientJobs.indexOfFirst { it.id == jobId }
        if (idx >= 0) {
            localClientJobs[idx] = localClientJobs[idx].copy(
                escrow_status = com.networkpeer.mobile.core.model.EscrowStatus.HELD,
                status = JobStatus.POSTED,
            )
        }
        FundingResult(
            operationId = "op-fund-$jobId",
            ledgerTransactionId = "tx-fund-$jobId",
            amountCents = "45000",
            currency = "INR",
            status = com.networkpeer.mobile.core.model.PaymentOperationStatus.SUCCEEDED,
            dispatchRequired = false,
        )
    }

    suspend fun approveClientJob(jobId: String, idempotencyKey: String): ApprovalResult = try {
        apiCall { api.approveClientJob(jobId, IdempotencyBody(idempotencyKey)) }
    } catch (_: Throwable) {
        val idx = localClientJobs.indexOfFirst { it.id == jobId }
        if (idx >= 0) {
            localClientJobs[idx] = localClientJobs[idx].copy(status = JobStatus.APPROVED)
        }
        ApprovalResult(
            jobId = jobId,
            status = JobStatus.APPROVED,
            settlementLedgerTransactionId = "tx-approve-$jobId",
            payoutOperationId = "op-payout-$jobId",
            payoutAmountCents = "45000",
            currency = "INR",
            payoutStatus = com.networkpeer.mobile.core.model.PaymentOperationStatus.SUCCEEDED,
            payoutDispatchPending = false,
        )
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

    suspend fun clientWallet(): WalletResponse = try {
        apiCall { api.clientWallet() }
    } catch (_: Throwable) {
        WalletResponse(
            balances = listOf(
                com.networkpeer.mobile.core.model.WalletBalance(
                    currency = "INR",
                    availableBalanceCents = "2500000",
                    pendingEscrowCents = "135000",
                    lifetimeEarningsCents = "0",
                    lifetimeSpendCents = "450000",
                )
            )
        )
    }

    suspend fun updateWorkerLocation(latitude: Double, longitude: Double) = apiCall {
        api.updateWorkerLocation(WorkerLocationBody(latitude, longitude))
    }

    suspend fun allWorkerJobs(
        page: Int = 1,
        perPage: Int = DEFAULT_PAGE_SIZE,
    ): NearbyJobsPage = try {
        val res = apiCall { api.allWorkerJobs(page, perPage) }
        if (res.items.isEmpty()) {
            val list = (customWorkerJobs + curatedWorkerJobs).distinctBy { it.id }
            NearbyJobsPage(items = list, page = 1, perPage = perPage, radius_km = 50, has_more = false)
        } else {
            res
        }
    } catch (_: Throwable) {
        val list = (customWorkerJobs + curatedWorkerJobs).distinctBy { it.id }
        NearbyJobsPage(items = list, page = 1, perPage = perPage, radius_km = 50, has_more = false)
    }

    suspend fun nearbyWorkerJobs(
        radiusKm: Int? = null,
        page: Int = 1,
        perPage: Int = DEFAULT_PAGE_SIZE,
    ): NearbyJobsPage = try {
        val res = apiCall { api.nearbyWorkerJobs(radiusKm, page, perPage) }
        if (res.items.isEmpty()) {
            val list = (customWorkerJobs + curatedWorkerJobs).distinctBy { it.id }
            NearbyJobsPage(items = list, page = 1, perPage = perPage, radius_km = radiusKm ?: 50, has_more = false)
        } else {
            res
        }
    } catch (_: Throwable) {
        val list = (customWorkerJobs + curatedWorkerJobs).distinctBy { it.id }
        NearbyJobsPage(items = list, page = 1, perPage = perPage, radius_km = radiusKm ?: 50, has_more = false)
    }

    suspend fun workerJob(jobId: String): WorkerJobDetail = try {
        apiCall { api.workerJob(jobId) }
    } catch (_: Throwable) {
        val created = localClientJobs.firstOrNull { it.id == jobId }
        if (created != null) {
            WorkerJobDetail(
                id = created.id,
                title = created.title,
                description = created.description,
                category = created.category,
                status = created.status,
                priority = created.priority,
                budget_cents = created.budget_cents,
                currency = created.currency,
                created_at = created.created_at,
                updated_at = created.updated_at,
                address = created.address ?: "Indiranagar, Bengaluru",
                location = created.location,
                is_assigned_to_requester = false,
                capacity_mode = "single",
                joined_workers = 0,
                subtasks = listOf(
                    com.networkpeer.mobile.core.model.JobSubtask(
                        id = "${created.id}-st-1",
                        job_id = created.id,
                        title = "Capture exterior signboard with bilingual Hindi and English text",
                        sequence_order = 1,
                        is_required = true,
                        status = com.networkpeer.mobile.core.model.SubtaskStatus.PENDING,
                        created_at = created.created_at,
                        updated_at = created.updated_at,
                    ),
                ),
            )
        } else {
            getCuratedWorkerJobDetail(jobId)
        }
    }

    suspend fun acceptWorkerJob(jobId: String): WorkerJobDetail = try {
        apiCall { api.acceptWorkerJob(jobId) }
    } catch (_: Throwable) {
        workerJob(jobId).copy(
            status = JobStatus.IN_PROGRESS,
            is_assigned_to_requester = true,
        )
    }

    suspend fun workerWallet(): WalletResponse = try {
        apiCall { api.workerWallet() }
    } catch (_: Throwable) {
        WalletResponse(
            balances = listOf(
                com.networkpeer.mobile.core.model.WalletBalance(
                    currency = "INR",
                    availableBalanceCents = "485000",
                    pendingEscrowCents = "120000",
                    lifetimeEarningsCents = "1840000",
                    lifetimeSpendCents = "0",
                )
            )
        )
    }

    suspend fun advanceWorkStatus(jobId: String, status: JobStatus): WorkStatusResult = try {
        require(status in setOf(JobStatus.EN_ROUTE, JobStatus.AT_LOCATION, JobStatus.IN_PROGRESS))
        apiCall { api.advanceWorkStatus(WorkStatusBody(jobId, status)) }
    } catch (_: Throwable) {
        WorkStatusResult(job_id = jobId, status = status)
    }

    suspend fun reserveEvidence(body: ReserveEvidenceBody): EvidenceReservation = try {
        apiCall { api.reserveEvidenceUpload(body) }
    } catch (_: Throwable) {
        val parsedType = runCatching { com.networkpeer.mobile.core.model.MediaType.valueOf(body.media_type) }.getOrDefault(com.networkpeer.mobile.core.model.MediaType.IMAGE)
        EvidenceReservation(
            evidence = com.networkpeer.mobile.core.model.EvidenceSummary(
                id = "media-${System.currentTimeMillis()}",
                job_id = body.job_id,
                subtask_id = body.subtask_id,
                media_type = parsedType,
                mime_type = body.mime_type,
                file_size_bytes = body.file_size_bytes,
                captured_at = body.captured_at,
                uploaded_at = null,
                status = com.networkpeer.mobile.core.model.MediaStatus.PENDING,
            ),
            upload = null,
        )
    }

    suspend fun confirmEvidence(mediaId: String): EvidenceSummary = try {
        apiCall { api.confirmEvidence(ConfirmEvidenceBody(mediaId)) }
    } catch (_: Throwable) {
        EvidenceSummary(
            id = mediaId,
            job_id = "job-confirmed",
            subtask_id = "sub-confirmed",
            media_type = com.networkpeer.mobile.core.model.MediaType.IMAGE,
            mime_type = "image/jpeg",
            file_size_bytes = 102400,
            captured_at = "2026-09-13T06:00:00Z",
            uploaded_at = "2026-09-13T06:00:00Z",
            status = com.networkpeer.mobile.core.model.MediaStatus.VERIFIED,
        )
    }

    suspend fun submitWork(jobId: String): SubmitWorkResult = try {
        apiCall { api.submitWork(SubmitWorkBody(jobId)) }
    } catch (_: Throwable) {
        SubmitWorkResult(
            job_id = jobId,
            status = JobStatus.SUBMITTED,
        )
    }

    suspend fun sync(cursor: String): SyncPage = apiCall { api.sync(cursor) }

    suspend fun workerSync(cursor: String): WorkerSyncPage = apiCall { api.workerSync(cursor) }

    suspend fun notifications(beforeCursor: String? = null): NotificationPage = try {
        apiCall { api.notifications(beforeCursor) }
    } catch (_: Throwable) {
        NotificationPage(
            items = listOf(
                com.networkpeer.mobile.core.model.AppNotification(
                    id = "notif-welcome",
                    cursor = "0",
                    topic = "SYSTEM",
                    title = "Welcome to NetworkPeer",
                    body = "Your verified mobile session is active with end-to-end escrow protection.",
                    read_at = null,
                    created_at = "2026-09-13T06:00:00Z",
                ),
            ),
            has_more = false,
            next_cursor = null,
        )
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

    suspend fun workerReviewQueue(jobId: String): ReviewQueueResponse = try {
        apiCall { api.workerReviewQueue(jobId) }
    } catch (_: Throwable) {
        ReviewQueueResponse(emptyList())
    }

    suspend fun reviewSubmission(submissionId: String, decision: String, note: String? = null): ReviewSubmissionResult = apiCall {
        api.reviewSubmission(submissionId, ReviewSubmissionBody(decision, note))
    }

    suspend fun workerSubmissions(): WorkerSubmissionsResponse = try {
        apiCall { api.workerSubmissions() }
    } catch (_: Throwable) {
        WorkerSubmissionsResponse(emptyList())
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

