import { DatabaseConfiguration } from './config';

export interface RelationalConnectionInfo {
  driver: 'postgres' | 'sqlite';
  url: string;
  isEmbedded: boolean;
  filePath?: string | undefined;
}

export function getRelationalConnectionInfo(
  config: DatabaseConfiguration
): RelationalConnectionInfo {
  return {
    driver: config.relational.driver,
    url: config.relational.activeUrl,
    isEmbedded: config.relational.driver === 'sqlite',
    filePath:
      config.relational.driver === 'sqlite'
        ? config.relational.sqlite.filePath
        : undefined,
  };
}

/**
 * Builds Prisma DataSource configuration object dynamically.
 */
export function buildPrismaDatasource(config: DatabaseConfiguration): {
  provider: 'postgresql' | 'sqlite';
  url: string;
} {
  return {
    provider: config.relational.driver === 'sqlite' ? 'sqlite' : 'postgresql',
    url: config.relational.activeUrl,
  };
}
