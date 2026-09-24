import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { setEnvValue, setKafkaEnabledInEnv, KafkaEnvWriteError } from '../envToggle'

/**
 * The `.env` this writes to carries ~240 lines of commented configuration that
 * every service reads at boot. A writer that reorders keys, drops comments or
 * rewrites line endings would turn a one-key admin toggle into a whole-file
 * diff — and a torn write would break the next boot of all six services. These
 * tests pin the surgical behaviour, not just the happy path.
 */
describe('setEnvValue', () => {
  it('replaces only the target assignment and leaves every other byte alone', () => {
    const before = [
      '# ── Event backbone (Kafka / Redpanda) ───────────────',
      '# OPTIONAL and OFF by default.',
      'KAFKA_ENABLED=false',
      'KAFKA_BROKERS=localhost:9100',
      'LOKI_ENABLED=true',
    ].join('\n')

    const after = setEnvValue(before, 'KAFKA_ENABLED', 'true')

    expect(after).toBe(
      [
        '# ── Event backbone (Kafka / Redpanda) ───────────────',
        '# OPTIONAL and OFF by default.',
        'KAFKA_ENABLED=true',
        'KAFKA_BROKERS=localhost:9100',
        'LOKI_ENABLED=true',
      ].join('\n')
    )
  })

  it('does not treat a commented example as the live assignment', () => {
    // A commented `# KAFKA_ENABLED=true` above the real line is exactly how
    // this repo's .env documents its options. Editing the comment would leave
    // the real flag untouched while reporting success.
    const before = ['# KAFKA_ENABLED=true', 'KAFKA_ENABLED=false'].join('\n')

    const after = setEnvValue(before, 'KAFKA_ENABLED', 'true')

    expect(after).toBe(['# KAFKA_ENABLED=true', 'KAFKA_ENABLED=true'].join('\n'))
  })

  it('preserves CRLF line endings', () => {
    // On Windows this file is very often CRLF. Normalising to LF would show
    // all ~240 lines as changed in git for a one-key edit.
    const before = 'A=1\r\nKAFKA_ENABLED=false\r\nB=2\r\n'

    const after = setEnvValue(before, 'KAFKA_ENABLED', 'true')

    expect(after).toBe('A=1\r\nKAFKA_ENABLED=true\r\nB=2\r\n')
  })

  it('appends the key when no live assignment exists', () => {
    // A .env missing the key is valid — the code defaults it to false. Doing
    // nothing here would report success while changing nothing.
    const before = 'A=1\nB=2\n'

    const after = setEnvValue(before, 'KAFKA_ENABLED', 'true')

    expect(after).toBe('A=1\nB=2\nKAFKA_ENABLED=true\n')
  })

  it('appends a newline first when the file does not end with one', () => {
    const after = setEnvValue('A=1', 'KAFKA_ENABLED', 'true')

    expect(after).toBe('A=1\nKAFKA_ENABLED=true\n')
  })

  it('replaces only the first live assignment when the key is duplicated', () => {
    // dotenv takes the first occurrence, so that is the one that decides
    // behaviour and the one that must be edited.
    const before = 'KAFKA_ENABLED=false\nKAFKA_ENABLED=false\n'

    const after = setEnvValue(before, 'KAFKA_ENABLED', 'true')

    expect(after).toBe('KAFKA_ENABLED=true\nKAFKA_ENABLED=false\n')
  })

  it('handles an `export`-prefixed assignment without losing the prefix', () => {
    const after = setEnvValue('export KAFKA_ENABLED=false\n', 'KAFKA_ENABLED', 'true')

    expect(after).toBe('export KAFKA_ENABLED=true\n')
  })

  it('does not match a key that merely shares a prefix', () => {
    const before = 'KAFKA_ENABLED_EXTRA=false\nKAFKA_ENABLED=false\n'

    const after = setEnvValue(before, 'KAFKA_ENABLED', 'true')

    expect(after).toBe('KAFKA_ENABLED_EXTRA=false\nKAFKA_ENABLED=true\n')
  })
})

describe('setKafkaEnabledInEnv', () => {
  let dir: string
  let envPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafka-env-'))
    envPath = path.join(dir, '.env')
    fs.writeFileSync(envPath, 'A=1\nKAFKA_ENABLED=false\nB=2\n', 'utf8')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('persists the flag and reports restartRequired when it differs from runtime', () => {
    const result = setKafkaEnabledInEnv(envPath, true, false)

    expect(fs.readFileSync(envPath, 'utf8')).toBe('A=1\nKAFKA_ENABLED=true\nB=2\n')
    expect(result.enabled).toBe(true)
    // The running process built no client; the write cannot have changed that.
    expect(result.runtimeEnabled).toBe(false)
    expect(result.restartRequired).toBe(true)
    expect(result.envPath).toBe(envPath)
  })

  it('reports restartRequired false when the persisted value already matches runtime', () => {
    const result = setKafkaEnabledInEnv(envPath, true, true)

    expect(result.restartRequired).toBe(false)
  })

  it('never claims the running process picked the change up', () => {
    // The core invariant: `enabled` is what is on disk, `runtimeEnabled` is
    // what the process is running. Collapsing them would let the UI show a
    // green "online" chip for a backbone that does not exist.
    const result = setKafkaEnabledInEnv(envPath, true, false)

    expect(result.enabled).not.toBe(result.runtimeEnabled)
  })

  it('throws KafkaEnvWriteError for a missing .env rather than creating one', () => {
    // Creating a fresh two-line .env would leave every other service
    // misconfigured on the next boot.
    const missing = path.join(dir, 'does-not-exist', '.env')

    expect(() => setKafkaEnabledInEnv(missing, true, false)).toThrow(KafkaEnvWriteError)
    expect(fs.existsSync(missing)).toBe(false)
  })

  it('leaves no temp file behind after a successful write', () => {
    setKafkaEnabledInEnv(envPath, true, false)

    expect(fs.readdirSync(dir)).toEqual(['.env'])
  })
})
