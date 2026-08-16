import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import type { WorkerJobDetail } from "@/lib/types";
import CaptureModal from "@/components/CaptureModal";
import { flushPendingEvidence, listPendingEvidence, subscribePendingEvidence, type PendingEvidence } from "@/lib/evidenceQueue";
import { colors, radii, shadow, spacing, typography } from "@/lib/theme";
import { EmptyState, InfoBanner, LoadingState, PrimaryButton } from "@/components/ui";

type CapturedState = Record<string, { uploaded: boolean; mediaId?: string; localId?: string }>;

export default function TaskScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const [job, setJob] = useState<WorkerJobDetail | null>(null);
  const [captured, setCaptured] = useState<CapturedState>({});
  const [capturing, setCapturing] = useState<{ subtaskId: string; mediaType: "IMAGE" | "VIDEO" | "AUDIO" } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEvidence[]>([]);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setJob(await api.job(jobId));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load this task.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshPending = useCallback(async () => {
    const entries = await listPendingEvidence(jobId);
    setPending(entries);
    const pendingIds = new Set(entries.map((e) => e.id));
    setCaptured((prev) => {
      let changed = false;
      const next: CapturedState = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!value.uploaded && value.localId && !pendingIds.has(value.localId)) {
          next[key] = { uploaded: true, mediaId: value.mediaId, localId: value.localId };
          changed = true;
        } else {
          next[key] = value;
        }
      }
      return changed ? next : prev;
    });
  }, [jobId]);

  useEffect(() => {
    refreshPending();
    return subscribePendingEvidence(refreshPending);
  }, [refreshPending]);

  useFocusEffect(
    useCallback(() => {
      refreshPending();
    }, [refreshPending]),
  );

  async function handleRetry() {
    setRetrying(true);
    try {
      const result = await flushPendingEvidence({ force: true });
      await refreshPending();
      if (result.remaining > 0) {
        Alert.alert("Still pending", "Some captures could not be uploaded yet. Check your connection and retry.");
      }
    } catch {
      Alert.alert("Still pending", "Uploads could not be completed right now. Try again shortly.");
    } finally {
      setRetrying(false);
    }
  }

  async function handleCaptureDone(staged: { localId: string; localUri: string; uploaded: boolean; mediaId?: string }) {
    if (!capturing) return;
    const key = `${capturing.subtaskId}:${capturing.mediaType}`;
    setCaptured((prev) => ({ ...prev, [key]: { uploaded: staged.uploaded, mediaId: staged.mediaId, localId: staged.localId || undefined } }));
    setCapturing(null);
    await refreshPending();
  }

  async function handleSubmit() {
    if (!job) return;
    const required = job.subtasks.filter((s) => s.is_required);
    const allDone = required.every((s) => captured[`${s.id}:IMAGE`]?.uploaded || captured[`${s.id}:VIDEO`]?.uploaded || captured[`${s.id}:AUDIO`]?.uploaded);
    if (!allDone) {
      Alert.alert("Submission blocked", "Capture evidence for every required subtask before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitWork(jobId);
      setSubmitted(true);
    } catch (e) {
      Alert.alert("Submission blocked", e instanceof Error ? e.message : "Required evidence is still missing.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading task checklist" />;

  if (!job) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="alert-circle-outline"
          title="Task unavailable"
          body={loadError ?? "This task could not be loaded."}
          actionLabel="Try again"
          onAction={() => { setLoading(true); load(); }}
        />
      </SafeAreaView>
    );
  }

  const requiredSubtasks = job.subtasks.filter((s) => s.is_required);
  const doneCount = requiredSubtasks.filter((s) =>
    captured[`${s.id}:IMAGE`]?.uploaded || captured[`${s.id}:VIDEO`]?.uploaded || captured[`${s.id}:AUDIO`]?.uploaded
  ).length;
  const progress = requiredSubtasks.length ? Math.round((doneCount / requiredSubtasks.length) * 100) : 0;

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><Ionicons name="checkmark" size={28} color="#fff" /></View>
          <Text style={styles.successTitle}>Evidence submitted</Text>
          <Text style={styles.successText}>
            Your evidence is now under client review. Payment releases from escrow once approved.
          </Text>
          <PrimaryButton label="Back to jobs" onPress={() => router.replace("/(tabs)")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <View>
              <Text style={styles.progressLabel}>{doneCount} of {requiredSubtasks.length} subtasks captured</Text>
              <Text style={styles.progressHint}>{requiredSubtasks.length - doneCount === 0 ? "Ready to submit" : `${requiredSubtasks.length - doneCount} remaining`}</Text>
            </View>
            <Text style={styles.progressPct}>{progress}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.gpsNote}>GPS and timestamp attach automatically on every capture.</Text>
        </View>

        {pending.length > 0 && (
          <View style={styles.pendingCard}>
            <InfoBanner
              tone="warning"
              icon="cloud-offline-outline"
              title={`${pending.length} capture${pending.length === 1 ? "" : "s"} waiting to upload`}
              body="Saved on this phone. Uploads automatically while the app is open; you can also force it now."
            />
            <PrimaryButton
              label={retrying ? "Uploading..." : "Retry uploads now"}
              onPress={handleRetry}
              disabled={retrying}
              loading={retrying}
            />
          </View>
        )}

        {job.subtasks.map((subtask, i) => {
          const done = captured[`${subtask.id}:IMAGE`]?.uploaded || captured[`${subtask.id}:VIDEO`]?.uploaded || captured[`${subtask.id}:AUDIO`]?.uploaded;
          const queued = pending.filter((e) => e.subtaskId === subtask.id);
          return (
            <View key={subtask.id} style={[styles.checklistCard, done && styles.cardDone]}>
              <View style={styles.checklistHeader}>
                <View style={[styles.stepCircle, done && styles.stepCircleDone]}>
                  <Text style={[styles.stepText, done && styles.stepTextDone]}>{done ? "✓" : i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{subtask.title}</Text>
                  {subtask.description && <Text style={styles.stepInstructions}>{subtask.description}</Text>}
                </View>
              </View>

              {subtask.is_required && (
                <Pressable
                  style={[styles.captureRow, done && styles.captureRowDone, queued.length > 0 && styles.captureRowQueued]}
                  onPress={() => !done && setCapturing({ subtaskId: subtask.id, mediaType: "IMAGE" })}
                  accessibilityRole="button"
                >
                  <View style={[styles.mediaIcon, done && styles.mediaIconDone]}>
                    <Ionicons name={done ? "checkmark-circle" : "cloud-upload-outline"} size={18} color={done ? colors.success : colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.captureLabel}>{done ? "Evidence captured" : queued.length > 0 ? "Capture waiting to upload" : "Capture evidence"}</Text>
                    <Text style={styles.captureHint}>
                      {done
                        ? "Uploaded with GPS and timestamp"
                        : queued.length > 0
                          ? `${queued.length} file${queued.length === 1 ? "" : "s"} saved on this phone — uploads automatically when the connection recovers`
                          : "Opens live in-app capture"}
                    </Text>
                  </View>
                  {done ? <Ionicons name="checkmark-circle" size={20} color={colors.success} /> : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.bottomBar}>
        <PrimaryButton
          label={submitting ? "Submitting..." : "Submit evidence"}
          onPress={handleSubmit}
          disabled={requiredSubtasks.length - doneCount > 0}
          loading={submitting}
        />
      </View>

      <CaptureModal
        visible={capturing !== null}
        jobId={jobId}
        subtaskId={capturing?.subtaskId ?? ""}
        mediaType={capturing?.mediaType ?? "IMAGE"}
        onDone={handleCaptureDone}
        onCancel={() => setCapturing(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 160, gap: spacing.md },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  progressLabel: { ...typography.heading },
  progressHint: { ...typography.caption, marginTop: 2 },
  progressPct: { fontSize: 24, fontWeight: "800", color: colors.primary },
  progressBar: { height: 10, backgroundColor: colors.surfaceMuted, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: 10, backgroundColor: colors.primary, borderRadius: 999 },
  gpsNote: { ...typography.caption },
  checklistCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow,
  },
  cardDone: { borderColor: colors.successBorder },
  checklistHeader: { flexDirection: "row", gap: 12, alignItems: "center" },
  stepCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stepCircleDone: { backgroundColor: colors.success },
  stepText: { fontSize: 13, fontWeight: "800", color: colors.primary },
  stepTextDone: { color: "#fff" },
  stepTitle: { ...typography.bodyStrong },
  stepInstructions: { ...typography.body, marginTop: 3 },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  captureRowDone: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  captureRowQueued: { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder },
  pendingCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    padding: spacing.md,
    gap: spacing.md,
  },
  mediaIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  mediaIconDone: { backgroundColor: "#D1FAE5" },
  captureLabel: { ...typography.bodyStrong },
  captureHint: { ...typography.caption, marginTop: 2 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.lg,
  },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxxl, gap: spacing.lg },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: { ...typography.title, textAlign: "center" },
  successText: { ...typography.body, textAlign: "center" },
});
