"use client";

import { useEffect, useId, useState } from "react";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { formatDay, today } from "@/lib/local-db";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTH_LABEL = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * An inline month-grid date picker, styled after Samsung's calendar: month
 * title with chevrons, a Su–Sa header, a filled circle on the selected day and
 * a shortcut back to today.
 *
 * Inline rather than a floating popover on purpose — the panel opens beneath
 * its trigger inside the form, so there is no positioning to get wrong on a
 * phone and the browser's own date wheel (which is the one native control this
 * replaces) never hides a whole month behind a tiny field.
 *
 * All maths is UTC because the database stores calendar days as `YYYY-MM-DD`
 * and parses them as UTC; a local-timezone step here is what turns "the 31st"
 * into the 1st somewhere west of Greenwich.
 */
export default function CalendarPicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Choose a date",
  className = "",
}: {
  /** Selected day, `YYYY-MM-DD`, or "" when nothing is chosen yet. */
  value: string;
  onChange: (day: string) => void;
  /** Earliest selectable day, inclusive. */
  min?: string;
  /** Latest selectable day, inclusive. */
  max?: string;
  placeholder?: string;
  className?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const todayIso = today();

  // The month the grid shows. Seeded from the selection (or today) each time
  // the panel opens, so reopening always centres on what matters rather than
  // wherever it was left.
  const [view, setView] = useState(() => seedView(value, todayIso));

  useEffect(() => {
    if (open) setView(seedView(value, todayIso));
  }, [open, value, todayIso]);

  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const leadingBlanks = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();

  function step(delta: number) {
    setView(({ year, month }) => {
      const next = month + delta;
      if (next < 0) return { year: year - 1, month: 11 };
      if (next > 11) return { year: year + 1, month: 0 };
      return { year, month: next };
    });
  }

  function pick(day: string) {
    onChange(day);
    setOpen(false);
  }

  function allowed(day: string): boolean {
    if (min && day < min) return false;
    if (max && day > max) return false;
    return true;
  }

  return (
    <div className={className}>
      {/* The trigger reads like the field it replaces, so nothing about the
          form's rhythm changes — only what opens underneath it. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="mt-2 flex h-12 w-full items-center gap-2 rounded-2xl border border-input bg-transparent px-4 text-left outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={value ? "truncate" : "truncate text-muted-foreground"}>
          {value ? formatDay(value) : placeholder}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Pick a date"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="mt-2 overflow-hidden rounded-2xl border bg-card p-3 shadow-soft"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => step(-1)}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <p className="text-sm font-semibold tabular-nums">
              {MONTH_LABEL.format(new Date(Date.UTC(view.year, view.month, 1)))}
            </p>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => step(1)}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center">
            {WEEKDAYS.map((label) => (
              <span key={label} className="py-1 text-[11px] font-medium text-muted-foreground">
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {Array.from({ length: leadingBlanks }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden="true" />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const date = iso(view.year, view.month, day);
              const selected = date === value;
              const isToday = date === todayIso;
              const disabled = !allowed(date);
              return (
                <button
                  key={date}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={formatDay(date)}
                  onClick={() => pick(date)}
                  className={`mx-auto flex size-9 items-center justify-center rounded-full text-sm transition-colors ${
                    selected
                      ? "bg-primary font-semibold text-primary-foreground"
                      : disabled
                        ? "text-muted-foreground/40"
                        : "text-foreground hover:bg-accent"
                  } ${!selected && isToday ? "ring-1 ring-ring" : ""}`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex justify-center border-t pt-2">
            <button
              type="button"
              disabled={!allowed(todayIso)}
              onClick={() => pick(todayIso)}
              className="h-8 rounded-full px-4 text-xs font-medium text-primary transition-colors hover:bg-primary-subtle disabled:opacity-40"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function seedView(value: string, todayIso: string): { year: number; month: number } {
  const anchor = value || todayIso;
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7)) - 1;
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 0 && month <= 11) {
    return { year, month };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}
