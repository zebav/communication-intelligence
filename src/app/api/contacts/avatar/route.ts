import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const personId = form.get("person_id");

  if (!(file instanceof File) || typeof personId !== "string" || !personId) {
    return NextResponse.json(
      { error: "file and person_id are required" },
      { status: 400 },
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 415 });
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  }

  const payload = new FormData();
  payload.set("file", file, file.name || "avatar");
  payload.set("person_id", personId);

  const { data, error } = await supabase.functions.invoke("set-contact-avatar", {
    body: payload,
  });

  if (error) {
    return NextResponse.json(
      { error: "Avatar upload failed", detail: error.message },
      { status: 502 },
    );
  }

  return NextResponse.json(data);
}
