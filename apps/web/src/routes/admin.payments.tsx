import { createFileRoute } from "@tanstack/react-router";
import { CircleDollarSign, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/portal-shell";
import { Chip, SectionCard } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/admin/payments")({
  head: () => ({
    meta: [
      { title: "Admin payments — NetworkPeers" },
      { name: "description", content: "Escrow and settlement oversight." },
    ],
  }),
  component: AdminPayments,
});

type PaymentStatus = "Escrow" | "Released" | "Refunded" | "Pending";

type Payment = { id: string; ref: string; amount: string; client: string; status: PaymentStatus };

const seedPayments: Payment[] = [
  { id: "p1", ref: "GF-1042", amount: "₹78", client: "Northline Retail", status: "Escrow" },
  { id: "p2", ref: "GF-1041", amount: "₹120", client: "Harbor Goods", status: "Released" },
  { id: "p3", ref: "GF-1038", amount: "₹145", client: "Cedar Market", status: "Pending" },
];

function AdminPayments() {
  const [payments, setPayments] = useState(seedPayments);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

  const updateStatus = (payment: Payment, status: PaymentStatus) => {
    setPayments((prev) =>
      prev.map((item) => (item.id === payment.id ? { ...item, status } : item)),
    );
    toast.success(`${payment.ref} marked ${status.toLowerCase()}.`);
    setSelectedPayment(null);
  };

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="Payments"
        description="Review escrow holds, release flows and refund status."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Escrow", value: "3", tone: "warning" },
          { label: "Released", value: "12", tone: "success" },
          { label: "Refunded", value: "2", tone: "teal" },
          { label: "Pending", value: "4", tone: "primary" },
        ].map((item) => (
          <SectionCard key={item.label} title={item.label} description="Mock payment state">
            <p className="text-4xl font-semibold">{item.value}</p>
          </SectionCard>
        ))}
      </div>

      <SectionCard
        title="Payments ledger"
        description="Mock settlement state"
        action={
          <button
            type="button"
            className="press inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-base font-medium"
          >
            <Download className="h-4 w-4" /> Export
          </button>
        }
      >
        <div className="space-y-3">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-soft text-primary">
                  <CircleDollarSign className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-base font-semibold">{payment.ref}</p>
                  <p className="text-base text-muted-foreground">
                    {payment.client} · {payment.amount}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Chip
                  tone={
                    payment.status === "Released"
                      ? "success"
                      : payment.status === "Refunded"
                        ? "teal"
                        : payment.status === "Pending"
                          ? "warning"
                          : "primary"
                  }
                >
                  {payment.status}
                </Chip>
                <button
                  type="button"
                  onClick={() => setSelectedPayment(payment)}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-base font-medium"
                >
                  Review
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Quick payment controls" description="Mock operational actions">
        <div className="flex flex-wrap gap-2">
          {(["Released", "Refunded", "Pending"] as PaymentStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => selectedPayment && updateStatus(selectedPayment, status)}
              className="rounded-xl border border-border bg-card px-3 py-2 text-base font-medium"
            >
              Mark {status}
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
