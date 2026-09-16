export type DatabaseMode = 'server' | 'embedded'
export type RelationalDriver = 'postgres' | 'sqlite'
export type DocumentDriver = 'mongodb' | 'nedb'
export type KeyValueDriver = 'redis' | 'rocksdb' | 'embedded'

export interface DatabaseConfiguration {
  mode: DatabaseMode
  relational: {
    driver: RelationalDriver
    postgres: {
      host: string
      port: number
      username: string
      password?: string | undefined
      database: string
      url: string
    }
    sqlite: {
      filePath: string
      url: string
    }
    activeUrl: string
  }
  document: {
    driver: DocumentDriver
    mongodb: {
      uri: string
    }
    nedb: {
      dataPath: string
      inMemory: boolean
    }
  }
  keyValue: {
    driver: KeyValueDriver
    redis: {
      host: string
      port: number
      password?: string | undefined
      db: number
    }
    rocksdb: {
      dataPath: string
    }
    embedded: {
      inMemory: boolean
    }
  }
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfiguration {
  const mode: DatabaseMode = env.DB_MODE?.toLowerCase() === 'embedded' ? 'embedded' : 'server'

  const relationalDriver: RelationalDriver =
    (env.RELATIONAL_DB_DRIVER?.toLowerCase() as RelationalDriver) ??
    (mode === 'embedded' ? 'sqlite' : 'postgres')

  const docDriver: DocumentDriver =
    (env.DOCUMENT_DB_DRIVER?.toLowerCase() as DocumentDriver) ??
    (mode === 'embedded' ? 'nedb' : 'mongodb')

  const kvDriver: KeyValueDriver =
    (env.KV_CACHE_DRIVER?.toLowerCase() as KeyValueDriver) ??
    (mode === 'embedded' ? 'rocksdb' : 'redis')

  const pgHost = env.DB_HOST ?? 'localhost'
  const pgPort = parseInt(env.DB_PORT ?? '5432', 10)
  const pgUser = env.DB_USERNAME ?? 'postgres'
  const pgPass = env.DB_PASSWORD ?? 'password'
  const pgDb = env.DB_DATABASE ?? 'ecommerce'
  const pgUrl =
    env.DATABASE_URL ?? `postgresql://${pgUser}:${pgPass}@${pgHost}:${pgPort}/${pgDb}?schema=public`

  const sqlitePath = env.SQLITE_DB_PATH ?? './data/ecommerce.db'
  const sqliteUrl = `file:${sqlitePath}`

  return {
    mode,
    relational: {
      driver: relationalDriver,
      postgres: {
        host: pgHost,
        port: pgPort,
        username: pgUser,
        password: pgPass,
        database: pgDb,
        url: pgUrl,
      },
      sqlite: {
        filePath: sqlitePath,
        url: sqliteUrl,
      },
      activeUrl: relationalDriver === 'sqlite' ? sqliteUrl : pgUrl,
    },
    document: {
      driver: docDriver,
      mongodb: {
        uri: env.MONGODB_URI ?? 'mongodb://localhost:27017/ecommerce_sessions',
      },
      nedb: {
        dataPath: env.NEDB_DATA_PATH ?? './data/nedb',
        inMemory: env.NEDB_IN_MEMORY === 'true',
      },
    },
    keyValue: {
      driver: kvDriver,
      redis: {
        host: env.REDIS_HOST ?? 'localhost',
        port: parseInt(env.REDIS_PORT ?? '6379', 10),
        password: env.REDIS_PASSWORD ?? undefined,
        db: parseInt(env.REDIS_DB ?? '0', 10),
      },
      rocksdb: {
        dataPath: env.ROCKSDB_DATA_PATH ?? './data/rocksdb',
      },
      embedded: {
        inMemory: env.EMBEDDED_KV_IN_MEMORY !== 'false',
      },
    },
  }
}
