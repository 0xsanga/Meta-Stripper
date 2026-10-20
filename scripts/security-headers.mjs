const directives = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
]

export const previewContentSecurityPolicy = directives.join('; ')
export const productionContentSecurityPolicy = `${previewContentSecurityPolicy}; upgrade-insecure-requests`

const shared = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

export const previewHeaders = {
  'Content-Security-Policy': previewContentSecurityPolicy,
  ...shared,
}

export const productionHeaders = {
  'Content-Security-Policy': productionContentSecurityPolicy,
  ...shared,
  'Strict-Transport-Security': 'max-age=63072000',
}
