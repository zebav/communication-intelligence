import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  const parsed = z.object({ messageId: z.string().uuid(), score: z.number().min(1).max(10), reason: z.string().trim().min(1).max(1000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Välj prioritet 1–10 och skriv varför." }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!user || aal?.currentLevel !== "aal2") return NextResponse.json({ error: "Logga in med tvåfaktor." }, { status: 401 });
  const { error } = await db.rpc("correct_priority_v3", { message_id: parsed.data.messageId, priority: parsed.data.score, explanation: parsed.data.reason });
  return error ? NextResponse.json({ error: "Prioriteringen kunde inte sparas. Kontrollera att databasmigrationen är installerad." }, { status: 503 }) : NextResponse.json({ success: true });
}
