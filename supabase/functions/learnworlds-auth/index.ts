
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

    // Format the URL properly, ensuring it doesn't have double slashes
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const userUrl = `${baseUrl}/v2/users/${userId}`;
    
    // First, get an access token
    const tokenUrl = `${baseUrl}/oauth2/access_token`;
    const tokenBody = new URLSearchParams();
    tokenBody.append('grant_type', 'client_credentials');
    tokenBody.append('client_id', clientId);
    tokenBody.append('client_secret', clientSecret);

    console.log('Requesting access token from:', tokenUrl);
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token response error:', errorText);
      throw new Error(`Failed to get access token: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Received access token');

    // Now use the access token to get user data
    console.log('Making request to:', userUrl);
    const userResponse = await fetch(userUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const responseText = await userResponse.text();
    console.log('Response status:', userResponse.status);
    console.log('Response headers:', Object.fromEntries(userResponse.headers.entries()));
    console.log('Response body:', responseText);

    if (!userResponse.ok) {
      throw new Error(`Failed to get user data (${userResponse.status}): ${responseText}`);
    }

    let userData;
    try {
      userData = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse response as JSON:', e);
      throw new Error('Invalid response format from Learnworlds API');
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
