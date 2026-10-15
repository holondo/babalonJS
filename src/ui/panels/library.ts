import { Plus, Search, X } from 'lucide';
import { tr } from '../../core/i18n';
import { deviceBudget } from '../../optimize/analysis';
import { downloadLibraryItem, libraryIndex, libraryURL, libraryVariants } from '../../library/polyhaven';
import type { LibraryItem, LibraryKind, LibraryVariant } from '../../library/polyhaven';
import { button, chips, h, hint, icon, iconButton, progressBar } from '../dom';
import { errorMessage } from '../shared';
import type { UI } from '../ui';

const PAGE = 24;

/**
 * Add → Library and Light → Library: free CC0 models and HDRIs from Poly Haven.
 * Search and categories at the top, a grid of thumbnails, and the chosen item's actions in a bar
 * pinned to the bottom of the panel (always within reach of the thumb). Created lazily by the
 * shell; each kind keeps its state while the panel re-renders.
 */
export class LibraryPanel {
  private readonly ui: UI;
  private readonly roots = new Map<LibraryKind, HTMLElement>();
  constructor(ui: UI) { this.ui = ui; }

  content(kind: LibraryKind): HTMLElement {
    const existing = this.roots.get(kind);
    if (existing) return existing;

    let items: LibraryItem[] = [];
    let category = '';
    let limit = PAGE;
    let chosen: LibraryItem | null = null;
    let variants: LibraryVariant[] = [];
    let variant: LibraryVariant | null = null;
    /** Download or details request in progress (cancel stops it). */
    let active: AbortController | null = null;
    let progress: number | null = null;
    let message = '';

    const results = h('div', { class: 'library-grid' });
    const categories = h('div', { class: 'library-categories' });
    const status = h('p', { class: 'library-status', role: 'status' });
    const more = button(tr('Show more'), () => { limit += PAGE; renderGrid(); }, { cls: 'ghost library-more' });
    const bar = h('div', { class: 'library-bar' });

    const offline = () => (navigator.onLine ? '' : tr('Offline: only cached library items are available.'));
    const fail = (error: unknown, signal: AbortSignal) => (signal.aborted ? tr('Cancelled') : offline() || errorMessage(error));

    // ---------- Search ----------
    const input = h('input', {
      type: 'search', placeholder: kind === 'model' ? tr('Search models') : tr('Search environments'),
      'aria-label': tr('Search library'), enterkeyhint: 'search',
      onInput: () => { limit = PAGE; clear.hidden = !input.value; renderGrid(); },
    });
    const clear = iconButton(X, tr('Clear search'), () => { input.value = ''; clear.hidden = true; limit = PAGE; renderGrid(); input.focus(); }, { cls: 'library-clear' });
    clear.hidden = true;
    const search = h('label', { class: 'library-search' }, icon(Search, 18), input, clear);

    // ---------- Grid ----------
    const renderGrid = () => {
      const query = input.value.toLocaleLowerCase().trim();
      const matching = items.filter((item) => (!category || item.categories?.includes(category))
        && `${item.name} ${(item.tags ?? []).join(' ')} ${(item.categories ?? []).join(' ')}`.toLocaleLowerCase().includes(query));
      results.replaceChildren(...matching.slice(0, limit).map((item) => {
        let image: HTMLImageElement | null = null;
        try { image = h('img', { src: libraryURL(item.thumbnail_url), alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }); } catch { /* No thumbnail: the name is enough. */ }
        return h('button', { class: `library-card${chosen === item ? ' active' : ''}`, onClick: () => choose(item), 'aria-pressed': String(chosen === item) },
          h('span', { class: 'library-thumb' }, image),
          h('span', { class: 'library-name' }, item.name));
      }));
      more.hidden = matching.length <= limit;
      if (items.length && !matching.length) results.append(hint(tr('No library items found.')));
    };

    const renderCategories = () => {
      const all = [...new Set(items.flatMap((item) => item.categories ?? []))].sort();
      categories.replaceChildren(chips([{ value: '', label: tr('All') }, ...all.map((value) => ({ value, label: value }))], category, (value) => {
        category = value; limit = PAGE; renderCategories(); renderGrid();
      }));
    };

    // ---------- Bottom bar: the chosen item ----------
    const renderBar = () => {
      bar.hidden = !chosen;
      if (!chosen) return bar.replaceChildren();
      const item = chosen;
      const authors = Object.keys(item.authors ?? {}).join(', ');
      const parts: (Node | null)[] = [
        h('div', { class: 'library-bar-head' },
          h('div', { class: 'library-bar-title' },
            h('b', {}, item.name),
            h('a', { href: `https://polyhaven.com/a/${encodeURIComponent(item.id)}`, target: '_blank', rel: 'noopener noreferrer' }, authors ? `${authors} · CC0` : 'Poly Haven · CC0')),
          iconButton(X, tr('Close'), () => { active?.abort(); chosen = null; renderBar(); renderGrid(); })),
        variants.length
          ? chips(variants.map((v) => ({ value: v.resolution, label: `${v.resolution.toUpperCase()} · ${(v.bytes / 1048576).toFixed(v.bytes < 10485760 ? 1 : 0)} MB` })), variant?.resolution ?? '', (value) => {
              if (progress !== null) return;
              variant = variants.find((v) => v.resolution === value) ?? variant; renderBar();
            })
          : null,
        message ? hint(message) : null,
        progress !== null
          ? h('div', { class: 'library-bar-actions' }, progressBar(progress, `${tr('Downloading…')} ${Math.round(progress * 100)}%`), button(tr('Cancel'), () => active?.abort(), { cls: 'small ghost' }))
          : h('div', { class: 'library-bar-actions' }, button(variant ? tr('Add to scene') : tr('Loading…'), () => add(), { icon: Plus, cls: 'primary' })),
      ];
      bar.replaceChildren(...parts.filter((n): n is Node => !!n));
      const addButton = bar.querySelector<HTMLButtonElement>('.library-bar-actions .primary');
      if (addButton) addButton.disabled = !variant;
    };

    const choose = (item: LibraryItem) => {
      if (progress !== null) return;
      active?.abort();
      const controller = active = new AbortController();
      chosen = item; variants = []; variant = null; message = '';
      renderGrid(); renderBar();
      void libraryVariants(item.id, kind, controller.signal).then((list) => {
        if (active !== controller) return;
        // Huge versions (16K, 24K: hundreds of MB) aren't offered: up to 4K on phones, 8K elsewhere
        const max = deviceBudget().phone ? 4 : 8;
        variants = list.filter((v) => (parseInt(v.resolution) || 0) <= max);
        if (!variants.length) message = tr('No supported download is available.');
        // Lighter by default on phones; the user picks more resolution if they want
        const preferred = deviceBudget().phone ? '1k' : '2k';
        variant = variants.find((v) => v.resolution === preferred) ?? variants[0] ?? null;
      }).catch((error) => {
        if (active === controller) message = fail(error, controller.signal);
      }).finally(() => {
        if (active === controller) { active = null; renderBar(); }
      });
    };

    const add = () => {
      const item = chosen, chosenVariant = variant;
      if (!item || !chosenVariant || progress !== null) return;
      const controller = active = new AbortController();
      const activity = this.ui.beginActivity(tr('Downloading {name}', { name: item.name }), undefined, () => controller.abort());
      progress = 0; message = '';
      renderBar();
      void (async () => {
        try {
          const result = await downloadLibraryItem(item, kind, chosenVariant, controller.signal, (done, total) => {
            progress = Math.min(1, done / total); renderBar();
            activity.update(progress);
          });
          controller.signal.throwIfAborted();
          progress = null; message = tr('Loading…'); renderBar();
          activity.finish();
          if (await this.ui.openFiles(result.files, result.attribution)) this.ui.toast(tr('{name} added', { name: item.name }));
          message = '';
          chosen = null;
        } catch (error) {
          message = fail(error, controller.signal);
        } finally {
          activity.finish();
          if (active === controller) active = null;
          progress = null;
          renderBar(); renderGrid();
        }
      })();
    };

    // ---------- Catalog ----------
    const load = () => {
      status.textContent = tr('Loading…');
      const controller = new AbortController();
      void libraryIndex(kind, controller.signal).then((list) => {
        items = list;
        status.textContent = offline();
        renderCategories(); renderGrid();
      }).catch((error) => { status.textContent = fail(error, controller.signal); });
    };

    const root = h('div', { class: 'library' },
      hint(kind === 'model' ? tr('Free models by Poly Haven (CC0). What you add is saved in your project.') : tr('Free environments by Poly Haven (CC0). What you add is saved in your project.')),
      search, categories, status, results, more, bar);
    bar.hidden = true;
    more.hidden = true;
    this.roots.set(kind, root);
    load();
    return root;
  }
}
