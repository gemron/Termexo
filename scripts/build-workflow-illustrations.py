"""Generate the bilingual SVG workflow illustrations used by the website and README."""
from pathlib import Path
from html import escape

ASSETS = Path(__file__).resolve().parents[1] / 'website' / 'assets'
COPY = {
    'zh': {
        'title': '一个工作台，接续整个开发现场。', 'kicker': 'TERMEXO / 本地优先的 AI 编程工作台',
        'input': '项目与任务', 'input_sub': '个人开发 · 企业研发',
        'projects': ['业务项目', '个人产品', '开源仓库'],
        'core': '本地 Windows 工作台', 'agents': '多 Agent 终端 · 由你分配任务',
        'profiles': '模型 / 账号 / 网络配置', 'context': '任务状态 / 会话恢复 / 交接包',
        'organize': '组织', 'connect': '接续', 'remote': '跨设备接着操作',
        'devices': '手机 / 另一台电脑', 'actions': ['查看进度', '回复确认', '发送下一步指令'],
        'route': '可选：自建中继 / 局域网 / VPN',
        'model': '模型服务按配置连接', 'model_sub': 'Agent 可调用外部模型或兼容网关',
        'foot': '工作在宿主电脑运行；远程接续需电脑保持开机。',
    },
    'en': {
        'title': 'One workbench. Work that carries on.', 'kicker': 'TERMEXO / LOCAL-FIRST AI CODING',
        'input': 'Projects & tasks', 'input_sub': 'Individual & enterprise work',
        'projects': ['Business projects', 'Side products', 'Open source'],
        'core': 'Local Windows workbench', 'agents': 'Agent terminals · You assign the work',
        'profiles': 'Model / account / network profiles', 'context': 'Task status / resume / handoffs',
        'organize': 'Organize', 'connect': 'Continue', 'remote': 'Continue on another device',
        'devices': 'Phone / another computer', 'actions': ['Check progress', 'Answer approvals', 'Send the next instruction'],
        'route': 'Optional: own relay / LAN / VPN',
        'model': 'Model services you configure', 'model_sub': 'Agents can call providers or compatible gateways',
        'foot': 'Agents run on the host PC. Keep it on for remote access.',
    },
}

def render(lang, mobile=False):
    c = COPY[lang]
    width, height = (480, 1110) if mobile else (1200, 620)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
           f'<title id="title">{escape(c["title"])}</title><desc id="desc">{escape(c["foot"] + " " + c["model_sub"])}</desc>',
           '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f3f8fc"/><stop offset="1" stop-color="#e2eff5"/></linearGradient><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M1 1 6 4 1 7" fill="none" stroke="#277991" stroke-width="1.5"/></marker></defs>',
           f'<rect width="{width}" height="{height}" rx="24" fill="url(#bg)"/>',
           '<g font-family="Inter, Arial, Microsoft YaHei, sans-serif">']
    def text(x, y, value, size=18, color='#142e3d', weight=400):
        out.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}">{escape(value)}</text>')
    def rect(x, y, w, h, fill='#ffffff', stroke='#c9dce5', radius=18):
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>')
    def line(d, dashed=False):
        out.append(f'<path d="{d}" fill="none" stroke="#277991" stroke-width="2" marker-end="url(#arrow)"' + (' stroke-dasharray="5 5"' if dashed else '') + '/>')
    text(28 if mobile else 40, 37, c['kicker'], 13, '#286f89', 700)
    if mobile:
        # Keep all labels at a readable size on narrow screens; stack the same workflow.
        text(28, 73, '一个工作台，接续开发现场。' if lang == 'zh' else 'One workbench. Keep going.', 25, weight=700)
        ix, iy, iw, ih = 28, 103, 424, 184
        cx, cy, cw, ch = 28, 335, 424, 302
        rx, ry, rw, rh = 28, 814, 424, 220
    else:
        text(40, 84, c['title'], 34, weight=700)
        ix, iy, iw, ih = 40, 150, 260, 298
        cx, cy, cw, ch = 360, 132, 480, 334
        rx, ry, rw, rh = 900, 150, 260, 298
    rect(ix, iy, iw, ih)
    text(ix+22, iy+36, c['input'], 23, weight=700)
    text(ix+22, iy+63, c['input_sub'], 14, '#536d7b')
    for n, label in enumerate(c['projects']):
        yy = iy + 91 + n * (28 if mobile else 58)
        if not mobile: rect(ix+18, yy-13, iw-36, 42, '#f0f6fa', '#deebf1', 9)
        out.append(f'<path d="M{ix+28} {yy-1} h7 l3 4 h10 v12 h-20 Z" fill="none" stroke="#397e96" stroke-width="1.5"/>')
        text(ix+62, yy+12, label, 17)
    rect(cx, cy, cw, ch, '#132f3e', '#264c60', 22)
    out.append(f'<circle cx="{cx+30}" cy="{cy+35}" r="6" fill="#6bd5bf"/>')
    text(cx+47, cy+43, 'Termexo', 28, '#ffffff', 700)
    text(cx+24, cy+77, c['core'], 19, '#c5e6f2')
    text(cx+24, cy+113, c['agents'], 16, '#9fc4d6')
    chipw = (cw-60)/2
    for n, name in enumerate(['Claude Code', 'Codex CLI', 'OpenCode', 'Antigravity']):
        xx, yy = cx+24+(n%2)*(chipw+12), cy+132+(n//2)*48
        rect(xx, yy, chipw, 36, '#21485c', '#386076', 9)
        out.append(f'<circle cx="{xx+15}" cy="{yy+18}" r="3" fill="#80d9c7"/>')
        text(xx+27, yy+24, name, 16, '#ffffff')
    text(cx+24, cy+257, c['profiles'], 17, '#d6e9f0')
    text(cx+24, cy+285, c['context'], 17, '#d6e9f0')
    if mobile:
        line('M240 295 V324')
        text(256, 317, c['organize'], 14, '#286f89')
        line('M240 646 V678', True)
        model_y = 691
        rect(28, model_y, 424, 82, '#f5fafc', '#bfd5e1', 14)
        text(48, model_y+31, c['model'], 18, weight=600)
        text(48, model_y+57, c['model_sub'], 15, '#536d7b')
        # Remote access branches from the workbench, independently of model services.
        line('M460 490 V801 H240 V810')
        text(34, 801, c['route'], 15, '#286f89')
    else:
        line('M310 296 H349')
        text(306, 278, c['organize'], 12, '#286f89')
        line('M850 296 H889')
        text(849, 278, c['connect'], 12, '#286f89')
        line('M600 476 V500', True)
        rect(360, 508, 480, 66, '#f5fafc', '#bfd5e1', 14)
        text(382, 534, c['model'], 17, weight=600)
        text(382, 559, c['model_sub'], 14, '#536d7b')
    rect(rx, ry, rw, rh)
    # A small monitor and phone identify continuation as device access, not a new agent.
    out.append(f'<g fill="none" stroke="#397e96" stroke-width="2"><rect x="{rx+22}" y="{ry+22}" width="39" height="26" rx="3"/><path d="M{rx+41} {ry+48} v7 m-12 0 h24"/><rect x="{rx+69}" y="{ry+24}" width="15" height="31" rx="3"/></g>')
    text(rx+22, ry+86, c['remote'], 20 if lang=='zh' else (22 if mobile else 17), weight=700)
    text(rx+22, ry+112, c['devices'], 15, '#536d7b')
    for n, label in enumerate(c['actions']):
        yy=ry+148+n*28
        text(rx+22, yy, '→', 18, '#277991')
        text(rx+46, yy, label, 16)
    if not mobile:
        text(rx+22, ry+274, c['route'], 13, '#536d7b')
    text(28 if mobile else 40, height-24, c['foot'], 14, '#536d7b')
    out.append('</g></svg>')
    suffix = '-mobile' if mobile else ''
    (ASSETS / f'termexo-workflow-{lang}{suffix}.svg').write_text('\n'.join(out)+'\n', encoding='utf-8')

if __name__ == '__main__':
    for locale in COPY:
        render(locale)
        render(locale, mobile=True)
