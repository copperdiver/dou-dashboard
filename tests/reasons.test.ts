/**
 * Тесты канонизации причин отказа.
 *
 * Тексты взяты из реальных despachos. Проверяются в первую очередь те
 * места, где логика уже давала неверный результат: разбор римских номеров
 * инцизов, границы клауз внутри правовых ссылок, варианты формулировок,
 * которые первая версия правил не ловила.
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

/** Реальный текст: ссылки на инцизы плюс те же требования словами. */
const FULL_TEXT =
  `${PREAMBLE}indefere o pedido, em razão do descumprimento dos incisos II, III e IV do art. 65 da Lei nº 13.445/2017, ` +
  'dos incisos II, III e IV do art. 234 do Decreto nº 9.199/2017, tendo em vista que o requerente não apresentou ' +
  'comprovante de residência nos termos do art. 56 da Portaria nº 623/2020, documento comprobatório de capacidade ' +
  'de se comunicar em língua portuguesa, certidões de antecedentes criminais da Justiça Estadual e da Justiça Federal'

describe('нормализация со смещениями', () => {
  it('снимает диакритику и регистр, сохраняя отображение в исходный текст', () => {
    const raw = 'natural da Colômbia'
    const normalized = normalizeWithMap(raw)

    assert.equal(normalized.text, 'natural da colombia')

    const at = normalized.text.indexOf('colombia')
    const span = toRawSpan(normalized, at, at + 'colombia'.length)
    assert.equal(raw.slice(span.start, span.end), 'Colômbia')
  })

  it('сжимает пробельные прогоны', () => {
    assert.equal(normalizeWithMap('  a   b \n c ').text, 'a b c')
  })

  it('срезает преамбулу', () => {
    const normalized = normalizeWithMap(FULL_TEXT)
    const start = preambleEnd(normalized.text)
    assert.ok(start > 100, `преамбула не распознана (start=${start})`)
    assert.ok(normalized.text.slice(start).startsWith('indefere o pedido'))
  })

  it('одинаковые по смыслу тексты дают один ключ дедупликации', () => {
    const a = `${PREAMBLE}indefere o pedido, art. 65 da Lei nº 13.445/2017.`
    const b = `${PREAMBLE}indefere  o pedido, art. 65 da Lei nº 13.445/2019.`
    assert.equal(reasonDedupKey(a).textNorm, reasonDedupKey(b).textNorm)
  })
})

describe('разбиение на клаузы', () => {
  const clausesOf = (text: string) => {
    const n = normalizeWithMap(text)
    return segmentClauses(n.text, preambleEnd(n.text)).map((c) => c.text)
  }

  it('не рвёт текст на точке в сокращении', () => {
    // `art. 65` не должно становиться границей: правило про inciso
    // опирается на статью и номер в одной клаузе.
    const clauses = clausesOf(`${PREAMBLE}nos termos do art. 65 da Lei nº 13.445/2017 o pedido é indeferido`)
    assert.equal(clauses.length, 1, `разорвано на ${clauses.length}: ${JSON.stringify(clauses)}`)
  })

  it('режет по точке с запятой', () => {
    const clauses = clausesOf(
      `${PREAMBLE}nao apresentou comprovante de residencia; nao apresentou antecedentes criminais`,
    )
    assert.equal(clauses.length, 2)
  })
})

describe('декодер правовых ссылок', () => {
  const refsOf = (text: string) => extractLegalRefs(normalizeWithMap(text).text)

  it('перечисление инцизов декодируется целиком, а не первой буквой', () => {
    /*
     * Регрессия: при альтернации `i{1,3}|iv|...` вариант `i{1,3}`
     * пробовался первым и на `iv` матчил одну `i`. Из-за этого
     * «нет справок о судимости» (inciso IV) превращалось в
     * «несовершеннолетний» (inciso I) в 32% текстов.
     */
    const slugs = refsOf('descumprimento dos incisos II, III e IV do art. 65 da Lei nº 13.445/2017')
      .filter((r) => r.slug !== null)
      .map((r) => r.slug)

    assert.deepEqual(new Set(slugs), new Set(['residence_period', 'portuguese', 'criminal_record']))
    assert.ok(!slugs.includes('minor_capacity'), 'inciso IV разобран как I')
  })

  it('одиночный inciso IV — это судимости', () => {
    const refs = refsOf('nao atende ao requisito previsto no inciso IV, art. 65 da Lei nº 13.445/2017')
    assert.deepEqual(
      refs.filter((r) => r.slug).map((r) => r.slug),
      ['criminal_record'],
    )
  })

  it('inciso III — португальский язык, в любом порядке слов', () => {
    for (const text of [
      'Art. 65, inciso III da Lei 13.445/2017',
      'inciso III do art. 65 da Lei 13.445/2017',
    ]) {
      const refs = refsOf(text).filter((r) => r.slug)
      assert.deepEqual(refs.map((r) => r.slug), ['portuguese'], text)
    }
  })

  it('статья без инциза остаётся контекстом, а не причиной', () => {
    const refs = refsOf('por descumprimento do art. 70 da Lei nº 13.445/2017')
    assert.ok(refs.length > 0)
    assert.ok(
      refs.every((r) => r.slug === null),
      'статья без инциза декодирована в причину',
    )
    assert.deepEqual(formatLegalRefs(refs), ['art.70'])
  })

  it('не декодирует инцизы статей с неподтверждённым смыслом', () => {
    // art. 221 в словаре отсутствует сознательно — смысл его инцизов
    // не подтверждён ни текстом закона, ни наблюдениями.
    const refs = refsOf('c/c do Parágrafo Único do art. 221 do Decreto 9.199/2017, inciso II')
    assert.ok(refs.filter((r) => r.article === 'art.221').every((r) => r.slug === null))
  })
})

describe('правила', () => {
  const slugsOf = (text: string) => {
    const n = normalizeWithMap(text)
    return new Set(applyRules(n.text, preambleEnd(n.text)).map((m) => m.slug))
  }

  it('ловит и comprovante, и comprovação de residência', () => {
    // Вторая форма терялась первой версией правила.
    assert.ok(slugsOf('nao apresentou comprovante de residência').has('residence_proof'))
    assert.ok(slugsOf('em razão da não apresentação de comprovação de residência').has('residence_proof'))
  })

  it('ловит и língua portuguesa, и comunicação em português', () => {
    assert.ok(slugsOf('capacidade de se comunicar em língua portuguesa').has('portuguese'))
    assert.ok(slugsOf('não apresentou comprovante de comunicação em português válido').has('portuguese'))
  })

  it('распознаёт «не подходит под модальность»', () => {
    assert.ok(slugsOf('tendo em vista que a requerente não se enquadra nesse modelo').has('wrong_track'))
  })

  it('не срабатывает на преамбуле', () => {
    assert.equal(slugsOf(PREAMBLE).size, 0)
  })
})

describe('полный разбор текста', () => {
  it('находит требования и из ссылок, и из слов, без ложного minor_capacity', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    const slugs = new Set(analysis.matches.map((m) => m.slug))

    for (const expected of ['residence_period', 'portuguese', 'criminal_record', 'residence_proof']) {
      assert.ok(slugs.has(expected), `не найдено: ${expected}`)
    }
    assert.ok(!slugs.has('minor_capacity'), 'ложное срабатывание minor_capacity')
  })

  it('правовые ссылки сохраняются как контекст', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    assert.ok(analysis.legalRefs.includes('art.65:II'))
    assert.ok(analysis.legalRefs.includes('art.234:IV'))
    // Статья без инциза тоже в контексте.
    assert.ok(analysis.legalRefs.some((ref) => ref === 'art.56'))
  })

  it('спаны указывают на реальные фрагменты исходного текста', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    for (const match of analysis.matches) {
      const fragment = FULL_TEXT.slice(match.start, match.end)
      assert.ok(fragment.trim().length > 0, `пустой спан для ${match.slug}`)
      assert.ok(match.end <= FULL_TEXT.length, `спан за границей текста для ${match.slug}`)
    }
  })

  it('покрытый текст не оставляет остатка для LLM', () => {
    const analysis = analyzeReasonText(FULL_TEXT)
    assert.ok(analysis.coveredCharRatio > 0, 'доля покрытия нулевая')
    assert.equal(analysis.remainder, '', `остаток не пуст: ${analysis.remainder.slice(0, 120)}`)
  })

  it('непонятный текст целиком уходит в остаток', () => {
    const analysis = analyzeReasonText(
      `${PREAMBLE}indefere o pedido por motivo administrativo interno não especificado nesta publicação`,
    )
    assert.deepEqual(analysis.matches, [])
    assert.ok(analysis.remainder.length > 20, 'остаток для LLM не собран')
  })
})

describe('устойчивость регулярок', () => {
  it('не уходит в катастрофический backtracking на длинном тексте', () => {
    // Один Worker обслуживает и разбор, и загрузку: ReDoS заморозил бы
    // весь конвейер.
    const long = `${PREAMBLE}${'art. 65, incisos II, III e IV da Lei 13.445/2017, '.repeat(200)}`
    const started = Date.now()
    analyzeReasonText(long)
    const elapsed = Date.now() - started
    assert.ok(elapsed < 2000, `разбор занял ${elapsed} мс`)
  })
})
