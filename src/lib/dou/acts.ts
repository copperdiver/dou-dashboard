import { sha256Hex, stripDiacritics } from '../text'
import type { Block } from './page'

/**
 * Разбиение страницы на акты и классификация каждого ПО СОДЕРЖИМОМУ.
 *
 * Заголовкам доверять нельзя: наблюдались `PORTARIA Nº 6.824, DE 28 DE
 * JULHO DE 2026`, `PORTARIA 6.375` без `Nº`, `DESPACHOS`, `Despachos`,
 * `DESPACHO Nº 391/DNN_Naturalizacao_Proc/...`, месяцы в разном регистре.
 * Поле artType из индекса (Portaria/Despacho/Ato) тоже недостаточно:
 * одобрение встречается внутри despacho как `Assunto: Deferimento`.
 */

export type ActKind =
  | 'approval'
  | 'denial_list'
  | 'name_change'
  | 'revocation'
  | 'loss_of_nationality'
  | 'other'

export type NaturalizationType = 'ordinaria' | 'extraordinaria' | 'provisoria' | 'other'

export type ParsedAct = {
  ordinal: number
  identifica: string | null
  kind: ActKind
  naturalizationType: NaturalizationType | null
  /** Правовые ссылки как контекст: 'art.65', 'art.234'. */
  legalBasis: string[]
  paragraphs: string[]
  bodySha256: string
}

/** Одобрение: ключевой маркер, встречается в 27 из 27 актов-одобрений. */
const GRANT_PATTERN = /CONCEDER\s+a\s+nacionalidade\s+brasileira/i

/**
 * Структура блока решения. Обязателен `Código` или `Assunto` — по одному
 * `Processo:` судить нельзя: разрешения на работу оформлены так же
 * (`Processo: … Requerente: … LTDA Prazo: 2 Anos Imigrante: …`) и попали
 * бы в отказы 548 фантомными блоками.
 */
const DENIAL_LABEL_PATTERN = /^(?:C[oó]digo|Assunto)\s*:/i

/**
 * Разрешение на работу: та же иерархия департамента, но не натурализация.
 * Отсекается и здесь, и в фильтре релевантности — независимо от того,
 * под каким заголовком опубликовано.
 */
const WORK_PERMIT_PATTERN = /\bRequerente\s*:|\bImigrante\s*:|\bPrazo\s*:\s*\d+\s*Ano/i

const LOSS_PATTERN = /perda\s+da\s+nacionalidade/i

/**
 * Смена имени: `CERTIFICO ainda que, X passou a assinar Y, natural de
 * Portugal, nascida a 30 de julho de 1959, ...`. Ловушка для наивного
 * парсера — строка выглядит как строка одобрения.
 */
const NAME_CHANGE_PATTERN = /passou\s+a\s+assinar/i

const REVOCATION_PATTERN = /tornar\s+sem\s+efeito/i

function classify(paragraphs: readonly string[]): ActKind {
  const joined = paragraphs.join('\n')

  // Порядок важен: сначала однозначные маркеры существа акта.
  if (GRANT_PATTERN.test(joined)) return 'approval'
  if (WORK_PERMIT_PATTERN.test(joined)) return 'other'
  if (paragraphs.some((p) => DENIAL_LABEL_PATTERN.test(p))) return 'denial_list'
  if (LOSS_PATTERN.test(joined)) return 'loss_of_nationality'
  if (NAME_CHANGE_PATTERN.test(joined)) return 'name_change'
  if (REVOCATION_PATTERN.test(joined)) return 'revocation'

  return 'other'
}

/**
 * Ссылки на статьи Закона 13.445/2017 и Декрета 9.199/2017.
 * Хранятся как контекст, а НЕ как причина: `art. 65` встречается в 74%
 * текстов отказа, и будь он причиной, крупнейшая категория графика была
 * бы пустой по смыслу. Смысл несёт номер inciso — его разбирает
 * канонизатор причин.
 */
export function extractLegalBasis(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\bart(?:s?\.|igos?)\s*(\d{1,3})/gi)) {
    found.add(`art.${match[1]}`)
  }
  return [...found].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
}

/**
 * Вид натурализации по правовому основанию. Замер: art.65 — 14 актов
 * (обычная), art.70 — 8 (временная), art.67 — 6 (экстраординарная).
 */
function naturalizationTypeOf(text: string, legalBasis: readonly string[]): NaturalizationType | null {
  const normalized = stripDiacritics(text).toLowerCase()

  if (/naturalizacao\s+provisoria/.test(normalized)) return 'provisoria'
  if (/naturalizacao\s+extraordinaria/.test(normalized)) return 'extraordinaria'

  if (legalBasis.includes('art.70')) return 'provisoria'
  if (legalBasis.includes('art.67')) return 'extraordinaria'
  if (legalBasis.includes('art.65')) return 'ordinaria'

  return null
}

/**
 * Режет блоки на акты по `identifica`.
 *
 * Блоки до первого заголовка — шапка органа; если заголовков нет вовсе,
 * вся страница считается одним актом (наблюдалось на страницах с одним
 * despacho).
 */
export function splitActs(blocks: readonly Block[]): ParsedAct[] {
  const groups: { identifica: string | null; paragraphs: string[] }[] = []
  let current: { identifica: string | null; paragraphs: string[] } | null = null

  for (const block of blocks) {
    if (block.cls === 'identifica') {
      current = { identifica: block.text, paragraphs: [] }
      groups.push(current)
      continue
    }

    if (block.cls !== 'dou-paragraph') continue

    if (current === null) {
      current = { identifica: null, paragraphs: [] }
      groups.push(current)
    }

    current.paragraphs.push(block.text)
  }

  return groups
    .filter((group) => group.paragraphs.length > 0 || group.identifica !== null)
    .map((group, index) => {
      const joined = [group.identifica ?? '', ...group.paragraphs].join('\n')
      const legalBasis = extractLegalBasis(joined)
      const kind = classify(group.paragraphs)

      return {
        ordinal: index,
        identifica: group.identifica,
        kind,
        naturalizationType: kind === 'approval' ? naturalizationTypeOf(joined, legalBasis) : null,
        legalBasis,
        paragraphs: group.paragraphs,
        bodySha256: sha256Hex(joined),
      }
    })
}
