export type TravelSearchCapability = {
  provider: "skyscanner";
  configured: boolean;
  flights: boolean;
  hotels: boolean;
  transactionalBooking: boolean;
  note: string;
};

export interface TravelSearchProvider {
  readonly id: "skyscanner";
  capability(): TravelSearchCapability;
}

export type FlightSearchIntent = {
  origin: string;
  destination: string;
  outboundDate: string;
  inboundDate?: string;
  adults: number;
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
  currency: string;
  market: string;
  locale: string;
};

export type HotelSearchIntent = {
  entityId: string;
  checkinDate: string;
  checkoutDate: string;
  adults: number;
  rooms: number;
  currency: string;
  market: string;
  locale: string;
};
