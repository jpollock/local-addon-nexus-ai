'use strict';

const schema = {
  type: 'object',
  properties: {
    cloakingDetected: {
      type: 'boolean',
      description: 'Whether the site returns different content to Googlebot vs normal browsers',
    },
    cloakingDetails: { type: 'string' },
    loginPageStatus: { type: 'number', description: 'HTTP status of /wp-login.php' },
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

SITE: ${data.installName}
URL: ${data.siteUrl}

## HTTP responses by user agent

### Standard browser (Chrome)
Status: ${data.standardResponse.status}
Headers: ${data.standardResponse.headers}
Body preview: ${data.standardResponse.bodyPreview}

### Googlebot
Status: ${data.googlebotResponse.status}
Headers: ${data.googlebotResponse.headers}
Body preview: ${data.googlebotResponse.bodyPreview}

### Google referrer
Status: ${data.googleReferrerResponse.status}
Body preview: ${data.googleReferrerResponse.bodyPreview}

### /wp-login.php
Status: ${data.loginPageStatus}

### /xmlrpc.php
Status: ${data.xmlrpcStatus}

### /wp-json/wp/v2/users
Status: ${data.usersApiStatus}
Body preview: ${data.usersApiBody}

## 5 random post URLs
${data.randomPostStatuses}

WHAT TO FLAG:
- Different response body or status code between standard browser and Googlebot: CRITICAL (cloaking)
- Location header on any response sending to external domain: CRITICAL
- /wp-json/wp/v2/users returning user login names: HIGH (user enumeration enabled)
- /xmlrpc.php returning 200 with XML: MEDIUM (attack surface)
- Any non-200 on random post URLs: MEDIUM

State cloakingDetected: true if and only if Googlebot response differs meaningfully from standard.`;
}

module.exports = { schema, buildPrompt };
