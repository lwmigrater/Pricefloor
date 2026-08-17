/**
 * Human-readable labels for engine outputs.
 *
 * The engine emits stable machine codes (`no_cost_data`, `below_floor`, …)
 * so downstream code can switch on them. UI surfaces should render the
 * merchant-facing string from this module — never the raw code.
 */

import type { Decision, DecisionReason } from "@/feature/pricefloor/engine";

export const DECISION_LABELS: Record<Decision, string> = {
  auto_approve: "Approved",
  counter_offer: "Counter offer",
  escalate: "Escalated",
};

export const DECISION_REASON_LABELS: Record<DecisionReason, string> = {
  requested_matches_best: "Requested price matched the best offer",
  requested_between_floor_and_best: "Requested price sits above the floor",
  no_request_best_offered: "Offered the deepest allowed discount",
  below_floor: "Requested price below the margin floor",
  discount_cap_exceeded: "Discount above tier cap",
  no_cost_data: "Missing cost data",
  product_excluded: "Product excluded from auto-pricing",
  rules_inconsistent: "Rules produced conflicting results",
  line_escalated: "One or more lines need review",
  manual_review_required: "Manual review requested",
};

export function labelForDecision(d: Decision | string): string {
  return DECISION_LABELS[d as Decision] ?? d;
}

export function labelForReason(r: DecisionReason | string | null | undefined): string {
  if (!r) return "—";
  return DECISION_REASON_LABELS[r as DecisionReason] ?? r;
}

export const ESCALATION_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_review: "In review",
  resolved: "Resolved",
};

export function labelForEscalationStatus(s: string): string {
  return ESCALATION_STATUS_LABELS[s] ?? s;
}
