package com.networkpeer.mobile.core.network

import com.networkpeer.mobile.core.model.ApiEnvelope
import com.networkpeer.mobile.core.model.ApprovalResult
import com.networkpeer.mobile.core.model.ClientJobDetail
import com.networkpeer.mobile.core.model.ClientJobCancellation
import com.networkpeer.mobile.core.model.ClientJobPage
import com.networkpeer.mobile.core.model.ClientJobResolution
import com.networkpeer.mobile.core.model.ClientEvidenceReviewResponse
import com.networkpeer.mobile.core.model.DeviceDeregistration
import com.networkpeer.mobile.core.model.DeviceRegistration
import com.networkpeer.mobile.core.model.EvidenceReservation
import com.networkpeer.mobile.core.model.EvidenceSummary
import com.networkpeer.mobile.core.model.FundingResult
import com.networkpeer.mobile.core.model.Job
import com.networkpeer.mobile.core.model.JobStatus
import com.networkpeer.mobile.core.model.NearbyJobsPage
import com.networkpeer.mobile.core.model.AppNotification
import com.networkpeer.mobile.core.model.MarkAllNotificationsReadResult
import com.networkpeer.mobile.core.model.NotificationPage
import com.networkpeer.mobile.core.model.OtpRequestResult
import com.networkpeer.mobile.core.model.Point
import com.networkpeer.mobile.core.model.StoredSession
import com.networkpeer.mobile.core.model.SubmitWorkResult
import com.networkpeer.mobile.core.model.SyncPage
import com.networkpeer.mobile.core.model.TokenPair
import com.networkpeer.mobile.core.model.UserRole
import com.networkpeer.mobile.core.model.WalletResponse
import com.networkpeer.mobile.core.model.WorkStatusResult
import com.networkpeer.mobile.core.model.WorkerJobDetail
import com.networkpeer.mobile.core.model.WorkerSyncPage
import com.networkpeer.mobile.core.model.QualityCheckResult
import com.networkpeer.mobile.core.model.ReviewQueueResponse
import com.networkpeer.mobile.core.model.WorkerSubmissionsResponse
import com.networkpeer.mobile.core.model.UserProfile
import com.networkpeer.mobile.core.model.UpdateProfileBody
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Call
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.HTTP
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface NetworkPeerApi {
    @POST("auth/email-otp/request")
    suspend fun requestEmailOtp(@Body body: EmailOtpRequestBody): ApiEnvelope<OtpRequestResult>

    @POST("auth/email-otp/verify")
    suspend fun verifyEmailOtp(@Body body: EmailOtpVerifyBody): ApiEnvelope<TokenPair>

    @POST("auth/logout")
    @Headers("X-NetworkPeer-Skip-Authorization: true")
    suspend fun logout(@Body body: RefreshTokenBody): ApiEnvelope<LogoutResult>

    @GET("auth/me")
    suspend fun me(): ApiEnvelope<MeResult>

    @GET("auth/profile")
    suspend fun getProfile(): ApiEnvelope<UserProfile>

    @PATCH("auth/profile")
    suspend fun updateProfile(@Body body: UpdateProfileBody): ApiEnvelope<UserProfile>

    @GET("client/jobs")
    suspend fun clientJobs(
        @Query("status") status: JobStatus? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiEnvelope<ClientJobPage>

    @GET("client/jobs/{jobId}")
    suspend fun clientJob(@Path("jobId") jobId: String): ApiEnvelope<ClientJobDetail>

    @POST("client/jobs")
    suspend fun createClientJob(@Body body: CreateJobBody): ApiEnvelope<Job>

    @POST("client/jobs/{jobId}/fund")
    suspend fun fundClientJob(
        @Path("jobId") jobId: String,
        @Body body: IdempotencyBody,
    ): ApiEnvelope<FundingResult>

    @POST("client/jobs/{jobId}/approve")
    suspend fun approveClientJob(
        @Path("jobId") jobId: String,
        @Body body: IdempotencyBody,
    ): ApiEnvelope<ApprovalResult>

    @GET("client/jobs/{jobId}/evidence")
    suspend fun clientJobEvidence(@Path("jobId") jobId: String): ApiEnvelope<ClientEvidenceReviewResponse>

    @POST("client/jobs/{jobId}/cancel")
    suspend fun cancelClientJob(
        @Path("jobId") jobId: String,
        @Body body: CancelClientJobBody,
    ): ApiEnvelope<ClientJobCancellation>

    @POST("client/jobs/{jobId}/complete")
    suspend fun completeClientJob(@Path("jobId") jobId: String): ApiEnvelope<ClientJobResolution>

    @POST("client/jobs/{jobId}/dispute")
    suspend fun disputeClientJob(@Path("jobId") jobId: String): ApiEnvelope<ClientJobResolution>

    @GET("client/wallet")
    suspend fun clientWallet(): ApiEnvelope<WalletResponse>

    @POST("worker/location")
    suspend fun updateWorkerLocation(@Body body: WorkerLocationBody): ApiEnvelope<WorkerLocationResult>

    @GET("worker/jobs")
    suspend fun allWorkerJobs(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiEnvelope<NearbyJobsPage>

    @GET("worker/jobs/nearby")
    suspend fun nearbyWorkerJobs(
        @Query("radius_km") radiusKm: Int? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiEnvelope<NearbyJobsPage>

    @GET("worker/jobs/{jobId}")
    suspend fun workerJob(@Path("jobId") jobId: String): ApiEnvelope<WorkerJobDetail>

    @POST("worker/jobs/{jobId}/accept")
    suspend fun acceptWorkerJob(@Path("jobId") jobId: String): ApiEnvelope<WorkerJobDetail>

    @GET("worker/wallet")
    suspend fun workerWallet(): ApiEnvelope<WalletResponse>

    @POST("work/status")
    suspend fun advanceWorkStatus(@Body body: WorkStatusBody): ApiEnvelope<WorkStatusResult>

    @POST("work/upload-url")
    suspend fun reserveEvidenceUpload(@Body body: ReserveEvidenceBody): ApiEnvelope<EvidenceReservation>

    @POST("work/evidence")
    suspend fun confirmEvidence(@Body body: ConfirmEvidenceBody): ApiEnvelope<EvidenceSummary>

    @POST("work/submit")
    suspend fun submitWork(@Body body: SubmitWorkBody): ApiEnvelope<SubmitWorkResult>

    @GET("sync")
    suspend fun sync(
        @Query("cursor") cursor: String = "0",
        @Query("limit") limit: Int = 100,
    ): ApiEnvelope<SyncPage>

    @GET("worker/sync")
    suspend fun workerSync(
        @Query("cursor") cursor: String = "0",
        @Query("limit") limit: Int = 50,
    ): ApiEnvelope<WorkerSyncPage>

    @GET("notifications")
    suspend fun notifications(
        @Query("before_cursor") beforeCursor: String? = null,
        @Query("limit") limit: Int = 50,
    ): ApiEnvelope<NotificationPage>

    @POST("notifications/read-all")
    suspend fun markAllNotificationsRead(): ApiEnvelope<MarkAllNotificationsReadResult>

    @POST("notifications/{notificationId}/read")
    suspend fun markNotificationRead(@Path("notificationId") notificationId: String): ApiEnvelope<AppNotification>

    @POST("notifications/devices")
    suspend fun registerDevice(@Body body: RegisterDeviceBody): ApiEnvelope<DeviceRegistration>

    @HTTP(method = "DELETE", path = "notifications/devices", hasBody = true)
    suspend fun deregisterDevice(@Body body: DeregisterDeviceBody): ApiEnvelope<DeviceDeregistration>

    @GET("worker/jobs/{jobId}/review-queue")
    suspend fun workerReviewQueue(@Path("jobId") jobId: String): ApiEnvelope<ReviewQueueResponse>

    @POST("worker/submissions/{submissionId}/review")
    suspend fun reviewSubmission(
        @Path("submissionId") submissionId: String,
        @Body body: ReviewSubmissionBody,
    ): ApiEnvelope<ReviewSubmissionResult>

    @GET("worker/submissions/me")
    suspend fun workerSubmissions(): ApiEnvelope<WorkerSubmissionsResponse>

    @POST("telemetry/quality-check")
    suspend fun sendQualityTelemetry(@Body body: QualityCheckResult): ApiEnvelope<QualityTelemetryResult>
}

/** A blocking, interceptor-free endpoint used only by OkHttp's refresh authenticator. */
interface TokenRefreshApi {
    @POST("auth/refresh")
    fun refresh(@Body body: RefreshTokenBody): Call<ApiEnvelope<TokenPair>>
}

@Serializable
data class EmailOtpRequestBody(
    val email: String,
    val role: UserRole,
    // full_name and mobile_number are NOT accepted here. The request schema is
    // strict and takes only these two fields; the profile details belong on
    // verify, where a new account is actually created.
)

@Serializable
data class EmailOtpVerifyBody(
    val email: String,
    val otp: String,
    @SerialName("challenge_id") val challengeId: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    @SerialName("mobile_number") val mobileNumber: String? = null,
    val transport: String = "native",
    // No role. The verify schema is strict and rejects it, so every sign-in
    // from this app was failing with 400 before the field was removed.
    //
    // That rejection is correct rather than an oversight: the role is bound to
    // the challenge when the code is issued and read from there. Letting a
    // client assert a role at redemption would allow requesting a code as
    // CLIENT and redeeming it as something else.
)

@Serializable
data class RefreshTokenBody(val refresh_token: String)

@Serializable
data class LogoutResult(val logged_out: Boolean)

@Serializable
data class MeResult(val id: String, val role: UserRole, val phone: String)

@Serializable
data class IdempotencyBody(val idempotency_key: String)

@Serializable
data class CancelClientJobBody(val cancellation_reason: String? = null)

@Serializable
data class WorkerLocationBody(val latitude: Double, val longitude: Double)

@Serializable
data class WorkerLocationResult(val updated_at: String)

@Serializable
data class WorkStatusBody(val job_id: String, val status: JobStatus)

@Serializable
data class ReserveEvidenceBody(
    val job_id: String,
    val subtask_id: String,
    val media_type: String,
    val mime_type: String,
    val file_size_bytes: Long,
    val captured_at: String,
    val checksum_sha256: String,
    val idempotency_key: String,
    val location: Point? = null,
)

@Serializable
data class ConfirmEvidenceBody(val media_id: String)

@Serializable
data class SubmitWorkBody(val job_id: String)

@Serializable
data class RegisterDeviceBody(val token: String, val platform: String)

@Serializable
data class DeregisterDeviceBody(val token: String)

@Serializable
data class CreateSubtaskBody(
    val title: String,
    val description: String? = null,
    val is_required: Boolean = true,
)

@Serializable
data class CreateJobBody(
    val title: String,
    val description: String,
    val category: String,
    val budget_cents: Long,
    val currency: String = "INR",
    val location: Point,
    val address: String? = null,
    val scheduled_at: String? = null,
    val metadata: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap()),
    val public_title: String? = null,
    val public_description: String? = null,
    val idempotency_key: String,
    val subtasks: List<CreateSubtaskBody> = emptyList(),
)

@Serializable
data class ReviewSubmissionBody(
    val decision: String,
    val note: String? = null,
)

@Serializable
data class ReviewSubmissionResult(
    val success: Boolean,
    val decision: String,
    val submissionId: String,
)

@Serializable
data class QualityTelemetryResult(val received: Boolean)
