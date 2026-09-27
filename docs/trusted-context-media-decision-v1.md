# Trusted Context, Media & Decision Engine V1

## Mål

Ett inkommande meddelande ska bara kunna skapa ett svarsförslag eller en extern
åtgärd när systemet har ett tillräckligt och granskbart underlag: rätt kontakt,
relevant konversationshistorik, bekräftad personlig kontext och analyserad
media.

## Beslutsgrind för media

Meddelanden med bilagor använder `media_analysis_status`:

- `pending`, `processing`, `failed` och `blocked` blockerar förslag och externa
  svar. Ett misslyckande öppnar alltså aldrig för ett gissat svar.
- `ready` tillåter ett beslut när den strukturerade analysen finns sparad.
- `failed` och `blocked` får aldrig beskrivas som analyserade; de kräver
  manuell granskning eller nytt försök.

Instagram- och WhatsApp-webhooks skapar en idempotent post i
`vault_ingestion_jobs` utan att spara en temporär media-URL eller ett
providerlösenord. Kön innehåller endast den kontext som en serverstyrd,
provider-specifik arbetare behöver för att hämta media på ett senare steg.

## Mediaarbetare

Varje provider implementerar samma säkra kontrakt:

1. Kontrollera att jobbet fortfarande är `pending` och tillhör rätt anslutning.
2. Hämta binär media med den krypterade providerbehörigheten, aldrig från en
   URL som AI:n har föreslagit.
3. Begränsa MIME-typ, storlek och antal filer innan lagring.
4. Spara binären privat i `secure-vault`, med SHA-256 för deduplicering.
5. Skapa `vault_assets`, `attachments` och relevanta mediareferenser.
6. Kör OCR, transkribering eller dokumentextraktion och spara en strukturerad,
   källkopplad sammanfattning.
7. Markera meddelandet `ready` först när analysen är genomförd. Därefter kan
   den vanliga intelligensmotorn skapa ett svarsförslag.

V1 har nu en serverstyrd arbetare för e-postbilagor från Google och Microsoft:

- text, CSV och JSON får ett begränsat textutdrag;
- JPEG, PNG och WebP analyseras med bildanalys;
- vanliga ljudformat transkriberas;
- PDF och Office-filer sparas privat men förblir spärrade tills deras dedikerade
  dokumentextraktion finns på plats;
- Instagram- och WhatsApp-media ligger kvar i samma säkra kö, men deras
  providerhämtare är nästa steg och får inte markeras som analyserade före dess.

Arbetaren är medvetet inte schemalagd med ett tredje Vercel-jobb ännu. Projektet
har redan två schemalagda jobb och Vercel-planens gräns måste bekräftas innan vi
lägger till fler. Routen `/api/cron/media-analysis` är därför endast skyddad för
serveranrop tills vi väljer ett samlat schema.

Råmedia, passuppgifter, signaturer och andra känsliga värden får inte läggas i
AI-promptar som standard. Endast minsta relevanta, strukturerade utdrag ska
användas för den aktuella uppgiften.

## Databasgrund och releasekrav

Produktionsdatabasen innehåller redan media-vault-migreringar som saknas i den
här Git-grenen. Innan nästa produktionsrelease måste deras exakta SQL och
migrationshistorik återföras till källkoden. Skapa inte en ny konkurrerande
tabellstruktur.

Kontrollera även RLS och Data API-grants för vault-tabellerna: de ska vara
service-/serverstyrda och inte åtkomliga direkt från webbläsaren.

## Beslutsunderlag

När media är klar bygger systemet ett beslutsunderlag av:

- originalmeddelande och analyserad media,
- rätt person, relation och tidigare dialog,
- godkända minnen och kommunikationsregler,
- öppna åtaganden,
- masterkalender, plats och restid när relevant.

Det kan resultera i ett svar, en vidarebefordran, en mötesplan, en
webbuppgift eller ett förslag att avstå. Inget externt skickas eller bokas utan
den godkännandenivå som uppgiften kräver.
