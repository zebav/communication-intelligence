import { createClient } from "@/lib/supabase/server";
export async function calendarSession() {
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  const {data:aal}=await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if(!user || aal?.currentLevel!=="aal2") throw new Error("Logga in med tvåfaktor för att använda kalendern.");
  return {db,owner:user.id};
}
