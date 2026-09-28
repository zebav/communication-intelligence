# Service Intelligence Audit V1

Datum: 28 september 2026  
Syfte: välja externa tjänster utifrån den arbetsmängd Solvani faktiskt ska ta bort — inte utifrån hur många API:er som går att ansluta.

## Beslut

Solvani ska byggas kring ett litet antal tydliga tjänstekategorier. Varje tjänst får en uttalad roll, minsta möjliga behörighet, kostnadsgräns och ett tydligt steg där ägaren måste godkänna en extern konsekvens.

Vi lägger **inte** till fler livemiljö-anslutningar innan dokument- och mediainhämtning återhämtar sig automatiskt. Utan text från bilagor, bilder, ljud och dokument kommer fler agenter att fatta sämre beslut, inte bättre.

## Befintliga tillgångar — verklig status

| Område | Status i kod | Praktisk roll | Nästa kontroll |
| --- | --- | --- | --- |
| Gmail och Microsoft 365 | Anslutning, import, inkrementell synk och godkända svar finns | Bas för e-postbeslut, relationer och svar | Synkhälsa och relevans ur 90-dagarsfönstret |
| Instagram Professional | OAuth/webhook- och svarsstöd finns, beroende av Meta-behörigheter | Direktmeddelanden och publikdialog | Säkerställ färska webhooks och historikimport |
| WhatsApp Business | Webhook, kontaktupplösning, analys, media och godkänt svar finns | Snabba meddelanden, svar och leveransstatus | Återställ köade mediejobb och verifiera ny livehändelse |
| Dokument- och mediavalv | Privat Storage, proveniens, analys och koppling till meddelande/person finns | Underlag för att förstå PDF, bilder, ljud och bilagor innan svar | Processa köade/felade jobb och visa sparade tillgångar |
| Google- och Microsoft-kalendrar | Masterkalender, läsning, förslag och säker skrivning av Solvani-ägda poster finns | Tillgänglighet och mötesförslag | Fortsatt synk och tydligare urval av synliga källkalendrar |
| Google Maps: Places, Routes, Weather, karta | Serveradapter, budgetreservation och säkra felvägar finns | Plats, restid, väder och genomförbara mötesförslag | Kontrollera att nyckel, API:er och budgetkvot är aktiva |
| Browserbase | Godkänd webbkörning, per-host contexts och privata inmatningsvärden finns | Genomföra låg- till medelrisk-webbuppgifter efter beslut | URL-extraktion och verkligt godkänd standarduppgift |
| Skyscanner | Provider-neutral adapter finns; sökning är spärrad utan partnernyckel | Flyg- och hotellalternativ | Vänta på partnergodkännande och liveacceptanstest |

## Prioriterad integrationsordning

### 1. Gör befintliga beslutsunderlag tillförlitliga

Detta är den viktigaste fasen och kräver inga nya partnerkonton.

- Återställ och övervaka mediejobben så att bilagor blir sparade, analyserade och synliga i beslutskort.
- Säkerställ att Notiscenter tar med relevanta äldre obesvarade meddelanden men avvisar marknadsföring.
- Gör lärande av `inte relevant`, avsändarprioritet, godkända svar och utfall synligt i Settings → Learning & Memory.
- Visa anslutningshälsa, senaste lyckade inhämtning och nästa automatiska kontroll utan att låtsas att en källa är aktuell när den inte är det.

**Varför först:** detta förbättrar varje svar, vidarebefordran och bokning direkt.

### 2. Dokument från Google Drive och OneDrive

Koppla in som **owner-selected read-only import**, inte som full diskåtkomst.

- Steg 1 är klart: dokumentvalvet kan importera en fil som ägaren väljer från Drive, OneDrive eller sin enhet och bevarar dess angivna ursprung utan att ändra originalet.
- Nästa steg är dokument som användaren väljer med Google Picker eller OneDrive/SharePoint file picker.
- Spara en privat kopia eller begränsad metadata i valvet, med ursprungslänk och åtkomsttid.
- Analysera dokument i samma pipeline som e-postbilagor.
- Skriv aldrig tillbaka till Drive/OneDrive i V1.

**Behörighetsprincip:** Google rekommenderar smala per-fil-scope när möjligt; Microsoft ska använda delegerade, minst privilegierade behörigheter snarare än app-only bred åtkomst. [Google Drive OAuth scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview)

**Agentnytta:** avtal, offerter, presentationsunderlag och svar med faktakontroll.

### 3. Färdigställ kalender, Maps och väder som en planeringstjänst

Den här kapaciteten finns i stor utsträckning men ska integreras i beslutskort, inte presenteras som en separat teknikfunktion.

- När ett meddelande gäller möte: föreslå deltagare från Contacts, platsalternativ, realistisk restid, kalenderlucka och väderbedömning.
- Visa högst tre genomförbara alternativ och förklara konflikt eller restidsrisk kort.
- Skapa eller ändra bara Solvani-ägda möten efter uttryckligt godkännande; externa Outlook/Google-original är fortsatt läsbara och tydligt märkta.

**Kostnadsskydd:** Places/Routes/Weather ska alltid passera den befintliga serverstyrda budgetreservationen, cacheas per planeringsärende och sakna automatiska bakgrundsanrop. Google Routes är betald per fråga/element och har egna kvotgränser. [Google Routes usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing)

### 4. Browserbase för godkända standarduppgifter

Browserbase är rätt utförare, men inte beslutsfattare.

- Använd bara verifierad HTTPS-adress, exakt godkänd host och sparad uppgiftsplan.
- Återvalidera aktiv URL och öppna flikar före slutsteget.
- Tillåt inloggning per ägare + webbplats, men injicera privata värden per körning.
- Håll betalning, juridisk signering, ändrade säkerhetsinställningar och irreversibla handlingar utanför automatisk körning.

**Agentnytta:** ifyllnad, kontoportaler, bokningsförberedelser och informationsinhämtning efter godkännande.

### 5. Spotify för musik- och publikdialog

Bygg när vi kan bekräfta att frågor om låtar, länkar och artistinformation är återkommande i Notiscenter.

- V1 läser artist-/release-/spårmetadata och producerar kontrollerade länkar i föreslagna svar.
- Ingen ändring av spellistor, bibliotek eller publicering i V1.
- För personlig data används OAuth Authorization Code Flow med serverlagrad klienthemlighet; minsta scope per funktion. [Spotify authorization](https://developer.spotify.com/documentation/web-api/concepts/authorization)

**Agentnytta:** snabbare fansvar, korrekta releaselänkar och konsekvent artistprofil.

### 6. Resor via Skyscanner när partneråtkomst finns

Det finns redan ett neutralt providerlager; aktivera inte sökning förrän den godkända partnernyckeln finns.

- Sök flyg/hotell först efter konkret reseintention.
- Presentera alternativ mot masterkalender, plats och budget.
- Slutbokning flyttas till ett känt reseföretags webbplats via Browserbase och kräver separat godkännande.

**Agentnytta:** resplaner som passar kalendern utan att göra köp automatiskt.

### 7. Signering som separat högriskfunktion

Välj en leverantör (DocuSign eller Scrive) först när avtalsflöden faktiskt återkommer.

- V1 läser signeringsstatus och skapar ett granskningskort med dokumentets parter, syfte och deadline.
- Att skicka ett signeringskuvert och att signera är två separata godkännanden.
- Assistenten får aldrig “godkänna” eller utföra en signatur på ägarens vägnar.

DocuSign använder OAuth och eSignature REST API; integrationen ska isoleras som egen högrisk-connector. [DocuSign developer tools](https://developers.docusign.com/tools/postman/)

## Tjänster som inte ska läggas till ännu

| Tjänst | Skäl att vänta |
| --- | --- |
| Allmän ekonomi/bank | Hög risk och ännu inget avgränsat beslutscase |
| CRM | Contacts/Person Graph ska först vara den enda kontaktkällan |
| Full Drive/SharePoint-indexering | Onödigt bred dataåtkomst och sämre integritetsprofil än valda dokument |
| Restaurang-/hotellbokningsrobot | Kräver först bekräftade, återkommande ärenden och väl definierade användarpreferenser |
| Sociala plattformar utan officiellt API | Får inte automatiseras via skrapning eller inloggningscookies |

## Gemensam servicepolicy

Alla nuvarande och framtida connectors måste uppfylla följande innan de används av en agent:

1. **Avgränsad uppgift:** agenten får endast verktyg som matchar en konkret uppgift.
2. **Minsta behörighet:** read-only före write, delegerad åtkomst före app-only, per-fil före full disk.
3. **Kostnadsgräns:** serverstyrd daglig/månatlig reservation före betalt anrop; inga klientnycklar.
4. **Beslut före konsekvens:** analys och förslag kan automatiseras; svar, bokning, delning, skickande och betalning har godkännandegrindar.
5. **Spårbarhet:** källa, vilka data som användes, åtgärd, leverantör och utfall sparas i audit trail.
6. **Fail closed:** osäker URL, okänd kostnad, ej färsk kalender eller saknad behörighet stoppar åtgärden med ett begripligt nästa steg.

## Mätetal som avgör nästa investering

Under de kommande 30 dagarna ska Systemkontroll följa:

- andel relevanta beslutskort som faktiskt godkänns eller avvisas,
- antal mediabilagor som når valvet utan fel,
- hur ofta mötes-/rese-/dokumentuppgifter förekommer,
- hur ofta ett godkänt förslag behöver ändras före genomförande,
- kostnad per genomförd nytta (Maps, webbkörning och AI separat).

Den första nya externa integrationen väljs först när dessa signaler visar ett verkligt återkommande behov. I normalfallet blir ordningen: **valda Drive/OneDrive-dokument → färdig planering → Spotify → Skyscanner → signering**.
