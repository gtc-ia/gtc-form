import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function verifyGoogleCredential(credentialJWT) {
  const ticket = await client.verifyIdToken({
    idToken: credentialJWT,
    audience: process.env.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email || !payload.sub) throw new Error('invalid_google_payload');
  return { email: payload.email.toLowerCase(), sub: payload.sub };
}
