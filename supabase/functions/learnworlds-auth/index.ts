
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    
    // Get Learnworlds credentials from environment
    const clientId = Deno.env.get('LEARNWORLDS_CLIENT_ID');
    const clientSecret = Deno.env.get('LEARNWORLDS_CLIENT_SECRET');
    const apiUrl = Deno.env.get('LEARNWORLDS_API_URL');

    if (!clientId || !clientSecret || !apiUrl) {
      throw new Error('Learnworlds credentials not configured');
    }

    // Verify token with Learnworlds
    const response = await fetch(`${apiUrl}/v2/validate-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!response.ok) {
      console.error('Learnworlds validation failed:', await response.text());
      throw new Error('Failed to validate Learnworlds token');
    }

    const userData = await response.json();
    console.log('Learnworlds user data:', userData);

    // Create Supabase JWT
    const supabaseJwtSecret = Deno.env.get('SUPABASE_JWT_SECRET');
    if (!supabaseJwtSecret) {
      throw new Error('Supabase JWT secret not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const jwt = await new jose.SignJWT({
      role: 'authenticated',
      aud: 'authenticated',
      sub: userData.id, // Use Learnworlds user ID
      email: userData.email,
      exp: now + 3600 // 1 hour expiration
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(supabaseJwtSecret));

    return new Response(
      JSON.stringify({ token: jwt, user: userData }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Auth error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
