/**
 * Тесты сменного провайдера обогащения.
 *
 * Живых вызовов к API здесь нет: проверяются выбор провайдера, общая
 * схема ответа и разбор — то есть всё, что ломается при правках и не
 * требует ключей.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createEnricher } from '../src/lib/llm'
import { NoopEnricher } from '../src/lib/llm/noop'
import { buildSchema, buildStablePrefix, parseEnrichPayload } from '../src/lib/llm/prompt'

const KEYS = ['LLM_PROVIDER', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const
const saved = new Map(KEYS.map((key) => [key, process.env[key]]))

function setEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>): void {
  for (const key of KEYS) {
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const CATEGORIES = [
  { code: 'language', nameEn: 'Language' },
  { code: 'unclear', nameEn: 'Unclear' },
]
const KNOWN = [{ slug: 'portuguese', textPt: 'Não comprovou português', categoryCode: 'language' }]

describe('выбор провайдера', () => {
  it('noop выбирается явно', () => {
    setEnv({ LLM_PROVIDER: 'noop', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' })
    assert.equal(createEnricher().name, 'noop')
  })

  it('auto без ключей не падает, а берёт заглушку', () => {
    // Загрузка и разбор от LLM не зависят: ненастроенное обогащение
    // не должно останавливать конвейер.
    setEnv({ LLM_PROVIDER: 'auto' })
    assert.equal(createEnricher().name, 'noop')
  })

  it('пустая строка в переменной — это НЕ заданный ключ', () => {
    // docker compose для `${FOO:-}` подставляет пустую строку, и без
    // явной проверки она считалась бы заданным ключом.
    setEnv({ LLM_PROVIDER: 'auto', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '  ' })
    assert.equal(createEnricher().name, 'noop')
  })

  it('пустая строка в имени модели не уходит в API', () => {
    setEnv({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'y' })
    process.env.LLM_MODEL_OPENAI = ''
    try {
      assert.ok(createEnricher().model.length > 0, 'имя модели пустое')
    } finally {
      delete process.env.LLM_MODEL_OPENAI
    }
  })

  it('auto с одним только ключом OpenAI берёт openai', () => {
    setEnv({ LLM_PROVIDER: 'auto', OPENAI_API_KEY: 'y' })
    assert.equal(createEnricher().name, 'openai')
  })

  it('auto с двумя ключами предпочитает claude', () => {
    setEnv({ LLM_PROVIDER: 'auto', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' })
    assert.equal(createEnricher().name, 'claude')
  })

  it('явный провайдер без ключа — ошибка конфигурации, а не тихая заглушка', () => {
    setEnv({ LLM_PROVIDER: 'openai' })
    assert.throws(() => createEnricher(), /OPENAI_API_KEY/)

    setEnv({ LLM_PROVIDER: 'claude' })
    assert.throws(() => createEnricher(), /ANTHROPIC_API_KEY/)
  })

  it('неизвестное значение сообщает допустимые', () => {
    setEnv({ LLM_PROVIDER: 'gemini' })
    assert.throws(() => createEnricher(), /auto, claude, openai, noop/)
  })
})

describe('заглушка', () => {
  it('не придумывает переводов и требует ручной проверки', async () => {
    const result = await new NoopEnricher().enrich({
      remainder: 'o requerente excedeu o limite permitido',
      known: KNOWN,
      categories: CATEGORIES,
    })

    assert.equal(result.needsReview, true)
    assert.equal(result.newReasons.length, 1)
    // Поддельный перевод в UI выглядит так же авторитетно, как настоящий.
    assert.equal(result.newReasons[0]?.textEn, '')
    assert.equal(result.newReasons[0]?.textRu, '')
    assert.equal(result.newReasons[0]?.categoryCode, 'unclear')
  })

  it('на пустом остатке ничего не создаёт', async () => {
    const result = await new NoopEnricher().enrich({
      remainder: '   ',
      known: KNOWN,
      categories: CATEGORIES,
    })
    assert.deepEqual(result.newReasons, [])
    assert.equal(result.needsReview, false)
  })
})

describe('общий промпт', () => {
  it('стабильный префикс содержит справочники', () => {
    const prefix = buildStablePrefix({ remainder: 'x', known: KNOWN, categories: CATEGORIES })
    assert.ok(prefix.includes('portuguese'))
    assert.ok(prefix.includes('language: Language'))
  })

  it('схема пригодна для строгого режима OpenAI', () => {
    /*
     * Строгий режим OpenAI отвергает схему, у которой не все свойства
     * перечислены в required или не выставлен additionalProperties: false.
     * Anthropic мягче, поэтому без этой проверки правка схемы сломала бы
     * только один из двух провайдеров — и незаметно.
     */
    const schema = buildSchema(['language', 'unclear'], ['portuguese'])

    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return
      const obj = node as Record<string, unknown>

      if (obj.type === 'object') {
        assert.equal(obj.additionalProperties, false, `${path}: additionalProperties не false`)
        const properties = Object.keys((obj.properties ?? {}) as Record<string, unknown>)
        const required = (obj.required ?? []) as string[]
        assert.deepEqual(
          [...properties].sort(),
          [...required].sort(),
          `${path}: required не совпадает со списком свойств`,
        )
      }

      for (const [key, value] of Object.entries(obj)) walk(value, `${path}.${key}`)
    }

    walk(schema, 'schema')
  })
})

describe('разбор ответа', () => {
  const parse = (text: string) => parseEnrichPayload(text, ['language', 'unclear'], ['portuguese'])

  it('принимает корректный ответ', () => {
    const parsed = parse(
      JSON.stringify({
        matched_slugs: ['portuguese'],
        new_reasons: [
          { text_pt: 'Excedeu o limite permitido', text_en: 'Exceeded', text_ru: 'Превысил', category_code: 'unclear' },
        ],
      }),
    )

    assert.deepEqual(parsed?.matchedSlugs, ['portuguese'])
    assert.equal(parsed?.newReasons.length, 1)
  })

  it('отбрасывает неизвестные slug и категории', () => {
    const parsed = parse(
      JSON.stringify({
        matched_slugs: ['portuguese', 'invented_slug'],
        new_reasons: [
          { text_pt: 'Motivo qualquer', text_en: '', text_ru: '', category_code: 'invented' },
        ],
      }),
    )

    assert.deepEqual(parsed?.matchedSlugs, ['portuguese'])
    assert.deepEqual(parsed?.newReasons, [])
  })

  it('непригодный ответ даёт null, а не пустой результат', () => {
    // Отличать «модель ничего не нашла» от «ответ сломан» обязательно:
    // во втором случае текст должен уйти на ручную проверку.
    assert.equal(parse('это не json'), null)
    assert.equal(parse(''), null)
    assert.equal(parse('[]'), null)
  })

  it('пустые списки — это законный результат «мотивов нет»', () => {
    const parsed = parse(JSON.stringify({ matched_slugs: [], new_reasons: [] }))
    assert.deepEqual(parsed, { matchedSlugs: [], newReasons: [] })
  })
})
