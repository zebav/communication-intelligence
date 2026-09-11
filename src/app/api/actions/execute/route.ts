import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeExternalActionUrl } from "@/lib/safe-action";
import { createClient } from "@/lib/supabase/server";
const schema = z.object({ messageId: z.string().uuid(), mode: z.enum(["start", "complete"]) });
function jsonError(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return jsonError("Invalid request origin.", 403);
  const input = schema.safeParse(await request.json().catch(() => null)); if (!input.success) return jsonError("Choose a valid suggested task.");
  const database = await createClient(); const { data: { user } } = await database.auth.getUser(); if (!user) return jsonError("Your session has expired. Sign in again.", 401);
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel(); if (assurance?.currentLevel !== "aal2") return jsonError("Two-factor authentication is required.", 403);
  const { data: message } = await database.from("messages").select("id,metadata").eq("id", input.data.messageId).eq("owner_id", user.id).maybeSingle();
  const metadata = message?.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : null;
  const analysis = metadata?.ai_analysis && typeof metadata.ai_analysis === "object" && !Array.isArray(metadata.ai_analysis) ? metadata.ai_analysis as Record<string, unknown> : null;
  const suggestion = analysis?.actionSuggestion && typeof analysis.actionSuggestion === "object" && !Array.isArray(analysis.actionSuggestion) ? analysis.actionSuggestion as Record<string, unknown> : null;
  if (!message || suggestion?.detected !== true) return jsonError("The suggested task could not be found.", 404);
  const url = safeExternalActionUrl(typeof suggestion.targetUrl === "string" ? suggestion.targetUrl : ""); if (input.data.mode === "start" && !url) return jsonError(suggestion.targetUrl ? "The proposed website is not a permitted HTTPS address." : "No website address was found in this task. Generate a new analysis before opening it.", 422);
  const status = input.data.mode === "start" ? "started" : "completed"; const updated = { ...suggestion, status, [input.data.mode === "start" ? "startedAt" : "completedAt"]: new Date().toISOString() };
  const { error } = await database.from("messages").update({ metadata: { ...metadata, ai_analysis: { ...analysis, actionSuggestion: updated } } }).eq("id", message.id).eq("owner_id", user.id); if (error) return jsonError("The task status could not be saved.", 500);
  await database.from("audit_logs").insert({ owner_id: user.id, actor_id: user.id, action: `safe_action.${status}`, object_type: "message", object_id: message.id, source: "email", actor_type: "user", new_value: { type: suggestion.type, url_host: url ? new URL(url).hostname : null } });
  return NextResponse.json({ status, url });
}
