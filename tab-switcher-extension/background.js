// MRU tab history — most recent at index 0
let tabHistory = [];
let tabCache = new Map(); // id -> { title, favIconUrl }
let switcherActive = false;
let selectedIndex = 0;
let dismissTimer = null;
let activeTabInfos = null; // cached during a switcher session
let sessionTabId = null; // tab ID where the overlay is shown
const DISMISS_DELAY = 1200;

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

  if (switcherActive && activeTabInfos) {
    const removedIdx = activeTabInfos.findIndex((t) => t.id === tabId);
    if (removedIdx !== -1) {
      activeTabInfos = activeTabInfos.filter((t) => t.id !== tabId);
      if (activeTabInfos.length < 2) {
        clearTimeout(dismissTimer);
        activateSelected();
        return;
      }
      if (selectedIndex >= activeTabInfos.length) {
        selectedIndex = activeTabInfos.length - 1;
      }
    }
  }
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
  } catch (e) {
    console.warn("tab-switcher: cacheTab failed", e);
  }
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

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// --- Switcher logic ---

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "switch-to-last-tab") return;

  if (tabHistory.length < 2) {
    const tab = await getCurrentTab();
    if (tab) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "ISOLATED",
          func: () => {
            const toast = document.createElement("div");
            toast.textContent = "No other tabs";
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            Object.assign(toast.style, {
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(40,40,40,0.92)",
              color: "rgba(255,255,255,0.8)",
              padding: "12px 24px",
              borderRadius: "12px",
              fontSize: "14px",
              fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
              zIndex: "2147483647",
              opacity: "0",
              transition: "opacity 0.15s ease",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            });
            document.body.appendChild(toast);
            requestAnimationFrame(() => (toast.style.opacity = "1"));
            setTimeout(() => {
              toast.style.opacity = "0";
              setTimeout(() => toast.remove(), 150);
            }, 1000);
          },
        });
      } catch (e) {
        console.warn("tab-switcher: single-tab toast failed", e);
      }
    }
    return;
  }

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
    if (!activeTabInfos) return;
    selectedIndex = (selectedIndex + 1) % activeTabInfos.length;
    updateOverlay(selectedIndex);
  }

  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => activateSelected(), DISMISS_DELAY);
});

async function showOverlay(tabInfos, selectedIdx) {
  const currentTab = await getCurrentTab();
  if (!currentTab) return;
  sessionTabId = currentTab.id;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: sessionTabId },
      world: "ISOLATED",
      func: injectOverlay,
      args: [tabInfos, selectedIdx, sessionTabId],
    });
  } catch (e) {
    console.warn("tab-switcher: showOverlay failed", e);
    switcherActive = false;
    activeTabInfos = null;
    sessionTabId = null;
    clearTimeout(dismissTimer);
    if (tabInfos[1]) {
      await chrome.tabs.update(tabInfos[1].id, { active: true });
    }
  }
}

async function updateOverlay(selectedIdx) {
  if (!sessionTabId) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: sessionTabId },
      world: "ISOLATED",
      func: (idx) => {
        const items = document.querySelectorAll("#__tab-switcher-overlay .tab-item");
        items.forEach((el, i) => {
          const isSel = i === idx;
          el.classList.toggle("selected", isSel);
          el.setAttribute("aria-selected", String(isSel));
        });
        items[idx]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      },
      args: [selectedIdx],
    });
  } catch (e) {
    console.warn("tab-switcher: updateOverlay failed", e);
  }
}

async function activateSelected() {
  const target = activeTabInfos?.[selectedIndex];
  const overlayTabId = sessionTabId;
  switcherActive = false;
  selectedIndex = 0;
  activeTabInfos = null;
  sessionTabId = null;

  if (overlayTabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: overlayTabId },
        world: "ISOLATED",
        func: () => document.getElementById("__tab-switcher-overlay")?.remove(),
      });
    } catch (e) {
      console.warn("tab-switcher: overlay removal failed", e);
    }
  }

  if (target) {
    try {
      await chrome.tabs.update(target.id, { active: true });
      const tab = await chrome.tabs.get(target.id);
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      console.warn("tab-switcher: tab activation failed", e);
    }
  }
}

// --- Injected overlay ---

function injectOverlay(tabInfos, selectedIdx, currentTabId) {
  document.getElementById("__tab-switcher-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "__tab-switcher-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Tab switcher");

  const style = document.createElement("style");
  style.textContent = [
    "#__tab-switcher-overlay {",
    "  position: fixed; inset: 0; z-index: 2147483647;",
    "  display: flex; align-items: center; justify-content: center;",
    "  background: rgba(0,0,0,0.55);",
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
    "#__tab-switcher-overlay .tab-item.current .tab-title::after {",
    '  content: " (current)"; opacity: 0.5;',
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
  container.setAttribute("role", "listbox");
  container.setAttribute("aria-label", "Recent tabs");

  tabInfos.forEach((tab, i) => {
    const isSelected = i === selectedIdx;
    const isCurrent = tab.id === currentTabId;
    const item = document.createElement("div");
    item.className = "tab-item" + (isSelected ? " selected" : "") + (isCurrent ? " current" : "");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(isSelected));

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
