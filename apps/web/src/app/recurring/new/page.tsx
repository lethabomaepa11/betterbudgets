"use client";

import RecurringForm from "@/components/recurring-form";

/**
 * Setup for money that repeats.
 *
 * Kept separate from `/transactions/new` rather than a checkbox on that form.
 * Recording rent you just paid and promising to pay it next month are different
 * acts, and merging them means the recurring fields are present on every
 * one-off entry — which is the shape that produces a form nobody can read.
 */
export default function NewRecurringPage() {
  return <RecurringForm />;
}