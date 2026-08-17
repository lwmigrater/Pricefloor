/**
 * pf_rule_sets + pf_rules repository.
 *
 * Fetches the active rule set for a company and maps DB rows into the
 * engine's {@link RuleSet} shape. The DB stores params as JSONB — we trust
 * the CHECK constraint on rule_type and lean on the engine's discriminated
 * union to reject malformed params at evaluate time.
 */

import supabase from "@/adapters/supabase/supabase.server";
import type { Rule, RuleParams, RuleSet } from "@/feature/pricefloor/engine";

interface RuleSetRow {
  id: string;
  version: number;
  name: string | null;
}

interface RuleRow {
  id: string;
  rule_type: string;
  priority: number;
  scope: Record<string, unknown> | null;
  params: Record<string, unknown> | null;
  enabled: boolean;
}

export interface ActiveRuleSetResult {
  /** Postgres UUID — pass to pf_quote_decisions.rule_set_id. */
  dbId: string;
  ruleSet: RuleSet;
}

export interface DraftRule {
  type: string; // one of RuleType strings
  priority: number;
  scope: Record<string, unknown>;
  enabled: boolean;
  params: Record<string, unknown>; // no `type` here — column carries it
}

/**
 * Deactivate the current active rule set (if any) and insert a new one
 * with the supplied rules. Version is trigger-assigned. Returns the new
 * rule set's DB id + version.
 *
 * NOT atomic across the two writes — a mid-flight failure could leave zero
 * active sets briefly. Acceptable for MVP; wrap in RPC/transaction later
 * if concurrent edits become a real risk.
 */
export async function replaceActiveRuleSet(
  companyId: string,
  shop: string,
  rules: DraftRule[],
  createdBy: string,
  name?: string,
): Promise<{ id: string; version: number }> {
  const { error: deactivateErr } = await supabase
    .from("pf_rule_sets")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (deactivateErr)
    throw new Error(`rule set deactivate failed: ${deactivateErr.message}`);

  const { data: newSet, error: insertErr } = await supabase
    .from("pf_rule_sets")
    .insert({
      company_id: companyId,
      shop,
      is_active: true,
      name: name ?? null,
      created_by: createdBy,
    })
    .select("id, version")
    .single();
  if (insertErr || !newSet)
    throw new Error(`rule set insert failed: ${insertErr?.message}`);

  if (rules.length > 0) {
    const payload = rules.map((r) => ({
      rule_set_id: newSet.id as string,
      rule_type: r.type,
      priority: r.priority,
      scope: r.scope,
      enabled: r.enabled,
      params: r.params,
    }));
    const { error: rulesErr } = await supabase.from("pf_rules").insert(payload);
    if (rulesErr) throw new Error(`rules insert failed: ${rulesErr.message}`);
  }

  return { id: newSet.id as string, version: newSet.version as number };
}

export async function getActiveRuleSet(
  companyId: string,
): Promise<ActiveRuleSetResult | null> {
  const { data: setRow, error: setErr } = await supabase
    .from("pf_rule_sets")
    .select("id, version, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle<RuleSetRow>();
  if (setErr) throw new Error(`pf_rule_sets read failed: ${setErr.message}`);
  if (!setRow) return null;

  const { data: ruleRows, error: rulesErr } = await supabase
    .from("pf_rules")
    .select("id, rule_type, priority, scope, params, enabled")
    .eq("rule_set_id", setRow.id)
    .order("priority", { ascending: true });
  if (rulesErr) throw new Error(`pf_rules read failed: ${rulesErr.message}`);

  const rules: Rule[] = (ruleRows as RuleRow[]).map((r) => ({
    id: r.id,
    type: r.rule_type as Rule["type"],
    priority: r.priority,
    scope: (r.scope ?? {}) as Rule["scope"],
    enabled: r.enabled,
    params: {
      type: r.rule_type,
      ...(r.params ?? {}),
    } as RuleParams,
  }));

  return {
    dbId: setRow.id,
    ruleSet: {
      id: setRow.id,
      version: setRow.version,
      rules,
    },
  };
}
