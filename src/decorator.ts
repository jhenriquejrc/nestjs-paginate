import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'
import { ApiQuery } from '@nestjs/swagger';

export interface PaginateQuery {
    page?: number
    limit?: number
    sortBy?: [string, string][]
    search?: string
    filter?: string
    path: string,
}

export const Paginate = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): PaginateQuery => {
        const request: Request = ctx.switchToHttp().getRequest()
        const { query } = request
        const path = request.protocol + '://' + request.get('host') + request.baseUrl + request.path

        const sortBy: [string, string][] = []
        if (query.sortBy) {
            const params = !Array.isArray(query.sortBy) ? [query.sortBy] : query.sortBy
            for (const param of params as string[]) {
                if (typeof param === 'string') {
                    const items = param.split(':')
                    if (items.length === 2) {
                        sortBy.push(items as [string, string])
                    }
                }
            }
        }


        return {
            page: query.page ? parseInt(query.page.toString(), 10) : undefined,
            limit: query.limit ? parseInt(query.limit.toString(), 10) : undefined,
            sortBy: sortBy.length ? sortBy : undefined,
            search: query.search ? query.search.toString() : undefined,
            filter: query.filter ? query.filter.toString() : undefined,
            path,
        }
    },
    [
        (target: any, key: string) => {
          // Here it is. Use the `@ApiQuery` decorator purely as a function to define the meta only once here.
          ApiQuery({
            name: 'page',
            schema: { default: 0, type: 'number', minimum: 0 },
            required: false
          })(target, key, Object.getOwnPropertyDescriptor(target, key));
          ApiQuery({
            name: 'limit',
            schema: { default: 10, type: 'number', minimum: 10 },
            required: false
          })(target, key, Object.getOwnPropertyDescriptor(target, key));
          ApiQuery({
            name: 'filter',
            example: `eq(field, value), like(field, value)`,
            schema: { type: 'string',},
            required: false
          })
        }
      ]
)
