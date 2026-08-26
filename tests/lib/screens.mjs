// Going to a screen, from a suite's point of view.
//
// Kids, Budget and Notes stopped being tabs when the bar went from seven down
// to five; they are rows in More now. Eight suites each had their own copy of
// "click the tab with this data-view", and eight suites broke on the same
// afternoon. There is one definition of it here instead, and it reaches a
// screen the way a person would: the tab if there is one, the More row if
// there is not.
export const goTo = async (page, name, settle = 250) => {
  await page.evaluate((n) => {
    const t = document.querySelector(`[data-view="${n}"]`);
    if (t && !t.hidden) return t.click();
    const more = document.querySelector('[data-view="more"]');
    if (!more) throw new Error(`no tab for "${n}" and no More to look in`);
    more.click();
    const row = document.querySelector(`[data-more="${n}"]`);
    if (row) return row.click();
    // Places and Eats have no button anywhere - they are what a saved-list
    // link or the hardware back history lands on, and a suite still has to
    // be able to render them.
    if (window.__tripTest && window.__tripTest.showView) return window.__tripTest.showView(n);
    throw new Error(`no way to reach "${n}"`);
  }, name);
  await page.waitForTimeout(settle);
};
