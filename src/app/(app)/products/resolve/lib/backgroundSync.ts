"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

export type SyncActionStatus =
  | "idle"
  | "pending"
  | "syncing"
  | "completed"
  | "failed"
  | "retrying";

export interface SyncAction<T = any> {
  id: string;
  type: string; // e.g. 'approve_item' | 'merge_group' | 'save_draft' | 'update_expiry' | 'publish'
  label?: string;
  run: () => Promise<T>;
  rollback?: (error: Error) => void;
  onSuccess?: (result: T) => void;
  retryCount: number;
  maxRetries: number;
  status: SyncActionStatus;
  createdAt: number;
  error?: Error;
}

export interface EnqueueOptions<T = any> {
  id?: string;
  type: string;
  label?: string;
  applyOptimistic?: () => void;
  run: () => Promise<T>;
  rollback?: (error: Error) => void;
  onSuccess?: (result: T) => void;
  maxRetries?: number;
}

export interface BackgroundSyncConfig {
  maxRetries?: number; // default: 2
  retryDelayMs?: number; // default: 1000
  concurrency?: number; // default: 2
  onError?: (error: Error, action: SyncAction) => void;
  onSuccess?: (result: any, action: SyncAction) => void;
  onStateChange?: (state: SyncQueueState) => void;
}

export interface SyncQueueState {
  pendingCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  isSyncing: boolean;
  hasErrors: boolean;
  statusText: string;
  recentError: string | null;
  lastSyncedAt: number | null;
  actions: SyncAction[];
}

/**
 * BackgroundSyncQueue manages an asynchronous queue of tasks with:
 * - Instant optimistic UI updates
 * - Background HTTP synchronization
 * - Automatic retries on network failures (exponential backoff)
 * - Automatic rollback callbacks on terminal failure
 * - Non-blocking status reporting
 */
export class BackgroundSyncQueue {
  private queue: SyncAction[] = [];
  private activeWorkers = 0;
  private maxRetries: number;
  private retryDelayMs: number;
  private concurrency: number;
  private onError?: (error: Error, action: SyncAction) => void;
  private onSuccess?: (result: any, action: SyncAction) => void;
  private onStateChange?: (state: SyncQueueState) => void;
  private listeners: Set<(state: SyncQueueState) => void> = new Set();
  private recentError: string | null = null;
  private lastSyncedAt: number | null = null;
  private isProcessing = false;

  constructor(config: BackgroundSyncConfig = {}) {
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.concurrency = Math.max(1, config.concurrency ?? 2);
    this.onError = config.onError;
    this.onSuccess = config.onSuccess;
    this.onStateChange = config.onStateChange;
  }

  /**
   * Enqueue a new action:
   * 1. Runs applyOptimistic() immediately (0ms perceived latency for the user)
   * 2. Adds the network task to the background processing queue
   */
  public enqueue<T = any>(options: EnqueueOptions<T>): string {
    const actionId =
      options.id ||
      `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Execute optimistic UI change immediately
    if (options.applyOptimistic) {
      try {
        options.applyOptimistic();
      } catch (optErr: any) {
        console.error("Optimistic update error in action:", actionId, optErr);
      }
    }

    // 2. Create the queued action
    const action: SyncAction<T> = {
      id: actionId,
      type: options.type,
      label: options.label,
      run: options.run,
      rollback: options.rollback,
      onSuccess: options.onSuccess,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.maxRetries,
      status: "pending",
      createdAt: Date.now(),
    };

    this.queue.push(action);
    this.notifyState();

    // 3. Kick off queue processor in background
    this.processQueue();

    return actionId;
  }

  /**
   * Concurrently process queued actions up to max concurrency
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        // Find actions eligible to run
        const pendingActions = this.queue.filter(
          (a) => a.status === "pending"
        );

        if (pendingActions.length === 0 && this.activeWorkers === 0) {
          // All done
          break;
        }

        // Fill available worker slots
        while (
          this.activeWorkers < this.concurrency &&
          pendingActions.length > 0
        ) {
          const nextAction = pendingActions.shift();
          if (nextAction) {
            this.activeWorkers++;
            this.executeAction(nextAction).finally(() => {
              this.activeWorkers--;
              this.processQueue();
            });
          }
        }

        // If we are saturated or waiting, break loop cycle
        break;
      }
    } finally {
      this.isProcessing = false;
      this.notifyState();
    }
  }

  private async executeAction(action: SyncAction): Promise<void> {
    action.status = "syncing";
    this.notifyState();

    let attempts = 0;
    const maxAttempts = action.maxRetries + 1; // 1 initial + maxRetries

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await action.run();

        // Success!
        action.status = "completed";
        action.error = undefined;
        this.lastSyncedAt = Date.now();
        this.notifyState();

        if (action.onSuccess) {
          try {
            action.onSuccess(result);
          } catch (e) {
            console.error("Action onSuccess handler failed:", e);
          }
        }
        if (this.onSuccess) {
          try {
            this.onSuccess(result, action);
          } catch (e) {
            console.error("Queue onSuccess handler failed:", e);
          }
        }
        return;
      } catch (err: any) {
        console.warn(
          `BackgroundSync: Action ${action.id} (${action.type}) failed attempt ${attempts}/${maxAttempts}:`,
          err?.message || err
        );

        if (attempts < maxAttempts) {
          action.status = "retrying";
          action.retryCount = attempts;
          this.notifyState();

          // Exponential backoff delay: 1000ms, 2000ms...
          const delay = this.retryDelayMs * attempts;
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // Terminal failure: all retries exhausted
          action.status = "failed";
          action.error = err instanceof Error ? err : new Error(String(err));
          this.recentError = err?.message || "Sync failed after retries";
          this.notifyState();

          // Rollback the optimistic state!
          if (action.rollback) {
            try {
              action.rollback(action.error);
            } catch (rbErr) {
              console.error(
                `BackgroundSync: Rollback failed for ${action.id}:`,
                rbErr
              );
            }
          }

          if (this.onError) {
            try {
              this.onError(action.error, action);
            } catch (e) {
              console.error("Queue onError handler failed:", e);
            }
          }
          return;
        }
      }
    }
  }

  /**
   * Re-run all failed actions
   */
  public retryFailed(): void {
    const failedActions = this.queue.filter((a) => a.status === "failed");
    if (failedActions.length === 0) return;

    for (const action of failedActions) {
      action.status = "pending";
      action.retryCount = 0;
      action.error = undefined;
    }
    this.recentError = null;
    this.notifyState();
    this.processQueue();
  }

  /**
   * Clear dismissed error notices
   */
  public clearErrors(): void {
    this.recentError = null;
    this.notifyState();
  }

  /**
   * Remove completed actions older than a threshold
   */
  public clearCompleted(maxAgeMs = 10000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.queue = this.queue.filter(
      (a) =>
        a.status !== "completed" ||
        (a.status === "completed" && a.createdAt > cutoff)
    );
    this.notifyState();
  }

  /**
   * Get the current snapshot of queue state
   */
  public getState(): SyncQueueState {
    const pendingActions = this.queue.filter(
      (a) => a.status === "pending" || a.status === "syncing" || a.status === "retrying"
    );
    const activeActions = this.queue.filter((a) => a.status === "syncing");
    const completedActions = this.queue.filter((a) => a.status === "completed");
    const failedActions = this.queue.filter((a) => a.status === "failed");

    const pendingCount = pendingActions.length;
    const isSyncing = pendingCount > 0 || this.activeWorkers > 0;
    const hasErrors = failedActions.length > 0;

    let statusText = "✓ All changes synced";
    if (isSyncing) {
      statusText = `🔄 Syncing ${pendingCount} item${
        pendingCount === 1 ? "" : "s"
      } in background...`;
    } else if (hasErrors) {
      statusText = `⚠️ ${failedActions.length} item${
        failedActions.length === 1 ? "" : "s"
      } failed to sync`;
    }

    return {
      pendingCount,
      activeCount: activeActions.length,
      completedCount: completedActions.length,
      failedCount: failedActions.length,
      isSyncing,
      hasErrors,
      statusText,
      recentError: this.recentError,
      lastSyncedAt: this.lastSyncedAt,
      actions: [...this.queue],
    };
  }

  /**
   * Subscribe to state changes
   */
  public subscribe(listener: (state: SyncQueueState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyState(): void {
    const state = this.getState();
    if (this.onStateChange) {
      this.onStateChange(state);
    }
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (e) {
        console.error("Error in sync listener:", e);
      }
    }
  }
}

/**
 * Factory function to create a background sync queue instance
 */
export function createBackgroundSyncQueue(
  config?: BackgroundSyncConfig
): BackgroundSyncQueue {
  return new BackgroundSyncQueue(config);
}

/**
 * Custom React Hook for seamless optimistic UI & background synchronization
 */
export function useBackgroundSync(config: BackgroundSyncConfig = {}) {
  const configRef = useRef(config);
  configRef.current = config;

  const [queue] = useState(() =>
    createBackgroundSyncQueue({
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 1000,
      concurrency: config.concurrency ?? 2,
      onError: (err, act) => configRef.current.onError?.(err, act),
      onSuccess: (res, act) => configRef.current.onSuccess?.(res, act),
      onStateChange: (st) => configRef.current.onStateChange?.(st),
    })
  );

  const [state, setState] = useState<SyncQueueState>(() => queue.getState());

  useEffect(() => {
    const unsubscribe = queue.subscribe((newState) => {
      setState(newState);
    });

    // Cleanup old completed actions periodically
    const timer = setInterval(() => {
      queue.clearCompleted(15000);
    }, 10000);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [queue]);

  const enqueue = useCallback(
    <T = any>(options: EnqueueOptions<T>) => {
      return queue.enqueue(options);
    },
    [queue]
  );

  const retryFailed = useCallback(() => {
    queue.retryFailed();
  }, [queue]);

  const clearErrors = useCallback(() => {
    queue.clearErrors();
  }, [queue]);

  return {
    queue,
    enqueue,
    retryFailed,
    clearErrors,
    state,
    pendingCount: state.pendingCount,
    isSyncing: state.isSyncing,
    hasErrors: state.hasErrors,
    statusText: state.statusText,
    recentError: state.recentError,
    lastSyncedAt: state.lastSyncedAt,
    actions: state.actions,
  };
}

/**
 * Non-blocking floating status indicator component.
 * Can be positioned anywhere on the screen (defaults to bottom-right).
 */
export function FloatingSyncIndicator({
  sync,
  className = "",
}: {
  sync: ReturnType<typeof useBackgroundSync>;
  className?: string;
}) {
  const [showSyncedBriefly, setShowSyncedBriefly] = useState(false);
  const prevSyncingRef = useRef(sync.isSyncing);

  useEffect(() => {
    // When syncing transitions from true -> false without errors, flash "All changes synced" for 3.5 seconds
    if (prevSyncingRef.current && !sync.isSyncing && !sync.hasErrors && sync.lastSyncedAt) {
      setShowSyncedBriefly(true);
      const timer = setTimeout(() => setShowSyncedBriefly(false), 3500);
      return () => clearTimeout(timer);
    }
    prevSyncingRef.current = sync.isSyncing;
  }, [sync.isSyncing, sync.hasErrors, sync.lastSyncedAt]);

  // If nothing is happening and no recent sync flash or errors, don't obstruct the screen
  if (!sync.isSyncing && !sync.hasErrors && !showSyncedBriefly) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-xl border backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-3 duration-200 select-none ${
        sync.hasErrors
          ? "bg-rose-50/95 border-rose-300 text-rose-900 shadow-rose-500/10"
          : sync.isSyncing
          ? "bg-zinc-900/90 border-zinc-700 text-white shadow-black/20"
          : "bg-teal-700/95 border-teal-600 text-white shadow-teal-900/20"
      } ${className}`}
    >
      {sync.isSyncing ? (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-block animate-spin text-teal-400 text-sm">🔄</span>
            <div className="flex flex-col">
              <span className="text-xs font-bold leading-tight">
                Syncing {sync.pendingCount} {sync.pendingCount === 1 ? "item" : "items"}
              </span>
              <span className="text-[10px] text-zinc-300">
                Saving in background • Keep working
              </span>
            </div>
          </div>
        </>
      ) : sync.hasErrors ? (
        <>
          <span className="text-rose-500 text-base">⚠️</span>
          <div className="flex flex-col text-xs">
            <span className="font-bold">Sync Error</span>
            <span className="text-[10px] text-rose-700 truncate max-w-[200px]">
              {sync.recentError || "Check network connection"}
            </span>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={sync.retryFailed}
              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] rounded-lg shadow-xs transition-colors"
            >
              Retry
            </button>
            <button
              onClick={sync.clearErrors}
              className="px-1.5 py-1 text-rose-600 hover:text-rose-900 text-xs font-bold transition-colors"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-emerald-300 text-sm font-bold">✓</span>
          <span className="text-xs font-bold tracking-tight">All changes synced to POS</span>
        </>
      )}
    </div>
  );
}

/**
 * Helper to build an optimistic merge duplicate group action
 */
export function buildMergeGroupSyncAction({
  groupKey,
  group,
  form,
  setDuplicateGroups,
  setStats,
  showSuccess,
  setErrorMsg,
}: {
  groupKey: string;
  group: any;
  form: any;
  setDuplicateGroups: React.Dispatch<React.SetStateAction<any[]>>;
  setStats?: React.Dispatch<React.SetStateAction<any>>;
  showSuccess: (msg: string) => void;
  setErrorMsg: (msg: string | null) => void;
}): EnqueueOptions {
  const itemCount = group.items?.length || 1;
  return {
    id: `merge-${groupKey}`,
    type: "merge_duplicate_group",
    label: `Merged "${form.itemName || "Item"}" (${itemCount} snaps)`,
    applyOptimistic: () => {
      // Instantly remove group from duplicate list (0ms perceived latency)
      setDuplicateGroups((prev) => prev.filter((g) => g.groupKey !== groupKey));
      if (setStats) {
        setStats((prev: any) =>
          prev
            ? {
                ...prev,
                duplicateGroupsCount: Math.max(0, (prev.duplicateGroupsCount || 1) - 1),
                duplicateDraftsCount: Math.max(
                  0,
                  (prev.duplicateDraftsCount || itemCount) - itemCount
                ),
              }
            : prev
        );
      }
    },
    run: async () => {
      const res = await fetch("/api/products/ai-drafts/resolve/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds: group.items.map((i: any) => i._id),
          productData: form,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to merge group");
      return json;
    },
    rollback: (err: Error) => {
      // Put group back into list on terminal failure
      setDuplicateGroups((prev) => [group, ...prev]);
      if (setStats) {
        setStats((prev: any) =>
          prev
            ? {
                ...prev,
                duplicateGroupsCount: (prev.duplicateGroupsCount || 0) + 1,
                duplicateDraftsCount: (prev.duplicateDraftsCount || 0) + itemCount,
              }
            : prev
        );
      }
      setErrorMsg(`Failed to merge "${form.itemName}": ${err.message}`);
    },
    onSuccess: (json: any) => {
      showSuccess(
        `✓ Merged ${itemCount} items into "${json.product?.itemName || form.itemName}"!`
      );
    },
  };
}

/**
 * Helper to build an optimistic save draft action (Needs Attention tab)
 */
export function buildSaveDraftSyncAction({
  draftId,
  originalDraft,
  form,
  setNeedsAttention,
  setReadyToPublish,
  setStats,
  showSuccess,
  setErrorMsg,
}: {
  draftId: string;
  originalDraft: any;
  form: any;
  setNeedsAttention: React.Dispatch<React.SetStateAction<any[]>>;
  setReadyToPublish?: React.Dispatch<React.SetStateAction<any[]>>;
  setStats?: React.Dispatch<React.SetStateAction<any>>;
  showSuccess: (msg: string) => void;
  setErrorMsg: (msg: string | null) => void;
}): EnqueueOptions {
  return {
    id: `save-${draftId}`,
    type: "save_draft_edit",
    label: `Updated "${form.extractedItemName || "Draft"}"`,
    applyOptimistic: () => {
      // Instantly remove from needsAttention
      setNeedsAttention((prev) => prev.filter((d) => d._id !== draftId));
      // Add to readyToPublish if provided
      if (setReadyToPublish) {
        setReadyToPublish((prev) => [
          {
            ...originalDraft,
            ...form,
            retailPrice: Number(form.retailPrice),
            quantityInStock: Number(form.quantityInStock),
          },
          ...prev,
        ]);
      }
      if (setStats) {
        setStats((prev: any) =>
          prev
            ? {
                ...prev,
                needsAttentionCount: Math.max(0, (prev.needsAttentionCount || 1) - 1),
                readyToPublishCount: (prev.readyToPublishCount || 0) + 1,
              }
            : prev
        );
      }
    },
    run: async () => {
      const res = await fetch(`/api/products/ai-drafts/resolve/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save draft edit");
      return json;
    },
    rollback: (err: Error) => {
      // Rollback item back to needsAttention
      setNeedsAttention((prev) => [originalDraft, ...prev]);
      if (setReadyToPublish) {
        setReadyToPublish((prev) => prev.filter((d) => d._id !== draftId));
      }
      if (setStats) {
        setStats((prev: any) =>
          prev
            ? {
                ...prev,
                needsAttentionCount: (prev.needsAttentionCount || 0) + 1,
                readyToPublishCount: Math.max(0, (prev.readyToPublishCount || 1) - 1),
              }
            : prev
        );
      }
      setErrorMsg(`Failed to save "${form.extractedItemName}": ${err.message}`);
    },
    onSuccess: (json: any) => {
      showSuccess(
        `✓ Updated "${json.draft?.extractedItemName || form.extractedItemName}"!`
      );
    },
  };
}

/**
 * Helper to build an optimistic single-item approve & publish action
 */
export function buildApproveDraftSyncAction({
  draftId,
  draft,
  branchId,
  setReadyToPublish,
  setStats,
  showSuccess,
  setErrorMsg,
}: {
  draftId: string;
  draft: any;
  branchId: string | null;
  setReadyToPublish: React.Dispatch<React.SetStateAction<any[]>>;
  setStats?: React.Dispatch<React.SetStateAction<any>>;
  showSuccess: (msg: string) => void;
  setErrorMsg: (msg: string | null) => void;
}): EnqueueOptions {
  const itemName = draft.extractedItemName || "Product";
  return {
    id: `publish-${draftId}`,
    type: "approve_and_publish",
    label: `Published "${itemName}"`,
    applyOptimistic: () => {
      // Instantly remove item from table
      setReadyToPublish((prev) => prev.filter((p) => p._id !== draftId));
      if (setStats) {
        setStats((prev: any) =>
          prev
            ? {
                ...prev,
                readyToPublishCount: Math.max(0, (prev.readyToPublishCount || 1) - 1),
              }
            : prev
        );
      }
    },
    run: async () => {
      const res = await fetch("/api/products/ai-drafts/resolve/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds: [draftId],
          branchId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to publish product");
      return json;
    },
    rollback: (err: Error) => {
      // Restore product to list
      setReadyToPublish((prev) => [draft, ...prev]);
      if (setStats) {
        setStats((prev: any) =>
          prev
            ? {
                ...prev,
                readyToPublishCount: (prev.readyToPublishCount || 0) + 1,
              }
            : prev
        );
      }
      setErrorMsg(`Failed to publish "${itemName}": ${err.message}`);
    },
    onSuccess: () => {
      showSuccess(`🚀 Published "${itemName}" live to POS!`);
    },
  };
}

/**
 * Helper to build an optimistic expiry date update action
 */
export function buildUpdateExpirySyncAction({
  draftId,
  previousExpiryDate,
  newDateStr,
  setReadyToPublish,
  showSuccess,
  setErrorMsg,
}: {
  draftId: string;
  previousExpiryDate: string | null;
  newDateStr: string;
  setReadyToPublish: React.Dispatch<React.SetStateAction<any[]>>;
  showSuccess: (msg: string) => void;
  setErrorMsg: (msg: string | null) => void;
}): EnqueueOptions {
  return {
    id: `expiry-${draftId}`,
    type: "update_expiry_date",
    label: `Updated expiry date`,
    applyOptimistic: () => {
      setReadyToPublish((prev) =>
        prev.map((p) =>
          p._id === draftId
            ? {
                ...p,
                extractedExpiryDate: newDateStr
                  ? new Date(newDateStr).toISOString()
                  : null,
              }
            : p
        )
      );
    },
    run: async () => {
      const res = await fetch(`/api/products/ai-drafts/resolve/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractedExpiryDate: newDateStr || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update expiry date");
      return json;
    },
    rollback: (err: Error) => {
      // Restore previous expiry
      setReadyToPublish((prev) =>
        prev.map((p) =>
          p._id === draftId
            ? { ...p, extractedExpiryDate: previousExpiryDate }
            : p
        )
      );
      setErrorMsg(`Failed to update expiry date: ${err.message}`);
    },
    onSuccess: () => {
      showSuccess("Expiry date updated!");
    },
  };
}

