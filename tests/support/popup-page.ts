/** The body of popup-view/index.html, which the popup is drawn in */
export const POPUP_BODY = `
<div id="frame-shell" class="frame-shell">
  <main id="main-frame" class="frame">
    <header class="frame-header" data-nav-row></header>
    <section class="frame-content"></section>
    <footer class="frame-footer" data-nav-row></footer>
  </main>
  <aside id="aside-frame" class="frame">
    <header class="frame-header" data-nav-row></header>
    <section class="frame-content"></section>
    <footer class="frame-footer" data-nav-row></footer>
  </aside>
</div>`;

export function setUpPopupPage(): void {
  document.body.className = 'content-loading';
  document.body.innerHTML = POPUP_BODY;
}

export function elementById(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`No element #${id}`);
  }
  return found;
}

/** Wait for what is already under way to finish */
export const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
