import {
  addMeal,
  deleteMeal,
  deleteTemplate,
  ensureDefaultTemplates,
  exportAllData,
  getDay,
  getTemplates,
  importAllData,
  saveTemplate,
  updateMeal,
  updateNote,
} from "./storage.js";

const state = {
  activeView: "today",
  todayDate: toDateKey(new Date()),
  historyDate: toDateKey(new Date()),
  templates: [],
  mealDialogContext: null,
  templateEditingId: null,
  noteTimers: {},
};

const $ = (selector) => document.querySelector(selector);
const views = {
  today: $("#todayView"),
  history: $("#historyView"),
  template: $("#templateView"),
};

// Dates are stored as local YYYY-MM-DD keys. Keeping this format centralized
// makes future monthly graphs and goal comparisons easier to add.
function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// UI rendering is split by feature area so Phase2 screens can reuse the same
// storage functions without mixing graph, weight, or goal logic into this file.
function formatDateLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function numberText(value) {
  return Number(value || 0).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function setView(viewName) {
  state.activeView = viewName;
  Object.entries(views).forEach(([name, view]) => view.classList.toggle("is-active", name === viewName));
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });
  $("#screenTitle").textContent = { today: "今日", history: "履歴", template: "テンプレート" }[viewName];
}

function mealDateFromContext() {
  return state.mealDialogContext?.date || state.todayDate;
}

function readMacroFields(prefix) {
  return {
    calories: Number($(`#${prefix}Calories`).value || 0),
    protein: Number($(`#${prefix}Protein`).value || 0),
    fat: Number($(`#${prefix}Fat`).value || 0),
  };
}

function renderSummary(prefix, summary) {
  $(`#${prefix}Calories`).textContent = numberText(summary.calories);
  $(`#${prefix}Protein`).textContent = numberText(summary.protein);
  $(`#${prefix}Fat`).textContent = numberText(summary.fat);
}

// Meal cards are generated from data only. Edit/delete actions call the storage
// adapter, so replacing IndexedDB with Firebase later stays localized.
function mealCard(meal, date) {
  const card = document.createElement("article");
  card.className = "record-card";
  card.innerHTML = `
    <div class="record-top">
      <div>
        <p class="record-title"></p>
        <span class="record-time"></span>
      </div>
    </div>
    <div class="macro-row">
      <div class="macro"><span>カロリー</span><strong>${numberText(meal.calories)} kcal</strong></div>
      <div class="macro"><span>タンパク質</span><strong>${numberText(meal.protein)} g</strong></div>
      <div class="macro"><span>脂質</span><strong>${numberText(meal.fat)} g</strong></div>
    </div>
    <div class="action-row">
      <button class="secondary-button" type="button" data-action="edit">編集</button>
      <button class="danger-button" type="button" data-action="delete">削除</button>
    </div>
  `;
  card.querySelector(".record-title").textContent = meal.name;
  card.querySelector(".record-time").textContent = formatTime(meal.datetime);
  card.querySelector('[data-action="edit"]').addEventListener("click", () => openMealDialog(date, meal));
  card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    if (!confirm(`${meal.name}を削除しますか？`)) return;
    await deleteMeal(date, meal.id);
    await renderDayViews();
    showToast("削除しました");
  });
  return card;
}

function renderMealList(container, day) {
  container.innerHTML = "";
  const meals = [...day.meals].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  if (meals.length === 0) {
    container.innerHTML = '<div class="empty-state">まだ食事がありません</div>';
    return;
  }
  meals.forEach((meal) => container.appendChild(mealCard(meal, day.date)));
}

async function renderDayViews() {
  const [today, history] = await Promise.all([getDay(state.todayDate), getDay(state.historyDate)]);

  $("#todayLabel").textContent = formatDateLabel(state.todayDate);
  renderSummary("today", today.summary);
  renderMealList($("#todayMealList"), today);
  $("#todayNote").value = today.note || "";

  $("#historyDate").value = state.historyDate;
  renderSummary("history", history.summary);
  renderMealList($("#historyMealList"), history);
  $("#historyNote").value = history.note || "";
}

function renderTemplateOptions() {
  const select = $("#mealTemplate");
  select.innerHTML = '<option value="">選択しない</option>';
  state.templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    select.appendChild(option);
  });
}

function templateCard(template) {
  const card = document.createElement("article");
  card.className = "record-card";
  card.innerHTML = `
    <div class="record-top">
      <div>
        <p class="record-title"></p>
        <span class="record-time">${numberText(template.calories)} kcal / P ${numberText(template.protein)}g / F ${numberText(template.fat)}g</span>
      </div>
    </div>
    <div class="action-row">
      <button class="secondary-button" type="button" data-action="edit">編集</button>
      <button class="danger-button" type="button" data-action="delete">削除</button>
    </div>
  `;
  card.querySelector(".record-title").textContent = template.name;
  card.querySelector('[data-action="edit"]').addEventListener("click", () => openTemplateDialog(template));
  card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    if (!confirm(`${template.name}を削除しますか？`)) return;
    await deleteTemplate(template.id);
    await refreshTemplates();
    showToast("削除しました");
  });
  return card;
}

async function refreshTemplates() {
  state.templates = await getTemplates();
  const list = $("#templateList");
  list.innerHTML = "";
  if (state.templates.length === 0) {
    list.innerHTML = '<div class="empty-state">テンプレートがありません</div>';
  } else {
    state.templates.forEach((template) => list.appendChild(templateCard(template)));
  }
  renderTemplateOptions();
}

function localDateTimeValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function openMealDialog(date, meal = null) {
  state.mealDialogContext = { date, mealId: meal?.id || null };
  $("#mealDialogTitle").textContent = meal ? "食事編集" : "食事追加";
  $("#mealTemplate").value = "";
  const defaultTime = date === toDateKey(new Date()) ? new Date() : new Date(`${date}T12:00:00`);
  $("#mealTime").value = meal?.datetime?.slice(0, 16) || localDateTimeValue(defaultTime);
  $("#mealName").value = meal?.name || "";
  $("#mealCalories").value = meal?.calories ?? "";
  $("#mealProtein").value = meal?.protein ?? "";
  $("#mealFat").value = meal?.fat ?? "";
  $("#mealDialog").showModal();
}

function openTemplateDialog(template = null) {
  state.templateEditingId = template?.id || null;
  $("#templateDialogTitle").textContent = template ? "テンプレート編集" : "テンプレート追加";
  $("#templateName").value = template?.name || "";
  $("#templateCalories").value = template?.calories ?? "";
  $("#templateProtein").value = template?.protein ?? "";
  $("#templateFat").value = template?.fat ?? "";
  $("#templateDialog").showModal();
}

function setupEventListeners() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  $("#todayResetButton").addEventListener("click", async () => {
    state.todayDate = toDateKey(new Date());
    await renderDayViews();
  });
  $("#addMealButton").addEventListener("click", () => openMealDialog(state.todayDate));
  $("#addHistoryMealButton").addEventListener("click", () => openMealDialog(state.historyDate));
  $("#addTemplateButton").addEventListener("click", () => openTemplateDialog());
  $("#openBackupButton").addEventListener("click", () => $("#backupDialog").showModal());

  $("#historyDate").addEventListener("change", async (event) => {
    state.historyDate = event.target.value || state.historyDate;
    await renderDayViews();
  });

  $("#mealTemplate").addEventListener("change", (event) => {
    const template = state.templates.find((item) => item.id === event.target.value);
    if (!template) return;
    $("#mealName").value = template.name;
    $("#mealCalories").value = template.calories;
    $("#mealProtein").value = template.protein;
    $("#mealFat").value = template.fat;
  });

  $("#mealForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const originalDate = mealDateFromContext();
    const input = {
      datetime: $("#mealTime").value,
      name: $("#mealName").value.trim(),
      ...readMacroFields("meal"),
    };
    const selectedDate = input.datetime.slice(0, 10);
    if (state.mealDialogContext?.mealId) {
      if (selectedDate !== originalDate) {
        await deleteMeal(originalDate, state.mealDialogContext.mealId);
        await addMeal(selectedDate, input);
      } else {
        await updateMeal(originalDate, state.mealDialogContext.mealId, input);
      }
    } else {
      await addMeal(selectedDate, input);
    }
    $("#mealDialog").close();
    await renderDayViews();
    showToast("保存しました");
  });

  $("#templateForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    await saveTemplate({
      id: state.templateEditingId,
      name: $("#templateName").value.trim(),
      ...readMacroFields("template"),
    });
    $("#templateDialog").close();
    await refreshTemplates();
    showToast("保存しました");
  });

  setupNoteAutosave("todayNote", () => state.todayDate);
  setupNoteAutosave("historyNote", () => state.historyDate);

  $("#exportButton").addEventListener("click", exportBackup);
  $("#importFile").addEventListener("change", importBackup);
}

// Notes are saved automatically per day. The short delay avoids writing to
// IndexedDB on every keystroke while still feeling instant on mobile.
function setupNoteAutosave(elementId, getDate) {
  $(`#${elementId}`).addEventListener("input", (event) => {
    window.clearTimeout(state.noteTimers[elementId]);
    state.noteTimers[elementId] = window.setTimeout(async () => {
      await updateNote(getDate(), event.target.value);
      await renderDayViews();
      showToast("備考を保存しました");
    }, 500);
  });
}

// Backup data intentionally mirrors the storage shape. This keeps restore simple
// and gives future migrations a clear version field to branch on.
async function exportBackup() {
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mealtrack-backup-${toDateKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    await importAllData(payload);
    await refreshTemplates();
    await renderDayViews();
    $("#backupDialog").close();
    showToast("インポートしました");
  } catch (error) {
    alert(error.message || "インポートに失敗しました。");
  } finally {
    event.target.value = "";
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

async function init() {
  setupEventListeners();
  state.templates = await ensureDefaultTemplates();
  await refreshTemplates();
  await renderDayViews();
  await registerServiceWorker();
}

init();
