import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ENV } from "@/env";

const planRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  intent: z.string().trim().max(1_000).optional(),
  currency: z.string().trim().min(1).max(8),
  targetAmount: z.number().finite().positive(),
  targetDate: z.string().date().optional(),
  monthlyRequired: z.number().finite().nonnegative(),
  monthlyCapacity: z.number().finite().nonnegative(),
  feasibility: z.enum(["comfortable", "tight", "impossible", "unknown"]),
});

const planAdviceSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  steps: z.array(z.string().trim().min(1).max(240)).min(2).max(5),
  adjustment: z.string().trim().min(1).max(400),
});

// Simple in-memory rate limiting for AI endpoints
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;

function getRequestKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
}

function rateLimit(max: number, request: NextRequest): NextResponse | null {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
  if (rateLimitBuckets.size > 10_000) rateLimitBuckets.clear();

  const key = `/api/ai/plan:${getRequestKey(request)}`;
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (bucket.count >= max) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)) } }
    );
  } else {
    bucket.count += 1;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = rateLimit(10, request);
  if (rateLimitResponse) return rateLimitResponse;

  const apiKey = ENV.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI planning is not configured on the server." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = planRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "The plan details were invalid." }, { status: 400 });
  }

  const facts = parsed.data;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: ENV.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a practical budgeting coach. Return only valid JSON with exactly these keys: title (string), summary (string), steps (array of 2 to 5 short strings), adjustment (string). Use only the supplied facts. Never invent balances, income, expenses, or dates. Do not give investment, lending, tax, or legal advice. If feasibility is impossible, be honest and suggest a later date, smaller target, expense reduction, or extra income. Keep the tone encouraging and concrete.",
          },
          {
            role: "user",
            content: JSON.stringify(facts),
          },
        ],
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "The AI planning service is temporarily unavailable." },
        { status: 502 }
      );
    }

    const data = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "The AI planning service returned no advice." },
        { status: 502 }
      );
    }

    let advice: unknown;
    try {
      advice = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: "The AI planning service returned invalid advice." },
        { status: 502 }
      );
    }

    const validated = planAdviceSchema.safeParse(advice);
    if (!validated.success) {
      return NextResponse.json(
        { error: "The AI planning service returned incomplete advice." },
        { status: 502 }
      );
    }

    return NextResponse.json(validated.data);
  } catch {
    return NextResponse.json(
      { error: "The AI planning service is temporarily unavailable." },
      { status: 502 }
    );
  }
}