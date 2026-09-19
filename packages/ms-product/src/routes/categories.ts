import type { FastifyInstance } from 'fastify'
import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import type { CategoryDoc } from '../types'

interface CategoryRouteDeps {
  categoriesStore: DocumentDatabaseAdapter<CategoryDoc>
}

export function registerCategoryRoutes(
  server: FastifyInstance,
  { categoriesStore }: CategoryRouteDeps
): void {
  server.get(
    '/api/v1/categories',
    {
      schema: {
        tags: ['categories'],
        description: 'List product categories.',
        response: {
          200: {
            type: 'object',
            properties: {
              categories: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    icon: { type: 'string' },
                    description: { type: 'string' },
                    productCount: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const categories = await categoriesStore.find({})
      return { categories }
    }
  )
}
