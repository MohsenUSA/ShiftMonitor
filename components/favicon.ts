/* The coffee-mug favicon, optionally with a red alert dot. */
const FAVI_MUG = `<rect width='32' height='32' rx='8' fill='url(#g)'/><g fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 13h13v8a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5v-8z'/><path d='M20 14.5h2.5a3 3 0 0 1 0 6H20'/><path d='M11.5 9.5c0-1.2 1-1.2 1-2.5'/><path d='M16 9.5c0-1.2 1-1.2 1-2.5'/></g>`;
const FAVI_DEFS = `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#4f46e5'/><stop offset='1' stop-color='#818cf8'/></linearGradient></defs>`;

export const faviconURI = (withDot: boolean) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>${FAVI_DEFS}${FAVI_MUG}`
  + (withDot ? `<circle cx='25' cy='7' r='6.5' fill='#ef4444' stroke='white' stroke-width='2'/>` : '')
  + `</svg>`);
