import { companyService } from "@/feature/bite/services/company.service";
import { parseEnabledModules } from "./registry";
import type { ModuleId } from "./types";

const META_KEY = "enabled_modules";

export async function getEnabledModules(companyId: string): Promise<ModuleId[]> {
  const raw = await companyService.getMeta(companyId, META_KEY);
  return parseEnabledModules(raw);
}

export async function setEnabledModules(
  companyId: string,
  modules: ModuleId[]
): Promise<void> {
  const deduped = Array.from(new Set(modules));
  await companyService.setMeta(companyId, META_KEY, JSON.stringify(deduped));
}

export async function toggleModule(
  companyId: string,
  module: ModuleId,
  enabled: boolean
): Promise<ModuleId[]> {
  const current = await getEnabledModules(companyId);
  const next = enabled
    ? Array.from(new Set([...current, module]))
    : current.filter((m) => m !== module);
  await setEnabledModules(companyId, next);
  return next;
}
