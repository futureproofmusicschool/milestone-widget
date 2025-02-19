
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { learnworldsToken } = await req.json()
    
    // Verify the Learnworlds token here
    // This is where you'd validate the token from Learnworlds
    
    // Create a new JWT for Supabase
    const secret = Deno.env.get('SUPABASE_JWT_SECRET')
    if (!secret) {
      throw new Error('JWT secret not configured')
    }

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      aud: 'authenticated',
      exp: now + 3600,
      sub: learnworldsToken.sub, // User ID from Learnworlds
      email: learnworldsToken.email,
      role: 'authenticated',
    }

    const token = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    return new Response(
      JSON.stringify({ token }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
