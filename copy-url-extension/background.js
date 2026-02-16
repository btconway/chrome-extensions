chrome.commands.onCommand.addListener(async (command) => {
  if (command === "copy-url") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url) {
      showBadgeError();
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "ISOLATED",
        func: (url) => {
          navigator.clipboard
            .writeText(url)
            .then(() => {
              showToast("✓ URL copied", "#333");
            })
            .catch(() => {
              showToast("✗ Failed to copy URL", "#c0392b");
            });

          function showToast(message, bg) {
            document.getElementById("__copy-url-toast")?.remove();
            const toast = document.createElement("div");
            toast.id = "__copy-url-toast";
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            toast.textContent = message;
            Object.assign(toast.style, {
              position: "fixed",
              bottom: "24px",
              right: "24px",
              background: bg,
              color: "#fff",
              padding: "10px 18px",
              borderRadius: "8px",
              fontSize: "14px",
              fontFamily: "system-ui, sans-serif",
              zIndex: "2147483647",
              opacity: "0",
              transition: "opacity 0.2s ease",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            });
            document.body.appendChild(toast);
            requestAnimationFrame(() => (toast.style.opacity = "1"));
            setTimeout(() => {
              toast.style.opacity = "0";
              setTimeout(() => toast.remove(), 200);
            }, 1500);
          }
        },
        args: [tab.url],
      });
    } catch (e) {
      // Can't inject into restricted pages (chrome://, chrome-extension://, etc.)
      showBadgeError();
    }
  }
});

function showBadgeError() {
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}
