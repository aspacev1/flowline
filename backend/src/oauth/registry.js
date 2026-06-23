export function listEnabledProviders() {
  const enabled = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    enabled.push("google");
  }
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    enabled.push("microsoft");
  }
  if (
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  ) {
    enabled.push("apple");
  }
  return enabled;
}

export async function getProviderModule(provider) {
  switch (provider) {
    case "google":
      return import("./google.js");
    case "microsoft":
      return import("./microsoft.js");
    case "apple":
      return import("./apple.js");
    default:
      throw new Error(`Unknown OAuth provider: ${provider}`);
  }
}
