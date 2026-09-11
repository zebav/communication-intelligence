import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeImportedConversation } from "@/lib/connectors/import-analysis";
import { normalizeUniversalProfile } from "@/lib/communication-profile";
import { importedConversationHistory } from "@/lib/connectors/import-history";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Two-factor authentication is required." }, { status: 403 });
  const form = await request.formData();
  const image = form.get("image");
  const consent = form.get("consent");
  if (!(image instanceof File) || consent !== "yes") return NextResponse.json({ error: "Select an image and approve text extraction." }, { status: 400 });
  if (!allowedTypes.has(image.type)) return NextResponse.json({ error: "This phone image format is not supported. Choose a screenshot saved as PNG or JPEG." }, { status: 400 });
  if (image.size > 12_000_000) return NextResponse.json({ error: "The screenshot is larger than 12 MB. Crop it or choose a smaller image." }, { status: 400 });
  const imageUrl = `data:${image.type};base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}`;
  try {
    const { data: profile } = await supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
    const preferences = profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences) ? profile.preferences as { communication_persona?: unknown; universal_communication_profile?: unknown } : {};
    const universalProfile = normalizeUniversalProfile(preferences.universal_communication_profile, preferences.communication_persona);
    const personaContext = JSON.stringify({ identitySummary: universalProfile.identitySummary, values: universalProfile.values, defaultTone: universalProfile.defaultTone, preferredLength: universalProfile.preferredLength, principles: universalProfile.principles, signOff: universalProfile.signOff, channels: universalProfile.channels, situations: universalProfile.situations });
    const content = [{ type: "input_text", text: "Read and analyze this conversation screenshot." }, { type: "input_image", image_url: imageUrl, detail: "high" }];
    const models = [...new Set([process.env.OPENAI_VISION_MODEL, process.env.OPENAI_FAST_MODEL, "gpt-4.1-mini", "gpt-4o-mini"].filter((model): model is string => Boolean(model?.trim())))];
    let lastError: unknown;
    for (const model of models) {
      try {
        const initial = await analyzeImportedConversation({ ownerId: user.id, model, content, personaContext });
        const historicalContext = await importedConversationHistory(supabase, user.id, initial);
        if (!historicalContext) return NextResponse.json(initial);
        const refined = await analyzeImportedConversation({ ownerId: user.id, model, personaContext, historicalContext, content: [{ type: "input_text", text: `Current conversation only:\n${initial.transcript}` }] });
        return NextResponse.json({ ...refined, source: initial.source, participantName: initial.participantName, ownerName: initial.ownerName, accountLabel: initial.accountLabel, transcript: initial.transcript });
      } catch (error) {
        lastError = error;
        if (!(error instanceof Error) || !error.message.includes("_404_model_not_found")) throw error;
        console.warn("Screenshot model unavailable; trying fallback", { model });
      }
    }
    throw lastError ?? new Error("no_vision_model_available");
  } catch (error) { console.error("Screenshot import failed", { reason: error instanceof Error ? error.message : "unknown" }); return NextResponse.json({ error: "The image service could not complete the analysis. Please try again." }, { status: 502 }); }
}
