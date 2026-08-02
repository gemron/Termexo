import {
  AfterViewInit,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  Renderer2,
  viewChild,
} from '@angular/core';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Activity,
  BellRing,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Columns2,
  Command,
  Cloud,
  CircleGauge,
  Download,
  ExternalLink,
  FolderGit2,
  Grid2x2,
  GitMerge,
  KeyRound,
  Laptop,
  Link2,
  History,
  LayoutPanelTop,
  Languages,
  Maximize2,
  MessageSquareText,
  MonitorSmartphone,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Package,
  Palette,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Rows2,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Terminal,
  TriangleAlert,
  Trash2,
  Users,
  Wifi,
  Wrench,
  X,
  Zap,
  type IconNode,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  activity: Activity,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  bell: BellRing,
  bot: Bot,
  boxes: Boxes,
  check: Check,
  'chevron-down': ChevronDown,
  columns: Columns2,
  command: Command,
  cloud: Cloud,
  gauge: CircleGauge,
  download: Download,
  external: ExternalLink,
  folder: FolderGit2,
  grid: Grid2x2,
  merge: GitMerge,
  key: KeyRound,
  laptop: Laptop,
  link: Link2,
  history: History,
  layout: LayoutPanelTop,
  languages: Languages,
  maximize: Maximize2,
  message: MessageSquareText,
  devices: MonitorSmartphone,
  minimize: Minimize2,
  more: MoreHorizontal,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  'panel-close': PanelRightClose,
  'panel-right-open': PanelRightOpen,
  package: Package,
  palette: Palette,
  edit: Pencil,
  play: Play,
  plus: Plus,
  radio: Radio,
  refresh: RefreshCw,
  rollback: RotateCcw,
  rows: Rows2,
  search: Search,
  server: Server,
  settings: Settings,
  shield: ShieldCheck,
  sliders: SlidersHorizontal,
  smartphone: Smartphone,
  sparkles: Sparkles,
  square: Square,
  star: Star,
  terminal: Terminal,
  'triangle-alert': TriangleAlert,
  trash: Trash2,
  users: Users,
  wifi: Wifi,
  wrench: Wrench,
  x: X,
  zap: Zap,
};

@Component({
  selector: 'app-icon',
  template: '<svg #svg aria-hidden="true" style="display: block; width: 100%; height: 100%"></svg>',
  host: {
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    style:
      'display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; line-height: 0; vertical-align: middle;',
  },
})
export class IconComponent implements AfterViewInit {
  private readonly renderer = inject(Renderer2);
  private readonly svg = viewChild.required<ElementRef<SVGElement>>('svg');

  readonly name = input.required<string>();
  readonly size = input(16);
  readonly strokeWidth = input(1.8);
  private viewReady = false;

  constructor() {
    effect(() => {
      const name = this.name();
      const size = this.size();
      const strokeWidth = this.strokeWidth();
      if (this.viewReady) {
        this.renderIcon(name, size, strokeWidth);
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderIcon(this.name(), this.size(), this.strokeWidth());
  }

  private renderIcon(name: string, size: number, strokeWidth: number): void {
    const svg = this.svg().nativeElement;
    const iconNode = ICONS[name] ?? Square;
    while (svg.firstChild) {
      this.renderer.removeChild(svg, svg.firstChild);
    }
    this.renderer.setAttribute(svg, 'viewBox', '0 0 24 24');
    this.renderer.setAttribute(svg, 'width', String(size));
    this.renderer.setAttribute(svg, 'height', String(size));
    this.renderer.setAttribute(svg, 'fill', 'none');
    this.renderer.setAttribute(svg, 'stroke', 'currentColor');
    this.renderer.setAttribute(svg, 'stroke-width', String(strokeWidth));
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
