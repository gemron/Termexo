import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  input,
  Renderer2,
  viewChild,
} from '@angular/core';
import {
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Columns2,
  Command,
  FileDiff,
  FolderGit2,
  Grid2x2,
  LayoutPanelTop,
  ListTodo,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  PanelRightClose,
  Play,
  Plus,
  Radio,
  Rows2,
  Save,
  Search,
  Settings,
  Sparkles,
  Square,
  Star,
  Terminal,
  X,
  Zap,
  type IconNode,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  bot: Bot,
  boxes: Boxes,
  check: Check,
  'chevron-down': ChevronDown,
  columns: Columns2,
  command: Command,
  diff: FileDiff,
  folder: FolderGit2,
  grid: Grid2x2,
  layout: LayoutPanelTop,
  task: ListTodo,
  maximize: Maximize2,
  message: MessageSquareText,
  more: MoreHorizontal,
  'panel-close': PanelRightClose,
  play: Play,
  plus: Plus,
  radio: Radio,
  rows: Rows2,
  save: Save,
  search: Search,
  settings: Settings,
  sparkles: Sparkles,
  square: Square,
  star: Star,
  terminal: Terminal,
  x: X,
  zap: Zap,
};

@Component({
  selector: 'app-icon',
  template: '<svg #svg aria-hidden="true"></svg>',
  host: {
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
})
export class IconComponent implements AfterViewInit {
  private readonly renderer = inject(Renderer2);
  private readonly svg = viewChild.required<ElementRef<SVGElement>>('svg');

  readonly name = input.required<string>();
  readonly size = input(16);

  ngAfterViewInit(): void {
    const svg = this.svg().nativeElement;
    const iconNode = ICONS[this.name()] ?? Square;

    this.renderer.setAttribute(svg, 'viewBox', '0 0 24 24');
    this.renderer.setAttribute(svg, 'width', String(this.size()));
    this.renderer.setAttribute(svg, 'height', String(this.size()));
    this.renderer.setAttribute(svg, 'fill', 'none');
    this.renderer.setAttribute(svg, 'stroke', 'currentColor');
    this.renderer.setAttribute(svg, 'stroke-width', '2');
    this.renderer.setAttribute(svg, 'stroke-linecap', 'round');
    this.renderer.setAttribute(svg, 'stroke-linejoin', 'round');

    for (const [tag, attributes] of iconNode) {
      const child = this.renderer.createElement(tag, 'svg');
      for (const [attribute, value] of Object.entries(attributes)) {
        this.renderer.setAttribute(child, attribute, String(value));
      }
      this.renderer.appendChild(svg, child);
    }
  }
}
