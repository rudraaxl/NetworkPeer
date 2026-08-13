export type Role = "client" | "worker" | "admin";

export type JobStatus =
  | "draft"
  | "open"
  | "accepted"
  | "en_route"
  | "working"
  | "submitted"
  | "in_review"
  | "completed"
  | "rejected"
  | "cancelled";

export type MediaKind = "photo" | "video" | "audio";

export interface ChecklistItem {
  id: string;
  title: string;
  instructions: string;
  required: MediaKind[];
  done?: boolean;
  captured?: number;
}

export interface Job {
  id: string;
  ref: string;
  title: string;
  category: string;
  description: string;
  location: string;
  distanceKm: number;
  payment: number;
  estimatedMinutes: number;
  deadline: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: JobStatus;
  postedAgo: string;
  checklist: ChecklistItem[];
}

export const categories = [
  "Field Inspection",
  "Delivery",
  "Photography",
  "Merchandising",
  "Mystery Shopping",
  "Maintenance",
  "Surveying",
  "Installation",
];

const baseChecklist: ChecklistItem[] = [
  {
    id: "t1",
    title: "Take photo of storefront",
    instructions: "Stand across the street, capture the full signage and entrance in daylight.",
    required: ["photo"],
    done: true,
    captured: 2,
  },
  {
    id: "t2",
    title: "Record 20 second walkthrough video",
    instructions: "Pan slowly from the entrance to the back aisle. Keep the camera steady.",
    required: ["video"],
    done: true,
    captured: 1,
  },
  {
    id: "t3",
    title: "Record audio confirmation",
    instructions: "State the job reference, the date and confirm the manager was present.",
    required: ["audio"],
    done: false,
    captured: 0,
  },
  {
    id: "t4",
    title: "Shelf compliance evidence",
    instructions: "Photo of the promotional shelf plus a short audio note on stock levels.",
    required: ["photo", "audio"],
    done: false,
    captured: 0,
  },
];

export const jobs: Job[] = [
  {
    id: "j-1042",
    ref: "GF-1042",
    title: "Storefront compliance audit — Downtown",
    category: "Field Inspection",
    description:
      "Visit the retail location and document current signage, promotional displays and shelf compliance. Evidence must be captured on site with GPS enabled.",
    location: "412 Market St, Downtown",
    distanceKm: 1.2,
    payment: 78,
    estimatedMinutes: 45,
    deadline: "Today, 6:00 PM",
    priority: "urgent",
    status: "working",
    postedAgo: "12 min ago",
    checklist: baseChecklist,
  },
  {
    id: "j-1041",
    ref: "GF-1041",
    title: "Warehouse inventory photo set",
    category: "Photography",
    description:
      "Capture 8 wide-angle photos of aisles A through D plus a video sweep of the loading dock.",
    location: "Pier 9 Logistics Park",
    distanceKm: 3.8,
    payment: 120,
    estimatedMinutes: 90,
    deadline: "Tomorrow, 12:00 PM",
    priority: "high",
    status: "submitted",
    postedAgo: "1 hr ago",
    checklist: baseChecklist.slice(0, 3),
  },
  {
    id: "j-1040",
    ref: "GF-1040",
    title: "Same-day parcel handoff",
    category: "Delivery",
    description:
      "Collect a sealed parcel and deliver it to the recipient desk. Proof of handoff required.",
    location: "18 Harbour Ave",
    distanceKm: 0.7,
    payment: 34,
    estimatedMinutes: 25,
    deadline: "Today, 3:30 PM",
    priority: "normal",
    status: "open",
    postedAgo: "3 min ago",
    checklist: baseChecklist.slice(0, 2),
  },
  {
    id: "j-1039",
    ref: "GF-1039",
    title: "Mystery shopping visit — Cafe chain",
    category: "Mystery Shopping",
    description: "Order, observe service timing and document the experience discreetly.",
    location: "Grove Street 22",
    distanceKm: 2.4,
    payment: 52,
    estimatedMinutes: 40,
    deadline: "Fri, 5:00 PM",
    priority: "normal",
    status: "in_review",
    postedAgo: "4 hrs ago",
    checklist: baseChecklist.slice(1, 4),
  },
  {
    id: "j-1038",
    ref: "GF-1038",
    title: "AC unit maintenance check",
    category: "Maintenance",
    description: "Inspect the rooftop unit, photograph filters and record a short condition note.",
    location: "Northline Tower, Level 12",
    distanceKm: 5.1,
    payment: 145,
    estimatedMinutes: 120,
    deadline: "Mon, 10:00 AM",
    priority: "low",
    status: "completed",
    postedAgo: "2 days ago",
    checklist: baseChecklist,
  },
  {
    id: "j-1037",
    ref: "GF-1037",
    title: "Retail shelf reset — West mall",
    category: "Merchandising",
    description: "Reset the seasonal end-cap according to the planogram and document before/after.",
    location: "West Mall, Unit 42",
    distanceKm: 6.3,
    payment: 96,
    estimatedMinutes: 75,
    deadline: "Wed, 2:00 PM",
    priority: "high",
    status: "accepted",
    postedAgo: "Yesterday",
    checklist: baseChecklist.slice(0, 3),
  },
];

export const jobById = (id: string) => jobs.find((j) => j.id === id) ?? jobs[0];

export interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "primary" | "success" | "warning" | "danger";
}

export const recentActivity: ActivityItem[] = [
  {
    id: "a1",
    title: "Evidence submitted",
    detail: "Verified Worker submitted 6 media items for GF-1041",
    time: "8 min ago",
    tone: "primary",
  },
  {
    id: "a2",
    title: "Job accepted",
    detail: "Verified Worker accepted GF-1037",
    time: "42 min ago",
    tone: "success",
  },
  {
    id: "a3",
    title: "Deadline approaching",
    detail: "GF-1042 is due in 3 hours",
    time: "1 hr ago",
    tone: "warning",
  },
  {
    id: "a4",
    title: "Payout released",
    detail: "₹145 released for GF-1038",
    time: "2 days ago",
    tone: "success",
  },
  {
    id: "a5",
    title: "Evidence rejected",
    detail: "Audio quality insufficient on GF-1033",
    time: "3 days ago",
    tone: "danger",
  },
];

export interface Transaction {
  id: string;
  label: string;
  ref: string;
  date: string;
  amount: number;
  type: "debit" | "credit" | "pending";
}

export const transactions: Transaction[] = [
  {
    id: "tx1",
    label: "Job payment — Storefront audit",
    ref: "GF-1042",
    date: "Jul 28, 2026",
    amount: -78,
    type: "pending",
  },
  {
    id: "tx2",
    label: "Wallet top-up",
    ref: "Visa •••• 4421",
    date: "Jul 26, 2026",
    amount: 1500,
    type: "credit",
  },
  {
    id: "tx3",
    label: "Job payment — AC maintenance",
    ref: "GF-1038",
    date: "Jul 24, 2026",
    amount: -145,
    type: "debit",
  },
  {
    id: "tx4",
    label: "Platform fee",
    ref: "Jul cycle",
    date: "Jul 24, 2026",
    amount: -14.5,
    type: "debit",
  },
  {
    id: "tx5",
    label: "Refund — cancelled job",
    ref: "GF-1030",
    date: "Jul 21, 2026",
    amount: 62,
    type: "credit",
  },
  {
    id: "tx6",
    label: "Job payment — Shelf reset",
    ref: "GF-1037",
    date: "Jul 19, 2026",
    amount: -96,
    type: "debit",
  },
];

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
  kind: "job" | "payment" | "system" | "review";
}

export const notifications: NotificationItem[] = [
  {
    id: "n1",
    title: "Evidence ready for review",
    body: "GF-1041 has 6 media items awaiting your approval.",
    time: "8 min ago",
    unread: true,
    kind: "review",
  },
  {
    id: "n2",
    title: "Worker en route",
    body: "A Verified Worker is 1.2 km from the GF-1042 site.",
    time: "35 min ago",
    unread: true,
    kind: "job",
  },
  {
    id: "n3",
    title: "Payment held in escrow",
    body: "₹78 reserved for GF-1042.",
    time: "2 hrs ago",
    unread: false,
    kind: "payment",
  },
  {
    id: "n4",
    title: "Weekly summary",
    body: "5 jobs completed, average rating 4.8.",
    time: "Yesterday",
    unread: false,
    kind: "system",
  },
];

export const evidence = [
  {
    id: "e1",
    kind: "photo" as MediaKind,
    task: "Storefront exterior",
    time: "14:02",
    gps: "37.7749, -122.4194",
    accuracy: "±4 m",
  },
  {
    id: "e2",
    kind: "photo" as MediaKind,
    task: "Signage close-up",
    time: "14:04",
    gps: "37.7749, -122.4193",
    accuracy: "±5 m",
  },
  {
    id: "e3",
    kind: "video" as MediaKind,
    task: "Aisle walkthrough",
    time: "14:09",
    gps: "37.7750, -122.4192",
    accuracy: "±6 m",
  },
  {
    id: "e4",
    kind: "audio" as MediaKind,
    task: "Manager confirmation",
    time: "14:15",
    gps: "37.7750, -122.4192",
    accuracy: "±6 m",
  },
  {
    id: "e5",
    kind: "photo" as MediaKind,
    task: "Shelf compliance",
    time: "14:18",
    gps: "37.7751, -122.4190",
    accuracy: "±4 m",
  },
  {
    id: "e6",
    kind: "video" as MediaKind,
    task: "Back-of-house sweep",
    time: "14:24",
    gps: "37.7752, -122.4188",
    accuracy: "±7 m",
  },
];

export const revenueSeries = [
  { month: "Feb", revenue: 42000, jobs: 320 },
  { month: "Mar", revenue: 51000, jobs: 388 },
  { month: "Apr", revenue: 48500, jobs: 361 },
  { month: "May", revenue: 63000, jobs: 470 },
  { month: "Jun", revenue: 71500, jobs: 528 },
  { month: "Jul", revenue: 84200, jobs: 611 },
];

export const categorySplit = [
  { name: "Inspection", value: 34 },
  { name: "Delivery", value: 26 },
  { name: "Photography", value: 18 },
  { name: "Merchandising", value: 12 },
  { name: "Other", value: 10 },
];

export const fraudCases = [
  {
    id: "f1",
    ref: "GF-1039",
    score: 82,
    reason: "Duplicate image hash",
    device: "iPhone 15 · iOS 18.2",
    network: "Wi-Fi · 8.8.8.8",
    version: "3.4.1",
    gps: "Mismatch 1.8 km",
    status: "review",
  },
  {
    id: "f2",
    ref: "GF-1021",
    score: 61,
    reason: "GPS drift during capture",
    device: "Pixel 8 · Android 15",
    network: "LTE · Vodafone",
    version: "3.4.0",
    gps: "Drift 340 m",
    status: "review",
  },
  {
    id: "f3",
    ref: "GF-1015",
    score: 27,
    reason: "Timestamp gap",
    device: "Galaxy S24 · Android 14",
    network: "Wi-Fi",
    version: "3.3.9",
    gps: "Verified",
    status: "cleared",
  },
  {
    id: "f4",
    ref: "GF-1009",
    score: 94,
    reason: "Reused device fingerprint across accounts",
    device: "iPhone 13 · iOS 17.6",
    network: "VPN detected",
    version: "3.2.7",
    gps: "Spoof suspected",
    status: "blocked",
  },
];

export const disputes = [
  {
    id: "d1",
    ref: "GF-1033",
    opened: "Jul 25",
    reason: "Audio evidence unusable",
    amount: 64,
    status: "open",
  },
  {
    id: "d2",
    ref: "GF-1028",
    opened: "Jul 22",
    reason: "Worker arrived outside window",
    amount: 88,
    status: "mediation",
  },
  {
    id: "d3",
    ref: "GF-1011",
    opened: "Jul 14",
    reason: "Checklist partially completed",
    amount: 120,
    status: "resolved",
  },
];

export const platformUsers = [
  {
    id: "u1",
    handle: "Verified Client · C-8842",
    type: "client",
    jobs: 41,
    rating: 4.9,
    joined: "Jan 2026",
    status: "active",
  },
  {
    id: "u2",
    handle: "Verified Worker · W-2210",
    type: "worker",
    jobs: 137,
    rating: 4.8,
    joined: "Nov 2025",
    status: "active",
  },
  {
    id: "u3",
    handle: "Verified Worker · W-3391",
    type: "worker",
    jobs: 12,
    rating: 4.4,
    joined: "Jun 2026",
    status: "pending",
  },
  {
    id: "u4",
    handle: "Verified Client · C-9017",
    type: "client",
    jobs: 6,
    rating: 4.6,
    joined: "May 2026",
    status: "active",
  },
  {
    id: "u5",
    handle: "Verified Worker · W-1188",
    type: "worker",
    jobs: 302,
    rating: 4.95,
    joined: "Mar 2025",
    status: "active",
  },
  {
    id: "u6",
    handle: "Verified Worker · W-4402",
    type: "worker",
    jobs: 0,
    rating: 0,
    joined: "Jul 2026",
    status: "suspended",
  },
];
