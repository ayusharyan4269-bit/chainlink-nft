import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://wjcuebpglrdsbynsfxmz.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_ylNlS6_fZFgqyfqMQlbHUw_XO47wDLV';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);