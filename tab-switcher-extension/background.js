// MRU tab history — most recent at index 0
let tabHistory = [];
let tabCache = new Map(); // id -> { title, favIconUrl }
let switcherActive = false;
let selectedIndex = 0;
let dismissTimer = null;
let activeTabInfos = null; // cached during a switcher session
const DISMISS_DELAY = 800;

// --- Tab tracking ---

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (switcherActive) return;
  pushToFront(tabId);
  cacheTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.title || changeInfo.favIconUrl) {
    const entry = tabCache.get(tabId) || {};
    if (changeInfo.title) entry.title = changeInfo.title;
    if (changeInfo.favIconUrl) entry.favIconUrl = changeInfo.favIconUrl;
    tabCache.set(tabId, entry);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabHistory = tabHistory.filter((id) => id !== tabId);
  tabCache.delete(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (switcherActive || windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) {
    pushToFront(tab.id);
    cacheTab(tab.id);
  }
});

function pushToFront(tabId) {
  tabHistory = tabHistory.filter((id) => id !== tabId);
  tabHistory.unshift(tabId);
  if (tabHistory.length > 20) tabHistory.length = 20;
}

async function cacheTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    tabCache.set(tabId, {
      title: tab.title || "Untitled",
      favIconUrl: tab.favIconUrl || "",
    });
  } catch {}
}

// Initialize
chrome.tabs.query({}, (tabs) => {
  const active = tabs.filter((t) => t.active);
  const rest = tabs.filter((t) => !t.active);
  tabHistory = [...active.map((t) => t.id), ...rest.map((t) => t.id)];
  tabs.forEach((t) => {
    tabCache.set(t.id, {
      title: t.title || "Untitled",
      favIconUrl: t.favIconUrl || "",
    });
  });
});

// --- Switcher logic ---

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "switch-to-last-tab") return;
  if (tabHistory.length < 2) return;

  if (!switcherActive) {
    activeTabInfos = tabHistory
      .map((id) => {
        const cached = tabCache.get(id);
        if (!cached) return null;
        return { id, title: cached.title, favIconUrl: cached.favIconUrl };
      })
      .filter(Boolean);

    if (activeTabInfos.length < 2) return;

    switcherActive = true;
    selectedIndex = 1;
    showOverlay(activeTabInfos, selectedIndex);
  } else {
    selectedIndex = (selectedIndex + 1) % activeTabInfos.length;
    updateOverlay(selectedIndex);
  }

  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => activateSelected(), DISMISS_DELAY);
});

async function showOverlay(tabInfos, selectedIdx) {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!currentTab) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: injectOverlay,
      args: [tabInfos, selectedIdx],
    });
  } catch {
    switcherActive = false;
    activeTabInfos = null;
    clearTimeout(dismissTimer);
    if (tabInfos[1]) {
      await chrome.tabs.update(tabInfos[1].id, { active: true });
    }
  }
}

async function updateOverlay(selectedIdx) {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!currentTab) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: (idx) => {
        const items = document.querySelectorAll("#__tab-switcher-overlay .tab-item");
        items.forEach((el, i) => el.classList.toggle("selected", i === idx));
        items[idx]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      },
      args: [selectedIdx],
    });
  } catch {}
}

async function activateSelected() {
  const target = activeTabInfos?.[selectedIndex];
  switcherActive = false;
  selectedIndex = 0;
  activeTabInfos = null;

  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentTab) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => document.getElementById("__tab-switcher-overlay")?.remove(),
      });
    } catch {}
  }

  if (target) {
    try {
      await chrome.tabs.update(target.id, { active: true });
      const tab = await chrome.tabs.get(target.id);
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {}
  }
}

// --- Injected overlay ---

function injectOverlay(tabInfos, selectedIdx) {
  document.getElementById("__tab-switcher-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "__tab-switcher-overlay";

  const style = document.createElement("style");
  style.textContent = [
    "#__tab-switcher-overlay {",
    "  position: fixed; inset: 0; z-index: 2147483647;",
    "  display: flex; align-items: center; justify-content: center;",
    "  background: rgba(0,0,0,0.35);",
    "  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);",
    "  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;",
    "  animation: __ts-fadeIn 0.12s ease;",
    "}",
    "@keyframes __ts-fadeIn { from { opacity: 0; } to { opacity: 1; } }",
    "#__tab-switcher-overlay .switcher-container {",
    "  display: flex; gap: 6px; padding: 14px 16px;",
    "  background: rgba(40,40,40,0.92); border-radius: 16px;",
    "  box-shadow: 0 24px 80px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.1) inset;",
    "  max-width: 85vw; overflow-x: auto; scrollbar-width: none;",
    "}",
    "#__tab-switcher-overlay .switcher-container::-webkit-scrollbar { display: none; }",
    "#__tab-switcher-overlay .tab-item {",
    "  display: flex; flex-direction: column; align-items: center; gap: 8px;",
    "  padding: 10px 8px 8px; border-radius: 12px;",
    "  min-width: 96px; max-width: 96px; cursor: default;",
    "  border: 2px solid transparent; transition: all 0.1s ease;",
    "}",
    "#__tab-switcher-overlay .tab-item.selected {",
    "  background: rgba(255,255,255,0.13); border-color: rgba(255,255,255,0.4);",
    "}",
    "#__tab-switcher-overlay .tab-icon {",
    "  width: 48px; height: 48px; border-radius: 10px;",
    "  background: rgba(255,255,255,0.08);",
    "  display: flex; align-items: center; justify-content: center;",
    "  overflow: hidden; flex-shrink: 0;",
    "}",
    "#__tab-switcher-overlay .tab-icon img { width: 32px; height: 32px; }",
    "#__tab-switcher-overlay .tab-icon .fallback {",
    "  font-size: 22px; color: rgba(255,255,255,0.6); font-weight: 600;",
    "}",
    "#__tab-switcher-overlay .tab-title {",
    "  font-size: 11px; color: rgba(255,255,255,0.8); text-align: center;",
    "  line-height: 1.3; max-height: 2.6em; overflow: hidden;",
    "  text-overflow: ellipsis; display: -webkit-box;",
    "  -webkit-line-clamp: 2; -webkit-box-orient: vertical;",
    "  width: 100%; word-break: break-word;",
    "}",
  ].join("\n");

  const container = document.createElement("div");
  container.className = "switcher-container";

  tabInfos.forEach((tab, i) => {
    const item = document.createElement("div");
    item.className = "tab-item" + (i === selectedIdx ? " selected" : "");

    const icon = document.createElement("div");
    icon.className = "tab-icon";
    const initial = tab.title.charAt(0).toUpperCase();

    if (tab.favIconUrl) {
      const img = document.createElement("img");
      img.src = tab.favIconUrl;
      img.onerror = function () {
        const fallback = document.createElement("span");
        fallback.className = "fallback";
        fallback.textContent = initial;
        icon.replaceChildren(fallback);
      };
      icon.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "fallback";
      fallback.textContent = initial;
      icon.appendChild(fallback);
    }

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title;

    item.appendChild(icon);
    item.appendChild(title);
    container.appendChild(item);
  });

  overlay.appendChild(style);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  container.children[selectedIdx]?.scrollIntoView({ inline: "center", block: "nearest" });
}
