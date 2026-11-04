// Translations the app offers, in the order Settings shows them. BSB, KJV and WEB are public domain.
// ESV is Crossway's API through the Worker's /api/passage proxy (needs your own ESV_API_KEY secret, see README).
// 'ESV(L)' is for a copy of a licensed text you bundle yourself in public/esv/ (see README); the repository ships none.
// With more than one entry, Settings shows a translation switch.
export const ENABLED = ['BSB', 'KJV', 'WEB', 'ESV']
export const DEFAULT_TRANSLATION = 'BSB'
// The Share button on each card. The code stays in app.js; set this to true to bring the button back.
export const SHOW_SHARE = false
// The Ask button on each card: questions about the passage, answered by Workers AI through /api/ask.
export const SHOW_ASK = true
