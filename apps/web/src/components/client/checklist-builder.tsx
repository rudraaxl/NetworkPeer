import {
  BookOpen,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { SectionCard } from "@/components/marketplace/primitives";
import { MAX_CHECKLIST_ITEMS, PAGE_SIZE, inputCls, labelCls } from "@/lib/job-draft";
import { cn } from "@/lib/utils";
import type { ChecklistDraft } from "@/hooks/use-checklist-draft";

/**
 * The checklist and book-mode builder.
 *
 * This was the largest single region of the job form -- roughly a quarter of a
 * thousand-line route -- and the only part of it with its own modes, its own
 * pagination and its own search. It takes the draft as one object rather than
 * as the twenty-nine separate props its contents actually touch.
 */
export function ChecklistBuilder({ draft }: { draft: ChecklistDraft }) {
  const {
    addMultipleSubtasks,
    addSubtask,
    bookEndPage,
    bookPagePrefix,
    bookRequireAll,
    bookStartPage,
    builderMode,
    clearAllSubtasks,
    currentPage,
    filteredItems,
    handleGenerateBookPages,
    items,
    markAllRequired,
    paginatedItems,
    removeSubtask,
    setBookEndPage,
    setBookPagePrefix,
    setBookRequireAll,
    setBookStartPage,
    setBuilderMode,
    setCurrentPage,
    setTaskSearch,
    taskSearch,
    totalPages,
    updateSubtask,
  } = draft;

  return (
          <SectionCard
            title="Checklist & task builder"
            description="Infinite scaling task builder with Book / Sequential Mode for document verification."
          >
            {/* Mode Switcher */}
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-border bg-muted/20 p-1.5">
              <button
                type="button"
                onClick={() => setBuilderMode("standard")}
                className={cn(
                  "press flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition",
                  builderMode === "standard"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <CheckSquare className="h-4 w-4" /> Standard Checklist
              </button>
              <button
                type="button"
                onClick={() => setBuilderMode("book")}
                className={cn(
                  "press flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition",
                  builderMode === "book"
                    ? "bg-amber-400 text-slate-900 shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <BookOpen className="h-4 w-4" /> Book / Document Mode
              </button>
            </div>

            {/* Book Mode Generator Panel */}
            {builderMode === "book" && (
              <div className="mb-4 space-y-4 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <h4 className="text-base font-semibold text-foreground">
                    Auto-Generate Sequential Page Tasks
                  </h4>
                </div>
                <p className="text-sm text-muted-foreground">
                  Quickly generate verification tasks for an entire document or book. Each page is added as an individually verifiable task with Devanagari/English script validation.
                </p>

                <div className="grid gap-3 sm:grid-cols-4">
                  <label>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Start Page
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_CHECKLIST_ITEMS}
                      value={bookStartPage}
                      onChange={(e) => setBookStartPage(e.target.value)}
                      className={inputCls}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      End Page
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_CHECKLIST_ITEMS}
                      value={bookEndPage}
                      onChange={(e) => setBookEndPage(e.target.value)}
                      className={inputCls}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Prefix Label
                    </span>
                    <input
                      type="text"
                      value={bookPagePrefix}
                      onChange={(e) => setBookPagePrefix(e.target.value)}
                      placeholder="Page"
                      className={inputCls}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleGenerateBookPages}
                      className="press h-12 w-full rounded-xl bg-amber-400 px-4 text-sm font-bold text-slate-900 shadow-sm hover:bg-amber-300"
                    >
                      Generate Tasks
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bookRequireAll}
                    onChange={(e) => setBookRequireAll(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span>Mark all generated pages as strictly required for completion</span>
                </label>
              </div>
            )}

            {/* Quick Actions & High Volume Toolbar */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Quick add:</span>
                  <button
                    type="button"
                    onClick={() => addMultipleSubtasks(1)}
                    className="press rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:border-primary/40"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => addMultipleSubtasks(10)}
                    className="press rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:border-primary/40"
                  >
                    +10
                  </button>
                  <button
                    type="button"
                    onClick={() => addMultipleSubtasks(50)}
                    className="press rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:border-primary/40"
                  >
                    +50
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => markAllRequired(true)}
                    className="press rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium hover:border-primary/40"
                  >
                    Require all
                  </button>
                  <button
                    type="button"
                    onClick={() => markAllRequired(false)}
                    className="press rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium hover:border-primary/40"
                  >
                    Optional all
                  </button>
                  <button
                    type="button"
                    onClick={clearAllSubtasks}
                    className="press rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-destructive hover:border-destructive/40"
                  >
                    Clear all
                  </button>
                </div>
              </div>

              {/* Search & Pagination Info */}
              {items.length > PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={taskSearch}
                      onChange={(e) => {
                        setTaskSearch(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Search tasks by title or instructions..."
                      className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      Page {currentPage} of {totalPages} ({filteredItems.length} tasks)
                    </span>
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="press rounded-lg border border-border bg-card p-1.5 disabled:opacity-40"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="press rounded-lg border border-border bg-card p-1.5 disabled:opacity-40"
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Task Items List */}
              {paginatedItems.map((item, index) => {
                const actualIndex = (currentPage - 1) * PAGE_SIZE + index;
                return (
                  <div key={item.id} className="rounded-2xl border border-border bg-muted/30 p-4 transition-all">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="truncate text-[15px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Task {actualIndex + 1}
                        {item.title && <span className="ml-2 lowercase text-foreground">— {item.title}</span>}
                      </p>
                      <button
                        type="button"
                        aria-label="Remove task"
                        onClick={() => removeSubtask(item.id)}
                        className="press grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3">
                      <input
                        value={item.title}
                        onChange={(event) => updateSubtask(item.id, { title: event.target.value })}
                        className={inputCls}
                        maxLength={255}
                        placeholder="Task name (e.g. Page 1 or Signage)"
                      />
                      <textarea
                        rows={2}
                        value={item.instructions}
                        onChange={(event) =>
                          updateSubtask(item.id, { instructions: event.target.value })
                        }
                        className={inputCls}
                        maxLength={2000}
                        placeholder="Specific instructions for evidence capture"
                      />
                      <label className="flex items-center gap-2 text-base font-medium">
                        <input
                          type="checkbox"
                          checked={item.isRequired}
                          onChange={(event) =>
                            updateSubtask(item.id, { isRequired: event.target.checked })
                          }
                        />
                        Evidence required before task submission
                      </label>
                    </div>
                  </div>
                );
              })}

              {items.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
                  <CheckSquare className="mx-auto h-8 w-8 opacity-40" />
                  <p className="mt-2 font-medium">No tasks defined yet.</p>
                  <p className="text-sm">Add tasks using the buttons above or generate a book checklist.</p>
                </div>
              )}

              <button
                type="button"
                onClick={addSubtask}
                className="press flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-4 text-base font-medium text-muted-foreground hover:border-amber-400 hover:text-amber-500"
              >
                <Plus className="h-4 w-4" /> Add checklist item
              </button>
            </div>
          </SectionCard>
  );
}
