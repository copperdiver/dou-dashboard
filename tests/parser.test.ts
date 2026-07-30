/**
 * Тесты парсера на реальных страницах DOU.
 *
 *   npm test
 *
 * Встроенный тест-раннер Node — без дополнительных зависимостей.
 * Фикстуры обновляются через scripts/save-fixtures.ts.
 *
 * Проверяются именно те случаи, на которых парсер уже ломался: смена
 * имени, притворяющаяся одобрением; метки `Interessada`/`Interessado(a)`;
 * `Processo nº:` с «nº» перед двоеточием; порядок проверок, из-за
 * которого «tornar sem efeito» засчитывался подтверждением отказа.
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

describe('одна страница — несколько актов', () => {
  it('режет портарию на четыре акта с разными основаниями', () => {
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

  it('извлекает всех людей и не теряет ни одного абзаца', () => {
    const acts = actsOf('approvals-four-acts')
    const counts: number[] = []
    for (const act of acts) {
      const { people, unparsed } = extractApprovals(act.paragraphs)
      assert.deepEqual(unparsed, [], `неразобранные абзацы в акте #${act.ordinal}`)
      counts.push(people.length)
    }
    assert.deepEqual(counts, [1, 10, 5, 4])
  })

  it('разбирает поля строки-персоны', () => {
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

describe('краевые написания строки-персоны', () => {
  const line = (body: string) => extractApprovals([body])

  it('терпит опечатку в предлоге перед страной', () => {
    // `doa` вместо `dos` — реальная опечатка источника.
    const { people, unparsed } = line(
      'GREGORY EDWARD BOAN - F509489-1, natural doa Estados Unidos, nascido em 8 de maio de 1988, filho de EDWARD BOAN e de ANA MARIA OSLE, residente no Estado do Rio de Janeiro (Processo nº 235881.0111111/2025).',
    )
    assert.deepEqual(unparsed, [])
    assert.equal(people[0]?.countryRaw, 'Estados Unidos')
    assert.equal(people[0]?.stateRaw, 'Rio de Janeiro')
  })

  it('не тянет дату рождения в название страны, когда запятой нет', () => {
    // `natural de Cuba nascida em agosto de 1977` — без границы по `nascid`
    // в страну попадало «Cuba nascida em agosto de 1977».
    const { people } = line(
      'MARIA PEREZ - V111111-1, natural de Cuba nascida em agosto de 1977, filha de X e de Y, residente no estado de São Paulo (Processo nº 235881.0222222/2025).',
    )
    assert.equal(people[0]?.countryRaw, 'Cuba')
    // Дата без числа не разбирается — это законный пропуск, а не ошибка.
    assert.equal(people[0]?.birthDate, null)
  })

  it('не тянет номер документа в имя, когда он записан словом RNM', () => {
    const { people } = line(
      'NABIL DALANK ZELFO - RNM F009513-S, natural da Colômbia, nascido(a) em 7 de outubro de 1979, filho(a) de Samir e de Nohal, residente no Estado do Paraná (Processo nº 235881.0333333/2023).',
    )
    assert.equal(people[0]?.fullName, 'NABIL DALANK ZELFO')
    assert.equal(people[0]?.documentId, 'F009513-S')
  })

  it('находит штат без слова «estado»', () => {
    const { people } = line(
      'BENITHO LOUIS - V793903-0, natural do Haiti, nascido em 30 de setembro de 1983, filho de X e de Y, residente no Distrito Federal (Processo nº 235881.0444444/2026).',
    )
    assert.equal(people[0]?.stateRaw, 'Distrito Federal')
  })
})

describe('смена имени не считается одобрением', () => {
  it('акт классифицируется как name_change', () => {
    const acts = actsOf('name-change')
    assert.ok(
      acts.every((a) => a.kind !== 'approval'),
      'акт о смене имени принят за одобрение',
    )
    assert.ok(acts.some((a) => a.kind === 'name_change'))
  })

  it('абзац CERTIFICO не даёт людей даже при прямом разборе', () => {
    for (const act of actsOf('name-change')) {
      const { people } = extractApprovals(act.paragraphs)
      assert.deepEqual(people, [], 'из смены имени извлечён человек')
    }
  })
})

describe('блоки отказа', () => {
  it('извлекает все блоки списка отказов', () => {
    const [act] = actsOf('denials-list')
    assert.equal(act!.kind, 'denial_list')

    const { denials, unparsed } = extractDenials(act!.paragraphs)
    assert.deepEqual(unparsed, [])
    assert.equal(denials.length, 28)

    assert.ok(
      denials.every((d) => d.fullName.length > 0 && d.reasonText !== null),
      'есть блок без имени или без текста причины',
    )
    assert.ok(denials.every((d) => d.processNumberNorm !== null), 'есть блок без номера процесса')
  })

  it('подтверждение отказа помечается, а не считается новым отказом', () => {
    const [act] = actsOf('denial-upheld')
    const { denials } = extractDenials(act!.paragraphs)

    assert.equal(denials.length, 1)
    assert.equal(denials[0]!.decisionKind, 'denial')
    assert.equal(denials[0]!.isUpheld, true)
    // Точка на конце имени в источнике не должна попасть в данные.
    assert.equal(denials[0]!.fullName, 'LOUTFIA CHARIF SAID ALI')
  })

  it('прекращение производства по другой процедуре: archived и не naturalization', () => {
    const acts = actsOf('archived-other-procedure')
    const denials = acts.flatMap((a) => extractDenials(a.paragraphs).denials)

    assert.ok(denials.length >= 2, `ожидалось не меньше двух блоков, получено ${denials.length}`)
    assert.ok(
      denials.every((d) => d.decisionKind === 'archived'),
      'прекращение производства принято за отказ',
    )
    assert.ok(
      denials.every((d) => d.subjectKind === 'other'),
      'признание равенства прав принято за натурализацию',
    )
    assert.ok(denials.every((d) => d.fullName.length > 0), 'блок без имени: метка не распознана')
  })
})

describe('классификация Assunto', () => {
  const cases: [string, { decisionKind: string; isUpheld: boolean }][] = [
    ['Indeferimento do pedido', { decisionKind: 'denial', isUpheld: false }],
    ['Indeferimento do pedido.', { decisionKind: 'denial', isUpheld: false }],
    ['Manutenção de Indeferimento do pedido', { decisionKind: 'denial', isUpheld: true }],
    ['MANUTENÇÃO DO INDEFERIMENTO', { decisionKind: 'denial', isUpheld: true }],
    ['Manutenção de indeferimento do pedido', { decisionKind: 'denial', isUpheld: true }],
    ['Deferimento do pedido', { decisionKind: 'approval', isUpheld: false }],
    ['Arquivamento do pedido', { decisionKind: 'archived', isUpheld: false }],
    // Отмена решения, а не подтверждение отказа: «manutenção» внутри строки
    // не должна перебить «sem efeito».
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

  it('отмена высылки не попадает в натурализацию', () => {
    const actual = classifyAssunto('INDEFERIMENTO DE PEDIDO DE REVOGAÇÃO DE EXPULSÃO')
    assert.equal(actual.subjectKind, 'expulsion')
  })
})

describe('нормализация номера процесса', () => {
  it('понимает оба формата и префиксы', () => {
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

describe('возраст на дату публикации', () => {
  it('считает полные годы и учитывает, наступил ли день рождения', () => {
    assert.equal(ageOn('1979-10-07', '2026-07-29'), 46)
    assert.equal(ageOn('1979-07-29', '2026-07-29'), 47)
    assert.equal(ageOn('1979-07-30', '2026-07-29'), 46)
    assert.equal(ageOn('2026-07-29', '2026-07-29'), 0)
  })

  it('отбрасывает невозможные значения', () => {
    assert.equal(ageOn('2030-01-01', '2026-07-29'), null)
    assert.equal(ageOn('не дата', '2026-07-29'), null)
  })
})

describe('устойчивость регулярок', () => {
  it('не уходит в катастрофический backtracking на длинном абзаце', () => {
    // Один Worker обслуживает и загрузку, и разбор: ReDoS заморозил бы
    // весь конвейер, поэтому длина проверяется явно.
    const long = `${'NOME SOBRENOME '.repeat(400)} - V123456-7, natural da ${'Colombia '.repeat(50)}`
    const started = Date.now()
    extractApprovals([long])
    extractDenials([long])
    const elapsed = Date.now() - started
    assert.ok(elapsed < 1000, `разбор занял ${elapsed} мс`)
  })
})
