import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { MAX_CHECKLIST_ITEMS, PAGE_SIZE, type DraftSubtask } from "@/lib/job-draft";

/**
 * Everything the checklist builder needs to exist.
 *
 * The job form holds about twenty-five pieces of state, and nine of them --
 * plus nine callbacks and three derived values -- belong to the checklist
 * alone. Passing those to a builder component individually would have meant a
 * twenty-four prop signature, so they move here instead and the builder takes
 * one object.
 *
 * The route still reads `items` to submit and `summary` for its sidebar, which
 * is the whole of what the rest of the form needs from the checklist.
 */
export function useChecklistDraft() {

  // Task Builder Mode (§24)
  const [builderMode, setBuilderMode] = useState<"standard" | "book">("standard");
  const [bookStartPage, setBookStartPage] = useState("1");
  const [bookEndPage, setBookEndPage] = useState("20");
  const [bookPagePrefix, setBookPagePrefix] = useState("Page");
  const [bookRequireAll, setBookRequireAll] = useState(true);

  // Subtasks State
  const [items, setItems] = useState<DraftSubtask[]>([
    {
      id: 1,
      title: "Capture storefront evidence",
      instructions: "Capture the full signage and entrance.",
      isRequired: true,
    },
  ]);
  const [countInput, setCountInput] = useState(String(items.length));
  const [taskSearch, setTaskSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const checklistSummary = useMemo(
    () => ({
      total: items.length,
      required: items.filter((item) => item.isRequired).length,
    }),
    [items],
  );

  const updateSubtask = useCallback((id: number, patch: Partial<DraftSubtask>) => {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const removeSubtask = useCallback((id: number) => {
    setItems((previous) => {
      const next = previous.filter((item) => item.id !== id);
      setCountInput(String(next.length));
      return next;
    });
  }, []);

  const addSubtask = useCallback(() => {
    setItems((previous) => {
      if (previous.length >= MAX_CHECKLIST_ITEMS) {
        toast.error(`Maximum checklist limit of ${MAX_CHECKLIST_ITEMS} items reached.`);
        return previous;
      }
      const next = [
        ...previous,
        { id: Date.now() + Math.floor(Math.random() * 1000), title: "", instructions: "", isRequired: true },
      ];
      setCountInput(String(next.length));
      return next;
    });
  }, []);

  const addMultipleSubtasks = useCallback((amount: number) => {
    setItems((previous) => {
      const remaining = MAX_CHECKLIST_ITEMS - previous.length;
      if (remaining <= 0) {
        toast.error(`Maximum checklist limit of ${MAX_CHECKLIST_ITEMS} reached.`);
        return previous;
      }
      const toAdd = Math.min(amount, remaining);
      const nextId = previous.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      const added: DraftSubtask[] = Array.from({ length: toAdd }, (_, index) => ({
        id: nextId + index,
        title: "",
        instructions: "",
        isRequired: true,
      }));
      const next = [...previous, ...added];
      setCountInput(String(next.length));
      toast.success(`Added ${toAdd} checklist items.`);
      return next;
    });
  }, []);

  const resizeItems = useCallback((count: number) => {
    const clamped = Math.max(
      0,
      Math.min(MAX_CHECKLIST_ITEMS, Math.floor(Number.isFinite(count) ? count : 0)),
    );
    setItems((previous) => {
      if (clamped === previous.length) return previous;
      if (clamped < previous.length) return previous.slice(0, clamped);
      const nextId = previous.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      const added = Array.from({ length: clamped - previous.length }, (_, index) => ({
        id: nextId + index,
        title: "",
        instructions: "",
        isRequired: true,
      }));
      return [...previous, ...added];
    });
    return clamped;
  }, []);

  const handleCountChange = useCallback(
    (raw: string) => {
      setCountInput(raw);
      const clamped = resizeItems(Number.parseInt(raw, 10));
      setCountInput(String(clamped));
    },
    [resizeItems],
  );

  const handleGenerateBookPages = useCallback(() => {
    const start = Number.parseInt(bookStartPage, 10);
    const end = Number.parseInt(bookEndPage, 10);
    if (!Number.isInteger(start) || start < 1) {
      toast.error("Start page must be a positive integer (e.g. 1).");
      return;
    }
    if (!Number.isInteger(end) || end < start) {
      toast.error("End page must be greater than or equal to start page.");
      return;
    }
    const pageCount = end - start + 1;
    if (pageCount > MAX_CHECKLIST_ITEMS) {
      toast.error(`Cannot generate more than ${MAX_CHECKLIST_ITEMS} pages at once.`);
      return;
    }

    const prefix = bookPagePrefix.trim() || "Page";
    const generated: DraftSubtask[] = [];
    const baseId = Date.now();

    for (let page = start; page <= end; page++) {
      generated.push({
        id: baseId + (page - start),
        title: `${prefix} ${page}`,
        instructions: `Capture a clear, well-lit photograph of ${prefix.toLowerCase()} ${page}. Verify all margins and text are sharp and legible.`,
        isRequired: bookRequireAll,
      });
    }

    setItems(generated);
    setCountInput(String(generated.length));
    setCurrentPage(1);
    toast.success(`Generated ${pageCount} checklist tasks for ${prefix} ${start} to ${end}.`);
  }, [bookEndPage, bookPagePrefix, bookRequireAll, bookStartPage]);

  const markAllRequired = useCallback((required: boolean) => {
    setItems((previous) => previous.map((item) => ({ ...item, isRequired: required })));
    toast.success(required ? "All items marked required." : "All items marked optional.");
  }, []);

  const clearAllSubtasks = useCallback(() => {
    setItems([]);
    setCountInput("0");
    setCurrentPage(1);
    toast.info("Cleared all checklist items.");
  }, []);

  // File Upload Handlers

  const filteredItems = useMemo(() => {
    if (!taskSearch.trim()) return items;
    const q = taskSearch.toLowerCase();
    return items.filter(
      (item) => item.title.toLowerCase().includes(q) || item.instructions.toLowerCase().includes(q),
    );
  }, [items, taskSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredItems]);

  return {
    items,
    setItems,
    countInput,
    setCountInput,
    taskSearch,
    setTaskSearch,
    currentPage,
    setCurrentPage,
    builderMode,
    setBuilderMode,
    bookStartPage,
    setBookStartPage,
    bookEndPage,
    setBookEndPage,
    bookPagePrefix,
    setBookPagePrefix,
    bookRequireAll,
    setBookRequireAll,
    summary: checklistSummary,
    filteredItems,
    paginatedItems,
    totalPages,
    updateSubtask,
    removeSubtask,
    addSubtask,
    addMultipleSubtasks,
    resizeItems,
    handleCountChange,
    handleGenerateBookPages,
    markAllRequired,
    clearAllSubtasks,
  };
}

export type ChecklistDraft = ReturnType<typeof useChecklistDraft>;
