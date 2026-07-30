/**
 * 26 штатов Бразилии и Федеральный округ.
 *
 * В источнике встречаются как `residente no estado de São Paulo`,
 * `residente no Estado do Paraná`, `residente no Distrito Federal` —
 * извлечённое название сопоставляется по нормализованному ключу.
 */
export type BrStateSeed = {
  uf: string
  namePt: string
  nameEn: string
  nameRu: string
  region: 'north' | 'northeast' | 'central_west' | 'southeast' | 'south'
}

export const BR_STATE_SEED: readonly BrStateSeed[] = [
  { uf: 'AC', namePt: 'Acre', nameEn: 'Acre', nameRu: 'Акри', region: 'north' },
  { uf: 'AL', namePt: 'Alagoas', nameEn: 'Alagoas', nameRu: 'Алагоас', region: 'northeast' },
  { uf: 'AP', namePt: 'Amapá', nameEn: 'Amapá', nameRu: 'Амапа', region: 'north' },
  { uf: 'AM', namePt: 'Amazonas', nameEn: 'Amazonas', nameRu: 'Амазонас', region: 'north' },
  { uf: 'BA', namePt: 'Bahia', nameEn: 'Bahia', nameRu: 'Баия', region: 'northeast' },
  { uf: 'CE', namePt: 'Ceará', nameEn: 'Ceará', nameRu: 'Сеара', region: 'northeast' },
  {
    uf: 'DF',
    namePt: 'Distrito Federal',
    nameEn: 'Federal District',
    nameRu: 'Федеральный округ',
    region: 'central_west',
  },
  {
    uf: 'ES',
    namePt: 'Espírito Santo',
    nameEn: 'Espírito Santo',
    nameRu: 'Эспириту-Санту',
    region: 'southeast',
  },
  { uf: 'GO', namePt: 'Goiás', nameEn: 'Goiás', nameRu: 'Гояс', region: 'central_west' },
  { uf: 'MA', namePt: 'Maranhão', nameEn: 'Maranhão', nameRu: 'Мараньян', region: 'northeast' },
  {
    uf: 'MT',
    namePt: 'Mato Grosso',
    nameEn: 'Mato Grosso',
    nameRu: 'Мату-Гросу',
    region: 'central_west',
  },
  {
    uf: 'MS',
    namePt: 'Mato Grosso do Sul',
    nameEn: 'Mato Grosso do Sul',
    nameRu: 'Мату-Гросу-ду-Сул',
    region: 'central_west',
  },
  {
    uf: 'MG',
    namePt: 'Minas Gerais',
    nameEn: 'Minas Gerais',
    nameRu: 'Минас-Жерайс',
    region: 'southeast',
  },
  { uf: 'PA', namePt: 'Pará', nameEn: 'Pará', nameRu: 'Пара', region: 'north' },
  { uf: 'PB', namePt: 'Paraíba', nameEn: 'Paraíba', nameRu: 'Параиба', region: 'northeast' },
  { uf: 'PR', namePt: 'Paraná', nameEn: 'Paraná', nameRu: 'Парана', region: 'south' },
  {
    uf: 'PE',
    namePt: 'Pernambuco',
    nameEn: 'Pernambuco',
    nameRu: 'Пернамбуку',
    region: 'northeast',
  },
  { uf: 'PI', namePt: 'Piauí', nameEn: 'Piauí', nameRu: 'Пиауи', region: 'northeast' },
  {
    uf: 'RJ',
    namePt: 'Rio de Janeiro',
    nameEn: 'Rio de Janeiro',
    nameRu: 'Рио-де-Жанейро',
    region: 'southeast',
  },
  {
    uf: 'RN',
    namePt: 'Rio Grande do Norte',
    nameEn: 'Rio Grande do Norte',
    nameRu: 'Рио-Гранди-ду-Норти',
    region: 'northeast',
  },
  {
    uf: 'RS',
    namePt: 'Rio Grande do Sul',
    nameEn: 'Rio Grande do Sul',
    nameRu: 'Рио-Гранди-ду-Сул',
    region: 'south',
  },
  { uf: 'RO', namePt: 'Rondônia', nameEn: 'Rondônia', nameRu: 'Рондония', region: 'north' },
  { uf: 'RR', namePt: 'Roraima', nameEn: 'Roraima', nameRu: 'Рорайма', region: 'north' },
  {
    uf: 'SC',
    namePt: 'Santa Catarina',
    nameEn: 'Santa Catarina',
    nameRu: 'Санта-Катарина',
    region: 'south',
  },
  { uf: 'SP', namePt: 'São Paulo', nameEn: 'São Paulo', nameRu: 'Сан-Паулу', region: 'southeast' },
  { uf: 'SE', namePt: 'Sergipe', nameEn: 'Sergipe', nameRu: 'Сержипи', region: 'northeast' },
  { uf: 'TO', namePt: 'Tocantins', nameEn: 'Tocantins', nameRu: 'Токантинс', region: 'north' },
] as const

/** Дополнительные написания, встречающиеся в источнике. */
export const BR_STATE_ALIAS_SEED: readonly { alias: string; uf: string }[] = [
  { alias: 'Distrito Federal (DF)', uf: 'DF' },
  { alias: 'Sao Paulo', uf: 'SP' },
  { alias: 'Espirito Santo', uf: 'ES' },
] as const
