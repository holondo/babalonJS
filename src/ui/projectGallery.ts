import { Copy, FolderOpen, Pencil, Trash2, X } from 'lucide';
import { deleteProject, duplicateProject, listProjects, renameProject } from '../core/project';
import { tr, locale } from '../core/i18n';
import { formatBytes } from '../optimize/analysis';
import { button, h, hint, iconButton, row } from './dom';
import type { UI } from './ui';

/** Project metadata is queried separately so browsing never loads model binaries. */
export class ProjectGallery {
  private dialog = h('dialog', { class: 'project-gallery', 'aria-label': tr('All projects') });
  private urls: string[] = [];
  private readonly ui: UI;
  constructor(ui: UI) {
    this.ui = ui;
    ui.root.append(this.dialog);
    this.dialog.addEventListener('close', () => this.release());
  }
  private release() { this.urls.forEach((url) => URL.revokeObjectURL(url)); this.urls = []; }
  async show() {
    await this.ui.flushProject();
    await this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }
  private async render() {
    const projects = await listProjects();
    const storage = await navigator.storage?.estimate().catch(() => undefined);
    this.release();
    const act = (fn: () => Promise<unknown>) => this.ui.run(async () => { await fn(); await this.render(); });
    this.dialog.replaceChildren(h('div', {},
      row(h('h2', {}, tr('All projects')), iconButton(X, tr('Close'), () => this.dialog.close())),
      row(button(tr('New project'), () => this.ui.run(async () => { await this.ui.newProject(); this.dialog.close(); }), { cls: 'primary' })),
      storage ? hint(tr('Browser storage: {used} of {total}', { used: formatBytes(storage.usage ?? 0), total: formatBytes(storage.quota ?? 0) })) : null,
      button(tr('Keep projects offline'), () => this.ui.run(async () => {
        const kept = await navigator.storage?.persist?.();
        this.ui.toast(kept ? tr('Persistent storage enabled') : tr('Export backups too: this browser may clear local projects.'));
      }), { cls: 'small ghost' }),
      h('div', { class: 'project-grid' }, ...projects.map((p) => {
        const url = p.thumbnail ? URL.createObjectURL(p.thumbnail) : null;
        if (url) this.urls.push(url);
        return h('article', { class: 'project-card' },
          url ? h('img', { src: url, alt: '', width: 240, height: 160 }) : h('div', { class: 'project-placeholder' }),
          h('h3', {}, p.name), h('small', {}, new Date(p.updatedAt).toLocaleString(locale())),
          row(button(tr('Open'), () => this.ui.run(async () => { await this.ui.openStoredProject(p.id); this.dialog.close(); }), { icon: FolderOpen }),
            iconButton(Copy, tr('Duplicate'), () => act(() => duplicateProject(p.id))),
            iconButton(Pencil, tr('Rename'), () => {
              const name = prompt(tr('Project name'), p.name)?.trim();
              if (name) act(async () => { await renameProject(p.id, name); this.ui.projectRenamed(p.id, name); });
            }),
            iconButton(Trash2, tr('Delete'), () => {
              if (confirm(tr('Delete {name} from this browser?', { name: p.name }))) act(async () => { await deleteProject(p.id); this.ui.projectDeleted(p.id); });
            })),
        );
      })),
      projects.length ? null : hint(tr('No saved projects yet.')),
    ));
  }
}
