export type EmailClassification =
  | "Critical"
  | "Action Required"
  | "Business"
  | "Customer"
  | "Personal"
  | "Booking / Travel"
  | "Financial"
  | "Legal"
  | "Receipt / Invoice"
  | "Newsletter"
  | "Marketing"
  | "Notification"
  | "Spam"
  | "Information Only";

type ClassificationInput = {
  subject?: string | null;
  preview?: string | null;
  sender?: string | null;
  importance?: string | null;
  inferenceClassification?: string | null;
};

const contains = (value: string, words: readonly string[]) => words.some((word) => value.includes(word));

export function classifyEmail(input: ClassificationInput): EmailClassification {
  const text = `${input.subject ?? ""} ${input.preview ?? ""} ${input.sender ?? ""}`.toLowerCase();
  if (input.importance === "high" || contains(text, ["urgent", "security alert", "suspicious", "omedelbart", "brådskande"])) return "Critical";
  if (contains(text, ["invoice", "receipt", "kvitto", "faktura", "order confirmation"])) return "Receipt / Invoice";
  if (contains(text, ["payment", "bank", "konto", "betalning", "tax", "skatt"])) return "Financial";
  if (contains(text, ["flight", "hotel", "booking", "reservation", "travel", "flyg", "hotell", "bokning"])) return "Booking / Travel";
  if (contains(text, ["contract", "agreement", "legal", "avtal", "juridisk"])) return "Legal";
  if (contains(text, ["unsubscribe", "newsletter", "manage preferences", "nyhetsbrev"])) return "Newsletter";
  if (contains(text, ["sale", "offer", "discount", "campaign", "rabatt", "erbjudande"])) return "Marketing";
  if (contains(text, ["notification", "no-reply", "noreply", "automated message", "avisering"])) return "Notification";
  if (contains(text, ["please reply", "action required", "can you", "could you", "please review", "återkom", "kan du", "svara senast"])) return "Action Required";
  if (input.inferenceClassification === "other") return "Information Only";
  return "Business";
}

export function emailPriority(classification: EmailClassification, importance?: string | null) {
  if (importance === "high" || classification === "Critical") return 9;
  if (["Action Required", "Legal", "Financial"].includes(classification)) return 7.5;
  if (["Business", "Customer", "Booking / Travel", "Personal"].includes(classification)) return 6;
  if (["Receipt / Invoice", "Information Only"].includes(classification)) return 4;
  return 2.5;
}

export function recommendedEmailAction(classification: EmailClassification) {
  if (classification === "Critical") return "RESPOND_NOW";
  if (classification === "Action Required") return "RESPOND_TODAY";
  if (["Newsletter", "Marketing", "Notification", "Information Only"].includes(classification)) return "ARCHIVE";
  if (classification === "Spam") return "SPAM";
  return "RESPOND_LATER";
}
