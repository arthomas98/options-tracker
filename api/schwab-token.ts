// Vercel Serverless Function for Schwab OAuth Token Exchange
// This handles the token exchange server-side to avoid CORS issues
// and keep the client secret secure.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SCHWAB_TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { grant_type, code, redirect_uri, code_verifier, refresh_token } = req.body;

  // Get credentials from environment variables
  const clientId = process.env.VITE_SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Schwab API credentials not configured' });
  }

  // Build the request body based on grant type
  const params = new URLSearchParams();
  params.append('client_id', clientId);

  if (grant_type === 'authorization_code') {
    if (!code || !redirect_uri || !code_verifier) {
      return res.status(400).json({ error: 'Missing required parameters for authorization_code grant' });
    }
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirect_uri);
    params.append('code_verifier', code_verifier);
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'Missing refresh_token parameter' });
    }
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refresh_token);
  } else {
    return res.status(400).json({ error: 'Invalid grant_type' });
  }

  try {
    // Create Basic Auth header with client credentials
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(SCHWAB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Schwab token error:', data);
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Token exchange error:', error);
    return res.status(500).json({ error: 'Token exchange failed' });
  }
}
