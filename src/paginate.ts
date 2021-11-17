import {
    Repository,
    FindConditions,
    SelectQueryBuilder,
    Like,
    Equal,
    ObjectLiteral,
    Brackets,
    In,
    ILike,
} from 'typeorm'
import { PaginateQuery } from './decorator'

type Column<T> = Extract<keyof T, string>
type Order<T> = [Column<T>, 'ASC' | 'DESC']
type SortBy<T> = Order<T>[]

export class Paginated<T> {
    data: T[]
    meta: {
        itemsPerPage: number
        totalItems: number
        currentPage: number
        totalPages: number
        sortBy: SortBy<T>
        search: string
    }
    links: {
        first?: string
        previous?: string
        current: string
        next?: string
        last?: string
    }
}

export interface PaginateConfig<T> {
    sortableColumns?: Column<T>[]
    searchableColumns?: Column<T>[]
    maxLimit?: number
    defaultSortBy?: SortBy<T>
    defaultLimit?: number
    where?: FindConditions<T>
    queryBuilder?: SelectQueryBuilder<T>
}

export async function paginate<T>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    let page = query.page || 1
    const limit = Math.min(query.limit || config.defaultLimit || 20, config.maxLimit || 100)
    const sortBy = [] as SortBy<T>
    const search = query.search
    const path = query.path

    function isEntityKey(sortableColumns: Column<T>[], column: string): column is Column<T> {
        sortableColumns.map((c) => console.log('TYPE', typeof c))

        return !!sortableColumns.map((c) => c === column)
    }

    // const { sortableColumns } = config
    // if (config.sortableColumns.length < 1) throw new ServiceUnavailableException()

    if (query.sortBy) {
        for (const order of query.sortBy) {
            if (['ASC', 'DESC'].includes(order[1])) {
                sortBy.push(order as Order<T>)
            }
        }
    }

    // if (!sortBy.length) {
    //     sortBy.push(...(config.defaultSortBy || [[sortableColumns[0], 'ASC']]))
    // }

    if (page < 1) page = 1

    let [items, totalItems]: [T[], number] = [[], 0]

    let queryBuilder: SelectQueryBuilder<T>

    if (repo instanceof Repository) {
        queryBuilder = repo
            .createQueryBuilder('e')
            .take(limit)
            .skip((page - 1) * limit)

        for (const order of sortBy) {
            queryBuilder.addOrderBy('e.' + order[0], order[1])
        }
    } else {
        queryBuilder = repo.take(limit).skip((page - 1) * limit)

        for (const order of sortBy) {
            const column = order[0].split('.')
            if (column.length > 1) queryBuilder.addOrderBy(order[0], order[1])
            else queryBuilder.addOrderBy(repo.alias + '.' + order[0], order[1])
        }
    }

    // const where: ObjectLiteral[] = []
    // if (search) {
    //     const searchParam = search.split(",").map(q => q.split(':'))
    //     for (const column of searchParam) {
    //         where.push({ [column[0]]: ILike(`%${column[1]}%`), ...config.where })
    //     }
    // }
    if (config.where) {
        queryBuilder.where(config.where)
    }

    let searchQuery: Brackets
    if (search) {
        console.log(`${Date.now().toLocaleString()} Search: ${search}`)

        const alias = await queryBuilder.alias
        const obj: T = await queryBuilder.getRawOne()

        searchQuery = new Brackets((qb) => {
            const searchParam = search.split(',').map((q) => q.split(':'))
            return searchParam.map(async (op, idx) => {
                if (op.length === 1 || op[1] === '') return
                const paramKey =
                    op[0].split('.').length > 0 ? op[0].replace(/\./g, '_').replace(/\"/g, '') : `${alias}_${op[0]}`
                const searchValue = `%${op[1]}%`
                if (!obj && !obj?.hasOwnProperty(paramKey)) return
                const searchKey = typeof obj[paramKey] === 'number' ? `cast(${op[0]} as text)` : op[0]

                return qb.orWhere(
                    new Brackets((qb) => {
                        // isEntityKey(["code", ], qb[0])

                        return qb.where(`${searchKey} ILike :${paramKey}`, {
                            [paramKey]: searchValue !== '' ? searchValue : '',
                        })
                    })
                )

                // return qb.orWhere(new Brackets((qb) => qb.where(`${paramName} ILike :${paramName}`, parameter)))
            })
        })

        queryBuilder.andWhere(searchQuery)
    }

    let filters: Brackets

    if (query.filter) {
        const { filter } = query
        const alias = await queryBuilder.alias
        filters = new Brackets((qb) => {
            const extractFilter = filter.match(
                /\w+\([a-zA-Z0-9\.\_"]+\,?(\ |)[a-zA-Z0-9áàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ\s\-\%\'\~]*\)*/g
            )

            return extractFilter
                .map((f) => f.match(/([a-zA-Z0-9áàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ\.\"\s\-\_\%'])+/g))
                .map((op) => {
                    const Operation = getOperator(op[0])
                    const value = tryParseBoolean(op[2]) || op[2].trim() || []
                    const filterAlias = op[1].split('.').map((field) => field.replace(/\"/g, '').trim())

                    const filterObj: ObjectLiteral = { [``]: Operation(value) }
                    return qb.andWhere(
                        new Brackets((qb) =>
                            filterAlias.length > 1
                                ? qb.where(`${op[1]} = :${filterAlias[1]}`, { [filterAlias[1]]: value })
                                : qb.where(`${alias}.${op[1]} = :${filterAlias[0]}`, { [filterAlias[0]]: value })
                        )
                    )
                })
        })
        queryBuilder.andWhere(filters)
    }

    //  const queryLog = await queryBuilder.where(where.length ? where : config.where || {}).andWhere(filters).getParameters()

    const hasDistinct = await queryBuilder.getSql().includes('DISTINCT')

    if (!hasDistinct) {
        ;[items, totalItems] = await queryBuilder.getManyAndCount()

    } else {
        items = await queryBuilder.getRawMany()
        totalItems = items.length
    }

    let totalPages = totalItems / limit
    if (totalItems % limit) totalPages = Math.ceil(totalPages)

    const options = `&limit=${limit}${sortBy.map((order) => `&sortBy=${order.join(':')}`).join('')}${
        search ? `&search=${search}` : ''
    } ${query.filter ? `filter=${query.filter}` : ''}`

    const buildLink = (p: number): string => path + '?page=' + p + options

    const results: Paginated<T> = {
        data: items,
        meta: {
            itemsPerPage: limit,
            totalItems,
            currentPage: page,
            totalPages: totalPages,
            sortBy,
            search,
        },
        links: {
            first: page == 1 ? undefined : buildLink(1),
            previous: page - 1 < 1 ? undefined : buildLink(page - 1),
            current: buildLink(page),
            next: page + 1 > totalPages ? undefined : buildLink(page + 1),
            last: page == totalPages ? undefined : buildLink(totalPages),
        },
    }

    return Object.assign(new Paginated<T>(), results)
}

const getOperator = (operator: string) => {
    switch (operator) {
        case 'eq':
            return Equal
        case 'like':
            return Like
        case 'in':
            return In
        default:
            return Equal
    }
}

const tryParseBoolean = (string) => {
    var bool
    bool = (function () {
        switch (false) {
            case string.toLowerCase() !== 'true':
                return true
            case string.toLowerCase() !== 'false':
                return false
        }
    })()
    if (typeof bool === 'boolean') {
        return bool
    }
    return undefined
}
