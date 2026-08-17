/**
 * Company Service
 *
 * Centralized business logic for company management.
 */

import supabase from "@/adapters/supabase/supabase.server";
import { APP_KEY } from "@/feature/bite/config";

export interface Company {
  id: string;
  shop: string;
  app_key: string;
  name: string | null;
  plan_id: string;   // always set; defaults to 'free' on creation
  created_at: string;
  updated_at: string;
}

export interface CreateCompanyInput {
  shop: string;
  name?: string;
}

export interface CompanyMeta {
  id: string;
  company_id: string;
  meta_key: string;
  meta_value: string | null;
  created_at: string;
  updated_at: string;
}

class CompanyService {
  /**
   * Find company by shop domain and app key
   */
  async findByShop(shop: string): Promise<Company | null> {
    const { data, error } = await supabase
      .from('company')
      .select('*')
      .eq('shop', shop)
      .eq('app_key', APP_KEY)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Error finding company: ${error.message}`);
    }

    return data as Company | null;
  }

  /**
   * Create a new company
   */
  async create(input: CreateCompanyInput): Promise<Company> {
    const { data, error } = await supabase
      .from('company')
      .insert({
        shop: input.shop,
        app_key: APP_KEY,
        name: input.name || null,
        plan_id: 'free',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating company: ${error.message}`);
    }

    return data as Company;
  }

  /**
   * Find company by shop or create if it doesn't exist
   */
  async findOrCreate(shop: string, name?: string): Promise<Company> {
    let company = await this.findByShop(shop);

    if (!company) {
      company = await this.create({ shop, name });
    }

    return company;
  }

  /**
   * Update company information
   */
  async update(companyId: string, updates: Partial<CreateCompanyInput>): Promise<Company> {
    const { data, error } = await supabase
      .from('company')
      .update(updates)
      .eq('id', companyId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating company: ${error.message}`);
    }

    return data as Company;
  }

  /**
   * Update the company's subscription plan.
   * Pass 'free' when a subscription is cancelled/expired.
   */
  async setPlan(companyId: string, planId: string): Promise<void> {
    const { error } = await supabase
      .from('company')
      .update({ plan_id: planId })
      .eq('id', companyId);

    if (error) {
      throw new Error(`Error setting company plan: ${error.message}`);
    }
  }

  /**
   * Get a specific meta value for a company
   */
  async getMeta(companyId: string, metaKey: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('company_meta')
      .select('meta_value')
      .eq('company_id', companyId)
      .eq('meta_key', metaKey)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Error getting company meta: ${error.message}`);
    }

    return data?.meta_value || null;
  }

  /**
   * Set a meta value for a company (creates or updates)
   */
  async setMeta(companyId: string, metaKey: string, metaValue: string): Promise<void> {
    const { error } = await supabase
      .from('company_meta')
      .upsert({
        company_id: companyId,
        meta_key: metaKey,
        meta_value: metaValue,
      }, {
        onConflict: 'company_id,meta_key'
      });

    if (error) {
      throw new Error(`Error setting company meta: ${error.message}`);
    }
  }

  /**
   * Get all metadata for a company as a key-value object
   */
  async getAllMeta(companyId: string): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('company_meta')
      .select('meta_key, meta_value')
      .eq('company_id', companyId);

    if (error) {
      throw new Error(`Error getting all company meta: ${error.message}`);
    }

    // Convert array to object
    const metaObject: Record<string, string> = {};
    data?.forEach((item) => {
      if (item.meta_value) {
        metaObject[item.meta_key] = item.meta_value;
      }
    });

    return metaObject;
  }

  /**
   * Get all feature flags for a company
   */
  async getFeatureFlags(companyId: string): Promise<Record<string, boolean>> {
    const flagsJson = await this.getMeta(companyId, 'feature_flags');
    if (!flagsJson) return {};
    try {
      return JSON.parse(flagsJson);
    } catch (e) {
      console.error('Error parsing feature flags:', e);
      return {};
    }
  }

  /**
   * Set a specific feature flag
   */
  async setFeatureFlag(companyId: string, flag: string, value: boolean): Promise<void> {
    const currentFlags = await this.getFeatureFlags(companyId);
    currentFlags[flag] = value;
    await this.setMeta(companyId, 'feature_flags', JSON.stringify(currentFlags));
  }

  /**
   * Set multiple meta values at once
   */
  async setMultipleMeta(companyId: string, metaObject: Record<string, string>): Promise<void> {
    const metaArray = Object.entries(metaObject).map(([key, value]) => ({
      company_id: companyId,
      meta_key: key,
      meta_value: value,
    }));

    if (metaArray.length === 0) return;

    const { error } = await supabase
      .from('company_meta')
      .upsert(metaArray, {
        onConflict: 'company_id,meta_key'
      });

    if (error) {
      throw new Error(`Error setting multiple company meta: ${error.message}`);
    }
  }
}

// Export singleton instance
export const companyService = new CompanyService();
