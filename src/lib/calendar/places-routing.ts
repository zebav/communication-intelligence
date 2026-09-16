import { z } from "zod";

export const routeRequestSchema = z.object({
  originPlaceId: z.string().trim().min(1).max(300),
  destinationPlaceId: z.string().trim().min(1).max(300),
  departureTime: z.iso.datetime({ offset: true }),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]),
}).strict();
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteEstimate = {
  status: "ESTIMATED"; minutes: number; distanceMeters: number; checkedAt: string;
  departureTime: string; originPlaceId: string; destinationPlaceId: string; mode: RouteRequest["mode"];
};
export type PlaceCandidate = { id: string; name: string; address: string; mapsUrl: string; location?:{latitude:number;longitude:number} };
export interface PlaceService { search(query: string): Promise<PlaceCandidate[]> }
export interface RouteService { estimate(request: RouteRequest): Promise<RouteEstimate> }

/** Constructed only on the server; no API key, raw response or provider error goes to clients. */
export class GooglePlacesRoutes implements PlaceService, RouteService {
  constructor(private readonly key: string, private readonly transport: typeof fetch = fetch,
    private readonly reserve: (kind:"places"|"route")=>Promise<void> = async()=>{}) {
    if (!key.trim()) throw new Error("Plats- och restidstjänsten är inte konfigurerad.");
  }
  async search(query: string): Promise<PlaceCandidate[]> {
    const textQuery = z.string().trim().min(3).max(300).parse(query);
    await this.reserve("places");
    const response = await this.transport("https://places.googleapis.com/v1/places:searchText", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location" },
      body: JSON.stringify({ textQuery, languageCode: "sv", pageSize: 5 }),
    });
    if (!response.ok) throw new Error("Platssökningen kunde inte genomföras. Ingen plats har valts.");
    const page = z.object({ places: z.array(z.object({ id:z.string(),displayName:z.object({text:z.string()}),
      formattedAddress:z.string(),googleMapsUri:z.string().url(),location:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).optional() })).default([]) }).parse(await response.json());
    return page.places.map(p => ({ id:p.id,name:p.displayName.text,address:p.formattedAddress,mapsUrl:p.googleMapsUri,location:p.location }));
  }
  async estimate(raw: RouteRequest): Promise<RouteEstimate> {
    const request = routeRequestSchema.parse(raw);
    if (Date.parse(request.departureTime) <= Date.now()) throw new Error("Välj en framtida avresetid.");
    await this.reserve("route");
    const response = await this.transport("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type":"application/json", "X-Goog-Api-Key":this.key,"X-Goog-FieldMask":"routes.duration,routes.distanceMeters" },
      body: JSON.stringify({ origin:{placeId:request.originPlaceId},destination:{placeId:request.destinationPlaceId},
        travelMode:request.mode, ...(request.mode === "DRIVE" ? {routingPreference:"TRAFFIC_AWARE",departureTime:request.departureTime} :
          request.mode === "TRANSIT" ? {departureTime:request.departureTime} : {}), computeAlternativeRoutes:false }),
    });
    if (!response.ok) throw new Error("Restiden kunde inte beräknas. Den räknas inte som noll minuter.");
    const result = z.object({ routes:z.array(z.object({duration:z.string().regex(/^\d+(\.\d+)?s$/),distanceMeters:z.number().nonnegative()})).min(1) }).parse(await response.json());
    const route = result.routes[0];
    return { ...request,status:"ESTIMATED",minutes:Math.ceil(parseFloat(route.duration)/60),distanceMeters:route.distanceMeters,checkedAt:new Date().toISOString() };
  }
}

/** Both legs must fit. Missing evidence or stale/wrong-route evidence never becomes zero. */
export function travelFeasibility(input: {
  start: string; end: string; availableFrom: string; availableUntil: string;
  preparationMinutes: number; recoveryMinutes: number; now: string;
  inbound?: RouteEstimate; outbound?: RouteEstimate;
}) {
  const { inbound, outbound } = input;
  const now = Date.parse(input.now), start = Date.parse(input.start), end = Date.parse(input.end);
  const availableFrom = Date.parse(input.availableFrom), availableUntil = Date.parse(input.availableUntil);
  if (![now,start,end,availableFrom,availableUntil].every(Number.isFinite) || end <= start
    || availableUntil < end || availableFrom > start || !Number.isInteger(input.preparationMinutes)
    || !Number.isInteger(input.recoveryMinutes) || input.preparationMinutes < 0 || input.recoveryMinutes < 0) throw new Error("Ogiltigt resefönster.");
  const valid = (r?:RouteEstimate) => r && Number.isFinite(r.minutes) && r.minutes >= 0
    && Date.parse(r.checkedAt) <= now && now-Date.parse(r.checkedAt) <= 300000;
  if (!valid(inbound) || !valid(outbound) || inbound!.destinationPlaceId !== outbound!.originPlaceId)
    return {status:"TRAVEL_TIME_UNKNOWN" as const,bookable:false};
  const arrival = Date.parse(inbound!.departureTime)+inbound!.minutes*60000;
  const departure = Date.parse(outbound!.departureTime);
  const fits = Date.parse(inbound!.departureTime) >= availableFrom && arrival+input.preparationMinutes*60000 <= start
    && departure >= end+input.recoveryMinutes*60000 && departure+outbound!.minutes*60000 <= availableUntil;
  return {status:fits?"FEASIBLE" as const:"NOT_FEASIBLE" as const,bookable:fits,
    inboundMinutes:inbound!.minutes,outboundMinutes:outbound!.minutes};
}
