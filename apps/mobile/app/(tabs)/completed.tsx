import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import type { WorkerJobSummary } from "@/lib/types";
import { colors, radii, shadow, spacing, typography } from "@/lib/theme";
import { EmptyState, LoadingState, MetaChip } from "@/components/ui";

export default function CompletedJobsScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<WorkerJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.nearbyJobs();
      setJobs(result.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load work history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="Loading work history" />;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={jobs.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.kicker}>History</Text>
            <Text style={styles.title}>Completed jobs</Text>
            <Text style={styles.subtitle}>Outcomes and status for finished work</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={error ? "cloud-offline-outline" : "archive-outline"}
            title={error ? "Could not load history" : "No completed jobs yet"}
            body={error ?? "Jobs you finish and submit will show up here with their outcome."}
            actionLabel={error ? "Try again" : undefined}
            onAction={error ? () => { setLoading(true); load(); } : undefined}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.category}>{item.category}</Text>
              <Text style={styles.pay}>₹{(item.budget_cents / 100).toFixed(0)}</Text>
            </View>
            <Text style={styles.jobTitle}>{item.title}</Text>
            <View style={styles.meta}>
              {item.scheduled_at && <MetaChip icon="calendar-outline" label={new Date(item.scheduled_at).toLocaleDateString()} />}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
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
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  category: {
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    fontSize: 11,
    fontWeight: "700",
  },
  pay: { color: colors.text, fontSize: 18, fontWeight: "800" },
  jobTitle: { ...typography.heading, marginTop: 12 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
});
