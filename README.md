# Markdown for Slack

A static, browser-only Markdown converter for pasting into Slack's normal rich text composer. Input stays in the browser. No API, account, server-side conversion, or build step is required.

## Use

Serve this directory over HTTP locally, or HTTPS in production:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`, paste Markdown on the left, and copy the converted preview. The rich copy button writes both `text/html` and `text/plain`. The text button preserves list markers, numbering, quote markers, and link destinations without formatting.

Slack's **Format messages with markup** preference must be off to retain rich formatting. Clipboard import and font spacing can vary across Slack clients; the preview represents the supported content and formatting, not a pixel-identical Slack renderer. This app does not publish messages or generate Slack API payloads.

## Conversion rules

| Input | Output |
| --- | --- |
| H1–H6 and setext headings | Body-sized bold paragraphs |
| GFM tables | One paragraph per row, with bold column labels; empty cells remain present |
| Optional table mode | Monospace code block, with approximate Japanese/emoji column widths |
| Bold, italic, strike, links, quotes | Equivalent supported formatting |
| Ordered and nested lists | Lists retaining their starting numbers and hierarchy |
| Tasks | Literal `☐` / `☑` markers in list items |
| Inline and fenced/indented code | Literal code content; no syntax highlighting |
| Images | Description linked to the image URL; no image is fetched |
| Horizontal rules | Literal `────────` |
| Raw HTML | Visible literal text, except standalone `<br>` tags become line breaks |
| Unsafe or relative link destinations | Visible text rather than active links |
| Other unsupported syntax | Literal text fallback |

The converter parses Markdown into tokens, normalizes those tokens into a limited block/inline model, and derives both preview HTML and plain text from that model. HTML tags are generated only from a closed vocabulary. Input text and attributes are escaped, and links allow only absolute HTTP(S) and mailto URLs. Conversion notices are outside the copied content. The original editor text is never rewritten.

## Development and deployment

```sh
npm ci
npm test
```

Deploy `index.html`, `styles.css`, `app.js`, `clipboard.js`, `converter.js`, and the `vendor/` directory together. Serve JavaScript modules with a JavaScript MIME type. Node.js and `node_modules/` are not needed on the host. Opening `index.html` via `file://` is not supported because it uses browser modules.

Marked is pinned and vendored locally to avoid runtime CDN requests and unreviewed parser upgrades. After intentionally changing its version, run `npm run vendor`, commit the lockfile and vendor files, and rerun the tests. Tests require Node.js 20 or later.

The automated suite covers conversion, information preservation, unsafe input, clipboard payloads, and the copy fallback. Browser acceptance should also check real clipboard HTML/plain text, narrow-screen layout, and pasting into a Slack draft without sending it.
