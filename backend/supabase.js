const { createClient } = require('@supabase/supabase-js');

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://wjcuebpglrdsbynsfxmz.supabase.co';

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_ylNlS6_fZFgqyfqMQlbHUw_XO47wDLV';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;