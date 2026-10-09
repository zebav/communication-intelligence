import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reconcileSlackConnection } from "@/lib/connectors/slack-reconciliation";
import { createClient } from "@/lib/supabase/server";

function reconnectRequired(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /slack_(reconnect_required|invalid_auth|token_revoked|missing_scope|not_authed)/.test(message);
}

/**
 * Owner-initiated, bounded Slack import. The reconciler only reads messages
 * from conversations the owner is already a member of; it never sends or
 * modifies anything in Slack.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  }

  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Din session har gått ut." }, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") {
    return NextResponse.json({ error: "Tvåstegsverifiering krävs." }, { status: 403 });
  }

  const connectionId = z.string().uuid().safeParse(request.nextUrl.searchParams.get("connectionId"));
  if (!connectionId.success) return NextResponse.json({ error: "Välj ett Slack-konto." }, { status: 400 });

  const { data: connection } = await database.from("connections")
    .select("id")
    .eq("id", connectionId.data)
    .eq("owner_id", user.id)
    .eq("provider", "slack")
    .eq("status", "connected")
    .maybeSingle();
  if (!connection) return NextResponse.json({ error: "Slack-kontot är inte anslutet." }, { status: 409 });

  try {
    const result = await reconcileSlackConnection(connection.id);
    return NextResponse.json({
      imported: result.imported,
      unavailableConversations: result.unavailableConversations,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await database.from("connections").update({
      health_status: reconnectRequired(error) ? "reconnect_required" : "degraded",
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id).eq("owner_id", user.id);
    return NextResponse.json({
      error: reconnectRequired(error)
        ? "Slack behöver anslutas igen för att fortsätta hämta meddelanden."
        : "Slack-meddelanden kunde inte hämtas just nu. Solvani försöker igen automatiskt.",
    }, { status: reconnectRequired(error) ? 409 : 502 });
  }
}
