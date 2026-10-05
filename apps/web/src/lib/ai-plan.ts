export type PlanAdvice = {
  title: string;
  summary: string;
  steps: string[];
  adjustment: string;
};

export type PlanAdviceFacts = {
  name: string;
  intent?: string;
  currency: string;
  targetAmount: number;
  targetDate?: string;
  monthlyRequired: number;
  monthlyCapacity: number;
  feasibility: "comfortable" | "tight" | "impossible" | "unknown";
};

export async function requestPlanAdvice(facts: PlanAdviceFacts): Promise<PlanAdvice> {
  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL?.replace(/\/$/, "");
  if (!serverUrl) throw new Error("The AI server is not configured.");

  const response = await fetch(`${serverUrl}/api/ai/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(facts),
  });
  const body = (await response.json().catch(() => null)) as { error?: string } & Partial<PlanAdvice>;
  if (!response.ok) throw new Error(body.error || "Could not build AI advice.");
  if (
    typeof body.title !== "string" ||
    typeof body.summary !== "string" ||
    !Array.isArray(body.steps) ||
    body.steps.length < 2 ||
    body.steps.length > 5 ||
    !body.steps.every((step) => typeof step === "string" && step.trim().length > 0) ||
    typeof body.adjustment !== "string"
  ) {
    throw new Error("The AI server returned incomplete advice.");
  }
  return {
    title: body.title,
    summary: body.summary,
    steps: body.steps,
    adjustment: body.adjustment,
  };
}
