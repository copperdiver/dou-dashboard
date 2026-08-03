/**
 * Parser tests against real DOU pages.
 *
 *   npm test
 *
 * Uses Node's built-in test runner: no extra dependencies.
 * Fixtures are refreshed via scripts/save-fixtures.ts.
 *
 * These cover the exact cases the parser has broken on before: a name
 * change masquerading as an approval; the `Interessada`/`Interessado(a)`
 * labels; `Processo nº:` with "nº" before the colon; a check ordering
 * that let "tornar sem efeito" be counted as an upheld denial.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { splitActs } from '../src/lib/dou/acts'
import { extractApprovals } from '../src/lib/dou/approvals'
import { classifyAssunto, extractDenials } from '../src/lib/dou/denials'
import { extractBlocks } from '../src/lib/dou/page'
import { ageOn, normalizeProcessNumber } from '../src/lib/text'

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/dou/${name}.html`, import.meta.url)), 'utf8')
}

function actsOf(name: string) {
  return splitActs(extractBlocks(fixture(name)))
}

describe('one page, multiple acts', () => {
  it('splits a portaria into four acts with different grounds', () => {
    const acts = actsOf('approvals-four-acts')
    assert.equal(acts.length, 4)
    assert.deepEqual(
      acts.map((a) => a.kind),
      ['approval', 'approval', 'approval', 'approval'],
    )
    assert.deepEqual(
      acts.map((a) => a.naturalizationType),
      ['ordinaria', 'ordinaria', 'extraordinaria', 'provisoria'],
    )
  })

  it('extracts everyone and does not lose a single paragraph', () => {
    const acts = actsOf('approvals-four-acts')
    const counts: number[] = []
    for (const act of acts) {
      const { people, unparsed } = extractApprovals(act.paragraphs)
      assert.deepEqual(unparsed, [], `unparsed paragraphs in act #${act.ordinal}`)
      counts.push(people.length)
    }
    assert.deepEqual(counts, [1, 10, 5, 4])
  })

  it('parses the fields of a person line', () => {
    const [first] = actsOf('approvals-four-acts')
    const { people } = extractApprovals(first!.paragraphs)
    const person = people[0]!

    assert.equal(person.fullName, 'NABIL DALANK ZELFO')
    assert.equal(person.countryRaw, 'Colômbia')
    assert.equal(person.birthDate, '1979-10-07')
    assert.equal(person.stateRaw, 'Paraná')
    assert.equal(person.processNumberNorm, '235881.0423562/2023')
    assert.ok(person.documentId?.includes('F009513'))
  })
})

describe('edge-case phrasings of a person line', () => {
  const line = (body: string) => extractApprovals([body])

  it('tolerates a typo in the preposition before the country', () => {
    // `doa` instead of `dos`: a real typo from the source.
    const { people, unparsed } = line(
      'GREGORY EDWARD BOAN - F509489-1, natural doa Estados Unidos, nascido em 8 de maio de 1988, filho de EDWARD BOAN e de ANA MARIA OSLE, residente no Estado do Rio de Janeiro (Processo nº 235881.0111111/2025).',
    )
    assert.deepEqual(unparsed, [])
    assert.equal(people[0]?.countryRaw, 'Estados Unidos')
    assert.equal(people[0]?.stateRaw, 'Rio de Janeiro')
  })

  it('does not pull the birth date into the country name when there is no comma', () => {
    // `natural de Cuba nascida em agosto de 1977`: without a boundary at `nascid`
    // the country used to capture "Cuba nascida em agosto de 1977".
    const { people } = line(
      'MARIA PEREZ - V111111-1, natural de Cuba nascida em agosto de 1977, filha de X e de Y, residente no estado de São Paulo (Processo nº 235881.0222222/2025).',
    )
    assert.equal(people[0]?.countryRaw, 'Cuba')
    // A date without a day number isn't parsed: that's an expected skip, not a bug.
    assert.equal(people[0]?.birthDate, null)
  })

  it('does not pull the document number into the name when it is written as RNM', () => {
    const { people } = line(
      'NABIL DALANK ZELFO - RNM F009513-S, natural da Colômbia, nascido(a) em 7 de outubro de 1979, filho(a) de Samir e de Nohal, residente no Estado do Paraná (Processo nº 235881.0333333/2023).',
    )
    assert.equal(people[0]?.fullName, 'NABIL DALANK ZELFO')
    assert.equal(people[0]?.documentId, 'F009513-S')
  })

  it('finds the state without the word "estado"', () => {
    const { people } = line(
      'BENITHO LOUIS - V793903-0, natural do Haiti, nascido em 30 de setembro de 1983, filho de X e de Y, residente no Distrito Federal (Processo nº 235881.0444444/2026).',
    )
    assert.equal(people[0]?.stateRaw, 'Distrito Federal')
  })
})

describe('a name change does not count as an approval', () => {
  it('the act is classified as name_change', () => {
    const acts = actsOf('name-change')
    assert.ok(
      acts.every((a) => a.kind !== 'approval'),
      'name-change act mistaken for an approval',
    )
    assert.ok(acts.some((a) => a.kind === 'name_change'))
  })

  it('a CERTIFICO paragraph yields no people even under direct parsing', () => {
    for (const act of actsOf('name-change')) {
      const { people } = extractApprovals(act.paragraphs)
      assert.deepEqual(people, [], 'a person was extracted from a name change')
    }
  })
})

describe('denial blocks', () => {
  it('extracts every block from the denial list', () => {
    const [act] = actsOf('denials-list')
    assert.equal(act!.kind, 'denial_list')

    const { denials, unparsed } = extractDenials(act!.paragraphs)
    assert.deepEqual(unparsed, [])
    assert.equal(denials.length, 28)

    assert.ok(
      denials.every((d) => d.fullName.length > 0 && d.reasonText !== null),
      'there is a block missing a name or a reason text',
    )
    assert.ok(denials.every((d) => d.processNumberNorm !== null), 'there is a block missing a process number')
  })

  it('an upheld denial is flagged, not counted as a new denial', () => {
    const [act] = actsOf('denial-upheld')
    const { denials } = extractDenials(act!.paragraphs)

    assert.equal(denials.length, 1)
    assert.equal(denials[0]!.decisionKind, 'denial')
    assert.equal(denials[0]!.isUpheld, true)
    // A trailing period on the name in the source must not end up in the data.
    assert.equal(denials[0]!.fullName, 'LOUTFIA CHARIF SAID ALI')
  })

  it('discontinuing another procedure: archived and not naturalization', () => {
    const acts = actsOf('archived-other-procedure')
    const denials = acts.flatMap((a) => extractDenials(a.paragraphs).denials)

    assert.ok(denials.length >= 2, `expected at least two blocks, got ${denials.length}`)
    assert.ok(
      denials.every((d) => d.decisionKind === 'archived'),
      'case closure mistaken for a denial',
    )
    assert.ok(
      denials.every((d) => d.subjectKind === 'other'),
      'recognition of equal rights mistaken for naturalization',
    )
    assert.ok(denials.every((d) => d.fullName.length > 0), 'block without a name: label not recognized')
  })
})

describe('Assunto classification', () => {
  const cases: [string, { decisionKind: string; isUpheld: boolean }][] = [
    ['Indeferimento do pedido', { decisionKind: 'denial', isUpheld: false }],
    ['Indeferimento do pedido.', { decisionKind: 'denial', isUpheld: false }],
    ['Manutenção de Indeferimento do pedido', { decisionKind: 'denial', isUpheld: true }],
    ['MANUTENÇÃO DO INDEFERIMENTO', { decisionKind: 'denial', isUpheld: true }],
    ['Manutenção de indeferimento do pedido', { decisionKind: 'denial', isUpheld: true }],
    ['Deferimento do pedido', { decisionKind: 'approval', isUpheld: false }],
    ['Arquivamento do pedido', { decisionKind: 'archived', isUpheld: false }],
    // A reversal, not an upheld denial: "manutenção" inside the string
    // must not override "sem efeito".
    ['Tornar sem efeito o Recurso de Manutenção de Indeferimento', {
      decisionKind: 'void',
      isUpheld: false,
    }],
  ]

  for (const [assunto, expected] of cases) {
    it(`«${assunto}» → ${expected.decisionKind}${expected.isUpheld ? '/upheld' : ''}`, () => {
      const actual = classifyAssunto(assunto)
      assert.equal(actual.decisionKind, expected.decisionKind)
      assert.equal(actual.isUpheld, expected.isUpheld)
    })
  }

  it('an expulsion reversal is not counted as naturalization', () => {
    const actual = classifyAssunto('INDEFERIMENTO DE PEDIDO DE REVOGAÇÃO DE EXPULSÃO')
    assert.equal(actual.subjectKind, 'expulsion')
  })
})

describe('process number normalization', () => {
  it('understands both formats and prefixes', () => {
    assert.equal(normalizeProcessNumber('235881.0744976/2026'), '235881.0744976/2026')
    assert.equal(normalizeProcessNumber('Processo nº 235881.0744976/2026.'), '235881.0744976/2026')
    assert.equal(
      normalizeProcessNumber('Naturalizar-se nº 235881.0744976/2026'),
      '235881.0744976/2026',
    )
    assert.equal(normalizeProcessNumber('08084.003330/2026-23'), '08084.003330/2026-23')
    assert.equal(normalizeProcessNumber('без номера'), null)
    assert.equal(normalizeProcessNumber(null), null)
  })
})

describe('age as of the publication date', () => {
  it('counts full years and accounts for whether the birthday has passed', () => {
    assert.equal(ageOn('1979-10-07', '2026-07-29'), 46)
    assert.equal(ageOn('1979-07-29', '2026-07-29'), 47)
    assert.equal(ageOn('1979-07-30', '2026-07-29'), 46)
    assert.equal(ageOn('2026-07-29', '2026-07-29'), 0)
  })

  it('rejects impossible values', () => {
    assert.equal(ageOn('2030-01-01', '2026-07-29'), null)
    assert.equal(ageOn('не дата', '2026-07-29'), null)
  })
})

describe('regex resilience', () => {
  it('does not fall into catastrophic backtracking on a long paragraph', () => {
    // One Worker handles both fetching and parsing: a ReDoS would freeze
    // the whole pipeline, so the duration is checked explicitly.
    const long = `${'NOME SOBRENOME '.repeat(400)} - V123456-7, natural da ${'Colombia '.repeat(50)}`
    const started = Date.now()
    extractApprovals([long])
    extractDenials([long])
    const elapsed = Date.now() - started
    assert.ok(elapsed < 1000, `parsing took ${elapsed}ms`)
  })
})
