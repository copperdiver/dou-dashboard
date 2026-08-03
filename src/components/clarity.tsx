import Script from 'next/script'

/**
 * Microsoft Clarity: behavior analytics.
 *
 * The id comes from the `CLARITY_ID` environment variable, and without it
 * the component renders nothing: in development and local runs the counter
 * has nothing to do, and a forgotten variable shouldn't silently ship data
 * from the wrong environment into the same Clarity project.
 *
 * The variable name deliberately has no NEXT_PUBLIC_ prefix. Such variables
 * get inlined by Next at build time, meaning the same image couldn't be
 * deployed with different ids. Here the value is read by a server
 * component and injected into the markup per request.
 *
 * `afterInteractive`: load after hydration so the counter doesn't delay
 * the first paint.
 *
 * The tag's id is `ms-clarity`, and `clarity` cannot be used here. The
 * browser exposes elements with an `id` as properties of `window`, so
 * `<script id="clarity">` would make `window.clarity` be that very element.
 * Then `c[a]=c[a]||function(){…}` sees the slot already taken and doesn't
 * create a queue, and once the tag loads it calls `window.clarity(...)`
 * (which is the element, not a function) and throws. The counter goes
 * silent in the process: the script loads, there are no markup errors, and
 * not a single session gets sent.
 */
export function Clarity({ id }: { id: string | undefined }) {
  // The id gets embedded inside the script string, so only letters and
  // digits are allowed: anything else there would turn into executable code.
  if (!id || !/^[a-z0-9]+$/i.test(id)) return null

  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${id}");`}
    </Script>
  )
}
