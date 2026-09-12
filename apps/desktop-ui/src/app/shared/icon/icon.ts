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
  Copy,
  Cloud,
  CircleGauge,
  Download,
  Upload,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
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
  Minus,
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

/**
 * The agents' own marks, which are filled shapes rather than stroked outlines.
 *
 * Kept apart from the line icons because they are drawn with the opposite attributes: the shared
 * `fill: none` that makes an outline visible would make a brand mark invisible.
 *
 * Each is the single path of the mark its own project publishes. Claude's and OpenCode's come
 * from simple-icons (CC0) and OpenAI's from Wikimedia Commons; Antigravity publishes only a
 * gradient bitmap, so its arch is traced from that. Every one of them remains its owner's
 * trademark, used here only to name the agent it belongs to.
 */
interface BrandMark {
  /** The drawing box, already widened by the shared margin below. */
  readonly viewBox: string;
  readonly path: string;
}

/**
 * The empty space kept around a mark, as a share of its own box.
 *
 * The line icons keep their drawing inside roughly the middle five sixths of the 24x24 grid, while
 * a brand mark fills its box edge to edge. Without the same margin a mark reads a size larger than
 * the icon beside it.
 */
const BRAND_MARK_MARGIN_RATIO = 0.1;

/** Widens a mark's own box by that margin, so marks and line icons read as the same size. */
function brandMark(viewBox: string, path: string): BrandMark {
  const [x, y, width, height] = viewBox.split(' ').map(Number);
  const marginX = width * BRAND_MARK_MARGIN_RATIO;
  const marginY = height * BRAND_MARK_MARGIN_RATIO;
  const padded = [x - marginX, y - marginY, width + marginX * 2, height + marginY * 2];
  return { viewBox: padded.join(' '), path };
}

const BRAND_MARKS: Record<string, BrandMark> = {
  'brand-claude': brandMark(
    '0 0 24 24',
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  ),
  'brand-opencode': brandMark('0 0 24 24', 'M22 24H2V0h20zM17 4.8H7v14.4h10z'),
  'brand-antigravity': brandMark(
    '0 0 24 24',
    'M10.62 1.2Q9.96 1.44 9.18 2.16Q8.4 2.88 7.8 3.96Q7.2 5.04 5.28 11.1Q3.36 17.16 2.7 18.36Q2.04 19.56 1.14 20.58Q.24 21.6 .12 22.08Q0 22.56 .24 22.74Q.48 22.92 1.08 22.86Q1.68 22.8 2.46 22.26Q3.24 21.72 4.14 20.76Q5.04 19.8 6.42 17.52Q7.8 15.24 8.64 14.34Q9.48 13.44 10.32 13.08Q11.16 12.72 11.94 12.72Q12.72 12.72 13.5 13.02Q14.28 13.32 14.94 13.92Q15.6 14.52 17.16 17.04Q18.72 19.56 19.86 20.76Q21 21.96 21.66 22.38Q22.32 22.8 22.74 22.86Q23.16 22.92 23.46 22.8Q23.76 22.68 23.76 22.2Q23.76 21.72 22.68 20.4Q21.6 19.08 20.94 17.76Q20.28 16.44 18.66 11.1Q17.04 5.76 16.5 4.62Q15.96 3.48 15.24 2.64Q14.52 1.8 13.86 1.44Q13.2 1.08 12.24 1.02Q11.28 .96 10.62 1.2Z',
  ),
  'brand-codex': brandMark(
    '1.68 1.75 16.65 16.5',
    'M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z',
  ),
};

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
  upload: Upload,
  external: ExternalLink,
  folder: FolderGit2,
  'git-branch': GitBranch,
  'git-compare': GitCompareArrows,
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
  // Window controls follow the Windows title bar glyphs: a rule, a frame, and stacked frames.
  'window-minimize': Minus,
  'window-restore': Copy,
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
    this.renderer.setAttribute(svg, 'width', String(size));
    this.renderer.setAttribute(svg, 'height', String(size));

    const brand = BRAND_MARKS[name];
    if (brand) {
      // A mark is filled and carries no stroke; the line icons' attributes would erase it. It
      // also brings its own drawing box, where the line icons all share one.
      this.renderer.setAttribute(svg, 'viewBox', brand.viewBox);
      this.renderer.setAttribute(svg, 'fill', 'currentColor');
      this.renderer.setAttribute(svg, 'stroke', 'none');
      const path = this.renderer.createElement('path', 'svg');
      this.renderer.setAttribute(path, 'd', brand.path);
      this.renderer.appendChild(svg, path);
      return;
    }

    this.renderer.setAttribute(svg, 'viewBox', '0 0 24 24');
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
