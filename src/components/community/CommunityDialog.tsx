"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

import { Button } from "@/src/components/ui/Button";

export function CommunityDialog({
  children,
  description,
  disabled = false,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  disabled?: boolean;
  onClose: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    disabledRef.current = disabled;
    onCloseRef.current = onClose;
  }, [disabled, onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !disabledRef.current) {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() =>
      dialog
        ?.querySelector<HTMLElement>("button, input, select, textarea")
        ?.focus(),
    );

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0B1F33]/70 px-4 py-4 backdrop-blur-sm">
      <div className="flex min-h-full items-end justify-center sm:items-center">
        <div
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          aria-modal="true"
          className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/25 sm:p-6"
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-[#0B1F33]" id={titleId}>
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#425B76]" id={descriptionId}>
                {description}
              </p>
            </div>
            <Button
              aria-label="Close dialog"
              disabled={disabled}
              onClick={onClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              Close
            </Button>
          </div>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
