'use strict';

const { untrusted, UNTRUSTED_DATA_RULE, SEVERITY_SCALE } = require('./_shared');

const schema = {
  type: 'object',
  properties: {
    cloakingDetected: {
      type: 'boolean',
      description: 'Whether the site returns different content to Googlebot vs normal browsers',
    },
    cloakingDetails: { type: 'string' },
    loginPageStatus: { type: 'integer', description: 'HTTP status of /wp-login.php' },
    xmlrpcEnabled: { type: 'boolean' },
    userEnumerationEnabled: { type: 'boolean', description: 'Whether /wp-json/wp/v2/users returns user data' },
    redirectsDetected: {
      type: 'array',
      description: 'Unexpected redirects from any URL tested',
      items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    },
    anomalies: { type: 'array', items: { type: 'string' } },
  },
  required: ['cloakingDetected', 'loginPageStatus', 'xmlrpcEnabled', 'userEnumerationEnabled', 'redirectsDetected', 'anomalies'],
};

function buildPrompt(data) {
  return `You are a WordPress behavioral security analyst. Analyze external HTTP responses for signs of server-side cloaking or compromise.

${UNTRUSTED_DATA_RULE}

${SEVERITY_SCALE}

SITE: ${data.installName}
URL: ${data.siteUrl}

## HTTP responses by user agent

### Standard browser (Chrome)
Status: ${data.standardResponse.status}
Headers: ${untrusted('standard_headers', data.standardResponse.headers)}
Body preview: ${untrusted('standard_body', data.standardResponse.bodyPreview)}

### Googlebot
Status: ${data.googlebotResponse.status}
Headers: ${untrusted('googlebot_headers', data.googlebotResponse.headers)}
Body preview: ${untrusted('googlebot_body', data.googlebotResponse.bodyPreview)}

### Google referrer
Status: ${data.googleReferrerResponse.status}
Body preview: ${untrusted('google_referrer_body', data.googleReferrerResponse.bodyPreview)}

### /wp-login.php
Status: ${data.loginPageStatus}

### /xmlrpc.php
Status: ${data.xmlrpcStatus}

### /wp-json/wp/v2/users
Status: ${data.usersApiStatus}
Body preview: ${untrusted('users_api_body', data.usersApiBody)}

## 5 random post URLs
${untrusted('random_post_statuses', data.randomPostStatuses)}

NOTE: If any section above shows "(not collected)" or is empty, treat it as no data available — do not infer findings from it.

WHAT TO FLAG:
- Different response body or status code between standard browser and Googlebot: CRITICAL (cloaking)
- Location header on any response sending to external domain: CRITICAL
- /wp-json/wp/v2/users returning user login names: HIGH (user enumeration enabled)
- /xmlrpc.php returning 200 with XML: MEDIUM (attack surface)
- Any non-200 on random post URLs: MEDIUM

=== WHAT COUNTS AS A "MEANINGFUL" DIFFERENCE (cloaking determination) ===
Normal dynamic pages differ on every request. The following are EXPECTED and must NOT be
treated as cloaking:
- Nonces, CSRF tokens, session identifiers, cache-buster query strings
- Timestamps, relative dates, "generated in N seconds" footers
- Rotating content: ads, related-post lists, view/visitor counters, A/B variants
- Ordering differences in otherwise equivalent content
- Differences in Date/Age/Set-Cookie/X-Cache headers

Cloaking IS indicated by:
- Links, anchor text, or redirects to external domains present for Googlebot but absent
  for the standard browser (or vice versa)
- Injected <script>, <iframe>, or hidden-div blocks appearing for only one user agent
- A different Location/redirect target between agents
- Substantively different page content: different topic, keywords, or body copy —
  particularly pharmaceutical, casino, loan, or replica-goods terminology
- One agent receiving a 200 with content while the other receives 404/403/redirect

State cloakingDetected: true if and only if at least one item from the "Cloaking IS indicated by"
list is present. If the only differences fall under the EXPECTED list, state cloakingDetected: false
and briefly say which benign differences you observed, so a reviewer can see you checked.`;
}

module.exports = { schema, buildPrompt };
