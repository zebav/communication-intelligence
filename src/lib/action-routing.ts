import type { EmailAnalysis } from "@/lib/ai/service";

const legalTerms = /\b(legal|lawyer|solicitor|attorney|advokat|juridisk|juridical|notary|notario|notarie|court|domstol|contract|avtal|deed|escritura|power of attorney|fullmakt|probate|inheritance|arv|property purchase|fastighet)\b/i;
const spanishTerms = /\b(spain|spanish|españa|spansk|madrid|barcelona|marbella|málaga|malaga|alicante|mallorca|ibiza|notario|escritura|registro de la propiedad)\b/i;
const accountingTerms = /\b(accounting|accountant|bookkeeping|bokföring|redovisning|årsredovisning|bokslut|invoice|faktura|vat|moms|tax return|deklaration)\b/i;
const insuranceTerms = /\b(insurance|försäkring|claim|skadeanmälan|policy number|försäkringsnummer)\b/i;

export function enforceProfessionalRouting(analysis: EmailAnalysis, text: string): EmailAnalysis {
  const content = `${analysis.category} ${analysis.summary} ${analysis.intent} ${text}`;
  if (analysis.forwardingSuggestion.recommended) return analysis;
  if (analysis.category === "Legal" || legalTerms.test(content)) {
    const spanish = spanishTerms.test(content);
    return { ...analysis, forwardingSuggestion: {
      recommended: true,
      recipientRole: "lawyer",
      reason: spanish ? "This appears to be a Spanish legal matter and should be reviewed by your Spanish lawyer." : "This appears to be a legal matter and should be reviewed by your lawyer.",
      introduction: spanish ? "Hi, I am forwarding this because it appears to concern a matter in Spain. Could you please review it and let me know what action you recommend?" : "Hi, I am forwarding this for your legal review. Could you please let me know what action you recommend?",
    } };
  }
  if (analysis.category === "Financial" || accountingTerms.test(content)) return { ...analysis, forwardingSuggestion: { recommended: true, recipientRole: "accountant", reason: "This appears to require accounting or tax review.", introduction: "Hi, I am forwarding this for your review. Could you please check it and let me know whether I need to take any action?" } };
  if (insuranceTerms.test(content)) return { ...analysis, forwardingSuggestion: { recommended: true, recipientRole: "insurance_contact", reason: "This appears to concern an insurance matter.", introduction: "Hi, I am forwarding this insurance-related message for your review. Could you please advise me on the next step?" } };
  return analysis;
}
