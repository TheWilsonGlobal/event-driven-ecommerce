import fs from 'fs'
import path from 'path'

// The pattern is assembled from pieces so this file does not match itself.
const FORBIDDEN = new RegExp(
  ['SUPABASE_' + 'SECRET_KEY', 'sb_' + 'secret_', 'SERVICE_AUTH_' + 'SECRET'].join('|')
)

const root = path.resolve(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|json|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('no server-only secrets in client code', () => {
  const files = [...walk(path.join(root, 'src')), path.join(root, 'next.config.js')]

  it('scans a non-trivial set of files', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map((f) => [path.relative(root, f), f]))('%s is clean', (_rel, file) => {
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(FORBIDDEN)
  })

  it('exposes only the project URL and publishable key via next.config env', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(root, 'next.config.js'))
    expect(Object.keys(cfg.env).sort()).toEqual([
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
    ])
    for (const value of Object.values(cfg.env) as string[]) {
      expect(value).not.toMatch(FORBIDDEN)
    }
  })
})
