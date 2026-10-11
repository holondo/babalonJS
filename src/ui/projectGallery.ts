import { Copy, FilePlus, FolderOpen, Image, Pencil, Trash2, X } from 'lucide';
import { deleteProject, duplicateProject, listProjects, renameProject } from '../core/project';
import type { ProjectInfo } from '../core/project';
import { tr, locale } from '../core/i18n';
import { formatBytes } from '../optimize/analysis';
import { button, h, hint, icon, iconButton } from './dom';
import type { UI } from './ui';

/** "5 minutes ago", "yesterday"… for project dates. */
function relativeTime(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit);
    value /= size;
  }
  return '';
}

/**
 * Projects kept in this browser: the full gallery (a dialog opened from the project menu or the
 * start card) and the short "Recent projects" list on the start card. It never opens by itself:
 * the canvas is always available right away. Metadata only, so browsing never loads models.
 */
export class ProjectGallery {
  private dialog = h('dialog', { class: 'project-gallery', 'aria-label': tr('Projects') });
  private readonly ui: UI;
  /** Thumbnail URLs per project version (kept while the page lives, released when replaced). */
  private readonly urls = new Map<string, { key: string; url: string }>();
  /** Projects known for the start card (loaded on startup and after changes). */
  recent: ProjectInfo[] = [];

  constructor(ui: UI) {
    this.ui = ui;
    ui.root.append(this.dialog);
    // Tapping the dimmed background closes the dialog
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
  }

  /** Reloads the list used by the start card. */
  async refresh() {
    this.recent = await listProjects();
    this.ui.renderAll();
  }

  async show() {
    await this.ui.flushProject();
    await this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private thumbUrl(p: ProjectInfo) {
    if (!p.thumbnail) return null;
    const key = `${p.updatedAt}:${p.thumbnail.size}`;
    const cached = this.urls.get(p.id);
    if (cached?.key === key) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(p.thumbnail);
    this.urls.set(p.id, { key, url });
    return url;
  }

  private thumb(p: ProjectInfo, cls: string) {
    const url = this.thumbUrl(p);
    return url ? h('img', { class: cls, src: url, alt: '' }) : h('span', { class: `${cls} blank` }, icon(Image, 22));
  }

  /** Short list for the start card: the latest projects, one tap to open. */
  recentList(limit = 3): HTMLElement | null {
    if (!this.recent.length) return null;
    return h('div', { class: 'recent-projects' },
      h('div', { class: 'recent-head' },
        h('h3', {}, tr('Recent projects')),
        this.recent.length > limit ? button(tr('See all'), () => this.ui.run(() => this.show()), { cls: 'small ghost' }) : null),
      ...this.recent.slice(0, limit).map((p) => h('button', { class: 'recent-item', onClick: () => this.open(p) },
        this.thumb(p, 'recent-thumb'),
        h('span', { class: 'recent-text' }, h('b', {}, p.name), h('small', {}, relativeTime(p.updatedAt))))));
  }

  private open(p: ProjectInfo) {
    this.ui.run(async () => {
      await this.ui.openStoredProject(p.id);
      if (this.dialog.open) this.dialog.close();
    });
  }

  private async render() {
    const projects = this.recent = await listProjects();
    const storage = await navigator.storage?.estimate().catch(() => undefined);
    const act = (fn: () => Promise<unknown>) => this.ui.run(async () => { await fn(); await this.render(); this.ui.renderAll(); });
    const current = this.ui.currentProjectId;
    this.dialog.replaceChildren(h('div', { class: 'gallery-inner' },
      h('header', { class: 'gallery-head' },
        h('h2', {}, tr('Projects')),
        iconButton(X, tr('Close'), () => this.dialog.close())),
      h('div', { class: 'gallery-actions' },
        button(tr('New project'), () => this.ui.run(async () => { await this.ui.newProject(); this.dialog.close(); }), { icon: FilePlus, cls: 'primary' }),
        button(tr('Open file…'), () => { this.dialog.close(); this.ui.openProjectPicker(); }, { icon: FolderOpen, cls: 'ghost' })),
      projects.length
        ? h('div', { class: 'gallery-grid' }, ...projects.map((p) => h('article', { class: `gallery-card${p.id === current ? ' current' : ''}` },
            h('button', { class: 'gallery-open', onClick: () => this.open(p), 'aria-label': tr('Open {name}', { name: p.name }) },
              this.thumb(p, 'gallery-thumb'),
              p.id === current ? h('span', { class: 'gallery-badge' }, tr('Open now')) : null),
            h('div', { class: 'gallery-meta' },
              h('div', { class: 'gallery-text' }, h('b', {}, p.name), h('small', {}, relativeTime(p.updatedAt))),
              iconButton(Pencil, tr('Rename'), () => {
                const name = prompt(tr('Project name'), p.name)?.trim();
                if (name) act(async () => { await renameProject(p.id, name); this.ui.projectRenamed(p.id, name); });
              }),
              iconButton(Copy, tr('Duplicate'), () => act(() => duplicateProject(p.id))),
              iconButton(Trash2, tr('Delete'), () => {
                if (confirm(tr('Delete {name} from this browser?', { name: p.name }))) act(async () => { await deleteProject(p.id); this.ui.projectDeleted(p.id); });
              }, { cls: 'danger' })))))
        : hint(tr('No saved projects yet. Your scene is saved here automatically as you work.')),
      h('footer', { class: 'gallery-foot' },
        storage ? h('small', {}, tr('Browser storage: {used} of {total}', { used: formatBytes(storage.usage ?? 0), total: formatBytes(storage.quota ?? 0) })) : null,
        button(tr('Keep projects offline'), () => this.ui.run(async () => {
          const kept = await navigator.storage?.persist?.();
          this.ui.toast(kept ? tr('Persistent storage enabled') : tr('Export backups too: this browser may clear local projects.'));
        }), { cls: 'small ghost' })),
    ));
  }
}
