import "server-only";
import type { TravelSearchCapability, TravelSearchProvider } from "./types";

export class SkyscannerTravelProvider implements TravelSearchProvider {
  readonly id = "skyscanner" as const;
  constructor(private readonly apiKey = process.env.SKYSCANNER_API_KEY?.trim() ?? "") {}

  capability(): TravelSearchCapability {
    const configured = Boolean(this.apiKey);
    return {
      provider: "skyscanner",
      configured,
      flights: configured,
      hotels: configured,
      transactionalBooking: false,
      note: configured
        ? "Skyscanner Travel APIs kan användas för live flights/hotels search. Slutlig bokning sker hos supply partner."
        : "Skyscanner kräver godkänd partneransökan och SKYSCANNER_API_KEY innan live search kan aktiveras.",
    };
  }

  /**
   * Shared authenticated request helper for the provider-neutral travel layer.
   * Search endpoints are intentionally wired only after partner credentials are
   * available and acceptance-tested against the approved Skyscanner account.
   */
  async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.apiKey) throw new Error("Skyscanner är inte konfigurerat. Partner-API-nyckel krävs.");
    const response = await fetch(`https://partners.api.skyscanner.net${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(`Skyscanner-sökningen misslyckades (${response.status}).`);
    return await response.json() as T;
  }
}

export function travelSearchCapability() {
  return new SkyscannerTravelProvider().capability();
}
