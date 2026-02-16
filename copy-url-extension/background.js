chrome.commands.onCommand.addListener(async (command) => {
  if (command === "copy-url") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    // Inject a content script to copy to clipboard (requires user gesture via command)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (url) => {
        navigator.clipboard.writeText(url).then(() => {
          // Show a brief toast notification
          const toast = document.createElement("div");
          toast.textContent = "✓ URL copied";
          Object.assign(toast.style, {
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#333",
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
        });
      },
      args: [tab.url],
    });
  }
});
