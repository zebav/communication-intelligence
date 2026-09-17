# Molnwebbläsare — förberedelse, inte aktiverad drift

Vald leverantör: Browserbase. Godkänd abonnemangsbudget: 20 USD/månad, separat från skatt. Användaren har godkänt ytterligare högst 10 USD/månad för AI som styr webbuppgifter. Detta är separerat från befintlig meddelandeanalys och Maps. Ingen tjänst har köpts eller aktiverats av detta lokala arbete. Budgetbeslutet är dokumenterat men ännu inte en verkställd kostnadsspärr.

Kontostatus 2026-09-17: Developer är köpt av användaren. BROWSERBASE_API_KEY är sparad som Secret endast för Production i Vercel. Ingen ny deployment eller verklig session har startats. Ingen hård kostnadsspärr hittades i kontots usage/billing-vyer; överdebitering är möjlig.

Första lokala policy: en session åt gången, fem minuter per session, högst 90 reserverade timmar per faktureringsperiod (marginal under 100 inkluderade timmar), ingen proxy, inspelning, sessionsloggning, CAPTCHA-lösning eller keep-alive. Avstängning av Browserbase-loggning är inte ett löfte om noll leverantörsloggar.

Lokalt tillagt: budgetberäkning med 10 USD AI-tak i heltals-mikrodollar, stopp vid okänd/utgången faktureringsperiod och sessioner över periodgräns. Provideradapter kräver reservation före anrop, gör aldrig automatiska retries, behåller reservation vid osäkra svar och stöder stopp även om nya körningar är avstängda. Adaptern används ännu inte av någon route. Ingen AI körs i läsläget; AI-prisberäkning och token/stegtak krävs innan AI kopplas in.

## Måste vara klart före aktivering

Nästa lokala steg tillagt: `20260917132616_browser_approval_claims.sql` och `browser-approval-store.ts`. Server-only tabell med RLS och återkallad klientåtkomst; RPC låser uppgift och godkännande, jämför hela payloaden, kontrollerar databasens klocka och flyttar uppgiften till executing atomärt med konsumtionen. `scripts/verify-browser-approval.mjs` testar detta med riktiga task-guard/audit-triggers i isolerad PGlite. Inte applicerat i Supabase; UI/API-koppling, återrapportering av uppgiftsresultat och produktionsgranskning återstår. Äldre uppgift nedan om saknad databasadapter är därmed ersatt, men ingen drift är aktiverad.

`browser-approval.ts` är en lokal, testad orkestreringsgräns för MFA, ägare, uppgift, version, giltighetstid och exakt sparad adress. Den kräver ett atomärt engångsanspråk före körning och återanvänder aldrig godkännande efter osäkert resultat. Dess 11 tester använder syntetiska adaptrar. Databasadapter för godkännanden och inkoppling till route/UI återstår; detta är INTE en aktiv produktionsspärr. Adapter måste kontrollera hela godkännandet, aktuell uppgiftsversion och giltighet atomärt vid anspråket.

Lokalt 2026-09-17: migration `20260917130128_browser_budget_ledger.sql` och `browser-reservations.ts` implementerar gemensam transaktionell reservation, unikt aktivt sessionslås och service-role-only åtkomst. Ingen period skapas automatiskt och enabled är false som standard. PGlite-testet `scripts/verify-browser-budget.mjs` verifierar budgettak, lås, rollback, periodgräns, nekad klientåtkomst, exakt sessionsmatchning vid stängning och bibehållen budget. Detta är inte applicerat på Supabase och ingen produktionsspärr är aktiverad. PGlite är inte ett separat flerprocess-test av produktions-Postgres.

- Browserbase-konto, projekt och servernyckel i hemlighetslagring; verifiera kostnadsspärrar och faktureringsperiod hos leverantören.
- Granska databehandling, lagring och om vald EU-region omfattar mer än webbläsarens körning.
- Atomär, beständig budgetreservation och sessionslås före skapande; full tidsreservation behålls vid osäkert resultat. Alla användare delar projektets kostnadsgräns.
- Stopp av sessioner vid fel och nödstopp. Ingen automatisk omskapning efter timeout.
- Domänpolicy för varje navigation, omdirigering och underresurs; DNS/private-IP-skydd. Den rena URL-kontrollen är INTE fullständigt SSRF-skydd.
- Separat godkännande för inlämning, mottagare och exakt data. Webbinnehåll kan inte utöka behörigheter.
- Ingen inloggningslagring innan isolerade kontosessioner och manuell MFA-överlämning verifierats.
- En verklig körmotor och lokal testwebbplats. Varken anslutningsnycklar, fjärrsessioner eller automatisk webbexekvering är inkopplade ännu.

Referens: https://docs.browserbase.com/reference/api/create-a-session

Sessionsavstämning: provider.inspect använder GET av exakt session, sanerar bort anslutningshemligheter och kräver terminal status samt giltig sluttid innan terminated=true. Reconcile-funktionen och databasadaptern kräver samma sessions-id och atomär closeVerified; osäkra starter utan sessions-id lämnas för manuell granskning.

## Samlad lokal körkedja

2026-09-17 lokal browser-prototyp: `tests/controlled-browser-driver.mjs` öppnar endast en egen fast loopback-fixture i separat Chrome-context med JavaScript/service workers/downloads avstängda. Prototypen är INTE inkopplad. Två startförsök avslutades med SIGABRT innan navigation; verklig läsning ej verifierad. Den fungerande labbsidan behåller syntetiskt underlag, dess felhantering visar nu misslyckad läsning tydligt. Produktionsdriver och remote egress-skydd är fortfarande olösta. Ingen ny extern tjänst eller deployment aktiverad.

Ordinarie arbetsyta får nu `browserReadiness` från assistant-API:t och visar konkreta blockerare i webbuppgiftens statuspanel. Avsaknad av status behandlas som ej verifierat, aldrig redo. Läget är hårdkodat preparation tills en verklig driver och verifierad installation levereras; en miljöflagga kan inte slå på denna UI-capability. Nio riktade tester passerade. Detta är statuskoppling, inte publik prepare/run-route.

Godkännandeskapande: `browserService.prepareRead` kräver aktiverad driver, serverautentiserad ägare/MFA och explicit bekräftelse, gör URL/DNS-preflight och anropar en service-role-only RPC. RPC låser aktuell uppgift, jämför exakt planadress och revision, ökar revisionen och sparar ett femminutersgodkännande i samma transaktion. Förnyelse ogiltigförklarar föregående version. Databastestet verifierar fel ägare/adress/revision, klientåtkomst, förnyelse och nekad förnyelse efter claim. Ändringen finns endast i den ännu ej applicerade lokala migrationen. Publik route och godkännandeknapp i ordinarie arbetsyta återstår; den separata labbsidan är fortsatt syntetisk.

Isolerat gränssnittstest: starta Vite med `assistant-preview.config.mjs --configLoader native` och öppna `http://127.0.0.1:4326/tests/browser-lab.html`. Testet anropar lokal POST-middleware och samma `executeApprovedBrowserRead`, med syntetisk aktör, in-memory godkännande/resultat och fast testtext. Det använder INTE Browserbase, verklig autentisering, databas eller en webbläsardriver. Origin/Host/metod kontrolleras och body begränsas. Verifierat i inbyggda webbläsaren: förbered → checkbox → kör → resultat → spärrad återkörningsknapp; skärmbild kontrollerad utan felöverlägg. Tre harness-tester passerade. Detta verifierar inte externa webbplatser eller skarp integration och ersätter inte separat databastest. Testservern lyssnar endast på loopback och inga hemligheter läses.

Serverkompositionen kräver nu autentiseringsadapter och sparat approval-id/uppgift/version, inte godtycklig adress. Efter läsning valideras resultatet och sparas med ägare, uppgifts-id, executing-status och exakt claim-revision som villkor. Lyckad läsning med verifierat avslut blir waiting (visas för granskning), aldrig done; fel/osäkert avslut blir uncertain. Sparfel lämnar uppgiften låst. Webbuppgifter kan inte användas för meddelandeuppföljning. Databastestet verifierar även engångssparning av resultat. Publikt API/UI för att skapa godkännanden är inte levererat och live-driver saknas fortfarande; äldre formuleringar nedan om saknad serverkomposition är ersatta av detta steg.

Gränssnitt: `assistant-browser-status.tsx` är inkopplat på webbuppgifter i handlingsinkorgen. Det visar avstängt läge, manuell länk utan statusändring, osäkert avslut och eventuellt läsunderlag som vanlig text (inte HTML). Ingen startknapp eller automatisk aktivering finns. Åtta komponenttester, typkontroll och ESLint passerade. Visuell webbläsarverifiering återstår. Panelen kan visa framtida lagrade resultat; serverkedjan som sparar körresultat och skapar godkännanden från UI är ännu inte inkopplad.

Supportärende skickat till Browserbase 2026-09-17 om provider-verkställt skydd mot privata nät, DNS-rebinding och otillåtna underresurser på Developer. Formuläret bekräftade mottagandet. Inga nycklar eller konversationsdata delades. Svar inväntas; körning är fortsatt avstängd. Sista regressionstestet av fördröjd auktorisering passerade också (12 körkedjetester).

Browserbase har därefter bekräftat att `allowedDomains` finns på Developer och kan sättas separat per session. Kontrollen gäller top-frame-navigation och en tillåten domän omfattar automatiskt dess subdomäner. Den blockerar däremot inte iframe/subframe eller sidans egna image/script/XHR-anrop. Därför är vår egen exact-URL/exact-host-policy fortsatt auktoritativ och Browserbase-listan bara ett andra skyddslager. Redirects, nya tabs/popups, blockeringshändelser, nätverksinterception, säker credential-injektion samt upload/download-kontroller väntar fortfarande på skriftligt svar. Ingen skarp session får aktiveras på basis av `allowedDomains` ensam.

Ett separat utkast i PR #54 provade en enklare sessionsendpoint. Den tas inte in i denna leverans eftersom den lät ett klientfält representera godkännande och skapade session före vår gemensamma budgetreservation och atomiska databas-claim. De användbara delarna är i stället införda här: dynamisk `allowedDomains`, exakt host i vår egen policy samt obligatoriska serverhemligheter `BROWSERBASE_API_KEY` och `BROWSERBASE_PROJECT_ID`.

Körningen tar nu en oföränderlig kopia av uppgifts-id, måladress och godkända adresser före asynkrona kontroller. Efter avslut/timeout nekas nya och ännu pågående auktoriseringskontroller. Detta ersätter inte nätverksskydd hos leverantören. Hela lokala testsviten passerade med 445 tester efter dessa ändringar, före ett ytterligare regressionstest av en fördröjd auktorisering. Typkontroll passerade.

`browser-service.ts` kopplar reservation, provider, körning och avstämning. `browser-run.ts` kör kontroll → reservation → start → läsning → stopp → avstämning, med fyra minuters lokal tidsgräns och resultatgräns 100 000 tecken. Inga formulär eller AI-anrop ingår. Körkedjetester verifierar också omdirigeringsblockering, nekade POST-anrop, dubbelkörning, tappat stopp och en hängande driver.

`browser-network.ts` kräver exakt godkänd HTTPS-adress, GET/HEAD och enbart offentliga DNS-svar. IP-litteraler och lokala/särskilda nät blockeras. Detta är en preflight/policy, INTE ett färdigt nätverksskydd i fjärrwebbläsaren. Driver måste verkställa reglerna för navigation, redirects, popups och underresurser samt blockera service workers, downloads och WebSockets. DNS måste säkras vid faktisk egress; lokal lookup kan inte förhindra remote DNS-rebinding. Ingen live-driver levereras ännu och tjänsten nekar körning utan driver.

Hela sviten passerade med 442 tester före sista timeout-testet; detta test passerade därefter i körkedjans 9 tester. Typkontroll, ESLint och Next-produktionsbygge passerade. Inga skarpa Browserbase-anrop eller externa inlämningar gjordes. Före publik inkoppling krävs dessutom ägare/MFA och lagrat uppgiftsgodkännande. Även GET kan ha sidoeffekter: första skarpa testet måste använda granskad ofarlig testsida. Budgeten täcker bara körningar via denna kedja, inte andra appar/manuell användning av samma konto.
