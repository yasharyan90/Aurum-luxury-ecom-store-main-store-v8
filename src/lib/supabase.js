// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

const isConfigured =
  supabaseUrl &&
  supabaseKey &&
  !supabaseUrl.includes('placeholder') &&
  !supabaseKey.includes('placeholder');

if (!isConfigured) {
  console.warn(
    '⚠️  Supabase env vars not set. Running in demo mode.\n' +
    '   Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in .env'
  );
}

// Always create a client — even with placeholders
// (calls will fail gracefully and fall back to mock data)
export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseKey  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'
);
console.log('supabase.rpc type:', typeof supabase.rpc);

export const supabaseConfigured = isConfigured;
export default supabase;
