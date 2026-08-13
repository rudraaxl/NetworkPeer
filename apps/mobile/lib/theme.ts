import type { TextStyle, ViewStyle } from "react-native";

export const colors = {
  primary: "#5B21B6",
  primaryDark: "#4C1D95",
  primarySoft: "#F5F3FF",
  primaryBorder: "#DDD6FE",
  primaryMuted: "#7C3AED",
  background: "#F4F6F8",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF2F6",
  surfaceElevated: "#FFFFFF",
  border: "#E6EAF0",
  borderStrong: "#D0D7E2",
  text: "#0B1220",
  textSecondary: "#5B667A",
  textMuted: "#8B95A7",
  success: "#047857",
  successSoft: "#ECFDF5",
  successBorder: "#A7F3D0",
  warning: "#B45309",
  warningSoft: "#FFFBEB",
  warningBorder: "#FDE68A",
  danger: "#B91C1C",
  dangerSoft: "#FEF2F2",
  dangerBorder: "#FECACA",
  info: "#1D4ED8",
  infoSoft: "#EFF6FF",
  infoBorder: "#BFDBFE",
  inkInverse: "#FFFFFF",
  overlay: "rgba(11, 18, 32, 0.48)",
};

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  full: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const typography: Record<
  "display" | "title" | "heading" | "body" | "bodyStrong" | "caption" | "label" | "metric",
  TextStyle
> = {
  display: { fontSize: 30, fontWeight: "800", color: colors.text, letterSpacing: -0.7 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: "700", color: colors.text, letterSpacing: -0.2 },
  body: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
  bodyStrong: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 20 },
  caption: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  label: { fontSize: 12, fontWeight: "700", color: colors.textSecondary, letterSpacing: 0.2 },
  metric: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.6 },
};

export const shadow: ViewStyle = {
  shadowColor: "#0B1220",
  shadowOpacity: 0.05,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 2,
};

export const card: ViewStyle = {
  backgroundColor: colors.surface,
  borderRadius: radii.lg,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.lg,
};

export const button = {
  primary: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    minHeight: 52,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    minHeight: 52,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ghost: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  textPrimary: { color: colors.inkInverse, fontSize: 16, fontWeight: "700" as const },
  textSecondary: { color: colors.text, fontSize: 16, fontWeight: "700" as const },
  textGhost: { color: colors.primary, fontSize: 15, fontWeight: "700" as const },
};

export const priorityTone: Record<string, { color: string; background: string }> = {
  urgent: { color: colors.danger, background: colors.dangerSoft },
  high: { color: colors.warning, background: colors.warningSoft },
  normal: { color: colors.info, background: colors.infoSoft },
  low: { color: colors.success, background: colors.successSoft },
};

export const statusTone: Record<string, { color: string; background: string; label: string }> = {
  posted: { color: colors.info, background: colors.infoSoft, label: "Open" },
  assigned: { color: colors.primaryMuted, background: colors.primarySoft, label: "Accepted" },
  en_route: { color: colors.primaryMuted, background: colors.primarySoft, label: "En route" },
  at_location: { color: colors.primaryMuted, background: colors.primarySoft, label: "At location" },
  in_progress: { color: colors.warning, background: colors.warningSoft, label: "In progress" },
  awaiting_review: { color: colors.warning, background: colors.warningSoft, label: "Under review" },
  approved: { color: colors.success, background: colors.successSoft, label: "Approved" },
  completed: { color: colors.success, background: colors.successSoft, label: "Completed" },
  rejected: { color: colors.danger, background: colors.dangerSoft, label: "Rejected" },
  cancelled: { color: colors.textMuted, background: colors.surfaceMuted, label: "Cancelled" },
  expired: { color: colors.warning, background: colors.warningSoft, label: "Expired" },
  disputed: { color: colors.danger, background: colors.dangerSoft, label: "Disputed" },
};
