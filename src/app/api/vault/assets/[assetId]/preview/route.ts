import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { signedVaultPreviewUrl } from "@/lib/vault/vault-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const { data: assurance } = await database.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel !== "aal2") return new NextResponse(null, { status: 403 });
  const { assetId } = await params;
  if (!z.string().uuid().safeParse(assetId).success) return new NextResponse(null, { status: 400 });
  try { return NextResponse.redirect(await signedVaultPreviewUrl(user.id, assetId), 307); }
  catch { return new NextResponse(null, { status: 404 }); }
}
