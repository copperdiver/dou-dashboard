/**
 * Сохраняет реальные страницы DOU как фикстуры для тестов парсера.
 *
 *   npx tsx --env-file-if-exists=.env scripts/save-fixtures.ts
 *
 * Берёт HTML из уже загруженных страниц, а не из сети: фикстуры должны
 * быть воспроизводимы и не зависеть от доступности источника.
 *
 * Набор подобран по краевым случаям, а не по свежести: страница с одним
 * актом и с четырьмя, длинный список отказов, подтверждение отказа,
 * смена имени, прекращение производства.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eq, inArray } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { sourcePageHtml, sourcePages } from '../src/db/schema'

/** urlTitle → имя файла и что именно этот случай проверяет. */
const WANTED: Record<string, string> = {
  'portaria-n-6.824-de-28-de-julho-de-2026-722107012': 'approvals-four-acts',
  'portaria-n-6.823-de-27-de-julho-de-2026-721634928': 'approvals-single-person',
  'despachos-de-28-de-julho-de-2026-722055615': 'denials-list',
  'despacho-de-28-de-julho-de-2026-722054258': 'denial-upheld',
  'despachos-722054179': 'name-change',
  'despacho-n-119/2026/dnn_igualdade_direitos/dnn_nacionalidade/cpmig/cgpmig/demig/senajus-721094970':
    'archived-other-procedure',
}

const dir = fileURLToPath(new URL('../tests/fixtures/dou', import.meta.url))

try {
  mkdirSync(dir, { recursive: true })

  const rows = await db
    .select({
      urlTitle: sourcePages.urlTitle,
      editionDate: sourcePages.editionDate,
      title: sourcePages.title,
      html: sourcePageHtml.html,
    })
    .from(sourcePages)
    .innerJoin(sourcePageHtml, eq(sourcePageHtml.pageId, sourcePages.id))
    .where(inArray(sourcePages.urlTitle, Object.keys(WANTED)))

  const saved: string[] = []
  for (const row of rows) {
    const name = WANTED[row.urlTitle]
    if (!name) continue
    writeFileSync(`${dir}/${name}.html`, row.html, 'utf8')
    saved.push(`${name}.html (${Math.round(row.html.length / 1024)} КБ) ← ${row.urlTitle}`)
  }

  const missing = Object.keys(WANTED).filter((u) => !rows.some((r) => r.urlTitle === u))

  console.log(`Сохранено в ${dir}:`)
  for (const s of saved.sort()) console.log(`  ${s}`)
  if (missing.length > 0) {
    console.log(`\nНе найдено в БД (загрузите соответствующие дни):`)
    for (const m of missing) console.log(`  ${m}`)
    process.exitCode = 1
  }
} catch (error) {
  console.error('Ошибка:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
