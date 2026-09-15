export type PriorityEvidence = {
  basePriority: number; classification?: string; text?: string; relationshipType?: string | null;
  unread?: boolean; historicalConversationCount?: number; hasOwnerReplies?: boolean;
  manualPriority?: number | null; handlingRule?: string | null;
  requiresReply?: boolean; dueAt?: string | null; promise?: boolean;
  now?: number;
};

export function priorityV3(input: PriorityEvidence) {
  const text = input.text ?? "";
  const campaign = ["Newsletter", "Marketing", "Spam"].includes(input.classification ?? "");
  const automated = ["Notification", "Receipt / Invoice", "Information Only"].includes(input.classification ?? "");
  const question = /\?|\b(can you|could you|please review|kan du|kan ni|återkom|svara senast)\b/i.test(text);
  const task = !campaign && (input.requiresReply ?? question);
  const promise = !campaign && Boolean(input.promise);
  let score = campaign ? 2 : automated && !task && !promise ? 3 : input.basePriority;
  const reasons = [campaign ? "Reklam eller massutskick: ingen personlig uppgift identifierad." : automated && !task ? "Informationsmeddelande utan identifierat svarskrav." : "Innehållet bedöms som ett personligt ärende."];
  if (task) { score += 0.8; reasons.push("Fråga eller konkret uppgift att ta ställning till."); }
  if (promise) { score += 0.8; reasons.push("Ett löfte eller åtagande behöver följas upp."); }
  const deadline = input.dueAt ? Date.parse(input.dueAt) : NaN;
  const hours = (deadline - (input.now ?? Date.now())) / 3_600_000;
  if (!campaign && Number.isFinite(hours)) {
    if (hours <= 24) score += 1.5;
    else if (hours <= 168) score += 0.5;
    reasons.push(hours < 0 ? "Angiven tidsfrist har passerat; kontrollera om ärendet redan är klart." : "En uttrycklig tidsfrist finns.");
  }
  if (!campaign && (task || promise)) {
    if (["family", "partner", "close_friend", "colleague", "lawyer", "customer", "accounting_responsible"].includes(input.relationshipType ?? "")) { score += 0.5; reasons.push("Relationen till avsändaren ökar relevansen."); }
    if (input.hasOwnerReplies && (input.historicalConversationCount ?? 0) >= 5) { score += 0.5; reasons.push("Tidigare ömsesidig kontakt stärker relevansen."); }
    if (["Legal", "Financial"].includes(input.classification ?? "")) { score += 0.5; reasons.push("Ärendet rör ekonomi eller juridik och behöver bedömas."); }
    if (input.unread) { score += 0.5; reasons.push("Oläst: behöver granskas. Läst betyder inte automatiskt hanterat."); }
  }
  if (!campaign && input.manualPriority != null) { score = score * 0.6 + input.manualPriority * 0.4; reasons.push("Din korrigerade avsändarprioritet vägs in."); }
  if (input.handlingRule === "always_priority") { score = Math.max(score, 8.5); reasons.push("Din uttryckliga regel: prioritera avsändaren."); }
  if (input.handlingRule === "low_priority") { score = Math.min(score, 3); reasons.push("Din uttryckliga regel: låg prioritet."); }
  return { score: Math.round(Math.min(10, Math.max(1, score)) * 10) / 10, reasons };
}
