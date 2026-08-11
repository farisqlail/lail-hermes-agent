import os
from playwright.sync_api import sync_playwright

slides_data = [
    {
        'id': '00_banner',
        'badge': 'GUIDE / AI CODING',
        'title': '4 GITHUB TECHS TO SAVE AI TOKENS',
        'subtitle': 'Proven open-source techniques and tools to slash LLM token usage and boost coding efficiency.',
        'type': 'cover',
        'items': [
            {'num': '01', 'name': 'Caveman Style', 'repo': 'Mijutra/caveman-copilot'},
            {'num': '02', 'name': 'Ponytail Rule', 'repo': 'lazy-developer/ponytail-convention'},
            {'num': '03', 'name': 'Repomix', 'repo': 'yamadashy/repomix'},
            {'num': '04', 'name': 'Files-to-Prompt', 'repo': 'simonw/files-to-prompt'}
        ]
    },
    {
        'id': '01_caveman',
        'badge': '01 / TECHNIQUE',
        'title': 'Caveman Style',
        'repo': 'Mijutra/caveman-copilot',
        'stars': '1.2k',
        'code': 'Respond like terse caveman. Drop: articles (a/an/the),\nfiller (just/really), pleasantries. Technical substance\nexact. Pattern: [thing] [action] [reason].',
        'bullets': [
            'Strips filler words, articles & polite phrasing',
            'Cuts output token usage by up to 60%',
            'Preserves 100% technical precision & correctness'
        ]
    },
    {
        'id': '02_ponytail',
        'badge': '02 / CONVENTION',
        'title': 'Ponytail Rule',
        'repo': 'lazy-developer/ponytail-convention',
        'stars': '850',
        'code': '// Prefer standard library over external dependencies\n// ponytail: ceiling 100 lines, native solution first\nconst result = text.trim().split(/\\s+/);',
        'bullets': [
            'Enforces native platform & stdlib solutions first',
            'Prevents unnecessary abstractions and dependencies',
            'Keeps prompt context minimal and highly focused'
        ]
    },
    {
        'id': '03_repomix',
        'badge': '03 / TOOL',
        'title': 'Repomix',
        'repo': 'yamadashy/repomix',
        'stars': '4.8k',
        'code': '$ npx repomix\n[info] Packing repository into repomix-output.xml...\n[success] Packed 42 files (14.2 KB) into clean prompt format!',
        'bullets': [
            'Packs entire repository into one structured text file',
            'Auto-filters noise, binaries, and node_modules',
            'Optimized structure for Claude 3.5 & GPT-4o'
        ]
    },
    {
        'id': '04_files_to_prompt',
        'badge': '04 / TOOL',
        'title': 'Files-to-Prompt',
        'repo': 'simonw/files-to-prompt',
        'stars': '2.1k',
        'code': '$ files-to-prompt src/*.py --c > context.txt\n\n# Output:\nsrc/main.py\n---',
        'bullets': [
            'Simon Willison\'s CLI tool for target file extraction',
            'Passes exact code files directly into LLM prompts',
            'Prevents context window bloat and token waste'
        ]
    }
]

def generate_html(data):
    if data.get('type') == 'cover':
        items_html = ''
        for item in data['items']:
            items_html += f'''
            <div class="cover-item">
                <span class="item-num">{item['num']}</span>
                <div class="item-info">
                    <div class="item-name">{item['name']}</div>
                    <div class="item-repo">github.com/{item['repo']}</div>
                </div>
            </div>
            '''
        body_content = f'''
        <div class="cover-header">
            <div class="badge">{data['badge']}</div>
            <h1 class="cover-title">4 GITHUB TECHS TO <br/><span class="highlight">SAVE AI TOKENS</span></h1>
            <p class="cover-subtitle">{data['subtitle']}</p>
        </div>
        <div class="cover-grid">
            {items_html}
        </div>
        '''
    else:
        bullets_html = ''.join([f'<li><span class="bullet-icon">✓</span>{b}</li>' for b in data['bullets']])
        body_content = f'''
        <div class="slide-header">
            <div class="badge">{data['badge']}</div>
            <h1 class="slide-title">{data['title']}</h1>
        </div>

        <div class="repo-card">
            <div class="repo-header">
                <svg class="github-icon" height="28" viewBox="0 0 16 16" width="28" fill="#FFFFFF">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                </svg>
                <span class="repo-name">{data['repo']}</span>
            </div>
            <div class="repo-stars">★ {data['stars']}</div>
        </div>

        <div class="code-box">
            <div class="code-header">
                <span class="dot red"></span>
                <span class="dot yellow"></span>
                <span class="dot green"></span>
                <span class="code-title">Terminal / Prompt Config</span>
            </div>
            <pre class="code-content"><code>{data['code']}</code></pre>
        </div>

        <div class="bullets-card">
            <ul class="bullets-list">
                {bullets_html}
            </ul>
        </div>
        '''

    html = f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: 1080px;
    height: 1080px;
    background-color: #0D0E12;
    background-image: 
        radial-gradient(circle at 80% 20%, rgba(0, 112, 243, 0.2), transparent 45%),
        radial-gradient(circle at 20% 80%, rgba(0, 112, 243, 0.12), transparent 50%);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #FFFFFF;
    padding: 75px 70px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }}

  .badge {{
    display: inline-block;
    padding: 8px 18px;
    background: rgba(0, 112, 243, 0.12);
    border: 1px solid rgba(0, 112, 243, 0.5);
    border-radius: 20px;
    color: #0070F3;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 2px;
    margin-bottom: 20px;
    text-transform: uppercase;
  }}

  .cover-header {{
    margin-top: 10px;
  }}
  .cover-title {{
    font-size: 54px;
    font-weight: 900;
    line-height: 1.15;
    letter-spacing: -1px;
    color: #FFFFFF;
    margin-bottom: 20px;
  }}
  .highlight {{
    color: #0070F3;
    background: linear-gradient(90deg, #0070F3, #00C6FF);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }}
  .cover-subtitle {{
    font-size: 24px;
    color: #94A3B8;
    line-height: 1.4;
    max-width: 850px;
  }}

  .cover-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 30px;
  }}
  .cover-item {{
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 26px;
    display: flex;
    align-items: center;
    gap: 20px;
  }}
  .item-num {{
    font-size: 26px;
    font-weight: 800;
    color: #0070F3;
    background: rgba(0, 112, 243, 0.15);
    width: 52px;
    height: 52px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }}
  .item-name {{
    font-size: 24px;
    font-weight: 700;
    color: #FFFFFF;
  }}
  .item-repo {{
    font-size: 15px;
    color: #64748B;
    margin-top: 4px;
  }}

  .slide-header {{
    margin-top: 0px;
  }}
  .slide-title {{
    font-size: 52px;
    font-weight: 800;
    color: #FFFFFF;
    letter-spacing: -1px;
  }}

  .repo-card {{
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 22px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 20px;
  }}
  .repo-header {{
    display: flex;
    align-items: center;
    gap: 16px;
  }}
  .repo-name {{
    font-size: 24px;
    font-weight: 600;
    color: #F1F5F9;
    font-family: 'SF Mono', Consolas, monospace;
  }}
  .repo-stars {{
    font-size: 18px;
    font-weight: 600;
    color: #F59E0B;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    padding: 6px 14px;
    border-radius: 20px;
  }}

  .code-box {{
    background: #050608;
    border: 1px solid rgba(0, 112, 243, 0.35);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 25px rgba(0, 112, 243, 0.15);
    border-radius: 16px;
    overflow: hidden;
    margin-top: 20px;
  }}
  .code-header {{
    background: #12151E;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }}
  .dot {{
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }}
  .dot.red {{ background: #EF4444; }}
  .dot.yellow {{ background: #F59E0B; }}
  .dot.green {{ background: #10B981; }}
  .code-title {{
    font-size: 14px;
    color: #64748B;
    margin-left: 10px;
    font-family: monospace;
  }}
  .code-content {{
    padding: 26px 28px;
    font-family: 'SF Mono', Consolas, 'Courier New', monospace;
    font-size: 20px;
    line-height: 1.6;
    color: #38BDF8;
    white-space: pre-wrap;
  }}

  .bullets-card {{
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 28px;
    margin-top: 20px;
  }}
  .bullets-list {{
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }}
  .bullets-list li {{
    font-size: 22px;
    color: #E2E8F0;
    display: flex;
    align-items: center;
    gap: 16px;
    line-height: 1.4;
  }}
  .bullet-icon {{
    color: #0070F3;
    font-weight: 900;
    font-size: 20px;
    background: rgba(0, 112, 243, 0.15);
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }}
</style>
</head>
<body>
  {body_content}
</body>
</html>'''
    return html

output_dir = 'E:/lail-hermes-agent'
with sync_playwright() as p:
    browser = p.chromium.launch()
    for item in slides_data:
        html_str = generate_html(item)
        file_html = os.path.join(output_dir, f"temp_{item['id']}.html")
        file_png = os.path.join(output_dir, f"slide_{item['id']}.png")
        
        with open(file_html, 'w', encoding='utf-8') as f:
            f.write(html_str)
            
        page = browser.new_page(viewport={'width': 1080, 'height': 1080})
        page.goto('file://' + os.path.abspath(file_html))
        page.screenshot(path=file_png)
        page.close()
        print(f"Generated: {file_png}")
        
    browser.close()

print("ALL_SUCCESS")
