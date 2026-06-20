const DB_NAME = "mealtrack-db";
const DB_VERSION = 1;
const DAY_STORE = "days";
const TEMPLATE_STORE = "templates";

let dbPromise;

// Data access is isolated in this module so a future Firebase adapter can expose
// the same functions without changing the UI layer.
function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DAY_STORE)) {
        db.createObjectStore(DAY_STORE, { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains(TEMPLATE_STORE)) {
        db.createObjectStore(TEMPLATE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function transaction(storeName, mode = "readonly") {
  return openDatabase().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyDay(date) {
  return {
    date,
    meals: [],
    summary: { calories: 0, protein: 0, fat: 0 },
    note: "",
    updatedAt: new Date().toISOString(),
  };
}

export function calculateSummary(meals = []) {
  return meals.reduce(
    (summary, meal) => ({
      calories: summary.calories + Number(meal.calories || 0),
      protein: summary.protein + Number(meal.protein || 0),
      fat: summary.fat + Number(meal.fat || 0),
    }),
    { calories: 0, protein: 0, fat: 0 }
  );
}

export async function getDay(date) {
  const store = await transaction(DAY_STORE);
  const day = await promisifyRequest(store.get(date));
  return day || emptyDay(date);
}

export async function saveDay(day) {
  const store = await transaction(DAY_STORE, "readwrite");
  const nextDay = {
    ...emptyDay(day.date),
    ...day,
    summary: calculateSummary(day.meals || []),
    updatedAt: new Date().toISOString(),
  };
  await promisifyRequest(store.put(nextDay));
  return nextDay;
}

export async function addMeal(date, mealInput) {
  const day = await getDay(date);
  const meal = { ...mealInput, id: newId("meal"), createdAt: new Date().toISOString() };
  return saveDay({ ...day, meals: [...day.meals, meal] });
}

export async function updateMeal(date, mealId, mealInput) {
  const day = await getDay(date);
  const meals = day.meals.map((meal) =>
    meal.id === mealId ? { ...meal, ...mealInput, updatedAt: new Date().toISOString() } : meal
  );
  return saveDay({ ...day, meals });
}

export async function deleteMeal(date, mealId) {
  const day = await getDay(date);
  return saveDay({ ...day, meals: day.meals.filter((meal) => meal.id !== mealId) });
}

export async function updateNote(date, note) {
  const day = await getDay(date);
  return saveDay({ ...day, note });
}

export async function getTemplates() {
  const store = await transaction(TEMPLATE_STORE);
  const templates = await promisifyRequest(store.getAll());
  return templates.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export async function saveTemplate(templateInput) {
  const store = await transaction(TEMPLATE_STORE, "readwrite");
  const template = {
    id: templateInput.id || newId("tpl"),
    name: templateInput.name,
    calories: Number(templateInput.calories || 0),
    protein: Number(templateInput.protein || 0),
    fat: Number(templateInput.fat || 0),
    updatedAt: new Date().toISOString(),
  };
  await promisifyRequest(store.put(template));
  return template;
}

export async function deleteTemplate(id) {
  const store = await transaction(TEMPLATE_STORE, "readwrite");
  await promisifyRequest(store.delete(id));
}

export async function ensureDefaultTemplates() {
  const existing = await getTemplates();
  if (existing.length > 0) return existing;

  await saveTemplate({ name: "プロテイン", calories: 120, protein: 24, fat: 1 });
  await saveTemplate({ name: "サラダチキン", calories: 120, protein: 25, fat: 1 });
  return getTemplates();
}

export async function exportAllData() {
  const dayStore = await transaction(DAY_STORE);
  const templateStore = await transaction(TEMPLATE_STORE);
  const [days, templates] = await Promise.all([
    promisifyRequest(dayStore.getAll()),
    promisifyRequest(templateStore.getAll()),
  ]);
  return {
    app: "MealTrack",
    version: 1,
    exportedAt: new Date().toISOString(),
    days,
    templates,
  };
}

export async function importAllData(payload) {
  if (!payload || !Array.isArray(payload.days) || !Array.isArray(payload.templates)) {
    throw new Error("MealTrackのバックアップJSONではありません。");
  }

  const db = await openDatabase();
  const tx = db.transaction([DAY_STORE, TEMPLATE_STORE], "readwrite");
  const dayStore = tx.objectStore(DAY_STORE);
  const templateStore = tx.objectStore(TEMPLATE_STORE);

  payload.days.forEach((day) => {
    if (day.date) {
      dayStore.put({
        ...emptyDay(day.date),
        ...day,
        summary: calculateSummary(day.meals || []),
        updatedAt: new Date().toISOString(),
      });
    }
  });

  payload.templates.forEach((template) => {
    if (template.id && template.name) templateStore.put(template);
  });

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
