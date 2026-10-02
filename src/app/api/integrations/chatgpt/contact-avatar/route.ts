import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const payloadSchema = z.object({
  personId: z.string().uuid().optional(),
  participantName: z.string().trim().min(1).max(120).optional(),
  imageBase64: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  filename: z.string().trim().min(1).max(160).optional().default("contact-avatar.jpg"),
}).refine((value) => value.personId || value.participantName, {
  message: "personId or participantName is required",
});

function authorized(request: NextRequest) {
  const expected = process.env.CHATGPT_CAPTURE_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const actual = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function safeFilename(name: string, fallbackExt: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  if (cleaned.includes(".")) return cleaned;
  return `${cleaned || "contact-avatar"}.${fallbackExt}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerId = process.env.CHATGPT_CAPTURE_OWNER_ID;
  if (!ownerId) return NextResponse.json({ error: "ChatGPT owner is not configured." }, { status: 503 });

  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payload." }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(parsed.imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  } catch {
    return NextResponse.json({ error: "Invalid base64 image." }, { status: 400 });
  }
  if (!bytes.length) return NextResponse.json({ error: "Image is empty." }, { status: 400 });
  if (bytes.length > 5 * 1024 * 1024) return NextResponse.json({ error: "Image must be 5 MB or smaller." }, { status: 413 });

  const db = createAdminClient();

  let personId = parsed.personId;
  if (personId) {
    const { data: person } = await db.from("people").select("id").eq("owner_id", ownerId).eq("id", personId).maybeSingle();
    if (!person) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  } else {
    const { data: candidates, error } = await db.from("people")
      .select("id,display_name,last_contact_at")
      .eq("owner_id", ownerId)
      .ilike("display_name", parsed.participantName!)
      .or("relationship_status.is.null,relationship_status.neq.merged")
      .order("last_contact_at", { ascending: false, nullsFirst: false })
      .limit(5);
    if (error) return NextResponse.json({ error: "Could not resolve contact." }, { status: 500 });
    if (!candidates?.length) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    if (candidates.length > 1) {
      return NextResponse.json({
        error: "Ambiguous contact name.",
        candidates: candidates.map((candidate) => ({ id: candidate.id, displayName: candidate.display_name })),
      }, { status: 409 });
    }
    personId = candidates[0].id;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  const filename = safeFilename(parsed.filename, extMap[parsed.mimeType]);
  const storagePath = `contacts/${ownerId}/${personId}/${randomUUID()}-${filename}`;

  const { data: existingAsset, error: existingError } = await db.from("vault_assets")
    .select("id,storage_bucket,storage_path")
    .eq("owner_id", ownerId)
    .eq("sha256", sha256)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "Could not check existing image." }, { status: 500 });

  let assetId = existingAsset?.id;
  let finalPath = existingAsset?.storage_path;
  let finalBucket = existingAsset?.storage_bucket ?? "secure-vault";

  if (!assetId) {
    const upload = await db.storage.from("secure-vault").upload(storagePath, bytes, {
      contentType: parsed.mimeType,
      upsert: false,
    });
    if (upload.error) return NextResponse.json({ error: "Could not store image.", detail: upload.error.message }, { status: 500 });

    const { data: asset, error: assetError } = await db.from("vault_assets").insert({
      owner_id: ownerId,
      asset_kind: "person_image",
      retention_status: "saved",
      title: "Contact avatar",
      filename,
      mime_type: parsed.mimeType,
      size_bytes: bytes.length,
      storage_bucket: "secure-vault",
      storage_path: storagePath,
      sha256,
      sensitivity: "personal",
      summary: "Contact avatar explicitly selected by the owner in ChatGPT.",
      retention_reason: "Owner-selected contact avatar",
      importance_score: 1,
      reusable: true,
      source_type: "chatgpt_upload",
      source_person_id: personId,
      ai_decision: { selected_by_owner: true, source: "chatgpt_plugin" },
      metadata: { role: "avatar", user_verified: true, source: "chatgpt_plugin" },
    }).select("id").single();

    if (assetError || !asset) {
      await db.storage.from("secure-vault").remove([storagePath]);
      return NextResponse.json({ error: "Could not create image asset." }, { status: 500 });
    }
    assetId = asset.id;
    finalPath = storagePath;
  }

  const { error: demoteError } = await db.from("person_media")
    .update({ role: "reference" })
    .eq("owner_id", ownerId)
    .eq("person_id", personId)
    .eq("role", "avatar");
  if (demoteError) return NextResponse.json({ error: "Could not update previous avatar." }, { status: 500 });

  const { data: existingLink } = await db.from("person_media")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("person_id", personId)
    .eq("asset_id", assetId)
    .maybeSingle();

  if (existingLink?.id) {
    const { error } = await db.from("person_media").update({
      role: "avatar",
      match_method: "manual",
      confidence: 1,
      user_verified: true,
    }).eq("id", existingLink.id);
    if (error) return NextResponse.json({ error: "Could not link image to contact." }, { status: 500 });
  } else {
    const { error } = await db.from("person_media").insert({
      owner_id: ownerId,
      person_id: personId,
      asset_id: assetId,
      role: "avatar",
      match_method: "manual",
      confidence: 1,
      user_verified: true,
    });
    if (error) return NextResponse.json({ error: "Could not link image to contact." }, { status: 500 });
  }

  const { error: personUpdateError } = await db.from("people")
    .update({ avatar_asset_id: assetId, updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("id", personId);
  if (personUpdateError) return NextResponse.json({ error: "Could not update contact avatar." }, { status: 500 });

  await db.from("audit_logs").insert({
    owner_id: ownerId,
    actor_id: ownerId,
    actor_type: "assistant",
    action: "person.avatar_updated",
    object_type: "person",
    object_id: personId,
    new_value: { asset_id: assetId, source: "chatgpt_plugin" },
  });

  return NextResponse.json({
    ok: true,
    personId,
    assetId,
    storageBucket: finalBucket,
    storagePath: finalPath,
  });
}
