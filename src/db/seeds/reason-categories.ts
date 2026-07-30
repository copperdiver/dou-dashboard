/**
 * Закрытый список категорий причин отказа.
 *
 * Размер ограничен не предметной областью, а читаемостью графика: на
 * лайн-чарте дрилл-дауна человек различает 6–8 линий, дальше легенда
 * бесполезна. Отсюда ровно 8 категорий, включая «Неясно».
 *
 * colorSlot — слот категориальной палитры (переменные --series-N в
 * globals.css). Закреплён за категорией, чтобы столбец в bar chart и
 * линия в дрилл-дауне были одного цвета, а фильтр, меняющий состав
 * категорий, не перекрашивал выживших.
 */
export type ReasonCategorySeed = {
  code: string
  nameRu: string
  nameEn: string
  colorSlot: number
  sortOrder: number
}

export const REASON_CATEGORY_SEED: readonly ReasonCategorySeed[] = [
  { code: 'language', nameRu: 'Язык', nameEn: 'Language', colorSlot: 1, sortOrder: 1 },
  { code: 'residence', nameRu: 'Проживание', nameEn: 'Residence', colorSlot: 2, sortOrder: 2 },
  {
    code: 'criminal_record',
    nameRu: 'Судимости',
    nameEn: 'Criminal record',
    colorSlot: 3,
    sortOrder: 3,
  },
  { code: 'documents', nameRu: 'Документы', nameEn: 'Documents', colorSlot: 4, sortOrder: 4 },
  { code: 'deadlines', nameRu: 'Сроки', nameEn: 'Deadlines', colorSlot: 5, sortOrder: 5 },
  { code: 'no_show', nameRu: 'Неявка', nameEn: 'No-show', colorSlot: 6, sortOrder: 6 },
  {
    code: 'eligibility',
    nameRu: 'Не подходит под требования',
    nameEn: 'Eligibility',
    colorSlot: 7,
    sortOrder: 7,
  },
  { code: 'unclear', nameRu: 'Неясно', nameEn: 'Unclear', colorSlot: 8, sortOrder: 8 },
] as const

export type ReasonCategoryCode = (typeof REASON_CATEGORY_SEED)[number]['code']
