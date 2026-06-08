"use client";

// Lightweight global toast system. Mounted once near the app root; any client
// component can fire transient success/error/info messages via useToast(). The
// stack is phone-width, anchored above the bottom nav, token-styled, and
// auto-dismisses. Tapping a toast dismisses it early.

import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { SNAP } from "@/lib/motion";

type Variant = "success" | "error" | "info";
type ToastItem = { id: number; message: string; variant: Variant };
type ToastApi = { toast: (message: string, variant?: Variant) => void };

const ToastContext = createContext<ToastApi | null>(null);

// No-ops if used outside a provider, so callers never need to guard.
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { toast: () => {} };
}

const STRIPE: Record<Variant, string> = {
  success: "border-l-good",
  error: "border-l-bad",
  info: "border-l-accent",
};
const ICON: Record<Variant, string> = { success: "✅", error: "⚠️", info: "🍺" };
const DISMISS_MS = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: Variant = "info") => {
      const id = ++idRef.current;
      setToasts((cur) => [...cur, { id, message, variant }]);
      window.setTimeout(() => remove(id), DISMISS_MS);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-w-md flex-col gap-2 p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: SNAP }}
              exit={{ opacity: 0, y: 10, scale: 0.98, transition: { ...SNAP, duration: 0.12 } }}
              onClick={() => remove(t.id)}
              role="status"
              className={`card press pointer-events-auto flex items-center gap-2 border-l-4 ${STRIPE[t.variant]} px-4 py-3 text-sm`}
            >
              <span aria-hidden>{ICON[t.variant]}</span>
              <span className="font-medium">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
