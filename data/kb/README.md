# Knowledge base

One `.md` file per saved Westpac public page. The assistant answers only from these.

The files are written by `npm run kb` (`scripts/fetch-kb.mjs`), which reads the pages listed at the
top of that script from westpac.com.au. To add a page, add it to the list and run the command again.

Each file starts with header lines, then the page text. Blank lines split it into passages.

```
title: Applying for Financial Hardship Support
url: https://www.westpac.com.au/...
topic: hardship
fetched: 2026-11-15
---
Heading: the text under that heading.
```

The text belongs to Westpac. It is here only as source material for the prototype. Every answer
links back to the page it came from.
