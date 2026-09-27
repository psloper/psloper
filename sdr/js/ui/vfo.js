// Ten-digit VFO readout (G.MMM.kkk.hhh). Scroll, click the top/bottom half, or use arrow keys on a digit.

export class FreqDisplay {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.value = 0;
    this.focusDigit = 3;
    this.digits = [];
    for (let i = 9; i >= 0; i--) {
      const d = document.createElement('span');
      d.className = 'd';
      d.dataset.p = i;
      this.digits[i] = d;
      el.appendChild(d);
      if (i === 9 || i === 6 || i === 3) {
        const s = document.createElement('span');
        s.className = 'sep';
        s.textContent = '.';
        el.appendChild(s);
      }
    }
    const digitAt = (e) => e.target.closest('.d');
    el.addEventListener('wheel', (e) => {
      const d = digitAt(e);
      if (!d) return;
      e.preventDefault();
      this.focusDigit = +d.dataset.p;
      this.bump(this.focusDigit, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    el.addEventListener('click', (e) => {
      const d = digitAt(e);
      if (!d) return;
      const r = d.getBoundingClientRect();
      this.focusDigit = +d.dataset.p;
      this.bump(this.focusDigit, e.clientY < r.top + r.height / 2 ? 1 : -1);
    });
    el.addEventListener('mouseover', (e) => { const d = digitAt(e); if (d) this.focusDigit = +d.dataset.p; });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        this.bump(this.focusDigit, e.key === 'ArrowUp' ? 1 : -1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        this.focusDigit = Math.max(0, Math.min(9, this.focusDigit + (e.key === 'ArrowLeft' ? 1 : -1)));
        this.render();
      }
    });
  }

  bump(p, dir) { this.onChange(this.value + dir * 10 ** p); }

  set(f) {
    if (f === this.value) return;
    this.value = f;
    this.render();
    this.el.classList.remove('flash');
    void this.el.offsetWidth;
    this.el.classList.add('flash');
  }

  render() {
    const s = String(Math.round(this.value)).padStart(10, '0');
    let leading = true;
    for (let i = 9; i >= 0; i--) {
      const ch = s[9 - i];
      if (ch !== '0' || i <= 6) leading = false;
      const d = this.digits[i];
      d.textContent = ch;
      d.classList.toggle('lz', leading);
      d.style.textDecoration = document.activeElement === this.el && i === this.focusDigit ? 'underline' : '';
    }
  }
}
