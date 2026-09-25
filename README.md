# jadeshell.app

The website of [Jade Shell](https://github.com/parvezrob/jade-shell): <https://jadeshell.app>.

A single static page (`public/index.html`) with its screenshots, demo video and fonts. No build
step, no trackers, nothing loaded from other sites. It is served by Cloudflare (Workers static
assets), configured in `wrangler.jsonc`.

## Preview and deploy

```bash
python3 -m http.server 8000 --directory public   # then open http://localhost:8000
npx wrangler deploy                               # publish (needs `npx wrangler login` once)
```

## What's in `public/`

- `index.html`: the page. The theme slider shows 21 themes on 8 screens (`shots/<theme>-<screen>.webp`,
  1800 px, with 480 px copies in `shots/thumb/`).
- `video/demo.mp4`: a screen recording of the Shell, with `demo-poster.webp`.
- `fonts/`: Geist and JetBrains Mono (latin, variable), both under the SIL Open Font License.
- `og.png`: the picture link previews show. `_headers`: caching and security headers.

The screenshots and the recording are of the real Shell.

## Credits

Themes and their wallpapers come from [Omarchy](https://omarchy.org) by DHH and Basecamp; the
Mac-style icons in the screenshots are [MacTahoe](https://github.com/vinceliuice/MacTahoe-icon-theme)
by Vince Liuice. Jade Shell is an independent project, not affiliated with Omarchy, Basecamp or
GNOME.

The page's code is GPL-3.0-or-later, like Jade Shell (`LICENSE`). The wallpapers and icons shown in
the screenshots keep their own authors' terms.
