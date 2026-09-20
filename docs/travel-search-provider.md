# Travel search provider layer

Skyscanner is the first provider-neutral travel-search integration target.

Current state:
- Flights and Hotels capability is represented behind `TravelSearchProvider`.
- Live use is disabled unless `SKYSCANNER_API_KEY` exists server-side.
- The key must come from an approved Skyscanner Partnerships application.
- Search is server-side only; the API key is never sent to the client.
- Skyscanner Hotels is meta-search, not a transactional booking API. Booking is completed on the selected supply partner's platform.
- When live access is approved, the next implementation step is to add the provider's create/poll flows for Flights Live Prices and Hotels Live Prices and feed the chosen supplier URL into Decision & Execution Center / Browserbase for the final approved booking flow.

This keeps travel planning independent of one provider:
`TravelSearchProvider -> SkyscannerTravelProvider -> future provider(s) / Browserbase fallback`.
