
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as jose from "https://deno.land/x/jose@v4.9.1/index.ts";

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
    const { token: userId } = await req.json();
    console.log('Received user ID from client:', userId);

    if (!userId) {
      throw new Error('No user ID provided');
    }
    
    // Get Learnworlds credentials from environment
    const clientId = Deno.env.get('LEARNWORLDS_CLIENT_ID');
    const clientSecret = Deno.env.get('LEARNWORLDS_CLIENT_SECRET');
    const apiUrl = Deno.env.get('LEARNWORLDS_API_URL');

    console.log('Checking Learnworlds credentials', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      apiUrl
    });

    if (!clientId || !clientSecret || !apiUrl) {
      throw new Error('Learnworlds credentials not configured');
    }

    // Get user info from Learnworlds using user ID
    console.log('Making request to Learnworlds API');
    const response = await fetch(`${apiUrl}/v2/users/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`
      }
    });

    const responseText = await response.text();
    console.log('Learnworlds API response:', response.status, responseText);

    if (!response.ok) {
      throw new Error(`Learnworlds validation failed: ${responseText}`);
    }

    const userData = JSON.parse(responseText);
    console.log('Parsed user data:', userData);

    // Create Supabase JWT
    const supabaseJwtSecret = Deno.env.get('SUPABASE_JWT_SECRET');
    if (!supabaseJwtSecret) {
      throw new Error('Supabase JWT secret not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const jwt = await new jose.SignJWT({
      role: 'authenticated',
      aud: 'authenticated',
      sub: userData.id?.toString() || userId, // Use the user ID we received
      email: userData.email || '',
      exp: now + 3600 // 1 hour expiration
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(supabaseJwtSecret));

    console.log('JWT created successfully');

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
      JSON.stringify({ 
        error: error.message,
        stack: error.stack
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
