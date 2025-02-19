
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
    console.log('Making request to Learnworlds API');
    
    // First get an access token
    const tokenResponse = await fetch(`${apiUrl}/oauth2/access_token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    const tokenData = await tokenResponse.json();
    console.log('Token response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
    }

    // Now use the access token to get user data
    const userResponse = await fetch(`${apiUrl}/v2/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    const userData = await userResponse.json();
    console.log('User response status:', userResponse.status);

    if (!userResponse.ok) {
      throw new Error(`Failed to get user data: ${JSON.stringify(userData)}`);
    }

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
