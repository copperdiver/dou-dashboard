/**
 * Tests for canonizing denial reasons.
 *
 * Text samples come from real despachos. These focus on the spots where
 * the logic has previously produced wrong results: parsing roman-numeral
 * incisos, clause boundaries inside legal references, and phrasing
 * variants the first version of the rules missed.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analyzeReasonText } from '../src/lib/reasons/canonize'
import { extractLegalRefs, formatLegalRefs } from '../src/lib/reasons/legal-refs'
import {
  normalizeWithMap,
  preambleEnd,
  reasonDedupKey,
  segmentClauses,
  toRawSpan,
} from '../src/lib/reasons/normalize'
import { applyRules } from '../src/lib/reasons/rules'

const PREAMBLE =
  'A COORDENADORA DE PROCESSOS MIGRATÓRIOS, no uso da competência delegada pela Portaria nº 623, de 13 de novembro de 2020, publicada no Diário Oficial da União de 17 de novembro de 2020, '

/** Real text: references to incisos plus the same requirements spelled out. */
const FULL_TEXT =
  `${PREAMBLE}indefere o pedido, em razão do descumprimento dos incisos II, III e IV do art. 65 da Lei nº 13.445/2017, ` +
  'dos incisos II, III e IV do art. 234 do Decreto nº 9.199/2017, tendo em vista que o requerente não apresentou ' +
  'comprovante de residência nos termos do art. 56 da Portaria nº 623/2020, documento comprobatório de capacidade ' +
  'de se comunicar em língua portuguesa, certidões de antecedentes criminais da Justiça Estadual e da Justiça Federal'

describe('normalization with offsets', () => {
  it('strips diacritics and case while keeping the mapping back to the source text', () => {
    const raw = 'natural da Colômbia'
    const normalized = normalizeWithMap(raw)

    assert.equal(normalized.text, 'natural da colombia')

    const at = normalized.text.indexOf('colombia')
    const span = toRawSpan(normalized, at, at + 'colombia'.length)
    assert.equal(raw.slice(span.start, span.end), 'Colômbia')
  })

  it('collapses runs of whitespace', () => {
    assert.equal(normalizeWithMap('  a   b \n c ').text, 'a b c')
  })

  it('strips the preamble', () => {
    const normalized = normalizeWithMap(FULL_TEXT)
    const start = preambleEnd(normalized.text)
    assert.ok(start > 100, `preamble not recognized (start=${start})`)
    assert.ok(normalized.text.slice(start).startsWith('indefere o pedido'))
  })

  it('texts with the same meaning produce the same dedup key', () => {
    const a = `${PREAMBLE}indefere o pedido, art. 65 da Lei nº 13.445/2017.`
    const b = `${PREAMBLE}indefere  o pedido, art. 65 da Lei nº 13.445/2019.`
    assert.equal(reasonDedupKey(a).textNorm, reasonDedupKey(b).textNorm)
  })
})

describe('splitting into clauses', () => {
  const clausesOf = (text: string) => {
    const n = normalizeWithMap(text)
    return segmentClauses(n.text, preambleEnd(n.text)).map((c) => c.text)
  }

  it('does not split the text on a period inside an abbreviation', () => {
    // `art. 65` must not become a boundary: the inciso rule
    // relies on the article and number being in the same clause.
    const clauses = clausesOf(`${PREAMBLE}nos termos do art. 65 da Lei nº 13.445/2017 o pedido é indeferido`)
    assert.equal(clauses.length, 1, `split into ${clauses.length}: ${JSON.stringify(clauses)}`)
  })

  it('splits on a semicolon', () => {
    const clauses = clausesOf(
      `${PREAMBLE}nao apresentou comprovante de residencia; nao apresentou antecedentes criminais`,
    )
    assert.equal(clauses.length, 2)
  })
})

describe('legal reference decoder', () => {
  const refsOf = (text: string) => extractLegalRefs(normalizeWithMap(text).text)

  it('a list of incisos is decoded in full, not by the first letter', () => {
    /*
     * Regression: with the alternation `i{1,3}|iv|...`, the `i{1,3}`
     * branch was tried first and matched a single `i` inside `iv`. As a
     * result, "no criminal record certificate" (inciso IV) turned into
     * "minor" (inciso I) in 32% of texts.
     */
    const slugs = refsOf('descumprimento dos incisos II, III e IV do art. 65 da Lei nº 13.445/2017')
      .filter((r) => r.slug !== null)
      .map((r) => r.slug)

    assert.deepEqual(new Set(slugs), new Set(['residence_period', 'portuguese', 'criminal_record']))
    assert.ok(!slugs.includes('minor_capacity'), 'inciso IV parsed as I')
  })

  it('a lone inciso IV means criminal record', () => {
    const refs = refsOf('nao atende ao requisito previsto no inciso IV, art. 65 da Lei nº 13.445/2017')
    assert.deepEqual(
      refs.filter((r) => r.slug).map((r) => r.slug),
      ['criminal_record'],
    )
  })

  it('inciso III is Portuguese language, in any word order', () => {
    for (const text of [
      'Art. 65, inciso III da Lei 13.445/2017',
      'inciso III do art. 65 da Lei 13.445/2017',
    ]) {
      const refs = refsOf(text).filter((r) => r.slug)
      assert.deepEqual(refs.map((r) => r.slug), ['portuguese'], text)
    }
  })

  it('an article without an inciso stays context, not a reason', () => {
    const refs = refsOf('por descumprimento do art. 70 da Lei nº 13.445/2017')
    assert.ok(refs.length > 0)
    assert.ok(
      refs.every((r) => r.slug === null),
      'article without an inciso decoded into a reason',
    )
    assert.deepEqual(formatLegalRefs(refs), ['art.70'])
  })

  it('does not decode incisos for articles with unconfirmed meaning', () => {
    // art. 221 is deliberately absent from the dictionary: the meaning of its
    // incisos isn't confirmed by either the statute text or observation.
    const refs = refsOf('c/c do Parágrafo Único do art. 221 do Decreto 9.199/2017, inciso II')
    assert.ok(refs.filter((r) => r.article === 'art.221').every((r) => r.slug === null))
  })
})

describe('rules', () => {
  const slugsOf = (text: string) => {
    const n = normalizeWithMap(text)
    return new Set(applyRules(n.text, preambleEnd(n.text)).map((m) => m.slug))
  }

  it('catches both comprovante and comprovação de residência', () => {
    // The second form was missed by the first version of the rule.
    assert.ok(slugsOf('nao apresentou comprovante de residência').has('residence_proof'))
    assert.ok(slugsOf('em razão da não apresentação de comprovação de residência').has('residence_proof'))
  })

  it('catches both língua portuguesa and comunicação em português', () => {
    assert.ok(slugsOf('capacidade de se comunicar em língua portuguesa').has('portuguese'))
    assert.ok(slugsOf('não apresentou comprovante de comunicação em português válido').has('portuguese'))
  })

  it('recognizes "does not fit the track"', () => {
    assert.ok(slugsOf('tendo em vista que a requerente não se enquadra nesse modelo').has('wrong_track'))
  })

  it('does not trigger on the preamble', () => {
    assert.equal(slugsOf(PREAMBLE).size, 0)
  })
})

describe('full text parsing', () => {
  it('finds requirements from both references and words, without a false minor_capacity', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    const slugs = new Set(analysis.matches.map((m) => m.slug))

    for (const expected of ['residence_period', 'portuguese', 'criminal_record', 'residence_proof']) {
      assert.ok(slugs.has(expected), `not found: ${expected}`)
    }
    assert.ok(!slugs.has('minor_capacity'), 'false positive on minor_capacity')
  })

  it('legal references are kept as context', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    assert.ok(analysis.legalRefs.includes('art.65:II'))
    assert.ok(analysis.legalRefs.includes('art.234:IV'))
    // An article without an inciso is also kept as context.
    assert.ok(analysis.legalRefs.some((ref) => ref === 'art.56'))
  })

  it('spans point at real fragments of the source text', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    for (const match of analysis.matches) {
      const fragment = FULL_TEXT.slice(match.start, match.end)
      assert.ok(fragment.trim().length > 0, `empty span for ${match.slug}`)
      assert.ok(match.end <= FULL_TEXT.length, `span out of bounds for ${match.slug}`)
    }
  })

  it('covered text leaves no remainder for the LLM', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    assert.ok(analysis.coveredCharRatio > 0, 'coverage ratio is zero')
    assert.equal(analysis.remainder, '', `remainder is not empty: ${analysis.remainder.slice(0, 120)}`)
  })

  it('unrecognized text goes entirely into the remainder', () => {
    const analysis = analyzeReasonText(
      `${PREAMBLE}indefere o pedido por motivo administrativo interno não especificado nesta publicação`,
    )
    assert.deepEqual(analysis.matches, [])
    assert.ok(analysis.remainder.length > 20, 'remainder for the LLM was not assembled')
  })
})

describe('regex resilience', () => {
  it('does not fall into catastrophic backtracking on long text', () => {
    // One Worker handles both parsing and fetching: a ReDoS would freeze
    // the whole pipeline.
    const long = `${PREAMBLE}${'art. 65, incisos II, III e IV da Lei 13.445/2017, '.repeat(200)}`
    const started = Date.now()
    analyzeReasonText(long)
    const elapsed = Date.now() - started
    assert.ok(elapsed < 2000, `parsing took ${elapsed}ms`)
  })
})
