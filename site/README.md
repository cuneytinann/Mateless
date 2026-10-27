# site/: the sources of index.html

`index.html` is the whole site in one file. It is built from this folder by
`node tools/build-site.js` (and `node tools/build-site.js --check` says whether it is up to date;
`test/build_check.js` asks that too). Edit the sources here, never `index.html`.

```
head.html, head-comment.txt   the page's <head> and the comment at its top (licences follow it)
site.css                      the look every tab shares: colours, type, forms, boards, tables
shell.html, shell.css         the bar (tabs, language, download) and the five tab containers
shell.js                      the frame: which tab shows, the language, the address
arbiter/                      the arbiter: arbiter.html, arbiter.css, arbiter.js
lock/                         the lock detector explained: lock.html, lock.css, lock.js, and
                              lockviz.js, a display copy of the detector (test/lockviz_check.js)
rules/                        the rules (FIDE 5.2.2, 6.9, 5.1.2): rules.html, rules.css
scan/                         the Lichess scan: scan.html, scan.css, scan.js on the page;
                              scan-core.js and worker-glue.js in the workers; fzstd.js (MIT)
chasolver/                    chasolver 3.0.0's JavaScript port: engine.js and glue.js (MIT,
                              LICENSE.txt), the tab's chasolver.html, chasolver.css, chasolver.js
```

How the page is put together:
- **One engine each.** `mateless.js` is embedded once, as `<script id="mateless-engine">`;
  chasolver's port once, as `<script id="cha-engine">`. The arbiter, the lock tab and the scan
  use the first; the chasolver tab and the scan use the second. Workers are started from the
  text of those same scripts, so a worker always runs the page's engines.
- **Tabs do not touch each other.** Each tab's style sheet is scoped to its container
  (`#tab-arbiter`, `#tab-lock`, `#tab-rules`, `#tab-scan`, `#tab-chasolver`) when the page is
  built; ids are unique across tabs (chasolver's start with `cha-`, the scan's with `scan-`, the
  rules' anchors with `r-`); each tab's script looks only inside its own container.
- **The address.** `#arbiter` (the default), `#lock`, `#rules`, `#scan`, `#chasolver`;
  `#chasolver?fen=…&side=white|black` hands a position to chasolver; `#<id>` of anything inside
  a tab opens that tab and scrolls there.
- **Two languages.** English unless the reader chooses Turkish (kept in the browser as
  `mateless-lang`). The arbiter and chasolver keep their texts in dictionaries; the lock tab, the
  rules and the scan write each text twice, `lang="en"` and `lang="tr"`, and the page shows the
  chosen one. A script that writes text asks `MatelessSite.lang` and listens with
  `MatelessSite.onLang`.
