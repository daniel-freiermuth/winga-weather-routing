/**
 * Windy token acquisition — reverse-engineered from index.js v50.1.2.
 *
 * TWO FLOWS
 * ──────────
 *
 * 1. ANONYMOUS (free tier, ~6 day forecast horizon)
 *    One call to account.windy.com/api/info with a static CSRF header.
 *    Returns a JWT with magic={deviceId}, auth=false.
 *    Use: fetchWindyToken()
 *
 * 2. PREMIUM LOGIN (full 15-day forecast, requires Windy Premium account)
 *    Three-step flow against account.windy.com (a SvelteKit app):
 *
 *    a. GET  /login                             → sets _account_sid session cookie
 *    b. GET  /login/__data.json                 → returns per-session csrfToken + anonymous accessToken
 *    c. POST /api/v1/account/login              → returns premium JWT
 *       Headers: windy-csrf: {csrfToken from b}
 *       Body:    {"email": "...", "password": "..."}
 *
 *    The returned JWT has magic={userId}, and when passed as token2 with pr=1,
 *    the point forecast API returns the full 15-day extended forecast.
 *    Use: loginWindy(email, password)
 *
 * ANONYMOUS CSRF DERIVATION (for reference)
 * ──────────────────────────────────────────
 *    const gp = (s) => s.split('').map(c => String.fromCodePoint(255 - c.charCodeAt(0))).join('');
 *    // gp(atob('npyckIqRi9CWkZmQ')) → 'account/info'  (never changes)
 *    // gp(atob('iJaRm4bSnIyNmQ==')) → 'windy-csrf'    (the header name)
 *    // btoa(gp('undefined?undefined')) → 'ipGbmpmWkZqbwIqRm5qZlpGamw=='  (static value)
 *
 * JWT PAYLOAD
 * ────────────
 *   { magic: number, iat: number, exp: number }
 *   magic  — server-assigned device/user id; determines entitlements server-side
 *   exp    — ~48 h from issuance; refresh before it expires
 */

import type { WindyAuthResponse } from "./types.js";

const ACCOUNT_BASE = "https://account.windy.com";
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

/** Static CSRF token required by account.windy.com/api/info. Never changes. */
export const WINDY_CSRF = "ipGbmpmWkZqbwIqRm5qZlpGamw==";

const ACCOUNT_INFO_URL = `${ACCOUNT_BASE}/api/info`;

/**
 * Fetch a fresh Windy JWT from the anonymous auth endpoint.
 *
 * Works without any cookies or prior login. Pass `country` as the 2-letter
 * ISO country code (from IP geolocation or user preference) — it affects
 * consent requirements but not the token itself.
 *
 * The returned token is valid for ~48 hours.
 *
 * @example
 * const { token } = await fetchWindyToken();
 */
export async function fetchWindyToken(
  country = "SE"
): Promise<WindyAuthResponse> {
  const resp = await fetch(`${ACCOUNT_INFO_URL}?country=${country}`, {
    headers: {
      "windy-csrf": WINDY_CSRF,
      Origin: "https://www.windy.com",
      Referer: "https://www.windy.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
  });

  if (!resp.ok) {
    throw new Error(`Windy auth failed: HTTP ${resp.status}`);
  }

  return resp.json() as Promise<WindyAuthResponse>;
}

// ---------------------------------------------------------------------------
// Premium login
// ---------------------------------------------------------------------------

/** Credentials for a Windy account. */
export interface WindyCredentials {
  email: string;
  password: string;
}

/** Response from the premium login endpoint. */
export interface WindyLoginResponse {
  /** Premium JWT. Pass as `token2` with `pr=1` for 15-day extended forecasts. */
  accessToken: string;
  isPremium: boolean;
  /** The server-session CSRF token consumed by this login (single-use). */
  csrfToken: string;
}

/**
 * Log in with Windy account credentials and return a premium JWT.
 *
 * The token is valid for ~48 hours. Store it and refresh with this function
 * before expiry.  Pass it to `WindyClient` via `WindyClientOptions.token`
 * (once that option exists), or directly to `fetchPointForecast` as `token`.
 *
 * The returned `accessToken` should replace the anonymous `token2` in all
 * API calls. Combined with `pr=1` and `extended=true`, the point forecast
 * API returns the full 15-day forecast.
 *
 * @example
 * const { accessToken, isPremium } = await loginWindy({
 *   email: "me@example.com",
 *   password: "MyPass123",
 * });
 * console.log(`Premium: ${isPremium}`);
 * // Store accessToken; re-login when tokenExpiresSoon(accessToken).
 */
export async function loginWindy(
  credentials: WindyCredentials
): Promise<WindyLoginResponse> {
  // Step 1: Start a session — sets the _account_sid HttpOnly cookie.
  const loginPageResp = await fetch(`${ACCOUNT_BASE}/login`, {
    credentials: "include",
    headers: { ...COMMON_HEADERS, Referer: ACCOUNT_BASE },
  });
  if (!loginPageResp.ok) {
    throw new Error(`Windy login page failed: HTTP ${loginPageResp.status}`);
  }

  // Extract the Set-Cookie header so we can replay it in Node.js
  // (Node's fetch doesn't share cookies automatically across calls).
  const setCookie = loginPageResp.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie.match(/(_account_sid=[^;]+)/)?.[1] ?? "";

  // Step 2: Fetch per-session CSRF token and anonymous accessToken.
  const dataResp = await fetch(
    `${ACCOUNT_BASE}/login/__data.json?x-sveltekit-invalidated=1010`,
    {
      credentials: "include",
      headers: {
        ...COMMON_HEADERS,
        Referer: `${ACCOUNT_BASE}/login`,
        Cookie: sessionCookie,
      },
    }
  );
  if (!dataResp.ok) {
    throw new Error(`Windy __data.json failed: HTTP ${dataResp.status}`);
  }

  // SvelteKit __data.json nests values as a flat array with index references.
  // Shape: nodes[0].data = [ {csrfToken: 2, ...}, ..., "<csrfToken>", ..., "<accessToken>" ]
  const svkData = (await dataResp.json()) as {
    nodes: { type: string; data?: unknown[] }[];
  };
  const flat = svkData.nodes[0]?.data as unknown[];
  if (!flat) throw new Error("Unexpected __data.json shape");
  const csrfToken = flat[2] as string;
  // flat[5] is the anonymous accessToken — we'll replace it after login.

  // Step 3: POST credentials.
  const loginResp = await fetch(`${ACCOUNT_BASE}/api/v1/account/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/json",
      "windy-csrf": csrfToken,
      Origin: ACCOUNT_BASE,
      Referer: `${ACCOUNT_BASE}/login`,
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  });

  if (loginResp.status === 404) {
    throw new Error("Windy login failed: account not found");
  }
  if (loginResp.status === 401 || loginResp.status === 403) {
    throw new Error("Windy login failed: invalid credentials or CSRF error");
  }
  if (!loginResp.ok) {
    const body = await loginResp.text().catch(() => "");
    throw new Error(`Windy login failed: HTTP ${loginResp.status} — ${body}`);
  }

  const loginData = (await loginResp.json()) as {
    accessToken?: string;
    isPremium?: boolean;
    token?: string;
  };

  const accessToken = loginData.accessToken ?? loginData.token;
  if (!accessToken) {
    throw new Error("Windy login succeeded but no accessToken in response");
  }

  return {
    accessToken,
    isPremium: loginData.isPremium ?? false,
    csrfToken,
  };
}

/** Decode the token expiry without a JWT library. */
export function tokenExpiresAt(token: string): Date {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid JWT");
  const decoded = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as { exp: number };
  return new Date(decoded.exp * 1000);
}

/** True if the token expires within `marginMs` (default 5 min). */
export function tokenExpiresSoon(
  token: string,
  marginMs = 5 * 60 * 1000
): boolean {
  return tokenExpiresAt(token).getTime() - Date.now() < marginMs;
}
