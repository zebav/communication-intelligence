import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const id = z.string().uuid();
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const maxBytes = 10 * 1024 * 1024;

async function session(personId: string) {
  const parsed = id.safeParse(personId);
  if (!parsed.success) throw new Error("Ogiltig kontakt.");
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Logga in igen.");
  const { data: assurance } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") throw new Error("Tvåfaktorsinloggning krävs för kontaktbilder.");
  const { data: person, error } = await db.from("people").select("id").eq("owner_id", user.id).eq("id", parsed.data).maybeSingle();
  if (error || !person) throw new Error("Kontakten kunde inte läsas.");
  return { db, owner: user.id, personId: parsed.data };
}

export async function GET(_: NextRequest, context: { params: Promise<{ personId: string }> }) {
  try {
    const { personId, owner } = await session((await context.params).personId);
    const admin = createAdminClient();
    const { data: link, error } = await admin.from("person_media").select("asset_id").eq("owner_id", owner).eq("person_id", personId).eq("role", "avatar").maybeSingle();
    if (error) throw new Error("Kontaktbilden kunde inte läsas.");
    if (!link) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const { data: asset, error: assetError } = await admin.from("vault_assets").select("storage_bucket,storage_path").eq("owner_id", owner).eq("id", link.asset_id).maybeSingle();
    if (assetError || !asset) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const { data: signed, error: signedError } = await admin.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 300);
    if (signedError || !signed?.signedUrl) throw new Error("Kontaktbilden kunde inte öppnas.");
    return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kontaktbilden kunde inte öppnas." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ personId: string }> }) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  try {
    const { db, owner, personId } = await session((await context.params).personId);
    const form = await request.formData();
    const image = (form as unknown as { get(name: string): FormDataEntryValue | null }).get("image");
    if (!(image instanceof File) || !allowedMimeTypes.has(image.type)) throw new Error("Välj en JPEG, PNG, WebP eller HEIC-bild.");
    if (!image.size || image.size > maxBytes) throw new Error("Bilden måste vara mindre än 10 MB.");
    const bytes = Buffer.from(await image.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const admin = createAdminClient();
    const { data: existing, error: existingError } = await admin.from("vault_assets").select("id").eq("owner_id", owner).eq("sha256", sha256).maybeSingle();
    if (existingError) throw new Error("Bilden kunde inte kontrolleras.");
    let assetId = existing?.id;
    if (!assetId) {
      const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "contact-photo";
      const path = `contacts/${owner}/${personId}/${randomUUID()}-${safeName}`;
      const uploaded = await admin.storage.from("secure-vault").upload(path, bytes, { contentType: image.type, upsert: false });
      if (uploaded.error) throw new Error("Bilden kunde inte lagras säkert.");
      const { data: asset, error: insertError } = await admin.from("vault_assets").insert({
        owner_id: owner, asset_kind: "person_image", retention_status: "saved", title: `Kontaktbild`, filename: safeName,
        mime_type: image.type, size_bytes: bytes.length, storage_path: path, sha256, sensitivity: "personal", source_type: "manual",
        source_person_id: personId, summary: "Manuellt uppladdad kontaktbild.", retention_reason: "Kontaktidentifiering", reusable: false,
      }).select("id").single();
      if (insertError || !asset) {
        await admin.storage.from("secure-vault").remove([path]);
        throw new Error("Kontaktbilden kunde inte sparas.");
      }
      assetId = asset.id;
    }
    const { error: demoteError } = await admin.from("person_media").update({ role: "reference" }).eq("owner_id", owner).eq("person_id", personId).eq("role", "avatar");
    if (demoteError) throw new Error("Den tidigare kontaktbilden kunde inte uppdateras.");
    const { error: linkError } = await admin.from("person_media").upsert({ owner_id: owner, person_id: personId, asset_id: assetId, role: "avatar", match_method: "manual", confidence: 1, user_verified: true }, { onConflict: "owner_id,person_id,asset_id" });
    if (linkError) throw new Error("Kontaktbilden kunde inte kopplas till kontakten.");
    await db.from("audit_logs").insert({ owner_id: owner, actor_id: owner, action: "person.avatar_updated", object_type: "person", object_id: personId, actor_type: "user", new_value: { asset_id: assetId } });
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kontaktbilden kunde inte sparas." }, { status: 400 });
  }
}
