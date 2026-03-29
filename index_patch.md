# index.html — Targeted Changes for Railway Premium Check

## Overview
Replace the `premiumlist.js` GitHub script with a Railway API call.
Only **2 changes** needed in index.html. Everything else stays identical.

---

## CHANGE 1 — Replace premiumlist.js script tag

**Find this (around line 898):**
```html
  <script src="premiumlist.js"></script>
  <script src="premium.js"></script>
```

**Replace with:**
```html
  <!-- premiumlist.js replaced by Railway MySQL API -->
  <script src="premium.js"></script>
  <script>
    // ── Railway URL — update this when your Railway app URL changes ──
    const RAILWAY_URL = "https://YOUR_RAILWAY_URL_HERE";
    // premiumUsers array kept for backward compatibility (filled by API below)
    window.premiumUsers = [];
  </script>
```

---

## CHANGE 2 — Replace the renderPremiumLinks / addEditCryptoButton call block

**Find this (around lines 1131–1133):**
```javascript
    renderFreeLinks();
    renderPremiumLinks();
    renderDonationInfo();
```

**Replace with:**
```javascript
    renderFreeLinks();
    renderDonationInfo();

    // ── Check premium from Railway DB, then render ──
    (async function checkPremiumAndRender() {
      if (!telegramId) {
        renderPremiumLinks();
        return;
      }
      try {
        const res  = await fetch(`${RAILWAY_URL}/premium/check/${telegramId}`);
        const data = await res.json();
        if (data.isPremium) {
          // Fill global array so existing code (addEditCryptoButton etc.) still works
          window.premiumUsers = [telegramId];
          addEditCryptoButton();
        }
      } catch (e) {
        console.warn("Premium API unreachable, falling back to empty:", e.message);
      }
      renderPremiumLinks();
    })();
```

---

## Notes
- `RAILWAY_URL` must be your actual Railway public URL, no trailing slash.
  Example: `https://intel-premium.up.railway.app`
- The `window.premiumUsers = [telegramId]` trick keeps all existing
  `premiumUsers.includes(telegramId)` checks working without touching them.
- No other lines need to change in index.html.
