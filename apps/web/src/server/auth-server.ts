import { auth } from "@/server/services";

export async function getSession() {
  const session = await auth.api.getSession({
    headers: new Headers(),
  });
  return session;
}

export async function getUserFromRequest(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  return session?.user ?? null;
}