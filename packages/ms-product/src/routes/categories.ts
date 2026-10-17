import type { FastifyInstance } from 'fastify'
import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import type { CategoryDoc } from '../types'
import { CategoryResponse } from '../schemas'

interface CategoryRouteDeps {
  categoriesStore: DocumentDatabaseAdapter<CategoryDoc>
}

// There is no category write endpoint today. When one is added it takes
// `policy: { permission: 'categories:write' }` (ADMIN only, see rbac/roles.ts).
export function registerCategoryRoutes(
  server: FastifyInstance,
  { categoriesStore }: CategoryRouteDeps
): void {
  server.get(
    '/api/v1/categories',
    {
      config: { policy: { public: true }, rateTier: 'read' },
      schema: {
        tags: ['categories'],
        description: 'List product categories.',
        response: { 200: CategoryResponse },
      },
    },
    async () => {
      const categories = await categoriesStore.find({})
      return { categories }
    }
  )
}
