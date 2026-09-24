import * as fs from 'fs'
import * as path from 'path'

/**
 * Persisting KAFKA_ENABLED to the repo-root `.env`.
 *
 * ── Why this cannot be a live toggle ────────────────────────────────────────
 * `loadKafkaSettings` reads `process.env.KAFKA_ENABLED` ONCE, at module import
 * time, and when it is false `createKafkaClient` is never called — the process
 * holds no Kafka client, no producer and no consumer to start. Flipping a
 * boolean in a running service would therefore change what the service SAYS
 * about Kafka without changing anything it DOES, which is the precise failure
 * this repo's endpoints exist to avoid (see schemas.ts on `enabled`).
 *
 * So the honest contract is: this module writes the flag to the file the
 * services read at boot, and reports `restartRequired: true`. The caller is
 * told, in the same response, that the running process is unchanged. A toggle
 * that silently implied otherwise would be a fabricated status.
 *
 * ── Why a line rewrite and not a dotenv round-trip ──────────────────────────
 * The repo-root `.env` is a documented, heavily commented operator file. Every
 * parse-and-reserialise library drops comments and reorders keys, so a single
 * admin toggle would rewrite all ~240 lines and bury the real change in the
 * diff. This replaces the one assignment in place and leaves every other byte,
 * including the comment block above the key, untouched.
 */

/** The only key this module is allowed to touch. */
const KAFKA_ENABLED_KEY = 'KAFKA_ENABLED'

export interface KafkaEnvToggleResult {
  /** The value now persisted in `.env`. */
  enabled: boolean
  /** The value this PROCESS booted with — unchanged by the write. */
  runtimeEnabled: boolean
  /**
   * True whenever the persisted value differs from what the process is running
   * with. The flag is read at import time, so a write can never take effect in
   * the current process; this is what tells the UI to stop short of claiming
   * Kafka is now on.
   */
  restartRequired: boolean
  /** Absolute path actually written, so the operator can verify it. */
  envPath: string
  timestamp: string
}

/** Raised when the `.env` cannot be read or written. Carries an operator-facing message. */
export class KafkaEnvWriteError extends Error {
  constructor(
    message: string,
    readonly envPath: string
  ) {
    super(message)
    this.name = 'KafkaEnvWriteError'
  }
}

/**
 * Matches an uncommented `KAFKA_ENABLED=...` assignment at the start of a line.
 *
 * Anchored with `m` so it finds the key on its own line, and the leading `[^#]`
 * guard is expressed as "not preceded by #" via the `\s*` + negative check in
 * `replaceAssignment` rather than in the pattern, because a commented example
 * line (`# KAFKA_ENABLED=true`) must NOT be treated as the live assignment.
 */
function isAssignmentFor(line: string, key: string): boolean {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('#')) {
    return false
  }
  // `export KAFKA_ENABLED=` is valid in a .env consumed by a shell, so allow it.
  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trimStart()
    : trimmed
  return withoutExport.startsWith(`${key}=`)
}

/**
 * Replaces the live assignment for `key`, preserving the rest of the file
 * byte-for-byte. Appends the key if no live assignment exists — a `.env`
 * missing the key is a valid state (the code defaults it to false), and
 * silently doing nothing would report success while changing nothing.
 */
export function setEnvValue(contents: string, key: string, value: string): string {
  // Split on \n and keep whatever line endings were there: on Windows the file
  // is very often CRLF, and rewriting it as LF would show every line as
  // changed in git for a one-key edit.
  const lines = contents.split('\n')
  let replaced = false

  const next = lines.map((line) => {
    if (replaced || !isAssignmentFor(line, key)) {
      return line
    }
    replaced = true
    // Preserve a trailing \r so a CRLF file stays CRLF.
    const carriageReturn = line.endsWith('\r') ? '\r' : ''
    const indent = line.slice(0, line.length - line.trimStart().length)
    const exported = line.trimStart().startsWith('export ') ? 'export ' : ''
    return `${indent}${exported}${key}=${value}${carriageReturn}`
  })

  if (replaced) {
    return next.join('\n')
  }

  // No live assignment. Append one, matching the file's dominant line ending.
  const usesCrlf = contents.includes('\r\n')
  const eol = usesCrlf ? '\r\n' : '\n'
  const needsLeadingEol = contents.length > 0 && !contents.endsWith('\n')
  return `${contents}${needsLeadingEol ? eol : ''}${key}=${value}${eol}`
}

/**
 * Writes KAFKA_ENABLED to the repo-root `.env`.
 *
 * `runtimeEnabled` is passed in rather than re-read from `process.env` so the
 * caller reports the value its own Kafka client was actually built from — the
 * one fact that determines whether a restart is outstanding.
 *
 * The write is atomic (temp file + rename), matching keyvalue.ts: a torn `.env`
 * would break every service's next boot, which is a far worse outcome than a
 * failed toggle.
 */
export function setKafkaEnabledInEnv(
  envPath: string,
  enabled: boolean,
  runtimeEnabled: boolean
): KafkaEnvToggleResult {
  let contents: string
  try {
    contents = fs.readFileSync(envPath, 'utf8')
  } catch (err) {
    // A missing .env is not something to paper over by creating one: the file
    // carries ~240 lines of other configuration, and a fresh two-line file
    // would leave every other service misconfigured on the next boot.
    throw new KafkaEnvWriteError(
      `Could not read ${envPath}: ${err instanceof Error ? err.message : String(err)}`,
      envPath
    )
  }

  const updated = setEnvValue(contents, KAFKA_ENABLED_KEY, String(enabled))

  const tempPath = `${envPath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tempPath, updated, 'utf8')
    fs.renameSync(tempPath, envPath)
  } catch (err) {
    try {
      fs.unlinkSync(tempPath)
    } catch {
      /* the temp file may not exist; nothing to unwind */
    }
    throw new KafkaEnvWriteError(
      `Could not write ${envPath}: ${err instanceof Error ? err.message : String(err)}`,
      envPath
    )
  }

  return {
    enabled,
    runtimeEnabled,
    // Always true when the two differ. Never claims the running process picked
    // the change up, because it cannot have.
    restartRequired: enabled !== runtimeEnabled,
    envPath,
    timestamp: new Date().toISOString(),
  }
}

/** Resolves the repo-root `.env` from a service's own directory. */
export function resolveRepoEnvPath(repoRoot: string): string {
  return path.resolve(repoRoot, '.env')
}
