import type { Entity } from '../core/editor';

/** Copied characters often have identically named clips; Filament needs unique names. */
export function nativeAnimationName(entity: Pick<Entity, 'id'>) {
  return `babalon-ar-${entity.id}`;
}
