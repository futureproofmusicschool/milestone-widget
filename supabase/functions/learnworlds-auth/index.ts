
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

    // Create base64 encoded credentials
    const credentials = btoa(`${clientId}:${clientSecret}`);
    
    // Make request to get user data directly with Basic Auth
    const userResponse = await fetch(`${apiUrl}/api/v2/users/${userId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      }
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('Failed to get user data:', userResponse.status, errorText);
      throw new Error(`Failed to get user data: ${errorText}`);
    }

    const userData = await userResponse.json();
    console.log('Successfully retrieved user data');

    // Create Supabase JWT
    const supabaseJwtSecret = Deno.env.get('SUPABASE_JWT_SECRET');
    if (!supabaseJwtSecret) {
      throw new Error('Supabase JWT secret not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const jwt = await new jose.SignJWT({
      role: 'authenticated',
      aud: 'authenticated',
      sub: userData.id?.toString() || userId,
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
