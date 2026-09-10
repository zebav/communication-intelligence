export const relationshipTypes = [
  "unknown", "family", "partner", "dating", "close_friend", "friend", "neighbor", "fan_follower",
  "customer", "prospect", "colleague", "manager", "employee", "business_partner", "investor", "supplier",
  "advisor", "lawyer", "accountant", "insurance_contact", "authority_contact", "other",
] as const;

export type RelationshipType = (typeof relationshipTypes)[number];

export const relationshipLabels: Record<RelationshipType, string> = {
  unknown: "Unknown", family: "Family", partner: "Partner", dating: "Dating", close_friend: "Close friend",
  friend: "Friend", neighbor: "Neighbor", fan_follower: "Fan / follower", customer: "Customer",
  prospect: "Potential customer", colleague: "Colleague", manager: "Manager", employee: "Employee",
  business_partner: "Business partner", investor: "Investor", supplier: "Supplier", advisor: "Advisor",
  lawyer: "Lawyer", accountant: "Accounting responsible", insurance_contact: "Insurance contact",
  authority_contact: "Authority contact", other: "Other",
};
