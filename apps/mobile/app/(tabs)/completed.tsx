import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import type { JobStatus, WorkerJobDetail } from "@/lib/types";
import { jobStatusLabel } from "@/lib/types";
import { colors, radii, shadow, spacing, typography } from "@/lib/theme";
import { EmptyState, LoadingState, MetaChip } from "@/components/ui";

const activeStatuses: JobStatus[] = ["ASSIGNED", "EN_ROUTE", "AT_LOCATION", "IN_PROGRESS", "SUBMITTED"];
const finishedStatuses: JobStatus[] = ["APPROVED", "COMPLETED", "CANCELLED", "DISPUTED"];

export default function AcceptedJobsScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<WorkerJobDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.workerSync();
      setJobs(result.snapshot_jobs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your jobs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { active, finished } = useMemo(() => {
    return {
      active: jobs.filter((job) => activeStatuses.includes(job.status)),
      finished: jobs.filter((job) => finishedStatuses.includes(job.status)),
    };
  }, [jobs]);

  if (loading) return <LoadingState label="Loading your jobs" />;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={[...active, ...finished]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={(active.length || finished.length) ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.kicker}>My work</Text>
            <Text style={styles.title}>Accepted jobs</Text>
            <Text style={styles.subtitle}>
              {error
                ? "We could not refresh your jobs right now."
                : active.length > 0
                  ? `${active.length} active job${active.length === 1 ? "" : "s"} — tap one to continue the task.`
                  : finished.length > 0
                    ? "No active jobs. Your finished work is listed below."
                    : "Jobs you accept will appear here."}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={error ? "cloud-offline-outline" : "briefcase-outline"}
            title={error ? "Could not load jobs" : "No accepted jobs yet"}
            body={error ?? "Browse nearby jobs and accept one to start working. Your accepted jobs will show up here."}
            actionLabel={error ? "Try again" : undefined}
            onAction={error ? () => { setLoading(true); load(); } : undefined}
          />
        }
        renderItem={({ item }) => (
          <AcceptedJobCard job={item} onPress={() => router.push(`/job/${item.id}`)} />
        )}
      />
    </SafeAreaView>
  );
}

function AcceptedJobCard({ job, onPress }: { job: WorkerJobDetail; onPress: () => void }) {
  const isActive = activeStatuses.includes(job.status);
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open job ${job.title}`}>
      <View style={styles.cardTop}>
        <View style={styles.categoryBadge}><Text style={styles.categoryText}>{job.category}</Text></View>
        <View style={[styles.statusBadge, isActive ? styles.statusActive : styles.statusDone]}>
          <Text style={[styles.statusText, isActive ? styles.statusTextActive : styles.statusTextDone]}>
            {jobStatusLabel[job.status]}
          </Text>
        </View>
      </View>
      <Text style={styles.jobTitle}>{job.title}</Text>
      <Text style={styles.objective} numberOfLines={2}>{job.description}</Text>
      <View style={styles.metaRow}>
        <MetaChip icon="wallet-outline" label={`₹${(job.budget_cents / 100).toFixed(0)}`} />
        {job.scheduled_at && <MetaChip icon="calendar-outline" label={new Date(job.scheduled_at).toLocaleDateString()} />}
        {job.address && <MetaChip icon="location-outline" label={job.address} />}
      </View>
      {isActive && <Text style={styles.cta}>Continue task ›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingBottom: 28 },
  emptyList: { flexGrow: 1, paddingBottom: 28 },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md },
  kicker: { ...typography.label, color: colors.primaryMuted, textTransform: "uppercase" },
  title: { ...typography.display, marginTop: 4 },
  subtitle: { ...typography.body, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    ...shadow,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  categoryBadge: { backgroundColor: colors.primarySoft, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 5 },
  categoryText: { color: colors.primary, fontSize: 11, fontWeight: "700" },
  statusBadge: { borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 5 },
  statusActive: { backgroundColor: colors.primarySoft },
  statusDone: { backgroundColor: colors.surfaceMuted },
  statusText: { fontSize: 11, fontWeight: "700" },
  statusTextActive: { color: colors.primary },
  statusTextDone: { color: colors.textSecondary },
  jobTitle: { ...typography.heading, marginTop: 12 },
  objective: { ...typography.body, marginTop: 8 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  cta: { color: colors.primary, fontSize: 13, fontWeight: "700", marginTop: 12 },
});