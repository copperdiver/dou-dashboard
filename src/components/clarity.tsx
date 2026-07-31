import Script from 'next/script'

/**
 * Microsoft Clarity — аналитика поведения.
 *
 * Идентификатор приходит переменной окружения `CLARITY_ID`, и без неё
 * компонент не выводит ничего: в разработке и на локальных прогонах
 * счётчику делать нечего, а забытая переменная не должна тихо слать
 * данные из чужого окружения в тот же проект Clarity.
 *
 * Имя переменной без префикса NEXT_PUBLIC_ намеренно. Такие переменные
 * Next подставляет на этапе сборки, то есть один и тот же образ нельзя
 * было бы выложить с разными идентификаторами. Здесь значение читает
 * серверный компонент и подставляет в разметку на запросе.
 *
 * `afterInteractive` — загрузка после гидратации: счётчик не должен
 * задерживать первую отрисовку.
 */
export function Clarity({ id }: { id: string | undefined }) {
  // Идентификатор попадает внутрь строки скрипта, поэтому допускаются
  // только буквы и цифры: посторонние символы там превратились бы
  // в исполняемый код.
  if (!id || !/^[a-z0-9]+$/i.test(id)) return null

  return (
    <Script id="clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${id}");`}
    </Script>
  )
}
