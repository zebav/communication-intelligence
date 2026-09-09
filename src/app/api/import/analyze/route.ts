import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { analyzeImportedConversation } from "@/lib/connectors/import-analysis";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({ transcript: z.string().trim().min(1).max(100_000) });

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste a conversation first." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });
  try {
    return NextResponse.json(await analyzeImportedConversation({ ownerId: user.id, content: [{ type: "input_text", text: parsed.data.transcript }] }));
  } catch { return NextResponse.json({ error: "The conversation could not be analyzed. Try again." }, { status: 502 }); }
}
