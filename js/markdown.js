export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

// Small markdown subset: headings, bullet and numbered lists, paragraphs, inline bold/italic/code/links.
export function md(text) {
  const lines = String(text || '').split(/\r?\n/);
  let html = '', list = null, para = [];
  const flushP = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
  const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushP(); closeList(); continue; }
    const h = /^(#{1,6})\s+(.*)/.exec(line);
    const ul = /^[-*•]\s+(.*)/.exec(line);
    const ol = /^\d+[.)]\s+(.*)/.exec(line);
    if (h) {
      flushP(); closeList();
      const lvl = Math.min(h[1].length + 1, 4);
      html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>';
    } else if (ul) {
      flushP();
      if (list !== 'ul') { closeList(); list = 'ul'; html += '<ul>'; }
      html += '<li>' + inline(ul[1]) + '</li>';
    } else if (ol) {
      flushP();
      if (list !== 'ol') { closeList(); list = 'ol'; html += '<ol>'; }
      html += '<li>' + inline(ol[1]) + '</li>';
    } else {
      closeList();
      para.push(line);
    }
  }
  flushP(); closeList();
  return html;
}
