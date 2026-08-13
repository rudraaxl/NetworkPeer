import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import type { WorkerJobDetail } from "@/lib/types";
import { jobStatusLabel } from "@/lib/types";
import { colors, radii, shadow, spacing, typography } from "@/lib/theme";
import { EmptyState, InfoBanner, LoadingState, MetaChip, PrimaryButton } from "@/components/ui";

export default function JobDetailScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const [job, setJob] = useState<WorkerJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJob(await api.job(jobId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAccept() {
    setAccepting(true);
    try {
      const detail = await api.acceptJob(jobId);
      setJob(detail);
      router.push(`/task/${jobId}`);
    } catch (e) {
      Alert.alert("Job unavailable", e instanceof Error ? e.message : "This job is no longer available.");
      load();
    } finally {
      setAccepting(false);
    }
  }

  if (loading) return <LoadingState label="Loading job details" />;

  if (!job) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="alert-circle-outline"
          title="Job unavailable"
          body={error ?? "This job could not be found."}
          actionLabel="Try again"
          onAction={() => { setLoading(true); load(); }}
        />
      </SafeAreaView>
    );
  }

  const isActive = job.is_assigned_to_requester &&
    ["ASSIGNED", "EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"].includes(job.status);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.category}>{job.category}</Text>
        <Text style={styles.title}>{job.title}</Text>
        <View style={styles.badgeRow}>
          <MetaChip icon="shield-checkmark-outline" label={jobStatusLabel[job.status]} />
        </View>

        <Text style={styles.objective}>{job.description}</Text>

        <View style={styles.metaGrid}>
          <DetailStat label="Budget" value={`₹${(job.budget_cents / 100).toFixed(0)}`} />
          <DetailStat label="Status" value={jobStatusLabel[job.status]} />
          {job.address && <DetailStat label="Location" value={job.address} />}
        </View>

        {job.subtasks.length > 0 && (
          <View style={styles.checklistCard}>
            <Text style={styles.sectionTitle}>Checklist</Text>
            {job.subtasks.map((subtask, i) => (
              <View key={subtask.id} style={styles.checklistItem}>
                <View style={styles.stepCircle}><Text style={styles.stepText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{subtask.title}</Text>
                  {subtask.description && <Text style={styles.stepInstructions}>{subtask.description}</Text>}
                </View>
                {subtask.is_required && <MetaChip icon="camera-outline" label="Required" />}
              </View>
            ))}
          </View>
        )}

        <InfoBanner
          tone="info"
          icon="shield-checkmark-outline"
          title="Evidence protected"
          body="Payment releases only after the client approves your submitted evidence."
        />

        {isActive ? (
          <PrimaryButton label="Continue task" onPress={() => router.push(`/task/${jobId}`)} />
        ) : job.status === "POSTED" ? (
          <PrimaryButton label={`Accept job · ₹${(job.budget_cents / 100).toFixed(0)}`} onPress={handleAccept} loading={accepting} />
        ) : (
          <PrimaryButton label={`Job ${jobStatusLabel[job.status]}`} onPress={() => undefined} disabled />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCard}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 40, gap: spacing.lg },
  category: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  title: { ...typography.display, marginTop: -4 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  objective: { ...typography.body, color: colors.textSecondary },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metaCard: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow,
  },
  metaLabel: { ...typography.caption },
  metaValue: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 4 },
  checklistCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  sectionTitle: { ...typography.heading },
  checklistItem: { flexDirection: "row", gap: 12, alignItems: "center", paddingTop: 4 },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 13, fontWeight: "800", color: colors.primary },
  stepTitle: { ...typography.bodyStrong },
  stepInstructions: { ...typography.body, marginTop: 4 },
});
