// Notes & packing: the two free-form lists that belong to a trip.
//
// The packing list used to be one global list of fixed Scottish items with
// only its ticks stored. It is per trip and fully editable now - a three-day
// city break and a week in the Highlands need different lists. The rules for
// what a new trip's list starts as are pure and tested in Node; the screen is
// handed what it needs.
import { esc } from "../lib/text.js";

// What a trip's list starts as: the bundled defaults, with any ticks carried
// over from the old global list, plus the few lines that depend on who is
// actually coming - from the people list rather than a guess about families.
export function seedPacking({ defaults, checked, people, isChild }) {
  const ticked = checked && typeof checked === "object" ? checked : {};
  const seeded = defaults.map((text, i) => ({ text, done: !!ticked[i] }));
  if (people.some((x) => x.buggy)) seeded.push({ text: "Buggy, and the rain cover for it", done: false });
  if (people.some(isChild)) seeded.push({ text: "A comfort toy for the long legs", done: false });
  if (people.some((x) => x.naps)) seeded.push({ text: "Whatever makes a nap happen away from home", done: false });
  return seeded;
}

export function packingCount(items) {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export function createTipsScreen(ctx) {
  const { view, storage, boardKey, activeBoard, loadPeople, isChild, defaultPacking, legacyPackingKey } = ctx;

  function loadPacking() {
    const board = activeBoard();
    const stored = storage.readJson(boardKey(board.id, "packing"), null);
    if (Array.isArray(stored)) return stored;
    // A short generic list beats an empty screen: nobody types "chargers" into
    // nothing, they close it.
    const seeded = seedPacking({
      defaults: defaultPacking,
      checked: storage.readJson(legacyPackingKey, {}) || {},
      people: loadPeople(),
      isChild,
    });
    storage.write(boardKey(board.id, "packing"), JSON.stringify(seeded));
    return seeded;
  }

  function savePacking(items) {
    storage.write(boardKey(activeBoard().id, "packing"), JSON.stringify(items));
  }

  function loadBoardNotes() {
    return storage.readJson(boardKey(activeBoard().id, "notes"), "") || "";
  }

  function saveBoardNotes(text) {
    storage.write(boardKey(activeBoard().id, "notes"), JSON.stringify(text));
  }

  // ---------- Notes & packing ----------
  // Both belong to the board. The bundled Scotland advice stays on the board
  // it came with; every board gets its own notes and its own list.
  function render() {
    const items = loadPacking();
    const notes = loadBoardNotes();

    let html = `
      <div class="section-label">Notes</div>
      <div class="card">
        <textarea class="settings-input notes-box" id="boardNotes" rows="4"
          placeholder="Anything worth remembering — booking references, the code for the flat, who's driving.">${esc(notes)}</textarea>
      </div>
    `;

    html += `<div class="section-label">Packing list${
      items.length ? ` · ${packingCount(items).done}/${packingCount(items).total}` : ""
    }</div>`;
    html += `<div class="card">`;
    if (items.length) {
      html += `<ul class="packing-list">`;
      items.forEach((it, i) => {
        html += `<li data-i="${i}" class="${it.done ? "checked" : ""}">
          <span class="packing-text">${esc(it.text)}</span>
          <button class="packing-remove" data-packing-remove="${i}" aria-label="Remove ${esc(it.text)}">${icon('close', { size: 17, cls: 'ico-inline' })}</button>
        </li>`;
      });
      html += `</ul>`;
    } else {
      html += `<p class="pick-status">Nothing on the list yet.</p>`;
    }
    html += `
      <form class="search-bar packing-add" id="packingAddForm">
        <input type="text" id="packingAddInput" placeholder="Add something to pack…" autocomplete="off" />
        <button type="submit" aria-label="Add">+</button>
      </form>
    </div>`;

    view.innerHTML = html;

    const notesBox = document.getElementById("boardNotes");
    if (notesBox) notesBox.addEventListener("blur", () => saveBoardNotes(notesBox.value));

    view.querySelectorAll(".packing-list li").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.closest("[data-packing-remove]")) return;
        const i = Number(li.getAttribute("data-i"));
        const list = loadPacking();
        if (!list[i]) return;
        list[i].done = !list[i].done;
        savePacking(list);
        li.classList.toggle("checked", list[i].done);
      });
    });

    view.querySelectorAll("[data-packing-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const list = loadPacking();
        list.splice(Number(btn.getAttribute("data-packing-remove")), 1);
        savePacking(list);
        render();
      });
    });

    const addForm = document.getElementById("packingAddForm");
    if (addForm) {
      addForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("packingAddInput");
        const text = input.value.trim();
        if (!text) return;
        const list = loadPacking();
        list.push({ text, done: false });
        savePacking(list);
        render();
      });
    }
  }

  return { render, loadPacking };
}
