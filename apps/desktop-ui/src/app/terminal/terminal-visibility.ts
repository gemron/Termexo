import {
  DEFAULT_TERMINAL_GRID_DIMENSION,
  LayoutMode,
  normalizeTerminalGridDimension,
  TerminalSession,
} from '../core/models/workspace.models';

export function layoutTerminalCapacity(
  layout: LayoutMode,
  gridColumns = DEFAULT_TERMINAL_GRID_DIMENSION,
  gridRows = DEFAULT_TERMINAL_GRID_DIMENSION,
): number {
  return layout === 'grid'
    ? normalizeTerminalGridDimension(gridColumns) * normalizeTerminalGridDimension(gridRows)
    : layout === 'single'
      ? 1
      : 2;
}

export function resolveVisibleTerminalIds(
  terminals: readonly Pick<TerminalSession, 'id'>[],
  activeTerminalId: string | null,
  preferredIds: readonly string[],
  layout: LayoutMode,
  terminalMaximized = false,
  gridColumns = DEFAULT_TERMINAL_GRID_DIMENSION,
  gridRows = DEFAULT_TERMINAL_GRID_DIMENSION,
): string[] {
  const capacity = layoutTerminalCapacity(layout, gridColumns, gridRows);
  const availableIds = new Set(terminals.map((terminal) => terminal.id));
  if (terminalMaximized && activeTerminalId && availableIds.has(activeTerminalId)) {
    return [activeTerminalId];
  }
  const visibleIds = preferredIds
    .filter(
      (terminalId, index, items) =>
        availableIds.has(terminalId) && items.indexOf(terminalId) === index,
    )
    .slice(0, capacity);

  if (
    activeTerminalId &&
    availableIds.has(activeTerminalId) &&
    !visibleIds.includes(activeTerminalId)
  ) {
    if (visibleIds.length < capacity) {
      visibleIds.push(activeTerminalId);
    } else {
      visibleIds[visibleIds.length - 1] = activeTerminalId;
    }
  }

  for (const terminal of terminals) {
    if (visibleIds.length >= capacity) {
      break;
    }
    if (!visibleIds.includes(terminal.id)) {
      visibleIds.push(terminal.id);
    }
  }

  return visibleIds;
}

export function revealTerminalInLayout(
  visibleIds: readonly string[],
  activeTerminalId: string | null,
  requestedTerminalId: string,
  layout: LayoutMode,
  gridColumns = DEFAULT_TERMINAL_GRID_DIMENSION,
  gridRows = DEFAULT_TERMINAL_GRID_DIMENSION,
): string[] {
  const capacity = layoutTerminalCapacity(layout, gridColumns, gridRows);
  const nextIds = visibleIds.slice(0, capacity);
  if (nextIds.includes(requestedTerminalId)) {
    return nextIds;
  }

  if (nextIds.length < capacity) {
    return [...nextIds, requestedTerminalId];
  }

  const activeIndex = activeTerminalId ? nextIds.indexOf(activeTerminalId) : -1;
  nextIds[activeIndex >= 0 ? activeIndex : nextIds.length - 1] = requestedTerminalId;
  return nextIds;
}
