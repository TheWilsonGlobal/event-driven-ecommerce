/** Collapsible dev-only hint for the real MfaScreen. Render only behind `import.meta.env.DEV`. */
export function DevTotpTip() {
  return (
    <details className="auth-devtip">
      <summary>Dev tip: generate a code without a phone</summary>
      <p className="auth-note">
        Copy the manual key shown above (or the secret from your authenticator entry) and run, from
        the repo root:
      </p>
      <pre className="auth-devtip-code">
        <code>node packages/admin/scripts/totp-dev.mjs &lt;BASE32_SECRET&gt;</code>
      </pre>
      <p className="auth-note">
        It prints the current 6-digit code and the seconds it stays valid (RFC 6238, SHA-1, 30 s).
        If codes are still rejected, check that this machine&apos;s clock is accurate.
      </p>
    </details>
  )
}
