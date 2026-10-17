import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The admin bundle may only ever see the Supabase URL and PUBLISHABLE key.
const PACKAGE_ROOT = resolve(__dirname, '../..')
// Built from fragments so this file does not match its own pattern.
const FORBIDDEN = new RegExp(
  ['SUPABASE_SECRET' + '_KEY', 'sb_sec' + 'ret_', 'SERVICE_AUTH' + '_SECRET'].join('|')
)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|css|html|json)$/.test(name)) out.push(full)
  }
  return out
}

describe('server-only secrets never enter the admin source', () => {
  it('src/ and vite.config.ts contain no secret-key identifiers', () => {
    const files = [...walk(join(PACKAGE_ROOT, 'src')), join(PACKAGE_ROOT, 'vite.config.ts')]
    expect(files.length).toBeGreaterThan(10)
    const offenders = files.filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
