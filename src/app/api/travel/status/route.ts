import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { travelSearchCapability } from "@/lib/travel/skyscanner";

// Never exposes the provider key. This is deliberately a readiness check, not
// a live travel search: provider endpoints are enabled only after acceptance
// testing with the approved partner account.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ capability: travelSearchCapability() });
}
