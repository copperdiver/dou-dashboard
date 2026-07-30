import type { Locale } from './config'

/**
 * Словари. Русский — источник истины по составу ключей: тип `Dictionary`
 * выводится из него, поэтому пропущенный ключ в английском словаре
 * становится ошибкой компиляции, а не пустой строкой в интерфейсе.
 *
 * Формы числительных задаются объектом с категориями CLDR. Категории
 * выбирает `Intl.PluralRules`: для русского это one/few/many, для
 * английского one/other — перечислять нужно те, что реально существуют
 * в языке словаря.
 */

export type Plural = {
  one: string
  few?: string
  many?: string
  other: string
}

const ru = {
  common: {
    appName: 'DOU Dashboard',
    subtitle: 'Натурализация в Бразилии по публикациям Diário Oficial da União',
    loading: 'Загрузка…',
    refresh: 'Обновить',
    showTable: 'Показать таблицей',
    noData: 'Нет данных',
    total: 'Всего',
    source: 'Источник',
    openOriginal: 'Открыть оригинал',
    language: 'Язык',
    theme: 'Тема',
    unchanged: 'без изменений',
  },
  nav: {
    title: 'Разделы',
    dashboard: 'Сводка',
    approvals: 'Одобрения',
    denials: 'Отказы',
    articles: 'Статьи',
    health: 'Состояние',
    collapse: 'Свернуть',
    expand: 'Развернуть',
  },
  theme: {
    system: 'Как в системе',
    light: 'Светлая',
    dark: 'Тёмная',
  },
  coverage: {
    covered: 'данные загружены',
    noEdition: 'выпуска не было',
    missing: 'день не загружен',
    // Линия идёт через дни без выпуска — публиковать было нечего.
    // А вот незагруженный день отмечается штрихом: там линия проведена
    // условно, и выдавать её за наблюдение нельзя.
    // Показывается всегда: объясняет, почему линия не садится на ось.
    lineNote: 'Линия соединяет дни с публикациями этого вида. Точные значения — в таблице',
    // Только когда такие дни в периоде есть.
    gapNote: 'Штрихом отмечены дни, за которые данные не загружены: линия через них условна',
  },
  kpi: {
    approvals30d: 'Одобрений за 30 дней',
    denials30d: 'Отказов за 30 дней',
    /*
     * Решения по делам об отказах, которые НЕ являются новым отказом:
     * прекращение производства, подтверждение при обжаловании, отмена,
     * повторная публикация. Названо «прочих», потому что новые отказы
     * сюда не входят — иначе счётчик отказов удвоился бы.
     */
    decisions30d: 'Прочих решений',
    decisionsArchived: 'прекращено',
    decisionsUpheld: 'подтверждено',
    decisionsOther: 'прочее',
    denialRate: 'Доля отказов',
    comparedTo: 'к предыдущим 30 дням',
  },
  charts: {
    approvalsOverTime: 'Одобрения по дням',
    denialsOverTime: 'Отказы по дням',
    reasonCategories: 'Категории причин отказа',
    // Подпись обязательна: у отказа бывает несколько причин из разных
    // категорий, поэтому сумма по столбцам не равна числу отказов.
    reasonCategoriesNote: 'отказов, затронутых категорией',
    // Знаменатель долей — только отказы с определённой причиной, иначе
    // нераспознанные тянули бы все проценты вниз.
    reasonCategoriesBase: 'доли считаются от {count} отказов с определённой причиной',
    reasonsUnknown: 'причина не определена ещё у {count}',
    ageDistribution: 'Возраст получивших гражданство',
    ageExcluded: 'без даты рождения в источнике: {count}',
    overTime: 'Одобрения и отказы по дням',
    categoriesOverTime: 'Категории причин во времени',
    openDrilldown: 'Разбивка по времени',
    ofTotal: 'от общего числа',
  },
  range: {
    label: 'Период',
    last7: '7 дней',
    last30: '30 дней',
    last90: '90 дней',
    monthToDate: 'С начала месяца',
    all: 'Весь период',
    custom: 'Произвольный',
    from: 'С',
    to: 'По',
    apply: 'Применить',
  },
  filters: {
    title: 'Фильтры',
    country: 'Страна рождения',
    state: 'Штат проживания',
    category: 'Категория причины',
    nameSearch: 'Поиск по имени',
    namePlaceholder: 'Имя или часть имени',
    all: 'Все',
    apply: 'Применить',
    reset: 'Сбросить',
    activeCount: 'Фильтров: {count}',
  },
  feed: {
    more: 'Следующие',
    empty: 'Ничего не найдено',
    emptyHint: 'Снимите фильтры или расширьте период',
    found: 'Найдено: {count}',
    showUpheld: 'Показывать подтверждения отказа',
    people: 'Людей',
  },
  /*
   * Границы групп заданы в SQL насоса витрин (AGE_BUCKET_SQL) и в enum
   * age_bucket — здесь только подписи. Тире в диапазонах короткое, как
   * положено числовому интервалу.
   */
  ageBuckets: {
    '0-17': '0–17',
    '18-24': '18–24',
    '25-34': '25–34',
    '35-44': '35–44',
    '45-54': '45–54',
    '55-64': '55–64',
    '65+': '65+',
  },
  fields: {
    name: 'Имя',
    country: 'Страна рождения',
    birthDate: 'Дата рождения',
    age: 'Возраст',
    state: 'Штат проживания',
    publishedAt: 'Дата публикации',
    reasons: 'Причины',
    process: 'Процесс',
    naturalizationType: 'Вид натурализации',
  },
  naturalizationType: {
    ordinaria: 'обычная',
    extraordinaria: 'экстраординарная',
    provisoria: 'временная',
    other: 'иная',
  },
  decision: {
    upheld: 'подтверждение отказа',
    upheldNoPrimary: 'подтверждение отказа, первичное решение вне периода наблюдения',
    republication: 'повторная публикация',
    archived: 'производство прекращено',
    void: 'решение отменено',
  },
  reasons: {
    machineTranslated: 'машинный перевод',
    originalPt: 'оригинал (португальский)',
    draft: 'требует проверки',
  },
  /*
   * Раздел «Состояние»: фоновые задачи и их запуски. Названия задач и
   * команды не переводятся и в словаре не лежат — это идентификаторы.
   */
  jobs: {
    runningNow: 'сейчас выполняется: {count}',
    refreshEvery: 'Обновлять каждые {interval}',
    refreshing: 'Обновляю…',

    runs24h: 'Запусков за 24 часа',
    successRate: 'Доля успешных',
    failed24h: 'Ошибок за 24 часа',
    avgDuration: 'Среднее время выполнения',
    comparedTo: 'к предыдущим 24 часам',
    noPreviousDay: 'нет данных за прошлые сутки',
    noRuns: 'запусков не было',
    noFailuresBefore: 'сутки назад ошибок не было',
    noSuccessfulRuns: 'успешных запусков не было',

    dailyTitle: 'Запуски задач по суткам',
    dailyNote: 'Последние {days} · обработано записей за сутки: {items}',
    dailyChartAlt: 'Запуски задач по суткам за {days}. Точные значения — в таблице под графиком.',
    emptyChart: 'Запусков пока нет — поднимите воркер',

    weekTitle: 'Задачи за неделю',
    weekNote: 'Всего запусков в журнале: {count}',
    emptyWeek: 'За последнюю неделю запусков не было.',

    scheduleTitle: 'Расписание',
    scheduleNote: 'Регистрируется воркером при старте',

    recentTitle: 'Последние запуски',
    emptyRecent:
      'Запусков пока нет. Поднимите воркер: npm run worker или сервис worker в docker compose.',

    colJob: 'Задача',
    colRuns: 'Запусков',
    colFailureRate: 'Доля ошибок',
    colAvgTime: 'Среднее время',
    colLastRun: 'Последний запуск',
    colStatus: 'Статус',
    colStartedAt: 'Начало',
    colDuration: 'Длительность',
    colItems: 'Обработано',
    colError: 'Ошибка',
    colDate: 'Дата',
    attempt: 'попытка {n}',
    success: 'Успешно',
    failure: 'С ошибкой',

    statusSuccess: 'успешно',
    statusFailed: 'ошибка',
    statusRunning: 'выполняется',
  },
  /* Экран «база недоступна». Шаги ведут к рабочему окружению. */
  db: {
    unavailable: 'База данных недоступна',
    step1: 'Скопируйте .env.example в .env',
    step2: 'Поднимите зависимости:',
    step3: 'Примените миграции:',
    step4: 'Залейте справочники:',
  },
  plurals: {
    approvals: { one: 'одобрение', few: 'одобрения', many: 'одобрений', other: 'одобрения' },
    denials: { one: 'отказ', few: 'отказа', many: 'отказов', other: 'отказа' },
    people: { one: 'человек', few: 'человека', many: 'человек', other: 'человека' },
    articles: { one: 'статья', few: 'статьи', many: 'статей', other: 'статьи' },
    days: { one: 'день', few: 'дня', many: 'дней', other: 'дня' },
  },
} as const

/** Состав ключей задаёт русский словарь. */
export type Dictionary = typeof ru

/** Тот же состав ключей, но формы числительных — английские. */
type EnglishDictionary = {
  [K in keyof Dictionary]: K extends 'plurals'
    ? Record<keyof Dictionary['plurals'], Plural>
    : Dictionary[K] extends Record<string, string>
      ? Record<keyof Dictionary[K], string>
      : Dictionary[K]
}

const en: EnglishDictionary = {
  common: {
    appName: 'DOU Dashboard',
    subtitle: 'Brazilian naturalisation as published in the Diário Oficial da União',
    loading: 'Loading…',
    refresh: 'Refresh',
    showTable: 'Show as table',
    noData: 'No data',
    total: 'Total',
    source: 'Source',
    openOriginal: 'Open original',
    language: 'Language',
    theme: 'Theme',
    unchanged: 'unchanged',
  },
  nav: {
    title: 'Sections',
    dashboard: 'Overview',
    approvals: 'Approvals',
    denials: 'Denials',
    articles: 'Articles',
    health: 'Health',
    collapse: 'Collapse',
    expand: 'Expand',
  },
  theme: {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  },
  coverage: {
    covered: 'data loaded',
    noEdition: 'no edition published',
    missing: 'day not loaded',
    lineNote: 'The line connects days when decisions of this kind were published. Exact values are in the table',
    gapNote: 'Ticks mark days with no data loaded: the line across them is provisional',
  },
  kpi: {
    approvals30d: 'Approvals, 30 days',
    denials30d: 'Denials, 30 days',
    decisions30d: 'Other decisions',
    decisionsArchived: 'archived',
    decisionsUpheld: 'upheld',
    decisionsOther: 'other',
    denialRate: 'Denial share',
    comparedTo: 'vs previous 30 days',
  },
  charts: {
    approvalsOverTime: 'Approvals per day',
    denialsOverTime: 'Denials per day',
    reasonCategories: 'Denial reason categories',
    reasonCategoriesNote: 'denials touched by this category',
    reasonCategoriesBase: 'shares are of {count} denials with a determined reason',
    reasonsUnknown: 'reason not yet determined for {count} more',
    ageDistribution: 'Age at naturalisation',
    ageExcluded: 'no birth date in the source: {count}',
    overTime: 'Approvals and denials per day',
    categoriesOverTime: 'Reason categories over time',
    openDrilldown: 'Break down over time',
    ofTotal: 'of the total',
  },
  range: {
    label: 'Period',
    last7: '7 days',
    last30: '30 days',
    last90: '90 days',
    monthToDate: 'Month to date',
    all: 'All time',
    custom: 'Custom',
    from: 'From',
    to: 'To',
    apply: 'Apply',
  },
  filters: {
    title: 'Filters',
    country: 'Country of birth',
    state: 'State of residence',
    category: 'Reason category',
    nameSearch: 'Search by name',
    namePlaceholder: 'Name or part of it',
    all: 'All',
    apply: 'Apply',
    reset: 'Reset',
    activeCount: 'Filters: {count}',
  },
  feed: {
    more: 'Next',
    empty: 'Nothing found',
    emptyHint: 'Clear the filters or widen the period',
    found: 'Found: {count}',
    showUpheld: 'Include upheld denials',
    people: 'People',
  },
  ageBuckets: {
    '0-17': '0–17',
    '18-24': '18–24',
    '25-34': '25–34',
    '35-44': '35–44',
    '45-54': '45–54',
    '55-64': '55–64',
    '65+': '65+',
  },
  fields: {
    name: 'Name',
    country: 'Country of birth',
    birthDate: 'Date of birth',
    age: 'Age',
    state: 'State of residence',
    publishedAt: 'Published',
    reasons: 'Reasons',
    process: 'Process',
    naturalizationType: 'Naturalisation type',
  },
  naturalizationType: {
    ordinaria: 'ordinary',
    extraordinaria: 'extraordinary',
    provisoria: 'provisional',
    other: 'other',
  },
  decision: {
    upheld: 'denial upheld',
    upheldNoPrimary: 'denial upheld; the primary decision predates the loaded period',
    republication: 'republication',
    archived: 'case archived',
    void: 'decision voided',
  },
  reasons: {
    machineTranslated: 'machine translation',
    originalPt: 'original (Portuguese)',
    draft: 'needs review',
  },
  jobs: {
    runningNow: 'running now: {count}',
    refreshEvery: 'Refresh every {interval}',
    refreshing: 'Refreshing…',

    runs24h: 'Runs, 24 hours',
    successRate: 'Success rate',
    failed24h: 'Failures, 24 hours',
    avgDuration: 'Average run time',
    comparedTo: 'vs previous 24 hours',
    noPreviousDay: 'no data for the previous day',
    noRuns: 'no runs',
    noFailuresBefore: 'no failures a day earlier',
    noSuccessfulRuns: 'no successful runs',

    dailyTitle: 'Runs per day',
    dailyNote: 'Last {days} · items processed in 24 hours: {items}',
    dailyChartAlt: 'Job runs per day over {days}. Exact values are in the table below the chart.',
    emptyChart: 'No runs yet — start the worker',

    weekTitle: 'Jobs this week',
    weekNote: 'Runs in the log in total: {count}',
    emptyWeek: 'No runs in the past week.',

    scheduleTitle: 'Schedule',
    scheduleNote: 'Registered by the worker on start',

    recentTitle: 'Recent runs',
    emptyRecent:
      'No runs yet. Start the worker: npm run worker, or the worker service in docker compose.',

    colJob: 'Job',
    colRuns: 'Runs',
    colFailureRate: 'Failure rate',
    colAvgTime: 'Average time',
    colLastRun: 'Last run',
    colStatus: 'Status',
    colStartedAt: 'Started',
    colDuration: 'Duration',
    colItems: 'Processed',
    colError: 'Error',
    colDate: 'Date',
    attempt: 'attempt {n}',
    success: 'Succeeded',
    failure: 'Failed',

    statusSuccess: 'succeeded',
    statusFailed: 'failed',
    statusRunning: 'running',
  },
  db: {
    unavailable: 'The database is unavailable',
    step1: 'Copy .env.example to .env',
    step2: 'Start the dependencies:',
    step3: 'Apply the migrations:',
    step4: 'Seed the reference data:',
  },
  plurals: {
    approvals: { one: 'approval', other: 'approvals' },
    denials: { one: 'denial', other: 'denials' },
    people: { one: 'person', other: 'people' },
    articles: { one: 'article', other: 'articles' },
    days: { one: 'day', other: 'days' },
  },
}

const DICTIONARIES: Record<Locale, Dictionary | EnglishDictionary> = { ru, en }

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] as Dictionary
}
