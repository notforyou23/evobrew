# Anthropic OAuth Flow (Reverse Engineered)

**Source:** Extracted from Claude Code CLI, used by Clawdbot  
**Status:** Undocumented, unofficial, requires Claude Pro/Max  
**Risk:** Could break at any time if Anthropic changes endpoints or rotates CLIENT_ID

---

## Key Constants

```javascript
// Hardcoded CLIENT_ID (base64 encoded in source: "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl")
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

// Endpoints (internal, not public API)
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";

// Scopes
const SCOPES = "org:create_api_key user:profile user:inference";
```

---

## Step 1: Generate PKCE Code Verifier & Challenge

PKCE (Proof Key for Code Exchange) prevents authorization code interception.

```javascript
/**
 * Generate PKCE pair using Web Crypto API
 */
async function generatePKCE() {
  // Generate 32 random bytes for verifier
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  
  // Base64url encode verifier
  const verifier = base64urlEncode(verifierBytes);
  
  // Compute SHA-256 challenge from verifier
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  
  return { verifier, challenge };
}

/**
 * Base64url encoding (no padding, URL-safe)
 */
function base64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
```

**Example output:**
```javascript
{
  verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
}
```

---

## Step 2: Build Authorization URL

```javascript
async function getAuthorizationUrl() {
  const { verifier, challenge } = await generatePKCE();
  
  const authParams = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier, // ← Store verifier in state for later
  });
  
  const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`;
  
  return { authUrl, verifier };
}
```

**Example URL:**
```
https://claude.ai/oauth/authorize?
  code=true&
  client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&
  response_type=code&
  redirect_uri=https://console.anthropic.com/oauth/code/callback&
  scope=org:create_api_key+user:profile+user:inference&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256&
  state=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

---

## Step 3: User Authorization

1. **Open the authorization URL** in a browser
2. User logs in with Claude Pro/Max account
3. User authorizes the application
4. **Anthropic redirects** to:
   ```
   https://console.anthropic.com/oauth/code/callback?code=AUTH_CODE&state=STATE_VALUE
   ```
5. User **copies the full URL** or just the `code` and `state` values

**Format of callback URL:**
```
https://console.anthropic.com/oauth/code/callback?
  code=abc123...xyz&
  state=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

**Alternative format** (some implementations):
```
code#state (e.g., "abc123xyz#dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
```

---

## Step 4: Exchange Code for Tokens

### Request

```http
POST https://console.anthropic.com/v1/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "code": "abc123...xyz",
  "state": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  "redirect_uri": "https://console.anthropic.com/oauth/code/callback",
  "code_verifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
}
```

**Critical fields:**
- `code`: Authorization code from callback URL
- `state`: Must match the verifier from PKCE generation
- `code_verifier`: Same as state (proves you generated the challenge)

### Response (Success)

```json
{
  "access_token": "ANTHROPIC_OAUTH_ACCESS_TOKEN_EXAMPLE",
  "refresh_token": "ANTHROPIC_OAUTH_REFRESH_TOKEN_EXAMPLE",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Token format:**
- `access_token`: OAuth access-token string
- `refresh_token`: OAuth refresh-token string
- `expires_in`: Seconds until access token expires (typically 3600 = 1 hour)

### Response (Error)

```json
{
  "error": "invalid_grant",
  "error_description": "Code has expired or been used"
}
```

---

## Step 5: Use Access Token

The access token works with Anthropic's Messages API:

```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": access_token, // ← OAuth token
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      { role: "user", content: "Hello, Claude!" }
    ]
  })
});
```

**Important:** OAuth tokens have the **same API access** as regular API keys created through the console.

---

## Step 6: Refresh Token When Expired

Access tokens expire after 1 hour. Use the refresh token to get a new one.

### Request

```http
POST https://console.anthropic.com/v1/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "refresh_token": "ANTHROPIC_OAUTH_REFRESH_TOKEN_EXAMPLE"
}
```

### Response

```json
{
  "access_token": "ANTHROPIC_OAUTH_ACCESS_TOKEN_EXAMPLE_NEW",
  "refresh_token": "ANTHROPIC_OAUTH_REFRESH_TOKEN_EXAMPLE_NEW",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Note:** The refresh token itself may also rotate (you get a new one in the response).

---

## Complete JavaScript Implementation

```javascript
/**
 * Complete Anthropic OAuth implementation
 */

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

// ===== PKCE Generation =====

function base64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generatePKCE() {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);
  
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  
  return { verifier, challenge };
}

// ===== Authorization Flow =====

async function startOAuthFlow() {
  const { verifier, challenge } = await generatePKCE();
  
  const authParams = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });
  
  const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`;
  
  console.log("1. Open this URL in your browser:");
  console.log(authUrl);
  console.log("\n2. After authorizing, copy the full callback URL");
  console.log("   (or just the 'code' and 'state' parameters)");
  
  return { verifier };
}

// ===== Token Exchange =====

async function exchangeCodeForTokens(code, state, verifier) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: code,
      state: state,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  
  // Calculate expiry with 5-minute buffer
  const expiresAt = Date.now() + (data.expires_in * 1000) - (5 * 60 * 1000);
  
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: expiresAt,
    expiresIn: data.expires_in,
  };
}

// ===== Token Refresh =====

async function refreshAccessToken(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - (5 * 60 * 1000),
  };
}

// ===== Usage Example =====

async function main() {
  try {
    // Step 1: Start OAuth flow
    const { verifier } = await startOAuthFlow();
    
    // Step 2: User manually opens URL and authorizes
    // (In a real app, you'd open it automatically and capture the callback)
    
    // Step 3: Parse callback URL
    // For demo, assume user pastes: "abc123#verifier" or full URL
    const userInput = prompt("Paste the callback URL or code#state:");
    
    let code, state;
    if (userInput.includes("code=")) {
      // Parse full URL
      const url = new URL(userInput);
      code = url.searchParams.get("code");
      state = url.searchParams.get("state");
    } else if (userInput.includes("#")) {
      // Parse "code#state" format
      [code, state] = userInput.split("#");
    } else {
      throw new Error("Invalid input format");
    }
    
    // Step 4: Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, state, verifier);
    
    console.log("\n✅ OAuth successful!");
    console.log("Access Token:", tokens.accessToken.substring(0, 40) + "...");
    console.log("Refresh Token:", tokens.refreshToken.substring(0, 40) + "...");
    console.log("Expires in:", tokens.expiresIn, "seconds");
    console.log("Expires at:", new Date(tokens.expiresAt).toISOString());
    
    // Step 5: Use the access token
    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": tokens.accessToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 100,
        messages: [{ role: "user", content: "Say 'OAuth works!'" }],
      }),
    });
    
    const result = await apiResponse.json();
    console.log("\n✅ API call successful!");
    console.log("Response:", result.content[0].text);
    
    // Step 6: Refresh token before expiry
    console.log("\n🔄 Testing token refresh...");
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    console.log("New Access Token:", refreshed.accessToken.substring(0, 40) + "...");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// Run if in Node.js
if (typeof window === "undefined") {
  main();
}
```

---

## Python Implementation

```python
import hashlib
import base64
import secrets
import requests
from urllib.parse import urlencode

CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
SCOPES = "org:create_api_key user:profile user:inference"

def base64url_encode(data: bytes) -> str:
    """Base64url encode without padding"""
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

def generate_pkce():
    """Generate PKCE verifier and challenge"""
    # Generate random verifier (32 bytes)
    verifier_bytes = secrets.token_bytes(32)
    verifier = base64url_encode(verifier_bytes)
    
    # Compute SHA-256 challenge
    challenge_bytes = hashlib.sha256(verifier.encode('utf-8')).digest()
    challenge = base64url_encode(challenge_bytes)
    
    return verifier, challenge

def get_authorization_url():
    """Generate authorization URL"""
    verifier, challenge = generate_pkce()
    
    params = {
        "code": "true",
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": verifier,
    }
    
    auth_url = f"{AUTHORIZE_URL}?{urlencode(params)}"
    return auth_url, verifier

def exchange_code_for_tokens(code: str, state: str, verifier: str):
    """Exchange authorization code for tokens"""
    response = requests.post(TOKEN_URL, json={
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "code": code,
        "state": state,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    })
    
    response.raise_for_status()
    return response.json()

def refresh_token(refresh_token: str):
    """Refresh access token"""
    response = requests.post(TOKEN_URL, json={
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "refresh_token": refresh_token,
    })
    
    response.raise_for_status()
    return response.json()

# Usage
if __name__ == "__main__":
    # Step 1: Get authorization URL
    auth_url, verifier = get_authorization_url()
    print("1. Open this URL:")
    print(auth_url)
    print("\n2. After authorizing, paste the callback URL:")
    
    # Step 2: Get user input
    callback = input()
    
    # Parse code and state
    if "code=" in callback:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(callback)
        params = parse_qs(parsed.query)
        code = params["code"][0]
        state = params["state"][0]
    else:
        code, state = callback.split("#")
    
    # Step 3: Exchange for tokens
    tokens = exchange_code_for_tokens(code, state, verifier)
    
    print("\n✅ Success!")
    print(f"Access Token: {tokens['access_token'][:40]}...")
    print(f"Refresh Token: {tokens['refresh_token'][:40]}...")
    print(f"Expires in: {tokens['expires_in']} seconds")
```

---

## Token Storage Best Practices

```javascript
// Store tokens securely
const credentials = {
  accessToken: "ANTHROPIC_OAUTH_ACCESS_TOKEN_EXAMPLE",
  refreshToken: "ANTHROPIC_OAUTH_REFRESH_TOKEN_EXAMPLE",
  expiresAt: Date.now() + 3600000, // 1 hour from now
};

// Check if token needs refresh
function needsRefresh(expiresAt) {
  // Refresh 5 minutes before expiry
  return Date.now() >= (expiresAt - 5 * 60 * 1000);
}

// Get valid token (auto-refresh if needed)
async function getValidToken(credentials) {
  if (needsRefresh(credentials.expiresAt)) {
    console.log("Token expired, refreshing...");
    const refreshed = await refreshAccessToken(credentials.refreshToken);
    credentials.accessToken = refreshed.accessToken;
    credentials.refreshToken = refreshed.refreshToken;
    credentials.expiresAt = refreshed.expiresAt;
  }
  return credentials.accessToken;
}
```

---

## Security Considerations

### ✅ Safe
- PKCE prevents authorization code interception
- Tokens are short-lived (1 hour)
- Refresh tokens can be revoked by user

### ⚠️ Risks
- **Undocumented endpoint** - Could break without warning
- **Hardcoded CLIENT_ID** - If Anthropic rotates it, flow breaks
- **No client secret** - Relies on PKCE for security
- **Token storage** - Store refresh tokens securely (keychain, env vars, never in git)

### 🚫 Don't
- **Don't commit tokens** to version control
- **Don't share refresh tokens** (they're long-lived)
- **Don't skip PKCE** (required for security)
- **Don't rely on this for production** (use official API keys instead)

---

## Comparison: OAuth vs API Keys

| Feature | OAuth Tokens | API Keys |
|---------|--------------|----------|
| **Creation** | User authorization flow | Console UI |
| **Lifespan** | 1 hour (renewable) | Indefinite |
| **Revocation** | User revokes via console | Delete key in console |
| **Use case** | CLI tools (Claude Code) | Server applications |
| **Requirements** | Claude Pro/Max | Any plan |
| **Rate limits** | Same as API key | Same as OAuth |

---

## Debugging Tips

### Check if OAuth endpoint is working
```bash
curl -X POST https://console.anthropic.com/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type": "refresh_token", "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e", "refresh_token": "invalid"}'
```

**Expected:** HTTP 400 with error message (means endpoint is alive)

### Verify access token works
```bash
curl https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_OAUTH_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

### Common errors
- `invalid_grant`: Code expired or already used (codes are single-use)
- `invalid_client`: CLIENT_ID changed (Anthropic rotated it)
- `invalid_request`: Malformed request (check JSON structure)
- `401 Unauthorized`: Token expired (refresh it)

---

## Future-Proofing

This flow could break if Anthropic:
1. Rotates the CLIENT_ID
2. Changes OAuth endpoints
3. Modifies scopes or adds new auth requirements
4. Deprecates this internal OAuth implementation

**Fallback:** Always support regular API keys as primary method. OAuth is convenient but fragile.

---

**Last Updated:** January 27, 2026  
**Source:** Reverse-engineered from `@mariozechner/pi-ai` npm package (used by Clawdbot)  
**Status:** Working as of Jan 2026, but unofficial and unsupported
