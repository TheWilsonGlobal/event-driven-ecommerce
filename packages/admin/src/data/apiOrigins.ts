import {
  GATEWAY_URL,
  USER_SERVICE_URL,
  PRODUCT_SERVICE_URL,
  ORDER_SERVICE_URL,
  INVENTORY_SERVICE_URL,
  ANALYTICS_SERVICE_URL,
} from './serviceUrls'

// THE single decision point for "may this request carry the bearer token".
// Only the ms-* services and the gateway are listed. Everything else
// (Loki, Elasticsearch, Prometheus, Grafana, RustFS, the web client, any
// third-party host) is deliberately absent, so a token can never be sent there.
function serviceOrigins(): Set<string> {
  const out = new Set<string>()
  for (const u of [
    GATEWAY_URL,
    USER_SERVICE_URL,
    PRODUCT_SERVICE_URL,
    ORDER_SERVICE_URL,
    INVENTORY_SERVICE_URL,
    ANALYTICS_SERVICE_URL,
  ]) {
    try {
      out.add(new URL(u).origin)
    } catch {
      // unset/invalid origin: simply not allow-listed
    }
  }
  return out
}

export function isServiceUrl(url: string): boolean {
  try {
    return serviceOrigins().has(new URL(url).origin)
  } catch {
    return false
  }
}
