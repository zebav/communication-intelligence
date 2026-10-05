"use client";

import { useState, useTransition } from "react";
import { saveRelationshipFeedback } from "@/app/relationships/actions";
import { type RelationshipCategory } from "@/lib/relationship-intelligence";

const labels: Record<RelationshipCategory, string> = { romantic: "Romantic", friends: "Friends", family: "Family", colleagues: "Colleagues", customers: "Customers", suppliers: "Suppliers", business_partners: "Business partners", professional_network: "Professional network", advisors_professional_services: "Advisors", other: "Other" };

export function RelationshipFeedback({ personId, category }: { personId: string; category: RelationshipCategory }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const send = (decision: "confirm" | "reject" | "more_important" | "less_important") => startTransition(async () => {
    const result = await saveRelationshipFeedback({ personId, category, decision });
    setMessage(result.error ?? (decision === "confirm" ? `${labels[category]} bekräftad.` : "Din korrigering är sparad."));
  });
  return <div className="relationship-feedback"><span>Stämmer detta?</span><div><button className="btn" disabled={pending} onClick={() => send("confirm")}>Ja</button><button className="btn" disabled={pending} onClick={() => send("reject")}>Fel kategori</button><button className="btn" disabled={pending} onClick={() => send("more_important")}>Viktigare</button><button className="btn" disabled={pending} onClick={() => send("less_important")}>Mindre viktigt</button></div>{message && <small>{message}</small>}</div>;
}
