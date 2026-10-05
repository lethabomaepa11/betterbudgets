import { NextRequest } from "next/server";

type Session = {
  code: string;
  payload?: string;
  nonce?: string;
  createdAt: number;
  expiresAt: number;
};

const sessions = new Map<string, Session>();
const TTL = 10 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
}

export async function POST(request: NextRequest) {
  cleanup();
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action === "create") {
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const code = id.slice(0, 6).toUpperCase();
    const now = Date.now();
    sessions.set(id, { code, createdAt: now, expiresAt: now + TTL });
    return Response.json({ id, code, expiresAt: now + TTL });
  }

  const id = typeof body?.id === "string" ? body.id : "";
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return Response.json({ error: "This transfer has expired." }, { status: 404 });
  }

  if (action === "upload") {
    if (typeof body.payload !== "string" || typeof body.nonce !== "string" || body.payload.length > 8_000_000) {
      return Response.json({ error: "Invalid transfer payload." }, { status: 400 });
    }
    session.payload = body.payload;
    session.nonce = body.nonce;
    return Response.json({ ok: true });
  }
  if (action === "status") return Response.json({ ready: Boolean(session.payload), expiresAt: session.expiresAt });
  if (action === "download") {
    if (body.code !== session.code) return Response.json({ error: "Incorrect pairing code." }, { status: 403 });
    if (!session.payload || !session.nonce) return Response.json({ ready: false });
    return Response.json({ ready: true, payload: session.payload, nonce: session.nonce, expiresAt: session.expiresAt });
  }
  return Response.json({ error: "Unknown transfer action." }, { status: 400 });
}
