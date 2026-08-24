from PIL import Image, ImageDraw
import os

def create_tray_icon_from_logo(base_img, state="idle", size=64):
    colors = {
        "idle": (148, 163, 184),    # Slate
        "listen": (34, 197, 94),    # Green
        "think": (245, 158, 11),    # Amber
        "speak": (59, 130, 246)     # Blue
    }
    col = colors.get(state, colors["idle"])
    
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # Resize user logo to fit center
    logo_resized = base_img.convert('RGBA').resize((size - 12, size - 12), Image.Resampling.LANCZOS)
    img.paste(logo_resized, (6, 6), logo_resized)
    
    # Status indicator circle in bottom-right corner
    d = ImageDraw.Draw(img)
    dot_r = 8
    dot_x = size - dot_r - 2
    dot_y = size - dot_r - 2
    
    # Dark border around indicator for contrast
    d.ellipse([dot_x - dot_r - 1, dot_y - dot_r - 1, dot_x + dot_r + 1, dot_y + dot_r + 1], fill=(15, 23, 42, 255))
    # Glowing status dot
    d.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r], fill=col + (255,))
    
    return img

def generate_all():
    out_dir = os.path.join(os.path.dirname(__file__), "assets")
    os.makedirs(out_dir, exist_ok=True)
    icon_path = os.path.join(out_dir, "icon.png")

    if not os.path.exists(icon_path):
        raise FileNotFoundError(f"Icon file not found: {icon_path}")

    # Load user's logo
    base_img = Image.open(icon_path).convert('RGBA')

    # Save 256x256 PNG
    icon_256 = base_img.resize((256, 256), Image.Resampling.LANCZOS)
    icon_256.save(os.path.join(out_dir, "icon-256.png"), "PNG")

    # Generate multi-resolution Windows ICO
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base_img.save(os.path.join(out_dir, "icon.ico"), format="ICO", sizes=sizes)
    print(f"Generated multi-resolution ICO: {os.path.join(out_dir, 'icon.ico')}")

    # Generate state-aware Tray Icons from user logo
    for st in ["idle", "listen", "think", "speak"]:
        t_icon = create_tray_icon_from_logo(base_img, st, 64)
        t_icon.save(os.path.join(out_dir, f"tray-{st}.png"), "PNG")
        print(f"Generated tray-{st}.png")

if __name__ == "__main__":
    generate_all()
