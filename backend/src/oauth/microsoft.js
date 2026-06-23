const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const PROFILE_URL = "https://graph.microsoft.com/v1.0/me";

function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE_URL}/api/auth/oauth/microsoft/callback`;
}

export function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile User.Read",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code, fetchImpl = fetch) {
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Microsoft token exchange failed: ${tokenRes.status}`);
  }
  const { access_token } = await tokenRes.json();

  const profileRes = await fetchImpl(PROFILE_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Microsoft profile fetch failed: ${profileRes.status}`);
  }
  const profile = await profileRes.json();

  return {
    providerUserId: profile.id,
    email: profile.mail,
    emailVerified: true,
    name: profile.displayName,
  };
}
