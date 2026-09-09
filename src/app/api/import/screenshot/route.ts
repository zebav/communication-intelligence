import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeImportedConversation } from "@/lib/connectors/import-analysis";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  if (!allowedTypes.has(image.type) || image.size > 8_000_000) return NextResponse.json({ error: "Use a PNG, JPEG, or WebP image smaller than 8 MB." }, { status: 400 });
  const imageUrl = `data:${image.type};base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}`;
  try {
    return NextResponse.json(await analyzeImportedConversation({ ownerId: user.id, content: [{ type: "input_text", text: "Read and analyze this conversation screenshot." }, { type: "input_image", image_url: imageUrl, detail: "high" }] }));
  } catch { return NextResponse.json({ error: "The screenshot could not be read and analyzed. Try a clearer image." }, { status: 502 }); }
}
