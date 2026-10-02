import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const allowedMimeTypes = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
const maxBytes = 5 * 1024 * 1024;

function safeFilename(name: string, fallbackExt: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  if (cleaned.includes(".")) return cleaned;
  return `${cleaned || "contact-avatar"}.${fallbackExt}`;
}

export async function resolveContactForChatGPT(ownerId: string, input: { personId?: string; participantName?: string }) {
  const db = createAdminClient();
  if (input.personId) {
    const { data: person } = await db.from("people").select("id,display_name").eq("owner_id", ownerId).eq("id", input.personId).maybeSingle();
    if (!person) throw new Error("Contact not found.");
    return person;
  }
  if (!input.participantName?.trim()) throw new Error("personId or participantName is required.");
  const { data: candidates, error } = await db.from("people")
    .select("id,display_name,last_contact_at")
    .eq("owner_id", ownerId)
    .ilike("display_name", input.participantName.trim())
    .or("relationship_status.is.null,relationship_status.neq.merged")
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(5);
  if (error) throw new Error("Could not resolve contact.");
  if (!candidates?.length) throw new Error("Contact not found.");
  if (candidates.length > 1) {
    const error = new Error("Ambiguous contact name.");
    Object.assign(error, { candidates: candidates.map(c => ({ id: c.id, displayName: c.display_name })) });
    throw error;
  }
  return candidates[0];
}

export async function setContactAvatarFromBytes(args: {
  ownerId: string;
  personId: string;
  bytes: Buffer;
  mimeType: string;
  filename?: string;
  source?: string;
}) {
  if (!allowedMimeTypes.has(args.mimeType)) throw new Error("Unsupported image type.");
  if (!args.bytes.length) throw new Error("Image is empty.");
  if (args.bytes.length > maxBytes) throw new Error("Image must be 5 MB or smaller.");

  const db = createAdminClient();
  const { data: person } = await db.from("people").select("id").eq("owner_id", args.ownerId).eq("id", args.personId).maybeSingle();
  if (!person) throw new Error("Contact not found.");

  const sha256 = createHash("sha256").update(args.bytes).digest("hex");
  const extMap: Record<string,string> = {"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic","image/heif":"heif"};
  const filename = safeFilename(args.filename || "contact-avatar", extMap[args.mimeType] || "jpg");
  const storagePath = `contacts/${args.ownerId}/${args.personId}/${randomUUID()}-${filename}`;

  const { data: existingAsset, error: existingError } = await db.from("vault_assets")
    .select("id,storage_bucket,storage_path")
    .eq("owner_id", args.ownerId)
    .eq("sha256", sha256)
    .maybeSingle();
  if (existingError) throw new Error("Could not check existing image.");

  let assetId = existingAsset?.id as string | undefined;
  let finalPath = existingAsset?.storage_path as string | undefined;
  let finalBucket = (existingAsset?.storage_bucket as string | undefined) ?? "secure-vault";

  if (!assetId) {
    const upload = await db.storage.from("secure-vault").upload(storagePath, args.bytes, { contentType: args.mimeType, upsert: false });
    if (upload.error) throw new Error(`Could not store image: ${upload.error.message}`);
    const { data: asset, error: assetError } = await db.from("vault_assets").insert({
      owner_id: args.ownerId,
      asset_kind: "person_image",
      retention_status: "saved",
      title: "Contact avatar",
      filename,
      mime_type: args.mimeType,
      size_bytes: args.bytes.length,
      storage_bucket: "secure-vault",
      storage_path: storagePath,
      sha256,
      sensitivity: "personal",
      summary: "Contact avatar explicitly selected by the owner.",
      retention_reason: "Owner-selected contact avatar",
      importance_score: 1,
      reusable: true,
      source_type: "chatgpt_upload",
      source_person_id: args.personId,
      ai_decision: { selected_by_owner: true, source: args.source || "chatgpt" },
      metadata: { role: "avatar", user_verified: true, source: args.source || "chatgpt" },
    }).select("id").single();
    if (assetError || !asset) {
      await db.storage.from("secure-vault").remove([storagePath]);
      throw new Error("Could not create image asset.");
    }
    assetId = asset.id;
    finalPath = storagePath;
  }

  const { error: demoteError } = await db.from("person_media").update({ role: "reference" })
    .eq("owner_id", args.ownerId).eq("person_id", args.personId).eq("role", "avatar");
  if (demoteError) throw new Error("Could not update previous avatar.");

  const { data: existingLink } = await db.from("person_media").select("id")
    .eq("owner_id", args.ownerId).eq("person_id", args.personId).eq("asset_id", assetId).maybeSingle();
  if (existingLink?.id) {
    const { error } = await db.from("person_media").update({ role:"avatar",match_method:"manual",confidence:1,user_verified:true }).eq("id",existingLink.id);
    if (error) throw new Error("Could not link image to contact.");
  } else {
    const { error } = await db.from("person_media").insert({
      owner_id: args.ownerId, person_id: args.personId, asset_id: assetId,
      role:"avatar", match_method:"manual", confidence:1, user_verified:true,
    });
    if (error) throw new Error("Could not link image to contact.");
  }

  const { error: updateError } = await db.from("people").update({ avatar_asset_id: assetId, updated_at: new Date().toISOString() })
    .eq("owner_id", args.ownerId).eq("id", args.personId);
  if (updateError) throw new Error("Could not update contact avatar.");

  await db.from("audit_logs").insert({
    owner_id: args.ownerId,
    actor_id: args.ownerId,
    actor_type: "assistant",
    action: "person.avatar_updated",
    object_type: "person",
    object_id: args.personId,
    new_value: { asset_id: assetId, source: args.source || "chatgpt" },
  });

  return { personId: args.personId, assetId, storageBucket: finalBucket, storagePath: finalPath };
}
