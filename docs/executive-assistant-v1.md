# Executive Assistant V1 — lokal leverans

## Omfattning

Handlingsinkorgen ligger efter Overview, Inbox och Kalender i befintlig arbetsyta. Den laddas först när den öppnas. Den ersätter inte inkorgen eller befintliga kontaktkort.

- Förslag från redan analyserade inkommande meddelanden, med källa, ursprungskonto, person och original. Vanliga massutskick, besvarade och ersatta meddelanden föreslås inte.
- Fyra arbetsvyer: behöver beslut, redo, väntar och hanterat. Förfallna uppföljningar och nya inkommande svar visas för granskning, inte som automatiskt lösta uppdrag.
- Sparade uppdrag med unik nyckel per ägare, originalmeddelande och uppdragstyp. En återkommande import eller ett dubbelklick skriver inte över ett granskat uppdrag.
- Redigerbara svar, profil- och historikgrundad generering, val av rådgivare, verifierad mottagare och separat slutgodkännande.
- Mötesförfrågan → befintlig AI-tolkning → granskat datum → synkroniserade tidsförslag med buffertar → personer, Maps-plats och resa → reservation → separat boknings-/inbjudningsgodkännande. Bekräftad reservation kopplas tillbaka till uppdraget via konversationen.
- Separat uppföljningsuppdrag efter ett utskick; aldrig återställning av det gamla utskicket till ”skicka igen”. Nytt inkommande svar blockerar uppföljning.
- Kvalitetsomdömen och befintlig prioritetskorrigering. Omdömen är inte automatiskt verifierade personafakta och är inte ett mått på precision utan ett granskat facit.
- Manuellt avslut med anteckning, avstående före exekvering och append-only händelsehistorik i databasen.

## Säkerhetsgräns och faktisk kanaltäckning

`ASSISTANT_EXECUTION_ENABLED` är avstängd om den inte uttryckligen är `true`. Lokal förhandsvisning blockerar dessutom alla verkliga API-anrop. Testsviter mockar utskick och AI; inga meddelanden, inbjudningar eller betalda Maps-anrop behövs.

Direktutskick i denna V1 återanvänder Outlook-svar/vidarebefordran och Instagram-svar. WhatsApp-svar väljer nu aktiv leverantör (YCloud eller Meta), kontrollerar konto och mottagare och kräver ett inkommande meddelande inom 24 timmar. YCloud använder servernyckeln `YCLOUD_API_KEY`; frånnumret tas från det ägda kontot, aldrig från klienten. Saknad nyckel stoppar utskicket utan byte till annan leverantör. Endast simulerade anrop har verifierats lokalt; riktig sändning och leverans behöver ett senare uttryckligen godkänt test.

Gmail-svar är implementerade i handlingsinkorgen efter dess atomära godkännande. Originalet hämtas på nytt, From/Reply-To jämförs mot godkänd mottagare och tråd-id samt brevhuvuden bevaras. Tokenförnyelse sparas före utskick. Gmail-vidarebefordran och fristående nya brev stöds inte. Den äldre inkorgens generella capability är fortsatt avstängd eftersom den inte använder denna godkännandekedja. Ingen riktig Gmail-sändning har testats.

Gmail-kontrakt: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send och https://developers.google.com/workspace/gmail/api/guides/threads.

YCloud-kontrakt: https://docs.ycloud.com/reference/whatsapp_message-send-directly. Ett accepterat API-anrop betyder inte bekräftad leverans. Timeout eller saknat kvitto leder inte till automatiskt återförsök.

Webbuppgifter kan granskas och länken öppnas. Ingen inloggning, formulärinlämning eller generell webbagent körs. HTTPS innebär inte att en webbplats är verifierat betrodd.

Vidarebefordrat original och bilagor granskas av användaren. Uppföljning till rådgivare kräver rådgivarens egen konversation; originalavsändaren används aldrig som ersättningsmottagare.

Outlook-uppföljning till en verifierad kontakt kan nu skickas även när tråden bara har ett utgående brev. Slutgranskningen anger att det blir ett nytt mejl med ämnet ”Uppföljning: …”, utan bilagor; Outlook kan visa en separat tråd. Kontakt, konto och adress kontrolleras före utskick. Andra e-postleverantörer kräver fortfarande ett inkommande original för uppföljning. Endast simulerade anrop är tillåtna i den lokala verifieringen.

Godkännandet binds till revision, text, ursprungskonto och mottagare. Ändrat underlag kräver ny granskning. Outlooks faktiska Reply-To kontrolleras mot den godkända adressen. Ett atomärt databasanspråk tas före utskicket. Osäkert leverantörsresultat stannar för manuell kontroll; automatiska återförsök görs inte. Ett avbrott efter anspråket förblir låst och kan avslutas med en dokumenterad manuell kontroll.

Kalenderns egna befintliga godkännanden gäller separat. Förhandsvisningen är syntetisk; en vanlig lokal app ansluten till en riktig databas är inte en sandbox för kalenderbokningar.

## Databas och drift

Ny, ännu inte fjärrapplicerad migration: `20260917011906_executive_assistant_v1.sql`.

Den skapar `assistant_tasks`, `assistant_task_events`, `assistant_task_feedback`, ägar-/MFA-policyer, index, tillståndskontroll och revisionshistorik. Ingen befintlig användardata raderas eller prioriteras om. De lokala databastesterna kör migrationen i isolerad PostgreSQL/PGlite.

Inga nya cron-jobb skapas. Förslag räknas fram när handlingsinkorgen hämtas, från 100 meddelanden per sida. Äldre underlag kan hämtas med nästa sida. Sparade uppdrag begränsas till de senaste 500 i vyn och omdömen till 1 000; begränsningen visas. Detta är inte en bakgrundsagent som obegränsat bearbetar hela brevlådan.

Innan en senare publicering: applicera migrationen på godkänd testmiljö, verifiera med verkliga konton och användarens uttryckliga testgodkännande, kontrollera kanalernas rättigheter och slå därefter vid behov på exekvering. **Inget av detta har gjorts i den lokala leveransen.**

## Reproducerbara kontroller

- `pnpm test` — befintlig svit inklusive upptäckt, klassificeringsspärrar, godkännande, mottagare, dubbelklick/race, felhantering och komponenttester.
- `pnpm typecheck` och `pnpm build`.
- `PGLITE_MODULE=<sökväg till PGlite> node scripts/verify-assistant-db.mjs` — RLS, ägargränser, MFA, dubbletter, atomiskt anspråk, låst godkännande, osäkert utskick och audit.
- Starta Vite med `assistant-preview.config.mjs`, öppna `/tests/assistant-preview.html`. `/tests/assistant-mobile.html` ger en isolerad 390 × 844-vy. Testad UI-data finns bara i minnet och återställs vid omladdning.

Behåll produktionsnycklar borta från fristående preview. Dess konfiguration använder en separat miljökatalog och testets transport accepterar endast uttryckligen stubbat innehåll.
