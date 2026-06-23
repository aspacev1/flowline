import jwt from "jsonwebtoken";

const AUTH_URL = "https://appleid.apple.com/auth/authorize";
const TOKEN_URL = "https://appleid.apple.com/auth/token";

function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE_URL}/api/auth/oauth/apple/callback`;
}

function buildClientSecret() {
  const privateKey = (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return jwt.sign({}, privateKey, {
    algorithm: "ES256",
    expiresIn: "5m",
    audience: "https://appleid.apple.com",
    issuer: process.env.APPLE_TEAM_ID,
    subject: process.env.APPLE_CLIENT_ID,
    keyid: process.env.APPLE_KEY_ID,
  });
}

export function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "name email",
    response_mode: "form_post",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code, fetchImpl = fetch) {
  const clientSecret = buildClientSecret();
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.APPLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Apple token exchange failed: ${tokenRes.status}`);
  }
  const { id_token } = await tokenRes.json();
  const claims = jwt.decode(id_token);

  return {
    providerUserId: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === "true" || claims.email_verified === true,
    name: null,
  };
}
