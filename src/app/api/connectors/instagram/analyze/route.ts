import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { analyzeIncomingInstagramMessage } from "@/lib/connectors/instagram-intelligence";

const schema = z.object({ conversationId: z.string().uuid() });

/** Prepares a draft only. Sending remains a separate owner-approved action. */
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig Instagram-konversation." }, { status: 400 });

  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Logga in igen." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Tvåfaktorsinloggning krävs." }, { status: 403 });

  const { data: message, error } = await database.from("messages")
    .select("id,conversation_id,metadata")
    .eq("owner_id", user.id).eq("conversation_id", parsed.data.conversationId).eq("source", "instagram").eq("direction", "in")
    .order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !message) return NextResponse.json({ error: "Det inkommande Instagram-meddelandet hittades inte." }, { status: 404 });

  const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
  if (metadata.ai_analysis && typeof metadata.ai_analysis === "object") return NextResponse.json({ analyzed: false, alreadyPrepared: true });
  await analyzeIncomingInstagramMessage({ ownerId: user.id, conversationId: message.conversation_id, messageId: message.id });
  return NextResponse.json({ analyzed: true });
}
