import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  CreditCard,
  Eye,
  Mail,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/portal-shell";
import { Chip, EmptyState, SectionCard } from "@/components/marketplace/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/clients")({
  head: () => ({
    meta: [
      { title: "Admin clients — NetworkPeers" },
      { name: "description", content: "Client account health and activity." },
    ],
  }),
  component: AdminClients,
});

type ClientStatus = "Healthy" | "Stable" | "Suspended" | "Pending";

type Client = {
  id: string;
  name: string;
  company: string;
  email: string;
  jobsPosted: number;
  activeJobs: number;
  wallet: string;
  verification: string;
  status: ClientStatus;
};

const seedClients: Client[] = [
  {
    id: "CL-201",
    name: "Mina Shah",
    company: "Northline Retail",
    email: "mina@northline.co",
    jobsPosted: 14,
    activeJobs: 4,
    wallet: "₹1.2L",
    verification: "Verified",
    status: "Healthy",
  },
  {
    id: "CL-202",
    name: "Luis Ortega",
    company: "Harbor Goods",
    email: "luis@harborgoods.co",
    jobsPosted: 7,
    activeJobs: 2,
    wallet: "₹480K",
    verification: "Verified",
    status: "Stable",
  },
  {
    id: "CL-203",
    name: "Sana Patel",
    company: "Cedar Market",
    email: "sana@cedarmarket.co",
    jobsPosted: 3,
    activeJobs: 1,
    wallet: "₹140K",
    verification: "Pending",
    status: "Pending",
  },
];

function AdminClients() {
  const [clients, setClients] = useState(seedClients);
  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [confirmAction, setConfirmAction] = useState<"suspend" | "delete" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCompany, setDraftCompany] = useState("");
  const [draftEmail, setDraftEmail] = useState("");

  const filteredClients = useMemo(() => {
    const term = query.toLowerCase();
    return clients.filter((client) =>
      `${client.name} ${client.company} ${client.email}`.toLowerCase().includes(term),
    );
  }, [clients, query]);

  const openView = (client: Client) => {
    setSelectedClient(client);
    setMode("view");
    setConfirmAction(null);
  };

  const openEdit = (client: Client) => {
    setSelectedClient(client);
    setDraftName(client.name);
    setDraftCompany(client.company);
    setDraftEmail(client.email);
    setMode("edit");
    setConfirmAction(null);
  };

  const requestConfirm = (client: Client, action: "suspend" | "delete") => {
    setSelectedClient(client);
    setConfirmAction(action);
    setMode("confirm");
  };

  const saveEdit = () => {
    if (!selectedClient) return;
    setClients((prev) =>
      prev.map((client) =>
        client.id === selectedClient.id
          ? { ...client, name: draftName, company: draftCompany, email: draftEmail }
          : client,
      ),
    );
    toast.success(`${draftName} updated in the mock console.`);
    setSelectedClient(null);
    setMode("view");
  };

  const applyConfirm = () => {
    if (!selectedClient || !confirmAction) return;
    if (confirmAction === "suspend") {
      setClients((prev) =>
        prev.map((client) =>
          client.id === selectedClient.id
            ? { ...client, status: "Suspended" as ClientStatus }
            : client,
        ),
      );
      toast.success(`${selectedClient.name} moved to suspended review.`);
    }
    if (confirmAction === "delete") {
      setClients((prev) => prev.filter((client) => client.id !== selectedClient.id));
      toast.success(`${selectedClient.name} removed from the mock workspace.`);
    }
    setSelectedClient(null);
    setConfirmAction(null);
    setMode("view");
  };

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="Client management"
        description="Review account health, wallet posture and operational trust."
      />

      <SectionCard title="All clients" description="Search and manage client accounts">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base outline-none focus:ring-2 focus:ring-ring/40"
              placeholder="Search by name or company"
            />
          </div>
          <div className="text-base text-muted-foreground">
            {filteredClients.length} visible clients
          </div>
        </div>

        {filteredClients.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No clients match this view"
            description="Try a different filter or review the roster later."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-base">
              <thead className="text-[15px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Profile</th>
                  <th className="px-3 py-3">Client ID</th>
                  <th className="px-3 py-3">Company</th>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Jobs Posted</th>
                  <th className="px-3 py-3">Active Jobs</th>
                  <th className="px-3 py-3">Wallet</th>
                  <th className="px-3 py-3">Verification</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((client) => (
                  <tr key={client.id} className="border-t border-border/70 align-middle">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-base font-semibold text-primary">
                          {client.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-medium">{client.name}</p>
                          <p className="text-base text-muted-foreground">{client.company}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{client.id}</td>
                    <td className="px-3 py-3">{client.company}</td>
                    <td className="px-3 py-3">{client.email}</td>
                    <td className="px-3 py-3">{client.jobsPosted}</td>
                    <td className="px-3 py-3">{client.activeJobs}</td>
                    <td className="px-3 py-3">{client.wallet}</td>
                    <td className="px-3 py-3">
                      <Chip tone={client.verification === "Verified" ? "success" : "warning"}>
                        {client.verification}
                      </Chip>
                    </td>
                    <td className="px-3 py-3">
                      <Chip
                        tone={
                          client.status === "Suspended"
                            ? "warning"
                            : client.status === "Pending"
                              ? "teal"
                              : "success"
                        }
                      >
                        {client.status}
                      </Chip>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openView(client)}
                          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-base font-medium"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(client)}
                          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-base font-medium"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => requestConfirm(client, "suspend")}
                          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-base font-medium"
                        >
                          Suspend
                        </button>
                        <button
                          type="button"
                          onClick={() => requestConfirm(client, "delete")}
                          className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-base font-medium text-destructive"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Dialog
        open={Boolean(selectedClient && mode === "view")}
        onOpenChange={(open) => !open && setSelectedClient(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Client overview</DialogTitle>
            <DialogDescription>Mock detail view for the selected account.</DialogDescription>
          </DialogHeader>
          {selectedClient && (
            <div className="space-y-3 text-base">
              <div className="rounded-2xl border border-border bg-muted/40 p-3">
                <p className="text-[15px] uppercase tracking-wide text-muted-foreground">
                  Primary contact
                </p>
                <p className="mt-1 font-semibold">{selectedClient.name}</p>
                <p className="text-muted-foreground">{selectedClient.email}</p>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
                <span className="text-muted-foreground">Company</span>
                <span className="font-medium">{selectedClient.company}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
                <span className="text-muted-foreground">Wallet</span>
                <span className="font-medium">{selectedClient.wallet}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
                <span className="text-muted-foreground">Verification</span>
                <span className="font-medium">{selectedClient.verification}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => selectedClient && openEdit(selectedClient)}
              className="press inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-base font-medium"
            >
              Edit details
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedClient && mode === "edit")}
        onOpenChange={(open) => !open && setSelectedClient(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
            <DialogDescription>
              These updates stay in the mock state so the flow remains front-end only.
            </DialogDescription>
          </DialogHeader>
          {selectedClient && (
            <div className="space-y-3">
              <label className="block text-base">
                <span className="mb-1 block text-muted-foreground">Display name</span>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
                />
              </label>
              <label className="block text-base">
                <span className="mb-1 block text-muted-foreground">Company</span>
                <input
                  value={draftCompany}
                  onChange={(e) => setDraftCompany(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
                />
              </label>
              <label className="block text-base">
                <span className="mb-1 block text-muted-foreground">Email</span>
                <input
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
                />
              </label>
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={saveEdit}
              className="press gradient-brand inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
            >
              Save changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedClient && mode === "confirm")}
        onOpenChange={(open) => !open && setSelectedClient(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "delete" ? "Delete client" : "Suspend client"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "delete"
                ? "This removes the client from the mock console."
                : "This flags the client for review and prevents active operations."}
            </DialogDescription>
          </DialogHeader>
          {selectedClient && (
            <div className="rounded-2xl border border-border bg-muted/40 p-3 text-base text-muted-foreground">
              {confirmAction === "delete"
                ? `Delete ${selectedClient.name} from the mock admin workspace?`
                : `Suspend ${selectedClient.name} and pause their active workflow?`}
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={applyConfirm}
              className={
                confirmAction === "delete"
                  ? "press inline-flex items-center justify-center rounded-xl bg-destructive px-4 py-2.5 text-base font-semibold text-destructive-foreground"
                  : "press inline-flex items-center justify-center rounded-xl bg-warning px-4 py-2.5 text-base font-semibold text-warning-foreground"
              }
            >
              {confirmAction === "delete" ? "Delete" : "Suspend"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
