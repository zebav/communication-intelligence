# Personal Context och Contacts

Den här fasen samlar tre befintliga delar utan att duplicera eller ersätta data.

- **Contacts** är fortsatt Person Graph. Google- och Microsoft-kontakter synkas direkt hit, med exakt e-postadress eller telefonnummer som enda automatiska koppling. Namn ensamt räcker aldrig för en sammanslagning.
- **Personal Context** ligger i Settings. Den befintliga Universal Communication Profile behålls som samma källa för kommunikationsstil och regler. Verifierade personliga fakta lagras krypterat separat och visas i samma Settings-flik.
- **Intelligence** och **Connections** ligger under Settings, så att huvudmenyn fokuserar på arbete: Overview, Inbox, Kalender, Handlingsinkorg, Contacts och övriga arbetsvyer.

## Databevarande

Migrationen skapar bara nya tabeller för krypterad personlig kontext, externa kontaktposter och kontaktpunkter. Den ändrar inte `profiles.preferences.universal_communication_profile`, vilket betyder att befintlig Universal Communication Profile behålls oförändrad.

## Säkerhet

- Personlig kontext krypteras server-side med `CREDENTIAL_ENCRYPTION_KEY`.
- Endast MFA AAL2-sessioner kan läsa eller ändra den genom server-API:t.
- Google Contacts och Microsoft Contacts använder enbart läsbehörighet.
- Direkta klienträttigheter till krypterade värden saknas.
- Synkning ändrar aldrig kontakter hos Google eller Microsoft.

## Releaseförutsättningar

1. Applicera `20260918004500_personal_context_contacts_v1.sql` i Supabase.
2. Aktivera Google People API.
3. Återanslut Google- och Microsoft-konton en gång för de nya läsbehörigheterna.
4. Kontrollera en kontaktsynkning per leverantör innan större synkning.
