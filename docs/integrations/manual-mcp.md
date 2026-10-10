# Solvani MCP — personlig bearer-nyckel

Solvani kan anslutas till ChatGPT med en personlig, långlivad bearer-nyckel.
Detta är avsett för ägaren av den privata Solvani-workspacen, inte för delade
eller publika integrationer.

## Skapa och använd

1. Logga in i Solvani och slutför MFA.
2. Öppna **Inställningar → Säkerhet och integritet → Solvani MCP**.
3. Skapa en ny MCP-nyckel och kopiera den innan rutan stängs.
4. I ChatGPT: välj **Custom MCP**, typen **Streamable HTTP** och URL
   `https://www.solvani.app/api/mcp`.
5. Lägg till en enda header: `Authorization: Bearer <din nyckel>`.

Lämna miljövariabeln `MCP_BEARER_TOKEN` tom. Nyckeln visas bara vid skapandet;
Solvani lagrar endast en SHA-256-hash och ett kort fingeravtryck. Testa gärna
anslutningen i samma Solvani-vy innan du lämnar den.

## Säkerhet

- Endast det konfigurerade privata ägarkontot med AAL2/MFA får skapa, se status
  för och återkalla nycklar.
- Högst tre aktiva nycklar tillåts, och en ny kan skapas högst en gång per minut.
- Varje nyckel gäller i ett år eller tills den återkallas.
- MCP accepterar både befintliga OAuth-tokens och manuella bearer-nycklar.
- Nyckeln finns aldrig i URL:er, audit-loggar, analys eller databasen i klartext.
- Skapande och återkallande loggas utan hemligheten.

Om en nyckel misstänks ha delats fel ska den återkallas i Solvani direkt.
