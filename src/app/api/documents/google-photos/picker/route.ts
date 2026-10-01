import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { importGooglePhotosPickerSelection, startGooglePhotosPicker } from "@/lib/documents/google-photos-picker";

const requestSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("start") }), z.object({ action: z.literal("import"), sessionId: z.string().trim().min(3).max(500) })]);

async function session(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) throw new Error("origin");
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("auth");
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") throw new Error("mfa");
  return { db, ownerId: user.id };
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Kontrollera bildvalet." }, { status: 400 });
  try {
    const current = await session(request);
    const data = parsed.data.action === "start" ? await startGooglePhotosPicker(current.ownerId, current.db) : await importGooglePhotosPickerSelection(current.ownerId, current.db, parsed.data.sessionId);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Foto kunde inte användas just nu.";
    const status = message === "auth" ? 401 : message === "mfa" ? 403 : message === "origin" ? 403 : 409;
    return NextResponse.json({ error: message === "auth" ? "Logga in igen." : message === "mfa" ? "MFA krävs." : message === "origin" ? "Ogiltigt ursprung." : message }, { status });
  }
}
