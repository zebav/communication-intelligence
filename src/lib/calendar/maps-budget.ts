import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";

export type MapsOperation = "places" | "route" | "weather" | "map" | "details";
export class MapsBudgetError extends Error {
 constructor() {super("Maps-anropet stoppades av kostnadsskyddet. Gränsen är nådd eller användningsräknaren kunde inte kontrolleras.");}
}
/** Called only after owner/MFA checks. A shared DB lock fences concurrent deployments. */
export async function reserveMapsOperation(kind:MapsOperation) {
 try {
  const {data,error}=await createAdminClient().rpc("reserve_calendar_maps",{p_kind:kind});
  if(error||data!==true)throw new MapsBudgetError();
 }catch{throw new MapsBudgetError();}
}
export const mapsEnabled=()=>process.env.CALENDAR_MAPS_ENABLED==="true"&&Boolean(process.env.GOOGLE_MAPS_SERVER_API_KEY);
