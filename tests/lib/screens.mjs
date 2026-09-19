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

// The search form asks three questions, each on a sheet of its own. Six
// suites used to reach these controls by knowing they were all on one panel;
// they reach them through here now. Fourth time one fact in many copies has
// broken a row of suites at once - tab selectors, angle markers, the explore
// fold, and this.
const openAskSheet = async (page, which, settle = 350) => {
  // Self-sufficient on purpose: a suite asking for the When sheet should not
  // also have to know it must be on the Find screen with the form open, or
  // that some other sheet is over the top of it. closePlaceModal only drops
  // the open class, so stale markup stays queryable - a suite that skipped
  // this would find controls that are on screen only in the DOM's opinion.
  await page.evaluate(() => {
    const m = document.getElementById('placeModal');
    if (m && m.classList.contains('open')) {
      const b = m.querySelector('.modal-close');
      if (b) b.click();
    }
    if (m) m.innerHTML = '';
  });
  await page.waitForTimeout(settle);
  await goTo(page, 'events', settle);
  await openEventForm(page, settle);
  await page.evaluate((w) => {
    const row = document.querySelector(`[data-ev-ask="${w}"]`);
    if (row) row.click();
  }, which);
  await page.waitForTimeout(settle);
};

export const openWhereSheet = (page, settle) => openAskSheet(page, 'where', settle);
export const openWhenSheet = (page, settle) => openAskSheet(page, 'when', settle);
export const openWhatSheet = (page, settle) => openAskSheet(page, 'what', settle);

// Closing whichever ask-sheet is open, so a suite can get back to the form.
export const closeAskSheet = async (page, settle = 300) => {
  await page.evaluate(() => {
    const b = document.querySelector('#placeModal .modal-close');
    if (b) b.click();
  });
  await page.waitForTimeout(settle);
};

// Intent, not layout. Four times now a row of suites has broken together
// because each one knew where a control was drawn - tab selectors, angle
// markers, the explore fold, and the search form splitting into sheets. A
// suite should say what it is choosing and never where the chip lives.
const chooseIn = async (open, page, selector, settle = 300) => {
  await open(page, settle);
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector('#placeModal ' + sel) || document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  await page.waitForTimeout(settle);
  await closeAskSheet(page, settle);
  return hit;
};

export const chooseWhen = (page, key, settle) =>
  chooseIn(openWhenSheet, page, `[data-ev-when="${key}"]`, settle);
export const chooseKind = (page, key, settle) =>
  chooseIn(openWhatSheet, page, `[data-ev-kind="${key}"]`, settle);
export const chooseMiles = (page, miles, settle) =>
  chooseIn(openWhereSheet, page, `[data-ev-miles="${miles}"]`, settle);
export const chooseWhereSaved = (page, pickId, settle) =>
  chooseIn(openWhereSheet, page, `[data-ev-where="${pickId}"]`, settle);

// The nine prompt editors moved off the search form into Settings, where a
// wording you set once belongs. This is the way to them now.
export const openAnglePencils = async (page, settle = 350) => {
  await page.evaluate(() => {
    if (document.querySelector('[data-ev-tune]')) return;
    if (window.__tripTest && window.__tripTest.openSettings) window.__tripTest.openSettings();
  });
  await page.waitForTimeout(settle);
};
