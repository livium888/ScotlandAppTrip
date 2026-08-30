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

// What's on opens on a one-line summary now, not on the form. Four suites
// each carried their own copy of "the chips are simply there when you
// arrive", and all four broke on the afternoon that stopped being true -
// the same failure mode as the tab selectors above, for the same reason.
// This is the one definition of "get me to the controls", and it is
// idempotent so a suite that is already in the form can call it anyway.
export const openEventForm = async (page, settle = 250) => {
  await page.evaluate(() => {
    if (document.querySelector('[data-ev-when]')) return;
    const edit = document.getElementById('evEdit');
    if (edit) edit.click();
  });
  await page.waitForTimeout(settle);
};

// The nine per-kind prompt editors sit behind their own disclosure inside
// the form, because nine pencils in an already-busy panel is the same
// mistake one level down. Opens the form first if it is not already open.
export const openAnglePencils = async (page, settle = 250) => {
  await openEventForm(page, settle);
  await page.evaluate(() => {
    if (document.querySelector('[data-ev-tune]')) return;
    const t = document.getElementById('evTuneToggle');
    if (t) t.click();
  });
  await page.waitForTimeout(settle);
};

// The order control folds to a single button naming the current order, so a
// suite that wants the four options has to open it. Idempotent, and it also
// re-opens after a choice - picking one folds it again on purpose, since the
// button then names what you just chose.
export const openSortRow = async (page, settle = 250) => {
  await page.evaluate(() => {
    if (document.querySelector('[data-sort]')) return;
    const t = document.getElementById('sortToggle');
    if (t) t.click();
  });
  await page.waitForTimeout(settle);
};

// Explore stopped being a fold inside Saved and became its own screen under
// Find. Ten suites each opened it by clicking the fold's header, so all ten
// broke together - the third time one fact in many copies has done that
// here. This is the one way in: it navigates if it has to, and does nothing
// if the screen is already up.
export const openExplore = async (page, settle = 300) => {
  await page.evaluate(() => {
    if (document.getElementById('exploreGpsBtn')) return;
    if (window.__tripTest && window.__tripTest.showView) return window.__tripTest.showView('explore');
    const t = document.querySelector('[data-find="explore"]');
    if (t) t.click();
  });
  await page.waitForTimeout(settle);
};

// The one search field lives on Saved. Suites reach it after an "around
// here" flow, which now ends on the Explore screen rather than on Saved, so
// getting to it means going back first. Doing that here keeps every suite
// from having to know where the flow left them.
export const openPickSearch = async (page, settle = 300) => {
  await page.evaluate(() => {
    if (!document.getElementById('pickSearchTrigger')) {
      const t = document.querySelector('[data-view="picks"]');
      if (t) t.click();
    }
  });
  await page.waitForTimeout(settle);
  await page.evaluate(() => {
    const t = document.getElementById('pickSearchTrigger');
    if (t) t.click();
  });
  await page.waitForTimeout(settle);
};
