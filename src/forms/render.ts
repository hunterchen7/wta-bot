import type { Field } from './schema';

// Server-rendered pages for the form rail + dashboard (DESIGN §5, §10).
// One shared skeleton: mobile-first, dark-mode aware, zero client JS beyond
// tiny inline sprinkles. No frameworks, no build step.

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function page(title: string, body: string, opts: { wide?: boolean } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · WTA</title>
<style>
  :root { color-scheme: light dark; --accent: #6d5ae8; --muted: #8a8a93; --line: color-mix(in srgb, currentColor 16%, transparent); }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: ${opts.wide ? '64rem' : '44rem'}; margin: 0 auto; padding: 1.2rem 1rem 4rem; line-height: 1.55; }
  h1 { font-size: 1.45rem; margin: .8rem 0 .2rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  .sub { color: var(--muted); margin: 0 0 1.2rem; }
  .card { border: 1px solid var(--line); border-radius: 14px; padding: 1.1rem 1.2rem; margin: .9rem 0; }
  label.f { display: block; font-weight: 600; margin: 1.1rem 0 .3rem; }
  .help { color: var(--muted); font-size: .86rem; margin: .1rem 0 .4rem; }
  input[type=text], input[type=url], input[type=email], select, textarea {
    width: 100%; padding: .55rem .7rem; border: 1px solid var(--line); border-radius: 9px;
    background: transparent; color: inherit; font: inherit;
  }
  textarea { min-height: 6.5rem; }
  textarea.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: .85rem; line-height: 1.55; min-height: 13rem;
    background: color-mix(in srgb, currentColor 7%, transparent);
    border-color: color-mix(in srgb, currentColor 22%, transparent);
    white-space: pre; overflow-x: auto; tab-size: 2; resize: vertical;
  }
  pre.code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: .85rem; background: color-mix(in srgb, currentColor 7%, transparent);
    border: 1px solid var(--line); border-radius: 10px; padding: .7rem .9rem;
    overflow-x: auto; tab-size: 2;
  }
  .opts { display: flex; flex-wrap: wrap; gap: .4rem .9rem; } .opts label { font-weight: 400; }
  .scale { display: flex; gap: 1rem; } .scale label { display: flex; flex-direction: column; align-items: center; font-size: .85rem; }
  button, .btn { background: var(--accent); border: 0; color: #fff; padding: .65rem 1.4rem; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
  .btn.ghost { background: transparent; color: inherit; border: 1px solid var(--line); }
  .err { border: 1px solid #c0392b88; background: #c0392b14; border-radius: 10px; padding: .7rem 1rem; }
  .ok { border: 1px solid #27ae6088; background: #27ae6014; border-radius: 10px; padding: .7rem 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; } th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  .tag { display: inline-block; padding: .05rem .5rem; border-radius: 99px; border: 1px solid var(--line); font-size: .8rem; }
  nav.top { display: flex; gap: 1rem; padding: .6rem 0; border-bottom: 1px solid var(--line); font-size: .92rem; flex-wrap: wrap; }
  nav.top a { color: inherit; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: .9em; }
</style>
</head>
<body>${body}
<script>
// Code boxes: Tab inserts spaces instead of moving focus.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Tab' && t instanceof HTMLTextAreaElement && t.classList.contains('mono')) {
    e.preventDefault();
    const s = t.selectionStart, en = t.selectionEnd;
    t.value = t.value.slice(0, s) + '  ' + t.value.slice(en);
    t.selectionStart = t.selectionEnd = s + 2;
  }
});
</script>
</body>
</html>`;
}

export function renderField(f: Field, value?: string): string {
  const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
  const req = f.required ? ' <span class="help">(required)</span>' : '';
  const head = `<label class="f" for="${f.id}">${esc(f.label)}${req}</label>${help}`;
  switch (f.type) {
    case 'text':
    case 'url':
      return `${head}<input type="${f.type}" id="${f.id}" name="${f.id}" value="${esc(value ?? '')}" ${f.required ? 'required' : ''}>`;
    case 'textarea': {
      const codeAttrs = f.mono
        ? ' class="mono" spellcheck="false" autocapitalize="off" autocorrect="off" wrap="off" placeholder="// paste your solution as-is — formatting is preserved"'
        : '';
      return `${head}<textarea id="${f.id}" name="${f.id}" ${f.required ? 'required' : ''}${codeAttrs}>${esc(value ?? '')}</textarea>`;
    }
    case 'select':
      return `${head}<select id="${f.id}" name="${f.id}" ${f.required ? 'required' : ''}>
        <option value="">— pick one —</option>
        ${(f.options ?? []).map((o) => `<option value="${esc(o.value)}" ${value === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>`;
    case 'radio':
      return `${head}<div class="opts">${(f.options ?? [])
        .map(
          (o) =>
            `<label><input type="radio" name="${f.id}" value="${esc(o.value)}" ${value === o.value ? 'checked' : ''} ${f.required ? 'required' : ''}> ${esc(o.label)}</label>`,
        )
        .join('')}</div>`;
    case 'scale':
      return `${head}<div class="scale">${[1, 2, 3, 4, 5]
        .map(
          (n) =>
            `<label><input type="radio" name="${f.id}" value="${n}" ${value === String(n) ? 'checked' : ''} ${f.required ? 'required' : ''}>${n}</label>`,
        )
        .join('')}</div>`;
  }
}

export { esc };
