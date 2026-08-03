/**
 * Tests for the pluggable enrichment provider.
 *
 * No live API calls here: this checks provider selection, the shared
 * response schema, and parsing (i.e. everything that breaks on edits)
 * without needing keys.
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

describe('provider selection', () => {
  it('noop is selected explicitly', () => {
    setEnv({ LLM_PROVIDER: 'noop', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' })
    assert.equal(createEnricher().name, 'noop')
  })

  it('auto without keys does not throw, falls back to the stub', () => {
    // Fetching and parsing don't depend on the LLM: unconfigured enrichment
    // must not stop the pipeline.
    setEnv({ LLM_PROVIDER: 'auto' })
    assert.equal(createEnricher().name, 'noop')
  })

  it('an empty string in the env var is NOT a set key', () => {
    // docker compose substitutes an empty string for `${FOO:-}`, and without
    // an explicit check it would be treated as a set key.
    setEnv({ LLM_PROVIDER: 'auto', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '  ' })
    assert.equal(createEnricher().name, 'noop')
  })

  it('an empty string in the model name does not reach the API', () => {
    setEnv({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'y' })
    process.env.LLM_MODEL_OPENAI = ''
    try {
      assert.ok(createEnricher().model.length > 0, 'model name is empty')
    } finally {
      delete process.env.LLM_MODEL_OPENAI
    }
  })

  it('auto with only the OpenAI key picks openai', () => {
    setEnv({ LLM_PROVIDER: 'auto', OPENAI_API_KEY: 'y' })
    assert.equal(createEnricher().name, 'openai')
  })

  it('auto with both keys prefers claude', () => {
    setEnv({ LLM_PROVIDER: 'auto', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' })
    assert.equal(createEnricher().name, 'claude')
  })

  it('an explicit provider without a key is a config error, not a silent stub', () => {
    setEnv({ LLM_PROVIDER: 'openai' })
    assert.throws(() => createEnricher(), /OPENAI_API_KEY/)

    setEnv({ LLM_PROVIDER: 'claude' })
    assert.throws(() => createEnricher(), /ANTHROPIC_API_KEY/)
  })

  it('an unknown value reports the allowed ones', () => {
    setEnv({ LLM_PROVIDER: 'gemini' })
    assert.throws(() => createEnricher(), /auto, claude, openai, noop/)
  })
})

describe('stub', () => {
  it('does not invent translations and requires manual review', async () => {
    const result = await new NoopEnricher().enrich({
      remainder: 'o requerente excedeu o limite permitido',
      known: KNOWN,
      categories: CATEGORIES,
    })

    assert.equal(result.needsReview, true)
    assert.equal(result.newReasons.length, 1)
    // A fake translation in the UI looks just as authoritative as a real one.
    assert.equal(result.newReasons[0]?.textEn, '')
    assert.equal(result.newReasons[0]?.textRu, '')
    assert.equal(result.newReasons[0]?.categoryCode, 'unclear')
  })

  it('creates nothing on an empty remainder', async () => {
    const result = await new NoopEnricher().enrich({
      remainder: '   ',
      known: KNOWN,
      categories: CATEGORIES,
    })
    assert.deepEqual(result.newReasons, [])
    assert.equal(result.needsReview, false)
  })
})

describe('shared prompt', () => {
  it('the stable prefix contains the reference lists', () => {
    const prefix = buildStablePrefix({ remainder: 'x', known: KNOWN, categories: CATEGORIES })
    assert.ok(prefix.includes('portuguese'))
    assert.ok(prefix.includes('language: Language'))
  })

  it('the schema works for OpenAI strict mode', () => {
    /*
     * OpenAI strict mode rejects a schema unless every property is
     * listed in required and additionalProperties: false is set.
     * Anthropic is more lenient, so without this check a schema edit
     * could silently break only one of the two providers.
     */
    const schema = buildSchema(['language', 'unclear'], ['portuguese'])

    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return
      const obj = node as Record<string, unknown>

      if (obj.type === 'object') {
        assert.equal(obj.additionalProperties, false, `${path}: additionalProperties is not false`)
        const properties = Object.keys((obj.properties ?? {}) as Record<string, unknown>)
        const required = (obj.required ?? []) as string[]
        assert.deepEqual(
          [...properties].sort(),
          [...required].sort(),
          `${path}: required does not match the property list`,
        )
      }

      for (const [key, value] of Object.entries(obj)) walk(value, `${path}.${key}`)
    }

    walk(schema, 'schema')
  })
})

describe('response parsing', () => {
  const parse = (text: string) => parseEnrichPayload(text, ['language', 'unclear'], ['portuguese'])

  it('accepts a valid response', () => {
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

  it('drops unknown slugs and categories', () => {
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

  it('an unusable response yields null, not an empty result', () => {
    // Distinguishing "the model found nothing" from "the response is broken" matters:
    // in the second case the text must go to manual review.
    assert.equal(parse('это не json'), null)
    assert.equal(parse(''), null)
    assert.equal(parse('[]'), null)
  })

  it('empty lists are a legitimate "no reasons" result', () => {
    const parsed = parse(JSON.stringify({ matched_slugs: [], new_reasons: [] }))
    assert.deepEqual(parsed, { matchedSlugs: [], newReasons: [] })
  })
})
